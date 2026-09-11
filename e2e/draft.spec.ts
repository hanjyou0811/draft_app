import { expect, test, type Browser, type Page } from '@playwright/test';

async function createRoom(page: Page, hostName = '主催'): Promise<void> {
  await page.goto('/');
  await page.getByLabel('表示名').fill(hostName);
  await page.getByLabel('候補の名前').fill('青木\n伊藤\n上田\n遠藤');
  await page.getByLabel('各チームの獲得人数').fill('1');
  await page.getByRole('button', { name: '会議を作成' }).click();
  await expect(page).toHaveURL(/\/room\/[^/]+$/u);
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
}

async function joinRoom(browser: Browser, inviteUrl: string, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(inviteUrl);
  await page.getByLabel('表示名').fill(name);
  await page.getByRole('button', { name: '参加する' }).click();
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  return page;
}

async function choose(page: Page, candidate: string): Promise<void> {
  await page.getByRole('radio', { name: candidate, exact: true }).check();
  await page.getByRole('button', { name: 'この選手を指名する' }).click();
}

function teamCard(page: Page, name: string) {
  return page.getByRole('article').filter({
    has: page.getByRole('heading', { name: `${name}のチーム` }),
  });
}

function candidatePreview(page: Page) {
  return page.getByRole('region', { name: '候補一覧' });
}

test('二つのブラウザで重複指名、再指名、完成、再読み込み復帰まで進める', async ({ page: host, browser }) => {
  await createRoom(host);
  const guest = await joinRoom(browser, host.url(), '参加者');
  await expect(host.getByText('参加者', { exact: true }).first()).toBeVisible();
  for (const page of [host, guest]) {
    await expect(candidatePreview(page).getByText('青木', { exact: true })).toBeVisible();
    await expect(candidatePreview(page).getByText('遠藤', { exact: true })).toBeVisible();
  }
  await host.getByRole('button', { name: 'ドラフトを開始' }).click();
  await expect(guest.getByRole('heading', { name: '第1巡 選択希望選手' })).toBeVisible();

  await Promise.all([choose(host, '青木'), choose(guest, '青木')]);
  await expect(host.getByRole('heading', { name: '抽選結果' })).toBeVisible();
  await expect(guest.getByRole('heading', { name: '抽選結果' })).toBeVisible();
  const hostLost = await host.getByText('再指名してください').isVisible();
  const loser = hostLost ? host : guest;
  const winner = hostLost ? guest : host;
  const winnerName = hostLost ? '参加者' : '主催';
  const loserName = hostLost ? '主催' : '参加者';
  await expect(winner.getByText('青木を獲得しました')).toBeVisible();
  await choose(loser, '伊藤');

  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: 'ドラフト完了' })).toBeVisible();
    await expect(teamCard(page, winnerName).getByText('青木', { exact: true })).toBeVisible();
    await expect(teamCard(page, loserName).getByText('伊藤', { exact: true })).toBeVisible();
  }
  await expect(teamCard(host, '主催')).toHaveClass(/team-card--own/u);
  await expect(teamCard(guest, '参加者')).toHaveClass(/team-card--own/u);
  await host.reload();
  await guest.reload();
  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: 'ドラフト完了' })).toBeVisible();
    await expect(teamCard(page, winnerName).getByText('青木', { exact: true })).toBeVisible();
    await expect(teamCard(page, loserName).getByText('伊藤', { exact: true })).toBeVisible();
  }
  await expect(teamCard(host, '主催')).toHaveClass(/team-card--own/u);
  await expect(teamCard(guest, '参加者')).toHaveClass(/team-card--own/u);
});

test('無効な招待URLと表示名の重複を日本語で説明する', async ({ page, browser }) => {
  await page.goto('/room/not-a-room');
  await expect(page.getByText('会議が見つかりません。')).toBeVisible();
  await createRoom(page, '同じ名前');
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(page.url());
  await guest.getByLabel('表示名').fill('同じ名前');
  await guest.getByRole('button', { name: '参加する' }).click();
  await expect(guest.getByText('同じ表示名の参加者がいます。')).toBeVisible();
});

test('切断を表示して再同期し、390pxでも横にはみ出さず提出後の変更を防ぐ', async ({ page: host, browser }) => {
  await host.setViewportSize({ width: 390, height: 844 });
  await createRoom(host);
  await expect(candidatePreview(host)).toBeVisible();
  expect(await host.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const guest = await joinRoom(browser, host.url(), 'モバイル参加者');
  await host.getByRole('button', { name: 'ドラフトを開始' }).click();
  await expect(host.getByText('同期済み')).toBeVisible();
  await host.context().setOffline(true);
  await expect(host.getByText('再接続中')).toBeVisible();
  await expect(host.getByRole('button', { name: 'この選手を指名する' })).toBeDisabled();
  await host.context().setOffline(false);
  await expect(host.getByText('同期済み')).toBeVisible();
  await choose(host, '上田');
  await expect(host.getByText('指名を受け付けました')).toBeVisible();
  await expect(host.getByRole('radio', { name: '伊藤', exact: true })).toBeDisabled();
  await expect(host.getByRole('button', { name: 'この選手を指名する' })).toBeDisabled();
  expect(await host.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expect(guest.getByText('主催: 指名済み', { exact: true })).toBeVisible();
});

test('参加情報を保存できないブラウザーでは送信前に停止する', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.removeItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  const page = await context.newPage();
  let createRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/rooms') createRequests += 1;
  });
  await page.goto('/');
  await page.getByLabel('表示名').fill('保存できない主催');
  await page.getByLabel('候補の名前').fill('青木\n伊藤');
  await page.getByRole('button', { name: '会議を作成' }).click();
  await expect(page.getByText('このブラウザーでは参加情報を保存できません。')).toBeVisible();
  expect(createRequests).toBe(0);
  await expect(page).toHaveURL(/\/$/u);
});

test('参加成功後に保存が失敗しても発行済み認証で入室し二重参加しない', async ({ page: host, browser }) => {
  await createRoom(host);
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (key, value) {
      writes += 1;
      if (writes >= 2) throw new DOMException('quota', 'QuotaExceededError');
      return originalSet.call(this, key, value);
    };
  });
  const guest = await context.newPage();
  let joinRequests = 0;
  guest.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/join')) joinRequests += 1;
  });
  await guest.goto(host.url());
  await guest.getByLabel('表示名').fill('保存不可参加者');
  await guest.getByRole('button', { name: '参加する' }).click();
  await expect(guest.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  await expect(guest.getByText('参加情報を永続保存できませんでした。')).toBeVisible();
  await expect(host.getByText('保存不可参加者', { exact: true })).toHaveCount(1);
  expect(joinRequests).toBe(1);
});

test('作成成功後の保存失敗でも履歴移動後に認証と警告を復元して二重作成しない', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (key, value) {
      writes += 1;
      if (writes >= 2) throw new DOMException('quota', 'QuotaExceededError');
      return originalSet.call(this, key, value);
    };
  });
  const page = await context.newPage();
  let createRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/rooms') createRequests += 1;
  });
  await page.goto('/');
  await page.getByLabel('表示名').fill('履歴主催');
  await page.getByLabel('候補の名前').fill('青木\n伊藤');
  await page.getByRole('button', { name: '会議を作成' }).click();
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  await expect(page.getByText('参加情報を永続保存できませんでした。')).toBeVisible();
  await expect(teamCard(page, '履歴主催')).toHaveClass(/team-card--own/u);

  await page.goBack();
  await expect(page.getByRole('button', { name: '会議を作成' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  await expect(page.getByText('参加情報を永続保存できませんでした。')).toBeVisible();
  await expect(teamCard(page, '履歴主催')).toHaveClass(/team-card--own/u);
  expect(createRequests).toBe(1);
});

test('保存情報の削除に失敗しても無効な認証から終端画面へ移る', async ({ page: host, browser }) => {
  await createRoom(host);
  const roomId = new URL(host.url()).pathname.split('/').at(-1) as string;
  const context = await browser.newContext();
  await context.addInitScript(({ id }) => {
    localStorage.setItem(`draft-room:credentials:${id}`, JSON.stringify({ roomId: id, token: 'invalid-token' }));
    Storage.prototype.removeItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  }, { id: roomId });
  const page = await context.newPage();
  await page.goto(host.url());
  await expect(page.getByRole('heading', { name: '参加情報を確認できません' })).toBeVisible();
});

test('保存済み認証の会議が存在しない場合は再試行せず理由を表示する', async ({ browser }) => {
  const roomId = 'missing-cached-room';
  const context = await browser.newContext();
  await context.addInitScript(({ id }) => {
    localStorage.setItem(`draft-room:credentials:${id}`, JSON.stringify({ roomId: id, token: 'cached-token' }));
  }, { id: roomId });
  const page = await context.newPage();
  let roomRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/rooms/${roomId}`) roomRequests += 1;
  });
  await page.goto(`/room/${roomId}`);
  await expect(page.getByRole('heading', { name: '会議が見つかりません' })).toBeVisible();
  const requestsAtTerminalState = roomRequests;
  expect(requestsAtTerminalState).toBeGreaterThan(0);
  await page.waitForTimeout(1_200);
  expect(roomRequests).toBe(requestsAtTerminalState);
});

test('初回の状態取得に失敗したときも再接続中と示して復帰する', async ({ page }) => {
  await createRoom(page);
  const roomPath = new URL(page.url()).pathname.replace('/room/', '/api/rooms/');
  await page.route(`**${roomPath}`, (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByText('再接続中', { exact: false })).toBeVisible();
  await page.unroute(`**${roomPath}`);
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  await expect(page.getByText('同期済み')).toBeVisible();
});
