'use strict';
const Q = window.QUESTIONS;
const SHAPES = ['▲', '◆', '●', '■'];
const LETTERS = ['A', 'B', 'C', 'D'];
const COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => document.getElementById('app');
const render = html => { app().innerHTML = html; };
let store = null;
let cleanup = [];
function onClean(f) { cleanup.push(f); }
function clean() { cleanup.forEach(f => { try { f(); } catch (e) { } }); cleanup = []; }
function sub(p, cb) { onClean(store.onValue(p, cb)); }
function every(ms, fn) { const t = setInterval(fn, ms); onClean(() => clearInterval(t)); fn(); }
function base() { return location.origin + location.pathname + (/[?&]local=1/.test(location.search) ? "?local=1" : ""); }
function joinUrl(pin) { return base() + '#/play/' + pin; }
function go(h) { location.hash = h; }
function pts(elapsedMs, durMs) { const e = Math.min(Math.max(elapsedMs, 0), durMs); return Math.round(1000 * (1 - (e / durMs) / 2)); }
function count(o) { return o ? Object.keys(o).length : 0; }
function fmtTime(ms) { return Math.max(0, Math.ceil(ms / 1000)); }
function sorted(players) {
  return Object.entries(players || {}).map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (a.totalTime || 0) - (b.totalTime || 0) || (a.joinedAt || 0) - (b.joinedAt || 0));
}
function boom(opts) { if (window.confetti) confetti(Object.assign({ particleCount: 120, spread: 80, origin: { y: .6 } }, opts || {})); }

/* ---------------- routing ---------------- */
function route() {
  clean();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!store) return renderSetup();
  if (parts[0] === 'host') return parts[1] ? hostGame(parts[1]) : hostNew();
  if (parts[0] === 'play') return playJoin(parts[1] || '');
  renderHome();
}

function renderHome() {
  render(`<div class="screen center">
    <h1 class="brand">VR Journey Through Europe 🌍<small>Квиз во живо</small></h1>
    <div class="home-actions">
      <button class="btn accent" onclick="go('#/play')">Приклучи се како играч</button>
      <button class="btn ghost" onclick="go('#/host')">Јас сум водител (голем екран)</button>
    </div>
    ${store.kind === 'local' ? '<p class="muted" style="margin-top:30px">Локален режим за тестирање: работи само во овој прелистувач.</p>' : ''}
  </div>`);
}

function renderSetup() {
  render(`<div class="screen center">
    <h1 class="brand">VR Journey Through Europe 🌍<small>Квиз во живо</small></h1>
    <div class="setup" style="margin-top:24px">
      <h2>Потребно е поврзување со Firebase</h2>
      <p>Апликацијата е објавена, но уште не е поврзана со базата во живо. Внеси ги податоците од Firebase во <code>firebase-config.js</code> (упатство во README.md), или отвори ја страницата со <code>?local=1</code> за тестирање во еден прелистувач.</p>
    </div>
  </div>`);
}

/* ---------------- host ---------------- */
function hostNew() {
  render(`<div class="screen center">
    <h1 class="brand">VR Journey Through Europe 🌍<small>Панел за водител</small></h1>
    <div class="card" style="margin-top:24px">
      <h2>Нова игра</h2>
      <p class="muted" style="color:#6b6480">${Q.length} прашања · учениците се приклучуваат со PIN или QR код</p>
      <p class="err" id="err"></p>
      <button class="btn accent" id="create">Создади игра</button>
    </div>
    <p style="margin-top:20px"><a class="link" href="#/">← Назад</a></p>
  </div>`);
  document.getElementById('create').onclick = async () => {
    const b = document.getElementById('create'); b.disabled = true;
    try {
      let pin;
      for (let i = 0; i < 20; i++) {
        pin = String(Math.floor(100000 + Math.random() * 900000));
        if (!(await store.get(`games/${pin}/public`))) break;
      }
      const hostId = 'h' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('vrquiz_host_' + pin, hostId);
      await store.set(`games/${pin}`, {
        hostId, createdAt: store.serverTimestamp(),
        public: { state: 'lobby', qIndex: 0, duration: 20, showText: true, total: Q.length }
      });
      go('#/host/' + pin);
    } catch (e) { console.error(e); document.getElementById('err').textContent = 'Грешка при создавање: ' + e.message; b.disabled = false; }
  };
}

function hostGame(pin) {
  let g = null, viewKey = null, ending = false, endTimer = null;
  const P = `games/${pin}`;
  render(`<div class="screen center"><p class="muted">Се поврзува…</p></div>`);
  sub(P, async game => {
    if (!game || !game.public) { render(`<div class="screen center"><div class="card"><h2>Играта не постои</h2><p class="err"></p><button class="btn" onclick="go('#/host')">Нова игра</button></div></div>`); return; }
    g = game;
    const myHost = localStorage.getItem('vrquiz_host_' + pin);
    if (myHost !== g.hostId) { renderTakeover(); return; }
    const key = g.public.state + ':' + g.public.qIndex;
    if (key !== viewKey) { viewKey = key; ending = false; clearTimeout(endTimer); fullRender(); }
    patch();
  });

  function renderTakeover() {
    if (viewKey === 'takeover') return; viewKey = 'takeover';
    render(`<div class="screen center"><div class="card"><h2>Овој уред не е водител</h2>
      <p style="color:#6b6480">Играта ${esc(pin)} е создадена од друг уред. Можеш да ја преземеш контролата (само еден уред смее да биде водител).</p>
      <button class="btn" id="take">Преземи контрола</button></div></div>`);
    document.getElementById('take').onclick = async () => {
      const hostId = 'h' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('vrquiz_host_' + pin, hostId);
      viewKey = null;
      await store.set(`${P}/hostId`, hostId);
    };
  }

  function fullRender() {
    const s = g.public.state, qi = g.public.qIndex, q = Q[qi];
    if (s === 'lobby') {
      render(`<div class="screen">
        <div class="topbar"><h1 class="brand" style="font-size:24px">VR Journey Through Europe 🌍</h1><span class="pill">Лоби</span></div>
        <div class="lobby">
          <div class="joinbox">
            <div class="lbl">Отвори</div>
            <div class="url">${esc(joinUrl(pin).replace(/^https?:\/\//, ''))}</div>
            <div id="qr"></div>
            <div class="lbl">PIN за игра</div>
            <div class="pin">${esc(pin)}</div>
          </div>
          <div class="players-wrap">
            <h3>Играчи: <span id="pcount">0</span></h3>
            <div class="players" id="players"></div>
            <p class="muted" style="font-size:14px">Клик на име за да отстраниш играч.</p>
            <div class="settings">
              <label>Време по прашање
                <select id="dur">${[10, 15, 20, 30, 45].map(d => `<option value="${d}" ${d === g.public.duration ? 'selected' : ''}>${d} сек</option>`).join('')}</select>
              </label>
              <label><input type="checkbox" id="showText" ${g.public.showText ? 'checked' : ''}> Текст на одговорите и на телефоните</label>
            </div>
          </div>
        </div>
        <div class="footer-actions"><button class="btn accent sm" id="start" disabled style="font-size:20px;padding:14px 34px">Старт ▶</button></div>
      </div>`);
      try { new QRCode(document.getElementById('qr'), { text: joinUrl(pin), width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { }
      document.getElementById('dur').onchange = e => store.set(`${P}/public/duration`, Number(e.target.value));
      document.getElementById('showText').onchange = e => store.set(`${P}/public/showText`, e.target.checked);
      document.getElementById('start').onclick = () => startQuestion(0);
      document.getElementById('players').onclick = async e => {
        const el = e.target.closest('.player'); if (!el) return;
        if (confirm(`Отстрани „${el.textContent}“ од играта?`)) await store.set(`${P}/players/${el.dataset.id}`, null);
      };
    }
    if (s === 'question') {
      render(`<div class="screen">
        <div class="qhead"><span class="pill">Прашање ${qi + 1} / ${Q.length}</span><span class="pill">PIN ${esc(pin)}</span></div>
        <div class="qtext">${esc(q.q)}</div>
        <div class="qmid">
          <div class="timer" id="timer"><span>${g.public.duration}</span></div>
          <div class="answered"><b id="acount">0</b>одговориле</div>
        </div>
        <div class="answers">${q.a.map((a, i) => `<div class="ans c${i}"><span class="shape">${SHAPES[i]}</span><span>${esc(a)}</span></div>`).join('')}</div>
        <div class="footer-actions"><button class="btn ghost sm" id="endq">Прекини прашање ⏭</button></div>
      </div>`);
      document.getElementById('endq').onclick = () => endQuestion();
    }
    if (s === 'reveal') {
      const counts = g.public.counts || [0, 0, 0, 0]; const max = Math.max(1, ...counts);
      render(`<div class="screen">
        <div class="qhead"><span class="pill">Прашање ${qi + 1} / ${Q.length}</span><span class="pill">Резултат</span></div>
        <div class="qtext">${esc(q.q)}</div>
        ${q.note ? `<div class="note">🎉 ${esc(q.note)}</div>` : ''}
        <div class="bars">${counts.map((c, i) => `<div class="bar"><b>${c}</b><i style="background:${COLORS[i]};height:4px" data-h="${Math.round(c / max * 100)}"></i><span class="shape">${SHAPES[i]}</span></div>`).join('')}</div>
        <div class="answers">${q.a.map((a, i) => { const ok = q.correct.includes(i); return `<div class="ans c${i} ${ok ? '' : 'dim'}"><span class="shape">${SHAPES[i]}</span><span>${esc(a)}</span>${ok ? '<span class="mark">✔</span>' : ''}</div>`; }).join('')}</div>
        <div class="footer-actions"><button class="btn accent sm" id="next" style="font-size:18px">Табела 🏆</button></div>
      </div>`);
      requestAnimationFrame(() => setTimeout(() => document.querySelectorAll('.bar i').forEach(el => el.style.height = Math.max(3, el.dataset.h) + '%'), 50));
      document.getElementById('next').onclick = () => store.set(`${P}/public/state`, 'scoreboard');
    }
    if (s === 'scoreboard') {
      const list = sorted(g.players).slice(0, 5); const last = qi >= Q.length - 1;
      render(`<div class="screen">
        <div class="qhead"><span class="pill">Табела по прашање ${qi + 1}</span><span class="pill">PIN ${esc(pin)}</span></div>
        <div class="board">${list.map((p, i) => `<div class="brow" style="animation-delay:${i * .12}s"><span class="rk">${i + 1}</span><span class="nm">${esc(p.name)}</span>${p.lastPoints ? `<span class="dl">+${p.lastPoints}</span>` : ''}<span class="sc">${p.score || 0}</span></div>`).join('') || '<p class="muted" style="text-align:center">Нема играчи</p>'}</div>
        <div class="footer-actions"><button class="btn accent sm" id="next" style="font-size:18px">${last ? 'Победници 🥇' : 'Следно прашање ▶'}</button></div>
      </div>`);
      document.getElementById('next').onclick = () => last ? store.set(`${P}/public/state`, 'podium') : startQuestion(qi + 1);
    }
    if (s === 'podium') {
      const list = sorted(g.players); const [a, b, c] = list;
      const pod = (p, cls, medal, n) => p ? `<div class="pod ${cls}"><div class="medal">${medal}</div><div class="name">${esc(p.name)}</div><div class="score">${p.score || 0} поени</div><div class="block">${n}</div></div>` : '<div></div>';
      render(`<div class="screen">
        <div class="qhead"><h1 class="brand" style="font-size:24px">🏆 Победници</h1><span class="pill">VR Journey Through Europe</span></div>
        <div class="podium">${pod(b, 'p2', '🥈', 2)}${pod(a, 'p1', '🥇', 1)}${pod(c, 'p3', '🥉', 3)}</div>
        <div class="rest">${list.slice(3).map((p, i) => `<div><span>${i + 4}. ${esc(p.name)}</span><span>${p.score || 0}</span></div>`).join('')}</div>
        <div class="footer-actions"><button class="btn ghost sm" onclick="go('#/host')">Нова игра</button></div>
      </div>`);
      const show = (cls, d) => setTimeout(() => { const el = document.querySelector('.pod.' + cls); if (el) el.classList.add('show'); }, d);
      show('p3', 600); show('p2', 1800); show('p1', 3200);
      setTimeout(() => { boom({ particleCount: 200, spread: 100, origin: { y: .5 } }); setTimeout(() => boom({ origin: { x: .2, y: .6 } }), 500); setTimeout(() => boom({ origin: { x: .8, y: .6 } }), 900); }, 3300);
    }
  }

  function patch() {
    const s = g.public.state, qi = g.public.qIndex;
    if (s === 'lobby') {
      const list = sorted(g.players).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      const pc = document.getElementById('pcount'); if (pc) pc.textContent = list.length;
      const box = document.getElementById('players');
      if (box) {
        const have = new Set([...box.children].map(el => el.dataset.id));
        list.forEach(p => { if (!have.has(p.id)) { const el = document.createElement('div'); el.className = 'player'; el.dataset.id = p.id; el.textContent = p.name; box.appendChild(el); } });
        [...box.children].forEach(el => { if (!list.find(p => p.id === el.dataset.id)) el.remove(); });
      }
      const st = document.getElementById('start'); if (st) st.disabled = list.length === 0;
    }
    if (s === 'question') {
      const n = count(g.answers && g.answers[qi]), total = count(g.players);
      const ac = document.getElementById('acount'); if (ac) ac.textContent = `${n} / ${total}`;
      if (total > 0 && n >= total && !ending && !endTimer) endTimer = setTimeout(() => endQuestion(), 800);
      if (!patch.timerRunning) {
        patch.timerRunning = true;
        every(100, () => {
          if (!g || g.public.state !== 'question') return;
          const dur = g.public.duration * 1000, started = g.public.qStartedAt || store.now();
          const rem = started + dur - store.now();
          const t = document.getElementById('timer');
          if (t) { t.style.setProperty('--p', Math.max(0, rem / dur * 100) + '%'); t.firstElementChild.textContent = fmtTime(rem); }
          if (rem <= 0) endQuestion();
        });
      }
    } else patch.timerRunning = false;
  }

  async function startQuestion(i) {
    await store.update(`${P}/public`, { state: 'question', qIndex: i, qStartedAt: store.serverTimestamp(), counts: null });
  }

  async function endQuestion() {
    if (ending || !g || g.public.state !== 'question') return; ending = true;
    try {
      const qi = g.public.qIndex, q = Q[qi], dur = g.public.duration * 1000, started = g.public.qStartedAt;
      const [answers, players] = await Promise.all([store.get(`${P}/answers/${qi}`), store.get(`${P}/players`)]);
      const counts = [0, 0, 0, 0], rows = [];
      for (const id in (players || {})) {
        const p = players[id], a = answers && answers[id];
        let points = 0, correct = false, choice = null, t = dur;
        if (a && typeof a.choice === 'number' && a.choice >= 0 && a.choice < 4) {
          choice = a.choice; counts[choice]++;
          const el = Math.max(0, (typeof a.at === 'number' ? a.at : started) - started);
          t = Math.min(el, dur);
          if (el <= dur + 2500 && q.correct.includes(choice)) { correct = true; points = pts(el, dur); }
        }
        rows.push({ id, correct, choice, points, score: (p.score || 0) + points, totalTime: (p.totalTime || 0) + t, joinedAt: p.joinedAt || 0 });
      }
      rows.sort((a, b) => b.score - a.score || a.totalTime - b.totalTime || a.joinedAt - b.joinedAt);
      const upd = {};
      rows.forEach((r, i) => {
        upd[`players/${r.id}/score`] = r.score; upd[`players/${r.id}/lastPoints`] = r.points;
        upd[`players/${r.id}/lastCorrect`] = r.correct; upd[`players/${r.id}/lastChoice`] = r.choice;
        upd[`players/${r.id}/totalTime`] = r.totalTime; upd[`players/${r.id}/rank`] = i + 1;
        upd[`results/${qi}/${r.id}`] = { correct: r.correct, choice: r.choice, points: r.points, score: r.score, rank: i + 1 };
      });
      upd['public/counts'] = counts; upd['public/state'] = 'reveal';
      await store.update(P, upd);
    } catch (e) { console.error(e); ending = false; alert('Грешка при завршување на прашањето: ' + e.message); }
  }
}

/* ---------------- player ---------------- */
function playJoin(pinFromUrl) {
  const saved = pinFromUrl && JSON.parse(sessionStorage.getItem('vrquiz_player_' + pinFromUrl) || localStorage.getItem('vrquiz_player_' + pinFromUrl) || 'null');
  if (saved && saved.id) { playGame(pinFromUrl, saved.id); return; }
  render(`<div class="screen center">
    <h1 class="brand">VR Journey Through Europe 🌍<small>Квиз во живо</small></h1>
    <div class="card" style="margin-top:24px">
      <h2>Приклучи се</h2>
      <input class="field" id="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="PIN на играта" value="${esc(pinFromUrl)}" ${pinFromUrl ? 'readonly' : ''}>
      <input class="field" id="name" maxlength="16" placeholder="Твое име" autocomplete="off">
      <p class="err" id="err"></p>
      <button class="btn accent" id="join">Влези 🚀</button>
    </div>
  </div>`);
  const nameEl = document.getElementById('name');
  (pinFromUrl ? nameEl : document.getElementById('pin')).focus();
  const doJoin = async () => {
    const pin = document.getElementById('pin').value.trim(), name = nameEl.value.trim().replace(/\s+/g, ' ');
    const err = document.getElementById('err');
    if (!/^\d{6}$/.test(pin)) { err.textContent = 'Внеси 6-цифрен PIN.'; return; }
    if (name.length < 1) { err.textContent = 'Внеси го твоето име.'; return; }
    const b = document.getElementById('join'); b.disabled = true; err.textContent = '';
    try {
      const pub = await store.get(`games/${pin}/public`);
      if (!pub) { err.textContent = 'Не постои игра со овој PIN.'; b.disabled = false; return; }
      if (pub.state === 'podium') { err.textContent = 'Оваа игра веќе заврши.'; b.disabled = false; return; }
      const players = await store.get(`games/${pin}/players`) || {};
      const names = new Set(Object.values(players).map(p => (p.name || '').toLowerCase()));
      let final = name, n = 2; while (names.has(final.toLowerCase())) final = `${name} ${n++}`;
      const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await store.set(`games/${pin}/players/${id}`, { name: final, score: 0, totalTime: 0, joinedAt: store.serverTimestamp() });
      const ident = JSON.stringify({ id, name: final }); localStorage.setItem('vrquiz_player_' + pin, ident); sessionStorage.setItem('vrquiz_player_' + pin, ident);
      go('#/play/' + pin); if (location.hash === '#/play/' + pin) route();
    } catch (e) { console.error(e); err.textContent = 'Грешка: ' + e.message; b.disabled = false; }
  };
  document.getElementById('join').onclick = doJoin;
  nameEl.onkeydown = e => { if (e.key === 'Enter') doJoin(); };
}

function playGame(pin, myId) {
  const P = `games/${pin}`;
  let pub = null, me = null, viewKey = null, answered = null, checking = null, meMissing = false;
  render(`<div class="screen center"><p class="muted">Се поврзува…</p></div>`);
  sub(`${P}/public`, v => { pub = v; update(); });
  sub(`${P}/players/${myId}`, v => { me = v; meMissing = (v === null); update(); });

  async function update() {
    if (pub === null && me === null) return;
    if (pub === null || meMissing) {
      // играта е избришана, или водителот нè отстрани
      if (viewKey === 'gone') return; viewKey = 'gone';
      localStorage.removeItem('vrquiz_player_' + pin); sessionStorage.removeItem('vrquiz_player_' + pin);
      render(`<div class="screen center"><div class="card"><h2>Не си во играта</h2><p style="color:#6b6480">Играта не постои или си отстранет/а од водителот.</p><button class="btn" onclick="location.hash='#/play';location.reload()">Приклучи се повторно</button></div></div>`);
      return;
    }
    if (!me) return;
    const s = pub.state, qi = pub.qIndex;
    if (s === 'question' && answered !== qi && checking !== qi) {
      // по освежување на страницата: провери дали веќе сме одговориле
      checking = qi;
      const a = await store.get(`${P}/answers/${qi}/${myId}`);
      if (a) answered = qi;
      checking = null;
      if (!pub || pub.qIndex !== qi) return;
    }
    const key = `${s}:${qi}:${answered === qi}:${me.score}:${me.rank}:${me.lastChoice}:${me.lastPoints}`;
    if (key !== viewKey) { viewKey = key; full(); }
  }

  function header() { return `<div class="topbar"><span class="pill">${esc(me.name)}</span><span class="pill">${me.score || 0} поени</span></div>`; }

  function full() {
    const s = pub.state, qi = pub.qIndex, q = Q[qi];
    if (s === 'lobby') {
      render(`<div class="screen">${header()}<div class="center" style="flex:1;display:flex;flex-direction:column">
        <div class="big">🎉</div><h2>Внатре си, ${esc(me.name)}!</h2><p class="muted">Погледни го големиот екран. Квизот почнува наскоро…</p></div></div>`);
    }
    if (s === 'question' && answered !== qi) {
      render(`<div class="screen">${header()}
        <div class="row" style="justify-content:space-between;margin-bottom:12px"><span class="pill">Прашање ${qi + 1} / ${Q.length}</span><span class="pill" id="ptimer">${pub.duration}</span></div>
        <div class="pads">${q.a.map((a, i) => `<button class="pad c${i}" data-i="${i}"><span class="shape">${SHAPES[i]}</span>${LETTERS[i]}${pub.showText ? `<small>${esc(a)}</small>` : ''}</button>`).join('')}</div>
      </div>`);
      document.querySelector('.pads').onclick = async e => {
        const b = e.target.closest('.pad'); if (!b || answered === qi) return;
        const started = pub.qStartedAt || 0, dur = pub.duration * 1000;
        if (store.now() - started > dur + 1500) return;
        answered = qi; viewKey = null;
        document.querySelectorAll('.pad').forEach(x => x.disabled = true);
        try { await store.set(`${P}/answers/${qi}/${myId}`, { choice: Number(b.dataset.i), at: store.serverTimestamp() }); }
        catch (err) { console.error(err); answered = null; }
        update();
      };
      every(200, () => {
        if (!pub || pub.state !== 'question') return;
        const el = document.getElementById('ptimer'); if (!el) return;
        const rem = (pub.qStartedAt || store.now()) + pub.duration * 1000 - store.now();
        el.textContent = fmtTime(rem);
        if (rem <= 0) document.querySelectorAll('.pad').forEach(x => x.disabled = true);
      });
    }
    if (s === 'question' && answered === qi) {
      render(`<div class="screen">${header()}<div class="center" style="flex:1;display:flex;flex-direction:column">
        <div class="big">⏳</div><h2>Одговорот е испратен!</h2><p class="muted">Чекаме и другите…</p></div></div>`);
    }
    if (s === 'reveal' || s === 'scoreboard') {
      const hasAns = me.lastChoice !== null && me.lastChoice !== undefined && me.lastChoice >= 0;
      const cls = !hasAns ? 'none' : me.lastCorrect ? 'ok' : 'bad';
      const title = !hasAns ? '⏰ Без одговор' : me.lastCorrect ? '✅ Точно!' : '❌ Неточно';
      render(`<div class="screen">${header()}<div class="center" style="flex:1;display:flex;flex-direction:column">
        <div class="result ${cls}"><h2>${title}</h2>
          ${hasAns ? `<div class="muted" style="margin-bottom:6px">Твој одговор: ${SHAPES[me.lastChoice]} ${LETTERS[me.lastChoice]}</div>` : ''}
          <div class="pts">+${me.lastPoints || 0}</div>
          <div class="statline"><div>${me.score || 0}<span>вкупно поени</span></div><div>${me.rank || '-'}.<span>место</span></div></div>
        </div>
        ${s === 'scoreboard' ? '<p class="muted" style="margin-top:20px">Следи го големиот екран…</p>' : ''}
      </div></div>`);
      if (me.lastCorrect && s === 'reveal') boom({ particleCount: 60, spread: 70 });
    }
    if (s === 'podium') {
      const r = me.rank || 0; const medal = r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '🎖️';
      render(`<div class="screen">${header()}<div class="center" style="flex:1;display:flex;flex-direction:column">
        <div class="big">${medal}</div><h2>${r <= 3 && r > 0 ? `Ти си на ${r}. место!` : `Завршивте на ${r}. место`}</h2>
        <p class="big" style="font-size:40px">${me.score || 0} поени</p><p class="muted">Браво! Благодариме за учеството 🌍</p>
        <button class="btn ghost" style="max-width:300px;margin-top:20px" onclick="localStorage.removeItem('vrquiz_player_${esc(pin)}');sessionStorage.removeItem('vrquiz_player_${esc(pin)}');location.hash='#/';location.reload()">Излези</button>
      </div></div>`);
      if (r > 0 && r <= 3) boom({ particleCount: 150, spread: 90 });
    }
  }
}

/* ---------------- boot ---------------- */
(async function boot() {
  try { store = window.createStore(); } catch (e) { console.error(e); store = null; }
  if (store) { try { await store.ready(); } catch (e) { console.error(e); } }
  window.addEventListener('hashchange', route);
  route();
})();
