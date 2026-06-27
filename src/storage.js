import { Config } from './config.js';
import { Data } from './data.js';
import { D1Client } from './d1client.js';

const _AES = (() => {
  async function deriveKey() {
    const raw = new TextEncoder().encode(`astra_key_${location.hostname||'local'}_v1`);
    const base = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt: new TextEncoder().encode('astra_salt_2024'), iterations:100000, hash:'SHA-256' },
      base, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
    );
  }
  async function encrypt(data) {
    const key = await deriveKey();
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, new TextEncoder().encode(JSON.stringify(data)));
    const out = new Uint8Array(12 + enc.byteLength);
    out.set(iv); out.set(new Uint8Array(enc), 12);
    return btoa(String.fromCharCode(...out));
  }
  async function decrypt(b64) {
    const key  = await deriveKey();
    const buf  = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dec  = await crypto.subtle.decrypt({name:'AES-GCM', iv: buf.slice(0,12)}, key, buf.slice(12));
    return JSON.parse(new TextDecoder().decode(dec));
  }
  return { encrypt, decrypt };
})();

/* ── IndexedDB core ── */
const AstraDB = (() => {
  const DB_NAME = 'astra_db', DB_VERSION = 1;
  const STORES = { transactions:'transactions', snapshots:'snapshots', settings:'settings', dividendHistory:'dividend_history' };
  const ENC_STORES = new Set(['transactions','settings']);
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('transactions')) {
          const s = db.createObjectStore('transactions', {keyPath:'id', autoIncrement:true});
          s.createIndex('ticker','ticker',{unique:false});
          s.createIndex('date','date',{unique:false});
        }
        if (!db.objectStoreNames.contains('snapshots'))
          db.createObjectStore('snapshots', {keyPath:'date'});
        if (!db.objectStoreNames.contains('settings'))
          db.createObjectStore('settings', {keyPath:'key'});
        if (!db.objectStoreNames.contains('dividend_history')) {
          const dh = db.createObjectStore('dividend_history', {keyPath:'id', autoIncrement:true});
          dh.createIndex('ticker','ticker',{unique:false});
        }
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  async function getAll(storeName) {
    const db  = await open();
    const enc = ENC_STORES.has(storeName);
    return new Promise((res, rej) => {
      const req = db.transaction(storeName,'readonly').objectStore(storeName).getAll();
      req.onsuccess = async e => {
        if (!enc) { res(e.target.result); return; }
        try {
          res(await Promise.all(e.target.result.map(r => r.__enc ? _AES.decrypt(r.payload) : r)));
        } catch(err) { console.error('[AstraDB] decrypt',err); res([]); }
      };
      req.onerror = e => rej(e.target.error);
    });
  }

  async function get(storeName, key) {
    const db  = await open();
    const enc = ENC_STORES.has(storeName);
    return new Promise((res, rej) => {
      const req = db.transaction(storeName,'readonly').objectStore(storeName).get(key);
      req.onsuccess = async e => {
        const r = e.target.result;
        if (!r) { res(null); return; }
        res(enc && r.__enc ? await _AES.decrypt(r.payload) : r);
      };
      req.onerror = e => rej(e.target.error);
    });
  }

  async function putAll(storeName, items) {
    const db  = await open();
    const enc = ENC_STORES.has(storeName);
    // Pre-encrypt all items BEFORE opening the transaction — an async gap
    // inside a transaction causes IndexedDB to auto-commit before any put.
    const storedItems = enc
      ? await Promise.all(items.map(async item => {
          const payload = await _AES.encrypt(item);
          const outer = { __enc:true, payload };
          if (item.id     !== undefined) outer.id     = item.id;
          if (item.source !== undefined) outer.source = item.source;
          return outer;
        }))
      : items;
    return new Promise((res, rej) => {
      const tx    = db.transaction(storeName,'readwrite');
      const store = tx.objectStore(storeName);
      for (const item of storedItems) {
        const r = store.put(item);
        r.onerror = e => rej(e.target.error);
      }
      tx.oncomplete = () => res(true);
      tx.onerror    = e  => rej(e.target.error);
    });
  }

  async function deleteRecord(storeName, key) {
    const db = await open();
    return new Promise((res, rej) => {
      const req = db.transaction(storeName,'readwrite').objectStore(storeName).delete(key);
      req.onsuccess = () => res(true);
      req.onerror   = e  => rej(e.target.error);
    });
  }

  async function clearBySource(source) {
    const db = await open();
    const all = await getAll('transactions');
    return new Promise((res, rej) => {
      const tx = db.transaction('transactions','readwrite');
      const store = tx.objectStore('transactions');
      const cur = store.openCursor();
      cur.onsuccess = e => {
        const c = e.target.result;
        if (!c) return;
        if (source === null || c.value.source === source || (source === 'imported' && c.value.source !== 'manual'))
          c.delete();
        c.continue();
      };
      tx.oncomplete = res;
      tx.onerror    = e => rej(e.target.error);
    });
  }

  async function getSetting(key, def=null) {
    const r = await get('settings', key);
    return r ? r.value : def;
  }
  async function setSetting(key, value) {
    const db = await open();
    return new Promise((res, rej) => {
      const req = db.transaction('settings','readwrite').objectStore('settings').put({key, value});
      req.onsuccess = () => res(true);
      req.onerror   = e  => rej(e.target.error);
    });
  }

  /* API publique générique */
  async function saveData(storeName, data, id=null) {
    const items = Array.isArray(data) ? data : [data];
    if (id !== null && !Array.isArray(data)) items[0] = {...items[0], [storeName==='settings'?'key':'id']: id};
    return putAll(storeName, items);
  }
  const loadData   = (s, q=null) => q !== null ? get(s, q) : getAll(s);
  const updateData = async (s, id, patch) => {
    const ex = await get(s, id);
    if (!ex) throw new Error(`[AstraDB] updateData: ${id} not found in ${s}`);
    return saveData(s, {...ex, ...patch}, id);
  };
  const deleteData = deleteRecord;

  return { open, getAll, get, putAll, deleteRecord, clearBySource, getSetting, setSetting, saveData, loadData, updateData, deleteData, STORES };
})();

/* ── Storage (API rétrocompat + migration) ── */
const Storage = (() => {
  /* Sync wrappers — pour code legacy qui n'est pas async */
  let _cache = { imported: [], manual: [] };

  /* Chargement initial async (appelé au boot) */
  async function hydrate() {
    const all = await AstraDB.getAll('transactions');
    _cache.imported = all.filter(r => r.source !== 'manual');
    _cache.manual   = all.filter(r => r.source === 'manual');
  }

  /* Sync reads (depuis cache) */
  const load       = () => _cache.imported;
  const loadManual = () => _cache.manual;

  /* Async writes + mise à jour cache */
  const save = async arr => {
    _cache.imported = arr;
    await AstraDB.clearBySource('imported');
    if (arr.length) await AstraDB.putAll('transactions', arr.map(r => ({...r, source: r.source||'imported'})));
  };
  const saveManual = async arr => {
    _cache.manual = arr;
    await AstraDB.clearBySource('manual');
    if (arr.length) await AstraDB.putAll('transactions', arr.map(r => ({...r, source:'manual'})));
  };
  const clear       = async () => { _cache.imported = []; await AstraDB.clearBySource('imported'); };
  const clearManual = async () => { _cache.manual   = []; await AstraDB.clearBySource('manual'); };

  /* Migration depuis localStorage */
  async function migrateLS() {
    const done = await AstraDB.getSetting('migration_done');
    if (done) return;
    let n = 0;
    for (const [k, src] of [['snowball_imported','imported'],['snowball_manual','manual']]) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length) {
          await AstraDB.putAll('transactions', data.map(r => ({...r, source:src})));
          localStorage.removeItem(k);
          n++;
          console.log(`[Storage] Migration OK: ${k} (${data.length} entrées)`);
        }
      } catch(e) { console.warn('[Storage] Migration échouée:', k, e); }
    }
    await AstraDB.setSetting('migration_done', {date: new Date().toISOString(), v:1});
    if (n) console.log('[Storage] Migration localStorage → IndexedDB terminée ✓');
  }

  async function init() {
    await AstraDB.open();
    await migrateLS();
    await hydrate();

    /* Sync depuis D1 si token configuré — D1 est source de vérité pour les transactions manuelles */
    try {
      const d1 = await D1Client.sync();
      if (d1 && Array.isArray(d1.transactions) && d1.transactions.length) {
        const mapped = d1.transactions.map(tx => ({
          id:        'd1_' + tx.id,
          d1_id:     tx.id,
          ticker:    tx.ticker,
          type:      tx.type,
          quantity:  tx.shares  || 0,
          price:     tx.price   || 0,
          fees:      0,
          currency:  tx.currency || 'USD',
          amount:    tx.amount  || 0,
          date:      tx.date,
          _manual:   true,
          source:    'manual',
        }));
        _cache.manual = mapped;
        await AstraDB.clearBySource('manual');
        if (mapped.length) await AstraDB.putAll('transactions', mapped);
        console.log('[D1] Sync OK:', mapped.length, 'transactions');
      }
      if (d1 && d1.settings && d1.settings.target_monthly) {
        Config.TARGET_MONTHLY = parseFloat(d1.settings.target_monthly) || Config.TARGET_MONTHLY;
      }
    } catch(e) { console.warn('[D1] init sync:', e.message); }

    console.log('[Storage] Prêt ✓ (IndexedDB + AES-GCM + D1)');
  }

  /* ── Fondamentaux persistés (dividende, secteur, PE…) ── */
  const saveFundamentals = async (assetsObj) => {
    const clean = {};
    for (const [tk, info] of Object.entries(assetsObj)) {
      if (info && Object.keys(info).length) clean[tk] = info;
    }
    await AstraDB.setSetting('fundamentals_v1', clean);
  };
  const loadFundamentals = async () => AstraDB.getSetting('fundamentals_v1', {});

  return { load, save, clear, loadManual, saveManual, clearManual, init, hydrate, saveFundamentals, loadFundamentals };
})();

export { _AES, AstraDB, Storage };
export const loadImportedTx  = Storage.load;
export const saveImportedTx  = Storage.save;
export const clearImportedTx = Storage.clear;
