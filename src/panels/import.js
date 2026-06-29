import { Storage } from '../storage.js';

export function renderImport(el) {
  const imported = Storage.load();
  const manual   = Storage.loadManual();
  const totalTx  = imported.length + manual.length;

  let html = '<div style="margin-bottom:18px"><div class="section-title">&#128229; Import &amp; Saisie</div><div style="font-size:11px;color:var(--muted)">IBKR &bull; Trade Republic &bull; Degiro &bull; Saisie manuelle</div></div>';

  if (totalTx > 0) {
    html += `<div style="background:rgba(34,212,122,.08);border:1px solid rgba(34,212,122,.2);border-radius:10px;padding:11px 14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div><div style="font-size:12px;font-weight:700;color:#22d47a">${totalTx} transaction(s) active(s)</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">Intégrées dans le portfolio</div></div>
        <button onclick="clearAll()" style="font-size:10px;color:#f43f5e;font-weight:700;padding:5px 10px;border:1px solid rgba(244,63,94,.3);border-radius:7px;background:rgba(244,63,94,.07);cursor:pointer">Effacer tout</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${imported.length ? `<span style="font-size:10px;background:rgba(124,109,255,.1);color:#7c6dff;padding:3px 8px;border-radius:6px;font-weight:600">CSV: ${imported.length}</span>` : ''}
        ${manual.length   ? `<span style="font-size:10px;background:rgba(0,200,160,.1);color:#00c8a0;padding:3px 8px;border-radius:6px;font-weight:600">Manuel: ${manual.length}</span>` : ''}
      </div>
    </div>`;
  }

  html += `<div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:16px">
    <button id="imp-tab-csv"    onclick="switchImportTab('csv')"    style="flex:1;padding:10px 0;font-size:11px;font-weight:700;border:none;background:none;color:var(--violet);border-bottom:2px solid var(--violet);cursor:pointer">CSV Import</button>
    <button id="imp-tab-manual" onclick="switchImportTab('manual')" style="flex:1;padding:10px 0;font-size:11px;font-weight:700;border:none;background:none;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer">✏️ Manuel</button>
    <button id="imp-tab-funds"  onclick="switchImportTab('funds')"  style="flex:1;padding:10px 0;font-size:11px;font-weight:700;border:none;background:none;color:var(--muted);border-bottom:2px solid transparent;cursor:pointer">📊 Fondamentaux</button>
  </div>`;

  html += `<div id="imp-zone-csv">
    <div id="imp-drop" onclick="document.getElementById('imp-file').click()" style="border:2px dashed rgba(124,109,255,.35);border-radius:14px;padding:32px 16px;text-align:center;cursor:pointer;background:rgba(124,109,255,.04);margin-bottom:16px;transition:border-color .2s" ondragover="event.preventDefault();this.style.borderColor='var(--violet)'" ondragleave="this.style.borderColor='rgba(124,109,255,.35)'" ondrop="handleDrop(event)">
      <div style="font-size:28px;margin-bottom:8px">&#128229;</div>
      <div style="font-weight:700;font-size:14px;margin-bottom:4px">Glisser un fichier CSV ici</div>
      <div style="font-size:11px;color:var(--muted)">ou cliquer pour sélectionner</div>
      <div style="font-size:10px;color:var(--muted);margin-top:8px">IBKR &bull; Trade Republic &bull; Degiro</div>
    </div>
    <input type="file" id="imp-file" accept=".csv,.txt" style="display:none" onchange="handleFile(this.files[0])">
    <div id="imp-status"></div><div id="imp-preview"></div>
  </div>`;

  const today = new Date().toISOString().split('T')[0];
  html += `<div id="imp-zone-manual" style="display:none">
    <div style="background:var(--surface);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:14px;color:var(--teal)">✏️ Nouvelle transaction</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Type *</div>
          <select id="mt-type" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:inherit;font-size:13px">
            <option value="buy">▲ Achat</option>
            <option value="sell">▼ Vente</option>
            <option value="dividend">$ Dividende</option>
            <option value="withholding_tax">% Retenue fiscale</option>
          </select>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Ticker *</div>
          <input id="mt-ticker" type="text" placeholder="ex: JNJ" maxlength="10" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px;text-transform:uppercase">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Quantité *</div>
          <input id="mt-qty" type="number" placeholder="0" min="0" step="any" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Prix *</div>
          <input id="mt-price" type="number" placeholder="0.00" min="0" step="any" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Frais</div>
          <input id="mt-fees" type="number" placeholder="0.00" min="0" step="any" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Retenue tax</div>
          <input id="mt-tax" type="number" placeholder="0.00" min="0" step="any" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:DM Mono,monospace;font-size:13px">
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Devise</div>
          <select id="mt-currency" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:inherit;font-size:13px">
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="JPY">JPY</option>
          </select>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px">Date *</div>
          <input id="mt-date" type="date" value="${today}" style="width:100%;padding:9px 10px;border-radius:9px;background:var(--surface2);color:var(--text);border:1px solid var(--border);font-family:inherit;font-size:13px">
        </div>
      </div>

      <div id="mt-error" style="display:none;color:#f43f5e;font-size:11px;margin-bottom:10px;padding:8px 12px;background:rgba(244,63,94,.08);border-radius:8px"></div>
      <div id="mt-success" style="display:none;color:#22d47a;font-size:11px;margin-bottom:10px;padding:8px 12px;background:rgba(34,212,122,.08);border-radius:8px;text-align:center"></div>

      <button onclick="addManualTransaction()" style="width:100%;padding:13px;border-radius:12px;background:var(--teal);color:#08080f;font-weight:700;font-size:14px;cursor:pointer;border:none">
        &#10003; Ajouter la transaction
      </button>
    </div>

    <div id="manual-list"></div>
  </div>`;

  html += `<div id="imp-zone-funds" style="display:none">
    <div style="background:var(--surface);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <div style="font-size:13px;font-weight:700;color:#f59e0b">📊 Fondamentaux par ticker</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">Édition manuelle · Les valeurs API sont conservées entre rechargements</div>
        </div>
        <button onclick="saveFundamentalsForm()" style="font-size:11px;font-weight:700;padding:7px 14px;border-radius:9px;background:rgba(245,158,11,.12);color:#f59e0b;border:1px solid rgba(245,158,11,.3);cursor:pointer">💾 Sauvegarder</button>
      </div>
      <div id="funds-table"></div>
    </div>
  </div>`;

  el.innerHTML = html;

  window.renderManualList?.();
  window.renderFundamentalsTable?.();
}

export function renderImportStatus(res) {
  const el = document.getElementById('imp-status');
  if (!el) return;
  if (res.error) { el.innerHTML = `<div style="background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);border-radius:10px;padding:12px;margin-bottom:12px;color:#f43f5e;font-size:12px">&#10060; ${res.error}</div>`; return; }
  const bColor = {IBKR:'#7c6dff', TradeRepublic:'#00c8a0', Degiro:'#38bdf8', Unknown:'#f5a623'};
  const col = bColor[res.broker] || '#f5a623';
  el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><span style="background:rgba(124,109,255,.1);color:${col};border:1px solid ${col}33;padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700">${res.broker}</span><span style="background:rgba(34,212,122,.08);color:#22d47a;border:1px solid rgba(34,212,122,.2);padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700">${res.ok.length} valides</span>${res.dupes?`<span style="background:rgba(245,166,35,.08);color:#f5a623;border:1px solid rgba(245,166,35,.2);padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700">${res.dupes} doublons ignorés</span>`:''}${res.skipped.length?`<span style="background:rgba(244,63,94,.08);color:#f43f5e;border:1px solid rgba(244,63,94,.2);padding:4px 10px;border-radius:7px;font-size:11px;font-weight:700">${res.skipped.length} ignorées</span>`:''}</div>`;
}

export function renderImportPreview(res) {
  const el = document.getElementById('imp-preview');
  if (!el || !res?.ok) return;
  if (!res.ok.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;text-align:center">Aucune transaction valide détectée.</div>'; return; }
  const typeColor = {buy:'#22d47a',sell:'#f43f5e',dividend:'#7c6dff',withholding_tax:'#f5a623',stock_split:'#38bdf8'};
  const typeIcon  = {buy:'▲',sell:'▼',dividend:'$',withholding_tax:'%',stock_split:'⇌'};
  let html = `<div style="font-size:13px;font-weight:700;margin-bottom:10px">Aperçu — ${res.ok.length} transaction(s)</div>`;
  html += '<div class="twrap" style="margin-bottom:14px"><table><thead><tr><th>TYPE</th><th>TICKER</th><th>DATE</th><th>QTÉ</th><th>PRIX</th><th>FRAIS</th><th>TAX</th><th>DEVISE</th></tr></thead><tbody>';
  for (const t of res.ok) {
    const tc = typeColor[t.type]||'#8888aa', ti = typeIcon[t.type]||'?';
    html += `<tr><td><span style="color:${tc};font-weight:700;font-size:11px">${ti} ${t.type}</span></td><td style="font-weight:700;font-size:12px">${t.ticker}</td><td style="font-family:DM Mono,monospace;font-size:11px;color:var(--muted)">${t.date}</td><td style="font-family:DM Mono,monospace;font-size:11px">${t.quantity}</td><td style="font-family:DM Mono,monospace;font-size:11px">${t.price.toFixed(3)}</td><td style="font-family:DM Mono,monospace;font-size:11px">${t.fees.toFixed(2)}</td><td style="font-family:DM Mono,monospace;font-size:11px">${t.tax_withheld.toFixed(2)}</td><td style="font-size:11px">${t.currency}</td></tr>`;
  }
  html += '</tbody></table></div>';
  if (res.skipped.length) { html += `<details style="margin-bottom:14px"><summary style="font-size:11px;color:var(--muted);cursor:pointer">${res.skipped.length} ligne(s) ignorée(s)</summary><div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">${res.skipped.map(s=>`<div style="font-size:10px;color:var(--muted);padding:4px 8px;background:var(--surface2);border-radius:6px">Ligne ${s.row} — ${s.reason}</div>`).join('')}</div></details>`; }
  html += `<div style="display:flex;gap:10px"><button onclick="validateImport()" style="flex:1;padding:13px;border-radius:12px;background:var(--violet);color:#fff;font-weight:700;font-size:14px;cursor:pointer;border:none">&#10003; Valider & Sauvegarder (${res.ok.length})</button><button onclick="cancelImport()" style="padding:13px 16px;border-radius:12px;background:var(--surface2);color:var(--muted);font-weight:700;font-size:13px;cursor:pointer;border:none">&#10005;</button></div>`;
  el.innerHTML = html;
}
