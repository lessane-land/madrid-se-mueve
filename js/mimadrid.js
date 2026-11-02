// Mi Madrid: your places and your lines, answered in big blocks. Saved only in this browser.
window.MiMadrid = (() => {
  const { C, on, state, norm } = MSM;
  const $ = (id) => document.getElementById(id);
  const KEY = 'msm.mimadrid.v1';
  const fmt = new Intl.NumberFormat('es', { useGrouping: 'always' });
  const M = (a, b) => { const dx = (b.lon - a.lon) * 85000, dy = (b.lat - a.lat) * 111000; return Math.hypot(dx, dy); };
  let cfg = load(), busCache = new Map(), busTimer = 0, index = null;

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || { places: [], lines: [], buses: '' }; } catch { return { places: [], lines: [], buses: '' }; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const light = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150; };

  function nearestBike(p) {
    let best = null;
    for (const b of state.bikes?.list ?? []) { if (!b.ok) continue; const m = M(p, b); if (!best || m < best.m) best = { ...b, m }; }
    return best;
  }
  function nearBikes(p, n) { return (state.bikes?.list ?? []).filter((b) => b.ok).map((b) => ({ ...b, m: M(p, b) })).sort((a, b) => a.m - b.m).slice(0, n); }
  function nearStops(p, mode, max, n) {
    return (mode === 'emt' ? state.graph?.emt ?? [] : [...(state.graph?.stops.values() ?? [])].filter((s) => s.m === mode))
      .map((s) => ({ s, m: M(p, { lat: s.la, lon: s.lo }) })).filter((x) => x.m <= max).sort((a, b) => a.m - b.m).slice(0, n);
  }
  function lineState(id) {
    const items = (state.status?.items ?? []).filter((i) => i.lineId === id);
    const red = items.find((i) => i.red);
    if (red) return { word: 'Cortada', color: C.rojo, text: red.scope?.from ? `Entre ${red.scope.from} y ${red.scope.to}.` : red.title };
    if (items.length) return { word: 'Con avisos', color: C.ambar, text: items[0].title };
    return { word: 'Normal', color: C.verde, text: 'Sin avisos ahora.' };
  }

  // Search over rail stations, BiciMAD stations and EMT stops.
  function buildIndex() {
    if (!state.graph || !state.bikes) return;
    const seen = new Set(); index = [];
    for (const s of state.graph.stops.values()) {
      if (!['metro', 'metro_ligero', 'cercanias', 'emt'].includes(s.m)) continue;
      const kind = s.m === 'emt' ? `Parada EMT ${s.i.split(':')[1]}` : s.m === 'cercanias' ? 'Cercanías' : s.m === 'metro' ? 'Metro' : 'Metro Ligero';
      const key = s.m + norm(s.n); if (s.m !== 'emt' && seen.has(key)) continue; seen.add(key);
      index.push({ name: s.n, kind, lat: s.la, lon: s.lo, k: norm(s.n), rank: s.m === 'emt' ? 2 : 0 });
    }
    for (const b of state.bikes.list) index.push({ name: b.name, kind: 'BiciMAD', lat: b.lat, lon: b.lon, k: norm(b.name), rank: 1 });
  }
  function search(q) {
    const n = norm(q); if (n.length < 2 || !index) return [];
    return index.filter((x) => x.k.includes(n)).sort((a, b) => (a.k.startsWith(n) ? 0 : 1) - (b.k.startsWith(n) ? 0 : 1) || a.rank - b.rank || a.k.length - b.k.length).slice(0, 8);
  }

  async function buses(p) {
    const stops = nearStops(p, 'emt', 450, 2).map((x) => x.s.i.split(':')[1]);
    if (!stops.length) return null;
    const key = stops.join(','), hit = busCache.get(key);
    if (hit && Date.now() - hit.at < 40000) return hit.list;
    try { const list = await MSM.busesNear(stops); busCache.set(key, { at: Date.now(), list }); return list; } catch { return hit?.list ?? null; }
  }

  function renderBlocks() {
    const grid = $('mmGrid'); grid.replaceChildren();
    if (!cfg.places.length && !cfg.lines.length) {
      const empty = el('div', 'mm-empty');
      empty.append(el('h2', null, 'Empieza por tu casa'), el('p', null, 'Añade tus sitios y tus líneas. Aquí verás de un vistazo si tu línea va bien, cuántas bicis hay en tu estación y cuándo llega tu bus. Se guarda solo en este navegador.'));
      grid.append(empty); openEdit(true); return;
    }
    for (const id of cfg.lines) {
      const l = state.graph?.lines.get(id); if (!l) continue;
      const st = lineState(id);
      const b = el('section', 'mm-block'); b.style.setProperty('--st', st.color);
      const top = el('div', 'mm-top'); const chip = el('span', 'chip', l.b); chip.style.background = l.color; chip.style.color = light(l.color) ? C.ink : C.paper;
      top.append(chip, el('span', 'mm-label', l.m === 'cercanias' ? 'Cercanías' : l.m === 'metro' ? 'Metro' : 'Metro Ligero'));
      b.append(top, el('div', 'mm-big', st.word), el('p', 'mm-text', st.text));
      if (l.m === 'cercanias') { const n = (state.trains?.list ?? []).filter((t) => t.line === l.b).length; b.append(el('p', 'mm-sub', n ? `${n} tren${n > 1 ? 'es' : ''} rodando ahora` : 'Ningún tren rodando ahora')); }
      else b.append(el('p', 'mm-sub', l.n || ''));
      const a = el('a', 'mm-link', 'Ver en el mapa'); a.href = '#mapa-' + l.b; b.append(a);
      grid.append(b);
    }
    for (const p of cfg.places) {
      const b = el('section', 'mm-block mm-place');
      const top = el('div', 'mm-top'); top.append(el('span', 'mm-pin'), el('span', 'mm-label', p.label), el('span', 'mm-where', p.name));
      b.append(top);
      const bikes = nearBikes(p, 2);
      if (bikes.length) {
        const nb = bikes[0], col = nb.n === 0 ? C.rojo : nb.n < 4 ? C.ambar : C.verde;
        const row = el('div', 'mm-row');
        const big = el('div', 'mm-big', fmt.format(nb.n)); big.style.color = col;
        const txt = el('div'); txt.append(el('div', 'mm-text', `bicis en ${nb.name}`), el('div', 'mm-sub', `${nb.docks} anclajes libres · a ${Math.round(nb.m)} m${bikes[1] ? ` · ${bikes[1].n} en ${bikes[1].name}` : ''}`));
        row.append(big, txt); b.append(row);
      }
      const rail = [];
      for (const mode of ['metro', 'metro_ligero', 'cercanias']) for (const { s, m } of nearStops(p, mode, 750, 2)) rail.push({ s, m });
      if (rail.length) {
        const r = el('div', 'mm-rail');
        const lines = [...new Set(rail.flatMap(({ s }) => s.l))].filter((id) => state.graph.lines.has(id)).slice(0, 8);
        for (const id of lines) { const l = state.graph.lines.get(id), st = lineState(id); const pill = el('a', 'mm-pill', `${l.b} ${st.word.toLowerCase()}`); pill.href = '#mapa-' + l.b; pill.style.setProperty('--st', st.color); pill.style.setProperty('--lc', l.color); r.append(pill); }
        b.append(el('div', 'mm-sub', `${rail[0].s.n}, a ${Math.round(rail[0].m)} m`), r);
      }
      const bus = el('div', 'mm-bus'); bus.dataset.place = p.id; bus.append(el('div', 'mm-sub', 'Buses de EMT cerca: cargando'));
      b.append(bus);
      grid.append(b);
    }
    fillBuses();
  }

  async function fillBuses() {
    const want = cfg.buses.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    for (const p of cfg.places) {
      const box = document.querySelector(`.mm-bus[data-place="${p.id}"]`); if (!box) continue;
      const list = await buses(p);
      box.replaceChildren();
      if (list == null) { box.append(el('div', 'mm-sub', 'Sin paradas de EMT a menos de 450 m.')); continue; }
      const rows = list.filter((v) => v.secs != null && (!want.length || want.includes(String(v.line).toUpperCase()))).sort((a, b) => a.secs - b.secs).slice(0, 4);
      if (!rows.length) { box.append(el('div', 'mm-sub', want.length ? `Ningún ${want.join(', ')} a la vista ahora.` : 'Ningún bus a la vista ahora.')); continue; }
      const ul = el('ul', 'mm-buses');
      for (const v of rows) {
        const li = el('li'); const ln = el('span', 'bus', v.line); const t = el('span', 'mm-eta', v.secs < 60 ? 'llegando' : `${Math.round(v.secs / 60)} min`);
        li.append(ln, el('span', 'mm-dest', v.dest), t); ul.append(li);
      }
      box.append(ul);
    }
  }

  function openEdit(force) {
    const panel = $('mmEdit'); panel.hidden = force ? false : !panel.hidden;
    if (!panel.hidden) renderEdit();
  }
  function renderEdit() {
    const list = $('mmPlaces'); list.replaceChildren();
    for (const p of cfg.places) {
      const li = el('li'); li.append(el('b', null, p.label), el('span', null, p.name));
      const x = el('button', 'mm-x', 'Quitar'); x.type = 'button'; x.onclick = () => { cfg.places = cfg.places.filter((q) => q.id !== p.id); save(); renderEdit(); renderBlocks(); };
      li.append(x); list.append(li);
    }
    const chips = $('mmLines'); chips.replaceChildren();
    const lines = [...(state.graph?.lines.values() ?? [])].sort((a, b) => a.m.localeCompare(b.m) || a.b.localeCompare(b.b, 'es', { numeric: true }));
    for (const l of lines) {
      const on = cfg.lines.includes(l.i);
      const c = el('button', 'mm-chip', l.b); c.type = 'button'; c.setAttribute('aria-pressed', on);
      c.style.setProperty('--lc', l.color); c.title = l.n || l.b;
      c.onclick = () => { cfg.lines = on ? cfg.lines.filter((x) => x !== l.i) : [...cfg.lines, l.i]; save(); renderEdit(); renderBlocks(); };
      chips.append(c);
    }
    $('mmBuses').value = cfg.buses;
  }
  function addPlace(label, hit) {
    cfg.places.push({ id: Date.now().toString(36), label: label || 'Sitio', name: hit.name, lat: hit.lat, lon: hit.lon });
    save(); $('mmQuery').value = ''; $('mmHits').replaceChildren(); renderEdit(); renderBlocks();
  }

  function start() {
    $('mmEditBtn').onclick = () => openEdit();
    $('mmQuery').addEventListener('input', () => {
      const hits = $('mmHits'); hits.replaceChildren();
      for (const h of search($('mmQuery').value)) {
        const b = el('button', 'mm-hit'); b.type = 'button'; b.append(el('span', null, h.name), el('small', null, h.kind));
        b.onclick = () => addPlace($('mmLabel').value.trim(), h); hits.append(b);
      }
    });
    $('mmGeo').onclick = () => navigator.geolocation?.getCurrentPosition(
      (pos) => addPlace($('mmLabel').value.trim() || 'Aquí', { name: 'Mi ubicación', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { $('mmGeo').textContent = 'No se pudo leer tu ubicación'; }, { enableHighAccuracy: true, timeout: 10000 });
    $('mmBuses').addEventListener('change', () => { cfg.buses = $('mmBuses').value; save(); fillBuses(); });
    on('graph', () => { buildIndex(); renderBlocks(); });
    on('bikes', () => { if (!index) buildIndex(); if (!$('mimadrid').hidden) renderBlocks(); });
    on('status', () => { if (!$('mimadrid').hidden) renderBlocks(); });
    on('trains', () => { if (!$('mimadrid').hidden && cfg.lines.some((x) => x.startsWith('cercanias'))) renderBlocks(); });
    busTimer = setInterval(() => { if (!$('mimadrid').hidden && !document.hidden) fillBuses(); }, 45000);
  }
  return { start, shown: () => renderBlocks(), places: () => cfg.places, nearestBike };
})();
