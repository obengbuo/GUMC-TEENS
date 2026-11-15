/* Bible Name Scramble - browser client */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'bns-session';

  var session = null;      // { room, pid, choices: [], roundStart } - this device's place in the room
  var myName = '';
  var game = null;         // question generator for this round's seed
  var round = null;        // { startAt, endAt }
  var clockOffset = 0;     // server time - device time
  var screen = 'intro';
  var pollTimer = null, tickTimer = null;
  var qIndex = 0, score = 0, streak = 0, locked = false, spectating = false;
  var sending = false, dirty = false;
  var lastCount = null, lastTickSecond = null, lastQrRoom = null;
  var lastState = null, resultsFor = null, lobbySig = '', knownTags = {};
  var CATS = BibleGame.CATEGORIES, TEAMS = BibleGame.TEAMS;
  var HOME_SUB = 'Bible characters, books, places and “Who am I?” — 120 seconds a round. Most right wins! 🏆';

  /* ---------- tiny helpers ---------- */
  function show(name) {
    screen = name;
    var all = document.querySelectorAll('.screen');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i].id === 's-' + name);
    $('mute').hidden = name === 'intro';
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function now() { return Date.now() + clockOffset; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ s: session, n: myName })); } catch (e) {} }
  function forget() { session = null; try { sessionStorage.removeItem(KEY); } catch (e) {} }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function api(path, body) {
    var sent = Date.now();
    return fetch('/api/' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) { var err = new Error(data.error || 'Something went wrong.'); err.code = data.code; throw err; }
        if (data.now) clockOffset = data.now - (sent + Date.now()) / 2;
        return data;
      });
    });
  }

  /* ---------- sound (made on the fly, no audio files) ---------- */
  var audio = null, muted = false;
  function unlockAudio() {
    if (audio) { if (audio.state === 'suspended') audio.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { try { audio = new AC(); } catch (e) {} }
  }
  function tone(freq, start, dur, type, vol) {
    if (!audio || muted) return;
    var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + start;
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var sfx = {
    right: function (n) { var b = 520 + Math.min(n, 8) * 30; tone(b, 0, 0.12); tone(b * 1.26, 0.08, 0.12); tone(b * 1.5, 0.16, 0.2); },
    wrong: function () { tone(200, 0, 0.18, 'sawtooth', 0.12); tone(150, 0.12, 0.25, 'sawtooth', 0.12); },
    beep: function () { tone(440, 0, 0.15, 'square', 0.1); },
    go: function () { tone(660, 0, 0.12, 'square', 0.1); tone(880, 0.12, 0.35, 'square', 0.1); },
    tick: function () { tone(900, 0, 0.06, 'square', 0.06); },
    join: function () { tone(700, 0, 0.1); tone(940, 0.08, 0.14); },
    end: function () { tone(520, 0, 0.2); tone(390, 0.2, 0.2); tone(260, 0.4, 0.5); },
    fanfare: function () { [523, 659, 784, 1047, 784, 1047].forEach(function (f, i) { tone(f, i * 0.13, i === 5 ? 0.6 : 0.16, 'triangle', 0.2); }); }
  };
  document.addEventListener('pointerdown', unlockAudio);
  document.addEventListener('keydown', unlockAudio);
  $('mute').onclick = function () { muted = !muted; $('mute').textContent = muted ? '🔇' : '🔊'; };

  /* ---------- intro video ---------- */
  var introDone = false;
  function endIntro() {
    if (introDone) return;
    introDone = true;
    var s = $('s-intro');
    s.classList.add('leaving');
    try { $('intro-video').pause(); } catch (e) {}
    setTimeout(function () { s.classList.remove('leaving'); goHome(); }, 550);
  }
  function playIntro() {
    var v = $('intro-video');
    v.addEventListener('ended', endIntro);
    v.addEventListener('error', endIntro);
    $('skip').onclick = endIntro;
    var p = v.play();
    if (p && p.catch) p.catch(function () { $('skip').textContent = 'Tap to start ›'; });
    setTimeout(endIntro, 12000); // never leave anyone stuck on the intro
  }

  /* ---------- home ---------- */
  var linkRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  function goHome(message) {
    stopLoops();
    forget();
    $('name').value = myName;
    $('code').value = linkRoom;
    $('btn-create').hidden = $('or').hidden = !!linkRoom;
    $('home-sub').textContent = linkRoom
      ? 'You\'re invited to game ' + linkRoom + '! Type your full name to jump in.'
      : HOME_SUB;
    $('home-err').textContent = message || '';
    setBusy(false);
    show('home');
  }
  function setBusy(b) { $('btn-join').disabled = $('btn-create').disabled = b; }
  function readName() {
    var n = $('name').value.replace(/\s+/g, ' ').trim();
    var words = n.split(' ').filter(function (w) { return w.length >= 2; });
    if (words.length < 2) { $('home-err').textContent = 'Please type your full name (first and last). 🙂'; $('name').focus(); return null; }
    return n;
  }
  function enter(path, body) {
    setBusy(true);
    $('home-err').textContent = '';
    api(path, body).then(function (res) {
      myName = body.name;
      session = { room: res.room, pid: res.pid, choices: [] };
      save();
      sfx.join();
      startPolling();
    }).catch(function (e) {
      setBusy(false);
      $('home-err').textContent = e.code ? e.message : 'No connection. Check your internet and try again.';
    });
  }
  $('name-form').onsubmit = function (ev) {
    ev.preventDefault();
    var n = readName();
    if (!n) return;
    var code = $('code').value.toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 4) { $('home-err').textContent = 'Enter the 4-letter game code, or host a new game.'; $('code').focus(); return; }
    enter('join', { name: n, room: code });
  };
  $('btn-create').onclick = function () {
    var n = readName();
    if (n) enter('create', { name: n });
  };

  /* ---------- polling ---------- */
  function stopLoops() {
    clearTimeout(pollTimer); pollTimer = null;
    clearInterval(tickTimer); tickTimer = null;
  }
  function startPolling() {
    stopLoops();
    round = null; game = null; spectating = false; lastCount = null; lastState = null; resultsFor = null; lobbySig = ''; knownTags = {};
    poll();
    tickTimer = setInterval(tick, 100);
  }
  function poll() {
    if (!session) return;
    var mine = session;
    api('state', { room: mine.room, pid: mine.pid }).then(function (st) {
      if (session !== mine) return;
      onState(st);
      var wait = st.phase === 'lobby' ? 1500 : st.phase === 'playing' ? 2500 : st.phase === 'final' ? 2000 : 1000;
      pollTimer = setTimeout(poll, wait);
    }).catch(function (e) {
      if (session !== mine) return;
      if (e.code === 'gone' || e.code === 'notin' || e.code === 'room') {
        goHome(e.code === 'notin' ? 'You were removed from that game.' : 'That game has ended.');
      } else {
        pollTimer = setTimeout(poll, 2000);
      }
    });
  }
  function onState(st) {
    lastState = st;
    if (st.phase === 'lobby') {
      // Between rounds: last round's scores are gone and everyone is back in the lobby.
      round = null; game = null;
      if (session.choices.length) { session.choices = []; save(); }
      if (screen === 'results') return; // keep showing the scoreboard until this player taps on
      return renderLobby(st);
    }
    if (!round || round.startAt !== st.startAt) {
      round = { startAt: st.startAt, endAt: st.endAt };
      game = BibleGame.createGame(st.seed, st.category);
      if (session.roundStart !== st.startAt) { session.roundStart = st.startAt; session.choices = []; save(); }
      // Rejoining after a refresh: carry on only if this device still has its answers.
      spectating = st.myAnswered > session.choices.length;
      lastCount = null;
      var cat = CATS[st.category] || CATS.characters;
      $('count-cat').textContent = cat.emoji + ' ' + cat.label;
      $('prompt').textContent = cat.prompt;
    }
    if (st.phase === 'playing') renderRank(st.players);
    if (st.phase === 'final' && resultsFor !== round.startAt) return renderResults(st);
    tick();
  }

  // Runs 10x a second: moves everyone through countdown -> play -> time's up together.
  function tick() {
    if (!round) return;
    var t = now();
    if (t < round.startAt) {
      if (screen !== 'count') { stopConfetti(); show('count'); }
      var n = Math.min(3, Math.ceil((round.startAt - t) / 1000));
      if (n !== lastCount) {
        lastCount = n;
        var c = $('count-num');
        c.textContent = n;
        c.classList.remove('tick'); void c.offsetWidth; c.classList.add('tick');
        sfx.beep();
      }
    } else if (t < round.endAt) {
      if (spectating) { showTally('You\'re already in this round — hang tight for the scores!'); return; }
      if (screen !== 'game') beginGame();
      var left = Math.max(0, round.endAt - t);
      var secs = Math.ceil(left / 1000);
      $('hud-time').textContent = secs;
      $('hud-time').classList.toggle('hurry', secs <= 10);
      $('bar-fill').style.transform = 'scaleX(' + (left / (round.endAt - round.startAt)) + ')';
      if (secs <= 10 && secs !== lastTickSecond) { lastTickSecond = secs; sfx.tick(); }
    } else if (screen !== 'tally' && screen !== 'results' && resultsFor !== round.startAt) {
      sfx.end();
      showTally('Counting everyone\'s points…');
      sendAnswers();
    }
  }
  function showTally(text) {
    document.querySelector('#s-tally .sub').textContent = text;
    if (screen !== 'tally') show('tally');
  }

  /* ---------- lobby ---------- */
  function renderLobby(st) {
    if (screen !== 'lobby') show('lobby');
    $('room-code').textContent = st.room;
    var link = location.origin + '/?room=' + st.room;
    if (lastQrRoom !== st.room) {
      lastQrRoom = st.room;
      $('copy-link').textContent = link.replace(/^https?:\/\//, '');
      $('copy-link').onclick = function () {
        if (navigator.share) navigator.share({ title: 'Bible Name Scramble', text: 'Join my game! Code: ' + st.room, url: link }).catch(function () {});
        else if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast('Link copied! 📋'); });
      };
      try {
        var qr = qrcode(0, 'M');
        qr.addData(link); qr.make();
        $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch (e) { $('qr').hidden = true; }
    }
    renderSettings(st);
    // Redraw the roster only when something actually changed, so names don't flicker.
    var sig = JSON.stringify([st.hostIsMe, st.mode, st.teamCount, st.players.map(function (p) { return [p.tag, p.team, p.host, p.away]; })]);
    var n = st.players.length;
    if (sig !== lobbySig) {
      var joined = st.players.some(function (p) { return !knownTags[p.tag]; });
      if (lobbySig && joined) sfx.join();
      lobbySig = sig;
      var box = $('lobby-players');
      box.textContent = '';
      var pill = function (p) {
        var li = el('li', (p.me ? 'me' : '') + (p.away ? ' away' : '') + (knownTags[p.tag] ? '' : ' new'),
          (p.host ? '👑 ' : '') + p.name + (p.me ? ' (you)' : '') + (p.away ? ' 💤' : ''));
        knownTags[p.tag] = true;
        if (st.hostIsMe && !p.me) {
          var k = el('button', 'kick', '✕');
          k.setAttribute('aria-label', 'Remove ' + p.name);
          k.onclick = function () { api('leave', { room: session.room, pid: session.pid, tag: p.tag }).catch(function () {}); li.remove(); };
          li.appendChild(k);
        }
        return li;
      };
      if (st.mode === 'teams') {
        var me = st.players.filter(function (p) { return p.me; })[0];
        for (var t = 0; t < st.teamCount; t++) (function (t) {
          var members = st.players.filter(function (p) { return p.team === t; });
          var sec = el('div', 'team');
          sec.style.setProperty('--tc', TEAMS[t].color);
          var head = el('div', 'team-head');
          head.appendChild(el('span', '', TEAMS[t].emoji + ' ' + TEAMS[t].name));
          head.appendChild(el('span', 'n', members.length + (members.length === 1 ? ' player' : ' players')));
          if (me && me.team === t) head.appendChild(el('span', 'mine', 'Your team'));
          else {
            var j = el('button', '', 'Join');
            j.onclick = function () { api('team', { room: session.room, pid: session.pid, team: t }).then(repoll).catch(function (e) { toast(e.message); }); };
            head.appendChild(j);
          }
          sec.appendChild(head);
          var ul = el('ul', 'players');
          members.forEach(function (p) { ul.appendChild(pill(p)); });
          sec.appendChild(ul);
          box.appendChild(sec);
        })(t);
      } else {
        var list = el('ul', 'players');
        st.players.forEach(function (p) { list.appendChild(pill(p)); });
        box.appendChild(list);
      }
    }
    $('lobby-count').textContent = n + (n === 1 ? ' player' : ' players') + ' in';
    $('btn-start').hidden = !st.hostIsMe;
    $('lobby-status').textContent = st.hostIsMe
      ? 'You\'re the host 👑 Pick the game, then press start once everyone has joined'
      : 'Waiting for the host to start the game';
  }
  function repoll() { clearTimeout(pollTimer); poll(); }
  // Host sees the controls; everyone else sees what the host picked.
  function renderSettings(st) {
    var cat = CATS[st.category] || CATS.characters;
    $('settings').hidden = !st.hostIsMe;
    $('lobby-summary').hidden = st.hostIsMe;
    $('lobby-summary').textContent = cat.emoji + ' ' + cat.label + '  ·  ' +
      (st.mode === 'teams' ? '🤝 ' + st.teamCount + ' teams' : '🙋 Individuals');
    var catBox = $('set-cat');
    if (!catBox.children.length) {
      Object.keys(CATS).forEach(function (id) {
        var b = el('button', '', CATS[id].emoji + ' ' + CATS[id].label);
        b.type = 'button';
        b.dataset.cat = id;
        b.onclick = function () { configure({ category: id }); };
        catBox.appendChild(b);
      });
      Array.prototype.forEach.call($('set-mode').children, function (b) { b.onclick = function () { configure({ mode: b.dataset.mode }); }; });
      Array.prototype.forEach.call($('set-count').children, function (b) { b.onclick = function () { configure({ teamCount: Number(b.dataset.count) }); }; });
    }
    Array.prototype.forEach.call(catBox.children, function (b) { b.classList.toggle('on', b.dataset.cat === st.category); });
    Array.prototype.forEach.call($('set-mode').children, function (b) { b.classList.toggle('on', b.dataset.mode === st.mode); });
    Array.prototype.forEach.call($('set-count').children, function (b) { b.classList.toggle('on', Number(b.dataset.count) === st.teamCount); });
    $('set-count-wrap').hidden = st.mode !== 'teams';
  }
  function configure(change) {
    if (!session) return;
    api('config', { room: session.room, pid: session.pid, category: change.category, mode: change.mode, teamCount: change.teamCount })
      .then(repoll).catch(function (e) { toast(e.message); });
  }
  $('btn-start').onclick = function () {
    $('btn-start').disabled = true;
    api('start', { room: session.room, pid: session.pid }).then(function () {
      clearTimeout(pollTimer); poll();
    }).catch(function (e) { toast(e.message); }).then(function () { $('btn-start').disabled = false; });
  };
  $('btn-leave').onclick = function () {
    var s = session;
    if (s) api('leave', { room: s.room, pid: s.pid }).catch(function () {});
    goHome();
  };

  /* ---------- the game ---------- */
  var CHEERS = ['Nice!', 'Yes!', 'Boom!', 'Amen!', 'Sharp!', 'Got it!', 'Wow!', 'On fire!'];
  function beginGame() {
    qIndex = session.choices.length;
    var s = game.score(session.choices);
    score = s.score;
    streak = 0; locked = false; lastTickSecond = null;
    $('hud-score').textContent = score;
    $('chip-streak').hidden = true;
    show('game');
    sfx.go();
    renderQuestion();
  }
  function renderQuestion() {
    var q = game.question(qIndex);
    locked = false;
    $('hud-level').textContent = q.level;
    var tiles = $('tiles');
    tiles.textContent = '';
    if (q.clue) {
      tiles.appendChild(el('div', 'clue', q.clue));
      tiles.removeAttribute('aria-label');
    } else {
      tiles.style.setProperty('--n', q.scrambled.length);
      q.scrambled.split('').forEach(function (ch, i) {
        var t = el('span', 'tile', ch);
        t.style.animationDelay = (i * 35) + 'ms';
        tiles.appendChild(t);
      });
      tiles.setAttribute('aria-label', q.scrambled.split('').join(' '));
    }
    var box = $('choices');
    box.textContent = '';
    q.choices.forEach(function (name, i) {
      var b = el('button', 'choice', name);
      b.style.animationDelay = (120 + i * 50) + 'ms';
      b.onclick = function () { pick(q, i); };
      box.appendChild(b);
    });
  }
  function pick(q, i) {
    if (locked || now() >= round.endAt) return;
    locked = true;
    var ok = i === q.answer;
    var btns = $('choices').children;
    for (var k = 0; k < btns.length; k++) {
      if (k === q.answer) btns[k].classList.add('right');
      else if (k === i) btns[k].classList.add('wrong');
      else btns[k].classList.add('dim');
    }
    session.choices.push(i);
    save();
    sendAnswers();
    var cheer = $('cheer');
    cheer.classList.remove('show', 'good', 'bad');
    void cheer.offsetWidth;
    if (ok) {
      streak++;
      score += BibleGame.POINTS;
      var sc = $('hud-score');
      sc.textContent = score;
      sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
      cheer.textContent = '+' + BibleGame.POINTS + ' ' + CHEERS[Math.floor(Math.random() * CHEERS.length)];
      cheer.classList.add('show', 'good');
      sfx.right(streak);
      if (navigator.vibrate) navigator.vibrate(30);
    } else {
      streak = 0;
      cheer.textContent = 'It was ' + q.choices[q.answer];
      cheer.classList.add('show', 'bad');
      sfx.wrong();
      if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
    }
    var chip = $('chip-streak');
    chip.hidden = streak < 3;
    chip.textContent = '🔥 ' + streak + ' in a row';
    setTimeout(function () {
      if (screen !== 'game') return;
      qIndex++;
      renderQuestion();
    }, ok ? 420 : 900);
  }
  // Always sends the full list of picks, so a dropped request can never lose points.
  function sendAnswers() {
    if (!session || !session.choices.length) return;
    if (sending) { dirty = true; return; }
    sending = true; dirty = false;
    var mine = session;
    api('answer', { room: mine.room, pid: mine.pid, choices: mine.choices }).then(function () {
      sending = false;
      if (dirty && session === mine) sendAnswers();
    }).catch(function (e) {
      sending = false;
      if (session === mine && !e.code) setTimeout(sendAnswers, 700);
    });
  }
  function renderRank(players) {
    var me = players.filter(function (p) { return p.me; })[0];
    var chip = $('chip-rank');
    if (!me || players.length < 2) { chip.hidden = true; return; }
    var mine = Math.max(me.score, score);
    var ahead = players.filter(function (p) { return !p.me && p.score > mine; }).length;
    chip.hidden = false;
    chip.textContent = (lastState && lastState.mode === 'teams' ? TEAMS[me.team].emoji + ' ' : ahead === 0 ? '🥇 ' : '') + '#' + (ahead + 1) + ' of ' + players.length;
  }

  /* ---------- results ---------- */
  function renderResults(st) {
    var mine = session;
    var teams = st.mode === 'teams';
    resultsFor = round.startAt;
    var players = st.players.slice().sort(function (a, b) { return b.score - a.score || a.answered - b.answered; });
    var rank = 0;
    players.forEach(function (p, i) { if (i === 0 || p.score < players[i - 1].score) rank = i + 1; p.rank = rank; });
    var me = players.filter(function (p) { return p.me; })[0];
    var medals = ['🥇', '🥈', '🥉'];
    var title = me && me.rank === 1 ? '🏆 You won!' : 'Final Scores';
    var line = me ? 'You finished #' + me.rank + ' of ' + players.length + ' with ' + me.score + ' points (' + me.correct + ' right).' : '';

    // Team standings: ranked by average points per player, so uneven teams stay fair.
    var board = $('team-board');
    board.hidden = !teams;
    board.textContent = '';
    if (teams) {
      var table = [];
      for (var t = 0; t < st.teamCount; t++) {
        var members = players.filter(function (p) { return p.team === t; });
        if (!members.length) continue;
        var active = members.filter(function (p) { return p.answered > 0; });
        if (!active.length) active = members;
        var total = members.reduce(function (sum, p) { return sum + p.score; }, 0);
        table.push({ t: t, size: members.length, total: total, avg: Math.round(total / active.length * 10) / 10 });
      }
      table.sort(function (a, b) { return b.avg - a.avg || b.total - a.total; });
      table.forEach(function (row, i) { row.rank = i > 0 && row.avg === table[i - 1].avg ? table[i - 1].rank : i + 1; });
      table.forEach(function (row, i) {
        var r = el('div', 'team-row' + (row.rank > 1 ? ' lost' : ''));
        r.style.setProperty('--tc', TEAMS[row.t].color);
        r.style.animationDelay = (i * 120) + 'ms';
        r.appendChild(el('span', 'temoji', row.rank <= 3 ? medals[row.rank - 1] : String(row.rank)));
        var name = el('span', 'tname', TEAMS[row.t].emoji + ' ' + TEAMS[row.t].name);
        name.appendChild(el('small', '', row.size + (row.size === 1 ? ' player' : ' players') + ' · ' + row.total + ' points in total'));
        r.appendChild(name);
        var sc = el('span', 'tscore', String(row.avg));
        sc.appendChild(el('small', '', 'avg per player'));
        r.appendChild(sc);
        board.appendChild(r);
      });
      var winners = table.filter(function (row) { return row.rank === 1; });
      var myRow = me && table.filter(function (row) { return row.t === me.team; })[0];
      title = winners.length > 1 ? '🤝 It\'s a tie!' : '🏆 ' + TEAMS[winners[0].t].emoji + ' ' + TEAMS[winners[0].t].name + ' win!';
      if (myRow) line = 'Your team came #' + myRow.rank + ' of ' + table.length + '. ' + line;
    }
    $('res-title').textContent = title;
    $('res-me').textContent = line;

    var podium = $('podium');
    podium.textContent = '';
    [1, 0, 2].forEach(function (i) {
      var p = players[i];
      if (!p) return;
      var d = el('div', 'pod p' + (i + 1));
      d.appendChild(el('div', 'medal', medals[i]));
      d.appendChild(el('div', 'pname', (teams ? TEAMS[p.team].emoji + ' ' : '') + p.name));
      var block = el('div', 'block', String(p.score));
      block.appendChild(el('small', '', 'points'));
      d.appendChild(block);
      podium.appendChild(d);
    });
    var list = $('res-list');
    list.textContent = '';
    players.forEach(function (p, i) {
      var li = el('li', p.me ? 'me' : '');
      li.style.animationDelay = Math.min(i * 60, 1500) + 'ms';
      li.appendChild(el('span', 'rank', p.rank <= 3 ? medals[p.rank - 1] : String(p.rank)));
      li.appendChild(el('span', 'rname', (teams ? TEAMS[p.team].emoji + ' ' : '') + p.name + (p.me ? ' (you)' : '')));
      li.appendChild(el('span', 'rmeta', p.correct + '/' + p.answered + ' right'));
      li.appendChild(el('span', 'rscore', String(p.score)));
      list.appendChild(li);
    });
    show('results');
    $('s-results').scrollTop = 0;
    sfx.fanfare();
    confetti();
    // Tell the server we have the scores; once every player has, they are erased.
    api('seen', { room: mine.room, pid: mine.pid }).catch(function () {});
  }
  // Same players, new round: back to the lobby (or straight into the round if it already started).
  $('btn-again').onclick = function () {
    stopConfetti();
    if (lastState && lastState.phase === 'lobby') { lobbySig = ''; renderLobby(lastState); }
    else showTally('Setting up the next round…');
  };
  $('btn-quit').onclick = function () {
    var s = session;
    if (s) api('leave', { room: s.room, pid: s.pid }).catch(function () {});
    linkRoom = ''; history.replaceState(null, '', '/');
    stopConfetti();
    goHome();
  };

  var confettiRun = 0;
  function stopConfetti() { confettiRun++; var c = $('confetti'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
  function confetti() {
    var c = $('confetti'), ctx = c.getContext('2d');
    var w = c.width = innerWidth, h = c.height = innerHeight;
    var colors = ['#ffd23f', '#ff4f9a', '#2fe6de', '#3ddc84', '#8b5cf6', '#ffffff'];
    var bits = [];
    for (var i = 0; i < 160; i++) {
      bits.push({ x: Math.random() * w, y: -20 - Math.random() * h * 0.6, r: 5 + Math.random() * 7, c: colors[i % colors.length],
        vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 4, a: Math.random() * 6, va: -0.2 + Math.random() * 0.4 });
    }
    var began = Date.now(), run = ++confettiRun;
    (function frame() {
      if (run !== confettiRun) return;
      ctx.clearRect(0, 0, w, h);
      if (Date.now() - began > 6000 || screen !== 'results') return;
      bits.forEach(function (b) {
        b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
        ctx.fillStyle = b.c; ctx.fillRect(-b.r / 2, -b.r / 3, b.r, b.r * 0.66);
        ctx.restore();
      });
      requestAnimationFrame(frame);
    })();
  }

  /* ---------- boot ---------- */
  var stored = null;
  try { stored = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (stored && stored.s && stored.s.room && stored.s.pid) {
    // Refreshed mid-game: skip the intro and drop straight back in.
    introDone = true;
    session = stored.s;
    session.choices = session.choices || [];
    myName = stored.n || '';
    show('tally');
    document.querySelector('#s-tally .sub').textContent = 'Getting you back in…';
    startPolling();
  } else {
    playIntro();
  }
})();
