# Madrid se mueve · notes for Claude

Live map of Madrid public transport: Metro and Metro Ligero lines with their cuts, Cercanías trains moving,
EMT buses arriving at the stops on screen, and every BiciMAD station with free bikes.

Two pages: `index.html` (live map) and `historia.html` (BiciMAD day by day since 2024 against rain, free days, strikes
and the blackout, plus the last 30 days of Madrid hoy line episodes). Served by GitHub Pages from `main`, root folder. One static page, no build step.

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
