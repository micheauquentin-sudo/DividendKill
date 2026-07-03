export function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function _emptyState(icon, title, subtitle) {
  return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:55vh;padding:24px 16px;text-align:center">'
    + '<div style="font-size:48px;margin-bottom:16px">' + icon + '</div>'
    + '<div style="font-size:18px;font-weight:700;margin-bottom:8px">' + title + '</div>'
    + '<div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:24px;max-width:260px">' + subtitle + '</div>'
    + '<button onclick="goTo(9)" style="padding:12px 24px;border-radius:12px;background:var(--violet);color:#fff;font-weight:700;font-size:13px;cursor:pointer;border:none;margin-bottom:10px">📂 Importer CSV</button>'
    + '<button onclick="goTo(9);setTimeout(function(){switchImportTab(\'manual\');},100)" style="padding:12px 24px;border-radius:12px;background:var(--surface);color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;border:1px solid var(--border)">✏️ Saisie manuelle</button>'
    + '</div>';
}

/* Placeholder shimmer affiché tant que les prix/fondamentaux n'ont jamais été
   chargés (premier boot, cache vide) — évite les 0$/N/A trompeurs. */
export function _loadingSkeleton(rows) {
  rows = rows || 3;
  var card = '<div style="background:var(--surface);border-radius:14px;padding:14px;margin-bottom:10px">'
    + '<div style="display:flex;align-items:center;gap:9px;margin-bottom:14px">'
    + '<div class="dk-skel" style="width:34px;height:34px;border-radius:50%;flex-shrink:0"></div>'
    + '<div style="flex:1;min-width:0">'
    + '<div class="dk-skel" style="width:55%;height:14px;border-radius:5px;margin-bottom:6px"></div>'
    + '<div class="dk-skel" style="width:35%;height:10px;border-radius:4px"></div>'
    + '</div>'
    + '<div class="dk-skel" style="width:64px;height:22px;border-radius:7px"></div>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">'
    + '<div class="dk-skel" style="height:54px;border-radius:9px"></div>'
    + '<div class="dk-skel" style="height:54px;border-radius:9px"></div>'
    + '<div class="dk-skel" style="height:54px;border-radius:9px"></div>'
    + '<div class="dk-skel" style="height:54px;border-radius:9px"></div>'
    + '</div></div>';
  var out = '';
  for (var i = 0; i < rows; i++) out += card;
  return out;
}

export function buildSVG(pts, col, H) {
  if (!pts || pts.length < 2) return '';
  H = H || 110;
  var W = 360, mn = pts[0], mx = pts[0];
  for (var i = 1; i < pts.length; i++) { if (pts[i] < mn) mn = pts[i]; if (pts[i] > mx) mx = pts[i]; }
  var rng = mx - mn || 1;
  function px(i) { return ((i / (pts.length-1)) * W).toFixed(1); }
  function py(v) { return (H - ((v-mn)/rng*(H*0.82)+H*0.09)).toFixed(1); }
  var d = 'M' + px(0) + ' ' + py(pts[0]);
  for (var j = 1; j < pts.length; j++) d += ' L' + px(j) + ' ' + py(pts[j]);
  var fill = d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';
  var id   = 'g' + H + (col.replace('#',''));
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block;height:' + H + 'px" preserveAspectRatio="none">'
    + '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="' + col + '" stop-opacity="0.28"/>'
    + '<stop offset="100%" stop-color="' + col + '" stop-opacity="0.02"/>'
    + '</linearGradient></defs>'
    + '<path d="' + fill + '" fill="url(#' + id + ')"/>'
    + '<path d="' + d    + '" fill="none" stroke="' + col + '" stroke-width="1.8" stroke-linejoin="round"/>'
    + '</svg>';
}

export function _logo(ticker, size) {
  size = size || 28;
  return '<img src="https://financialmodelingprep.com/image-stock/' + ticker + '.png"'
    + ' width="' + size + '" height="' + size + '" alt=""'
    + ' style="border-radius:50%;object-fit:contain;background:var(--surface2);flex-shrink:0;display:inline-block"'
    + ' onerror="this.style.display=\'none\'"'
    + ' loading="lazy">';
}
