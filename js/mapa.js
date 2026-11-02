// Mapa: explore and zoom. Lines, cuts, trains gliding, BiciMAD stations, and EMT buses near the stops on screen.
window.Mapa = (() => {
  const { C, on, state } = MSM;
  const fmt = new Intl.NumberFormat('es', { useGrouping: 'always' });
  const $ = (id) => document.getElementById(id);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let map, layers, alerts, focusLayer, pending = null;
  const trainMarks = new Map();
  const tip = (title, body) => { const d = document.createElement('div'); const a = document.createElement('div'); a.className = 't'; a.textContent = title; const b = document.createElement('div'); b.textContent = body; d.append(a, b); return d; };

  function drawLines() {
    layers.metro.clearLayers();
    const rail = [...state.graph.lines.values()].sort((a, b) => (a.m === 'cercanias') - (b.m === 'cercanias'));
    for (const l of rail) {
      const cer = l.m === 'cercanias';
      L.polyline(l.path, { pane: 'lines', color: l.color, weight: cer ? 2.5 : 4, opacity: cer ? .75 : .95, dashArray: cer ? '1 6' : null, lineCap: 'round' })
        .bindTooltip(tip(cer ? 'Cercanías' : l.m === 'metro' ? 'Metro' : 'Metro Ligero', `${l.b} · ${l.n || ''}`), { sticky: true })
        .on('click', () => focus(l.b)).addTo(cer ? layers.trains : layers.metro);
    }
    for (const s of state.graph.railStops) {
      L.circleMarker([s.la, s.lo], { pane: 'lines', radius: 3, color: C.ink, weight: 1.5, fillColor: C.paper, fillOpacity: 1 })
        .bindTooltip(tip(s.l.map((x) => x.split(':')[1]).join(' '), s.n)).addTo(layers.metro);
    }
  }

  function drawStatus() {
    alerts.clearLayers();
    const list = $('mStatus'); list.replaceChildren();
    const items = state.status.items;
    for (const it of items) {
      if (!it.pts) continue;
      L.polyline(it.pts, { pane: 'alerts', color: it.color, weight: 13, opacity: .45, lineCap: 'round' }).addTo(alerts);
      L.polyline(it.pts, { pane: 'alerts', color: it.color, weight: 4, opacity: 1, dashArray: '8 6' })
        .bindTooltip(tip(`${it.b} · ${it.red ? 'cortada' : 'con avisos'}`, it.title), { sticky: true }).addTo(alerts);
    }
    const byTitle = new Map();
    for (const it of items) { const k = it.title; if (!byTitle.has(k)) byTitle.set(k, { ...it, bs: new Set() }); byTitle.get(k).bs.add(it.b); if (it.red) byTitle.get(k).color = it.color; }
    for (const it of [...byTitle.values()].sort((a, b) => b.red - a.red).slice(0, 8)) {
      const d = document.createElement('div'); d.className = 'st';
      const p = document.createElement('span'); p.className = 'pill'; p.style.background = it.color; p.textContent = [...it.bs].join(' ');
      const t = document.createElement('span'); t.textContent = it.title.length > 150 ? it.title.slice(0, 147) + '...' : it.title;
      d.append(p, t); list.append(d);
    }
    if (!items.length) { const d = document.createElement('div'); d.className = 'st'; const p = document.createElement('span'); p.className = 'pill'; p.style.background = C.verde; p.textContent = 'OK'; const t = document.createElement('span'); t.textContent = 'Metro, Metro Ligero y Cercanías sin avisos.'; d.append(p, t); list.append(d); }
  }

  const bikeR = (n) => { const z = map.getZoom(); return z < 13 ? 2 : z < 15 ? 3 + Math.min(2, n / 8) : 4 + Math.min(5, n / 4); };
  function drawBikes() {
    layers.bikes.clearLayers();
    for (const b of state.bikes.list) {
      const col = !b.ok ? C.mute : b.n === 0 ? C.rojo : b.n < 4 ? C.ambar : C.verde;
      L.circleMarker([b.lat, b.lon], { pane: 'bikes', radius: bikeR(b.n), color: C.ink, weight: 1, fillColor: col, fillOpacity: .9, bikes: b.n })
        .bindTooltip(tip('BiciMAD', `${b.name}: ${b.n} bicis, ${b.docks} anclajes libres`)).addTo(layers.bikes);
    }
    $('mBikes').textContent = fmt.format(state.bikes.free);
  }

  function glide(m, to) {
    const from = m.getLatLng(), t0 = performance.now(), dur = still ? 0 : 3000;
    const step = (t) => { const k = dur ? Math.min(1, (t - t0) / dur) : 1; m.setLatLng([from.lat + (to[0] - from.lat) * k, from.lng + (to[1] - from.lng) * k]); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function drawTrains() {
    const seen = new Set();
    for (const t of state.trains.list) {
      seen.add(t.id);
      const l = state.graph?.lines.get('cercanias:' + t.line) || state.graph?.lines.get('cercanias:' + t.line.replace(/[ab]$/, ''));
      const label = tip(`Cercanías ${t.line}`, `Tren ${t.id}, ${t.status === 'STOPPED_AT' ? 'parado en estación' : 'en marcha'}`);
      let m = trainMarks.get(t.id);
      if (!m) {
        m = L.marker([t.lat, t.lon], { pane: 'vehicles', icon: L.divIcon({ className: '', html: `<div class="tr" style="background:${l?.color || C.tren}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).bindTooltip(label).addTo(layers.trains);
        trainMarks.set(t.id, m);
      } else { m.setTooltipContent(label); glide(m, [t.lat, t.lon]); }
    }
    for (const [id, m] of trainMarks) if (!seen.has(id)) { layers.trains.removeLayer(m); trainMarks.delete(id); }
    $('mTrains').textContent = fmt.format(trainMarks.size);
  }

  const BUS_ZOOM = 16; let busTimer = null;
  async function loadBuses() {
    layers.buses.clearLayers();
    if (!state.graph || map.getZoom() < BUS_ZOOM || !map.hasLayer(layers.buses)) { $('mBuses').textContent = '0'; $('mHint').hidden = false; return; }
    $('mHint').hidden = true;
    const b = map.getBounds(), c = map.getCenter();
    const near = state.graph.emt.filter((s) => b.contains([s.la, s.lo])).sort((p, q) => map.distance(c, [p.la, p.lo]) - map.distance(c, [q.la, q.lo])).slice(0, 8);
    for (const s of near) L.circleMarker([s.la, s.lo], { pane: 'bikes', radius: 3.5, color: C.hielo, weight: 1.5, fillColor: C.ink, fillOpacity: 1 }).bindTooltip(tip('Parada EMT ' + s.i.split(':')[1], s.n)).addTo(layers.buses);
    if (!near.length) { $('mBuses').textContent = '0'; return; }
    try {
      const buses = await MSM.busesNear(near.map((s) => s.i.split(':')[1]));
      for (const v of buses) {
        const stop = state.graph.stops.get('emt:' + v.stop);
        const eta = v.secs == null ? 'sin estimación' : v.secs < 60 ? 'llegando' : `en ${Math.round(v.secs / 60)} min`;
        L.marker([v.lat, v.lon], { pane: 'vehicles', icon: L.divIcon({ className: '', html: `<span class="bus">${v.line.replace(/[^A-Za-z0-9]/g, '')}</span>`, iconSize: [0, 0] }) })
          .bindTooltip(tip(`Línea ${v.line} hacia ${v.dest}`, `Llega a ${stop?.n ?? 'la parada ' + v.stop} ${eta}`)).addTo(layers.buses);
      }
      $('mBuses').textContent = fmt.format(buses.length);
    } catch { $('mBuses').textContent = '-'; }
  }

  function focus(b) {
    if (!map || !state.graph) { pending = b; return; }
    const l = [...state.graph.lines.values()].find((x) => x.b === b);
    if (!l) return;
    focusLayer.clearLayers();
    L.polyline(l.path, { pane: 'alerts', color: C.hielo, weight: 14, opacity: .35, lineCap: 'round' }).addTo(focusLayer);
    L.polyline(l.path, { pane: 'alerts', color: l.color, weight: 6, opacity: 1, lineCap: 'round' }).addTo(focusLayer);
    map.flyToBounds(L.latLngBounds(l.path), { padding: [60, 60], duration: still ? 0 : 1.2 });
  }

  function start() {
    map = L.map('map', { preferCanvas: true, zoomControl: false, minZoom: 9, maxZoom: 19 }).setView([40.4168, -3.7038], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'dark-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Datos: CRTM, Renfe, EMT, BiciMAD' }).addTo(map);
    map.createPane('lines').style.zIndex = 410; map.createPane('alerts').style.zIndex = 420; map.createPane('bikes').style.zIndex = 430; map.createPane('vehicles').style.zIndex = 650;
    layers = { metro: L.layerGroup().addTo(map), trains: L.layerGroup().addTo(map), buses: L.layerGroup().addTo(map), bikes: L.layerGroup().addTo(map) };
    alerts = L.layerGroup().addTo(map); focusLayer = L.layerGroup().addTo(map);
    document.querySelectorAll('.toggle[data-layer]').forEach((btn) => btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true'; btn.setAttribute('aria-pressed', on);
      const g = layers[btn.dataset.layer]; if (on) g.addTo(map); else map.removeLayer(g);
      if (btn.dataset.layer === 'metro') { if (on) alerts.addTo(map); else map.removeLayer(alerts); }
      if (btn.dataset.layer === 'buses' && on) loadBuses();
    }));
    map.on('zoomend', () => layers.bikes.eachLayer((m) => m.setRadius(bikeR(m.options.bikes ?? 0))));
    map.on('moveend', () => { clearTimeout(busTimer); busTimer = setTimeout(loadBuses, 400); });
    setInterval(() => { if (!$('mapa').hidden && map.getZoom() >= BUS_ZOOM) loadBuses(); }, 25000);
    on('graph', () => { drawLines(); if (pending) { focus(pending); pending = null; } });
    on('status', drawStatus); on('bikes', drawBikes); on('trains', drawTrains);
  }
  return { start, shown: (arg) => { setTimeout(() => { map.invalidateSize(); if (arg) focus(arg); }, 30); } };
})();
