import { expect, test } from '@playwright/test';

const candidateNames = 'そうめん\nかき氷\nすいか\nアイス';

test('非公開のお題を保存し、再読み込み後に選んでルームを作成できる', async ({ page, browser }) => {
  const title = `夏に食べたいもの ${crypto.randomUUID()}`;
  let roomRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/rooms') roomRequests++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'お題作成', exact: true }).click();
  await page.getByLabel('お題名').fill(title);
  await page.getByLabel('候補の名前').fill(candidateNames);
  await expect(page.getByLabel('公開する')).not.toBeChecked();
  await expect(page.getByLabel('表示名')).not.toBeVisible();
  await page.getByRole('button', { name: 'お題を保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('お題を保存しました');
  expect(roomRequests).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'お題作成', exact: true })).toBeFocused();
  await page.reload();
  await page.getByRole('button', { name: 'ルーム作成', exact: true }).click();
  await page.getByLabel('お題を選択').selectOption({ label: title });
  await expect(page.getByRole('region', { name: '選択中のお題の候補' })).toContainText('そうめん');
  await expect(page.getByLabel('候補の名前')).not.toBeVisible();

  const stranger = await browser.newContext();
  try {
    const guest = await stranger.newPage();
    await guest.goto('/');
    await guest.getByRole('button', { name: 'ルーム作成', exact: true }).click();
    await expect(guest.getByLabel('お題を選択').getByRole('option', { name: title, exact: true })).toHaveCount(0);
  } finally { await stranger.close(); }

  await page.getByLabel('表示名').fill('お題の作成者');
  await page.getByLabel('各チームの獲得人数').fill('1');
  await page.getByRole('button', { name: '会議を作成', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  await expect(page.locator('.room-topic')).toContainText(title);
  expect(roomRequests).toBe(1);
});

test('公開したお題は別のブラウザからも選択できる', async ({ page, browser }) => {
  const title = `公開のお題 ${crypto.randomUUID()}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'お題作成', exact: true }).click();
  await page.getByLabel('お題名').fill(title);
  await page.getByLabel('候補の名前').fill(candidateNames);
  await page.getByLabel('公開する').check();
  await page.getByRole('button', { name: 'お題を保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('お題を保存しました');
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto('/');
    await guest.getByRole('button', { name: 'ルーム作成', exact: true }).click();
    await guest.getByLabel('お題を選択').selectOption({ label: title });
    await expect(guest.getByRole('region', { name: '選択中のお題の候補' })).toContainText('かき氷');
    await guest.getByLabel('表示名').fill('別の作成者');
    await guest.getByRole('button', { name: '会議を作成', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  } finally { await context.close(); }
});

test('お題がないときの案内と一覧取得失敗からの再試行', async ({ page }) => {
  let failed = true;
  await page.route('**/api/topics', route => failed
    ? route.fulfill({ status: 503, json: { error: 'お題を取得できませんでした。' } })
    : route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'ルーム作成', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('お題を取得できませんでした');
  failed = false;
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByText('選べるお題がまだありません。')).toBeVisible();
  await expect(page.getByRole('button', { name: '会議を作成' })).toBeDisabled();
  await page.getByRole('button', { name: 'お題を作成する' }).click();
  await expect(page.getByLabel('お題名')).toBeFocused();
});

test('トップと作成フォームがPC・スマホに収まりフォントとアイコンを読み込める', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const viewport of [{ width: 1519, height: 1035 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { name: 'ドラフト', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const github = page.getByRole('link', { name: 'GitHubでソースコードを見る' });
    await expect(github).toHaveAttribute('href', 'https://github.com/hanjyou0811/draft_app');
    await expect(github).toBeInViewport();
    expect(await github.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('32px "Dela Gothic One"', 'ドラフト'))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`landing-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'ルーム作成', exact: true }).click();
    await expect(page.getByLabel('表示名')).toBeFocused();
    await page.getByRole('button', { name: '会議を作成', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '会議を作成', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`room-form-${viewport.width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'お題作成', exact: true }).click();
    await expect(page.getByLabel('お題名')).toBeFocused();
    await expect(page.getByLabel('公開する')).not.toBeChecked();
    await page.screenshot({ path: testInfo.outputPath(`topic-form-${viewport.width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

