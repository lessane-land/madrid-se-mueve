// Pulso: the city drawn by its bike stations, rail lines and trains, all live.
// Trains keep rolling along their real track between Renfe updates and leave a light trail.
// Bike stations ripple when bikes arrive or leave. Drag and zoom; hover or tap works as a lens.
window.Pulso = (() => {
  const { C, on, state } = MSM;
  const cv = document.getElementById('pulsoCanvas');
  const ctx = cv.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = new Intl.NumberFormat('es', { useGrouping: 'always' });
  const tipEl = document.getElementById('pulsoTip');
  const tickEl = document.getElementById('pulsoTicker');
  let W = 0, H = 0, dpr = 1, proj = null, base = null, baseT = null, raf = 0, shownBig = 0;
  let view = d3.zoomIdentity, pointer = null, zoomB = null;
  const trains = new Map();
  const ripples = [];
  const lastBikes = new Map();
  const KM = (a, b) => { const dx = (b[1] - a[1]) * 85.0, dy = (b[0] - a[0]) * 111.0; return Math.hypot(dx, dy); };

  function sprite(color, r) {
    const c = document.createElement('canvas'); c.width = c.height = r * 2;
    const g = c.getContext('2d'), grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, color); grad.addColorStop(.25, color + 'AA'); grad.addColorStop(1, color + '00');
    g.fillStyle = grad; g.fillRect(0, 0, r * 2, r * 2); return c;
  }
  const glowBike = sprite(C.verde, 32), glowTrain = sprite(C.tren, 40);

  function project() {
    const narrow = W < 720;
    const kx = 111.32 * Math.cos(40.42 * Math.PI / 180), ky = 111.0;
    const pxkm = narrow ? Math.min(W / 17, H / 24) : Math.min(W / 30, H / 19);
    const cx = narrow ? W * .5 : W * .62, cy = narrow ? H * .36 : H * .5;
    proj = (lat, lon) => [cx + (lon + 3.695) * kx * pxkm, cy - (lat - 40.425) * ky * pxkm];
  }
  const P = (lat, lon) => view.apply(proj(lat, lon));

  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr;
    project(); bake();
  }

  // Lines and bike glows that do not move are drawn once per view into an offscreen layer.
  function bake() {
    if (!W || !state.graph) return;
    base = document.createElement('canvas'); base.width = W * dpr; base.height = H * dpr; baseT = view;
    const g = base.getContext('2d'); g.scale(dpr, dpr);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const z = Math.sqrt(view.k);
    for (const l of state.graph.lines.values()) {
      g.strokeStyle = l.color; g.globalAlpha = l.m === 'cercanias' ? .3 : .55; g.lineWidth = (l.m === 'cercanias' ? 1 : 1.8) * z;
      g.setLineDash(l.m === 'cercanias' ? [1 * z, 4 * z] : []);
      g.beginPath(); l.path.forEach(([a, b], i) => { const [x, y] = P(a, b); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    }
    g.setLineDash([]);
    if (state.bikes) {
      g.globalCompositeOperation = 'lighter';
      for (const b of state.bikes.list) {
        const [x, y] = P(b.lat, b.lon); if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
        const r = (b.ok ? 5 + Math.min(16, b.n * .9) : 3) * z;
        g.globalAlpha = b.ok ? (b.n ? .22 + Math.min(.55, b.n / 28) : .06) : .04;
        g.drawImage(glowBike, x - r, y - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      for (const b of state.bikes.list) {
        const [x, y] = P(b.lat, b.lon);
        g.fillStyle = b.n ? '#D8FFE6' : '#3A3A36';
        g.beginPath(); g.arc(x, y, (b.n ? 1.3 : .9) * z, 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // Trains: snap each report to its line's track, estimate speed from the last two reports, keep rolling.
  function track(line) {
    const L = state.graph?.lines;
    const l = L && (L.get('cercanias:' + line) || L.get('cercanias:' + line.replace(/[ab]$/, '')));
    if (!l) return null;
    if (!l._cum) { let s = 0; l._cum = l.path.map((p, i) => (i ? (s += KM(l.path[i - 1], p)) : 0)); }
    return l;
  }
  function snap(l, lat, lon) {
    let best = 1e9, bi = 0;
    for (let i = 0; i < l.path.length; i++) { const d = KM(l.path[i], [lat, lon]); if (d < best) { best = d; bi = i; } }
    return best < .6 ? l._cum[bi] : null;
  }
  function along(l, s) {
    const c = l._cum, n = c.length; s = Math.max(0, Math.min(c[n - 1], s));
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const k = c[hi] > c[lo] ? (s - c[lo]) / (c[hi] - c[lo]) : 0, a = l.path[lo], b = l.path[hi];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  function trainLatLon(t, now) {
    const age = Math.min(25000, now - t.at);
    if (t.l && t.s != null) {
      const target = t.s + (still ? 0 : t.v * age);
      const k = still ? 1 : Math.min(1, (now - t.at) / 2500), e = 1 - Math.pow(1 - k, 3);
      return along(t.l, t.s0 + (target - t.s0) * e);
    }
    const k = still ? 1 : Math.min(1, (now - t.at) / 3000);
    return [t.from[0] + (t.to[0] - t.from[0]) * k, t.from[1] + (t.to[1] - t.from[1]) * k];
  }

  function frame(now) {
    raf = 0;
    if (document.getElementById('pulso').hidden || !W) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (base && baseT) {
      const r = view.k / baseT.k;
      ctx.setTransform(r, 0, 0, r, (view.x - baseT.x * r) * dpr, (view.y - baseT.y * r) * dpr);
      ctx.drawImage(base, 0, 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const z = Math.sqrt(view.k), pulse = still ? 1 : .65 + .35 * Math.sin(now / 520);

    if (state.status) {
      ctx.lineCap = 'round';
      for (const it of state.status.items) {
        if (!it.pts || !it.red) continue;
        ctx.strokeStyle = it.color; ctx.globalAlpha = .25 * pulse; ctx.lineWidth = 12 * z;
        ctx.beginPath(); it.pts.forEach(([a, b], i) => { const [x, y] = P(a, b); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
        ctx.globalAlpha = .95; ctx.lineWidth = 2.5 * z; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i], k = (now - r.t0) / 1800;
      if (k >= 1) { ripples.splice(i, 1); continue; }
      if (k < 0) continue;
      const [x, y] = P(r.lat, r.lon);
      ctx.strokeStyle = r.color; ctx.globalAlpha = (1 - k) * .9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, (4 + k * r.max) * z, 0, 6.283); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Trails, glow, core.
    for (const t of trains.values()) {
      const ll = trainLatLon(t, now);
      if (!t.trail.length || now - t.trail[t.trail.length - 1].at > 120) { t.trail.push({ ll, at: now }); if (t.trail.length > 40) t.trail.shift(); }
      t.cur = ll;
      if (t.trail.length > 1) {
        ctx.lineCap = 'round';
        for (let i = 1; i < t.trail.length; i++) {
          const a = P(...t.trail[i - 1].ll), b = P(...t.trail[i].ll);
          ctx.strokeStyle = t.color; ctx.globalAlpha = (i / t.trail.length) * .55; ctx.lineWidth = 2.6 * z;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const t of trains.values()) { const [x, y] = P(...t.cur); ctx.globalAlpha = .75; const s = 22 * z; ctx.drawImage(glowTrain, x - s, y - s, s * 2, s * 2); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    for (const t of trains.values()) { const [x, y] = P(...t.cur); ctx.fillStyle = '#FFF4DA'; ctx.beginPath(); ctx.arc(x, y, 3.2 * z, 0, 6.283); ctx.fill(); }

    lens(now);
    if (!still) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  // The lens: stations near the pointer swell; the nearest station or train gets a label.
  function lens() {
    if (!pointer || !state.bikes) { tipEl.hidden = true; return; }
    const R = 110;
    let near = null, nd = 1e9;
    for (const b of state.bikes.list) {
      const [x, y] = P(b.lat, b.lon), d = Math.hypot(x - pointer[0], y - pointer[1]);
      if (d > R) continue;
      const k = 1 - d / R;
      ctx.globalAlpha = .35 + .65 * k; ctx.fillStyle = b.n ? C.verde : '#5A5A55';
      ctx.beginPath(); ctx.arc(x, y, 1.5 + k * (3 + Math.min(7, b.n / 3)), 0, 6.283); ctx.fill();
      if (d < nd) { nd = d; near = { kind: 'bike', b, x, y }; }
    }
    for (const t of trains.values()) {
      const [x, y] = P(...t.cur), d = Math.hypot(x - pointer[0], y - pointer[1]);
      if (d < 26 && d < nd + 12) { nd = d; near = { kind: 'train', t, x, y }; }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(143,211,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.arc(pointer[0], pointer[1], R, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    if (!near || nd > 40) { tipEl.hidden = true; return; }
    ctx.strokeStyle = C.hielo; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(near.x, near.y, 10, 0, 6.283); ctx.stroke();
    const [a, b] = near.kind === 'bike'
      ? ['BiciMAD', `${near.b.name}: ${near.b.n} bicis, ${near.b.docks} anclajes libres`]
      : [`Cercanías ${near.t.line}`, near.t.where];
    if (tipEl.dataset.k !== a + b) {
      tipEl.dataset.k = a + b;
      const t1 = document.createElement('div'); t1.className = 'd'; t1.textContent = a;
      const t2 = document.createElement('div'); t2.textContent = b;
      tipEl.replaceChildren(t1, t2);
    }
    tipEl.hidden = false;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(W - w - 8, near.x + 16)) + 'px';
    tipEl.style.top = Math.max(8, Math.min(H - h - 8, near.y - h - 12)) + 'px';
  }

  // The ticker: only real changes, newest first.
  const events = [];
  function tick(kind, text, geo) {
    events.unshift({ kind, text, at: new Date(), ...(geo || {}) });
    if (events.length > 6) events.pop();
    const time = (d) => d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    tickEl.replaceChildren(...events.map((e, i) => {
      const li = document.createElement('li'); li.className = e.kind + (i === 0 ? ' fresh' : '');
      const t = document.createElement('time'); t.textContent = time(e.at);
      const s = document.createElement('span'); s.textContent = e.text;
      li.append(t, s); return li;
    }));
  }

  function countTo(el, to) {
    const from = shownBig, t0 = performance.now(), dur = still ? 0 : 1400;
    const step = (t) => { const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3); el.textContent = fmt.format(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step); shownBig = to;
  }

  function words() {
    const s = state.status; if (!s || !state.graph) return;
    const red = s.items.filter((i) => i.red);
    const lines = [...new Set(red.map((i) => i.b))];
    const p = document.getElementById('pulsoLine'); p.replaceChildren();
    p.append('bicis esperando en Madrid ahora mismo. ');
    if (!red.length) p.append('Metro y trenes sin cortes.');
    else {
      const first = red.find((i) => i.scope?.from) || red[0];
      p.append(first.scope?.from ? `La ${first.b} está cortada entre ${first.scope.from} y ${first.scope.to}` : `La ${first.b} tiene un corte`);
      p.append(lines.length > 1 ? `, y hay ${lines.length - 1} corte${lines.length > 2 ? 's' : ''} más.` : '.');
    }
    const cut = document.getElementById('pulsoCuts'); cut.firstElementChild.textContent = lines.length;
    cut.lastChild.textContent = lines.length === 1 ? ' corte' : ' cortes';
    const affected = new Set(s.items.map((i) => i.lineId).filter(Boolean));
    const total = state.graph.lines.size;
    document.getElementById('pulsoOk').textContent = `${total - affected.size} de ${total}`;
  }

  function when() {
    const ok = state.ok.trains || state.ok.bikes;
    document.getElementById('pulsoLive').classList.toggle('on', !!ok);
    const d = new Date().toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    document.getElementById('pulsoWhen').textContent = (ok ? 'En vivo · ' : 'Sin conexión · ') + d;
  }

  function onTrains(list) {
    const now = performance.now(), seen = new Set();
    for (const x of list) {
      seen.add(x.id);
      const stop = state.graph?.stops.get('cercanias:' + x.stop)?.n;
      const where = stop ? (x.status === 'STOPPED_AT' ? `parado en ${stop}` : `llegando a ${stop}`) : 'en marcha';
      const l = track(x.line);
      const old = trains.get(x.id);
      const s = l ? snap(l, x.lat, x.lon) : null;
      const cur = old?.cur || [x.lat, x.lon];
      const color = l ? l.color : C.tren;
      const t = old || { trail: [], id: x.id };
      Object.assign(t, { line: x.line, color, where, l: s != null ? l : null, at: now, from: cur, to: [x.lat, x.lon], cur });
      if (s != null) {
        const s0 = old?.l === l ? (old.dispS ?? s) : s;
        const dt = old && old.repAt ? (Date.now() - old.repAt) / 1000 : 0;
        let v = old?.l === l && old.s != null && dt > 5 ? (s - old.s) / (dt * 1000) : 0;
        // v is km per ms; Cercanías tops out near 120 km/h, about 0.000033 km/ms.
        v = x.status === 'STOPPED_AT' ? 0 : Math.sign(v) * Math.min(Math.abs(v), .000035);
        Object.assign(t, { s0, s, v });
      } else Object.assign(t, { s: null });
      t.repAt = Date.now();
      if (old && old.stopName !== stop && stop && x.status === 'STOPPED_AT') tick('train', `${x.line} parado en ${stop}`, { trainId: x.id, line: x.line, stop });
      t.stopName = stop;
      trains.set(x.id, t);
    }
    for (const id of [...trains.keys()]) if (!seen.has(id)) trains.delete(id);
    document.getElementById('pulsoTrains').textContent = fmt.format(trains.size);
    kick();
  }
  // Keep the displayed position on the track so the next report blends from where the train is drawn.
  setInterval(() => { const now = performance.now(); for (const t of trains.values()) if (t.l && t.s != null) { const target = t.s + t.v * Math.min(25000, now - t.at), k = Math.min(1, (now - t.at) / 2500), e = 1 - Math.pow(1 - k, 3); t.dispS = t.s0 + (target - t.s0) * e; } }, 500);

  function onBikes(b) {
    let gained = null, lost = null;
    for (const s of b.list) {
      const prev = lastBikes.get(s.id);
      if (prev != null && prev !== s.n && lastBikes.size) {
        const d = s.n - prev;
        ripples.push({ lat: s.lat, lon: s.lon, t0: performance.now() + Math.random() * 1500, color: d > 0 ? C.verde : C.ambar, max: 14 + Math.min(30, Math.abs(d) * 6) });
        if (d > 0 && (!gained || d > gained.d)) gained = { s, d };
        if (d < 0 && (!lost || d < lost.d)) lost = { s, d };
      }
      lastBikes.set(s.id, s.n);
    }
    if (ripples.length > 400) ripples.splice(0, ripples.length - 400);
    if (gained && gained.d >= 2) tick('bike', `${gained.s.name} +${gained.d} bicis`, { lat: gained.s.lat, lon: gained.s.lon, station: gained.s.id, d: gained.d });
    if (lost && lost.d <= -2) tick('bikeout', `${lost.s.name} ${lost.d} bicis`, { lat: lost.s.lat, lon: lost.s.lon, station: lost.s.id, d: lost.d });
    bake(); kick(); countTo(document.getElementById('pulsoBig'), b.free);
  }



  // Night: between Metro closing and opening the city dims, the director slows down and waits for the first train.
  const forceNight = new URLSearchParams(location.search).has('noche');
  function madridHour() { const p = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Madrid' }).formatToParts(new Date()); const g = (t) => +p.find((x) => x.type === t).value; return g('hour') + g('minute') / 60; }
  function nightness() {
    if (forceNight) return 1;
    const h = madridHour();
    if (h >= 1.5 && h < 5.5) return 1;
    if (h >= 1 && h < 1.5) return (h - 1) / .5;
    if (h >= 5.5 && h < 6.25) return 1 - (h - 5.5) / .75;
    return 0;
  }
  let night = 0, wasNight = false;
  function applyNight() {
    night = nightness();
    cv.style.filter = night ? `brightness(${1 - .5 * night}) saturate(${1 - .35 * night})` : '';
    document.body.classList.toggle('night', night > .5);
    if (night > .5) wasNight = true;
  }

  // Modo pantalla: full screen, no interface, the camera flies to what is happening right now.
  const D = { on: false, timer: 0, n: 0, shown: new Map(), lock: null, idle: 0 };
  const capEl = () => document.getElementById('dirCaption');
  const clip = (t, n) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '...');
  function caption(kind, title, sub, color) {
    const el = capEl(); el.classList.remove('in');
    setTimeout(() => {
      el.querySelector('.k').textContent = kind; el.querySelector('.t').textContent = title; el.querySelector('.s').textContent = sub || '';
      el.style.setProperty('--cap', color || C.paper); el.classList.add('in');
    }, still ? 0 : 450);
  }
  function fly(lat, lon, k, dur) {
    const [px, py] = proj(lat, lon), narrow = W < 720;
    const cx = narrow ? W * .5 : W * .6, cy = narrow ? H * .38 : H * .44;
    const t = d3.zoomIdentity.translate(cx - k * px, cy - k * py).scale(k);
    d3.select(cv).transition().duration(still ? 0 : dur).ease(d3.easeCubicInOut).call(zoomB.transform, t);
  }
  function home(dur) { d3.select(cv).transition().duration(still ? 0 : dur).ease(d3.easeCubicInOut).call(zoomB.transform, d3.zoomIdentity); }
  const fresh = (key, mins) => { const t = D.shown.get(key); return !t || Date.now() - t > mins * 60000; };
  const mark = (key) => D.shown.set(key, Date.now());
  function nextScene() {
    const list = [];
    for (const it of state.status?.items ?? []) if (it.red && it.pts && it.partial && fresh('cut' + it.b, 6)) list.push({ key: 'cut' + it.b, run: () => {
      const xs = it.pts.map((p) => proj(...p)), x0 = Math.min(...xs.map((p) => p[0])), x1 = Math.max(...xs.map((p) => p[0])), y0 = Math.min(...xs.map((p) => p[1])), y1 = Math.max(...xs.map((p) => p[1]));
      const k = Math.max(1.6, Math.min(6, .42 * W / Math.max(30, x1 - x0), .42 * H / Math.max(30, y1 - y0)));
      const mid = it.pts[Math.floor(it.pts.length / 2)];
      fly(mid[0], mid[1], k, 4200);
      caption('Corte en vivo', `${it.b} cortada entre ${it.scope.from} y ${it.scope.to}`, clip(it.title, 130), C.rojo);
    } });
    const tr = events.find((e) => e.kind === 'train' && trains.has(e.trainId) && fresh('tr' + e.trainId + e.stop, 20));
    if (tr) list.push({ key: 'tr' + tr.trainId + tr.stop, run: () => {
      const t = trains.get(tr.trainId); fly(t.cur[0], t.cur[1], 4.5, 4200);
      caption('Cercanías ' + tr.line, `Parado en ${tr.stop}`, `${trains.size} trenes rodando por Madrid ahora mismo`, t.color);
    } });
    const bk = events.find((e) => (e.kind === 'bike' || e.kind === 'bikeout') && fresh('bk' + e.station + e.at, 30));
    if (bk) list.push({ key: 'bk' + bk.station + bk.at, run: () => {
      const st = state.bikes?.list.find((b) => b.id === bk.station);
      fly(bk.lat, bk.lon, 5, 4200);
      caption('BiciMAD', `${st?.name ?? 'Estación'} · ${bk.d > 0 ? '+' : ''}${bk.d} bicis`, st ? `${st.n} bicis y ${st.docks} anclajes libres ahora` : '', bk.d > 0 ? C.verde : C.ambar);
    } });
    for (const pl of window.MiMadrid?.places?.() ?? []) if (fresh('pl' + pl.id, 8)) list.push({ key: 'pl' + pl.id, run: () => {
      const b = window.MiMadrid.nearestBike(pl);
      fly(pl.lat, pl.lon, 5.5, 4200);
      const bikeLine = b ? `${b.docks} anclajes libres · a ${Math.round(b.m)} m` : '';
      caption('Mi Madrid · ' + pl.label, b ? `${b.n} bicis en ${b.name}` : pl.name, bikeLine, b ? (b.n === 0 ? C.rojo : b.n < 4 ? C.ambar : C.verde) : C.paper);
      window.MiMadrid.buses?.(pl).then((list) => {
        const next = (list || []).filter((v) => v.secs != null).sort((a, z) => a.secs - z.secs)[0];
        if (!next || !D.on) return;
        const stop = state.graph?.stops.get('emt:' + next.stop)?.n;
        const eta = next.secs < 60 ? 'llegando' : `en ${Math.round(next.secs / 60)} min`;
        setTimeout(() => { if (D.on) caption('Mi Madrid · ' + pl.label, `Tu ${next.line} ${eta}`, `Hacia ${next.dest.toLowerCase()}${stop ? ', parada ' + stop : ''} · ${b ? b.n + ' bicis al lado' : ''}`, C.hielo); }, 5200);
      });
    } });
    D.n++;
    if (night > .5) {
      return () => {
        home(6000);
        const t = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
        caption('Madrid duerme', t, `El Metro vuelve a las 6:00. ${fmt.format(state.bikes?.free ?? 0)} bicis esperando${trains.size ? ` y ${trains.size} trenes todavía rodando` : ''}.`, C.hielo);
      };
    }
    if (wasNight && night < .5 && trains.size) {
      wasNight = false;
      const first = [...trains.values()][0];
      return () => { fly(first.cur[0], first.cur[1], 4, 5000); caption('Madrid despierta', `Primer tren: ${first.line}`, first.where.charAt(0).toUpperCase() + first.where.slice(1), C.tren); };
    }
    if (D.n % 2 === 1 || !list.length) {
      return () => { home(3600); caption('Madrid se mueve', `${fmt.format(state.bikes?.free ?? 0)} bicis libres`, `${trains.size} trenes de Cercanías rodando · ${new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`, C.verde); };
    }
    const pick = list[0]; mark(pick.key); return pick.run;
  }
  function stepDirector() {
    if (!D.on) return;
    nextScene()();
    D.timer = setTimeout(stepDirector, night > .5 ? 30000 : still ? 14000 : 11000);
  }
  async function lockScreen() { try { D.lock = await navigator.wakeLock?.request('screen'); } catch {} }
  function enterScreen() {
    if (D.on) return; D.on = true;
    document.body.classList.add('screen');
    document.documentElement.requestFullscreen?.().catch(() => {});
    lockScreen(); pointer = null;
    setTimeout(() => { size(); stepDirector(); }, 300);
  }
  function exitScreen() {
    if (!D.on) return; D.on = false; clearTimeout(D.timer);
    document.body.classList.remove('screen', 'still-mouse');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    D.lock?.release?.().catch(() => {}); D.lock = null;
    capEl().classList.remove('in'); home(1200); setTimeout(size, 300);
  }
  document.addEventListener('visibilitychange', () => { if (D.on && !document.hidden) lockScreen(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && D.on) exitScreen(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') exitScreen(); });
  addEventListener('pointermove', () => { if (!D.on) return; document.body.classList.remove('still-mouse'); clearTimeout(D.idle); D.idle = setTimeout(() => document.body.classList.add('still-mouse'), 2500); });

  function start() {
    document.querySelectorAll('[data-screen]').forEach((b) => b.addEventListener('click', enterScreen));
    document.getElementById('dirExit').addEventListener('click', exitScreen);
    new ResizeObserver(() => { size(); kick(); }).observe(cv);
    const zoom = zoomB = d3.zoom().scaleExtent([1, 8]).on('zoom', (e) => { view = e.transform; pointer = null; kick(); })
      .on('end', () => { bake(); kick(); });
    d3.select(cv).call(zoom).on('dblclick.zoom', null);
    document.getElementById('pulsoReset').onclick = () => d3.select(cv).transition().duration(still ? 0 : 700).call(zoom.transform, d3.zoomIdentity);
    cv.addEventListener('pointermove', (e) => { if (e.buttons || D.on) return; const r = cv.getBoundingClientRect(); pointer = [e.clientX - r.left, e.clientY - r.top]; kick(); if (still) frame(performance.now()); });
    cv.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { const r = cv.getBoundingClientRect(); pointer = [e.clientX - r.left, e.clientY - r.top]; kick(); } });
    cv.addEventListener('pointerleave', () => { pointer = null; tipEl.hidden = true; kick(); });
    on('graph', () => { bake(); kick(); words(); });
    on('bikes', onBikes);
    on('status', (s) => {
      const red = s.items.filter((i) => i.red && i.scope?.from);
      for (const i of red) if (!tick.seen?.has(i.b)) { (tick.seen = tick.seen || new Set()).add(i.b); tick('cut', `${i.b} cortada ${i.scope.from} a ${i.scope.to}`); }
      words(); kick();
    });
    on('trains', (t) => onTrains(t.list));
    on('health', when);
    applyNight(); setInterval(() => { when(); applyNight(); }, 30000);
  }
  return { start, enterScreen, exitScreen, events: () => events, trains: () => trains, nightness, shown: () => { size(); kick(); } };
})();
