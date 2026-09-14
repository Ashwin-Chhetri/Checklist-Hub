# Checklist Hub

Build a species checklist backed by real evidence — and publish it straight to GBIF.

🔗 **Live app:** [checklisthub.in](https://checklisthub.in)  
🔗 **Docs:** [checklisthub.in/docs](https://checklisthub.in/docs)  
🔗 **GitHub:** [github.com/Ashwin-Chhetri/Checklist-Hub](https://github.com/Ashwin-Chhetri/Checklist-Hub)

---

## Who is this for?

Biodiversity experts — taxonomists, park authorities, conservation planners, researchers — who need to build a species checklist for a region or taxon group and publish it to GBIF. It takes away the usual back-and-forth of emails, spreadsheets, and manually resolving synonyms.

Sign in with Google, ORCID (the researcher identity standard), or email.

Docs: [What is Checklist Hub?](https://checklisthub.in/docs/getting-started/what-is-checklist-hub)

---

## What it does

### 1. Gather & validate evidence
- Pulls existing occurrence records from GBIF, iNaturalist (citizen science data), and eBird
- Extracts species presence straight from the literature
- Or upload your own manually collected CSV
- Every name is checked against the GBIF Backbone and Catalogue of Life, with synonyms resolved automatically
- For each species, evidence of presence — literature, occurrence records, or both — is gathered and attached

Docs: [Importing data](https://checklisthub.in/docs/getting-started/import-data) · [Validating species](https://checklisthub.in/docs/getting-started/validate-species)

### 2. Review together
- A shared workspace where collaborators view the evidence, discuss it in threads, and Accept or Reject each species — every acceptance needs at least one reviewer
- Outdated taxonomy is automatically flagged against newly accepted names
- Reconcile against other checklists to catch shared species, missing species, and conflicts
- Turn on the Watcher to catch new species and new field records from outside sources over time — every update still waits on a reviewer

Docs: [Workbench](https://checklisthub.in/docs/features/workbench) · [Collaborating](https://checklisthub.in/docs/getting-started/collaborate) · [Reconciliation](https://checklisthub.in/docs/features/reconciliation) · [Watcher](https://checklisthub.in/docs/features/watcher)

### 3. Publish
- Once every species is verified, Checklist Hub generates the metadata and builds the Darwin Core Archive for you — no hand-assembly required
- Push it to a nearby IPT accepted by GBIF, and you're done

Docs: [Publishing to GBIF](https://checklisthub.in/docs/getting-started/publish-to-gbif) · [Darwin Core format](https://checklisthub.in/docs/getting-started/darwin-core-format)

---

## Features

### Checklist Organizer
Every checklist you own or collaborate on lives in one table — filter by status (Draft, Validating, Reviewing, Published, Archived), see collaborator avatar stacks, and resume an unfinished publish flow exactly where you stopped.

### Workbench
The core review surface. Every species as its own row, with taxonomy, evidence, and review status side by side. Filter by family, evidence strength, taxonomy status, or review status. Open any species to flip between its Taxonomy, Evidence, and Discussion tabs, then Accept or Reject — every decision requires at least one reviewer.

### Evidence
Every occurrence claim is mapped and sourced. A map plots every record inside the checklist's region; points outside the boundary are shown separately. Evidence sources (GBIF, eBird, iNaturalist, literature) are listed with occurrence counts split into inside-region and outside-region totals. Discard a bad source and the evidence strength badge recalculates immediately.

### Watcher
For checklists that stay active after the initial import. On a weekly or monthly schedule, it re-fetches occurrences from GBIF, iNaturalist, and eBird, surfacing genuinely new candidate species and new observations. Collaborators are notified by email and in-app alert. Nothing is added or updated automatically — every run waits for a reviewer.

### Export
Download the currently filtered species list as CSV or color-coded Excel (with a legend sheet) at any point, independent of the formal Darwin Core publication flow.

### Collaboration & Invites
Add a collaborator by typing a name or email. Existing accounts get access immediately; new addresses receive an invite automatically. Pending invites are tracked; owners can manage roles and remove collaborators at any time.

### Discussion & Pinging
Every species has its own real-time discussion thread. Use `@` to ping a collaborator directly, `#` to reference another species or evidence source inline, and attach files when a decision needs a supporting document.

### History & Activity
Every decision is provenance, not just a status flip. Recent Changes shows a live feed of review-status changes, taxonomy votes, merges, and evidence updates. The full History Timeline groups activity by genus/taxon for audit.

### Deep Literature Search
One click runs a standalone research pipeline that discovers literature for the checklist's taxon and region, scores every source for relevance, and extracts a species list straight from the papers. Low-relevance results are filtered out automatically; you can remove anything that doesn't belong before it's added.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS |
| State | TanStack Query (server state), Zustand (UI/presence) |
| Table | TanStack Table |
| Backend | Next.js API routes (server-only) |
| Database | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Reference data | Local SQLite via `better-sqlite3` (GBIF Backbone, ~2.78 GB, built by `scripts/build-*.mjs`) |
| Research pipeline | Standalone Node.js server (`research-pipeline/`) — Crossref, OpenAlex, Semantic Scholar, BHL, LLM species extraction |

---

## Running Locally

### Prerequisites
- Node.js 20+
- A Supabase project (free tier works)
- GBIF, iNaturalist, and eBird API keys (for evidence aggregation)

### 1. Install dependencies

```bash
cd app
npm install
```

### 2. Set environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GBIF_API_KEY=...
```

### 3. Build the reference data

The GBIF Backbone taxonomy is stored as a local SQLite file (not in Supabase). Build it before starting:

```bash
npm run build:taxonomy
```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Research pipeline (optional)

The Deep Literature Search runs as a separate Node.js server:

```bash
cd research-pipeline
npm install
npm run dev
```

---

## Project Structure

```
checklist hub/
├── app/                        # Next.js application
│   ├── src/
│   │   ├── app/                # Pages and API routes
│   │   │   ├── api/            # Server-only API routes
│   │   │   ├── checklists/     # Checklist pages and Workbench
│   │   │   ├── docs/           # Documentation page
│   │   │   └── ...
│   │   ├── components/         # UI components
│   │   ├── modules/            # Feature modules
│   │   │   ├── auth/
│   │   │   ├── collaboration/
│   │   │   ├── publication/
│   │   │   └── ...
│   │   └── lib/                # Shared utilities and Supabase clients
│   └── scripts/                # Build scripts for reference data
└── research-pipeline/          # Standalone literature discovery server
    └── src/
        ├── discovery/          # Multi-source paper discovery
        ├── analysis/           # LLM species extraction and relevance scoring
        ├── sources/            # Crossref, OpenAlex, Semantic Scholar, BHL
        └── pipeline/           # Orchestration
```

---

## Architecture Principles

1. **Species Object = Source of Truth** — every species carries taxonomy, evidence, review history, discussion, and provenance as a single entity.
2. **Evidence supports decisions; experts make decisions** — the platform aggregates and presents evidence, but never auto-accepts a species.
3. **Never auto-accept species** — every accepted species requires at least one qualified reviewer's sign-off.
4. **Components never contain business logic** — UI components are thin; logic lives in modules and API routes.

---

## Publishing to GBIF

Checklist Hub outputs a Darwin Core Archive (DwC-A) ready for submission to any GBIF-registered IPT. The publication flow is:

1. **Validate** — all species reviewed, no open conflicts
2. **Metadata** — title, description, contributors, license (CC0 / CC-BY / CC-BY-NC)
3. **Review** — preview the generated Taxon core, `meta.xml`, and `eml.xml`
4. **IPT** — download the package, upload it to your IPT, paste the published URL back
5. **Done** — DOI and citation recorded against the checklist

See the full guide: [checklisthub.in/docs#how-to-publish-darwin-core-archive-to-gbif](https://checklisthub.in/docs#how-to-publish-darwin-core-archive-to-gbif)

---

## Data Sources

| Source | Used for |
|---|---|
| [GBIF Backbone Taxonomy](https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c) | Name validation, synonym resolution |
| [Catalogue of Life](https://www.catalogueoflife.org/) | Supplementary taxonomy |
| [GBIF Occurrences](https://www.gbif.org) | Occurrence evidence aggregation |
| [iNaturalist](https://www.inaturalist.org) | Community observation evidence |
| [eBird](https://ebird.org) | Bird occurrence evidence (Aves-scoped checklists) |
| [Crossref](https://www.crossref.org) | Literature discovery |
| [OpenAlex](https://openalex.org) | Literature discovery |
| [Semantic Scholar](https://www.semanticscholar.org) | Literature discovery |
| [Biodiversity Heritage Library](https://www.biodiversitylibrary.org) | Historical literature |

---

## License

MIT — see [LICENSE](../LICENSE) for details.
