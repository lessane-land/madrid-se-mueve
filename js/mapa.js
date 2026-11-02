// Mapa: explore and zoom. Lines, cuts, trains gliding, BiciMAD stations, and EMT buses near the stops on screen.
window.Mapa = (() => {
  const { C, on, state } = MSM;
  const { fmt } = CITY, T = CITY.L;   // T, not L: L is Leaflet
  const $ = (id) => document.getElementById(id);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let map, layers, alerts, focusLayer, pending = null;
  const trainMarks = new Map();
  const tip = (title, body) => { const d = document.createElement('div'); const a = document.createElement('div'); a.className = 't'; a.textContent = title; const b = document.createElement('div'); b.textContent = body; d.append(a, b); return d; };

  function drawLines() {
    layers.metro.clearLayers();
    const rail = [...state.graph.lines.values()].sort((a, b) => CITY.thin.includes(a.m) - CITY.thin.includes(b.m));
    for (const l of rail) {
      const thin = CITY.thin.includes(l.m), dash = CITY.dashed.includes(l.m);
      L.polyline(l.path, { pane: 'lines', color: l.color, weight: thin ? 2.5 : 4, opacity: thin ? .75 : .95, dashArray: dash ? '1 6' : null, lineCap: 'round' })
        .bindTooltip(tip(CITY.mode(l.m), `${l.b} · ${l.n || ''}`), { sticky: true })
        .on('click', () => focus(l.b)).addTo(CITY.id === 'madrid' && l.m === 'cercanias' ? layers.trains : layers.metro);
    }
    const badge = (id) => state.graph.lines.get(id)?.b ?? id.split(':')[1];
    for (const s of state.graph.railStops) {
      L.circleMarker([s.la, s.lo], { pane: 'lines', radius: 3, color: C.ink, weight: 1.5, fillColor: C.paper, fillOpacity: 1 })
        .bindTooltip(tip([...new Set(s.l.map(badge))].join(' '), s.n)).addTo(layers.metro);
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
        .bindTooltip(tip(`${it.b} · ${it.red ? T('cortada', 'closed') : T('con avisos', 'alerts')}`, it.title), { sticky: true }).addTo(alerts);
    }
    const byTitle = new Map();
    for (const it of items) { const k = it.title; if (!byTitle.has(k)) byTitle.set(k, { ...it, bs: new Set() }); byTitle.get(k).bs.add(it.b); if (it.red) byTitle.get(k).color = it.color; }
    for (const it of [...byTitle.values()].sort((a, b) => b.red - a.red).slice(0, 8)) {
      const d = document.createElement('div'); d.className = 'st';
      const p = document.createElement('span'); p.className = 'pill'; p.style.background = it.color; p.textContent = [...it.bs].join(' ');
      const t = document.createElement('span'); t.textContent = it.title.length > 150 ? it.title.slice(0, 147) + '...' : it.title;
      d.append(p, t); list.append(d);
    }
    for (const a of (state.bikes?.alerts ?? []).slice(0, 3)) {
      const d = document.createElement('div'); d.className = 'st';
      const p = document.createElement('span'); p.className = 'pill'; p.style.background = C.verde; p.style.color = C.ink; p.textContent = CITY.bike;
      const t = document.createElement('span'); t.textContent = a.summary || a.description || '';
      d.append(p, t); list.append(d);
    }
    if (!items.length) { const d = document.createElement('div'); d.className = 'st'; const p = document.createElement('span'); p.className = 'pill'; p.style.background = C.verde; p.textContent = 'OK'; const t = document.createElement('span'); t.textContent = T('Ninguna línea con avisos.', 'No line has alerts.'); d.append(p, t); list.append(d); }
  }

  const bikeR = (n) => { const z = map.getZoom(); return z < 13 ? 2 : z < 15 ? 3 + Math.min(2, n / 8) : 4 + Math.min(5, n / 4); };
  function drawBikes() {
    layers.bikes.clearLayers();
    for (const b of state.bikes.list) {
      const col = !b.ok ? C.mute : b.n === 0 ? C.rojo : b.n < 4 ? C.ambar : C.verde;
      L.circleMarker([b.lat, b.lon], { pane: 'bikes', radius: bikeR(b.n), color: C.ink, weight: 1, fillColor: col, fillOpacity: .9, bikes: b.n })
        .bindTooltip(tip(CITY.bike, T(`${b.name}: ${b.n} bicis, ${b.docks} anclajes libres`, `${b.name}: ${b.n} bikes, ${b.docks} free docks`))).addTo(layers.bikes);
    }
    for (const e of state.bikes.ebikes ?? []) L.circleMarker([e.lat, e.lon], { pane: 'bikes', radius: 2.2, color: C.hielo, weight: 0, fillColor: C.hielo, fillOpacity: .9 })
      .bindTooltip(tip(CITY.bike, T('E-bike aparcada en la calle', 'E-bike parked on the street'))).addTo(layers.bikes);
    $('mBikes').textContent = fmt.format(state.bikes.free + (state.bikes.ebikes?.length ?? 0));
    if (state.status) drawStatus();
  }

  // The Bay's roads: closures happening now, and the price of each express lane and bridge right now.
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function drawRoads() {
    if (!layers.roads) return;
    layers.roads.clearLayers();
    const style = { closed: [C.rojo, 4, null, T('Cortada', 'Closed')], lanes: [C.ambar, 3, '6 5', T('Carriles cortados', 'Lanes closed')], detour: [C.hielo, 2.5, '2 6', T('Desvío', 'Detour')] };
    let n = 0;
    for (const r of state.roads.roads) {
      const [color, weight, dash, word] = style[r.kind] || style.lanes;
      const where = [r.road, r.dir, r.from && r.to ? `${r.from} - ${r.to}` : ''].filter(Boolean).join(' · ');
      const shape = r.path.length > 1 ? L.polyline(r.path, { pane: 'alerts', color, weight, dashArray: dash, opacity: .95, lineCap: 'round' }) : L.circleMarker(r.path[0], { pane: 'alerts', radius: 5, color, weight: 2, fillColor: C.ink, fillOpacity: 1 });
      shape.bindTooltip(tip(word, where + (r.text ? ` · ${r.text}` : '')), { sticky: true }).addTo(layers.roads); n++;
    }
    for (const t of state.roads.tolls) {
      const top = t.to.reduce((a, b) => (b.price > a.price ? b : a), t.to[0]);
      if (!top) continue;
      const lines = t.to.map((x) => `${x.name}: ${usd.format(x.price)}`).join(' · ');
      L.marker([t.lat, t.lon], { pane: 'vehicles', icon: L.divIcon({ className: '', html: `<span class="toll">${usd.format(top.price)}</span>`, iconSize: [0, 0] }) })
        .bindTooltip(tip(t.program, `${t.name} · ${lines}`)).addTo(layers.roads);
    }
    const el = $('mRoads'); if (el) el.textContent = fmt.format(n);
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
      const l = t.lineId && state.graph?.lines.get(t.lineId);
      const where = t.status === 'STOPPED_AT' ? (t.stop ? T(`parado en ${t.stop}`, `stopped at ${t.stop}`) : T('parado en estación', 'stopped at a station')) : t.stop ? T(`hacia ${t.stop}`, `heading to ${t.stop}`) : T('en marcha', 'on the move');
      const label = tip(l ? `${CITY.mode(l.m)} ${l.b}` : t.line, where);
      let m = trainMarks.get(t.id);
      if (!m) {
        m = L.marker([t.lat, t.lon], { pane: 'vehicles', icon: L.divIcon({ className: '', html: `<div class="tr" style="background:${l?.color || C.tren}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }).bindTooltip(label).addTo(layers.trains);
        trainMarks.set(t.id, m);
      } else { m.setTooltipContent(label); glide(m, [t.lat, t.lon]); }
    }
    for (const [id, m] of trainMarks) if (!seen.has(id)) { layers.trains.removeLayer(m); trainMarks.delete(id); }
    $('mTrains').textContent = fmt.format(trainMarks.size);
  }

  const BUS_ZOOM = CITY.busZoom; let busTimer = null;
  const busMarks = new Map(); let stopLayer = null;
  async function loadBuses() {
    if (!stopLayer) stopLayer = L.layerGroup().addTo(layers.buses);
    if (!state.graph || map.getZoom() < BUS_ZOOM || !map.hasLayer(layers.buses)) {
      stopLayer.clearLayers(); for (const m of busMarks.values()) layers.buses.removeLayer(m); busMarks.clear();
      // Buses load from street zoom: say so instead of a misleading 0.
      $('mBuses').textContent = !map.hasLayer(layers.buses) ? '-' : T('acerca', 'zoom in'); $('mHint').hidden = false; return;
    }
    $('mHint').hidden = true;
    if (!CITY.busStops) return drawAllBuses();
    const b = map.getBounds(), c = map.getCenter();
    const near = state.graph.emt.filter((s) => b.contains([s.la, s.lo])).sort((p, q) => map.distance(c, [p.la, p.lo]) - map.distance(c, [q.la, q.lo])).slice(0, 8);
    stopLayer.clearLayers();
    for (const s of near) L.circleMarker([s.la, s.lo], { pane: 'bikes', radius: 3.5, color: C.hielo, weight: 1.5, fillColor: C.ink, fillOpacity: 1 }).bindTooltip(tip(T('Parada EMT ', 'EMT stop ') + s.i.split(':')[1], s.n)).addTo(stopLayer);
    if (!near.length) { $('mBuses').textContent = '0'; return; }
    try {
      const buses = await MSM.busesNear(near.map((s) => s.i.split(':')[1]));
      const seen = new Set();
      for (const v of buses) {
        const id = v.bus || `${v.line}-${v.stop}`; seen.add(id);
        const stop = state.graph.stops.get('emt:' + v.stop);
        const eta = v.secs == null ? T('sin estimación', 'no estimate') : v.secs < 60 ? T('llegando', 'arriving') : T(`en ${Math.round(v.secs / 60)} min`, `in ${Math.round(v.secs / 60)} min`);
        const label = tip(T(`Línea ${v.line} hacia ${v.dest}`, `Line ${v.line} to ${v.dest}`), T(`Llega a ${stop?.n ?? 'la parada ' + v.stop} ${eta}`, `Reaches ${stop?.n ?? 'stop ' + v.stop} ${eta}`));
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

  // The Bay: every bus is in one feed, so draw the ones on screen (nearest to the centre first).
  function drawAllBuses() {
    const list = state.buses?.list ?? [], b = map.getBounds().pad(.1), c = map.getCenter();
    const here = list.filter((v) => b.contains([v.lat, v.lon])).sort((p, q) => map.distance(c, [p.lat, p.lon]) - map.distance(c, [q.lat, q.lon])).slice(0, 300);
    const seen = new Set();
    for (const v of here) {
      seen.add(v.bus);
      const label = tip(`${v.op} ${v.line}`, v.dest);
      let m = busMarks.get(v.bus);
      if (!m) {
        m = L.marker([v.lat, v.lon], { pane: 'vehicles', icon: L.divIcon({ className: '', html: `<span class="bus">${v.line.replace(/[^A-Za-z0-9 ]/g, '').slice(0, 6)}</span>`, iconSize: [0, 0] }) }).bindTooltip(label).addTo(layers.buses);
        busMarks.set(v.bus, m);
      } else glide(m, [v.lat, v.lon], 8000);
    }
    for (const [id, m] of busMarks) if (!seen.has(id)) { layers.buses.removeLayer(m); busMarks.delete(id); }
    $('mBuses').textContent = fmt.format(busMarks.size);
  }

  // Back from a focused line to the whole map: a chip by the search, and the Map tab itself.
  let focused = null;
  function showBack() {
    let chip = $('mapBack');
    if (!chip) {
      chip = document.createElement('button'); chip.id = 'mapBack'; chip.type = 'button'; chip.className = 'toggle back-chip';
      chip.onclick = () => unfocus(true);
      document.querySelector('.map-layers').prepend(chip);
    }
    chip.hidden = !focused;
    if (focused) chip.textContent = T(`${focused.b} · Ver todo el mapa`, `${focused.b} · See the whole map`);
  }
  function unfocus(fly) {
    if (!focused) return;
    focused = null; focusLayer.clearLayers(); showBack();
    if (location.hash !== '#mapa') history.replaceState(null, '', '#mapa');
    if (fly) map.flyTo(CITY.center, CITY.zoom, { duration: still ? 0 : 1.2 });
  }

  function focus(b) {
    if (!map || !state.graph) { pending = b; return; }
    const l = [...state.graph.lines.values()].find((x) => x.b === b && !x.dup);
    if (!l) return;
    focusLayer.clearLayers();
    focused = l; showBack();
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
  const HUBS = CITY.hubs, cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const clip = (t, n) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '...');
  const fresh = (k, mins) => { const t = D.shown.get(k); return !t || Date.now() - t > mins * 60000; };
  const fmtNow = () => CITY.time();
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
      map.flyTo(CITY.center, CITY.zoom, { duration: still ? 0 : 6 });
      return caption(T(`${cap(CITY.name)} duerme`, `${cap(CITY.name)} sleeps`), fmtNow(), `${CITY.night.back}. ` + T(`${fmt.format(state.bikes?.free ?? 0)} bicis esperando.`, `${fmt.format(state.bikes?.free ?? 0)} bikes waiting.`), C.hielo), 30000;
    }
    const list = [];
    for (const it of state.status?.items ?? []) if (it.red && it.partial && fresh('cut' + it.b, 6)) list.push(['cut' + it.b, () => {
      map.flyToBounds(L.latLngBounds(it.pts), { padding: [140, 140], maxZoom: 16, duration: still ? 0 : 3.2 });
      caption(T('Corte en vivo', 'Closed now'), T(`${it.b} cortada entre ${it.scope.from} y ${it.scope.to}`, `${it.b} closed between ${it.scope.from} and ${it.scope.to}`), clip(it.title, 130), C.rojo);
    }]);
    const ev = window.Pulso?.events?.() ?? [], tr = window.Pulso?.trains?.();
    for (const p of MiMadrid.places()) if (fresh('pl' + p.id, 6)) list.push(['pl' + p.id, () => {
      flyTo([p.lat, p.lon], 17);
      const b = MiMadrid.nearestBike(p);
      const you = T('Tu sitio · ', 'Your place · ') + p.label;
      caption(you, b ? T(`${b.n} bicis en ${b.name}`, `${b.n} bikes at ${b.name}`) : p.name, b ? T(`${b.docks} anclajes libres · buses en el mapa`, `${b.docks} free docks · buses on the map`) : '', b ? (b.n === 0 ? C.rojo : b.n < 4 ? C.ambar : C.verde) : C.paper);
      MiMadrid.buses(p).then((l) => { const nx = (l || []).filter((v) => v.secs != null).sort((a, z) => a.secs - z.secs)[0]; if (nx && D.on) setTimeout(() => caption(you, `${nx.line} ${nx.secs < 60 ? T('llegando', 'arriving') : T('en ', 'in ') + Math.round(nx.secs / 60) + ' min'}`, `${T('Hacia', 'To')} ${nx.dest.toLowerCase()} · ${state.graph?.stops.get('emt:' + nx.stop)?.n ?? ''}`, C.hielo), 6000); });
    }]);
    const te = fresh('anytrain', 2) && ev.find((e) => e.kind === 'train' && tr?.has(e.trainId) && fresh('tr' + e.trainId + e.stop, 20));
    if (te) list.push(['tr' + te.trainId + te.stop, () => { D.shown.set('anytrain', Date.now()); const t = tr.get(te.trainId); flyTo(t.cur, 15); caption(te.label || te.line, T(`Parado en ${te.stop}`, `Stopped at ${te.stop}`), T(`${tr.size} trenes rodando por ${CITY.name} ahora mismo`, `${tr.size} trains running across ${CITY.name} right now`), t.color); }]);
    for (const x of window.Extras?.scenes() ?? []) if (fresh(x.key, x.mins)) list.push([x.key, () => {
      if (x.ll) flyTo(x.ll, x.zm); else map.flyTo(CITY.center, CITY.zoom - 1, { duration: still ? 0 : 3.6 });
      caption(...x.cap);
    }]);
    if (CITY.id === 'bay') {
      const pc = (state.trains?.list ?? []).map((t) => [t, state.graph?.lines.get(t.lineId)]).find(([t, l]) => (l?.m === 'ferry' || l?.m === 'cable') && fresh('pc' + l.m, 5));
      if (pc) { const [t, l] = pc; list.push(['pc' + l.m, () => { flyTo([t.lat, t.lon], l.m === 'ferry' ? 14 : 17); caption(l.m === 'ferry' ? T('Ferry · cruzando la Bahía', 'Ferry · crossing the Bay') : 'Cable car', l.n || l.b, t.stop ? T(`Hacia ${t.stop}`, `Heading to ${t.stop}`) : '', l.color); }]); }
      const shut = (state.roads?.roads ?? []).find((r) => r.kind === 'closed' && r.road && fresh('rd' + r.id, 30));
      if (shut) list.push(['rd' + shut.id, () => { flyTo(shut.path[0], 16); caption(T('Calle cortada', 'Road closed'), shut.road, [shut.dir, shut.text].filter(Boolean).join(' · '), C.rojo); }]);
      const tolls = (state.roads?.tolls ?? []).map((t) => ({ t, top: Math.max(...t.to.map((x) => x.price)) })).filter((x) => x.top > 0).sort((a, b) => b.top - a.top);
      if (tolls[0] && fresh('toll', 20)) { const { t, top } = tolls[0]; list.push(['toll', () => { flyTo([t.lat, t.lon], 14); caption(T('Peaje ahora', 'Toll right now'), `${t.program} · ${usd.format(top)}`, t.to.map((x) => `${x.name} ${usd.format(x.price)}`).join(' · '), C.ambar); }]); }
    }
    const be = ev.find((e) => (e.kind === 'bike' || e.kind === 'bikeout') && fresh('bk' + e.station + e.at, 30));
    if (be) list.push(['bk' + be.station + be.at, () => { const st = state.bikes?.list.find((b) => b.id === be.station); flyTo([be.lat, be.lon], 17); caption(CITY.bike, `${st?.name ?? T('Estación', 'Station')} · ${be.d > 0 ? '+' : ''}${be.d} ${T('bicis', 'bikes')}`, st ? T(`${st.n} bicis y ${st.docks} anclajes libres ahora`, `${st.n} bikes and ${st.docks} free docks now`) : '', be.d > 0 ? C.verde : C.ambar); }]);
    if (D.n % 3 === 0 || !list.length) {
      if (D.n % 2 === 0) { map.flyTo(CITY.center, CITY.zoom + .4, { duration: still ? 0 : 3.6 }); caption(CITY.title, T(`${fmt.format(state.bikes?.free ?? 0)} bicis libres`, `${fmt.format(state.bikes?.free ?? 0)} free bikes`), T(`${trainMarks.size} trenes rodando · ${fmtNow()}`, `${trainMarks.size} trains running · ${fmtNow()}`), C.verde); return 12000; }
      const [name, la, lo] = HUBS[(D.n >> 1) % HUBS.length];
      flyTo([la, lo], 16.5); caption(T('Ahora en ', 'Now at ') + name, T('Buses llegando', 'Buses around'), T(`Cada etiqueta es un autobús de ${CITY.busOperator} en marcha`, `Every label is a ${CITY.busOperator} bus on the move`), C.hielo); return 14000;
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
    map = L.map('map', { preferCanvas: true, zoomControl: false, minZoom: 8, maxZoom: 19 }).setView(CITY.center, CITY.zoom);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'dark-tiles', attribution: `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ${T('Datos', 'Data')}: ${CITY.sources}` }).addTo(map);
    map.createPane('lines').style.zIndex = 410; map.createPane('alerts').style.zIndex = 420; map.createPane('bikes').style.zIndex = 430; map.createPane('vehicles').style.zIndex = 650;
    layers = { metro: L.layerGroup().addTo(map), trains: L.layerGroup().addTo(map), buses: L.layerGroup().addTo(map), bikes: L.layerGroup().addTo(map) };
    if (CITY.id === 'bay') layers.roads = L.layerGroup().addTo(map);
    alerts = L.layerGroup().addTo(map); focusLayer = L.layerGroup().addTo(map); savedLayer = L.layerGroup().addTo(map);
    // Extra layers (planes, ships, quakes, air, cars) get their own toggles, before the screen mode button.
    window.Extras?.attachMap(map, (key, label, color, on, group) => {
      const b = document.createElement('button'); b.className = 'toggle'; b.type = 'button'; b.setAttribute('aria-pressed', on);
      const i = document.createElement('i'); i.style.background = color; const k = document.createElement('span'); k.className = 'k'; k.textContent = label;
      b.append(i, k); document.querySelector('.map-layers [data-map-screen]').before(b);
      b.onclick = () => { const now = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', now); if (now) group.addTo(map); else map.removeLayer(group); };
    }, tip);
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
    on('status', drawStatus); on('bikes', drawBikes); on('trains', drawTrains); on('roads', drawRoads);
    on('buses', () => { if (!CITY.busStops && map.getZoom() >= BUS_ZOOM && map.hasLayer(layers.buses)) drawAllBuses(); });
  }
  return { start, focusPlace, enterScreen, shown: (arg) => { setTimeout(() => { map.invalidateSize(); if (arg) focus(arg); else unfocus(true); if (pendingPlace && state.graph) { const p = pendingPlace; pendingPlace = null; focusPlace(p); } }, 60); } };
})();
