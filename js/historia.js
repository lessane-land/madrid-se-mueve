// Historia: BiciMAD day by day since 2024 against rain, free days, strikes and the blackout.
window.Historia = (() => {
const SRC = {
  viajes: ['https://datos.emtmadrid.es/dataset/a3442c30-ee33-434f-998d-c63a51a8c446/resource/883ba442-76f4-4969-b5b2-1e9d50df2f86/download/bicimadviajesdia.csv', 'data/viajes.csv'],
  usuarios: ['https://datos.emtmadrid.es/dataset/94367cbb-e8ef-4b16-8919-9101f4fc806b/resource/7df58d15-da12-420d-9881-97e54de762c4/download/historicousuariosactivos.csv', 'data/usuarios.csv'],
};
const COL = { hielo: '#8FD3FF', paper: '#F5F5F0', mute: '#8A8A82', line: '#2A2A28', verde: '#5BE38A', ambar: '#FFB547', rojo: '#FF5A5F', ink: '#0A0A0A' };
const KIND = { gratis: COL.hielo, evento: COL.hielo, huelga: COL.ambar, corte: COL.rojo };
const $ = (id) => document.getElementById(id);
const fmt = CITY.fmt, H = CITY.L, LOC = CITY.locale;
const f = {
  n: (v) => fmt.format(v), c: (v) => new Intl.NumberFormat(LOC, { notation: 'compact', maximumFractionDigits: 1 }).format(v),
  p: (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + ' %',
  d: (s) => new Date(s + 'T00:00:00Z').toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
  m: (s) => new Date(s + '-01T00:00:00Z').toLocaleDateString(LOC, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
};
const P = (s) => new Date(s + 'T00:00:00Z');
const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

// Reads ; or , separated text with a header row. EMT files are FECHA;VIAJES and FECHA;USUARIOS ACTIVOS.
function rows(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const sep = lines[0].includes(';') ? ';' : ',';
  const split = (l) => { const out = []; let c = '', q = false; for (const ch of l) { if (ch === '"') { q = !q; continue; } if (ch === sep && !q) { out.push(c); c = ''; continue; } c += ch; } out.push(c); return out; };
  const head = split(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v.trim()])));
}
async function load(name) {
  for (const url of SRC[name]) { try { const r = await fetch(url); if (r.ok) return { live: !url.startsWith('data/'), rows: rows(await r.text()) }; } catch {} }
  throw new Error(name);
}
const local = async (p) => rows(await (await fetch(p)).text());

function build(viajes, tiempo, eventos) {
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const rain = new Map(tiempo.map((r) => [r.day, r.rain_mm === '' ? null : Number(r.rain_mm)]));
  const ev = new Map();
  for (const e of eventos) for (let t = Date.parse(e.start + 'T00:00:00Z'); t <= Date.parse(e.end + 'T00:00:00Z'); t += 864e5) ev.set(day(t), e);
  const list = viajes.map((r) => ({ day: (r.fecha || r.day).slice(0, 10), trips: Number(r.viajes ?? r.trips) })).filter((r) => r.day && r.trips >= 0).sort((a, b) => a.day < b.day ? -1 : 1);
  const n = new Map(list.map((r) => [r.day, r.trips]));
  const ok = (d) => n.has(d) && rain.get(d) != null && rain.get(d) < 0.5 && !ev.has(d);
  return list.map((r, i) => {
    const t = P(r.day).getTime(), ref = [];
    for (let k = -5; k <= 5; k++) { const x = day(t + k * 7 * 864e5); if (k && ok(x)) ref.push(n.get(x)); }
    const normal = ref.length >= 3 ? Math.round(median(ref)) : null;
    const w = list.slice(Math.max(0, i - 6), i + 1);
    const e = ev.get(r.day);
    return { ...r, rain: rain.get(r.day) ?? null, avg7: Math.round(d3.mean(w, (x) => x.trips)), normal, vs: normal ? r.trips / normal - 1 : null, event: e?.label ?? '', kind: e?.kind ?? '' };
  });
}

const axisStyle = (g) => g.call((s) => s.select('.domain').attr('stroke', COL.line)).call((s) => s.selectAll('.tick line').attr('stroke', COL.line)).attr('font-size', null).attr('font-family', null);
const textW = (svg, strings) => { const t = svg.append('text').style('font-size', '12px'); let w = 0; for (const s of strings) { t.text(s); w = Math.max(w, t.node().getComputedTextLength()); } t.remove(); return w; };
function tipFor(el) { const t = document.createElement('div'); t.className = 'tip'; t.hidden = true; el.append(t); return t; }
function show(el, t, x, y, lines) {
  t.replaceChildren(...lines.map((l, i) => { const d = document.createElement('div'); if (!i) d.className = 'd'; d.textContent = l; return d; }));
  t.hidden = false; t.style.left = Math.max(0, Math.min(el.clientWidth - t.offsetWidth, x + 12)) + 'px'; t.style.top = Math.max(0, y - 10) + 'px';
}

function daily(el, rows, eventos) {
  el.replaceChildren();
  const W = el.clientWidth, H = 320, svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
  const y = d3.scaleLinear([0, d3.max(rows, (r) => r.trips) * 1.05], [H - 24, 8]).nice();
  const ml = textW(svg, y.ticks(5).map(f.c)) + 10;
  const x = d3.scaleUtc([P(rows[0].day), P(rows.at(-1).day)], [ml, W - 8]);
  for (const e of eventos) {
    const a = x(P(e.start)) - 1, b = x(new Date(P(e.end).getTime() + 864e5));
    svg.append('rect').attr('x', a).attr('y', 8).attr('width', Math.max(3, b - a)).attr('height', H - 32).attr('fill', KIND[e.kind] || COL.hielo).attr('opacity', .28);
  }
  svg.append('g').attr('transform', `translate(${ml - 4},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(f.c).tickSize(-(W - ml - 4))).call(axisStyle).call((g) => g.select('.domain').remove());
  svg.append('g').attr('transform', `translate(0,${H - 24})`).call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(W / 130))).tickFormat((d) => d.toLocaleDateString(LOC, { month: 'short', year: '2-digit', timeZone: 'UTC' }))).call(axisStyle);
  svg.append('g').selectAll('circle').data(rows).join('circle').attr('cx', (r) => x(P(r.day))).attr('cy', (r) => y(r.trips)).attr('r', 1.4).attr('fill', COL.mute).attr('opacity', .55);
  svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', COL.paper).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('d', d3.line((r) => x(P(r.day)), (r) => y(r.avg7)));
  const dot = svg.append('circle').attr('r', 4).attr('fill', COL.hielo).attr('opacity', 0), t = tipFor(el), bis = d3.bisector((r) => P(r.day)).center;
  svg.on('pointermove', (ev) => {
    const [mx, my] = d3.pointer(ev), r = rows[bis(rows, x.invert(mx))]; if (!r) return;
    dot.attr('cx', x(P(r.day))).attr('cy', y(r.trips)).attr('opacity', 1);
    const s = el.clientWidth / W, lines = [f.d(r.day), H(`${f.n(r.trips)} viajes`, `${f.n(r.trips)} trips`), r.normal ? `normal ${f.n(r.normal)}, ${f.p(r.vs)}` : H('sin normal', 'no baseline'), r.rain != null ? H(`lluvia ${r.rain} mm`, `rain ${r.rain} mm`) : H('lluvia sin dato', 'no rain data')];
    if (r.event) lines.push(r.event);
    show(el, t, x(P(r.day)) * s, my * s, lines);
  }).on('pointerleave', () => { t.hidden = true; dot.attr('opacity', 0); });
}

function hbars(el, data, label, val, color, extra) {
  el.replaceChildren();
  const W = el.clientWidth, H = data.length * 28 + 30, svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
  const ml = Math.min(W * .55, textW(svg, data.map(label)) + 12);
  const lim = Math.max(.1, d3.max(data, (r) => Math.abs(val(r))) * 1.15);
  const x = d3.scaleLinear([-lim, lim], [ml, W - 8]), y = d3.scaleBand(data.map(label), [4, H - 26]).padding(.25);
  svg.append('g').attr('transform', `translate(0,${H - 26})`).call(d3.axisBottom(x).ticks(Math.max(2, Math.floor((W - ml) / 70))).tickFormat(f.p).tickSize(-(H - 30))).call(axisStyle).call((g) => g.select('.domain').remove());
  svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 4).attr('y2', H - 26).attr('stroke', COL.mute);
  svg.append('g').selectAll('text').data(data).join('text').attr('x', 0).attr('y', (r) => y(label(r)) + y.bandwidth() / 2).attr('dy', '.35em').text(label)
    .each(function () { let s = this.textContent; while (s.length > 4 && this.getComputedTextLength() > ml - 10) { s = s.slice(0, -2); this.textContent = s + '...'; } });
  const t = tipFor(el);
  svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (r) => Math.min(x(0), x(val(r)))).attr('width', (r) => Math.abs(x(val(r)) - x(0)))
    .attr('y', (r) => y(label(r))).attr('height', Math.min(22, y.bandwidth())).attr('rx', 3).attr('fill', color)
    .on('pointermove', (ev, r) => { const [mx, my] = d3.pointer(ev, el); show(el, t, mx, my, extra(r)); }).on('pointerleave', () => { t.hidden = true; });
}

function vbars(el, data, key, val, fk, fv, line) {
  el.replaceChildren();
  const W = el.clientWidth, H = 220, svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`);
  const y = d3.scaleLinear([0, d3.max(data, val) * 1.08], [H - 24, 8]).nice(), ml = textW(svg, y.ticks(4).map(f.c)) + 10;
  const x = d3.scaleBand(data.map(key), [ml, W - 4]).padding(.2), every = Math.ceil(data.length / Math.max(2, Math.floor(W / 95)));
  svg.append('g').attr('transform', `translate(${ml - 4},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(f.c).tickSize(-(W - ml))).call(axisStyle).call((g) => g.select('.domain').remove());
  svg.append('g').attr('transform', `translate(0,${H - 24})`).call(d3.axisBottom(x).tickValues(data.map(key).filter((_, i) => i % every === 0)).tickFormat(fk).tickSize(0)).call(axisStyle).call((g) => g.select('.domain').remove());
  const t = tipFor(el), hit = (s) => s.on('pointermove', (ev, r) => { const [mx, my] = d3.pointer(ev, el); show(el, t, mx, my, [fk(key(r)), fv(val(r))]); }).on('pointerleave', () => { t.hidden = true; });
  if (line) {
    svg.append('path').datum(data).attr('fill', 'none').attr('stroke', COL.hielo).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('d', d3.line((r) => x(key(r)) + x.bandwidth() / 2, (r) => y(val(r))));
    svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (r) => x(key(r))).attr('width', x.bandwidth()).attr('y', 8).attr('height', H - 32).attr('fill', 'transparent').call(hit);
  } else {
    svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (r) => x(key(r))).attr('width', Math.min(32, x.bandwidth())).attr('y', (r) => y(val(r))).attr('height', (r) => y(0) - y(val(r))).attr('rx', 3).attr('fill', COL.hielo).call(hit);
  }
}

function episodes(eps) {
  const by = d3.rollup(eps, (v) => v.length, (e) => e.mode);
  const names = { metro: 'Metro', cercanias: CITY.mode('cercanias'), emt: 'EMT', metro_ligero: CITY.mode('metro_ligero'), interurbanos: H('Interurbanos', 'Intercity buses') };
  $('epCounts').replaceChildren(...[...by].sort((a, b) => b[1] - a[1]).map(([m, n]) => { const s = document.createElement('span'); const b = document.createElement('b'); b.textContent = fmt.format(n); s.append(b, names[m] || m); return s; }));
  const body = $('epBody'); body.replaceChildren();
  for (const e of eps.slice(0, 150)) {
    const tr = document.createElement('tr');
    const when = new Date(e.started).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
    const mins = ((e.ended ? Date.parse(e.ended) : Date.now()) - Date.parse(e.started)) / 6e4;
    const dur = e.ended ? (mins < 90 ? `${Math.round(mins)} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : H(`${Math.round(mins / 1440)} días`, `${Math.round(mins / 1440)} days`)) : H('sigue', 'ongoing');
    const cells = [when, null, e.from_stop && e.to_stop ? `${e.from_stop} - ${e.to_stop}` : '', dur, MSM.cleanTitle(e.title)];
    cells.forEach((c, i) => {
      const td = document.createElement('td');
      if (i === 1) { const p = document.createElement('span'); p.className = 'pill'; p.style.background = /rojo/i.test(e.severity) ? COL.rojo : COL.ambar; p.textContent = e.line.split(':')[1]; td.append(p); }
      else { td.textContent = c; if (i === 0 || i === 3) td.className = 'm'; }
      tr.append(td);
    });
    body.append(tr);
  }
  if (!eps.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 5; td.className = 'loading'; td.textContent = 'Sin tramos en los últimos 30 días.'; tr.append(td); body.append(tr); }
}

async function run() {
  const [V, U, tiempo, eventos] = await Promise.all([load('viajes'), load('usuarios'), local('data/tiempo.csv'), local('data/eventos.csv')]);
  const dias = build(V.rows, tiempo, eventos);
  const users = U.rows.map((r) => ({ month: (r.fecha || r.month).slice(0, 7), n: Number(r['usuarios activos'] ?? r.active_users) })).filter((r) => r.n > 0);

  const last = dias.at(-1).day, yr = last.slice(0, 4), ly = String(+yr - 1) + last.slice(4);
  const sum = (a, b) => d3.sum(dias.filter((r) => r.day >= a && r.day <= b), (r) => r.trips);
  const ytd = sum(yr + '-01-01', last), prev = sum(+yr - 1 + '-01-01', ly), chg = ytd / prev - 1;
  const top = d3.greatest(dias, (r) => r.trips);
  const u = users.at(-1), uPrev = users.find((r) => r.month === String(+u.month.slice(0, 4) - 1) + u.month.slice(4));
  const wd = dias.filter((r) => { const g = P(r.day).getUTCDay(); return g > 0 && g < 6 && !r.kind && r.normal && r.rain != null; });
  const B = [[H('Seco', 'Dry'), 0, .5], [H('Llovizna, hasta 2 mm', 'Drizzle, up to 2 mm'), .5, 2], [H('Lluvia, 2 a 10 mm', 'Rain, 2 to 10 mm'), 2, 10], [H('Lluvia fuerte, más de 10 mm', 'Heavy rain, over 10 mm'), 10, 1e9]]
    .map(([label, lo, hi]) => { const v = wd.filter((r) => r.rain >= lo && r.rain < hi).map((r) => r.vs); return { label, n: v.length, vs: median(v) }; });
  const impact = eventos.map((e) => { const r = dias.filter((d) => d.day >= e.start && d.day <= e.end && d.normal); const t = d3.sum(r, (d) => d.trips), n = d3.sum(r, (d) => d.normal); return { ...e, t, n, vs: n ? t / n - 1 : null, rain: d3.mean(r, (d) => d.rain || 0) }; }).filter((e) => e.vs != null).sort((a, b) => b.vs - a.vs);
  const months = [...d3.rollup(dias, (v) => Math.round(d3.mean(v, (r) => r.trips)), (r) => r.day.slice(0, 7))].map(([m, v]) => ({ m, v }));

  const lead = $('hLead'); lead.replaceChildren();
  const b = (t) => { const e = document.createElement('b'); e.textContent = t; return e; };
  if (CITY.lang === 'en') lead.append('BiciMAD has logged ', b(f.n(ytd)), ` trips in ${yr} up to ${f.d(last)}, `, b(f.p(chg)), ` against the same stretch of ${+yr - 1}. What lifts it most is not a strike: it is riding for free.`);
  else lead.append('BiciMAD lleva ', b(f.n(ytd)), ` viajes en ${yr} hasta el ${f.d(last)}, `, b(f.p(chg)), ` frente al mismo tramo de ${+yr - 1}. Lo que más la dispara no es una huelga: es que sea gratis.`);
  $('hk1').textContent = H(`Viajes en ${yr}, hasta el último día publicado`, `Trips in ${yr}, up to the last published day`);
  $('hv1').textContent = f.c(ytd); $('hs1').textContent = `${f.p(chg)} frente a ${+yr - 1}`; $('hs1').className = 's ' + (chg >= 0 ? 'up' : 'down');
  $('hv2').textContent = f.n(top.trips); $('hs2').textContent = f.d(top.day) + (top.event ? ` · ${top.event}` : '');
  $('hv3').textContent = f.c(u.n); $('hs3').textContent = uPrev ? `${f.m(u.month)}, ${f.p(u.n / uPrev.n - 1)} en un año` : f.m(u.month); if (uPrev) $('hs3').className = 's ' + (u.n >= uPrev.n ? 'up' : 'down');
  $('hv4').textContent = f.p(B[3].vs);
  $('hSrc').append(V.live ? H(` Viajes leídos ahora de EMT, hasta el ${f.d(last)}.`, ` Trips read live from EMT, up to ${f.d(last)}.`) : H(' EMT no respondió: viajes de la copia guardada.', ' EMT did not answer: trips from the saved copy.'));

  const draw = () => {
    daily($('cDaily'), dias, eventos);
    hbars($('cEvents'), impact, (r) => r.label, (r) => r.vs, (r) => KIND[r.kind] || COL.hielo, (r) => [r.start === r.end ? f.d(r.start) : `${f.d(r.start)} - ${f.d(r.end)}`, H(`${f.n(r.t)} viajes, normal ${f.n(r.n)}`, `${f.n(r.t)} trips, normal ${f.n(r.n)}`), H(`${f.p(r.vs)} frente a lo normal`, `${f.p(r.vs)} against normal`), H(`lluvia media ${d3.format('.1f')(r.rain)} mm`, `average rain ${d3.format('.1f')(r.rain)} mm`)]);
    hbars($('cRain'), B, (r) => r.label, (r) => r.vs, () => COL.hielo, (r) => [r.label, H(`${f.p(r.vs)} frente a lo normal`, `${f.p(r.vs)} against normal`), H(`${r.n} días laborables`, `${r.n} weekdays`)]);
    vbars($('cMonths'), months, (r) => r.m, (r) => r.v, f.m, (v) => H(`${f.n(v)} viajes al día`, `${f.n(v)} trips a day`), false);
    vbars($('cUsers'), users, (r) => r.month, (r) => r.n, f.m, (v) => H(`${f.n(v)} usuarios activos`, `${f.n(v)} active users`), true);
  };
  draw();
  let w = innerWidth; addEventListener('resize', () => { if (Math.abs(innerWidth - w) > 40 && !document.getElementById('historia').hidden) { w = innerWidth; draw(); } }); window.__histDraw = draw;
  MSM.on('episodes', episodes);
}


  return { start: () => run().catch((e) => { document.getElementById('hLead').textContent = 'No se pudieron leer los datos de EMT ahora.'; console.error(e); }), shown: () => { if (window.__histDraw) setTimeout(window.__histDraw, 0); } };
})();
