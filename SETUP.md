# Setup

This repo has two independent projects: [`app/`](app) (the product) and
[`research-pipeline/`](research-pipeline) (a standalone research agent). Set
up whichever you need — they don't share a runtime.

Large reference datasets (GBIF Backbone, GADM boundaries, ecoregions) are
**not** committed to this repo — only code is. You download and build them
locally as part of setup below.

---

## 1. `app/` — the ChecklistHub product

### Prerequisites

- **Node.js 20+** and npm
- A **Supabase project** ([supabase.com](https://supabase.com)) — free tier works
- (Optional) [Supabase CLI](https://supabase.com/docs/guides/cli) to run the
  migrations in `app/supabase/migrations`
- (Optional) An **eBird API key** — [ebird.org/api/keygen](https://ebird.org/api/keygen) — for Aves occurrence data
- (Optional) An **NVIDIA API key** — for the literature-ranking/extraction agent
- (Optional) **SMTP credentials** (e.g. Gmail App Password) — for email notifications; without this, emails just log to console

### Install & configure

```bash
cd app
npm install
cp .env.local.example .env.local   # fill in Supabase URL/keys at minimum
```

Apply the database schema (run the migrations in `app/supabase/migrations`
against your Supabase project — via `supabase db push` if using the CLI, or
the SQL editor in the Supabase dashboard).

### Reference data (required for taxonomy/region lookups)

These power taxonomic validation and region resolution. The app reads them
from local SQLite files (`app/data/*.sqlite`) — never from Supabase.

1. **GBIF Backbone Taxonomy** — download the current backbone export from
   the [GBIF Backbone Taxonomy dataset page](https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c)
   and save it as `app/public/data/backbone.zip`, then:
   ```bash
   npm run build:backbone
   ```
2. **GADM administrative boundaries (v4.1)** — download the global GeoPackage
   from the [GADM download page](https://gadm.org/download_world.html) and
   save it as `app/public/data/gadm/gadm_410-gpkg.zip`, then:
   ```bash
   npm run build:gadm
   ```

Both builds are one-time per environment (re-run only if the source data
changes). On deployment, run them as part of your build/deploy step so the
generated `.sqlite` files exist on the server's persistent disk.

### Run

```bash
npm run dev
```

---

## 2. `research-pipeline/` — the research agent

### Prerequisites

- **Node.js 20+** (required by its `scholar-mcp` MCP dependency)
- An **NVIDIA API key** — required; this is the LLM used for relevance scoring and extraction
- Everything else is optional and improves coverage/rate limits without it:
  - Google Custom Search API key + Search Engine ID ([programmablesearchengine.google.com](https://programmablesearchengine.google.com/))
  - OpenAlex / Unpaywall contact email
  - CORE API key ([core.ac.uk/services/api](https://core.ac.uk/services/api))
  - BHL (Biodiversity Heritage Library) API key

### Install & configure

```bash
cd research-pipeline
npm install
cp .env.example .env   # fill in NVIDIA_API_KEY at minimum
```

### Reference data (one-time)

```bash
npm run build:gbif-backbone   # builds data/gbif-backbone.sqlite
npm run build:ecoregions      # builds data/ecoregions.sqlite
```

### Run

```bash
npm run research -- --region "Darjeeling district, West Bengal" --taxon Aves
```

Output lands in `raw/`, `catalog/`, `wiki/`, `outputs/` (all gitignored —
this is per-run local corpus data, not code).
