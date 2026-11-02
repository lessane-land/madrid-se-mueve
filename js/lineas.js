// Líneas: a departure board with every rail line, its status on split flaps, trains running and 30 days of trouble.
window.Lineas = (() => {
  const { C, on, state, norm } = MSM;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
  const N = 13;
  const rows = new Map();
  const light = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150; };
  const order = (a, b) => { const k = (s) => [s.replace(/\d.*$/, ''), parseInt(s.replace(/^\D+/, '')) || 0, s]; const [x, y] = [k(a.b), k(b.b)]; return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || (x[2] < y[2] ? -1 : 1); };

  function flapsFor(el, text, ink) {
    const target = (text.toUpperCase() + ' '.repeat(N)).slice(0, N).split('');
    if (el.dataset.text === text && el.children.length === N) { [...el.children].forEach((f) => (f.style.color = ink)); return; }
    el.dataset.text = text;
    if (el.children.length !== N) el.replaceChildren(...target.map(() => { const s = document.createElement('span'); s.className = 'flap'; return s; }));
    el.setAttribute('aria-label', text);
    [...el.children].forEach((f, i) => {
      f.style.color = ink;
      if (still) { f.textContent = target[i]; return; }
      let n = 6 + i + Math.floor(Math.random() * 5);
      const tick = () => { if (n-- <= 0 || target[i] === ' ') { f.textContent = target[i]; return; } f.textContent = ALPHA[Math.floor(Math.random() * ALPHA.length)]; setTimeout(tick, 45); };
      tick();
    });
  }

  function clock() {
    const t = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    const el = document.getElementById('clock');
    if (el.dataset.t === t) return; el.dataset.t = t;
    el.setAttribute('aria-label', 'Hora ' + t);
    const chars = t.split('');
    if (el.children.length !== chars.length) el.replaceChildren(...chars.map(() => { const s = document.createElement('span'); s.className = 'flap'; return s; }));
    [...el.children].forEach((f, i) => {
      if (f.textContent === chars[i]) return;
      if (still || chars[i] === ':') { f.textContent = chars[i]; return; }
      let n = 5; const tick = () => { if (n-- <= 0) { f.textContent = chars[i]; return; } f.textContent = String(Math.floor(Math.random() * 10)); setTimeout(tick, 50); }; tick();
    });
  }

  const short = (s) => norm(s).split(' ').filter((w) => !['de', 'del', 'la', 'el', 'las', 'los'].includes(w))[0]?.toUpperCase() ?? '';

  function build() {
    const board = document.getElementById('board'); board.replaceChildren(); rows.clear();
    const groups = [['metro', 'Metro'], ['metro_ligero', 'Metro Ligero'], ['cercanias', 'Cercanías']];
    for (const [mode, title] of groups) {
      const h = document.createElement('div'); h.className = 'group-title'; h.textContent = title; board.append(h);
      const lines = [...state.graph.lines.values()].filter((l) => l.m === mode).sort(order);
      for (const l of lines) {
        const row = document.createElement('button'); row.className = 'row'; row.type = 'button';
        row.onclick = () => { location.hash = '#mapa-' + l.b; };
        const chip = document.createElement('span'); chip.className = 'chip'; chip.style.background = l.color; chip.style.color = light(l.color) ? C.ink : C.paper; chip.textContent = l.b;
        const route = document.createElement('span'); route.className = 'route'; route.textContent = l.n || (l.b === 'R' ? 'Ópera - Príncipe Pío' : ''); const sub = document.createElement('small'); route.append(sub);
        const fl = document.createElement('span'); fl.className = 'flaps';
        const health = document.createElement('span'); health.className = 'health';
        const bar = document.createElement('span'); bar.className = 'bar30'; const fill = document.createElement('span'); bar.append(fill);
        const htxt = document.createElement('span'); health.append(bar, htxt);
        row.append(chip, route, fl, health);
        board.append(row);
        rows.set(l.i, { l, row, sub, fl, fill, htxt });
      }
    }
    paint();
  }

  function paint() {
    if (!rows.size) return;
    const items = state.status?.items ?? [];
    const perTrain = {};
    for (const t of state.trains?.list ?? []) perTrain[t.line] = (perTrain[t.line] || 0) + 1;
    const ep = {};
    for (const e of state.episodes ?? []) if (e.mode !== 'emt') ep[e.line] = (ep[e.line] || 0) + 1;
    const maxEp = Math.max(4, ...Object.values(ep));
    for (const { l, row, sub, fl, fill, htxt } of rows.values()) {
      const mine = items.filter((i) => i.lineId === l.i);
      const red = mine.find((i) => i.red), amber = mine[0];
      let text = 'NORMAL', ink = C.verde;
      if (red) { text = red.scope?.from ? `${short(red.scope.from)}-${short(red.scope.to)}` : 'CORTE'; ink = C.rojo; }
      else if (amber) { text = 'AVISO'; ink = C.ambar; }
      flapsFor(fl, text, ink);
      row.title = mine.map((i) => i.title).join(' · ');
      if (l.m === 'cercanias') {
        const n = perTrain[l.b] || 0;
        sub.textContent = n ? `${n} tren${n > 1 ? 'es' : ''} rodando ahora` : state.trains ? 'ningún tren rodando ahora' : '';
      } else sub.textContent = `${l.s.length} estaciones`;
      const n = ep[l.i] || 0;
      fill.style.width = (n / maxEp * 100) + '%'; fill.style.background = n ? C.ambar : 'transparent';
      htxt.textContent = state.episodes ? (n ? `${n} en 30 días` : 'limpia 30 días') : '';
    }
  }

  function start() {
    clock(); setInterval(clock, 15000);
    on('graph', build);
    on('status', paint); on('trains', paint); on('episodes', paint);
  }
  return { start, shown: () => { clock(); paint(); } };
})();
