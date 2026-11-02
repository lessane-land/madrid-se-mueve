// Places: search anything in Madrid, see what is happening right there, save the places you care about.
// The search lives on Mapa and Pulso; the place card lives on Mapa; saved places feed screen mode.
window.MiMadrid = (() => {
  const { C, on, state, norm } = MSM;
  const KEY = 'msm.mimadrid.v1';
  const fmt = new Intl.NumberFormat('es', { useGrouping: 'always' });
  const M = (a, b) => { const dx = (b.lon - a.lon) * 85000, dy = (b.lat - a.lat) * 111000; return Math.hypot(dx, dy); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let cfg = load(), busCache = new Map(), index = null;
  const listeners = [];

  function load() { try { return { places: [], lines: [], buses: '', ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { places: [], lines: [], buses: '' }; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} listeners.forEach((f) => f(cfg.places)); }

  function nearBikes(p, n) { return (state.bikes?.list ?? []).filter((b) => b.ok).map((b) => ({ ...b, m: M(p, b) })).sort((a, b) => a.m - b.m).slice(0, n); }
  function nearestBike(p) { return nearBikes(p, 1)[0] || null; }
  function nearStops(p, mode, max, n) {
    return (mode === 'emt' ? state.graph?.emt ?? [] : [...(state.graph?.stops.values() ?? [])].filter((s) => s.m === mode))
      .map((s) => ({ s, m: M(p, { lat: s.la, lon: s.lo }) })).filter((x) => x.m <= max).sort((a, b) => a.m - b.m).slice(0, n);
  }
  function lineState(id) {
    const items = (state.status?.items ?? []).filter((i) => i.lineId === id);
    const red = items.find((i) => i.red);
    if (red) return { word: 'cortada', color: C.rojo, text: red.scope?.from ? `${red.scope.from} a ${red.scope.to}` : red.title };
    if (items.length) return { word: 'avisos', color: C.ambar, text: items[0].title };
    return { word: 'normal', color: C.verde, text: '' };
  }

  // Search: stations, stops and BiciMAD first, streets from OpenStreetMap after.
  function buildIndex() {
    if (!state.graph || !state.bikes || index) return;
    const seen = new Set(); index = [];
    for (const s of state.graph.stops.values()) {
      if (!['metro', 'metro_ligero', 'cercanias', 'emt'].includes(s.m)) continue;
      const kind = s.m === 'emt' ? `Parada EMT ${s.i.split(':')[1]}` : s.m === 'cercanias' ? 'Cercanías' : s.m === 'metro' ? 'Metro' : 'Metro Ligero';
      const key = s.m + norm(s.n); if (s.m !== 'emt' && seen.has(key)) continue; seen.add(key);
      index.push({ name: s.n, kind, lat: s.la, lon: s.lo, k: norm(s.n), rank: s.m === 'emt' ? 2 : 0 });
    }
    for (const b of state.bikes.list) index.push({ name: b.name, kind: 'BiciMAD', lat: b.lat, lon: b.lon, k: norm(b.name), rank: 1 });
  }
  function local(q) {
    const n = norm(q); if (n.length < 2 || !index) return [];
    return index.filter((x) => x.k.includes(n)).sort((a, b) => (a.k.startsWith(n) ? 0 : 1) - (b.k.startsWith(n) ? 0 : 1) || a.rank - b.rank || a.k.length - b.k.length).slice(0, 6);
  }
  async function streets(q) {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=4&accept-language=es&bounded=1&viewbox=-3.95,40.62,-3.45,40.28&q=${encodeURIComponent(q)}`;
    try { const r = await fetch(u); return (await r.json()).map((x) => ({ name: x.display_name.split(',').slice(0, 2).join(','), kind: 'Calle o lugar', lat: +x.lat, lon: +x.lon })); } catch { return []; }
  }

  // One search box, used on Mapa and Pulso.
  function attachSearch(root, onPick) {
    const input = root.querySelector('input'), list = root.querySelector('.s-hits'), chips = root.querySelector('.s-chips');
    let t = 0, seq = 0;
    const show = (hits) => {
      list.replaceChildren(...hits.map((h) => { const b = el('button', 's-hit'); b.type = 'button'; b.append(el('span', null, h.name), el('small', null, h.kind)); b.onclick = () => { input.value = ''; show([]); input.blur(); onPick(h); }; return b; }));
      list.hidden = !hits.length;
    };
    input.addEventListener('input', () => {
      const q = input.value.trim(), mine = ++seq; buildIndex();
      const hits = local(q); show(hits); clearTimeout(t);
      if (q.length >= 4 && hits.length < 4) t = setTimeout(async () => { const more = await streets(q); if (mine === seq) show([...hits, ...more].slice(0, 7)); }, 450);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') list.querySelector('.s-hit')?.click(); if (e.key === 'Escape') { input.value = ''; show([]); } });
    const paintChips = () => {
      chips.replaceChildren(...cfg.places.map((p) => { const b = el('button', 's-chip', p.label); b.type = 'button'; b.title = p.name; b.onclick = () => onPick(p); return b; }));
      if (navigator.geolocation) {
        const g = el('button', 's-chip s-geo', 'Dónde estoy'); g.type = 'button';
        g.onclick = () => navigator.geolocation.getCurrentPosition((pos) => onPick({ name: 'Mi ubicación', kind: 'Aquí', lat: pos.coords.latitude, lon: pos.coords.longitude }), () => { g.textContent = 'Sin ubicación'; }, { enableHighAccuracy: true, timeout: 10000 });
        chips.append(g);
      }
    };
    listeners.push(paintChips); paintChips();
  }

  // Bus stops that together cover the most lines within a short walk; your own bus lines first.
  function busStops(p) {
    const want = new Set(cfg.buses.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean));
    const near = nearStops(p, 'emt', 600, 40);
    const chosen = [], covered = new Set();
    const score = ({ s }) => s.l.map((id) => id.split(':')[1].toUpperCase()).filter((l) => !covered.has(l)).reduce((a, l) => a + (want.has(l) ? 10 : 1), 0);
    while (chosen.length < 3) {
      let best = null, bs = 0;
      for (const x of near) { if (chosen.includes(x)) continue; const sc = score(x) / (1 + x.m / 250); if (sc > bs) { bs = sc; best = x; } }
      if (!best) break;
      chosen.push(best); best.s.l.forEach((id) => covered.add(id.split(':')[1].toUpperCase()));
    }
    return chosen;
  }
  async function buses(p) {
    const stops = busStops(p).map((x) => x.s.i.split(':')[1]);
    if (!stops.length) return null;
    const key = stops.join(','), hit = busCache.get(key);
    if (hit && Date.now() - hit.at < 30000) return hit.list;
    try { const list = await MSM.busesNear(stops); busCache.set(key, { at: Date.now(), list }); return list; } catch { return hit?.list ?? null; }
  }

  // The card for a place: what is happening right there, live.
  function card(p, { onClose } = {}) {
    const box = el('div', 'pc');
    const head = el('div', 'pc-head');
    const saved0 = cfg.places.find((q) => q.id === p.id);
    const title = el('div'); title.append(el('div', 'pc-kind', saved0 ? 'Tu sitio · ' + saved0.label : p.kind || 'Sitio'), el('div', 'pc-name', p.name));
    const x = el('button', 'pc-x', 'Cerrar'); x.type = 'button'; x.onclick = () => onClose?.();
    head.append(title, x); box.append(head);

    const bikes = nearBikes(p, 3);
    if (bikes.length) {
      const nb = bikes[0], col = nb.n === 0 ? C.rojo : nb.n < 4 ? C.ambar : C.verde;
      const row = el('div', 'pc-bikes');
      const big = el('div', 'pc-big', fmt.format(nb.n)); big.style.color = col;
      const txt = el('div'); txt.append(el('div', 'pc-t', `bicis en ${nb.name}`), el('div', 'pc-s', `${nb.docks} anclajes libres · a ${Math.round(nb.m)} m`));
      for (const o of bikes.slice(1)) txt.append(el('div', 'pc-s', `${o.n} en ${o.name}, a ${Math.round(o.m)} m`));
      row.append(big, txt); box.append(row);
    }
    const rail = [];
    for (const mode of ['metro', 'metro_ligero', 'cercanias']) for (const r of nearStops(p, mode, 800, 2)) rail.push(r);
    rail.sort((a, b) => a.m - b.m);
    if (rail.length) {
      const wrap = el('div', 'pc-rail');
      wrap.append(el('div', 'pc-s', `${rail[0].s.n}, a ${Math.round(rail[0].m)} m`));
      const pills = el('div', 'pc-pills');
      for (const id of [...new Set(rail.flatMap(({ s }) => s.l))].filter((id) => state.graph.lines.has(id)).slice(0, 8)) {
        const l = state.graph.lines.get(id), st = lineState(id);
        const pill = el('a', 'pc-pill', `${l.b} ${st.word}`); pill.href = '#mapa-' + l.b; pill.title = st.text; pill.style.setProperty('--st', st.color); pill.style.setProperty('--lc', l.color);
        pills.append(pill);
      }
      wrap.append(pills); box.append(wrap);
    }
    const busBox = el('div', 'pc-buses'); busBox.append(el('div', 'pc-s', 'Buses llegando: cargando'));
    box.append(busBox);
    const fill = async () => {
      const list = await buses(p);
      busBox.replaceChildren();
      if (list == null) { busBox.append(el('div', 'pc-s', 'Sin paradas de EMT a menos de 600 m.')); return; }
      const rows = list.filter((v) => v.secs != null).sort((a, b) => a.secs - b.secs).slice(0, 6);
      if (!rows.length) { busBox.append(el('div', 'pc-s', 'Ningún bus a la vista ahora.')); return; }
      const ul = el('ul');
      for (const v of rows) {
        const stop = state.graph?.stops.get('emt:' + v.stop);
        const li = el('li'); const d = el('span', 'pc-dest'); d.append(document.createTextNode(v.dest), el('small', null, stop ? ` · ${stop.n}` : ''));
        li.append(el('span', 'bus', v.line), d, el('span', 'pc-eta', v.secs < 60 ? 'llegando' : `${Math.round(v.secs / 60)} min`)); ul.append(li);
      }
      busBox.append(ul);
    };
    fill(); const timer = setInterval(() => { if (box.isConnected) fill(); else clearInterval(timer); }, 30000);

    const foot = el('div', 'pc-foot');
    if (saved0) {
      const rm = el('button', 'pc-btn', `Quitar "${saved0.label}"`); rm.type = 'button';
      rm.onclick = () => { cfg.places = cfg.places.filter((q) => q.id !== saved0.id); save(); onClose?.(); };
      foot.append(rm);
    } else {
      foot.append(el('span', 'pc-s', 'Guardar como'));
      const name = el('input'); name.type = 'text'; name.placeholder = 'Otro nombre'; name.setAttribute('aria-label', 'Nombre del sitio');
      const keep = (label) => {
        label = (label || '').trim(); if (!label) return;
        cfg.places = cfg.places.filter((q) => q.label !== label);
        cfg.places.push({ id: Date.now().toString(36), label, name: p.name, lat: p.lat, lon: p.lon }); save();
        foot.replaceChildren(el('span', 'pc-s', `Guardado como ${label}. El modo pantalla lo visitará.`));
      };
      for (const n of ['Casa', 'Trabajo']) { const b = el('button', 'pc-btn', n); b.type = 'button'; b.onclick = () => keep(n); foot.append(b); }
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') keep(name.value); });
      const ok = el('button', 'pc-btn', 'Guardar'); ok.type = 'button'; ok.onclick = () => keep(name.value);
      foot.append(name, ok);
    }
    box.append(foot);
    return box;
  }

  function start() { on('graph', buildIndex); on('bikes', buildIndex); }
  return { start, attachSearch, card, places: () => cfg.places, nearestBike, buses, onPlaces: (f) => listeners.push(f) };
})();
