export const D1Client = (() => {
  const BASE   = 'https://divkiller.michooo-45.workers.dev';
  const TK_KEY = 'dk_bearer';

  const getToken  = ()  => localStorage.getItem(TK_KEY) || '';
  const setToken  = t   => localStorage.setItem(TK_KEY, t.trim());
  const hasToken  = ()  => !!getToken();

  const _h = () => ({
    'Content-Type':  'application/json',
    'Authorization': 'Bearer ' + getToken(),
  });

  function _setSyncDot(state) {
    const el = document.getElementById('syncDot');
    if (!el) return;
    el.className = 'kpi-sync-dot' + (state ? ' ' + state : '');
  }

  async function sync() {
    if (!hasToken()) { _setSyncDot(''); return null; }
    _setSyncDot('syncing');
    try {
      const res = await fetch(BASE + '/api/sync', { headers: _h() });
      if (!res.ok) { _setSyncDot('error'); return null; }
      const data = await res.json();
      _setSyncDot('synced');
      return data;
    } catch(e) {
      console.warn('[D1] sync offline:', e.message);
      _setSyncDot('error');
      return null;
    }
  }

  async function addTx(tx) {
    if (!hasToken()) return null;
    try {
      const res = await fetch(BASE + '/api/transaction', {
        method: 'POST', headers: _h(), body: JSON.stringify(tx),
      });
      if (!res.ok) return null;
      return res.json();
    } catch(e) { return null; }
  }

  async function deleteTx(id) {
    if (!hasToken()) return;
    try {
      await fetch(BASE + '/api/transaction/' + id, {
        method: 'DELETE', headers: _h(),
      });
    } catch(e) {}
  }

  async function putSettings(obj) {
    if (!hasToken()) return;
    try {
      await fetch(BASE + '/api/settings', {
        method: 'PUT', headers: _h(), body: JSON.stringify(obj),
      });
    } catch(e) {}
  }

  return { sync, addTx, deleteTx, putSettings, setToken, getToken, hasToken };
})();
