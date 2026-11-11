import { expect, test } from '@playwright/test';

test('トップの二つの入口とキーボードで閉じられる作成フォーム', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ドラフト', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHubでソースコードを見る' })).toHaveAttribute('href', 'https://github.com/hanjyou0811/draft_app');
  await page.getByRole('button', { name: 'お題作成', exact: true }).click();
  await page.getByLabel('お題（任意）').fill('夏に食べたいもの');
  await page.getByLabel('候補の名前').fill('そうめん\nかき氷');
  await page.getByRole('button', { name: 'このお題でルーム作成' }).click();
  await expect(page.getByLabel('表示名')).toBeFocused();
  await expect(page.getByLabel('候補の名前')).toHaveValue('そうめん\nかき氷');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'お題作成', exact: true })).toBeFocused();
});

test('スマートフォンでもトップ画面が横にはみ出さない', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('32px "Dela Gothic One"', 'ドラフト'))).toBe(true);
    await expect(page.getByRole('button', { name: 'ルーム作成', exact: true })).toBeInViewport();
  }
});
