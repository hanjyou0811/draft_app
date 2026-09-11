# Draft Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 招待URLから同時指名・抽選・再指名でチームを完成できる日本語Webアプリを作る。

**Architecture:** Pure domain rules generate authoritative room state and participant-specific views. An asynchronous repository isolates SQLite; an application service serializes mutations and publishes committed snapshots. React uses HTTP commands and authenticated WebSocket snapshots, recovering via full state on reconnect.

**Tech Stack:** TypeScript, React, Node.js 22.22+, SQLite (node:sqlite), HTTP server, ws, Vite, tsx, node:test, Playwright.

**Spec:** docs/superpowers/specs/2026-09-07-draft-room-design.md

## Global Constraints

- 日本語UI。スマートフォンとPCで利用できる。
- 初版の入力上限は参加者20人、候補500件、表示名30文字、候補名100文字、獲得人数1〜50人。
- 開始後の新規参加と候補・獲得人数の変更は不可。
- 未公開の提出内容は本人以外のAPIレスポンスにもWebSocketにも含めない。
- Domain has no framework/database imports. Repository uses Promise-based methods to allow remote DB replacement.
- Single application process with durable local disk; no public deployment in this task.
- Commit only owned files. Do not dispatch additional agents from implementation workers.

## File map and common contracts

- `shared/types.ts`: Room, Member, Candidate, Pick, Outcome, RoomView, Credentials, RoundKey.
- `domain/draft.ts`: pure validation and transitions, injected ID and random sources.
- `domain/draft.test.ts`: rule and privacy regression tests.
- `server/repository.ts`: async RoomRepository, independent of concrete DB.
- `server/sqlite.ts`: SQLite persistence (room aggregate JSON, versioned envelope).
- `server/service.ts`: per-room serialization, token hash authentication, persisted operations.
- `server/http.ts`: HTTP API and static built frontend.
- `server/websocket.ts`, `server/errors.ts`: authenticated live transport and Japanese error mapping.
- `server/index.ts`: process composition and shutdown.
- `server/server.test.ts`: real HTTP/WS/SQLite integration tests.
- `src/api.ts`, `src/useRoom.ts`: browser identity, commands, reconnect, version ordering.
- `src/App.tsx`, `src/components/*.tsx`, `src/styles.css`: Japanese accessible responsive screens.
- `e2e/draft.spec.ts`, `playwright.config.ts`: multi-session browser flow.
- `README.md`: startup, limitations, replacement seams and testing.

State: room has id, status, teamSize, round, attempt, version, candidates, members, submissions and history. Member has id/name/isHost/tokenHash and picks. Candidate has id/name. RoundKey is `{round:number, attempt:number}`. Persist resolved submissions to permit idempotent retry even after the room advances. Client view excludes token hashes and others' active candidate choices.

## Task 1: Domain rules and project tooling

**Files:** package.json, package-lock.json, tsconfig.json, shared/types.ts, domain/draft.ts, domain/draft.test.ts.

**Interfaces:** Export `createRoom`, `joinRoom`, `startRoom`, `submitPick`, `toView`. Inputs have explicitly typed arguments and deterministic IDs in tests. Mutation functions return a new Room; `submitPick` consumes Room, member ID, candidate ID, RoundKey and `chooseIndex:(length:number)=>number`. Exact signatures must be documented in the task report for task 2. `RoomView` contains ownMemberId, candidates, public members with picks/submitted, own active submission, eligible member IDs, and published history.

- [x] Create npm/TS tooling, `test` using `tsx --test domain/*.test.ts server/*.test.ts` (adapt initial missing server glob), `typecheck` with tsc --noEmit. Install React/react-dom/ws and dev tooling/types for all tasks to avoid concurrent lock changes.
- [x] Write behavior tests before implementation: independent names normalize correctly; insufficient candidates block start; unauthorized start; hidden active picks; duplicate same submission returns unchanged version; changed/stale submission is rejected; committed identical retry remains accepted; already picked candidate rejected; entire first round is resolved atomically; loser re-picks; multi-round completion.

```ts
// Behavior fixture for two players, one slot each, deterministic first winner.
let room = fixtureRoom(['A', 'B'], 1);
room = startRoom(room, 'host');
room = submitPick(room, 'host', 'A', { round: 1, attempt: 1 }, () => 0);
assert.equal(toView(room, 'guest').members.find(m => m.id === 'host')?.submitted, true);
assert.equal(JSON.stringify(toView(room, 'guest')).includes('tokenHash'), false);
room = submitPick(room, 'guest', 'A', { round: 1, attempt: 1 }, () => 0);
assert.deepEqual(room.members.find(m => m.id === 'host')?.picks, ['A']);
assert.equal(room.attempt, 2);
room = submitPick(room, 'guest', 'B', { round: 1, attempt: 2 }, () => 0);
assert.equal(room.status, 'completed');
```

- [x] Run `npm test` and record the missing behavior failure; implement validation, immutable transitions and view projection. Validate types at runtime boundary or domain: empty values, duplicates after trim, lengths, numeric integers/limits, 2–20 participants and enough candidates.
- [x] Resolve groups in stable participant order with injected random index. Store all resolved outcomes once. Advance round only when every member owns that round's pick; losers alone remain eligible in repeated attempts.
- [x] Run `npm test` and `npm run typecheck`; commit domain/tooling. Report actual public signatures and test results.

## Task 2: Durable server and authenticated live updates

**Files:** server/repository.ts, server/sqlite.ts, server/service.ts, server/http.ts, server/websocket.ts, server/errors.ts, server/index.ts, server/server.test.ts, package.json scripts as needed.

**Interfaces:** `RoomRepository {get(id:string):Promise<Room|undefined>; create(room:Room):Promise<void>; save(room:Room,expectedVersion:number):Promise<void>}`. SQLite stores versioned aggregate atomically and rejects stale versions. Service creates cryptographic room/member IDs and random tokens, persists only hashes, serializes per-room reads/mutations, calls domain rules and emits personalized views after commit. Expose a testable server factory with ephemeral port support and cleanup.

HTTP JSON contract:
- POST `/api/rooms` `{name,names:string,teamSize:number}` -> 201 `{roomId,token}`.
- GET `/api/rooms/:id/info` -> `{status,teamSize,participantCount}` (no participant details).
- POST `/api/rooms/:id/join` `{name}` -> 201 `{roomId,token}`.
- GET `/api/rooms/:id` bearer token -> RoomView.
- POST `/api/rooms/:id/start` bearer token -> RoomView.
- POST `/api/rooms/:id/picks` bearer token `{candidateId,round,attempt}` -> RoomView.
- Errors `{error:string}` with 400 validation, 401 auth, 404 unknown room, 409 state conflict; no stack traces.
- WS `/ws` authenticates via first message `{roomId,token}` (no secret in URL), then sends `{type:'snapshot',room:RoomView}`. Close unauthenticated clients after timeout. Reconnection receives current state. Validate Origin when present, limit body/frame sizes, send heartbeat to detect broken connections.

- [x] Write real SQLite/HTTP tests for unauthenticated commands, host-only start, missing room, duplicate join, late join, malformed body, simultaneous commands, persisted restart, repeated last pick not rerolling, and active pick privacy over HTTP and WS.

```ts
const created = await post('/api/rooms', {name:'主催', names:'A\nB', teamSize:1});
const guest = await post(`/api/rooms/${created.roomId}/join`, {name:'参加者'});
assert.equal((await request('POST', `/api/rooms/${created.roomId}/start`, guest.token)).status, 400);
await request('POST', `/api/rooms/${created.roomId}/start`, created.token);
// Submit only host; guest snapshot must expose submitted:true but no candidate ID for host.
```

- [x] Run server tests to verify failures before implementation; implement adapter, service and transport. SQLite mutation is a single compare/version write; domain state contains entire transition so no partial results are saved. Use schema metadata/user_version for storage changes. Queue cleanup must not leak or poison later operations after rejection.
- [x] Serve dist with SPA fallback only for UI paths, not missing API endpoints. Add `dev:server`, `start` and documented env `PORT`, `HOST`, `DATABASE_PATH`. Use crypto.randomInt for lottery; never broadcast raw Room.
- [x] Run tests and typecheck; commit and report actual server API usage for frontend.

## Task 3: Japanese responsive UI and end-to-end delivery

**Files:** index.html, vite.config.ts, src/main.tsx, src/App.tsx, src/api.ts, src/useRoom.ts, src/components/*.tsx, src/styles.css, playwright.config.ts, e2e/draft.spec.ts, README.md, package scripts.

**Interfaces:** Consume RoomView from task 1 and HTTP/WS contracts from task 2. `/` create form; `/room/:id` restore stored per-room credentials or show join form. Hooks handle authenticated latest snapshot and reconnect independently of rendering.

- [x] Write browser behavior test first: create host room with 4 names / 1 slot, copy invite route into second isolated browser context, join, start, both choose same candidate, identify winner from UI, loser chooses remaining name, assert completed teams; reload verifies same identity. Add test invalid room, duplicate name, connection recovery, narrow viewport overflow and disabled controls after submit.

```ts
await host.getByLabel('表示名').fill('主催');
await host.getByLabel('候補の名前').fill('青木\n伊藤\n上田\n遠藤');
await host.getByRole('button', {name:'会議を作成'}).click();
await guest.goto(host.url());
await guest.getByLabel('表示名').fill('参加者');
await guest.getByRole('button', {name:'参加する'}).click();
await expect(host.getByText('参加者', {exact:true}).first()).toBeVisible();
```

- [x] Run test before UI implementation and record expected missing UI failure. Build spacious cream/navy/baseball-orange Japanese visual design with crisp cards, clear step status, candidate selection, team panels and persistent results. Use CSS and text, no external images or fonts required. Label fields, visible keyboard focus, live status and accessible selection controls.
- [x] Build browser network module and reconnect hook: same-origin paths, token localStorage per room, never place token in URLs; fetch full state on reconnect and command error, ignore older versions, close stale sockets/unmount timers, show disconnected state and disable mutations until synchronized. Invalid tokens clear identity and explain rejoin limits without infinite reload.
- [x] Build create/join/waiting/draft/results views: candidate count and limits, host-only start, share URL with clipboard fallback, no submission editing after acceptance, only losers can re-pick, round and attempt display, all teams and readable result history. Distinguish server rejection from uncertain transport failure; never claim failed command definitely did not happen.
- [x] Run multi-context Playwright test, domain/server suite, typecheck, production build and production HTTP smoke. Verify 390px and desktop layouts. Write README commands, durable disk requirement, offline-player waiting limitation and module replacement map.
- [x] Commit UI/tests/docs. Report commands and any environment limitations.
