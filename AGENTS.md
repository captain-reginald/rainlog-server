# AGENTS.md

Guidance for future agents working on **rainlog-server**. Read this before changing code, data, deployment, or publishing. The user's requirements in this file are authoritative; do not silently relax them.

## What this project is

A self-hosted web app for daily rainfall readings, built around the JSON file used by the Omarchy Rain Log plugin. It runs as a Docker container, serves a React PWA, and adds rolling totals, charts, import/export, snapshots, and comparisons against local 1991–2020 climate normals.

- Local project: `/home/omarchy/Work/rainlog-server`
- Plugin (do not modify): `~/.config/omarchy/plugins/io.github.captain-reginald.rainlog/`
- GitHub: `https://github.com/captain-reginald/rainlog-server`
- Branches: `dev` for all work, `main` for approved releases only
- Release: `v1.0.0`
- License: GPL-3.0-or-later

## User requirements (authoritative)

### Storage and compatibility

- **Do not modify the Omarchy plugin.** It must keep working unchanged.
- The core file is `rainlog.json` and must stay exactly in this shape:
  ```json
  { "entries": { "YYYY-MM-DD": <integer tenths of an inch> } }
  ```
- Values are whole integers, positive, 1–9999 tenths. A missing key means "no rain".
- **Never add extra keys to `rainlog.json`.** The plugin rewrites the whole file from memory and would drop them.
- All web-only state must live in separate sidecar files:
  - `rainlog-web.json` — units and dashboard windows
  - `rainlog-climate.json` — cached locality and monthly normals
- Web-only state must never leak into the plugin file.

### Product scope

- Node + TypeScript + React. No database.
- No application authentication. Intended for a trusted LAN, Tailscale, or a private overlay network.
- No per-day notes or commentary fields.
- Readings are entered in **tenths of an inch** (`23` means 2.3 in). Millimetres are display-only.
- Features that must remain:
  - daily entry and calendar editing
  - rolling/period totals with back/forward stepping
  - charts
  - CSV and JSON import/export with dry-run preview
  - inches/mm toggle
  - installable PWA
  - automatic snapshots and recovery
  - local climate comparison

### UI requirements

- Dashboard cards are, in order:
  1. 24 hours
  2. 7 days
  3. configurable window(s)
  4. Month
  5. Season
  6. Year
- Default dashboard window is a single **30-day** window, so the default six cards form two symmetrical rows of three: 24 hours / 7 days / 30 days on top, Month / Season / Year below.
- Dashboard windows are configurable in Settings: 1–3 windows, each 1–365 days.
- Desktop stats grid is **3 columns**; phones use 2 columns. Keep the default layout symmetrical.
- Do **not** reintroduce the 72-hour block or a fixed 14-day block.
- Do **not** reintroduce the "season to date vs. same-day previous seasons" chart.
- Do **not** reintroduce a "Network and Access" block.
- Do **not** reintroduce general UI mentions of the backend JSON file or compatibility. The only allowed compatibility mention is the single line in Settings, worded exactly:
  > Cross Compatible with the Omarchy Rainlog Plugin via backend sync
- Settings must end with this exact disclaimer:
  > This service has not been vetted for public web-facing use. Use internally or at your own risk.
- Use the supplied rain image as a fixed full-viewport background, scaled slightly beyond the viewport so edges/letterboxing never show. Use white/contrasting text and macOS-style frosted glass panels.
  - Source asset: `web/public/background.jpg`
  - Applied via `.app-bg` with `position: fixed`, `inset: -6vmax`, `background-size: cover`, plus a dark readability overlay.

### Deployment requirements

- Docker image/repo name: `rainlog-server`.
- Compose defaults: `TZ=America/Denver`, `PUID=1000`, `PGID=1000`, published on `0.0.0.0:8080`.
- Mount the **data directory**, never a single JSON file. Atomic writes use temp-file + rename, which a single-file bind mount would break.
- The app must run as a non-root user and remain compatible with `RAINLOG_CHOWN=1` for first-run ownership repair.

### Branch workflow and approval

- **`dev` is the working branch. `main` is the release branch.**
- Every feature, fix, docs change, and refactor goes to `dev` first, as a normal commit push.
- **Never merge `dev` into `main` until the user explicitly approves it.** Approval is per-merge, not standing. A previous approval does not carry over to the next batch of work.
- When the work is ready, say so and wait. Do not open, merge, or push a PR to `main` on your own initiative.
- Pushing `dev` runs no release automation, so it is the safe default for all work.
- **Do not push, tag, publish images, or create releases without explicit user approval.**
- Pushing to `main` triggers the publish workflow, which rebuilds and moves `:main` and `:latest`. A docs-only commit still does this. Treat every push to `main` as a release action.
- Tags matching `v*` trigger the multi-arch GHCR publish and create a GitHub release.
- Never push the local backup tag `v1.0.0-original`.

## Architecture

### Stack

- Server: Fastify + TypeScript, Zod validation, Vitest.
- Web: React + Vite + TypeScript, TanStack Query, React Router, custom SVG charts.
- PWA: `vite-plugin-pwa`, auto-update service worker.
- Runtime: Node 22 Alpine, `tini` PID 1, `su-exec` for PUID/PGID.
- No external database or telemetry.

### Repository layout

```text
rainlog-server/
├── compose.yaml
├── data/                     # live data, gitignored
│   ├── rainlog.json
│   ├── rainlog-web.json
│   ├── rainlog-climate.json
│   └── .rainlog-backups/
├── data-original/            # data for the v1 backup container, gitignored
├── docker/entrypoint.sh
├── server/
│   ├── src/{app,climate,config,importers,server,storage}.ts
│   └── test/
├── web/
│   ├── public/{background.jpg,favicon.svg,icons}
│   └── src/{pages,components,lib}, App.tsx, main.tsx, styles.css
├── fixtures/                 # synthetic import samples only
├── screenshots/              # README images (demo data, demo locality)
├── Dockerfile
└── .github/workflows/{ci,publish}.yml
```

### Key implementation files

- `server/src/storage.ts` — on-disk contract, sidecars, atomic writes, snapshots, prefs/climate schemas.
- `server/src/app.ts` — HTTP routes, validation, error mapping.
- `server/src/climate.ts` — Open-Meteo geocoding, 1991–2020 normals, mm→tenths, complete-month filtering.
- `server/src/importers.ts` — JSON/CSV parsing, export, import reports.
- `web/src/lib/model.ts` — date windows, period sums, `normalBetween`, season/year normals.
- `web/src/pages/Dashboard.tsx` — entry form, six default cards, recent rain, 30-day chart.
- `web/src/pages/Charts.tsx` — year stats, monthly chart, climate comparison.
- `web/src/pages/Settings.tsx` — units, windows, locality, exact strings.
- `web/src/styles.css` — glass theme, background, 3-column grid, responsive rules.
- `web/src/main.tsx` — PWA registration and update handling.

## Data model and files

### `data/rainlog.json`

Plugin-compatible readings. Rules:

| Rule | Behavior |
| --- | --- |
| Date keys | Local calendar dates `YYYY-MM-DD`, validated as real days |
| Values | Integer tenths, 1–9999 |
| No rain | Key absent; `0` or blank input deletes the entry |
| Writing | Re-read, merge touched days only, atomic replace |
| Formatting | Two-space JSON, sorted keys, no trailing newline |
| Unknown data | Preserve untouched entries and unknown top-level keys |
| Corruption | Report parse error and refuse writes |

### `data/rainlog-web.json`

```json
{ "version": 1, "units": "in", "windows": [30] }
```

- `windows`: 1–3 integers, each 1–365.
- Legacy `customDays` is still read and migrated to a single window.
- Default: `{ version: 1, units: "in", windows: [30] }`.

### `data/rainlog-climate.json`

```json
{
  "version": 1,
  "locality": "…",
  "resolvedName": "…",
  "latitude": 0,
  "longitude": 0,
  "periodStart": 1991,
  "periodEnd": 2020,
  "monthlyTenths": [12 numbers],
  "fetchedAt": "ISO timestamp"
}
```

- Created only when the user enters a locality.
- Contains the user's real location; treat as private.
- The current live cache holds **Moriarty, New Mexico**. Never commit it, copy it into an image, or expose it in screenshots/docs.
- No default locality exists in code.

### Snapshots

- Stored in `.rainlog-backups/` inside the data directory.
- Taken at most hourly while in use, on manual request, before restore, and before overwriting an externally changed file.
- Retention defaults to 100.
- Never sync or commit snapshot folders.

## Behavior details

### Dashboard

- Today entry uses whole tenths; `0`/blank clears.
- Cards have prev/next navigation; "next" is disabled at the current period.
- Default cards remain two rows of three at desktop widths.
- Extra configured windows add more cards; symmetry is only guaranteed for the default single window.
- Recent rainy days shows the five most recent days with rain.
- The 30-day trend chart is separate from the configurable windows.

### Charts and climate

- Meteorological seasons: DJF, MAM, JJA, SON.
- Climate normals: Open-Meteo geocoding + archive API, 1991–2020, monthly averages in tenths.
- Partial month-years are skipped so gaps do not bias normals.
- "Average to date" spreads each month's normal evenly across its days (`normalBetween`), not a flat fraction.
- Comparison cards show current month, current season, and current year rain-to-date vs. normal-to-date, percentage, and full-period normal.
- Comparison cards are shown only for the current year; older-year charts still compare monthly actuals to normals.
- The locality lookup needs internet once; afterwards the cache works offline.
- Error codes: `404 location_not_found`, `502 climate_unavailable`.

### Settings

- Units toggle (display only).
- Window editor (1–3 rows, 1–365 days).
- Locality save/refresh/remove.
- Server status.
- Exact compatibility line and disclaimer described above.
- No network/access instructions block.

### Data page

- Export CSV/JSON.
- Import with automatic format detection, dry run, replace-all, and force-recover options.
- Snapshot list with download/restore.
- Conflict-copy awareness for Syncthing-style files.
- Do not reintroduce the old "Compatibility notes" card.

### PWA

- `registerType: 'autoUpdate'`, `injectRegister: false`.
- `main.tsx` registers via `virtual:pwa-register`, polls hourly and on visibility, and reloads when a new worker activates.
- This exists because an open tab previously kept an old 4-column stylesheet after a deploy. Do not remove it without preserving update behavior.
- Asset hashes change per build; HTML is served `no-cache`, hashed assets are immutable.

## Local environment and running instances

| Purpose | Container | Host port | Data |
| --- | --- | --- | --- |
| Current app | `rainlog` | `8080` | `./data` |
| Original v1 backup | `rainlog-original` | `8081` | `./data-original` |

- Both run with `PUID=1000`, `PGID=1000`, `TZ=America/Denver`.
- The v1 backup is image `rainlog-server:v1-original` and clone `/home/omarchy/Work/rainlog-server-v1`; local tag `v1.0.0-original`. Keep it available for comparison.
- Do not delete `data-original/`, the v1 clone, or the local backup tag.
- The live instance is on the same machine as the plugin.

### Plugin data linkage (unresolved)

- Plugin setting still points to `~/Documents/rainlog.json`.
- Server reads `/home/omarchy/Work/rainlog-server/data/rainlog.json`.
- The files currently match but are **not synced or linked**.
- To link them, point the plugin's "Data file path" at the server's `data/rainlog.json` (or sync the directory between hosts).
- Do not symlink or single-file-mount `rainlog.json`; the server replaces it with rename.

## Commands

```bash
npm install
npm run dev            # API on :8080, Vite on :5173
npm run typecheck
npm test               # 48 tests
npm run build
npm start

docker compose up -d --build
docker compose logs -f rainlog
```

### Git workflow

```bash
git switch dev                  # daily work happens here
git add -A && git commit -m "…"
git push origin dev             # safe: no publish, no release

# only after the user approves a merge to main:
git switch main && git pull
git merge --no-ff dev
git push origin main            # this publishes :main and moves :latest
```

- Start new work from an up-to-date `dev`, not from `main`.
- Keep `dev` linear-ish and reviewable; squash or merge is fine, but do not force-push shared history.
- Never rebase or force-push `main`, and never rewrite published tags.
- A PR from `dev` to `main` is the preferred review surface; it runs CI without publishing.

### Screenshot workflow

- Playwright is available (`playwright screenshot`), Chromium is installed for it.
- Typical captures: `1440x1000` desktop, `390x844` phone, `--full-page` for long pages.
- Screenshots in the repo use a temporary instance with demo data and demo locality (`Denver, Colorado`). Do not point screenshots at the live instance or expose the real locality.
- Optimize PNGs before committing (ImageMagick, 256-color palette is the established tradeoff).

## Testing and verification checklist

Before reporting a change complete:

1. `npm run typecheck`
2. `npm test` — all 48 tests must pass, including climate math and mocked Open-Meteo calls
3. `npm run build`
4. `docker compose up -d --build` when the change affects the image
5. Verify `http://127.0.0.1:8080/api/health` is healthy
6. Verify the original v1 is still healthy on `:8081`
7. If touching data or storage:
   - confirm `data/rainlog.json` checksum is unchanged unless the change intentionally wrote data
   - confirm `/home/omarchy/Documents/rainlog.json` was not modified
8. If touching UI:
   - inspect desktop and phone screenshots for contrast, glass rendering, and symmetry
   - confirm no compatibility/file/plugin mentions were reintroduced
9. If touching the climate code or API:
   - test with a mock and, when online, a real locality against a temporary data directory
   - confirm `rainlog-climate.json` is written and readable
10. If touching PWA/static assets:
    - confirm the new bundle loads without a stale cached layout
    - keep the auto-update behavior intact

## Data safety and privacy

- `data/` and `data-original/` are gitignored. Only `data/.gitkeep` is tracked.
- `.dockerignore` excludes `data`, so images must never contain readings.
- Never print, commit, screenshot, or paste:
  - `data/rainlog.json` contents beyond what the user explicitly asks for
  - `data/rainlog-climate.json` (contains the real locality)
  - `rainlog-web.json` beyond schema examples
- The user's real locality is private. README screenshots use a demo location only.
- Synthetic fixtures in `fixtures/` are the only sample data that may be committed.
- Do not reset or re-seed the live data directory without explicit approval.

## Publishing

### GitHub / GHCR

- Repo: `captain-reginald/rainlog-server` (public).
- GHCR: `ghcr.io/captain-reginald/rainlog-server`.
- Tags published for `v1.0.0`: `1.0.0`, `1.0`, `latest`, and a `sha-*` tag. Branch pushes to `main` add `main` and move `latest`.
- Workflows:
  - `ci.yml` — typecheck, tests, build on pushes/PRs to `main`. **It does not run on `dev` yet**, so a PR from `dev` to `main` is the way to get CI before merging. Adding `dev` to the `ci.yml` triggers is a reasonable future improvement.
  - `publish.yml` — on `main`/`v*`: test, multi-arch build/push, release creation for `v*`. It never runs for `dev`.
- Pushing `.github/workflows/` requires the `workflow` OAuth scope; the current `gh` login has it.
- Release notes are generated by the workflow.
- Do not force-push or rewrite published tags.

### Docker Hub

- Repo: `captainreginald/rainlog-server` (note: no hyphen in the Docker Hub namespace).
- Tags: `1.0.0`, `1.0`, `latest`.
- Public, anonymous pull verified.
- Current images were copied digest-for-digest from GHCR with `docker buildx imagetools create`; this is the preferred mirroring method.
- Automated Docker Hub mirroring is **not** configured; it would need `DOCKERHUB_USERNAME` and a Docker Hub access token as GitHub secrets.

## Known state and open items

- `main` includes the 1.0.0 release commit plus the PWA auto-reload fix. `v1.0.0` tag points at the released commit.
- `dev` was branched from `main` at `3daaa37` and holds `AGENTS.md`. It is the working branch from now on; `main` only moves on an approved merge.
- The original v1 remains available at `:8081` for comparison.
- Plugin/server data files are not linked; the user has been offered the repoint but has not confirmed it.
- Docker Hub is not documented in the README quick start.
- README screenshots show demo Denver data.
- No app authentication is implemented by design; the disclaimer is not a substitute for network isolation.

## Do not do these things

- Do not modify the plugin or its `rainlog.json` format.
- Do not add keys to `rainlog.json`.
- Do not move web state into `rainlog.json`.
- Do not add authentication, accounts, or per-day notes without an explicit new requirement.
- Do not reintroduce removed UI (season-comparison chart, 72-hour block, fixed 14-day default, compatibility notes, Network and Access).
- Do not change the default port, bind address, timezone, or volume strategy casually.
- Do not commit live data, climate caches, or real location details.
- Do not push to `main`, tag, publish, or create releases without explicit approval.
- Do not merge `dev` into `main` without fresh, explicit approval for that merge.
- Do not delete the v1 backup container, clone, image, tag, or data directory.
- Do not replace the background or glass styling without the user's direction.
- Do not assume the demo Denver locality is the user's location.
