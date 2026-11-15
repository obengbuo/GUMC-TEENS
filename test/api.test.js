'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ScanCommand } = require('@aws-sdk/client-dynamodb');
process.env.ROUND_MS = '1500';
process.env.COUNTDOWN_MS = '300';
const { start } = require('../dev-server.js');
const Game = require('../app/game.js');

let srv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (path, body) => {
  const res = await fetch(srv.url + '/api/' + path, { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
};
const tableSize = async () => (await srv.client.send(new ScanCommand({ TableName: 'local-games' }))).Count;

test.before(async () => { srv = await start(0); });
test.after(() => srv.close());

test('serves the app and the intro video', async () => {
  const page = await fetch(srv.url + '/');
  assert.match(await page.text(), /Bible Name Scramble/);
  const video = await fetch(srv.url + '/intro.mp4');
  assert.strictEqual(video.headers.get('content-type'), 'video/mp4');
  assert.ok((await video.arrayBuffer()).byteLength > 50000);
});

test('full names are required', async () => {
  assert.strictEqual((await call('create', { name: 'Kofi' })).status, 400);
  assert.strictEqual((await call('create', { name: 'K B' })).status, 400);
});

test('a full round: lobby -> start -> answers -> scores -> data erased', async () => {
  const host = await call('create', { name: 'Ama Mensah' });
  assert.strictEqual(host.status, 200);
  const p2 = await call('join', { room: host.room, name: 'Kofi Boateng' });
  const p3 = await call('join', { room: host.room.toLowerCase(), name: 'Esi Owusu' });
  assert.strictEqual((await call('join', { room: host.room, name: 'kofi boateng' })).code, 'dupe');
  assert.strictEqual((await call('join', { room: 'ZZZZ', name: 'No Body' })).status, 404);

  let st = await call('state', { room: host.room, pid: p2.pid });
  assert.strictEqual(st.phase, 'lobby');
  assert.strictEqual(st.players.length, 3);
  assert.strictEqual(st.hostIsMe, false);
  assert.strictEqual(st.seed, undefined, 'questions stay secret until the game starts');

  // Host removes a player; that player is locked out.
  const esi = st.players.find((p) => p.name === 'Esi Owusu');
  await call('leave', { room: host.room, pid: host.pid, tag: esi.tag });
  assert.strictEqual((await call('state', { room: host.room, pid: p3.pid })).code, 'notin');

  // Only the host can start, and answers are refused before the start.
  assert.strictEqual((await call('start', { room: host.room, pid: p2.pid })).status, 409);
  assert.strictEqual((await call('answer', { room: host.room, pid: p2.pid, choices: [0] })).status, 409);
  assert.strictEqual((await call('start', { room: host.room, pid: host.pid })).status, 200);
  assert.strictEqual((await call('join', { room: host.room, name: 'Late Comer' })).code, 'started');

  st = await call('state', { room: host.room, pid: host.pid });
  assert.strictEqual(st.phase, 'countdown');
  assert.strictEqual(st.endAt - st.startAt, 1500);
  await sleep(350);

  const g = Game.createGame(st.seed);
  const right = (i) => g.question(i).answer, wrong = (i) => (g.question(i).answer + 1) % 4;
  // Host: 3 right. Kofi: 1 right, 2 wrong. Sent as growing lists, with a stale duplicate thrown in.
  await call('answer', { room: host.room, pid: host.pid, choices: [right(0)] });
  await call('answer', { room: host.room, pid: host.pid, choices: [right(0), right(1), right(2)] });
  await call('answer', { room: host.room, pid: host.pid, choices: [right(0)] });
  await call('answer', { room: host.room, pid: p2.pid, choices: [wrong(0), right(1), wrong(2)] });
  assert.strictEqual((await call('seen', { room: host.room, pid: host.pid })).code, 'early');

  await sleep(1500 + 2600);
  assert.strictEqual((await call('answer', { room: host.room, pid: p2.pid, choices: [right(0), right(1), right(2), right(3)] })).status, 409);
  st = await call('state', { room: host.room, pid: p2.pid });
  assert.strictEqual(st.phase, 'final');
  const scores = Object.fromEntries(st.players.map((p) => [p.name, [p.score, p.correct, p.answered]]));
  assert.deepStrictEqual(scores, { 'Ama Mensah': [15, 3, 3], 'Kofi Boateng': [5, 1, 3] });

  // Scores stay until every player has seen them, then everything is deleted.
  assert.strictEqual((await call('seen', { room: host.room, pid: host.pid })).wiped, false);
  assert.ok(await tableSize() > 0);
  assert.strictEqual((await call('seen', { room: host.room, pid: p2.pid })).wiped, true);
  assert.strictEqual(await tableSize(), 0);
  assert.strictEqual((await call('state', { room: host.room, pid: host.pid })).status, 404);
});

test('leaving: host hand-over, and an empty lobby is deleted', async () => {
  const host = await call('create', { name: 'First Host' });
  const p2 = await call('join', { room: host.room, name: 'Second Player' });
  await call('leave', { room: host.room, pid: host.pid });
  const st = await call('state', { room: host.room, pid: p2.pid });
  assert.strictEqual(st.hostIsMe, true);
  await call('leave', { room: host.room, pid: p2.pid });
  assert.strictEqual(await tableSize(), 0);
});
