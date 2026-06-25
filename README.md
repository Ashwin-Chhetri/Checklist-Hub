<img src="app/public/res/landing/checklist_hub_logo.png" alt="ChecklistHub" width="96" />

# ChecklistHub

Evidence-based species checklist platform for biodiversity experts.

## Who is this for?

Biodiversity researchers, taxonomists, and reviewers who build and publish
species checklists for a region or taxon group, and need every accepted
species backed by evidence — not just a name on a spreadsheet.

## What it does?

- **Import** a species list (CSV) or discover candidates via literature/data search
- **Validate** taxonomy against GBIF Backbone / Catalogue of Life, resolving synonyms
- **Gather evidence** from GBIF, iNaturalist, eBird, museum collections, and literature
- **Review** as a team — comment, discuss, vote, accept/reject (every accepted species needs ≥1 expert reviewer)
- **Reconcile** against other checklists — shared species, missing species, conflicts
- **Watch** live checklists for new field records over time, with reviewer-confirmed updates
- **Publish** a Darwin Core Archive, ready for an IPT installation

See [`USER_GUIDE.md`](USER_GUIDE.md) for the step-by-step workflow and
[`checklistHub_architecture.md`](checklistHub_architecture.md) for the full
architecture spec.

## Architecture

```
checklist-hub/
├── app/                 Next.js app — the product itself
├── research-pipeline/   Standalone literature & ecology research agent
└── supabase/            Shared database config
```

**app/** — Next.js + React + TypeScript + TailwindCSS. One app, three layers:

- **Client** — React components & hooks, talks to Supabase directly for
  RLS-allowed reads and Realtime (presence, live updates).
- **App server** — Next.js API routes; the only place that does auth checks
  beyond RLS, validation, multi-table writes, and reads heavy local
  reference data (GBIF Backbone, Catalogue of Life) from on-disk SQLite —
  never stored in Supabase.
- **Supabase** — Postgres, Auth, Realtime, Storage. `security definer` RPCs
  guard writes that need to bypass RLS safely.

Every species is a **Species Object** — identity, taxonomy, evidence,
review, discussion, history, and publication status — not a row. Modules
(Editor, Species, Taxonomy, Evidence, Reconciliation, Collaboration,
Publication) each own one responsibility and operate on that object.

The **Watcher** is a background pipeline (`app/src/modules/watching`,
`app/src/app/api/cron/watcher-tick`) that re-fetches GBIF/iNaturalist/eBird
on a schedule for checklists marked active, surfacing new candidate species
and observations for a reviewer to confirm — nothing is applied
automatically.

**research-pipeline/** — A separate, standalone agent: given a region and
taxon group, it discovers literature (curated search, Crossref, OpenAlex,
Google Scholar), expands through citation graphs, resolves full text,
grounds region ecology in real ecoregion data, and uses an LLM to extract
species/coordinates into a queryable local corpus. No Supabase writes, no
shared runtime — output is manually verified before any later integration
into ChecklistHub's evidence model. See
[`research-pipeline/README.md`](research-pipeline/README.md).

## Principles

- Evidence supports decisions. Experts make decisions.
- Never auto-accept a species — every acceptance needs ≥1 expert reviewer.
- A species is a scientific decision record, not a list entry.
