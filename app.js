'use strict';
/* ================= constants & helpers ================= */
const SHAPES = ['▲', '◆', '●', '■'];
const LETTERS = ['A', 'B', 'C', 'D'];
const COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c'];
const OWNER_EMAIL = 'stoimenov00@gmail.com';
const BUILTIN_ID = 'vr-europe';
const TIME_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const POINT_OPTIONS = [[1000, 'Стандардни (до 1000)'], [2000, 'Двојни (до 2000)'], [0, 'Без поени']];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => document.getElementById('app');
const render = html => { app().innerHTML = html; };
let store = null;
let cleanup = [];
function onClean(f) { cleanup.push(f); }
function clean() { cleanup.forEach(f => { try { f(); } catch (e) { } }); cleanup = []; }
function sub(p, cb) { onClean(store.onValue(p, cb)); }
function every(ms, fn) { const t = setInterval(fn, ms); onClean(() => clearInterval(t)); fn(); }
function base() { return location.origin + location.pathname + (/[?&]local=1/.test(location.search) ? '?local=1' : ''); }
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
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function arr(v) { if (Array.isArray(v)) return v.filter(x => x !== null && x !== undefined); if (v && typeof v === 'object') return Object.keys(v).sort((a, b) => a - b).map(k => v[k]); return []; }
function emailKey(e) { return String(e || '').trim().toLowerCase().replace(/\./g, ','); }
function newId() { return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}
function slug(s) { return String(s || 'kviz').toLowerCase().replace(/[^a-z0-9Ѐ-ӿ]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'kviz'; }

/* ---- quiz model ---- */
function blankQ() { return { text: '', answers: ['', '', '', ''], correct: [], time: 0, points: 1000, image: '', note: '' }; }
function normQ(x) {
  x = x || {};
  return {
    text: String(x.text || ''), answers: arr(x.answers).map(a => String(a ?? '')).slice(0, 4),
    correct: arr(x.correct).map(Number).filter(n => n >= 0 && n < 4), time: Number(x.time) || 0,
    points: x.points === undefined || x.points === null ? 1000 : Number(x.points), image: String(x.image || ''), note: String(x.note || '')
  };
}
function normQuiz(raw, id) {
  const q = raw || {};
  return { id, title: String(q.title || 'Без наслов'), defaultTime: Number(q.defaultTime) || 20, questions: arr(q.questions).map(normQ), updatedAt: q.updatedAt || 0, updatedBy: q.updatedBy || '' };
}
function builtinQuiz() {
  return normQuiz({ title: 'VR Journey Through Europe 🌍', defaultTime: 20, questions: (window.QUESTIONS || []).map(q => ({ text: q.q, answers: q.a, correct: q.correct, time: 0, points: 1000, note: q.note || '' })) }, BUILTIN_ID);
}
function quizToDb(qz, by) {
  return {
    title: qz.title.trim(), defaultTime: qz.defaultTime,
    questions: qz.questions.map(q => ({ text: q.text.trim(), answers: q.answers.map(a => a.trim()), correct: q.correct.slice().sort(), time: q.time || 0, points: q.points, image: (q.image || '').trim(), note: (q.note || '').trim() })),
    updatedAt: store.serverTimestamp(), updatedBy: by || ''
  };
}
function qTime(qz, q) { return q.time || qz.defaultTime || 20; }
function quizMinutes(qz) { const s = qz.questions.reduce((t, q) => t + qTime(qz, q) + 12, 0); return Math.max(1, Math.round(s / 60)); }
function remaining(pub) {
  const now = pub.pausedAt || store.now();
  return (pub.qStartedAt || now) + (pub.duration || 20) * 1000 + (pub.pausedMs || 0) - now;
}
async function loadQuizzes() {
  const all = (await store.get('quizzes')) || {};
  return Object.entries(all).map(([id, v]) => normQuiz(v, id)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/* ---- auth ---- */
let authState = { ready: false, user: null };
const authWaiters = [];
function waitAuth() { return authState.ready ? Promise.resolve(authState.user) : new Promise(r => authWaiters.push(r)); }
function isOwner(u) { return !!u && (u.local || (u.email || '').toLowerCase() === OWNER_EMAIL); }
async function isAdmin(u) {
  if (!u) return false; if (isOwner(u)) return true;
  try { return (await store.get('admins/' + emailKey(u.email))) === true; } catch (e) { return false; }
}
function authErr(e) {
  const c = e && e.code || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return '';
  if (c === 'auth/popup-blocked') return 'Прелистувачот го блокира прозорецот за најава. Дозволи pop-up прозорци за оваа страница и обиди се пак.';
  if (c === 'auth/unauthorized-domain') return 'Овој домен не е дозволен за најава во Firebase (Authentication → Settings → Authorized domains).';
  if (c === 'auth/operation-not-allowed') return 'Најавата со Google не е вклучена во Firebase.';
  return 'Најавата не успеа: ' + (e && e.message || e);
}

/* ================= routing ================= */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, ''); const [path, qs] = h.split('?');
  return { parts: (path || '').split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
}
function route() {
  clean(); window.__dirty = false;
  const { parts, q } = parseHash();
  if (!store) return renderSetup();
  if (parts[0] === 'admin') return parts[1] === 'quiz' && parts[2] ? adminEditor(parts[2]) : adminHome();
  if (parts[0] === 'host') return parts[1] ? hostGame(parts[1]) : hostNew(q.get('quiz'));
  if (parts[0] === 'play') return playJoin(parts[1] || '');
  renderHome();
}

function renderHome() {
  render(`<div class="screen center">
    <h1 class="brand">VR Journey Through Europe 🌍<small>Квиз во живо</small></h1>
    <div class="home-actions">
      <button class="btn accent" onclick="go('#/play')">Приклучи се како играч</button>
      <button class="btn ghost" onclick="go('#/host')">Јас сум водител (голем екран)</button>
      <a class="btn ghost small-link" href="#/admin">⚙️ Админ: уреди ги прашањата</a>
    </div>
    ${store.kind === 'local' ? '<p class="muted" style="margin-top:30px">Локален режим за тестирање: работи само во овој прелистувач.</p>' : ''}
  </div>`);
}

function renderSetup() {
  render(`<div class="screen center">
    <h1 class="brand">VR Journey Through Europe 🌍<small>Квиз во живо</small></h1>
    <div class="setup" style="margin-top:24px">
      <h2>Потребно е поврзување со Firebase</h2>
      <p>Внеси ги податоците од Firebase во <code>firebase-config.js</code> (упатство во README.md), или отвори ја страницата со <code>?local=1</code> за тестирање во еден прелистувач.</p>
    </div>
  </div>`);
}

/* ================= admin ================= */
function adminShell(inner, user) {
  return `<div class="screen admin">
    <div class="topbar"><h1 class="brand" style="font-size:22px"><a href="#/admin" class="plain">⚙️ Админ панел</a></h1>
      <div class="row">${user ? `<span class="pill">${esc(user.email)}</span>${user.local ? '' : '<button class="btn ghost sm" id="signout">Одјави се</button>'}` : ''}<a class="btn ghost sm" href="#/">Почетна</a></div></div>
    ${inner}</div>`;
}
function wireSignout() { const b = document.getElementById('signout'); if (b) b.onclick = async () => { await store.signOut(); }; }

async function adminHome() {
  render(adminShell('<p class="muted">Се вчитува…</p>'));
  const user = await waitAuth();
  if (!user) {
    render(adminShell(`<div class="card center-card"><h2>Најава за модератори</h2>
      <p class="sub">Најави се со Google сметка за да ги уредуваш квизовите. Само додадените модератори можат да прават промени.</p>
      <p class="err" id="err"></p><button class="btn accent" id="signin">Најави се со Google</button></div>`));
    document.getElementById('signin').onclick = async () => {
      const err = document.getElementById('err'); err.textContent = '';
      try { await store.signIn(); } catch (e) { err.textContent = authErr(e); }
    };
    return;
  }
  if (!(await isAdmin(user))) {
    render(adminShell(`<div class="card center-card"><h2>Немаш пристап за уредување</h2>
      <p class="sub">Сметката <b>${esc(user.email)}</b> не е модератор. Побарај од сопственикот (${esc(OWNER_EMAIL)}) да те додаде, па освежи ја страницата.</p></div>`, user));
    wireSignout(); return;
  }
  let quizzes = [];
  try { quizzes = await loadQuizzes(); } catch (e) { console.error(e); }
  const hasBuiltin = quizzes.some(q => q.id === BUILTIN_ID);
  const owner = isOwner(user);
  let mods = {};
  if (owner) { try { mods = (await store.get('admins')) || {}; } catch (e) { } }

  render(adminShell(`
    <div class="admin-wrap">
      <div class="row between"><h2 class="section-title">Квизови</h2>
        <div class="row"><button class="btn accent sm" id="newq">+ Нов квиз</button><button class="btn ghost sm" id="importBtn">⬆ Увези JSON</button><input type="file" id="importFile" accept=".json,application/json" hidden></div></div>
      ${!hasBuiltin ? `<div class="banner">Основниот квиз „VR Journey Through Europe“ уште не е во базата. <button class="btn sm light" id="seed">Додај го за уредување</button></div>` : ''}
      <div class="qlist">${quizzes.map(q => `
        <div class="qitem" data-id="${esc(q.id)}">
          <div><b>${esc(q.title)}</b><span class="meta">${q.questions.length} прашања · околу ${quizMinutes(q)} мин${q.updatedBy ? ` · последно: ${esc(q.updatedBy)}` : ''}</span></div>
          <div class="row">
            <a class="btn sm accent" href="#/admin/quiz/${esc(q.id)}">✏️ Уреди</a>
            <a class="btn sm light" href="#/host?quiz=${esc(q.id)}">▶ Играј</a>
            <button class="btn sm light" data-act="dup">Дуплирај</button>
            <button class="btn sm light" data-act="export">⬇ Извези</button>
            <button class="btn sm danger" data-act="del">Избриши</button>
          </div>
        </div>`).join('') || '<p class="muted">Нема квизови. Создади нов или додај го основниот.</p>'}</div>
      ${owner ? `
        <h2 class="section-title">Модератори</h2>
        <div class="card">
          <p class="sub" style="margin-top:0">Модераторите можат да ги уредуваат квизовите. Се најавуваат со својата Google сметка. Ти (${esc(OWNER_EMAIL)}) секогаш имаш пристап.</p>
          <div class="mods">${Object.keys(mods).filter(k => mods[k] === true).map(k => `<span class="mod">${esc(k.replace(/,/g, '.'))} <button class="icon danger" data-mod="${esc(k)}" title="Отстрани">✕</button></span>`).join('') || '<span class="muted-ink">Нема додадени модератори.</span>'}</div>
          <div class="row" style="margin-top:12px;justify-content:flex-start"><input class="in" id="modEmail" type="email" placeholder="email@gmail.com" style="max-width:320px"><button class="btn sm" id="addMod">Додај модератор</button></div>
          <p class="err" id="modErr"></p>
        </div>` : ''}
    </div>`, user));
  wireSignout();

  document.getElementById('newq').onclick = async () => {
    const id = newId(); const qz = { id, title: 'Нов квиз', defaultTime: 20, questions: [blankQ()] };
    await store.set('quizzes/' + id, quizToDb(qz, user.email)); go('#/admin/quiz/' + id);
  };
  const seed = document.getElementById('seed');
  if (seed) seed.onclick = async () => { await store.set('quizzes/' + BUILTIN_ID, quizToDb(builtinQuiz(), user.email)); route(); };
  const file = document.getElementById('importFile');
  document.getElementById('importBtn').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const qz = normQuiz(data, newId());
      if (!qz.questions.length) throw new Error('Датотеката нема прашања.');
      await store.set('quizzes/' + qz.id, quizToDb(qz, user.email)); route();
    } catch (e) { alert('Не можам да ја увезам датотеката: ' + e.message); }
  };
  app().querySelector('.qlist').onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('.qitem').dataset.id; const qz = quizzes.find(q => q.id === id); if (!qz) return;
    if (b.dataset.act === 'dup') { const c = { ...qz, id: newId(), title: qz.title + ' (копија)' }; await store.set('quizzes/' + c.id, quizToDb(c, user.email)); route(); }
    if (b.dataset.act === 'export') { const { id: _i, updatedAt, updatedBy, ...rest } = qz; download(slug(qz.title) + '.json', JSON.stringify(rest, null, 2), 'application/json'); }
    if (b.dataset.act === 'del') { if (confirm(`Да се избрише квизот „${qz.title}“? Ова не може да се врати.`)) { await store.set('quizzes/' + id, null); route(); } }
  };
  if (owner) {
    const err = document.getElementById('modErr');
    document.getElementById('addMod').onclick = async () => {
      const em = document.getElementById('modEmail').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { err.textContent = 'Внеси валидна email адреса.'; return; }
      try { await store.set('admins/' + emailKey(em), true); route(); } catch (e) { err.textContent = 'Грешка: ' + e.message; }
    };
    app().querySelector('.mods').onclick = async e => {
      const b = e.target.closest('[data-mod]'); if (!b) return;
      if (confirm('Да се отстрани модераторот?')) { await store.set('admins/' + b.dataset.mod, null); route(); }
    };
  }
}

async function adminEditor(id) {
  render(adminShell('<p class="muted">Се вчитува…</p>'));
  const user = await waitAuth();
  if (!user || !(await isAdmin(user))) { go('#/admin'); return; }
  const raw = await store.get('quizzes/' + id);
  if (!raw) { render(adminShell(`<div class="card center-card"><h2>Квизот не постои</h2><a class="btn" href="#/admin">← Назад</a></div>`, user)); wireSignout(); return; }
  const ed = normQuiz(raw, id);
  if (!ed.questions.length) ed.questions.push(blankQ());
  let errors = [], saving = false, savedAt = null;
  const root = app();

  function setDirty(d) { window.__dirty = d; updateBar(); }
  function updateBar() {
    const st = document.getElementById('saveStatus'), b = document.getElementById('saveBtn'); if (!st || !b) return;
    st.textContent = saving ? 'Се зачувува…' : window.__dirty ? '● Незачувани промени' : savedAt ? `✓ Зачувано во ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '✓ Сè е зачувано';
    st.className = window.__dirty ? 'dirty' : 'clean';
    b.disabled = saving || !window.__dirty;
  }
  function validate() {
    const out = [];
    if (!ed.title.trim()) out.push({ qi: -1, msg: 'Квизот нема наслов.' });
    ed.questions.forEach((q, i) => {
      const n = i + 1;
      if (!q.text.trim()) out.push({ qi: i, msg: `Прашање ${n}: нема текст.` });
      if (q.answers.some(a => !a.trim())) out.push({ qi: i, msg: `Прашање ${n}: има празен одговор. Пополни го или отстрани го со ✕.` });
      if (q.answers.length < 2) out.push({ qi: i, msg: `Прашање ${n}: потребни се барем 2 одговори.` });
      if (!q.correct.length) out.push({ qi: i, msg: `Прашање ${n}: означи барем еден точен одговор.` });
    });
    return out;
  }
  function qcard(q, i, bad) {
    const n = ed.questions.length;
    return `<div class="card qcard ${bad.has(i) ? 'invalid' : ''}" data-qi="${i}">
      <div class="qcard-head"><span class="qnum">Прашање ${i + 1}</span>
        <div class="row tools">
          <button class="icon" data-act="up" ${i === 0 ? 'disabled' : ''} title="Помести нагоре">↑</button>
          <button class="icon" data-act="down" ${i === n - 1 ? 'disabled' : ''} title="Помести надолу">↓</button>
          <button class="icon" data-act="dup" title="Дуплирај">⧉</button>
          <button class="icon danger" data-act="del" title="Избриши прашање">🗑</button>
        </div></div>
      <textarea class="in qtext-in" data-f="text" rows="2" placeholder="Текст на прашањето">${esc(q.text)}</textarea>
      <div class="answers-ed">
        ${q.answers.map((a, ai) => `<div class="ansrow ar${ai}"><span class="shape">${SHAPES[ai]}</span>
          <input class="in" data-f="ans" data-ai="${ai}" value="${esc(a)}" placeholder="Одговор ${LETTERS[ai]}">
          <label class="corr"><input type="checkbox" data-f="correct" data-ai="${ai}" ${q.correct.includes(ai) ? 'checked' : ''}> Точен</label>
          ${q.answers.length > 2 ? `<button class="icon" data-act="delans" data-ai="${ai}" title="Отстрани одговор">✕</button>` : ''}</div>`).join('')}
        ${q.answers.length < 4 ? `<button class="btn sm light" data-act="addans" style="justify-self:start">+ Додај одговор</button>` : ''}
      </div>
      <div class="row3">
        <label class="fl">⏱ Време<select class="in" data-f="time"><option value="0" ${!q.time ? 'selected' : ''}>Стандардно (${ed.defaultTime} сек)</option>${TIME_OPTIONS.map(t => `<option value="${t}" ${q.time === t ? 'selected' : ''}>${t} сек</option>`).join('')}</select></label>
        <label class="fl">⭐ Поени<select class="in" data-f="points">${POINT_OPTIONS.map(([v, l]) => `<option value="${v}" ${q.points === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="fl">🖼 Слика (линк, по избор)<input class="in" data-f="image" value="${esc(q.image)}" placeholder="https://…/slika.jpg"></label>
      </div>
      ${q.image ? `<img class="qprev" src="${esc(q.image)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'err',textContent:'Сликата не може да се вчита од овој линк.'}))">` : ''}
      <label class="fl">💬 Порака по откривање на одговорот (по избор)<input class="in" data-f="note" value="${esc(q.note)}" placeholder="пр. Сите одговори се точни!"></label>
    </div>`;
  }
  function draw() {
    const bad = new Set(errors.map(e => e.qi));
    render(adminShell(`
      <div class="editor">
        <div class="card ed-head">
          <label class="fl">Наслов на квизот<input class="in big-in" data-f="title" value="${esc(ed.title)}"></label>
          <div class="row3">
            <label class="fl">⏱ Стандардно време по прашање<select class="in" data-f="defaultTime">${TIME_OPTIONS.map(t => `<option value="${t}" ${ed.defaultTime === t ? 'selected' : ''}>${t} сек</option>`).join('')}</select></label>
            <div class="fl">Преглед<span class="muted-ink">${ed.questions.length} прашања · околу ${quizMinutes(ed)} мин</span></div>
          </div>
          <p class="sub" style="margin:0">Секое прашање може да има свое време и поени. „Стандардно“ го користи времето погоре. Означи повеќе „Точен“ ако има повеќе точни одговори.</p>
        </div>
        ${errors.length ? `<div class="errbox"><b>Не може да се зачува. Поправи го ова:</b><ul>${errors.map(e => `<li>${esc(e.msg)}</li>`).join('')}</ul></div>` : ''}
        ${ed.questions.map((q, i) => qcard(q, i, bad)).join('')}
        <button class="btn addq" data-act="addq">+ Додај прашање</button>
      </div>
      <div class="savebar"><a class="btn ghost sm" href="#/admin">← Сите квизови</a><span id="saveStatus"></span>
        <button class="btn ghost sm" data-act="play">▶ Играј</button><button class="btn accent sm" id="saveBtn" data-act="save">💾 Зачувај</button></div>`, user));
    wireSignout(); updateBar();
  }
  async function save() {
    errors = validate();
    if (errors.length) { draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); return false; }
    saving = true; updateBar();
    try {
      await store.set('quizzes/' + id, quizToDb(ed, user.email));
      savedAt = new Date(); errors = []; saving = false; window.__dirty = false; draw(); return true;
    } catch (e) {
      saving = false; updateBar();
      alert('Грешка при зачувување: ' + e.message + (/permission/i.test(e.message) ? '\nОваа сметка нема дозвола за уредување.' : ''));
      return false;
    }
  }

  root.oninput = e => {
    const t = e.target, f = t.dataset.f; if (!f) return;
    const card = t.closest('[data-qi]'); const q = card ? ed.questions[Number(card.dataset.qi)] : null;
    if (f === 'title') ed.title = t.value;
    else if (f === 'defaultTime') ed.defaultTime = Number(t.value);
    else if (q) {
      if (f === 'text') q.text = t.value;
      else if (f === 'ans') q.answers[Number(t.dataset.ai)] = t.value;
      else if (f === 'image') q.image = t.value.trim();
      else if (f === 'note') q.note = t.value;
      else if (f === 'time') q.time = Number(t.value);
      else if (f === 'points') q.points = Number(t.value);
      else if (f === 'correct') { const ai = Number(t.dataset.ai); q.correct = t.checked ? [...new Set([...q.correct, ai])].sort() : q.correct.filter(x => x !== ai); }
    }
    setDirty(true);
  };
  root.onchange = e => { const f = e.target.dataset.f; if (f === 'defaultTime' || f === 'image') draw(); };
  root.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b || !root.contains(b)) return;
    const act = b.dataset.act, card = b.closest('[data-qi]'), qi = card ? Number(card.dataset.qi) : -1, Qs = ed.questions;
    if (act === 'save') { await save(); return; }
    if (act === 'play') { if (window.__dirty && !(await save())) return; window.__dirty = false; go('#/host?quiz=' + encodeURIComponent(id)); return; }
    if (act === 'up' && qi > 0) [Qs[qi - 1], Qs[qi]] = [Qs[qi], Qs[qi - 1]];
    else if (act === 'down' && qi < Qs.length - 1) [Qs[qi + 1], Qs[qi]] = [Qs[qi], Qs[qi + 1]];
    else if (act === 'dup') Qs.splice(qi + 1, 0, JSON.parse(JSON.stringify(Qs[qi])));
    else if (act === 'del') {
      if (Qs.length === 1) { alert('Квизот мора да има барем едно прашање.'); return; }
      if (!confirm(`Да се избрише прашање ${qi + 1}?`)) return; Qs.splice(qi, 1);
    }
    else if (act === 'addans') Qs[qi].answers.push('');
    else if (act === 'delans') { const ai = Number(b.dataset.ai), q = Qs[qi]; q.answers.splice(ai, 1); q.correct = q.correct.filter(x => x !== ai).map(x => x > ai ? x - 1 : x); }
    else if (act === 'addq') {
      Qs.push(blankQ()); setDirty(true); draw();
      const cards = root.querySelectorAll('.qcard'), last = cards[cards.length - 1];
      if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); last.querySelector('textarea').focus({ preventScroll: true }); }
      return;
    } else return;
    if (errors.length) errors = validate();
    setDirty(true); draw();
  };
  const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);
  onClean(() => { root.oninput = null; root.onchange = null; root.onclick = null; document.removeEventListener('keydown', onKey); });
  draw();
}

/* ================= host ================= */
async function hostNew(preselect) {
  render(`<div class="screen center"><p class="muted">Се вчитуваат квизовите…</p></div>`);
  let list = [];
  try { list = await loadQuizzes(); } catch (e) { console.error(e); }
  if (!list.find(q => q.id === BUILTIN_ID)) list.unshift(builtinQuiz());
  list = list.filter(q => q.questions.length);
  const sel = list.find(q => q.id === preselect) ? preselect : (list.find(q => q.id === BUILTIN_ID) || list[0]).id;
  render(`<div class="screen center">
    <h1 class="brand">VR Journey Through Europe 🌍<small>Панел за водител</small></h1>
    <div class="card" style="margin-top:24px;max-width:480px">
      <h2>Нова игра</h2>
      <label class="fl" style="text-align:left">Квиз<select class="in" id="quizSel">${list.map(q => `<option value="${esc(q.id)}" ${q.id === sel ? 'selected' : ''}>${esc(q.title)} (${q.questions.length})</option>`).join('')}</select></label>
      <p class="sub" id="quizMeta"></p>
      <div class="host-opts">
        <label><input type="checkbox" id="oShowText" checked> Текст на одговорите и на телефоните</label>
        <label><input type="checkbox" id="oShowQ"> Прашањето и на телефоните</label>
        <label><input type="checkbox" id="oShufQ"> Измешај го редоследот на прашањата</label>
        <label><input type="checkbox" id="oShufA"> Измешај ги одговорите</label>
      </div>
      <p class="err" id="err"></p>
      <button class="btn accent" id="create">Создади игра</button>
    </div>
    <p style="margin-top:20px"><a class="link" href="#/">← Назад</a> · <a class="link" href="#/admin">⚙️ Уреди квизови</a></p>
  </div>`);
  const qs = document.getElementById('quizSel');
  const meta = () => { const q = list.find(x => x.id === qs.value); document.getElementById('quizMeta').textContent = q ? `${q.questions.length} прашања · околу ${quizMinutes(q)} мин` : ''; };
  qs.onchange = meta; meta();
  document.getElementById('create').onclick = async () => {
    const b = document.getElementById('create'); b.disabled = true;
    try {
      const qz = list.find(x => x.id === qs.value);
      let questions = qz.questions.map(q => ({ ...q, time: qTime(qz, q) }));
      if (document.getElementById('oShufQ').checked) questions = shuffle(questions);
      if (document.getElementById('oShufA').checked) questions = questions.map(q => {
        const idx = shuffle(q.answers.map((_, i) => i));
        return { ...q, answers: idx.map(i => q.answers[i]), correct: idx.map((orig, ni) => q.correct.includes(orig) ? ni : -1).filter(i => i >= 0) };
      });
      let pin;
      for (let i = 0; i < 20; i++) { pin = String(Math.floor(100000 + Math.random() * 900000)); if (!(await store.get(`games/${pin}/public`))) break; }
      const hostId = 'h' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('vrquiz_host_' + pin, hostId);
      await store.set(`games/${pin}`, {
        hostId, createdAt: store.serverTimestamp(),
        quiz: { title: qz.title, defaultTime: qz.defaultTime, questions: questions.map(q => ({ text: q.text, answers: q.answers, correct: q.correct, time: q.time, points: q.points, image: q.image || '', note: q.note || '' })) },
        public: { state: 'lobby', qIndex: 0, total: questions.length, title: qz.title, showText: document.getElementById('oShowText').checked, showQuestion: document.getElementById('oShowQ').checked }
      });
      go('#/host/' + pin);
    } catch (e) { console.error(e); document.getElementById('err').textContent = 'Грешка при создавање: ' + e.message; b.disabled = false; }
  };
}

function hostGame(pin) {
  let g = null, QZ = null, viewKey = null, ending = false, endTimer = null, timerOn = false;
  const P = `games/${pin}`;
  render(`<div class="screen center"><p class="muted">Се поврзува…</p></div>`);
  sub(P, async game => {
    if (!game || !game.public) { render(`<div class="screen center"><div class="card"><h2>Играта не постои</h2><button class="btn" onclick="go('#/host')">Нова игра</button></div></div>`); return; }
    g = game;
    if (!QZ) QZ = game.quiz ? normQuiz(game.quiz, 'game') : builtinQuiz();
    if (localStorage.getItem('vrquiz_host_' + pin) !== g.hostId) { renderTakeover(); return; }
    const key = g.public.state + ':' + g.public.qIndex;
    if (key !== viewKey) { viewKey = key; ending = false; clearTimeout(endTimer); endTimer = null; fullRender(); }
    patch();
  });
  const fsBtn = () => `<button class="btn ghost sm" id="fs" title="Цел екран">⛶</button>`;
  function wireFs() { const b = document.getElementById('fs'); if (b) b.onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { }); }

  function renderTakeover() {
    if (viewKey === 'takeover') return; viewKey = 'takeover';
    render(`<div class="screen center"><div class="card"><h2>Овој уред не е водител</h2>
      <p style="color:#6b6480">Играта ${esc(pin)} е создадена од друг уред или прелистувач. Можеш да ја преземеш контролата (само еден уред смее да биде водител).</p>
      <button class="btn" id="take">Преземи контрола</button></div></div>`);
    document.getElementById('take').onclick = async () => {
      const hostId = 'h' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('vrquiz_host_' + pin, hostId); viewKey = null;
      await store.set(`${P}/hostId`, hostId);
    };
  }

  function fullRender() {
    const s = g.public.state, qi = g.public.qIndex, q = QZ.questions[qi], N = QZ.questions.length;
    if (s === 'lobby') {
      render(`<div class="screen">
        <div class="topbar"><h1 class="brand" style="font-size:24px">${esc(QZ.title)}</h1><div class="row"><span class="pill">${N} прашања · ~${quizMinutes(QZ)} мин</span>${fsBtn()}</div></div>
        <div class="lobby">
          <div class="joinbox">
            <div class="lbl">Отвори</div>
            <div class="url">${esc(joinUrl(pin).replace(/^https?:\/\//, ''))}</div>
            <div id="qr"></div>
            <div class="lbl">PIN за игра</div>
            <div class="pin">${esc(pin)}</div>
          </div>
          <div class="players-wrap">
            <ol class="howto">
              <li>Учениците го скенираат <b>QR кодот</b> со телефон (или го отвораат линкот и го внесуваат <b>PIN-от</b>).</li>
              <li>Секој го внесува своето име и притиска <b>Влези</b>. Имињата се појавуваат подолу.</li>
              <li>Кога сите се внатре, кликни <b>Старт</b>. Одговараат на телефонот со боите ▲ ◆ ● ■.</li>
            </ol>
            <h3>Играчи: <span id="pcount">0</span></h3>
            <div class="players" id="players"><p class="waiting" id="waiting">⏳ Се чекаат играчи…</p></div>
            <p class="muted" style="font-size:14px">Клик на име за да отстраниш играч.</p>
            <div class="settings">
              <label><input type="checkbox" id="showText" ${g.public.showText ? 'checked' : ''}> Текст на одговорите на телефоните</label>
              <label><input type="checkbox" id="showQ" ${g.public.showQuestion ? 'checked' : ''}> Прашањето на телефоните</label>
            </div>
          </div>
        </div>
        <div class="footer-actions"><span class="start-hint" id="startHint">Старт е достапен кога ќе се приклучи барем еден играч</span><button class="btn accent sm" id="start" disabled style="font-size:20px;padding:14px 34px">Старт ▶</button></div>
      </div>`);
      try { new QRCode(document.getElementById('qr'), { text: joinUrl(pin), width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { }
      document.getElementById('showText').onchange = e => store.set(`${P}/public/showText`, e.target.checked);
      document.getElementById('showQ').onchange = e => store.set(`${P}/public/showQuestion`, e.target.checked);
      document.getElementById('start').onclick = () => startQuestion(0);
      document.getElementById('players').onclick = async e => {
        const el = e.target.closest('.player'); if (!el) return;
        if (confirm(`Отстрани „${el.textContent}“ од играта?`)) await store.set(`${P}/players/${el.dataset.id}`, null);
      };
      wireFs();
    }
    if (s === 'question') {
      render(`<div class="screen">
        <div class="qhead"><span class="pill">Прашање ${qi + 1} / ${N}</span><div class="row"><span class="pill">${q.points === 2000 ? '⭐ Двојни поени' : q.points === 0 ? 'Без поени' : 'PIN ' + esc(pin)}</span>${fsBtn()}</div></div>
        <div class="qtext">${esc(q.text)}</div>
        ${q.image ? `<img class="qimg" src="${esc(q.image)}" alt="" onerror="this.remove()">` : ''}
        <div class="qmid">
          <div class="timer" id="timer"><span>${q.time}</span></div>
          <div class="answered"><b id="acount">0</b>одговориле</div>
        </div>
        <div class="answers">${q.answers.map((a, i) => `<div class="ans c${i}"><span class="shape">${SHAPES[i]}</span><span>${esc(a)}</span></div>`).join('')}</div>
        <div class="footer-actions"><button class="btn ghost sm" id="pause">⏸ Пауза</button><button class="btn ghost sm" id="plus">+10 сек</button><button class="btn ghost sm" id="endq">Заврши прашање ⏭</button></div>
      </div>`);
      document.getElementById('endq').onclick = () => endQuestion();
      document.getElementById('plus').onclick = () => store.update(`${P}/public`, { duration: (g.public.duration || 20) + 10 });
      document.getElementById('pause').onclick = () => {
        const p = g.public; if (p.state !== 'question') return;
        if (p.pausedAt) store.update(`${P}/public`, { pausedMs: (p.pausedMs || 0) + Math.max(0, store.now() - p.pausedAt), pausedAt: null });
        else store.update(`${P}/public`, { pausedAt: store.now() });
      };
      wireFs();
    }
    if (s === 'reveal') {
      const n = q.answers.length, counts = arr(g.public.counts).concat([0, 0, 0, 0]).slice(0, n), max = Math.max(1, ...counts);
      render(`<div class="screen">
        <div class="qhead"><span class="pill">Прашање ${qi + 1} / ${N}</span><span class="pill">Резултат</span></div>
        <div class="qtext">${esc(q.text)}</div>
        ${q.note ? `<div class="note">🎉 ${esc(q.note)}</div>` : ''}
        <div class="bars" style="grid-template-columns:repeat(${n},1fr)">${counts.map((c, i) => `<div class="bar"><b>${c}</b><i style="background:${COLORS[i]};height:4px" data-h="${Math.round(c / max * 100)}"></i><span class="shape">${SHAPES[i]}</span></div>`).join('')}</div>
        <div class="answers">${q.answers.map((a, i) => { const ok = q.correct.includes(i); return `<div class="ans c${i} ${ok ? '' : 'dim'}"><span class="shape">${SHAPES[i]}</span><span>${esc(a)}</span>${ok ? '<span class="mark">✔</span>' : ''}</div>`; }).join('')}</div>
        <div class="footer-actions"><button class="btn accent sm" id="next" style="font-size:18px">Табела 🏆</button></div>
      </div>`);
      setTimeout(() => document.querySelectorAll('.bar i').forEach(el => el.style.height = Math.max(3, el.dataset.h) + '%'), 60);
      document.getElementById('next').onclick = () => store.set(`${P}/public/state`, 'scoreboard');
    }
    if (s === 'scoreboard') {
      const list = sorted(g.players).slice(0, 5), last = qi >= N - 1;
      render(`<div class="screen">
        <div class="qhead"><span class="pill">Табела по прашање ${qi + 1} / ${N}</span><span class="pill">PIN ${esc(pin)}</span></div>
        <div class="board">${list.map((p, i) => `<div class="brow" style="animation-delay:${i * .12}s"><span class="rk">${i + 1}</span><span class="nm">${esc(p.name)}</span>${p.lastPoints ? `<span class="dl">+${p.lastPoints}</span>` : ''}<span class="sc">${p.score || 0}</span></div>`).join('') || '<p class="muted" style="text-align:center">Нема играчи</p>'}</div>
        <div class="footer-actions">${last ? '' : '<button class="btn ghost sm" id="finish">🏁 Заврши ја играта</button>'}<button class="btn accent sm" id="next" style="font-size:18px">${last ? 'Победници 🥇' : 'Следно прашање ▶'}</button></div>
      </div>`);
      document.getElementById('next').onclick = () => last ? store.set(`${P}/public/state`, 'podium') : startQuestion(qi + 1);
      const fin = document.getElementById('finish');
      if (fin) fin.onclick = () => { if (confirm('Да се заврши играта сега и да се прикажат победниците?')) store.set(`${P}/public/state`, 'podium'); };
    }
    if (s === 'podium') {
      const list = sorted(g.players); const [a, b, c] = list;
      const pod = (p, cls, medal, n) => p ? `<div class="pod ${cls}"><div class="medal">${medal}</div><div class="name">${esc(p.name)}</div><div class="score">${p.score || 0} поени</div><div class="block">${n}</div></div>` : '<div></div>';
      render(`<div class="screen">
        <div class="qhead"><h1 class="brand" style="font-size:24px">🏆 Победници</h1><span class="pill">${esc(QZ.title)}</span></div>
        <div class="podium">${pod(b, 'p2', '🥈', 2)}${pod(a, 'p1', '🥇', 1)}${pod(c, 'p3', '🥉', 3)}</div>
        <div class="rest">${list.slice(3).map((p, i) => `<div><span>${i + 4}. ${esc(p.name)}</span><span>${p.score || 0}</span></div>`).join('')}</div>
        <div class="footer-actions"><button class="btn ghost sm" id="csv">⬇ Резултати (CSV)</button><button class="btn ghost sm" onclick="go('#/host')">Нова игра</button></div>
      </div>`);
      document.getElementById('csv').onclick = () => {
        const rows = [['Место', 'Име', 'Поени', 'Точни одговори']].concat(list.map((p, i) => [i + 1, p.name, p.score || 0, p.correctCount || 0]));
        download(`rezultati-${pin}.csv`, '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
      };
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
        const chips = () => [...box.querySelectorAll('.player')];
        const have = new Set(chips().map(el => el.dataset.id));
        list.forEach(p => { if (!have.has(p.id)) { const el = document.createElement('div'); el.className = 'player'; el.dataset.id = p.id; el.textContent = p.name; box.appendChild(el); } });
        chips().forEach(el => { if (!list.find(p => p.id === el.dataset.id)) el.remove(); });
        const w = document.getElementById('waiting'); if (w) w.hidden = list.length > 0;
      }
      const st = document.getElementById('start');
      if (st) { st.disabled = list.length === 0; st.textContent = list.length ? `Старт ▶ (${list.length})` : 'Старт ▶'; }
      const hint = document.getElementById('startHint'); if (hint) hint.hidden = list.length > 0;
    }
    if (s === 'question') {
      const n = count(g.answers && g.answers[qi]), total = count(g.players);
      const ac = document.getElementById('acount'); if (ac) ac.textContent = `${n} / ${total}`;
      const pb = document.getElementById('pause'); if (pb) pb.textContent = g.public.pausedAt ? '▶ Продолжи' : '⏸ Пауза';
      if (total > 0 && n >= total && !ending && !endTimer) endTimer = setTimeout(() => endQuestion(), 800);
      if (!timerOn) {
        timerOn = true;
        every(100, () => {
          if (!g || g.public.state !== 'question') return;
          const p = g.public, dur = (p.duration || 20) * 1000, rem = remaining(p);
          const t = document.getElementById('timer');
          if (t) { t.style.setProperty('--p', Math.max(0, Math.min(100, rem / dur * 100)) + '%'); t.firstElementChild.textContent = p.pausedAt ? '⏸' : fmtTime(rem); t.classList.toggle('paused-t', !!p.pausedAt); }
          if (!p.pausedAt && rem <= 0) endQuestion();
        });
      }
    }
  }

  async function startQuestion(i) {
    const q = QZ.questions[i];
    await store.update(`${P}/public`, { state: 'question', qIndex: i, qStartedAt: store.serverTimestamp(), duration: qTime(QZ, q), pausedAt: null, pausedMs: 0, counts: null });
  }

  async function endQuestion() {
    if (ending || !g || g.public.state !== 'question') return; ending = true;
    try {
      const p = g.public, qi = p.qIndex, q = QZ.questions[qi], dur = (p.duration || 20) * 1000, started = p.qStartedAt;
      const [answers, players] = await Promise.all([store.get(`${P}/answers/${qi}`), store.get(`${P}/players`)]);
      const counts = q.answers.map(() => 0), rows = [];
      for (const id in (players || {})) {
        const pl = players[id], a = answers && answers[id];
        let points = 0, correct = false, choice = null, t = dur;
        if (a && typeof a.choice === 'number' && a.choice >= 0 && a.choice < q.answers.length) {
          choice = a.choice; counts[choice]++;
          const el = Math.max(0, (typeof a.at === 'number' ? a.at : started) - started - (a.p || 0));
          t = Math.min(el, dur);
          if (el <= dur + 2500 && q.correct.includes(choice)) { correct = true; points = Math.round(pts(el, dur) * q.points / 1000); }
        }
        rows.push({ id, correct, choice, points, score: (pl.score || 0) + points, totalTime: (pl.totalTime || 0) + t, joinedAt: pl.joinedAt || 0, correctCount: (pl.correctCount || 0) + (correct ? 1 : 0) });
      }
      rows.sort((a, b) => b.score - a.score || a.totalTime - b.totalTime || a.joinedAt - b.joinedAt);
      const upd = {};
      rows.forEach((r, i) => {
        upd[`players/${r.id}/score`] = r.score; upd[`players/${r.id}/lastPoints`] = r.points;
        upd[`players/${r.id}/lastCorrect`] = r.correct; upd[`players/${r.id}/lastChoice`] = r.choice;
        upd[`players/${r.id}/totalTime`] = r.totalTime; upd[`players/${r.id}/rank`] = i + 1;
        upd[`players/${r.id}/correctCount`] = r.correctCount;
      });
      upd['public/counts'] = counts; upd['public/state'] = 'reveal'; upd['public/pausedAt'] = null;
      await store.update(P, upd);
    } catch (e) { console.error(e); ending = false; alert('Грешка при завршување на прашањето: ' + e.message); }
  }
}

/* ================= player ================= */
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
      const ident = JSON.stringify({ id, name: final });
      localStorage.setItem('vrquiz_player_' + pin, ident); sessionStorage.setItem('vrquiz_player_' + pin, ident);
      go('#/play/' + pin); if (location.hash === '#/play/' + pin) route();
    } catch (e) { console.error(e); err.textContent = 'Грешка: ' + e.message; b.disabled = false; }
  };
  document.getElementById('join').onclick = doJoin;
  nameEl.onkeydown = e => { if (e.key === 'Enter') doJoin(); };
}

function playGame(pin, myId) {
  const P = `games/${pin}`;
  let pub = null, me = null, QZ = null, viewKey = null, answered = null, checking = null, meMissing = false;
  render(`<div class="screen center"><p class="muted">Се поврзува…</p></div>`);
  store.get(`${P}/quiz`).then(raw => { QZ = raw ? normQuiz(raw, 'game') : builtinQuiz(); update(); }).catch(() => { QZ = builtinQuiz(); update(); });
  sub(`${P}/public`, v => { pub = v; update(); });
  sub(`${P}/players/${myId}`, v => { me = v; meMissing = (v === null); update(); });

  async function update() {
    if (!QZ || (pub === null && me === null)) return;
    if (pub === null || meMissing) {
      if (viewKey === 'gone') return; viewKey = 'gone';
      localStorage.removeItem('vrquiz_player_' + pin); sessionStorage.removeItem('vrquiz_player_' + pin);
      render(`<div class="screen center"><div class="card"><h2>Не си во играта</h2><p style="color:#6b6480">Играта не постои или си отстранет/а од водителот.</p><button class="btn" onclick="location.hash='#/play';location.reload()">Приклучи се повторно</button></div></div>`);
      return;
    }
    if (!me) return;
    const s = pub.state, qi = pub.qIndex;
    if (s === 'question' && answered !== qi && checking !== qi) {
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
    const s = pub.state, qi = pub.qIndex, q = QZ.questions[qi], N = QZ.questions.length;
    if (s === 'lobby') {
      render(`<div class="screen">${header()}<div class="center" style="flex:1;display:flex;flex-direction:column">
        <div class="big">🎉</div><h2>Внатре си, ${esc(me.name)}!</h2><p class="muted">Го гледаш своето име на големиот екран? Супер!<br>Почекај водителот да кликне Старт.</p>
        <p class="muted" style="margin-top:18px;font-size:14px">Кога ќе почне: прашањето е на големиот екран, а ти ја притискаш бојата на одговорот на телефонот. Побрзиот точен одговор носи повеќе поени.</p></div></div>`);
    }
    if (s === 'question' && answered !== qi) {
      render(`<div class="screen">${header()}
        <div class="row" style="justify-content:space-between;margin-bottom:12px"><span class="pill">Прашање ${qi + 1} / ${N}</span><span class="pill" id="ptimer">${pub.duration || ''}</span></div>
        ${pub.showQuestion ? `<div class="pq">${esc(q.text)}</div>` : ''}
        <p class="pad-hint">Притисни го точниот одговор 👇</p>
        <div class="pads ${q.answers.length <= 2 ? 'two' : ''}">${q.answers.map((a, i) => `<button class="pad c${i}" data-i="${i}"><span class="shape">${SHAPES[i]}</span>${LETTERS[i]}${pub.showText ? `<small>${esc(a)}</small>` : ''}</button>`).join('')}</div>
        <div class="paused" id="paused" hidden>⏸<br><small>Пауза, почекај…</small></div>
      </div>`);
      document.querySelector('.pads').onclick = async e => {
        const b = e.target.closest('.pad'); if (!b || answered === qi || pub.pausedAt) return;
        if (remaining(pub) < -1500) return;
        answered = qi; viewKey = null;
        document.querySelectorAll('.pad').forEach(x => x.disabled = true);
        try { await store.set(`${P}/answers/${qi}/${myId}`, { choice: Number(b.dataset.i), at: store.serverTimestamp(), p: pub.pausedMs || 0 }); }
        catch (err) { console.error(err); answered = null; }
        update();
      };
      every(200, () => {
        if (!pub || pub.state !== 'question' || answered === qi) return;
        const el = document.getElementById('ptimer'); if (!el) return;
        const rem = remaining(pub);
        el.textContent = pub.pausedAt ? '⏸' : fmtTime(rem);
        const ps = document.getElementById('paused'); if (ps) ps.hidden = !pub.pausedAt;
        document.querySelectorAll('.pad').forEach(x => x.disabled = rem <= 0 || !!pub.pausedAt);
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
      const right = q ? (q.correct.length === q.answers.length ? 'сите одговори' : q.correct.map(i => SHAPES[i] + ' ' + LETTERS[i]).join(', ')) : '';
      render(`<div class="screen">${header()}<div class="center" style="flex:1;display:flex;flex-direction:column">
        <div class="result ${cls}"><h2>${title}</h2>
          ${hasAns ? `<div class="muted" style="margin-bottom:6px">Твој одговор: ${SHAPES[me.lastChoice]} ${LETTERS[me.lastChoice]}</div>` : ''}
          ${!me.lastCorrect && right ? `<div class="muted" style="margin-bottom:6px">Точно: ${right}</div>` : ''}
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
        <div class="big">${medal}</div><h2>${r <= 3 && r > 0 ? `Ти си на ${r}. место!` : `Заврши на ${r}. место`}</h2>
        <p class="big" style="font-size:40px">${me.score || 0} поени</p><p class="muted">Браво! Благодариме за учеството 🌍</p>
        <button class="btn ghost" style="max-width:300px;margin-top:20px" onclick="localStorage.removeItem('vrquiz_player_${esc(pin)}');sessionStorage.removeItem('vrquiz_player_${esc(pin)}');location.hash='#/';location.reload()">Излези</button>
      </div></div>`);
      if (r > 0 && r <= 3) boom({ particleCount: 150, spread: 90 });
    }
  }
}

/* ================= boot ================= */
(async function boot() {
  try { store = window.createStore(); } catch (e) { console.error(e); store = null; }
  if (store) {
    try { await store.ready(); } catch (e) { console.error(e); }
    store.onAuth(u => {
      const first = !authState.ready; authState = { ready: true, user: u };
      authWaiters.splice(0).forEach(r => r(u));
      if (!first && /^#\/admin/.test(location.hash) && !window.__dirty) route();
    });
  }
  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (window.__dirty && !confirm('Имаш незачувани промени. Да ги отфрлам и да продолжам?')) { history.replaceState(null, '', lastHash || '#/'); return; }
    lastHash = location.hash; route();
  });
  window.addEventListener('beforeunload', e => { if (window.__dirty) { e.preventDefault(); e.returnValue = ''; } });
  route();
})();
