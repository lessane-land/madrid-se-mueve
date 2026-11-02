// Extras: what moves around the transport. Planes over both cities, ships and earthquakes in the Bay, the ISS when it
// passes near, and Madrid's air and car traffic. Green things (trains, buses, bikes) stay the stars; planes, ships and
// cars are drawn faint and warm, the contrast. Pulso and Mapa call the hooks below; nothing here owns a view.
window.Extras = (() => {
  const { C, CFG, state } = MSM;
  const { L, fmt } = CITY;
  const BAY = CITY.id === 'bay';
  const X = { planes: [], ships: [], quakes: [], iss: null, air: null, traffic: [], at: {} };
  const subs = [];
  const changed = (k) => subs.forEach((f) => { try { f(k); } catch (e) { console.error(e); } });
  const KM = (a, b) => Math.hypot((b[1] - a[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (b[0] - a[0]) * 110.6);
  const asset = (p) => new URL(p, CITY.coast || document.querySelector('script[src*="js/city.js"]')?.src || location.href).href;
  const AIRPORTS = BAY ? [['SFO', 37.6213, -122.379], ['OAK', 37.7126, -122.2197], ['SJC', 37.3639, -121.9289]] : [['Barajas', 40.4719, -3.5626]];

  // ---- Loaders ----
  async function planes() {
    const r = await fetch(`${CFG.VIVO}?what=planes&city=${CITY.id}`, { headers: CFG.auth });
    if (!r.ok) return;
    const d = await r.json(), now = performance.now();
    const old = new Map(X.planes.map((p) => [p.id, p]));
    X.planes = (d.planes ?? []).map((p) => ({ ...p, t0: now, from: old.get(p.id)?.cur ?? [p.lat, p.lon] }));
    changed('planes');
  }
  async function ships() {
    if (!BAY) return;
    const r = await fetch(`${CFG.VIVO}?city=bay&what=ships`, { headers: CFG.auth });
    if (!r.ok) return;
    const d = await r.json(), now = performance.now();
    // Moored ships report every few minutes, so keep every ship heard in the last 30 minutes.
    const all = new Map(X.ships.filter((s) => Date.now() - (s.at ?? 0) < 1800000).map((s) => [s.id, s]));
    for (const s of d.ships ?? []) all.set(s.id, { ...all.get(s.id), ...s, name: s.name || all.get(s.id)?.name || '', t0: now });
    X.ships = [...all.values()];
    changed('ships');
  }
  async function quakes() {
    if (!BAY) return;
    const d = await (await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson')).json();
    const fresh = d.features.map((f) => ({ id: f.id, mag: f.properties.mag ?? 0, place: f.properties.place ?? '', time: f.properties.time, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2] }))
      .filter((q) => KM(CITY.center, [q.lat, q.lon]) < 220 && q.mag >= 1);
    const known = new Set(X.quakes.map((q) => q.id));
    const isNew = X.at.quakes ? fresh.filter((q) => !known.has(q.id)) : [];
    X.quakes = fresh; X.at.quakes = Date.now();
    for (const q of isNew) subs.forEach((f) => f('quake:new', q));
    changed('quakes');
  }
  async function iss() {
    const d = await (await fetch('https://api.wheretheiss.at/v1/satellites/25544')).json();
    const near = KM(CITY.center, [d.latitude, d.longitude]);
    const was = X.iss?.near < 1500;
    X.iss = { lat: d.latitude, lon: d.longitude, km: Math.round(d.altitude), near: Math.round(near), at: Date.now() };
    if (near < 1500 && !was) subs.forEach((f) => f('iss:near', X.iss));
    changed('iss');
  }
  // Madrid's air: the latest valid hour of NO2 at each of the city's stations.
  let stations = null;
  async function air() {
    if (BAY) return;
    stations ??= (await (await fetch(asset('../data/aire-estaciones.json'))).json()).stations;
    const csv = await (await fetch('https://ciudadesabiertas.madrid.es/dynamicAPI/API/query/calair_tiemporeal.csv?pageSize=5000')).text();
    const rows = csv.replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(';'));
    const head = rows.shift(), col = (n) => head.indexOf(n);
    const out = [];
    for (const r of rows) {
      if (r[col('MAGNITUD')] !== '8') continue;                 // 8 = NO2
      const st = stations[String(+r[col('ESTACION')])]; if (!st) continue;
      let v = null, h = null;
      for (let i = 24; i >= 1; i--) { const k = String(i).padStart(2, '0'); if (r[col('V' + k)] === 'V') { v = +r[col('H' + k)]; h = i; break; } }
      if (v != null) out.push({ name: st[2], lat: st[0], lon: st[1], no2: v, hour: h });
    }
    if (!out.length) return;
    const sorted = out.map((x) => x.no2).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
    X.air = { stations: out, median, worst: out.reduce((a, b) => (b.no2 > a.no2 ? b : a)), hour: Math.max(...out.map((x) => x.hour)) };
    changed('air');
  }
  // Madrid's traffic sensors: load 0..100 at every measuring point, UTM ETRS89 zone 30N.
  function utm30(x, y) {
    const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), k0 = .9996, ep2 = e2 / (1 - e2);
    x -= 500000; const m = y / k0, mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
    const n1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), t1 = Math.tan(p1) ** 2, c1 = ep2 * Math.cos(p1) ** 2;
    const r1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, d = x / (n1 * k0);
    const lat = p1 - (n1 * Math.tan(p1) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4 / 24 + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6 / 720);
    const lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5 / 120) / Math.cos(p1);
    return [lat * 180 / Math.PI, -3 + lon * 180 / Math.PI];
  }
  async function traffic() {
    if (BAY) return;
    const xml = await (await fetch('https://informo.madrid.es/informo/tmadrid/pm.xml')).text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml'), out = [];
    const num = (el, t) => parseFloat((el.getElementsByTagName(t)[0]?.textContent ?? '').replace(',', '.'));
    for (const pm of doc.getElementsByTagName('pm')) {
      const x = num(pm, 'st_x'), y = num(pm, 'st_y'), carga = num(pm, 'carga');
      if (!Number.isFinite(x) || !Number.isFinite(y) || !(carga > 0) || pm.getElementsByTagName('error')[0]?.textContent === 'S') continue;
      const [lat, lon] = utm30(x, y);
      out.push({ lat, lon, carga, name: pm.getElementsByTagName('descripcion')[0]?.textContent ?? '' });
    }
    X.traffic = out; changed('traffic');
  }

  const safe = (f) => () => { if (!document.hidden) f().catch(() => {}); };
  function start() {
    const plan = [[planes, 15000], [iss, 20000], [ships, 60000], [quakes, 300000], [air, 1200000], [traffic, 300000]];
    for (const [f, ms] of plan) { safe(f)(); setInterval(safe(f), ms); }
  }

  // Top-down silhouettes, nose and bow up, in a 24 x 24 box around 0,0.
  const PLANE = 'M0 -11 C1.1 -11 1.6 -9.6 1.6 -8 L1.6 -3.2 L10.5 2 L10.5 4.2 L1.6 1.6 L1.3 7 L4.6 9.4 L4.6 11 L0 9.8 L-4.6 11 L-4.6 9.4 L-1.3 7 L-1.6 1.6 L-10.5 4.2 L-10.5 2 L-1.6 -3.2 L-1.6 -8 C-1.6 -9.6 -1.1 -11 0 -11 Z';
  const HULL = 'M0 -11 C2.6 -8 3.8 -4.5 3.8 0 L3.8 8.2 Q3.8 10.5 1.6 10.5 L-1.6 10.5 Q-3.8 10.5 -3.8 8.2 L-3.8 0 C-3.8 -4.5 -2.6 -8 0 -11 Z';
  const BRIDGE = 'M-2.2 3.5 H2.2 V7 H-2.2 Z';
  const planePath = new Path2D(PLANE), hullPath = new Path2D(HULL), bridgePath = new Path2D(BRIDGE);

  // ---- Moving things between reports ----
  const NM = 1.852 / 3600000;   // knots to km per ms
  function advance(o, now, speedKnots, heading, capMs) {
    const dt = Math.min(capMs, now - o.t0), km = speedKnots * NM * dt, r = heading * Math.PI / 180;
    return [o.lat + Math.cos(r) * km / 110.6, o.lon + Math.sin(r) * km / (111.32 * Math.cos(o.lat * Math.PI / 180))];
  }
  function planeAt(p, now) {
    const to = p.gs > 30 ? advance(p, now, p.gs, p.trk, 40000) : [p.lat, p.lon];
    const k = Math.min(1, (now - p.t0) / 1500);   // blend from where it was drawn
    p.cur = [p.from[0] + (to[0] - p.from[0]) * k, p.from[1] + (to[1] - p.from[1]) * k];
    return p.cur;
  }
  const shipAt = (s, now) => (s.cur = s.sog > .5 ? advance(s, now, s.sog, s.cog, 180000) : [s.lat, s.lon]);

  // ---- Pulso ----
  // Static layers, drawn into Pulso's baked canvas: Madrid's car traffic as warm embers and its air as a haze.
  function bakePulso(g, P, z, W, H) {
    if (X.air) for (const s of X.air.stations) {
      const [x, y] = P(s.lat, s.lon), r = 70 * z, col = airColor(s.no2);
      const grad = g.createRadialGradient(x, y, 0, x, y, r); grad.addColorStop(0, col + '30'); grad.addColorStop(1, col + '00');
      g.fillStyle = grad; g.globalAlpha = 1; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = C.ambar;
    for (const t of X.traffic) {
      const [x, y] = P(t.lat, t.lon); if (x < 0 || y < 0 || x > W || y > H) continue;
      g.globalAlpha = .08 + t.carga / 260; const s = (.8 + t.carga / 70) * z; g.fillRect(x - s / 2, y - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }
  // Moving layers, drawn every frame: quake rings, ships, planes, the ISS.
  function drawPulso(ctx, P, z, now, still) {
    for (const q of X.quakes) {
      const ageH = (Date.now() - q.time) / 3.6e6; if (ageH > 24) continue;
      const [x, y] = P(q.lat, q.lon), fade = 1 - ageH / 24, period = 5000;
      for (const off of [0, .5]) {
        const k = still ? .6 : ((now / period + off + q.time % 7 / 7) % 1);
        ctx.strokeStyle = C.ambar; ctx.globalAlpha = (1 - k) * .55 * fade; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, (3 + k * (10 + q.mag * 12)) * z, 0, 6.283); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (const s of X.ships) {
      const [la, lo] = shipAt(s, now), [x, y] = P(la, lo), r = (s.cog || 0) * Math.PI / 180;
      ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.scale(.5 * z, .5 * z);
      ctx.fillStyle = C.hielo; ctx.globalAlpha = s.sog > .5 ? .9 : .5; ctx.fill(hullPath);
      ctx.fillStyle = C.ink; ctx.globalAlpha = .55; ctx.fill(bridgePath);
      ctx.restore();
    }
    for (const p of X.planes) {
      if (p.alt <= 0) continue;
      const [la, lo] = planeAt(p, now), [x, y] = P(la, lo), r = p.trk * Math.PI / 180;
      const low = p.alt < 6000, a = low ? .75 : .38;
      ctx.strokeStyle = C.paper; ctx.globalAlpha = a * .35; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.sin(r) * 18 * z, y + Math.cos(r) * 18 * z); ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(r); const k = (low ? .62 : .5) * z; ctx.scale(k, k);
      ctx.fillStyle = C.paper; ctx.globalAlpha = a; ctx.fill(planePath);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---- Map ----
  function airColor(v) { return v <= 40 ? C.verde : v <= 90 ? '#B8E07A' : v <= 120 ? C.ambar : C.rojo; }
  function airWord(v) { return v <= 40 ? L('bueno', 'good') : v <= 90 ? L('razonablemente bueno', 'fair') : v <= 120 ? L('regular', 'moderate') : L('malo', 'poor'); }
  function attachMap(map, addToggle, tip) {
    const groups = {}, marks = { planes: new Map(), ships: new Map() };
    const svgPlane = (deg, low) => `<svg width="22" height="22" viewBox="-12 -12 24 24" style="transform: rotate(${deg}deg); opacity: ${low ? .95 : .65}"><path d="${PLANE}" fill="${C.paper}" stroke="${C.ink}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
    const svgShip = (deg) => `<svg width="18" height="18" viewBox="-12 -12 24 24" style="transform: rotate(${deg}deg)"><path d="${HULL}" fill="${C.hielo}" stroke="${C.ink}" stroke-width="1.2"/><path d="${BRIDGE}" fill="${C.ink}" opacity=".55"/></svg>`;
    const add = (key, label, color, on) => { groups[key] = L_.layerGroup(); if (on) groups[key].addTo(map); addToggle(key, label, color, on, groups[key]); };
    const L_ = window.L;
    add('planes', L('Aviones', 'Planes'), C.paper, true);
    if (BAY) { add('ships', L('Barcos', 'Ships'), C.hielo, true); add('quakes', L('Terremotos', 'Quakes'), C.ambar, true); }
    else { add('air', L('Aire', 'Air'), C.verde, true); add('traffic', L('Coches', 'Cars'), C.ambar, false); }
    const sync = (kind, list, icon, label, pos) => {
      const seen = new Set();
      for (const o of list) {
        seen.add(o.id); let m = marks[kind].get(o.id);
        const ic = L_.divIcon({ className: '', html: icon(o), iconSize: [22, 22], iconAnchor: [11, 11] });
        if (!m) { m = L_.marker(pos(o), { pane: 'vehicles', icon: ic, interactive: true }).bindTooltip(tip(...label(o))).addTo(groups[kind]); marks[kind].set(o.id, m); }
        else { m.setIcon(ic); m.setTooltipContent(tip(...label(o))); m.setLatLng(pos(o)); }
      }
      for (const [id, m] of marks[kind]) if (!seen.has(id)) { groups[kind].removeLayer(m); marks[kind].delete(id); }
    };
    const ft = (v) => `${fmt.format(Math.round(v))} ft`;
    const drawPlanes = () => sync('planes', X.planes.filter((p) => p.alt > 0), (p) => svgPlane(p.trk, p.alt < 6000),
      (p) => [p.f || p.id.toUpperCase(), [p.t, ft(p.alt), `${Math.round(p.gs)} kt`].filter(Boolean).join(' · ')], (p) => planeAt(p, performance.now()));
    const drawShips = () => sync('ships', X.ships, (s) => svgShip(s.cog || 0),
      (s) => [s.name || 'MMSI ' + s.id, [s.to && L(`Hacia ${s.to}`, `To ${s.to}`), `${s.sog.toFixed(1)} kn`].filter(Boolean).join(' · ')], (s) => shipAt(s, performance.now()));
    const drawQuakes = () => {
      groups.quakes.clearLayers();
      for (const q of X.quakes) L_.circleMarker([q.lat, q.lon], { pane: 'alerts', radius: 4 + q.mag * 4, color: C.ambar, weight: 2, fillColor: C.ambar, fillOpacity: .15 })
        .bindTooltip(tip(`M${q.mag.toFixed(1)}`, `${q.place} · ${ago(q.time)} · ${Math.round(q.depth)} km`)).addTo(groups.quakes);
    };
    const drawAir = () => {
      groups.air.clearLayers();
      for (const s of X.air.stations) L_.marker([s.lat, s.lon], { pane: 'vehicles', icon: L_.divIcon({ className: '', html: `<span class="air" style="--a:${airColor(s.no2)}">${s.no2}</span>`, iconSize: [0, 0] }) })
        .bindTooltip(tip(s.name, `NO₂ ${s.no2} µg/m³ · ${airWord(s.no2)} · ${s.hour}:00`)).addTo(groups.air);
    };
    const drawTraffic = () => {
      groups.traffic.clearLayers();
      for (const t of X.traffic) L_.circleMarker([t.lat, t.lon], { pane: 'bikes', radius: 1.5 + t.carga / 30, weight: 0, fillColor: t.carga > 70 ? C.rojo : t.carga > 40 ? C.ambar : '#B88A4A', fillOpacity: .6 })
        .bindTooltip(tip(L('Tráfico', 'Traffic'), `${t.name} · ${L('carga', 'load')} ${Math.round(t.carga)} %`)).addTo(groups.traffic);
    };
    subs.push((k) => {
      if (k === 'planes') drawPlanes(); if (k === 'ships') drawShips(); if (k === 'quakes') drawQuakes();
      if (k === 'air') drawAir(); if (k === 'traffic') drawTraffic();
    });
    // The map starts later than the data: draw what is already here.
    drawPlanes(); if (BAY) { drawShips(); drawQuakes(); } else { if (X.air) drawAir(); if (X.traffic.length) drawTraffic(); }
    // Planes and ships glide between reports.
    setInterval(() => { if (!document.hidden && map.hasLayer(groups.planes)) for (const [id, m] of marks.planes) { const p = X.planes.find((x) => x.id === id); if (p) m.setLatLng(planeAt(p, performance.now())); } }, 1000);
    if (BAY) setInterval(() => { if (!document.hidden) for (const [id, m] of marks.ships) { const s = X.ships.find((x) => x.id === id); if (s) m.setLatLng(shipAt(s, performance.now())); } }, 3000);
  }
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? L(`hace ${m} min`, `${m} min ago`) : L(`hace ${Math.round(m / 60)} h`, `${Math.round(m / 60)} h ago`); };

  // ---- Screen mode scenes, shared by Pulso and Mapa ----
  // {key, mins, ll (null: the whole city), kp: Pulso zoom, zm: map zoom, cap: [kind, title, sub, color]}
  function scenes() {
    const out = [], now = performance.now();
    const near = AIRPORTS.map(([name, la, lo]) => ({ name, la, lo, p: X.planes.filter((p) => p.alt > 0 && p.alt < 4000 && KM([la, lo], [p.lat, p.lon]) < 18).sort((a, b) => a.alt - b.alt)[0] })).find((x) => x.p);
    if (near) { const p = near.p, ll = planeAt(p, now); out.push({ key: 'air' + p.id, mins: 8, ll, kp: 4.5, zm: 13, cap: [L(`Despegando o aterrizando en ${near.name}`, `Landing or taking off at ${near.name}`), p.f || p.t || p.id.toUpperCase(), `${ft(p.alt)} · ${Math.round(p.gs)} kt${p.t ? ' · ' + p.t : ''}`, C.paper] }); }
    const ship = X.ships.filter((s) => s.sog > 3 && s.name).sort((a, b) => b.sog - a.sog)[0];
    if (ship) out.push({ key: 'ship' + ship.id, mins: 10, ll: shipAt(ship, now), kp: 4, zm: 14, cap: [L('Barco en la Bahía', 'Ship on the Bay'), ship.name, [ship.to && L(`Hacia ${ship.to}`, `To ${ship.to}`), `${ship.sog.toFixed(1)} kn`].filter(Boolean).join(' · '), C.hielo] });
    const q = [...X.quakes].filter((x) => Date.now() - x.time < 6 * 3.6e6).sort((a, b) => b.mag - a.mag)[0];
    if (q) out.push({ key: 'q' + q.id, mins: 30, ll: [q.lat, q.lon], kp: 3, zm: 11, cap: [L(`Terremoto · M${q.mag.toFixed(1)}`, `Earthquake · M${q.mag.toFixed(1)}`), q.place, `${ago(q.time)} · ${L('a', 'at')} ${Math.round(q.depth)} km ${L('de profundidad', 'deep')}`, C.ambar] });
    if (X.iss && X.iss.near < 1500 && Date.now() - X.iss.at < 60000) out.push({ key: 'iss', mins: 15, ll: null, cap: [L('La Estación Espacial pasa cerca', 'The Space Station is passing by'), L(`A ${fmt.format(X.iss.near)} km de aquí`, `${fmt.format(X.iss.near)} km from here`), L(`a ${X.iss.km} km de altura, a 27.600 km/h`, `${X.iss.km} km up, at 27,600 km/h`), C.hielo] });
    if (X.air) { const w = X.air.worst; out.push({ key: 'airq', mins: 20, ll: [w.lat, w.lon], kp: 3.5, zm: 14, cap: [L('El aire ahora', 'The air right now'), L(`NO₂ ${X.air.median} µg/m³: ${airWord(X.air.median)}`, `NO₂ ${X.air.median} µg/m³: ${airWord(X.air.median)}`), L(`Lo más alto, ${w.name}: ${w.no2}`, `Highest at ${w.name}: ${w.no2}`), airColor(X.air.median)] }); }
    return out;
  }
  const ft = (v) => `${fmt.format(Math.round(v))} ft`;

  // ---- The green hero for Pulso: what moves without a car, cycled ----
  function heroes() {
    const list = [];
    const bikes = (state.bikes?.free ?? 0) + (state.bikes?.ebikes?.length ?? 0);
    if (state.bikes) list.push({ n: bikes, color: C.verde, line: L(`bicis esperando en ${CITY.name} ahora mismo.`, `bikes waiting across ${CITY.name} right now.`) });
    if (state.trains?.list.length) list.push({ n: state.trains.list.length, color: C.tren, line: L(`trenes rodando por ${CITY.name} ahora mismo.`, `trains running across ${CITY.name} right now.`) });
    if (state.buses?.list.length) list.push({ n: state.buses.list.length, color: C.hielo, line: L('autobuses en marcha ahora mismo.', 'buses on the move right now.') });
    if (X.air) list.push({ n: X.air.median, color: airColor(X.air.median), line: L(`µg/m³ de NO₂ en el aire de Madrid: ${airWord(X.air.median)}.`, `µg/m³ of NO₂ in Madrid's air: ${airWord(X.air.median)}.`) });
    return list;
  }

  return { start, on: (f) => subs.push(f), bakePulso, drawPulso, attachMap, scenes, heroes, data: X };
})();
