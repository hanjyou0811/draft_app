import { expect, test, type Page } from '@playwright/test';

async function createHost(page: Page) {
  const created = await page.request.post('/api/rooms', { data: { name: '主催者', topic: '招待リンクの確認', names: '青木\n伊藤\n上田\n遠藤', teamSize: 1 } });
  expect(created.status()).toBe(201);
  const credentials = await created.json() as { roomId: string; token: string };
  await page.addInitScript(value => localStorage.setItem(`draft-room:credentials:${value.roomId}`, JSON.stringify(value)), credentials);
  await page.goto(`/room/${credentials.roomId}`);
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  return credentials;
}

test('ルームURLだけでは参加できず、招待リンクの参加後はキーがURLから消える', async ({ page: host, browser }) => {
  const credentials = await createHost(host);
  const roomUrl = host.url();
  let inviteReads = 0;
  host.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/invitation')) inviteReads++; });
  await expect(host.locator('#invite-url')).toHaveCount(0);
  expect(inviteReads).toBe(0);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(roomUrl);
    await expect(guest.getByRole('heading', { name: '招待リンクが必要です' })).toBeVisible();
    await expect(guest.getByRole('button', { name: '参加する', exact: true })).toHaveCount(0);
    const blocked = await guest.request.post(`/api/rooms/${credentials.roomId}/join`, { data: { name: '招待なし' } });
    expect(blocked.status()).toBe(403);
    await host.getByRole('tab', { name: '招待URL', exact: true }).click();
    const link = host.getByRole('textbox', { name: '招待URL', exact: true });
    await expect(link).toHaveValue(/\/invite\//u);
    const inviteUrl = await link.inputValue();
    expect(inviteUrl).not.toBe(roomUrl);
    expect(inviteReads).toBeGreaterThan(0);
    await guest.goto(inviteUrl);
    await expect(guest.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    await guest.getByLabel('表示名').fill('招待された人');
    await guest.getByRole('button', { name: '参加する', exact: true }).click();
    await expect(guest).toHaveURL(roomUrl);
    await expect(guest.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
    await guest.getByRole('tab', { name: '招待URL', exact: true }).click();
    await expect(guest.getByText('招待リンクは主催者から受け取ってください。')).toBeVisible();
    await expect(guest.locator('#invite-url')).toHaveCount(0);
    await host.getByRole('tab', { name: /参加者/ }).click();
    await expect(host.locator('#invite-url')).toHaveCount(0);
    expect(await host.locator('body').innerText()).not.toContain(inviteUrl);
  } finally { await context.close(); }
});

test('再発行で古い招待は無効になり、参加済みの人はそのまま利用できる', async ({ page: host, browser }) => {
  await createHost(host);
  const roomUrl = host.url();
  await host.getByRole('tab', { name: '招待URL', exact: true }).click();
  const link = host.getByRole('textbox', { name: '招待URL', exact: true });
  await expect(link).toHaveValue(/\/invite\//u);
  const oldUrl = await link.inputValue();
  const joinedContext = await browser.newContext();
  const newcomerContext = await browser.newContext();
  try {
    const joined = await joinedContext.newPage();
    await joined.goto(oldUrl);
    await joined.getByLabel('表示名').fill('参加済み');
    await joined.getByRole('button', { name: '参加する', exact: true }).click();
    await expect(joined).toHaveURL(roomUrl);
    await host.getByRole('button', { name: '招待リンクを再発行', exact: true }).click();
    await expect(link).not.toHaveValue(oldUrl);
    await expect(link).toHaveValue(/\/invite\//u);
    const newUrl = await link.inputValue();
    const newcomer = await newcomerContext.newPage();
    await newcomer.goto(oldUrl);
    await expect(newcomer.getByRole('alert')).toContainText(/招待/u);
    await expect(newcomer.getByRole('button', { name: '参加する', exact: true })).toHaveCount(0);
    await joined.reload();
    await expect(joined.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
    await newcomer.goto(newUrl);
    await newcomer.getByLabel('表示名').fill('新しい招待');
    await newcomer.getByRole('button', { name: '参加する', exact: true }).click();
    await expect(newcomer).toHaveURL(roomUrl);
    await expect(newcomer.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  } finally { await joinedContext.close(); await newcomerContext.close(); }
});

test('再発行の応答を失ったら古いリンクを隠し、読み直して最新リンクを取得する', async ({ page }) => {
  const credentials = await createHost(page);
  await page.getByRole('tab', { name: '招待URL', exact: true }).click();
  const link = page.getByRole('textbox', { name: '招待URL', exact: true });
  await expect(link).toHaveValue(/\/invite\//u);
  const oldUrl = await link.inputValue();
  const path = `**/api/rooms/${credentials.roomId}/invitation`;
  await page.route(path, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '招待リンクを再発行', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#invite-url')).toHaveCount(0);
  await page.unroute(path);
  await page.getByRole('button', { name: '再読み込み', exact: true }).click();
  await expect(link).toHaveValue(/\/invite\//u);
  await expect(link).not.toHaveValue(oldUrl);
});

