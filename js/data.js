// Shared live data for every view. One poller per source, views subscribe with MSM.on(name, fn).
(() => {
  const SUPA = 'https://kdiawvzargufvoilfxmb.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkaWF3dnphcmd1ZnZvaWxmeG1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NjE1ODIsImV4cCI6MjEwOTAzNzU4Mn0.sR6yDd1SDJ86lTG0rYiGSJD4fi1XVOpabB-_kHW6uXw';
  const CFG = {
    SUPA, ANON,
    GRAPH: 'https://raw.githubusercontent.com/lessane-land/estado-madrid/main/graph-app.json',
    GBFS: 'https://madrid.publicbikesystem.net/customer/gbfs/v2/en/',
    VIVO: SUPA + '/functions/v1/vivo',
    auth: { apikey: ANON, Authorization: 'Bearer ' + ANON },
  };
  const RAIL = ['metro', 'metro_ligero', 'cercanias'];
  const C = { ink: '#0A0A0A', panel: '#141413', line: '#2A2A28', paper: '#F5F5F0', mute: '#8A8A82', hielo: '#8FD3FF', verde: '#5BE38A', ambar: '#FFB547', rojo: '#FF5A5F', tren: '#FFD27A' };

  const subs = {};
  const state = { graph: null, status: null, bikes: null, trains: null, episodes: null, ok: {} };
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
    const lines = new Map();
    for (const l of g.lines) {
      if (!RAIL.includes(l.m)) continue;
      const path = l.sh ? decode(l.sh) : l.s.map((id) => stops.get(id)).filter(Boolean).map((s) => [s.la, s.lo]);
      lines.set(l.i, { ...l, path, color: '#' + (l.c || '8A8A82') });
    }
    state.graph = { stops, lines, emt: g.stops.filter((s) => s.m === 'emt'), railStops: g.stops.filter((s) => s.m === 'metro' || s.m === 'metro_ligero') };
    emit('graph');
  }

  function lineFor(mode, b) {
    const L = state.graph.lines;
    return L.get(`${mode}:${b}`) || [...L.values()].find((x) => x.m === mode && x.b.startsWith(b));
  }

  async function loadStatus() {
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
        items.push({ mode: i.mode, b, lineId: l?.i, red, color: red ? C.rojo : C.ambar, scope: i.scope, title: cleanTitle(i.title || i.text), pts: pts || l?.path || null, partial: !!pts });
      }
    }
    state.status = { generated: row?.generated, items };
    emit('status');
  }

  async function loadBikes() {
    if (!state._bikeInfo) {
      const info = await (await fetch(CFG.GBFS + 'station_information')).json();
      state._bikeInfo = new Map(info.data.stations.map((s) => [s.station_id, s]));
    }
    const st = await (await fetch(CFG.GBFS + 'station_status')).json();
    const list = [];
    for (const s of st.data.stations) {
      const i = state._bikeInfo.get(s.station_id); if (!i) continue;
      const ok = s.is_renting && s.status === 'IN_SERVICE';
      list.push({ id: s.station_id, name: i.name.replace(/^\d+\s*-\s*/, ''), lat: i.lat, lon: i.lon, n: s.num_bikes_available, docks: s.num_docks_available, ok });
    }
    state.bikes = { list, free: list.reduce((a, b) => a + (b.ok ? b.n : 0), 0), at: Date.now() };
    emit('bikes');
  }

  async function loadTrains() {
    const r = await fetch(CFG.VIVO + '?what=trains', { headers: CFG.auth });
    if (!r.ok) throw new Error('vivo ' + r.status);
    const d = await r.json();
    state.trains = { list: d.trains, at: d.at };
    emit('trains');
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
    await Promise.all([safe('status', loadStatus), safe('bikes', loadBikes), safe('trains', loadTrains), safe('episodes', loadEpisodes)]);
    every(15000, 'trains', loadTrains);
    every(60000, 'bikes', loadBikes);
    every(120000, 'status', loadStatus);
    every(600000, 'episodes', loadEpisodes);
  }

  window.MSM = { CFG, C, state, on, start, busesNear, decode, norm, cleanTitle, lineFor };
})();
