export const D1Client = (() => {
  const _h = () => ({ 'Content-Type': 'application/json' });
  const _opts = { credentials: 'include' };

  function _setSyncDot(state) {
    const el = document.getElementById('syncDot');
    if (!el) return;
    el.className = 'kpi-sync-dot' + (state ? ' ' + state : '');
  }

  async function me() {
    try {
      const res = await fetch('/auth/me', _opts);
      if (!res.ok) return null;
      return (await res.json()).user || null;
    } catch(_) { return null; }
  }

  function login()  { window.location.href = '/auth/login'; }
  function logout() { window.location.href = '/auth/logout'; }

  async function sync() {
    _setSyncDot('syncing');
    try {
      const res = await fetch('/api/sync', { ..._opts, headers: _h() });
      if (res.status === 401) { _setSyncDot(''); return null; }
      if (!res.ok) { _setSyncDot('error'); return null; }
      _setSyncDot('synced');
      return await res.json();
    } catch(e) {
      console.warn('[D1] sync:', e.message);
      _setSyncDot('error');
      return null;
    }
  }

  async function addTx(tx) {
    try {
      const res = await fetch('/api/transaction', {
        ..._opts, method: 'POST', headers: _h(), body: JSON.stringify(tx),
      });
      return res.ok ? res.json() : null;
    } catch(_) { return null; }
  }

  async function deleteTx(id) {
    try { await fetch(`/api/transaction/${id}`, { ..._opts, method: 'DELETE', headers: _h() }); } catch(_) {}
  }

  async function putSettings(obj) {
    try {
      await fetch('/api/settings', {
        ..._opts, method: 'PUT', headers: _h(), body: JSON.stringify(obj),
      });
    } catch(_) {}
  }

  return { sync, addTx, deleteTx, putSettings, me, login, logout };
})();
