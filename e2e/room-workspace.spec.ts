import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function fixture(request: APIRequestContext, teamSize = 5, count = 60, members = 4) {
  const names = Array.from({ length: count }, (_, index) => `候補 ${String(index + 1).padStart(3, '0')}`).join('\n');
  const response = await request.post('/api/rooms', { data: { name: '東京チーム', topic: '夏に食べたいもの', names, teamSize } });
  expect(response.status()).toBe(201);
  const host = await response.json() as { roomId: string; token: string };
  const invitation = await request.get(`/api/rooms/${host.roomId}/invitation`, { headers: { authorization: `Bearer ${host.token}` } });
  expect(invitation.status()).toBe(200);
  const { inviteKey } = await invitation.json() as { inviteKey: string };
  const participants = [host];
  for (let i = 1; i < members; i++) {
    const joined = await request.post('/api/invitations/join', { data: { inviteKey, name: ['大阪チーム', '福岡チーム', '札幌チーム'][i - 1] ?? `チーム${i + 1}` } });
    expect(joined.status()).toBe(201);
    participants.push(await joined.json());
  }
  return { host, participants };
}

async function openHost(page: Page, credentials: { roomId: string; token: string }) {
  await page.addInitScript(value => localStorage.setItem(`draft-room:credentials:${value.roomId}`, JSON.stringify(value)), credentials);
  await page.goto(`/room/${credentials.roomId}`);
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ドラフトを開始' })).toBeEnabled();
}

test('待機中は招待URLを隠し、キーボードでタブを切り替えられる', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { host } = await fixture(request);
  await openHost(page, host);
  await expect(page.getByRole('tab', { name: /参加者/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#invite-url')).toHaveCount(0);
  await expect(page.getByText('同期済み', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ドラフトを開始' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.setViewportSize({ width: 1487, height: 1058 });
  await page.screenshot({ path: testInfo.outputPath('waiting-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: /参加者/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /候補リスト/ })).toBeFocused();
  await expect(page.getByRole('region', { name: '候補一覧' })).toContainText('候補 060');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /招待URL/ })).toBeFocused();
  await expect(page.getByRole('textbox', { name: '招待URL', exact: true })).toHaveValue(/\/invite\//u);
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: /参加者/ })).toBeFocused();
  await expect(page.locator('#invite-url')).toHaveCount(0);
});

test('表と候補検索から指名し、他者の未確定の候補を隠したまま結果を更新する', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { host, participants } = await fixture(request);
  await openHost(page, host);
  await page.getByRole('button', { name: 'ドラフトを開始' }).click();
  const matrix = page.getByRole('table', { name: 'ドラフト結果' });
  await expect(matrix).toBeVisible();
  await expect(matrix.getByRole('columnheader', { name: '東京チームのチーム', exact: true })).toHaveAttribute('data-own', 'true');
  await page.getByRole('searchbox', { name: '候補を検索' }).fill('060');
  await expect(page.getByRole('radio')).toHaveCount(1);
  await page.getByRole('radio', { name: '候補 060', exact: true }).check();
  await expect(page.getByRole('button', { name: '指名を確定', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '指名を確定', exact: true }).click();
  await expect(page.getByText('指名を受け付けました。ほかのチームを待っています。')).toBeVisible();
  const snapshot = await (await request.get(`/api/rooms/${host.roomId}`, { headers: { authorization: `Bearer ${host.token}` } })).json();
  for (let i = 1; i < participants.length; i++) {
    const candidate = snapshot.candidates.find((value: { name: string }) => value.name === `候補 ${String(60 - i).padStart(3, '0')}`);
    const response = await request.post(`/api/rooms/${host.roomId}/picks`, { headers: { authorization: `Bearer ${participants[i]!.token}` }, data: { candidateId: candidate.id, round: 1, attempt: 1 } });
    expect(response.status()).toBe(200);
    if (i === 1) {
      await expect(matrix.getByText('指名済み', { exact: true }).first()).toBeVisible();
      await expect(matrix.getByText('候補 059', { exact: true })).toHaveCount(0);
    }
  }
  await expect(page.getByRole('heading', { name: '第2巡', exact: true })).toBeVisible();
  await expect(matrix.getByText('候補 059', { exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: '候補を検索' })).toHaveValue('');
  await expect(page.getByRole('radio', { name: '候補 060', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.screenshot({ path: testInfo.outputPath('draft-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '履歴を見る', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '指名履歴' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('多数の候補と巡があってもスマホのページ全体が伸びず操作欄が見える', async ({ page, request }, testInfo) => {
  const { host, participants } = await fixture(request, 20, 120);
  await openHost(page, host);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: 'ドラフトを開始' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`waiting-${viewport.width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: 'ドラフトを開始' }).click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('table', { name: 'ドラフト結果' })).toBeVisible();
    await expect(page.getByRole('button', { name: '指名を確定', exact: true })).toBeInViewport();
    await expect(page.getByRole('searchbox', { name: '候補を検索' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('searchbox', { name: '候補を検索' }).fill('120');
    await page.getByRole('radio', { name: '候補 120', exact: true }).check();
    await expect(page.getByRole('button', { name: '指名を確定', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`draft-${viewport.width}.png`), fullPage: true });
  }
  const scrollRegion = page.getByRole('region', { name: 'ドラフト結果の表', exact: true });
  await scrollRegion.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole('button', { name: '指名を確定', exact: true }).click();
  const snapshot = await (await request.get(`/api/rooms/${host.roomId}`, { headers: { authorization: `Bearer ${host.token}` } })).json();
  for (let i = 1; i < participants.length; i++) {
    const response = await request.post(`/api/rooms/${host.roomId}/picks`, { headers: { authorization: `Bearer ${participants[i]!.token}` }, data: { candidateId: snapshot.candidates[i - 1].id, round: 1, attempt: 1 } });
    expect(response.status()).toBe(200);
  }
  await expect(page.getByRole('heading', { name: '第2巡', exact: true })).toBeVisible();
  await expect.poll(() => scrollRegion.evaluate(element => {
    const row = element.querySelector('tr[aria-current="step"]')!;
    const bounds = row.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    const headerHeight = element.querySelector('thead')!.getBoundingClientRect().height;
    return bounds.top >= frame.top + headerHeight - 2 && bounds.bottom <= frame.bottom + 2;
  })).toBe(true);
});
