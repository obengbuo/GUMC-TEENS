'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ScanCommand } = require('@aws-sdk/client-dynamodb');
process.env.ROUND_MS = '1500';
process.env.COUNTDOWN_MS = '300';
process.env.RESET_AFTER_MS = '1200';
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

  // Scores stay until every player has seen them, then they are erased and the same
  // players are back in the lobby for another round.
  assert.strictEqual((await call('seen', { room: host.room, pid: host.pid })).wiped, false);
  assert.strictEqual((await call('state', { room: host.room, pid: host.pid })).phase, 'final');
  assert.strictEqual((await call('seen', { room: host.room, pid: p2.pid })).wiped, true);
  const after = await call('state', { room: host.room, pid: host.pid });
  assert.strictEqual(after.phase, 'lobby');
  assert.deepStrictEqual(after.players.map((p) => [p.name, p.score, p.correct, p.answered]),
    [['Ama Mensah', 0, 0, 0], ['Kofi Boateng', 0, 0, 0]]);
  assert.strictEqual(after.seed, undefined);

  // When the last players leave, nothing at all is left.
  await call('leave', { room: host.room, pid: host.pid });
  await call('leave', { room: host.room, pid: p2.pid });
  assert.strictEqual(await tableSize(), 0);
  assert.strictEqual((await call('state', { room: host.room, pid: host.pid })).status, 404);
});

test('scores are erased within a minute even if a player never looks at them', async () => {
  const host = await call('create', { name: 'Ama Mensah' });
  const p2 = await call('join', { room: host.room, name: 'Gone Away' });
  await call('start', { room: host.room, pid: host.pid });
  let st = await call('state', { room: host.room, pid: host.pid });
  await sleep(350);
  await call('answer', { room: host.room, pid: host.pid, choices: [Game.createGame(st.seed, st.category).question(0).answer] });
  await sleep(1500 + 2600);
  st = await call('state', { room: host.room, pid: host.pid });
  assert.strictEqual(st.players.find((p) => p.me).score, 5);
  await call('seen', { room: host.room, pid: host.pid }); // the other player never confirms
  await sleep(1300);
  st = await call('state', { room: host.room, pid: host.pid });
  assert.strictEqual(st.phase, 'lobby');
  assert.ok(st.players.every((p) => p.score === 0));
  await call('leave', { room: host.room, pid: host.pid });
  await call('leave', { room: host.room, pid: p2.pid });
});

test('host picks the category; answers are checked against that category', async () => {
  const host = await call('create', { name: 'Ama Mensah' });
  const p2 = await call('join', { room: host.room, name: 'Kofi Boateng' });
  assert.strictEqual((await call('config', { room: host.room, pid: p2.pid, category: 'books' })).status, 409);
  assert.strictEqual((await call('config', { room: host.room, pid: host.pid, category: 'nonsense' })).status, 400);
  assert.strictEqual((await call('config', { room: host.room, pid: host.pid, category: 'whoami' })).status, 200);
  assert.strictEqual((await call('state', { room: host.room, pid: p2.pid })).category, 'whoami');
  await call('start', { room: host.room, pid: host.pid });
  const st = await call('state', { room: host.room, pid: p2.pid });
  await sleep(350);
  const g = Game.createGame(st.seed, 'whoami');
  assert.ok(g.question(0).clue);
  await call('answer', { room: host.room, pid: p2.pid, choices: [g.question(0).answer, g.question(1).answer] });
  assert.strictEqual((await call('state', { room: host.room, pid: p2.pid })).players.find((p) => p.me).score, 10);
  await sleep(1500 + 2600);
  await call('leave', { room: host.room, pid: host.pid });
  await call('leave', { room: host.room, pid: p2.pid });
  assert.strictEqual(await tableSize(), 0);
});

test('team mode: balanced dealing, switching teams, late joiners fill the smallest team', async () => {
  const host = await call('create', { name: 'Player One' });
  const pids = [host.pid];
  for (const n of ['Player Two', 'Player Three', 'Player Four', 'Player Five']) pids.push((await call('join', { room: host.room, name: n })).pid);
  let st = await call('state', { room: host.room, pid: host.pid });
  assert.strictEqual(st.mode, 'solo');
  await call('config', { room: host.room, pid: host.pid, mode: 'teams', teamCount: 2 });
  st = await call('state', { room: host.room, pid: host.pid });
  const sizes = (s) => [0, 1, 2, 3].map((t) => s.players.filter((p) => p.team === t).length);
  assert.deepStrictEqual(sizes(st), [3, 2, 0, 0]);
  const six = await call('join', { room: host.room, name: 'Player Six' });
  st = await call('state', { room: host.room, pid: six.pid });
  assert.strictEqual(st.players.find((p) => p.me).team, 1);
  assert.strictEqual((await call('team', { room: host.room, pid: six.pid, team: 2 })).status, 400);
  assert.strictEqual((await call('team', { room: host.room, pid: six.pid, team: 0 })).status, 200);
  assert.deepStrictEqual(sizes(await call('state', { room: host.room, pid: host.pid })), [4, 2, 0, 0]);
  await call('config', { room: host.room, pid: host.pid, teamCount: 3 });
  assert.deepStrictEqual(sizes(await call('state', { room: host.room, pid: host.pid })), [2, 2, 2, 0]);
  await call('start', { room: host.room, pid: host.pid });
  assert.strictEqual((await call('team', { room: host.room, pid: six.pid, team: 1 })).status, 409);
});

test('leaving: host hand-over, and an empty lobby is deleted', async () => {
  const host = await call('create', { name: 'First Host' });
  const p2 = await call('join', { room: host.room, name: 'Second Player' });
  await call('leave', { room: host.room, pid: host.pid });
  const st = await call('state', { room: host.room, pid: p2.pid });
  assert.strictEqual(st.hostIsMe, true);
  await call('leave', { room: host.room, pid: p2.pid });
  assert.strictEqual((await call('join', { room: host.room, name: 'Too Late' })).status, 404);
});
