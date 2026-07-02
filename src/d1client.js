export const D1Client = (() => {
  const _h = () => ({ 'Content-Type': 'application/json' });
  const _opts = { credentials: 'include' };

  function _setSyncDot(state) {
    const el = document.getElementById('syncDot');
    if (!el) return;
    el.className = 'kpi-sync-dot' + (state ? ' ' + state : '');
  }

  // Tente un refresh silencieux quand le serveur répond 401
  let _refreshing = null;
  async function _tryRefresh() {
    if (_refreshing) return _refreshing;
    _refreshing = fetch('/auth/refresh', { ...(_opts), method: 'POST' })
      .then(r => r.ok)
      .catch(() => false)
      .finally(() => { _refreshing = null; });
    return _refreshing;
  }

  async function _apiFetch(url, opts) {
    let res = await fetch(url, { ...(_opts), ...opts });
    if (res.status === 401) {
      const ok = await _tryRefresh();
      if (ok) res = await fetch(url, { ...(_opts), ...opts });
      else { window.location.href = '/auth/login'; return res; }
    }
    return res;
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
      const res = await _apiFetch('/api/sync', { headers: _h() });
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
      const res = await _apiFetch('/api/transaction', {
        method: 'POST', headers: _h(), body: JSON.stringify(tx),
      });
      return res.ok ? res.json() : null;
    } catch(_) { return null; }
  }

  async function deleteTx(id) {
    try { await _apiFetch(`/api/transaction/${id}`, { method: 'DELETE', headers: _h() }); } catch(_) {}
  }

  async function subscribePush(sub) {
    try {
      await _apiFetch('/api/push/subscribe', {
        method: 'POST', headers: _h(), body: JSON.stringify(sub),
      });
    } catch(_) {}
  }

  async function unsubscribePush(endpoint) {
    try {
      await _apiFetch('/api/push/unsubscribe', {
        method: 'POST', headers: _h(), body: JSON.stringify({ endpoint }),
      });
    } catch(_) {}
  }

  async function putSettings(obj) {
    try {
      await _apiFetch('/api/settings', {
        method: 'PUT', headers: _h(), body: JSON.stringify(obj),
      });
    } catch(_) {}
  }

  return { sync, addTx, deleteTx, putSettings, me, login, logout, subscribePush, unsubscribePush };
})();
