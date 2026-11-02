# ZA Utility Cost Calculator

A small web calculator for **tiered (block) tariffs** such as South African municipal power and water rates.

- Pick a **rate type** (power / water / anything you add) and an **area**.
- Enter your **monthly usage** and see the cost band by band, plus a **day-by-day breakdown** (table and chart) based on the month's total.
- Or switch to **budget mode** to see how many units a monthly budget buys.
- Tariffs are plain **JSON files** in `public/data/`. Drop a file in and it appears in the dropdown. Each file can have as many bands as it needs.
- Users can also **upload their own JSON** in the browser and **download a sample** file to see the format.

## Languages and tech

| Part | Used |
| --- | --- |
| Front end | HTML5, CSS3, vanilla JavaScript (ES modules). No framework, no build step, no runtime dependencies |
| Data | JSON |
| Helper scripts | Node.js (`scripts/build-manifest.js`), PowerShell (`scripts/build-manifest.ps1`), POSIX shell (`docker/40-generate-manifest.sh`) |
| Container | Docker + nginx (Alpine) |

## Project layout

```
public/                  <- the whole website (this is what gets deployed)
  index.html
  css/styles.css
  js/app.js              UI
  js/tariff.js           validation + cost maths (no DOM; also used by the build script)
  data/                  <- tariff JSON files + index.json (the list of files)
  samples/sample-bands.json   file offered by the "Download sample JSON" button
  _headers               Cloudflare Pages cache headers
scripts/                 bash / Node / PowerShell helper scripts (see "Scripts" below)
docker/                  nginx config + container start-up script
Dockerfile
docker-compose.yml
```

## Run locally

The site must be served over HTTP (browsers block `fetch` from `file://`). Either use the helper script (regenerates the file list, then serves `public/` with Python):

```bash
scripts/serve.sh          # http://localhost:8080, or: scripts/serve.sh 9000
```

or any static server:

```bash
python -m http.server 8080 -d public
```

## Scripts

Bash scripts (Linux, macOS, WSL, Git Bash). Run `chmod +x scripts/*.sh` once if they are not executable.

| Script | What it does |
| --- | --- |
| `scripts/build-manifest.sh` | Rebuilds `public/data/index.json`. Validates each file if `jq` is installed |
| `scripts/serve.sh [port]` | Rebuilds the file list and serves the site locally with Python |
| `scripts/docker.sh <cmd>` | Docker Compose wrapper: `up` (default), `update`, `restart`, `logs`, `status`, `down` |
| `scripts/deploy-cloudflare.sh [project]` | Rebuilds the file list and deploys `public/` to Cloudflare Pages with wrangler |

Equivalents without bash: `scripts/build-manifest.js` (Node) and `scripts/build-manifest.ps1` (PowerShell).

## Tariff JSON format

Download the sample from the app (or open `public/samples/sample-bands.json`). Minimal example:

```json
{
  "displayName": "Tshwane – Power (Electricity)",
  "type": "power",
  "unit": "kWh",
  "bands": [
    { "from": 1,   "to": 100,  "rate": 3.2411 },
    { "from": 101, "to": 400,  "rate": 3.7932 },
    { "from": 401, "to": 650,  "rate": 4.1327 },
    { "from": 651, "to": null, "rate": 4.4551 }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `displayName` | yes | Text shown in the **Area / tariff** dropdown |
| `type` | yes | `power` and `water` get friendly labels. Any other word (e.g. `gas`) becomes its own entry in the **Rate type** dropdown |
| `unit` | yes | `kWh`, `kl`, ... |
| `bands` | yes | Any number of bands, lowest first |
| `bands[].to` | yes | Top of the band. The **last** band must be `null` (no upper limit) |
| `bands[].rate` | yes | Price **per unit in Rand** (not cents): 324.12 c/kWh = `3.2412` |
| `bands[].from` | no | Display only. Worked out from the previous band if omitted |
| `area`, `id`, `effectiveFrom`, `notes`, `source` | no | Shown in the tariff details |
| `currency` | no | ISO code, default `ZAR` |
| `fixedMonthlyCharge` | no | Added to the monthly bill, spread evenly over the days |
| `vatPercent` / `ratesIncludeVat` | no | If `ratesIncludeVat` is `false` VAT is added on top; otherwise it is shown as already included. Default `true` |

Unknown keys (e.g. the `_readme` in the sample) are ignored.

**File naming:** `<country>-<area>-<type>.json`, lowercase with dashes, e.g. `za-tshwane-power.json`, `za-cape-town-water.json`. Add a year if you keep old tariffs (`za-tshwane-power-2025-26.json`). The name is only for tidiness; the dropdown uses `displayName`.

### How the calculation works

Bands are **monthly blocks**: the first 100 kWh of the month cost the band 1 rate, the next 300 kWh the band 2 rate, and so on. The month's total is spread evenly across the days, and each day's cost is the extra cost of that day's units, so days late in the month cost more once you cross into a higher band. Daily costs add up exactly to the monthly total.

## Adding or updating tariff data

1. Add or edit a `.json` file in `public/data/`.
2. Regenerate the file list, `public/data/index.json` (static hosts cannot list a folder, so the app reads this list):
   - Bash: `scripts/build-manifest.sh` (validates every file if `jq` is installed)
   - Node: `node scripts/build-manifest.js` (also validates every file)
   - Windows without Node: `powershell -ExecutionPolicy Bypass -File scripts/build-manifest.ps1`
   - Or edit `index.json` by hand: `{ "files": ["za-tshwane-power.json", "..."] }`
3. Commit and push, or rebuild the container (see below).

Files that fail validation are skipped and reported in the page. The Node script lists the problems at build time.

## Deploy

### Option A: Cloudflare Pages (free, no Docker)

Connect the Git repo in the Cloudflare dashboard (**Workers & Pages → Create → Pages → Connect to Git**) with:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `node scripts/build-manifest.js` (regenerates the file list and validates your JSON). Leave empty if you commit `index.json` yourself |
| Build output directory | `public` |

Every push to the connected branch redeploys. To update data: add the JSON file, push, done.

Without Git, use direct upload. Run `npx wrangler login` once, then:

```bash
scripts/deploy-cloudflare.sh my-project-name
```

This rebuilds the file list and runs `npx wrangler pages deploy public`.

### Option B: Any static host (GitHub Pages, Netlify, S3, nginx, Apache...)

Upload the contents of `public/`. Make sure `public/data/index.json` is up to date first.

### Option C: Docker Compose (recommended for a server)

```bash
scripts/docker.sh up          # same as: docker compose up -d --build
```

Open <http://localhost:8080> (set `PORT=9000` to change the port). `docker-compose.yml` mounts `public/data/` into the container, so to add or change tariffs, edit the files and run:

```bash
scripts/docker.sh restart     # picks up new/changed tariff files
scripts/docker.sh update      # after changing code (rebuilds the image)
```

Other commands: `logs`, `status`, `down`. The container restarts automatically unless stopped and has a health check.

### Option D: plain Docker

```bash
docker build -t za-calculator .
docker run -d -p 8080:80 --name za-calculator za-calculator
```

Open <http://localhost:8080>.

The container rebuilds `data/index.json` every time it starts, so you can also keep your tariffs outside the image and mount them (the mount must be writable, not `:ro`):

```bash
docker run -d -p 8080:80 -v "$(pwd)/public/data:/usr/share/nginx/html/data" za-calculator
```

Add a file to that folder, then `docker restart za-calculator` to pick it up.

**Updating a deployed container:** change the files, then rebuild and replace it:

```bash
docker build -t za-calculator .
docker rm -f za-calculator
docker run -d -p 8080:80 --name za-calculator za-calculator
```

## Disclaimer

Results are estimates. Always confirm tariffs, fixed charges and VAT with your utility.
