'use strict';
/* Bible Name Scramble - single Lambda behind a Function URL.
   Serves the web app and a tiny JSON API. Game rooms live in DynamoDB only while a
   game is in progress and are deleted as soon as everyone has seen the scores. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand,
  QueryCommand, ScanCommand, BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');
const Game = require('./game.js');

const TABLE = process.env.TABLE_NAME || 'bible-name-scramble';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(
  process.env.DDB_ENDPOINT
    ? { endpoint: process.env.DDB_ENDPOINT, region: 'local', credentials: { accessKeyId: 'x', secretAccessKey: 'x' } }
    : {}
));

const ROUND_MS = Number(process.env.ROUND_MS) || Game.ROUND_MS; // 120 seconds
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS) || 5000; // 3-2-1 before the clock starts
const GRACE_MS = 2500;            // lets last-second answers arrive before scores lock
const LOBBY_LIFE_MS = 45 * 60000; // an unstarted lobby disappears after 45 minutes
const RESULTS_LIFE_MS = 2 * 60000; // scores are wiped at most 2 minutes after a round
const HOST_AWAY_MS = 20000;
const MAX_PLAYERS = 80;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/* ---------- static files ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};
const STATIC = {};
function loadStatic(urlPath, file) {
  const ext = path.extname(file);
  const binary = !/\.(html|js|css|svg)$/.test(ext);
  STATIC[urlPath] = {
    type: TYPES[ext] || 'application/octet-stream',
    binary,
    body: fs.readFileSync(file).toString(binary ? 'base64' : 'utf8'),
    cache: ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  };
}
const PUBLIC = path.join(__dirname, 'public');
for (const f of fs.readdirSync(PUBLIC)) loadStatic('/' + f, path.join(PUBLIC, f));
loadStatic('/game.js', path.join(__dirname, 'game.js'));
STATIC['/'] = STATIC['/index.html'];

/* ---------- helpers ---------- */
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const json = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body)
});
const token = (bytes) => crypto.randomBytes(bytes).toString('hex');
const isConditionFail = (e) => e && e.name === 'ConditionalCheckFailedException';

function cleanName(raw) {
  const name = String(raw || '').replace(/[^\p{L}\p{M}'’.\- ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const words = name.split(' ').filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 2);
  if (words.length < 2) throw new ApiError(400, 'name', 'Please type your full name (first and last).');
  return name;
}
function cleanRoom(raw) {
  const room = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (room.length !== 4) throw new ApiError(400, 'room', 'Game codes are 4 letters.');
  return room;
}
const cleanPid = (raw) => {
  const pid = String(raw || '');
  if (!/^[0-9a-f]{24}$/.test(pid)) throw new ApiError(403, 'notin', 'You are not in this game.');
  return pid;
};

async function loadRoom(room) {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE, KeyConditionExpression: 'pk = :r', ExpressionAttributeValues: { ':r': room }, ConsistentRead: true
  }));
  const items = res.Items || [];
  const meta = items.find((i) => i.sk === 'META');
  if (!meta || meta.exp < Date.now()) {
    if (items.length) await deleteItems(items);
    return null;
  }
  const players = items.filter((i) => i.sk !== 'META').sort((a, b) => a.joinedAt - b.joinedAt);
  return { meta, players, items };
}
async function requireRoom(room) {
  const data = await loadRoom(room);
  if (!data) throw new ApiError(404, 'gone', 'That game was not found. It may have ended.');
  return data;
}
async function deleteItems(items) {
  for (let i = 0; i < items.length; i += 25) {
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: items.slice(i, i + 25).map((it) => ({ DeleteRequest: { Key: { pk: it.pk, sk: it.sk } } })) }
    }));
  }
}
// Belt and braces: remove anything left behind by games nobody finished.
async function sweepExpired() {
  const now = Date.now();
  const res = await ddb.send(new ScanCommand({
    TableName: TABLE, FilterExpression: 'sk = :m AND #e < :now',
    ExpressionAttributeNames: { '#e': 'exp' }, ExpressionAttributeValues: { ':m': 'META', ':now': now }
  }));
  for (const meta of res.Items || []) {
    const q = await ddb.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: 'pk = :r', ExpressionAttributeValues: { ':r': meta.pk }
    }));
    await deleteItems(q.Items || []);
  }
}

function playerItem(room, pid, name, now) {
  return {
    pk: room, sk: 'P#' + pid, tag: token(4), name, score: 0, correct: 0, answered: 0,
    joinedAt: now, lastSeen: now, seen: false, ttl: Math.floor(now / 1000) + 3 * 3600
  };
}

function phaseOf(meta, now) {
  if (meta.state === 'lobby') return 'lobby';
  if (now < meta.startAt) return 'countdown';
  if (now < meta.endAt) return 'playing';
  if (now < meta.endAt + GRACE_MS) return 'tally';
  return 'final';
}

/* ---------- API ---------- */
const api = {
  async create(body) {
    const name = cleanName(body.name);
    const now = Date.now();
    await sweepExpired().catch(() => {});
    for (let attempt = 0; attempt < 8; attempt++) {
      let room = '';
      for (let i = 0; i < 4; i++) room += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      const pid = token(12);
      try {
        await ddb.send(new PutCommand({
          TableName: TABLE,
          Item: {
            pk: room, sk: 'META', state: 'lobby', hostId: pid, seed: token(8), createdAt: now,
            exp: now + LOBBY_LIFE_MS, ttl: Math.floor(now / 1000) + 3 * 3600
          },
          ConditionExpression: 'attribute_not_exists(pk)'
        }));
      } catch (e) {
        if (isConditionFail(e)) continue;
        throw e;
      }
      await ddb.send(new PutCommand({ TableName: TABLE, Item: playerItem(room, pid, name, now) }));
      return { room, pid };
    }
    throw new ApiError(503, 'busy', 'Could not create a game. Please try again.');
  },

  async join(body) {
    const room = cleanRoom(body.room);
    const name = cleanName(body.name);
    const { meta, players } = await requireRoom(room);
    if (meta.state !== 'lobby') throw new ApiError(409, 'started', 'That game has already started. Wait for the next round!');
    if (players.length >= MAX_PLAYERS) throw new ApiError(409, 'full', 'That game is full.');
    if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new ApiError(409, 'dupe', 'Someone with that name is already in. Add a middle initial?');
    }
    const pid = token(12);
    await ddb.send(new PutCommand({ TableName: TABLE, Item: playerItem(room, pid, name, Date.now()) }));
    return { room, pid };
  },

  async state(body) {
    const room = cleanRoom(body.room);
    const pid = cleanPid(body.pid);
    const { meta, players } = await requireRoom(room);
    const me = players.find((p) => p.sk === 'P#' + pid);
    if (!me) throw new ApiError(403, 'notin', 'You are not in this game.');
    const now = Date.now();
    const phase = phaseOf(meta, now);

    if (phase === 'lobby') {
      if (now - me.lastSeen > 5000) {
        me.lastSeen = now;
        await ddb.send(new UpdateCommand({
          TableName: TABLE, Key: { pk: room, sk: me.sk }, UpdateExpression: 'SET lastSeen = :n',
          ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':n': now }
        })).catch(() => {});
      }
      // If the host wandered off, the longest-waiting active player takes over.
      const host = players.find((p) => p.sk === 'P#' + meta.hostId);
      if (!host || now - host.lastSeen > HOST_AWAY_MS) {
        const next = players.find((p) => now - p.lastSeen < HOST_AWAY_MS);
        if (next && next.sk === me.sk) {
          await ddb.send(new UpdateCommand({
            TableName: TABLE, Key: { pk: room, sk: 'META' }, UpdateExpression: 'SET hostId = :me',
            ConditionExpression: 'hostId = :old AND #s = :lobby', ExpressionAttributeNames: { '#s': 'state' },
            ExpressionAttributeValues: { ':me': pid, ':old': meta.hostId, ':lobby': 'lobby' }
          })).then(() => { meta.hostId = pid; }).catch(() => {});
        }
      }
    }

    const out = {
      phase, now, room, hostIsMe: meta.hostId === pid,
      players: players.map((p) => ({
        tag: p.tag, name: p.name, score: p.score, correct: p.correct, answered: p.answered,
        me: p.sk === me.sk, host: p.sk === 'P#' + meta.hostId
      }))
    };
    if (phase !== 'lobby') {
      out.seed = meta.seed; out.startAt = meta.startAt; out.endAt = meta.endAt; out.myAnswered = me.answered;
    }
    return out;
  },

  async start(body) {
    const room = cleanRoom(body.room);
    const pid = cleanPid(body.pid);
    const now = Date.now();
    const startAt = now + COUNTDOWN_MS;
    const endAt = startAt + ROUND_MS;
    try {
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: room, sk: 'META' },
        UpdateExpression: 'SET #s = :started, startAt = :sa, endAt = :ea, #e = :exp',
        ConditionExpression: '#s = :lobby AND hostId = :pid',
        ExpressionAttributeNames: { '#s': 'state', '#e': 'exp' },
        ExpressionAttributeValues: {
          ':started': 'started', ':lobby': 'lobby', ':pid': pid, ':sa': startAt, ':ea': endAt,
          ':exp': endAt + GRACE_MS + RESULTS_LIFE_MS
        }
      }));
    } catch (e) {
      if (isConditionFail(e)) throw new ApiError(409, 'nostart', 'Only the host can start the game.');
      throw e;
    }
    return { ok: true };
  },

  // The client sends its full list of picks each time, so a dropped request never loses points.
  async answer(body) {
    const room = cleanRoom(body.room);
    const pid = cleanPid(body.pid);
    const choices = body.choices;
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > 300 ||
        !choices.every((c) => Number.isInteger(c) && c >= 0 && c <= 3)) {
      throw new ApiError(400, 'bad', 'Bad answer.');
    }
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: room, sk: 'META' }, ConsistentRead: true }));
    const meta = res.Item;
    const now = Date.now();
    if (!meta || meta.state !== 'started' || now < meta.startAt - 500 || now > meta.endAt + GRACE_MS) {
      throw new ApiError(409, 'closed', 'The round is not running.');
    }
    const result = Game.createGame(meta.seed).score(choices);
    try {
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: room, sk: 'P#' + pid },
        UpdateExpression: 'SET answered = :a, correct = :c, score = :s',
        ConditionExpression: 'attribute_exists(pk) AND answered < :a',
        ExpressionAttributeValues: { ':a': result.answered, ':c': result.correct, ':s': result.score }
      }));
    } catch (e) {
      if (!isConditionFail(e)) throw e; // an older/duplicate request - safe to ignore
    }
    return { ok: true };
  },

  // Each player confirms they have the final scores; once everyone has, the room is erased.
  async seen(body) {
    const room = cleanRoom(body.room);
    const pid = cleanPid(body.pid);
    const data = await loadRoom(room);
    if (!data) return { ok: true, wiped: true };
    if (phaseOf(data.meta, Date.now()) !== 'final') throw new ApiError(409, 'early', 'Scores are not final yet.');
    const me = data.players.find((p) => p.sk === 'P#' + pid);
    if (!me) throw new ApiError(403, 'notin', 'You are not in this game.');
    me.seen = true;
    if (data.players.every((p) => p.seen)) {
      await deleteItems(data.items);
      return { ok: true, wiped: true };
    }
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: room, sk: me.sk }, UpdateExpression: 'SET seen = :t',
      ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':t': true }
    })).catch(() => {});
    // Re-check in case the last two players confirmed at the same moment.
    const again = await loadRoom(room);
    if (again && again.players.every((p) => p.seen)) {
      await deleteItems(again.items);
      return { ok: true, wiped: true };
    }
    return { ok: true, wiped: false };
  },

  // Leave the lobby yourself, or (host only) remove someone by their public tag.
  async leave(body) {
    const room = cleanRoom(body.room);
    const pid = cleanPid(body.pid);
    const data = await loadRoom(room);
    if (!data) return { ok: true };
    const { meta, players, items } = data;
    if (meta.state !== 'lobby') return { ok: true };
    const me = players.find((p) => p.sk === 'P#' + pid);
    if (!me) return { ok: true };
    let target = me;
    if (body.tag) {
      if (meta.hostId !== pid) throw new ApiError(403, 'nothost', 'Only the host can remove players.');
      target = players.find((p) => p.tag === body.tag);
      if (!target) return { ok: true };
    }
    const remaining = players.filter((p) => p.sk !== target.sk);
    if (!remaining.length) {
      await deleteItems(items);
      return { ok: true };
    }
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: room, sk: target.sk } }));
    if (target.sk === 'P#' + meta.hostId) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: room, sk: 'META' }, UpdateExpression: 'SET hostId = :h',
        ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':h': remaining[0].sk.slice(2) }
      })).catch(() => {});
    }
    return { ok: true };
  }
};

exports.handler = async (event) => {
  const method = (event.requestContext && event.requestContext.http && event.requestContext.http.method) || 'GET';
  const urlPath = event.rawPath || '/';

  if (urlPath.startsWith('/api/')) {
    const fn = api[urlPath.slice(5)];
    if (!fn || method !== 'POST') return json(404, { error: 'Not found', code: 'nf' });
    try {
      let raw = event.body || '{}';
      if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
      if (raw.length > 4000) throw new ApiError(400, 'bad', 'Request too large.');
      let body;
      try { body = JSON.parse(raw); } catch (e) { throw new ApiError(400, 'bad', 'Bad request.'); }
      return json(200, await fn(body || {}));
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, { error: e.message, code: e.code });
      console.error(e);
      return json(500, { error: 'Something went wrong. Please try again.', code: 'err' });
    }
  }

  const file = STATIC[urlPath];
  if (!file || method !== 'GET') {
    return { statusCode: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' };
  }
  return {
    statusCode: 200,
    headers: { 'content-type': file.type, 'cache-control': file.cache },
    body: file.body,
    isBase64Encoded: file.binary
  };
};
