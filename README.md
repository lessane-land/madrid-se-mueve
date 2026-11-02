# Madrid se mueve

Live map of Madrid public transport: Metro and Metro Ligero lines with their cuts, Cercanías trains moving,
EMT buses arriving at the stops on screen, and every BiciMAD station with free bikes.

Served by GitHub Pages from `main`, root folder. One static page, no build step.

## Where the data comes from

| Layer | Source | How it reaches the page |
|---|---|---|
| Lines and stops | `graph-app.json` from lessane-land/estado-madrid | raw.githubusercontent.com, rebuilt monthly there |
| Cuts and notices | Supabase row `estado` id 1, the same one Madrid hoy reads | REST with the public anon key (read-only policy) |
| Cercanías trains | Renfe GTFS-RT vehicle positions | Supabase Edge Function `vivo?what=trains` (Renfe sends no CORS header) |
| EMT buses | MobilityLabs arrivals per stop | Edge Function `vivo?what=buses&stops=...`, from zoom 16, up to 8 stops |
| BiciMAD | Official GBFS feed | Straight from the browser |

The Edge Function lives in estado-madrid (`supabase/functions/vivo`). EMT credentials are its secrets and never reach this repo.

## House style
Dark only, the Madrid hoy palette, Unbounded / Azeret Mono / Instrument Sans (OFL, in `fonts/`). No emojis, no em dashes.
