<img src="app/public/res/landing/checklist_hub_logo.png" alt="ChecklistHub" width="96" />

# ChecklistHub

Build a species checklist backed by real evidence — and publish it straight to GBIF.

**Live:** [checklisthub.in](https://checklisthub.in)
**Docs:** [checklisthub.in/docs](https://checklisthub.in/docs)

## Who is this for?

Biodiversity experts — taxonomists, park authorities, conservation planners,
researchers — who need to build a species checklist for a region or taxon
group and publish it to GBIF. It takes away the usual back-and-forth of
emails, spreadsheets, and manually resolving synonyms.

Sign in with Google, ORCID (the researcher identity standard), or email.

## Why do we need it?

**For biodiversity experts**

Taxonomy doesn't hold still, and citizen science doesn't either. GBIF
Backbone and Catalogue of Life are revised on an ongoing basis, and
platforms like iNaturalist and eBird add new observations continuously.
Keeping an existing checklist accurate means re-checking it against both,
over and over — chasing down which names have been resynonymized, which
species now have supporting records they didn't have last year, and which
new candidates a citizen science platform has surfaced. Done by hand across
hundreds of species, that's slow, repetitive, and easy to get wrong.
ChecklistHub automates the checking — taxonomy validation, synonym
resolution, evidence gathering, and change detection — so an expert reviewer
spends their time on the judgment calls a machine shouldn't make, not on the
busywork of finding what changed.

**For GBIF**

- **Cleaner data arrives in the index.** Every species is validated against
  GBIF Backbone / Catalogue of Life and checked for synonym conflicts before
  an expert can accept it, and a checklist is reconciled against other
  checklists to surface overlaps before publication. The Darwin Core
  Archives that reach GBIF arrive with fewer errors and duplicates, which
  means less manual curation on GBIF's side after the fact.
- **More regional data actually gets published.** Many taxonomists, park
  authorities, and conservation planners hold valuable checklists that never
  reach GBIF because building a compliant Darwin Core Archive and standing
  up an IPT is a real technical barrier. ChecklistHub generates the DwC-A
  automatically and publishes through a nearby GBIF-registered IPT, turning
  checklists that would otherwise sit in a spreadsheet into published GBIF
  datasets.
- **Published checklists stay current instead of going stale.** The Watcher
  re-fetches GBIF, iNaturalist, and eBird on a schedule for active
  checklists and surfaces new candidate species and records over time, with
  every change waiting on a reviewer's confirmation. A dataset published
  through ChecklistHub doesn't need a from-scratch resurvey a year later to
  stay accurate — it keeps getting maintained.

## What it does?

**1. Gather & validate evidence**
- Import a species list (CSV) or discover candidates via literature/data search
- Validate taxonomy against GBIF Backbone / Catalogue of Life, with synonyms resolved automatically
- Gather evidence from GBIF, iNaturalist, eBird, museum collections, and literature

Docs: [Import data](https://checklisthub.in/docs/getting-started/import-data) · [Validate species](https://checklisthub.in/docs/getting-started/validate-species)

**2. Review together**
- Review as a team — comment, discuss, vote, accept/reject (every accepted species needs ≥1 expert reviewer)
- Reconcile against other checklists — shared species, missing species, conflicts
- Watch live checklists for new field records over time, with every update waiting on reviewer confirmation

Docs: [Workbench](https://checklisthub.in/docs/features/workbench) · [Collaborate](https://checklisthub.in/docs/getting-started/collaborate) · [Reconciliation](https://checklisthub.in/docs/features/reconciliation) · [Watcher](https://checklisthub.in/docs/features/watcher)

**3. Publish**
- Generate a Darwin Core Archive automatically and publish it through a nearby GBIF-registered IPT

Docs: [Publish to GBIF](https://checklisthub.in/docs/getting-started/publish-to-gbif) · [Darwin Core format](https://checklisthub.in/docs/getting-started/darwin-core-format)

See [`USER_GUIDE.md`](USER_GUIDE.md) for the step-by-step workflow,
[`checklistHub_architecture.md`](checklistHub_architecture.md) for the full
architecture spec, and [`SETUP.md`](SETUP.md) to run this locally.

## Documentation

Full product docs live at [checklisthub.in/docs](https://checklisthub.in/docs):

- **Getting Started**
  - Overview
  - What is Checklist Hub?
  - Create your first checklist
    - Define taxa and region
    - Import data
    - Review species
    - Collaborate
    - Workbench
    - Define Metadata
    - Darwin Core Format
    - Publish to GBIF
    - Checklist Organizer
- **Features**
  - Workbench
  - Evidence
  - Reconciliation
  - Watcher
  - Export
  - History
  - Collaboration
  - AI MCP & Chat Box
- **Publishing**
  - Darwin Core
  - IPT
  - GBIF
  - Troubleshooting
- **Reference**
  - FAQ
  - Terminology
  - Citation

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

## Citing Checklist Hub

If you published a checklist through GBIF, cite that checklist's own dataset
DOI. To cite the **platform** itself (methods section, tool comparison, or
acknowledgment):

> Chhetri, A. (2026). *Checklist Hub: an evidence-backed species checklist
> platform for publishing to GBIF* [Computer software]. Checklist Hub.
> https://checklisthub.in

```bibtex
@software{checklisthub2026,
  author  = {Chhetri, Ashwin},
  title   = {Checklist Hub: an evidence-backed species checklist platform for publishing to GBIF},
  year    = {2026},
  url     = {https://checklisthub.in}
}
```

See [checklisthub.in/docs#citing-checklist-hub](https://checklisthub.in/docs#citing-checklist-hub).

## Principles

- Evidence supports decisions. Experts make decisions.
- Never auto-accept a species — every acceptance needs ≥1 expert reviewer.
- A species is a scientific decision record, not a list entry.
