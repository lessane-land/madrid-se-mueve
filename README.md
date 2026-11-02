# Madrid se mueve

Live map of Madrid public transport: Metro and Metro Ligero lines with their cuts, Cercanías trains moving,
EMT buses arriving at the stops on screen, and every BiciMAD station with free bikes.

One page, four views on the hash, served by GitHub Pages from `main`, root folder. No build step.

| View | Hash | What it is | Code |
|---|---|---|---|
| Mapa | `#mapa` (default), `#mapa-L10` focuses a line | Leaflet map: lines, cuts, trains, bikes, EMT buses gliding from zoom 16. **Search** (stations, EMT stops, BiciMAD, streets) flies to a place and opens its card: bikes, rail lines with status, next buses (up to 3 stops within 600 m chosen for line coverage). Save it as Casa, Trabajo or any name; saved places get pins. **Modo pantalla**: full screen, wake lock, a director flies to live cuts, your places with the next bus, busy bus hubs, train stops and bike changes; night dims it | `js/mapa.js`, places in `js/mimadrid.js` |
| Pulso | `#pulso` | The city drawn by its BiciMAD stations, rail lines and trains rolling on their track; ripples, ticker, lens, drag and zoom, a search that jumps to the map. Its own Modo pantalla. Night (1:30 to 5:30 Madrid time, fading in and out); preview with `?noche` | `js/pulso.js`, canvas |
| Líneas | `#lineas` | Departure board: every rail line on split flaps, trains running, 30 days of trouble | `js/lineas.js` |
| Historia | `#historia`, linked from Líneas, not in the nav | BiciMAD since 2024 against rain, free days, strikes and the blackout | `js/historia.js`, d3 |

Saved places live only in the visitor's browser, localStorage key `msm.mimadrid.v1` (places, lines, bus lines). No server, no account.

`js/data.js` owns every fetch and poll (trains 15 s, bikes 30 s, status 2 min, episodes 10 min, paused while the tab is hidden);
views subscribe with `MSM.on(name, fn)`. `historia.html` only redirects to `#historia`.

## Where the data comes from

| Layer | Source | How it reaches the page |
|---|---|---|
| Lines and stops | `graph-app.json` from lessane-land/estado-madrid | raw.githubusercontent.com, rebuilt monthly there |
| Cuts and notices | Supabase row `estado` id 1, the same one Madrid hoy reads | REST with the public anon key (read-only policy) |
| Cercanías trains | Renfe GTFS-RT vehicle positions | Supabase Edge Function `vivo?what=trains` (Renfe sends no CORS header) |
| EMT buses | MobilityLabs arrivals per stop | Edge Function `vivo?what=buses&stops=...`, from zoom 16, up to 8 stops |
| BiciMAD | Official GBFS feed | Straight from the browser |
| BiciMAD trips and users | EMT open data portal (monthly) | Straight from the browser, `data/` copies as fallback |
| Rain | City weather stations, datos.madrid.es 300351 | `data/tiempo.csv`, refreshed by `.github/workflows/tiempo.yml` |
| Events | Free days, strikes, the blackout | `data/eventos.csv`, edited by hand, source per row |
| Line episodes | Supabase `line_episodes` | REST with the anon key |

The Edge Function lives in estado-madrid (`supabase/functions/vivo`). EMT credentials are its secrets and never reach this repo.

## House style
Dark only, the Madrid hoy palette, Unbounded / Azeret Mono / Instrument Sans (OFL, in `fonts/`). No emojis, no em dashes.
