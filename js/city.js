// City and language. Loaded first. One codebase, two cities (Madrid, SF Bay Area), two languages (es, en).
// City: bayarea.lessane.es (or ?city=bay, or <meta name="msm-city" content="bay">) is the Bay; anything else is Madrid.
// Language: ?lang=es|en (remembered), else the saved choice, else the browser's language (Spanish or English).
window.CITY = (() => {
  const q = new URLSearchParams(location.search);
  const metaCity = document.querySelector('meta[name="msm-city"]')?.content;
  const id = q.get('city') === 'bay' || metaCity === 'bay' || /^bay(area)?\./.test(location.hostname) ? 'bay' : 'madrid';
  let lang = q.get('lang');
  try {
    if (lang === 'es' || lang === 'en') localStorage.setItem('msm.lang', lang);
    else lang = localStorage.getItem('msm.lang');
  } catch {}
  if (lang !== 'es' && lang !== 'en') lang = /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
  const L = (es, en) => (lang === 'en' ? en : es);
  const locale = lang === 'en' ? 'en-US' : 'es-ES';

  const madrid = {
    id: 'madrid', name: 'Madrid', title: 'Madrid se mueve', site: 'madrid.lessane.es', other: { name: 'Bay Area', url: 'https://bayarea.lessane.es/' },
    tz: 'Europe/Madrid', center: [40.4168, -3.7038], zoom: 12,
    pulso: { lat: 40.425, lon: -3.695, w: 30, h: 19, wn: 17, hn: 24, min: 1 },
    graph: 'https://raw.githubusercontent.com/lessane-land/estado-madrid/main/graph-app.json',
    gbfs: (feed) => 'https://madrid.publicbikesystem.net/customer/gbfs/v2/en/' + feed,
    bike: 'BiciMAD', rail: ['metro', 'metro_ligero', 'cercanias'], live: ['cercanias'], dashed: ['cercanias'], thin: ['cercanias'],
    mode: (m) => ({ metro: 'Metro', metro_ligero: L('Metro Ligero', 'Light rail'), cercanias: L('Cercanías', 'Commuter rail') }[m] || m),
    groups: [[L('Metro', 'Metro'), (l) => l.m === 'metro'], [L('Metro Ligero', 'Light rail'), (l) => l.m === 'metro_ligero'], [L('Cercanías', 'Commuter rail (Cercanías)'), (l) => l.m === 'cercanias']],
    busZoom: 16, busStops: true, episodes: true, historia: true,
    hubs: [['Sol', 40.4169, -3.7035], ['Atocha', 40.4066, -3.6892], ['Moncloa', 40.4351, -3.7190], ['Plaza de Castilla', 40.4669, -3.6890], ['Cibeles', 40.4193, -3.6931], ['Callao', 40.4200, -3.7058], ['Legazpi', 40.3911, -3.6953], ['Avenida de América', 40.4380, -3.6762]],
    viewbox: '-3.95,40.62,-3.45,40.28',
    night: { from: 1.5, to: 5.5, back: L('El Metro vuelve a las 6:00', 'The Metro is back at 6:00') },
    sources: 'CRTM, Renfe, EMT, BiciMAD',
    sourceNote: L('Estado: el mismo que usa Madrid hoy, del Consorcio y Renfe. Trenes: posiciones de Renfe en vivo. 30 días: tramos de problemas que ha guardado el servidor de Madrid hoy.',
      'Status: the same feed Madrid hoy uses, from the regional transport authority and Renfe. Trains: live Renfe positions. 30 days: trouble stretches recorded by the Madrid hoy server.'),
    search: L('Busca un sitio: Atocha, Lavapiés, tu calle', 'Search a place: Atocha, Lavapiés, your street'),
    busOperator: 'EMT',
  };

  const bay = {
    id: 'bay', name: L('la Bahía', 'the Bay Area'), title: 'Bay Area se mueve', site: 'bayarea.lessane.es', other: { name: 'Madrid', url: 'https://madrid.lessane.es/' },
    tz: 'America/Los_Angeles', center: [37.7749, -122.4194], zoom: 12,
    pulso: { lat: 37.745, lon: -122.37, w: 38, h: 24, wn: 22, hn: 32, min: .45 },
    graph: 'https://raw.githubusercontent.com/lessane-land/estado-madrid/main/graph-bay.json',
    gbfs: (feed) => 'https://gbfs.lyft.com/gbfs/2.3/bay/en/' + feed + '.json',
    bike: 'Bay Wheels', rail: ['bart', 'metro', 'rail', 'tram', 'cable', 'ferry'], live: ['bart', 'metro', 'rail', 'tram', 'cable', 'ferry'],
    dashed: ['rail', 'ferry'], thin: ['rail', 'ferry', 'cable'],
    mode: (m) => ({ bart: 'BART', metro: 'Metro', rail: L('Tren', 'Rail'), tram: L('Tranvía', 'Light rail'), cable: L('Cable car', 'Cable car'), ferry: 'Ferry' }[m] || m),
    groups: [['BART', (l) => l.m === 'bart'], [L('Muni Metro y tranvías', 'Muni Metro and streetcars'), (l) => l.m === 'tram' && l.a === 'SF'],
      ['Cable cars', (l) => l.m === 'cable'], [L('Trenes regionales', 'Regional rail'), (l) => l.m === 'rail'],
      [L('VTA y AirTrain', 'VTA and AirTrain'), (l) => l.m === 'tram' && l.a !== 'SF'], ['Ferries', (l) => l.m === 'ferry']],
    busZoom: 14, busStops: false, episodes: false, historia: false,
    hubs: [['Embarcadero', 37.7929, -122.3971], ['Powell St', 37.7844, -122.4079], ['Civic Center', 37.7797, -122.4139], ['16th St Mission', 37.7650, -122.4196], ['Salesforce Transit Center', 37.7896, -122.3966], ['4th & King', 37.7766, -122.3947], ['12th St Oakland', 37.8037, -122.2716], ['Downtown Berkeley', 37.8701, -122.2681]],
    viewbox: '-122.75,38.15,-121.75,37.2',
    night: { from: 1.5, to: 4.5, back: L('BART vuelve a las 5:00', 'BART is back at 5:00') },
    sources: '511 SF Bay, Bay Wheels',
    sourceNote: L('Estado: avisos de servicio de 511 SF Bay, de todos los operadores. Trenes: posiciones en vivo de 511, cada 90 segundos.',
      'Status: 511 SF Bay service alerts, every operator. Trains: live 511 positions, every 90 seconds.'),
    search: L('Busca un sitio: Embarcadero, Mission, tu calle', 'Search a place: Embarcadero, the Mission, your street'),
    busOperator: 'Muni, AC Transit',
  };

  const city = id === 'bay' ? bay : madrid;
  const fmt = new Intl.NumberFormat(locale, { useGrouping: 'always' });
  const time = (d = new Date()) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: id === 'bay', timeZone: city.tz });
  // Hours since local midnight in the city, for night mode.
  const hour = () => { const p = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: city.tz }).formatToParts(new Date()); const g = (t) => +p.find((x) => x.type === t).value; return g('hour') + g('minute') / 60; };
  const setLang = (l) => { const u = new URL(location.href); u.searchParams.set('lang', l); location.replace(u.toString()); };
  return { ...city, lang, L, locale, fmt, time, hour, setLang };
})();
