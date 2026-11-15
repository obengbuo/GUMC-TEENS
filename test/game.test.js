'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Game = require('../app/game.js');

test('no duplicate or anagram names (every scramble has exactly one answer)', () => {
  const seen = new Map();
  for (const n of Game.NAMES) {
    const key = n.toLowerCase().split('').sort().join('');
    assert.ok(!seen.has(key), n + ' clashes with ' + seen.get(key));
    seen.set(key, n);
  }
});

test('level stays at 1 for five questions, then rises by one each question', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 20].map(Game.levelFor), [1, 1, 1, 1, 1, 2, 3, 4, 17]);
});

test('questions are valid, deterministic per seed, and differ between seeds', () => {
  const a = Game.createGame('seed-1'), b = Game.createGame('seed-1'), c = Game.createGame('seed-2');
  let differs = false;
  const used = new Set();
  for (let i = 0; i < 120; i++) {
    const q = a.question(i);
    assert.deepStrictEqual(q, b.question(i));
    if (q.scrambled !== c.question(i).scrambled) differs = true;
    assert.strictEqual(q.choices.length, 4);
    assert.strictEqual(new Set(q.choices).size, 4);
    const answer = q.choices[q.answer];
    assert.notStrictEqual(q.scrambled, answer.toUpperCase());
    assert.strictEqual(q.scrambled.split('').sort().join(''), answer.toUpperCase().split('').sort().join(''));
    if (i < 55) { assert.ok(!used.has(answer), 'repeat within a normal game: ' + answer); used.add(answer); }
  }
  assert.ok(differs);
});

test('names get longer/harder as the game goes on', () => {
  const g = Game.createGame('ramp');
  const rank = (i) => Game.NAMES.indexOf(g.question(i).choices[g.question(i).answer]);
  const avg = (from, to) => { let s = 0; for (let i = from; i < to; i++) s += rank(i); return s / (to - from); };
  assert.ok(avg(0, 5) < avg(10, 15) && avg(10, 15) < avg(25, 30) && avg(25, 30) < avg(45, 50));
});

test('scoring: 5 points per correct answer, nothing deducted for wrong ones', () => {
  const g = Game.createGame('score');
  const picks = [0, 1, 2, 3, 4, 5].map((i) => (i % 2 ? g.question(i).answer : (g.question(i).answer + 1) % 4));
  assert.deepStrictEqual(g.score(picks), { answered: 6, correct: 3, score: 15 });
});
