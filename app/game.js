/* Shared game engine: runs in the browser (instant feedback) and in Lambda (score checking).
   Given the same seed, every player in a room gets exactly the same questions. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BibleGame = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ROUND_MS = 120000;
  var POINTS = 5;

  // Tier 1 = names every teen knows ... tier 4 = deep cuts.
  var TIERS = [
    'Adam Eve Noah Mary Paul John Ruth Mark Luke Moses David Peter Jesus Sarah Jonah Jacob James Esther Daniel Joseph Samson Abraham Isaac Goliath',
    'Aaron Elijah Joshua Samuel Solomon Matthew Martha Thomas Andrew Rachel Rebekah Miriam Gideon Isaiah Joel Amos Cain Abel Esau Leah Saul Job Lot Hannah Naomi Philip Timothy Stephen Lazarus Judas Pilate Herod Elisha Jeremiah Ezekiel Benjamin Delilah Lydia Titus Simon',
    'Nehemiah Zacchaeus Nicodemus Barnabas Silas Priscilla Aquila Deborah Jezebel Ahab Absalom Jonathan Nathan Caleb Boaz Rahab Enoch Methuselah Reuben Levi Judah Hezekiah Josiah Ezra Hosea Micah Malachi Zechariah Elizabeth Gabriel Michael Bartholomew Thaddaeus Cornelius Barabbas Caiaphas Ishmael Hagar Laban Dinah Tabitha Dorcas Phoebe Apollos Philemon Eli Seth Shem Japheth Naaman Mordecai Haman Uriah Bathsheba Abigail Obadiah Nahum Haggai Habakkuk Zephaniah',
    'Jehoshaphat Rehoboam Jeroboam Melchizedek Nebuchadnezzar Belshazzar Shadrach Meshach Abednego Zerubbabel Mephibosheth Ahasuerus Bartimaeus Onesimus Epaphroditus Tychicus Eutychus Ananias Sapphira Gamaliel Jochebed Zipporah Jethro Potiphar Issachar Zebulun Naphtali Manasseh Ephraim Athaliah Sennacherib Archippus Trophimus Sosthenes Demetrius Zelophehad Ahithophel Abimelech Elimelech Ichabod Keturah Artaxerxes Zedekiah Jehoiakim Hilkiah Shealtiel Quirinius'
  ];

  // Sorted easiest -> hardest (tier first, then length).
  var NAMES = [];
  TIERS.forEach(function (list, t) {
    list.split(' ').forEach(function (n) {
      NAMES.push({ name: n, d: (t + 1) * 10 + Math.min(n.length, 14) * 0.6 });
    });
  });
  NAMES.sort(function (a, b) { return a.d - b.d || (a.name < b.name ? -1 : 1); });

  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seedStr) {
    var a = hash(seedStr);
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // Questions 1-5 are level 1; from question 6 the level goes up by one every question.
  function levelFor(index) {
    return index < 5 ? 1 : index - 3;
  }

  function sharedLetters(a, b) {
    var counts = {}, n = 0, i;
    a = a.toLowerCase(); b = b.toLowerCase();
    for (i = 0; i < a.length; i++) counts[a[i]] = (counts[a[i]] || 0) + 1;
    for (i = 0; i < b.length; i++) if (counts[b[i]] > 0) { counts[b[i]]--; n++; }
    return n;
  }

  function scramble(name, level, rand) {
    var letters = name.toUpperCase().split('');
    var out, tries = 0;
    do {
      if (level === 1 && letters.length > 3) {
        // Warm-up hint: the first letter stays where it belongs.
        out = [letters[0]].concat(shuffle(letters.slice(1), rand));
      } else {
        out = shuffle(letters, rand);
      }
      tries++;
    } while (tries < 40 && (out.join('') === letters.join('') ||
      (level >= 8 && letters.length > 3 && out[0] === letters[0])));
    return out.join('');
  }

  function createGame(seed) {
    seed = String(seed);
    // Roughly easiest -> hardest, with a little per-game jitter so no two games match.
    var jitter = rng(seed + '|order');
    var order = NAMES.map(function (n, rank) { return { name: n.name, key: rank + jitter() * 9 }; })
      .sort(function (a, b) { return a.key - b.key; })
      .map(function (n) { return n.name; });
    var cache = {};

    function question(index) {
      if (cache[index]) return cache[index];
      var rand = rng(seed + '|q' + index);
      var level = levelFor(index);
      // Warm-up walks the easiest names; after that each question jumps ~3 names up the ladder.
      var pos = index < 5 ? index : 5 + (index - 5) * 3 + Math.floor(rand() * 3);
      if (pos >= order.length) pos = order.length - 1 - ((index * 7) % 40);
      var answer = order[pos];

      // Higher levels => more look-alike wrong answers (same length, shared letters).
      var lookalikes = level <= 1 ? 0 : level <= 5 ? 1 : level <= 10 ? 2 : 3;
      var others = order.filter(function (n) { return n !== answer; });
      var bySimilarity = others.map(function (n) {
        return { n: n, s: Math.abs(n.length - answer.length) * 3 - sharedLetters(n, answer) + rand() * 2 };
      }).sort(function (a, b) { return a.s - b.s; }).map(function (x) { return x.n; });

      var wrong = shuffle(bySimilarity.slice(0, 7), rand).slice(0, lookalikes);
      var lo = Math.max(0, pos - 25), hi = Math.min(order.length, pos + 25);
      var nearby = shuffle(order.slice(lo, hi), rand);
      for (var i = 0; wrong.length < 3 && i < nearby.length; i++) {
        if (nearby[i] !== answer && wrong.indexOf(nearby[i]) < 0) wrong.push(nearby[i]);
      }

      var choices = shuffle([answer].concat(wrong), rand);
      var q = {
        index: index,
        level: level,
        scrambled: scramble(answer, level, rand),
        choices: choices,
        answer: choices.indexOf(answer)
      };
      cache[index] = q;
      return q;
    }

    // choices: array of picked option indexes, one per question in order.
    function score(choices) {
      var correct = 0;
      for (var i = 0; i < choices.length; i++) if (question(i).answer === choices[i]) correct++;
      return { answered: choices.length, correct: correct, score: correct * POINTS };
    }

    return { question: question, score: score };
  }

  return { createGame: createGame, levelFor: levelFor, NAMES: NAMES.map(function (n) { return n.name; }), ROUND_MS: ROUND_MS, POINTS: POINTS };
});
