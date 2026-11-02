// Shared live data for every view. One poller per source, views subscribe with MSM.on(name, fn).
(() => {
  const SUPA = 'https://kdiawvzargufvoilfxmb.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkaWF3dnphcmd1ZnZvaWxmeG1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NjE1ODIsImV4cCI6MjEwOTAzNzU4Mn0.sR6yDd1SDJ86lTG0rYiGSJD4fi1XVOpabB-_kHW6uXw';
  const CFG = {
    SUPA, ANON,
    GRAPH: CITY.graph,
    VIVO: SUPA + '/functions/v1/vivo',
    auth: { apikey: ANON, Authorization: 'Bearer ' + ANON },
  };
  const RAIL = CITY.rail, BAY = CITY.id === 'bay';
  const C = { ink: '#0A0A0A', panel: '#141413', line: '#2A2A28', paper: '#F5F5F0', mute: '#8A8A82', hielo: '#8FD3FF', verde: '#5BE38A', ambar: '#FFB547', rojo: '#FF5A5F', tren: '#FFD27A' };

  const subs = {};
  const state = { graph: null, status: null, bikes: null, trains: null, buses: null, roads: null, episodes: null, ok: {} };
  const emit = (k) => (subs[k] || []).forEach((f) => { try { f(state[k], state); } catch (e) { console.error(e); } });
  const on = (k, f) => { (subs[k] = subs[k] || []).push(f); if (state[k]) f(state[k], state); };

  function decode(str) {
    let i = 0, lat = 0, lon = 0; const out = [];
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
        const d = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += d; else lon += d;
      }
      out.push([lat / 1e5, lon / 1e5]);
    }
    return out;
  }
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cleanTitle = (t) => String(t || '').replace(/^#Mad\w*\s*/i, '');

  async function loadGraph() {
    const g = await (await fetch(CFG.GRAPH)).json();
    const stops = new Map(g.stops.map((s) => [s.i, s]));
    const lines = new Map(), canon = new Map(), boardKey = new Map();
    for (const l of g.lines) {
      if (!RAIL.includes(l.m)) continue;
      if (BAY && /Bridge|^SC:Event/.test(l.i)) continue;   // bus bridges and stadium specials are not lines
      const path = l.sh ? decode(l.sh) : l.s.map((id) => stops.get(id)).filter(Boolean).map((s) => [s.la, s.lo]);
      const color = l.c?.startsWith('#') ? l.c : '#' + (l.c || '8A8A82');
      const line = { ...l, path, color };
      // BART publishes each direction as its own route (Red-N, Red-S): one line on the board and in status.
      if (BAY) {
        line.b = l.b.replace(/-[NS]$/, '').replace(/ Line$/, '');
        if (line.n && line.n === line.n.toUpperCase()) line.n = line.n.toLowerCase().replace(/(^|[\s(/-])(\w)/g, (m, p, c) => p + c.toUpperCase());
        const k = l.a + ':' + line.b;
        if (boardKey.has(k)) line.dup = true; else boardKey.set(k, l.i);
        canon.set(l.i, boardKey.get(k));
      } else canon.set(l.i, l.i);
      lines.set(l.i, line);
    }
    const routes = new Map((g.routes ?? []).map((r) => [r.i, r]));
    state.graph = { stops, lines, canon, routes, agencies: g.agencies, alias: g.alias ?? {}, emt: g.stops.filter((s) => s.m === 'emt'),
      railStops: BAY ? g.stops : g.stops.filter((s) => s.m === 'metro' || s.m === 'metro_ligero') };
    emit('graph');
  }

  function lineFor(mode, b) {
    const L = state.graph.lines;
    return L.get(`${mode}:${b}`) || [...L.values()].find((x) => x.m === mode && x.b.startsWith(b));
  }

  // A 511 vehicle or alert names its route; the graph keys lines by 511 route id, sometimes without the agency prefix.
  const bayLine = (a, r) => state.graph?.lines.get(r) || state.graph?.lines.get(`${a}:${r}`) || null;

  async function loadBayStatus() {
    const r = await fetch(CFG.VIVO + '?city=bay&what=alerts', { headers: CFG.auth });
    if (!r.ok) throw new Error('vivo ' + r.status);
    const d = await r.json(), now = Date.now() / 1000, items = [], seen = new Set();
    for (const a of d.alerts ?? []) {
      if (a.from && a.from > now) continue;
      if (a.until && a.until < now) continue;
      const red = a.effect === 1;   // NO_SERVICE
      for (const e of a.on ?? []) {
        const l = e.r && bayLine(e.a, e.r); if (!l) continue;
        const id = state.graph.canon.get(l.i), key = a.id + id;
        if (seen.has(key)) continue; seen.add(key);
        items.push({ mode: l.m, b: l.b, lineId: id, red, color: red ? C.rojo : C.ambar, scope: null, title: a.title || a.text, pts: l.path, partial: false });
      }
    }
    state.status = { generated: new Date(d.at).toISOString(), items };
    emit('status');
  }

  async function loadStatus() {
    if (BAY) return loadBayStatus();
    const r = await fetch(`${SUPA}/rest/v1/estado?id=eq.1&select=generated,levels,incidents`, { headers: CFG.auth });
    const [row] = await r.json();
    const now = Date.now();
    const inc = (row?.incidents ?? []).filter((i) => RAIL.includes(i.mode) && !i.upcoming && !(i.until && Date.parse(i.until) < now));
    const items = [];
    for (const i of inc) {
      const red = /rojo/i.test(i.severity);
      for (const b of i.lines ?? []) {
        const l = state.graph && lineFor(i.mode, b);
        let pts = null;
        if (l && i.scope?.from && i.scope?.to) {
          const seq = l.s.map((id) => state.graph.stops.get(id)).filter(Boolean);
          const a = seq.findIndex((s) => norm(s.n).includes(norm(i.scope.from))), z = seq.findIndex((s) => norm(s.n).includes(norm(i.scope.to)));
          if (a >= 0 && z >= 0) pts = seq.slice(Math.min(a, z), Math.max(a, z) + 1).map((s) => [s.la, s.lo]);
        }
        items.push({ mode: i.mode, b, lineId: l ? state.graph.canon.get(l.i) : undefined, red, color: red ? C.rojo : C.ambar, scope: i.scope, title: cleanTitle(i.title || i.text), pts: pts || l?.path || null, partial: !!pts });
      }
    }
    state.status = { generated: row?.generated, items };
    emit('status');
  }

  async function loadBikes() {
    if (!state._bikeInfo) {
      const info = await (await fetch(CITY.gbfs('station_information'))).json();
      state._bikeInfo = new Map(info.data.stations.map((s) => [s.station_id, s]));
    }
    const st = await (await fetch(CITY.gbfs('station_status'))).json();
    const list = [];
    for (const s of st.data.stations) {
      const i = state._bikeInfo.get(s.station_id); if (!i) continue;
      const ok = !!s.is_renting && (s.status ? s.status === 'IN_SERVICE' : s.is_installed !== 0);
      list.push({ id: s.station_id, name: i.name.replace(/^\d+\s*-\s*/, ''), lat: i.lat, lon: i.lon, n: s.num_bikes_available, docks: s.num_docks_available, ok });
    }
    // Bay Wheels also leaves e-bikes parked on the street, outside any dock, and posts its own alerts.
    let ebikes = [], alerts = [];
    if (BAY) {
      try { ebikes = (await (await fetch(CITY.gbfs('free_bike_status'))).json()).data.bikes.filter((b) => !b.is_disabled && !b.is_reserved).map((b) => ({ lat: b.lat, lon: b.lon })); } catch {}
      try { alerts = (await (await fetch(CITY.gbfs('system_alerts'))).json()).data.alerts ?? []; } catch {}
    }
    state.bikes = { list, ebikes, alerts, free: list.reduce((a, b) => a + (b.ok ? b.n : 0), 0), at: Date.now() };
    emit('bikes');
  }

  // Trains: {id, line (badge), lineId (canonical), lat, lon, status, stop (name or null)}.
  async function loadTrains() {
    if (BAY) return loadBayVehicles();
    const r = await fetch(CFG.VIVO + '?what=trains', { headers: CFG.auth });
    if (!r.ok) throw new Error('vivo ' + r.status);
    const d = await r.json();
    const list = d.trains.map((t) => {
      const l = state.graph && (state.graph.lines.get('cercanias:' + t.line) || state.graph.lines.get('cercanias:' + t.line.replace(/[ab]$/, '')));
      return { ...t, lineId: l?.i ?? null, stop: state.graph?.stops.get('cercanias:' + t.stop)?.n ?? null };
    });
    state.trains = { list, at: d.at };
    emit('trains');
  }

  // BART sends no positions, only each trip's next arrivals. Place each train between the station it left and the
  // next one, by time, along the line's real track. Recomputed every few seconds so the trains keep moving.
  const KM = (a, b) => Math.hypot((b[1] - a[1]) * 88.0, (b[0] - a[0]) * 111.0);
  function trackOf(l) {
    if (!l._cum) { let d = 0; l._cum = l.path.map((p, i) => (i ? (d += KM(l.path[i - 1], p)) : 0)); }
    return l;
  }
  function onTrack(l, lat, lon) { let best = 1e9, bi = 0; l.path.forEach((p, i) => { const d = KM(p, [lat, lon]); if (d < best) { best = d; bi = i; } }); return l._cum[bi]; }
  function atKm(l, km) {
    const c = l._cum, n = c.length; let lo = 0, hi = n - 1; km = Math.max(c[0], Math.min(c[n - 1], km));
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= km) lo = m; else hi = m; }
    const k = c[hi] > c[lo] ? (km - c[lo]) / (c[hi] - c[lo]) : 0, a = l.path[lo], b = l.path[hi];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  function bartTrains() {
    const g = state.graph, trips = state._bart ?? [], now = Date.now() / 1000, out = [];
    if (!g) return out;
    const station = (id) => g.stops.get(g.alias[id] || id) || g.stops.get(id);
    for (const t of trips) {
      const l = bayLine('BA', t.r); if (!l || l.path.length < 2) continue;
      trackOf(l);
      const u = t.u.map(([id, arr, dep]) => ({ st: station(id), arr, dep })).filter((x) => x.st);
      if (!u.length) continue;
      let k = u.findIndex((x) => x.dep >= now);
      if (k < 0) continue;                                     // trip already done
      const next = u[k];
      let pos, status;
      if (next.arr <= now) { pos = [next.st.la, next.st.lo]; status = 'STOPPED_AT'; }
      else {
        const seq = l.s, i = seq.indexOf(next.st.i);
        const prevSt = k > 0 ? u[k - 1].st : i > 0 ? g.stops.get(seq[i - 1]) : null;
        if (!prevSt) { pos = [next.st.la, next.st.lo]; status = 'INCOMING_AT'; }
        else {
          const a = onTrack(l, prevSt.la, prevSt.lo), b = onTrack(l, next.st.la, next.st.lo);
          const run = Math.max(60, Math.abs(b - a) / 55 * 3600 + 20);   // about 55 km/h between stations
          const left = k > 0 ? u[k - 1].dep : next.arr - run;
          const f = Math.max(0, Math.min(1, (now - left) / Math.max(30, next.arr - left)));
          pos = atKm(l, a + (b - a) * f); status = 'IN_TRANSIT_TO';
        }
      }
      out.push({ id: 'BA:' + t.id, line: l.b, lineId: l.i, lat: pos[0], lon: pos[1], status, stop: next.st.n });
    }
    return out;
  }
  function mergeTrains() {
    state.trains = { list: [...(state._rail ?? []), ...bartTrains()], at: Date.now() };
    emit('trains');
  }

  // The Bay: one 511 feed with every vehicle. Rail, tram, cable car and ferry become trains; the rest are buses.
  const STATUS = { 0: 'INCOMING_AT', 1: 'STOPPED_AT', 2: 'IN_TRANSIT_TO' };
  const OPS = { SF: 'Muni', AC: 'AC Transit', SC: 'VTA', SM: 'SamTrans', GG: 'Golden Gate', CC: 'County Connection', WH: 'Wheels', MA: 'Marin Transit',
    '3D': 'Tri Delta', ST: 'SolTrans', VN: 'VINE', SR: 'Santa Rosa', SO: 'Sonoma County', PE: 'Petaluma', WC: 'WestCat', UC: 'Union City', FS: 'FAST',
    EM: 'Emery Go-Round', DE: 'Dumbarton Express', CM: 'Commute.org', SI: 'SFO', MB: 'Mission Bay', PG: 'Presidio Go', VC: 'Vacaville', RV: 'Delta Breeze' };
  async function loadBayVehicles() {
    const r = await fetch(CFG.VIVO + '?city=bay&what=vehicles', { headers: CFG.auth });
    if (!r.ok) throw new Error('vivo ' + r.status);
    const d = await r.json(), trains = [], buses = [];
    for (const v0 of d.vehicles ?? []) {
      const v = { ...v0, a: v0.a || (v0.r.includes(':') ? v0.r.split(':')[0] : '') };
      const l = bayLine(v.a, v.r);
      if (l) {
        const stop = state.graph.stops.get(v.s) || state.graph.stops.get(`${v.a}:${v.s}`);
        trains.push({ id: v.a + ':' + v.id, line: l.b, lineId: l.i, lat: v.lat, lon: v.lon, status: STATUS[v.st] ?? '', stop: stop?.n ?? null });
      } else if (v.r) {
        const rt = state.graph?.routes.get(v.r) || state.graph?.routes.get(`${v.a}:${v.r}`);
        buses.push({ bus: v.a + ':' + v.id, line: rt?.b || v.r.split(':').pop() || '?', dest: rt?.n || '', color: rt?.c || C.hielo, op: OPS[v.a] || state.graph?.agencies?.[v.a] || v.a, lat: v.lat, lon: v.lon, secs: null });
      }
    }
    state._rail = trains; state._bart = d.bart ?? [];
    state.buses = { list: buses, at: d.at };
    mergeTrains(); emit('buses');
  }

  // The Bay's roads: closures happening now and express lane and bridge tolls.
  async function loadRoads() {
    const r = await fetch(CFG.VIVO + '?city=bay&what=roads', { headers: CFG.auth });
    if (!r.ok) throw new Error('vivo ' + r.status);
    const d = await r.json();
    state.roads = { roads: d.roads ?? [], tolls: d.tolls ?? [], at: d.at };
    emit('roads');
  }

  async function loadEpisodes() {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const r = await fetch(`${SUPA}/rest/v1/line_episodes?select=line,mode,severity,from_stop,to_stop,started,ended,title&started=gte.${since}&order=started.desc&limit=1000`, { headers: CFG.auth });
    state.episodes = await r.json();
    emit('episodes');
  }

  async function busesNear(stopIds) {
    const r = await fetch(CFG.VIVO + '?what=buses&stops=' + stopIds.join(','), { headers: CFG.auth });
    if (!r.ok) throw new Error('vivo');
    return (await r.json()).buses;
  }

  const safe = async (name, f) => { try { await f(); state.ok[name] = true; } catch (e) { state.ok[name] = false; } emit('health'); };
  const every = (ms, name, f) => setInterval(() => { if (!document.hidden) safe(name, f); }, ms);

  async function start() {
    await safe('graph', loadGraph);
    await Promise.all([safe('status', loadStatus), safe('bikes', loadBikes), safe('trains', loadTrains), CITY.episodes && safe('episodes', loadEpisodes)]);
    every(BAY ? 60000 : 15000, 'trains', loadTrains);
    every(30000, 'bikes', loadBikes);
    every(BAY ? 300000 : 120000, 'status', loadStatus);
    if (CITY.episodes) every(600000, 'episodes', loadEpisodes);
    if (BAY) { safe('roads', loadRoads); every(600000, 'roads', loadRoads); setInterval(() => { if (!document.hidden && state._bart?.length) mergeTrains(); }, 5000); }
  }

  window.MSM = { CFG, C, state, on, start, busesNear, decode, norm, cleanTitle, lineFor };
})();
