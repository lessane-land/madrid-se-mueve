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

  function glide(m, to, ms) {
    const from = m.getLatLng(), t0 = performance.now(), dur = still ? 0 : (ms || 3000);
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
  const busMarks = new Map(); let stopLayer = null;
  async function loadBuses() {
    if (!stopLayer) stopLayer = L.layerGroup().addTo(layers.buses);
    if (!state.graph || map.getZoom() < BUS_ZOOM || !map.hasLayer(layers.buses)) {
      stopLayer.clearLayers(); for (const m of busMarks.values()) layers.buses.removeLayer(m); busMarks.clear();
      $('mBuses').textContent = '0'; $('mHint').hidden = false; return;
    }
    $('mHint').hidden = true;
    const b = map.getBounds(), c = map.getCenter();
    const near = state.graph.emt.filter((s) => b.contains([s.la, s.lo])).sort((p, q) => map.distance(c, [p.la, p.lo]) - map.distance(c, [q.la, q.lo])).slice(0, 8);
    stopLayer.clearLayers();
    for (const s of near) L.circleMarker([s.la, s.lo], { pane: 'bikes', radius: 3.5, color: C.hielo, weight: 1.5, fillColor: C.ink, fillOpacity: 1 }).bindTooltip(tip('Parada EMT ' + s.i.split(':')[1], s.n)).addTo(stopLayer);
    if (!near.length) { $('mBuses').textContent = '0'; return; }
    try {
      const buses = await MSM.busesNear(near.map((s) => s.i.split(':')[1]));
      const seen = new Set();
      for (const v of buses) {
        const id = v.bus || `${v.line}-${v.stop}`; seen.add(id);
        const stop = state.graph.stops.get('emt:' + v.stop);
        const eta = v.secs == null ? 'sin estimación' : v.secs < 60 ? 'llegando' : `en ${Math.round(v.secs / 60)} min`;
        const label = tip(`Línea ${v.line} hacia ${v.dest}`, `Llega a ${stop?.n ?? 'la parada ' + v.stop} ${eta}`);
        let m = busMarks.get(id);
        if (!m) {
          m = L.marker([v.lat, v.lon], { pane: 'vehicles', icon: L.divIcon({ className: '', html: `<span class="bus">${v.line.replace(/[^A-Za-z0-9]/g, '')}</span>`, iconSize: [0, 0] }) }).bindTooltip(label).addTo(layers.buses);
          busMarks.set(id, m);
        } else { m.setTooltipContent(label); glide(m, [v.lat, v.lon], 6000); }
      }
      for (const [id, m] of busMarks) if (!seen.has(id)) { layers.buses.removeLayer(m); busMarks.delete(id); }
      $('mBuses').textContent = fmt.format(busMarks.size);
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


  // Places: search, fly there, show the card, mark saved places.
  let placePin = null, savedLayer = null;
  function paintSaved() {
    savedLayer.clearLayers();
    for (const p of MiMadrid.places()) L.marker([p.lat, p.lon], { pane: 'vehicles', icon: L.divIcon({ className: '', html: `<span class="saved-pin">${p.label.replace(/[<>&"]/g, '')}</span>`, iconSize: [0, 0] }) }).on('click', () => focusPlace(p)).addTo(savedLayer);
  }
  function focusPlace(p) {
    if (!map) { pendingPlace = p; return; }
    if (placePin) map.removeLayer(placePin);
    placePin = L.marker([p.lat, p.lon], { pane: 'vehicles', icon: L.divIcon({ className: '', html: '<span class="place-pin"></span>', iconSize: [0, 0] }) }).addTo(map);
    map.flyTo([p.lat, p.lon], 17, { duration: still ? 0 : 1.6 });
    const box = $('placeCard'); box.hidden = false;
    box.replaceChildren(MiMadrid.card(p, { onClose: () => { box.hidden = true; if (placePin) { map.removeLayer(placePin); placePin = null; } } }));
  }
  let pendingPlace = null;

  // Screen mode on the real map: full screen, no interface, the camera flies over the streets to what is happening.
  const D = { on: false, timer: 0, n: 0, shown: new Map(), lock: null, idle: 0 };
  const HUBS = [['Sol', 40.4169, -3.7035], ['Atocha', 40.4066, -3.6892], ['Moncloa', 40.4351, -3.7190], ['Plaza de Castilla', 40.4669, -3.6890], ['Cibeles', 40.4193, -3.6931], ['Callao', 40.4200, -3.7058], ['Legazpi', 40.3911, -3.6953], ['Avenida de América', 40.4380, -3.6762]];
  const clip = (t, n) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '...');
  const fresh = (k, mins) => { const t = D.shown.get(k); return !t || Date.now() - t > mins * 60000; };
  const fmtNow = () => new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  function caption(kind, title, sub, color) {
    const el = $('mapCaption'); el.classList.remove('in');
    setTimeout(() => { el.querySelector('.k').textContent = kind; el.querySelector('.t').textContent = title; el.querySelector('.s').textContent = sub || ''; el.style.setProperty('--cap', color || C.paper); el.classList.add('in'); }, still ? 0 : 450);
  }
  const flyTo = (ll, z) => map.flyTo(ll, z, { duration: still ? 0 : 3.2, easeLinearity: .2 });
  function scene() {
    const night = window.Pulso?.nightness?.() ?? 0;
    document.body.classList.toggle('night', night > .5);
    D.n++;
    if (night > .5) {
      map.flyTo([40.425, -3.69], 12, { duration: still ? 0 : 6 });
      return caption('Madrid duerme', fmtNow(), `El Metro vuelve a las 6:00. ${fmt.format(state.bikes?.free ?? 0)} bicis esperando.`, C.hielo), 30000;
    }
    const list = [];
    for (const it of state.status?.items ?? []) if (it.red && it.partial && fresh('cut' + it.b, 6)) list.push(['cut' + it.b, () => {
      map.flyToBounds(L.latLngBounds(it.pts), { padding: [140, 140], maxZoom: 16, duration: still ? 0 : 3.2 });
      caption('Corte en vivo', `${it.b} cortada entre ${it.scope.from} y ${it.scope.to}`, clip(it.title, 130), C.rojo);
    }]);
    const ev = window.Pulso?.events?.() ?? [], tr = window.Pulso?.trains?.();
    for (const p of MiMadrid.places()) if (fresh('pl' + p.id, 6)) list.push(['pl' + p.id, () => {
      flyTo([p.lat, p.lon], 17);
      const b = MiMadrid.nearestBike(p);
      caption('Tu sitio · ' + p.label, b ? `${b.n} bicis en ${b.name}` : p.name, b ? `${b.docks} anclajes libres · buses llegando en el mapa` : '', b ? (b.n === 0 ? C.rojo : b.n < 4 ? C.ambar : C.verde) : C.paper);
      MiMadrid.buses(p).then((l) => { const nx = (l || []).filter((v) => v.secs != null).sort((a, z) => a.secs - z.secs)[0]; if (nx && D.on) setTimeout(() => caption('Tu sitio · ' + p.label, `${nx.line} ${nx.secs < 60 ? 'llegando' : 'en ' + Math.round(nx.secs / 60) + ' min'}`, `Hacia ${nx.dest.toLowerCase()} · ${state.graph?.stops.get('emt:' + nx.stop)?.n ?? ''}`, C.hielo), 6000); });
    }]);
    const te = fresh('anytrain', 2) && ev.find((e) => e.kind === 'train' && tr?.has(e.trainId) && fresh('tr' + e.trainId + e.stop, 20));
    if (te) list.push(['tr' + te.trainId + te.stop, () => { D.shown.set('anytrain', Date.now()); const t = tr.get(te.trainId); flyTo(t.cur, 15); caption('Cercanías ' + te.line, `Parado en ${te.stop}`, `${tr.size} trenes rodando por Madrid ahora mismo`, t.color); }]);
    const be = ev.find((e) => (e.kind === 'bike' || e.kind === 'bikeout') && fresh('bk' + e.station + e.at, 30));
    if (be) list.push(['bk' + be.station + be.at, () => { const st = state.bikes?.list.find((b) => b.id === be.station); flyTo([be.lat, be.lon], 17); caption('BiciMAD', `${st?.name ?? 'Estación'} · ${be.d > 0 ? '+' : ''}${be.d} bicis`, st ? `${st.n} bicis y ${st.docks} anclajes libres ahora` : '', be.d > 0 ? C.verde : C.ambar); }]);
    if (D.n % 3 === 0 || !list.length) {
      if (D.n % 2 === 0) { map.flyTo([40.425, -3.695], 12.4, { duration: still ? 0 : 3.6 }); caption('Madrid se mueve', `${fmt.format(state.bikes?.free ?? 0)} bicis libres`, `${trainMarks.size} trenes de Cercanías rodando · ${fmtNow()}`, C.verde); return 12000; }
      const [name, la, lo] = HUBS[(D.n >> 1) % HUBS.length];
      flyTo([la, lo], 16.5); caption('Ahora en ' + name, 'Buses llegando', 'Cada etiqueta es un autobús de EMT camino de las paradas de la zona', C.hielo); return 14000;
    }
    const [key, run] = list[0]; D.shown.set(key, Date.now()); run(); return 13000;
  }
  function step() { if (!D.on) return; const wait = scene(); D.timer = setTimeout(step, wait); }
  async function lock() { try { D.lock = await navigator.wakeLock?.request('screen'); } catch {} }
  function enterScreen() {
    if (D.on) return; D.on = true;
    if (location.hash.slice(1).split('-')[0] !== 'mapa') location.hash = '#mapa';
    document.body.classList.add('screen-map');
    document.documentElement.requestFullscreen?.().catch(() => {});
    lock(); $('placeCard').hidden = true;
    setTimeout(() => { map.invalidateSize(); step(); }, 400);
  }
  function exitScreen() {
    if (!D.on) return; D.on = false; clearTimeout(D.timer);
    document.body.classList.remove('screen-map', 'still-mouse', 'night');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    D.lock?.release?.().catch(() => {}); D.lock = null;
    $('mapCaption').classList.remove('in'); setTimeout(() => map.invalidateSize(), 300);
  }
  document.addEventListener('visibilitychange', () => { if (D.on && !document.hidden) lock(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && D.on) exitScreen(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') exitScreen(); });
  addEventListener('pointermove', () => { if (!D.on) return; document.body.classList.remove('still-mouse'); clearTimeout(D.idle); D.idle = setTimeout(() => document.body.classList.add('still-mouse'), 2500); });

  function start() {
    map = L.map('map', { preferCanvas: true, zoomControl: false, minZoom: 9, maxZoom: 19 }).setView([40.4168, -3.7038], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'dark-tiles', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Datos: CRTM, Renfe, EMT, BiciMAD' }).addTo(map);
    map.createPane('lines').style.zIndex = 410; map.createPane('alerts').style.zIndex = 420; map.createPane('bikes').style.zIndex = 430; map.createPane('vehicles').style.zIndex = 650;
    layers = { metro: L.layerGroup().addTo(map), trains: L.layerGroup().addTo(map), buses: L.layerGroup().addTo(map), bikes: L.layerGroup().addTo(map) };
    alerts = L.layerGroup().addTo(map); focusLayer = L.layerGroup().addTo(map); savedLayer = L.layerGroup().addTo(map);
    MiMadrid.attachSearch($('mapSearch'), focusPlace); MiMadrid.onPlaces(paintSaved); paintSaved();
    document.querySelectorAll('[data-map-screen]').forEach((b) => b.addEventListener('click', enterScreen));
    $('mapExit').addEventListener('click', exitScreen);
    document.querySelectorAll('.toggle[data-layer]').forEach((btn) => btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true'; btn.setAttribute('aria-pressed', on);
      const g = layers[btn.dataset.layer]; if (on) g.addTo(map); else map.removeLayer(g);
      if (btn.dataset.layer === 'metro') { if (on) alerts.addTo(map); else map.removeLayer(alerts); }
      if (btn.dataset.layer === 'buses' && on) loadBuses();
    }));
    map.on('zoomend', () => layers.bikes.eachLayer((m) => m.setRadius(bikeR(m.options.bikes ?? 0))));
    map.on('moveend', () => { clearTimeout(busTimer); busTimer = setTimeout(loadBuses, 400); });
    setInterval(() => { if (!$('mapa').hidden && !document.hidden && map.getZoom() >= BUS_ZOOM) loadBuses(); }, 20000);
    on('graph', () => { drawLines(); if (pending) { focus(pending); pending = null; } if (pendingPlace) { const p = pendingPlace; pendingPlace = null; setTimeout(() => focusPlace(p), 400); } });
    on('status', drawStatus); on('bikes', drawBikes); on('trains', drawTrains);
  }
  return { start, focusPlace, enterScreen, shown: (arg) => { setTimeout(() => { map.invalidateSize(); if (arg) focus(arg); if (pendingPlace && state.graph) { const p = pendingPlace; pendingPlace = null; focusPlace(p); } }, 60); } };
})();
