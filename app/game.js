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

  var BOOK_TIERS = [
    'Genesis Exodus Psalms Proverbs Matthew Mark Luke John Acts Romans Ruth Job Jonah Daniel Esther Revelation James Joshua Judges Kings',
    'Numbers Samuel Isaiah Jeremiah Ezekiel Peter Hebrews Timothy Titus Jude Joel Amos Ezra Micah Hosea Galatians Ephesians Corinthians',
    'Leviticus Deuteronomy Chronicles Nehemiah Ecclesiastes Lamentations Obadiah Nahum Habakkuk Zephaniah Haggai Zechariah Malachi Philippians Colossians Thessalonians Philemon'
  ];

  var PLACE_TIERS = [
    'Eden Egypt Israel Jericho Bethlehem Nazareth Jerusalem Babylon Galilee Jordan Sinai Canaan Rome Judea Zion',
    'Bethany Capernaum Damascus Nineveh Samaria Sodom Gomorrah Calvary Golgotha Gethsemane Corinth Ephesus Antioch Athens Cana Hebron Bethel Ararat Babel Moab Edom Goshen Tarsus Emmaus Patmos Carmel Philippi Galatia Cyprus Malta Joppa Shiloh',
    'Thessalonica Colossae Laodicea Philadelphia Smyrna Pergamum Thyatira Sardis Macedonia Caesarea Bethsaida Decapolis Gilead Bashan Beersheba Shechem Gibeon Mizpah Peniel Horeb Nebo Tarshish Haran Midian Persia Assyria Lystra Derbe Iconium Berea Troas Miletus Crete Ziklag Endor Gilgal Ramah Lebanon Tyre Sidon Zarephath Siloam Bethesda Kidron Hermon Tabor Moriah Pisgah Gaza Ashdod Ekron Gath Jezreel'
  ];

  // "Who am I?" clues: [name, clue], grouped easiest -> hardest.
  var CLUE_TIERS = [
    [
      ['Noah', 'I built an ark and filled it with animals.'],
      ['Moses', 'I led Israel out of Egypt and through the Red Sea.'],
      ['David', 'I beat a giant with a sling and a stone.'],
      ['Jonah', 'I spent three days inside a great fish.'],
      ['Daniel', 'I was thrown into a den of lions.'],
      ['Adam', 'I was the very first man.'],
      ['Eve', 'I was the first woman.'],
      ['Mary', 'An angel told me I would be the mother of Jesus.'],
      ['Samson', 'My great strength was tied to my long hair.'],
      ['Goliath', 'I was a giant Philistine warrior beaten by a shepherd boy.'],
      ['Joseph', 'My father gave me a coat of many colours.'],
      ['Abraham', 'God promised me descendants as many as the stars.'],
      ['Peter', 'I walked on water toward Jesus, then began to sink.'],
      ['Zacchaeus', 'I climbed a sycamore tree to see Jesus.'],
      ['Judas', 'I betrayed Jesus for thirty pieces of silver.'],
      ['Solomon', 'I asked God for wisdom and built the temple.']
    ],
    [
      ['Esther', 'I became queen and risked my life to save my people.'],
      ['Ruth', 'I told Naomi, "Where you go, I will go."'],
      ['Joshua', 'I led the march around Jericho until the walls fell.'],
      ['Elijah', 'I called down fire from heaven on Mount Carmel.'],
      ['Paul', 'I met Jesus in a blinding light on the road to Damascus.'],
      ['Thomas', 'I would not believe Jesus had risen until I saw His wounds.'],
      ['Lazarus', 'Jesus raised me from the dead after four days in the tomb.'],
      ['Sarah', 'I laughed when I heard I would have a son in my old age.'],
      ['Isaac', 'My father Abraham nearly sacrificed me on a mountain.'],
      ['Jacob', 'I dreamed of a stairway reaching up to heaven.'],
      ['Esau', 'I sold my birthright for a bowl of stew.'],
      ['Cain', 'I killed my brother Abel.'],
      ['Samuel', 'As a boy I heard God call my name in the night.'],
      ['Gideon', 'I defeated an army with just 300 men, trumpets and jars.'],
      ['Delilah', 'I tricked Samson into telling me the secret of his strength.'],
      ['Martha', 'I was busy serving while my sister sat at Jesus\' feet.'],
      ['Matthew', 'I was a tax collector before I followed Jesus.'],
      ['Pilate', 'I washed my hands at the trial of Jesus.'],
      ['Miriam', 'I watched over my baby brother Moses as he floated in a basket.'],
      ['Aaron', 'I was Moses\' brother and Israel\'s first high priest.'],
      ['Hannah', 'I prayed for a son and named him Samuel.'],
      ['John', 'I baptised Jesus in the Jordan River.'],
      ['Stephen', 'I was the first Christian martyr, stoned for my faith.']
    ],
    [
      ['Methuselah', 'I lived 969 years, longer than anyone else in the Bible.'],
      ['Enoch', 'I walked with God, and then God took me away.'],
      ['Rahab', 'I hid Israelite spies in Jericho and hung a scarlet cord from my window.'],
      ['Deborah', 'I was a prophetess and judge who went into battle with Barak.'],
      ['Nicodemus', 'I came to Jesus at night and heard, "You must be born again."'],
      ['Barnabas', 'My name means "son of encouragement" and I travelled with Paul.'],
      ['Naaman', 'I was healed of leprosy after dipping seven times in the Jordan.'],
      ['Elisha', 'I received a double portion of Elijah\'s spirit.'],
      ['Boaz', 'I let Ruth gather grain in my field, and later married her.'],
      ['Absalom', 'I rebelled against my father David and was caught in the branches of an oak.'],
      ['Nehemiah', 'I rebuilt the walls of Jerusalem.'],
      ['Jezebel', 'I was the wicked queen married to King Ahab.'],
      ['Lot', 'My wife looked back and became a pillar of salt.'],
      ['Caleb', 'Joshua and I were the only two spies who trusted God to give us the land.'],
      ['Bartimaeus', 'I was a blind beggar near Jericho who shouted for Jesus until He healed me.'],
      ['Philip', 'I explained the Scriptures to an Ethiopian official in his chariot.'],
      ['Silas', 'I sang hymns in prison with Paul when an earthquake shook the doors open.'],
      ['Lydia', 'I sold purple cloth and was baptised in Philippi.'],
      ['Priscilla', 'My husband Aquila and I made tents alongside Paul.'],
      ['Mordecai', 'I raised my cousin Esther and refused to bow to Haman.'],
      ['Nebuchadnezzar', 'I had three men thrown into a blazing furnace.'],
      ['Melchizedek', 'I was king of Salem and a priest who blessed Abraham.'],
      ['Jethro', 'I was Moses\' father-in-law and advised him to share his workload.'],
      ['Eutychus', 'I fell asleep during Paul\'s long sermon and fell out of a window.'],
      ['Gamaliel', 'I was a respected Pharisee who taught Paul.'],
      ['Mephibosheth', 'I was Jonathan\'s son, lame in both feet, and ate at King David\'s table.'],
      ['Onesimus', 'I was a runaway slave Paul sent back with a letter to Philemon.'],
      ['Ananias', 'God sent me to restore Saul\'s sight in Damascus.'],
      ['Balaam', 'My donkey spoke to me.'],
      ['Hezekiah', 'God added fifteen years to my life.'],
      ['Josiah', 'I became king when I was eight years old.'],
      ['Jochebed', 'I hid my baby son Moses in a basket on the Nile.'],
      ['Uriah', 'I was Bathsheba\'s husband, sent to the front line by King David.']
    ]
  ];

  // Builds a list sorted easiest -> hardest (tier first, then length).
  function ranked(tiers, isClue) {
    var out = [];
    tiers.forEach(function (list, t) {
      (isClue ? list : list.split(' ')).forEach(function (item) {
        var name = isClue ? item[0] : item;
        out.push({ name: name, clue: isClue ? item[1] : null, d: (t + 1) * 10 + (isClue ? 0 : Math.min(name.length, 14) * 0.6) });
      });
    });
    return out.sort(function (a, b) { return a.d - b.d || (a.name < b.name ? -1 : 1); });
  }

  var CATEGORIES = {
    characters: { label: 'Bible Characters', emoji: '🧔', prompt: 'Who is this?', items: ranked(TIERS) },
    books: { label: 'Books of the Bible', emoji: '📖', prompt: 'Which book of the Bible?', items: ranked(BOOK_TIERS) },
    places: { label: 'Bible Places', emoji: '🗺️', prompt: 'Which place is this?', items: ranked(PLACE_TIERS) },
    whoami: { label: 'Who Am I?', emoji: '🕵️', prompt: 'Who am I?', clue: true, items: ranked(CLUE_TIERS, true) }
  };
  var TEAMS = [
    { name: 'Lions', emoji: '🦁', color: '#ffd23f' },
    { name: 'Eagles', emoji: '🦅', color: '#2fe6de' },
    { name: 'Doves', emoji: '🕊️', color: '#ff7ab6' },
    { name: 'Lambs', emoji: '🐑', color: '#3ddc84' }
  ];
  var NAMES = CATEGORIES.characters.items;

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

  function createGame(seed, categoryId) {
    seed = String(seed);
    var cat = CATEGORIES[categoryId] || CATEGORIES.characters;
    var items = cat.items, N = items.length;
    // Roughly easiest -> hardest, with a little per-game jitter so no two games match.
    var jitter = rng(seed + '|order');
    var spread = Math.max(3, 9 * N / 171);
    var order = items.map(function (n, rank) { return { name: n.name, clue: n.clue, key: rank + jitter() * spread }; })
      .sort(function (a, b) { return a.key - b.key; });
    var names = order.map(function (n) { return n.name; });
    // How far up the ladder each question climbs: big lists skip ahead, small lists use every entry.
    var step = Math.max(1, Math.floor((N - 5) / 45));
    var cache = {};

    function question(index) {
      if (cache[index]) return cache[index];
      var rand = rng(seed + '|q' + index);
      var level = levelFor(index);
      var pos = index < 5 ? index : 5 + (index - 5) * step + Math.floor(rand() * step);
      if (pos >= N) pos = N - 1 - ((index * 7) % Math.min(40, N));
      var answer = names[pos];

      // Higher levels => more look-alike wrong answers (same length, shared letters).
      var lookalikes = cat.clue || level <= 1 ? 0 : level <= 5 ? 1 : level <= 10 ? 2 : 3;
      var others = names.filter(function (n) { return n !== answer; });
      var bySimilarity = others.map(function (n) {
        return { n: n, s: Math.abs(n.length - answer.length) * 3 - sharedLetters(n, answer) + rand() * 2 };
      }).sort(function (a, b) { return a.s - b.s; }).map(function (x) { return x.n; });

      var wrong = shuffle(bySimilarity.slice(0, 7), rand).slice(0, lookalikes);
      var reach = cat.clue ? 14 : 25;
      var nearby = shuffle(names.slice(Math.max(0, pos - reach), Math.min(N, pos + reach)), rand);
      for (var i = 0; wrong.length < 3 && i < nearby.length; i++) {
        if (nearby[i] !== answer && wrong.indexOf(nearby[i]) < 0) wrong.push(nearby[i]);
      }

      var choices = shuffle([answer].concat(wrong), rand);
      var q = { index: index, level: level, choices: choices, answer: choices.indexOf(answer) };
      if (cat.clue) q.clue = order[pos].clue;
      else q.scrambled = scramble(answer, level, rand);
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

  return { createGame: createGame, levelFor: levelFor, CATEGORIES: CATEGORIES, TEAMS: TEAMS,
    NAMES: NAMES.map(function (n) { return n.name; }), ROUND_MS: ROUND_MS, POINTS: POINTS };
});
