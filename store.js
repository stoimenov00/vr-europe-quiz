// Слој за податоци: Firebase Realtime Database (вистински настан) или LocalStore (тестирање во еден прелистувач).
(function () {
  const PATH = p => String(p).split('/').filter(Boolean);
  function getIn(obj, parts) { let o = obj; for (const k of parts) { if (o == null || typeof o !== 'object') return null; o = o[k]; } return o === undefined ? null : o; }
  function setIn(root, parts, val) {
    if (!parts.length) return (val == null ? {} : val);
    let o = root;
    for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
    const last = parts[parts.length - 1];
    if (val == null) delete o[last]; else o[last] = val;
    return root;
  }

  class LocalStore {
    constructor() {
      this.key = 'vrquiz_local_db';
      this.listeners = [];
      this.ch = ('BroadcastChannel' in window) ? new BroadcastChannel('vrquiz_local') : null;
      const fire = () => this._fireAll();
      if (this.ch) this.ch.onmessage = fire;
      window.addEventListener('storage', e => { if (e.key === this.key) fire(); });
    }
    get kind() { return 'local'; }
    async ready() { }
    now() { return Date.now(); }
    serverTimestamp() { return Date.now(); }
    _read() { try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch (e) { return {}; } }
    _write(db) { localStorage.setItem(this.key, JSON.stringify(db)); if (this.ch) this.ch.postMessage(1); this._fireAll(); }
    _fireAll() {
      const db = this._read();
      for (const l of this.listeners.slice()) {
        const v = getIn(db, l.parts); const s = JSON.stringify(v);
        if (s !== l.last) { l.last = s; l.cb(v); }
      }
    }
    async get(p) { return getIn(this._read(), PATH(p)); }
    async set(p, v) { this._write(setIn(this._read(), PATH(p), v)); }
    async update(p, obj) { let db = this._read(); for (const k in obj) db = setIn(db, PATH(p).concat(PATH(k)), obj[k]); this._write(db); }
    async push(p, v) { const key = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); await this.set(p + '/' + key, v); return key; }
    onValue(p, cb) {
      const l = { parts: PATH(p), cb, last: undefined };
      this.listeners.push(l);
      setTimeout(() => { if (!this.listeners.includes(l)) return; const v = getIn(this._read(), l.parts); l.last = JSON.stringify(v); cb(v); }, 0);
      return () => { this.listeners = this.listeners.filter(x => x !== l); };
    }
    onDisconnectSet() { }
    onAuth(cb) { setTimeout(() => cb({ email: 'local@test', name: 'Локален тест', local: true }), 0); }
    async signIn() { }
    async signInWithPassword() { }
    async signOut() { }
  }

  class FirebaseStore {
    constructor(cfg) {
      firebase.initializeApp(cfg);
      this.db = firebase.database();
      this.offset = 0;
      this.db.ref('.info/serverTimeOffset').on('value', s => { this.offset = s.val() || 0; });
    }
    get kind() { return 'firebase'; }
    ready() {
      return new Promise(res => {
        const r = this.db.ref('.info/connected');
        const h = r.on('value', s => { if (s.val()) { r.off('value', h); res(); } });
        setTimeout(res, 8000);
      });
    }
    now() { return Date.now() + this.offset; }
    serverTimestamp() { return firebase.database.ServerValue.TIMESTAMP; }
    async get(p) { const s = await this.db.ref(p).get(); return s.val(); }
    set(p, v) { return this.db.ref(p).set(v === undefined ? null : v); }
    update(p, obj) { return this.db.ref(p).update(obj); }
    async push(p, v) { const r = this.db.ref(p).push(); await r.set(v); return r.key; }
    onValue(p, cb) {
      const r = this.db.ref(p);
      const h = r.on('value', s => cb(s.val()), err => console.error('db error', p, err));
      return () => r.off('value', h);
    }
    onDisconnectSet(p, v) { this.db.ref(p).onDisconnect().set(v); }
    onAuth(cb) {
      if (!firebase.auth) { setTimeout(() => cb(null), 0); return; }
      firebase.auth().onAuthStateChanged(u => cb(u ? { email: (u.email || '').toLowerCase(), name: u.displayName || '', uid: u.uid } : null));
    }
    signIn() {
      const p = new firebase.auth.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      return firebase.auth().signInWithPopup(p);
    }
    signInWithPassword(email, password) { return firebase.auth().signInWithEmailAndPassword(email, password); }
    signOut() { return firebase.auth().signOut(); }
  }

  window.createStore = function () {
    const cfg = window.FIREBASE_CONFIG || {};
    const forceLocal = /[?&]local=1/.test(location.search);
    const hasFb = cfg.apiKey && cfg.databaseURL && typeof firebase !== 'undefined';
    if (forceLocal || !hasFb) {
      if (forceLocal || ['localhost', '127.0.0.1'].includes(location.hostname)) return new LocalStore();
      return null;
    }
    return new FirebaseStore(cfg);
  };
})();
