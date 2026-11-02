// Pulso: the city drawn by its bike stations, its rail lines and the trains moving on them. Live.
window.Pulso = (() => {
  const { C, on, state } = MSM;
  const cv = document.getElementById('pulsoCanvas');
  const ctx = cv.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = new Intl.NumberFormat('es', { useGrouping: 'always' });
  let W = 0, H = 0, dpr = 1, proj = null, base = null, raf = 0, shownBig = 0;
  const trains = new Map();

  function sprite(color, r) {
    const c = document.createElement('canvas'); c.width = c.height = r * 2;
    const g = c.getContext('2d'), grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, color); grad.addColorStop(.25, color + 'AA'); grad.addColorStop(1, color + '00');
    g.fillStyle = grad; g.fillRect(0, 0, r * 2, r * 2); return c;
  }
  const glowBike = sprite(C.verde, 32), glowTrain = sprite(C.tren, 40), glowCut = sprite(C.rojo, 24);

  function project() {
    const narrow = W < 720;
    const kx = 111.32 * Math.cos(40.42 * Math.PI / 180), ky = 111.0;
    const pxkm = narrow ? Math.min(W / 17, H / 24) : Math.min(W / 30, H / 19);
    const cx = narrow ? W * .5 : W * .62, cy = narrow ? H * .36 : H * .5;
    proj = (lat, lon) => [cx + (lon + 3.695) * kx * pxkm, cy - (lat - 40.425) * ky * pxkm];
  }

  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    project(); bake();
  }

  // Everything that does not move goes into one offscreen layer.
  function bake() {
    if (!W || !state.graph) return;
    base = document.createElement('canvas'); base.width = W * dpr; base.height = H * dpr;
    const g = base.getContext('2d'); g.scale(dpr, dpr);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const l of state.graph.lines.values()) {
      g.strokeStyle = l.color; g.globalAlpha = l.m === 'cercanias' ? .28 : .5; g.lineWidth = l.m === 'cercanias' ? 1 : 1.8;
      g.setLineDash(l.m === 'cercanias' ? [1, 4] : []);
      g.beginPath(); l.path.forEach(([a, b], i) => { const [x, y] = proj(a, b); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    }
    g.setLineDash([]);
    if (state.bikes) {
      g.globalCompositeOperation = 'lighter';
      for (const b of state.bikes.list) {
        const [x, y] = proj(b.lat, b.lon); if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
        const r = b.ok ? 5 + Math.min(16, b.n * .9) : 3;
        g.globalAlpha = b.ok ? (b.n ? .22 + Math.min(.55, b.n / 28) : .06) : .04;
        g.drawImage(glowBike, x - r, y - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      for (const b of state.bikes.list) {
        const [x, y] = proj(b.lat, b.lon);
        g.fillStyle = b.n ? '#D8FFE6' : '#3A3A36';
        g.beginPath(); g.arc(x, y, b.n ? 1.3 : .9, 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  function trainPos(t, now) {
    const k = still ? 1 : Math.min(1, (now - t.t0) / 4000), e = 1 - Math.pow(1 - k, 3);
    return [t.from[0] + (t.to[0] - t.from[0]) * e, t.from[1] + (t.to[1] - t.from[1]) * e];
  }

  function frame(now) {
    raf = 0;
    if (document.getElementById('pulso').hidden) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (base) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    const pulse = still ? 1 : .65 + .35 * Math.sin(now / 520);
    if (state.status) {
      ctx.lineCap = 'round';
      for (const it of state.status.items) {
        if (!it.pts || !it.red) continue;
        ctx.strokeStyle = it.color; ctx.globalAlpha = .25 * pulse; ctx.lineWidth = 12;
        ctx.beginPath(); it.pts.forEach(([a, b], i) => { const [x, y] = proj(a, b); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
        ctx.globalAlpha = .95; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const t of trains.values()) {
      const [la, lo] = trainPos(t, now), [x, y] = proj(la, lo);
      ctx.globalAlpha = .75; ctx.drawImage(glowTrain, x - 22, y - 22, 44, 44);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = '#FFF4DA';
    for (const t of trains.values()) { const [la, lo] = trainPos(t, now), [x, y] = proj(la, lo); ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.283); ctx.fill(); }
    if (!still) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

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
    const total = [...state.graph.lines.values()].length;
    document.getElementById('pulsoOk').textContent = `${total - affected.size} de ${total}`;
  }

  function when() {
    const ok = state.ok.trains || state.ok.bikes;
    document.getElementById('pulsoLive').classList.toggle('on', !!ok);
    const d = new Date().toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    document.getElementById('pulsoWhen').textContent = (ok ? 'En vivo · ' : 'Sin conexión · ') + d;
  }

  function start() {
    new ResizeObserver(() => { size(); kick(); }).observe(cv);
    on('graph', () => { bake(); kick(); words(); });
    on('bikes', (b) => { bake(); kick(); countTo(document.getElementById('pulsoBig'), b.free); });
    on('status', () => { words(); kick(); });
    on('trains', (t) => {
      const now = performance.now(), seen = new Set();
      for (const x of t.list) {
        seen.add(x.id);
        const old = trains.get(x.id);
        const cur = old ? trainPos(old, now) : [x.lat, x.lon];
        trains.set(x.id, { from: cur, to: [x.lat, x.lon], t0: now });
      }
      for (const id of [...trains.keys()]) if (!seen.has(id)) trains.delete(id);
      document.getElementById('pulsoTrains').textContent = fmt.format(trains.size);
      kick();
    });
    on('health', when);
    setInterval(when, 30000);
  }
  return { start, shown: () => { size(); kick(); } };
})();
