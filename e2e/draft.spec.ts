import { expect, test, type Browser, type Page } from '@playwright/test';

async function openCreateRoom(page: Page): Promise<void> {
  const created = await page.request.post('/api/topics', {
    headers: { 'x-topic-owner': crypto.randomUUID() + crypto.randomUUID() },
    data: { title: `テストのお題 ${crypto.randomUUID()}`, names: '青木\n伊藤\n上田\n遠藤', isPublic: true },
  });
  expect(created.status()).toBe(201);
  const topic = await created.json() as { id: string };
  await page.goto('/');
  await page.getByRole('button', { name: 'ルーム作成', exact: true }).click();
  await page.getByLabel('お題を選択').selectOption(topic.id);
}

async function createRoom(page: Page, hostName = '主催'): Promise<void> {
  await openCreateRoom(page);
  await page.getByLabel('表示名').fill(hostName);
  await page.getByLabel('各チームの獲得人数').fill('1');
  await page.getByRole('button', { name: '会議を作成' }).click();
  await expect(page).toHaveURL(/\/room\/[^/]+$/u);
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
}

async function inviteUrlFor(host: Page): Promise<string> {
  await host.getByRole('tab', { name: '招待URL', exact: true }).click();
  const input = host.getByRole('textbox', { name: '招待URL', exact: true });
  await expect(input).toHaveValue(/\/invite\//u);
  const inviteUrl = await input.inputValue();
  await host.getByRole('tab', { name: /参加者/ }).click();
  return inviteUrl;
}

async function joinRoom(browser: Browser, host: Page, name: string): Promise<Page> {
  const inviteUrl = await inviteUrlFor(host);
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
  await page.getByRole('button', { name: '指名を確定' }).click();
}

function participantEntry(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

async function expectTeamPick(page: Page, name: string, candidate: string) {
  const matrix = page.getByRole('table', { name: 'ドラフト結果', exact: true });
  const header = matrix.getByRole('columnheader', { name: `${name}のチーム`, exact: true });
  const column = await header.evaluate((element: HTMLTableCellElement) => element.cellIndex);
  await expect(matrix.locator('tbody tr').first().getByRole('cell').nth(column - 1)).toContainText(candidate);
}

function candidatePreview(page: Page) {
  return page.getByRole('region', { name: '候補一覧' });
}

test('二つのブラウザで重複指名、再指名、完成、再読み込み復帰まで進める', async ({ page: host, browser }) => {
  await createRoom(host);
  const guest = await joinRoom(browser, host, '参加者');
  await expect(host.getByText('参加者', { exact: true }).first()).toBeVisible();
  for (const page of [host, guest]) {
    await page.getByRole('tab', { name: /候補リスト/ }).click();
    await expect(candidatePreview(page).getByText('青木', { exact: true })).toBeVisible();
    await expect(candidatePreview(page).getByText('遠藤', { exact: true })).toBeVisible();
  }
  await host.getByRole('button', { name: 'ドラフトを開始' }).click();
  await expect(guest.getByRole('heading', { name: '第1巡', exact: true })).toBeVisible();

  await Promise.all([choose(host, '青木'), choose(guest, '青木')]);
  await expect(host.getByRole('heading', { name: '抽選結果' })).toBeVisible();
  await expect(guest.getByRole('heading', { name: '抽選結果' })).toBeVisible();
  const hostLost = await host.getByText('再指名してください').isVisible();
  const loser = hostLost ? host : guest;
  const winner = hostLost ? guest : host;
  const winnerName = hostLost ? '参加者' : '主催';
  const loserName = hostLost ? '主催' : '参加者';
  await expect(winner.getByText('青木を獲得しました')).toBeVisible();
  await expect(winner.locator('.draft-selection')).toContainText('獲得済み');
  await choose(loser, '伊藤');

  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: 'ドラフト完了' })).toBeVisible();
    await expectTeamPick(page, winnerName, '青木');
    await expectTeamPick(page, loserName, '伊藤');
  }
  await expect(host.getByRole('columnheader', { name: '主催のチーム', exact: true })).toHaveAttribute('data-own', 'true');
  await expect(guest.getByRole('columnheader', { name: '参加者のチーム', exact: true })).toHaveAttribute('data-own', 'true');
  await host.reload();
  await guest.reload();
  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: 'ドラフト完了' })).toBeVisible();
    await expectTeamPick(page, winnerName, '青木');
    await expectTeamPick(page, loserName, '伊藤');
  }
  await expect(host.getByRole('columnheader', { name: '主催のチーム', exact: true })).toHaveAttribute('data-own', 'true');
  await expect(guest.getByRole('columnheader', { name: '参加者のチーム', exact: true })).toHaveAttribute('data-own', 'true');
});

test('無効な招待URLと表示名の重複を日本語で説明する', async ({ page, browser }) => {
  await page.goto('/invite/not-a-valid-invitation');
  await expect(page.getByRole('heading', { name: '招待リンクを確認' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('招待');
  await createRoom(page, '同じ名前');
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(await inviteUrlFor(page));
  await guest.getByLabel('表示名').fill('同じ名前');
  await guest.getByRole('button', { name: '参加する' }).click();
  await expect(guest.getByText('同じ表示名の参加者がいます。')).toBeVisible();
});

test('切断を表示して再同期し、390pxでも横にはみ出さず提出後の変更を防ぐ', async ({ page: host, browser }) => {
  await host.setViewportSize({ width: 390, height: 844 });
  await createRoom(host);
  await host.getByRole('tab', { name: /候補リスト/ }).click();
  await expect(candidatePreview(host)).toBeVisible();
  expect(await host.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const guest = await joinRoom(browser, host, 'モバイル参加者');
  await host.getByRole('button', { name: 'ドラフトを開始' }).click();
  await expect(host.getByRole('radio', { name: '上田', exact: true })).toBeEnabled();
  await host.context().setOffline(true);
  await expect(host.getByText('再接続中')).toBeVisible();
  await expect(host.getByRole('button', { name: '指名を確定' })).toBeDisabled();
  await host.context().setOffline(false);
  await expect(host.getByRole('radio', { name: '上田', exact: true })).toBeEnabled();
  await choose(host, '上田');
  await expect(host.getByText('指名を受け付けました')).toBeVisible();
  await expect(host.getByRole('radio', { name: '伊藤', exact: true })).toBeDisabled();
  await expect(host.getByRole('button', { name: '指名を確定' })).toBeDisabled();
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
  await openCreateRoom(page);
  await page.getByLabel('表示名').fill('保存できない主催');
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
  await guest.goto(await inviteUrlFor(host));
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
  await openCreateRoom(page);
  await page.getByLabel('表示名').fill('履歴主催');
  await page.getByRole('button', { name: '会議を作成' }).click();
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  await expect(page.getByText('参加情報を永続保存できませんでした。')).toBeVisible();
  await expect(participantEntry(page, '履歴主催')).toHaveAttribute('data-own', 'true');

  await page.goBack();
  await expect(page.getByRole('button', { name: 'ルーム作成', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'ドラフト待機室' })).toBeVisible();
  await expect(page.getByText('参加情報を永続保存できませんでした。')).toBeVisible();
  await expect(participantEntry(page, '履歴主催')).toHaveAttribute('data-own', 'true');
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
  await expect(page.getByText('再接続中', { exact: false })).not.toBeVisible();
});
