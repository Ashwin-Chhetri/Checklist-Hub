# Checklist Hub — GBIF Ebbe Nielsen Challenge 2026 Submission

**Submitter:** Ashwin Chhetri (solo submission)
**Repository:** https://github.com/Ashwin-Chhetri/Checklist-Hub (MIT license, public)

This file mirrors the three fields on the official submission form, in the
exact order and word limits requested.

---

## Field 1 — Abstract and rationale (max. 1,000 words)

*(current draft: ~700 words)*

Building a species checklist takes real work: fieldwork, literature
review, and expert judgement. Publishing it, however, is rarely the end of
the story. Taxonomy keeps changing — names are reclassified as synonyms,
or moved to different accepted taxa. New occurrence records extend known
species ranges. Without continuous review, a checklist becomes outdated
soon after it is published, and updating it usually means starting over.
**Checklist Hub** is a collaborative platform that solves this by treating
a checklist as a living dataset rather than a one-time export.

**What it does.** Any expert can start a checklist alone — no team is
required to begin. A checklist is created by defining a region and a
taxonomic group, then populated two ways: importing a CSV of existing
records, and/or running a literature-discovery search (across Google
Scholar, Crossref, OpenAlex, and curated regional sources) that extracts
candidate species directly from matching papers. Every name is checked
automatically against the GBIF Backbone Taxonomy. Names that are synonyms,
authority conflicts, or unresolved matches are flagged, not changed
automatically. A reviewer evaluates each flag and records a decision; when
reviewers disagree, a voting process resolves it. Every accepted species
can be traced back to an explicit decision, not a guess. Collaborators can
be invited at any point, and everyone sees edits and reviews in real time.
A background watcher continuously checks GBIF and eBird for new occurrence
records inside the checklist's region, and adds anything new to the same
review queue as a candidate — never added automatically, always confirmed
by a person. Reviewers can also attach a specific paper or link manually
to support a decision. Once ready, the checklist publishes as a
versioned, Darwin Core–compliant dataset for an IPT, with its full edit
history and contributor list preserved.

**Why now.** This need is growing. The Kunming-Montreal Global
Biodiversity Framework has increased monitoring commitments worldwide.
Citizen-science platforms such as iNaturalist and eBird are generating
large volumes of new occurrence data. As a result, species are being
discovered, rediscovered, and reclassified faster than manual review can
keep up with. Checklist Hub automates the repetitive matching and
flagging work, so experts can focus on the judgement calls only they can
make — together, in real time, rather than alone and after the fact.

**Why it matters to GBIF communities.** Checklist Hub is built for the
groups already active in the GBIF network: national biodiversity nodes,
museum and herbarium taxonomic working groups, university research
groups, and citizen-science or conservation networks. These groups
currently maintain checklists in spreadsheets or static documents,
because no purpose-built collaborative tool exists for this step.
Checklist Hub does not require any change to existing data formats: it
uses the GBIF Backbone Taxonomy as its source of truth and produces
standard Darwin Core output. It adds the layer that is currently
missing — collaborative construction, conflict resolution, continuous
monitoring, and evidence tracking.

**Benefit to the network.** This brings three concrete benefits. First,
fewer checklists go stale, since maintenance becomes incremental review
rather than a full re-compilation. Second, every checklist carries an
audit trail — who proposed a species, who reviewed it, and what evidence
supported the decision. Third, smaller or resource-limited groups can
publish higher-quality datasets, since the tool absorbs much of the
taxonomic-resolution work that otherwise requires dedicated expertise.

**Novelty.** The individual components exist separately elsewhere:
name-resolution services, citizen-science platforms, and collaborative
spreadsheets. No existing tool combines all of them — backbone-aware
conflict detection that never resolves automatically, a documented rule
against auto-accepting species, continuous occurrence monitoring linked
to an existing checklist, and direct Darwin Core publication, in one
realtime collaborative tool. This combination was designed specifically
for this problem, not adapted from an existing product.

**Quality and openness.** The application is built with Next.js and
Supabase/Postgres. Every database table uses row-level security, and
every multi-step write goes through a single atomic database function to
avoid race conditions. Before this submission, the project underwent a
self-initiated production-readiness audit, documented in the repository
alongside the fixes it produced. The complete source code, including
every database migration and the literature pipeline, is public on
GitHub under the MIT license. It depends only on openly redistributable
reference data — the GBIF Backbone Taxonomy and GADM/OpenStreetMap
boundaries — and build scripts are included so the system can be
reproduced independently.

---

## Field 2 — Operating instructions (step-by-step)

*Detailed technical documentation lives in the repository
(`README.md`, `app/AGENTS.md`, `PRODUCTION_AUDIT.md`) — these are the
plain-language steps for actually using the tool, written for the expert
who just wants to get a checklist going, not a systems manual.*

Creating a checklist is a 5-step wizard. One person can complete all five
steps alone — no team is required to begin.

1. **Details.** Sign in, name the checklist, and define its scope: a
   taxonomic group, and a region found by searching for a city, district,
   state, or country by name (not drawn on a map).
2. **Import.** Bring in species two ways, either or both: upload a CSV of
   existing records, and/or run a **Deep Search** — a literature-discovery
   pipeline that searches Google Scholar, Crossref, OpenAlex, and curated
   regional sources for papers about the chosen taxon and region, and
   extracts candidate species directly from them.
3. **Validate.** Review the combined list of species from the CSV import
   and the Deep Search results, and choose which ones to include.
4. **Collab.** Invite collaborators by email — if they already have an
   account they get access immediately, otherwise they're emailed an
   invite. This step can also be skipped for a solo checklist.
5. **Create.** Review a summary (title, region, taxonomic scope, species
   count, invited collaborators) and create the checklist.

Once the checklist exists, it keeps being maintained rather than sitting
static:

6. **Resolve flagged names.** Every species name is checked against the
   GBIF Backbone Taxonomy. A synonym, an authority conflict, or a name
   that doesn't resolve cleanly is never silently changed — it lands in a
   review queue, where a reviewer (or several, by vote) records a decision
   and the reason for it. Nothing is ever deleted, only merged or kept.
7. **Let the watcher keep looking.** A background watcher periodically
   checks GBIF and eBird for new occurrence records appearing in the
   checklist's region, and drops anything new into the same review queue
   as a candidate. It never adds a species on its own.
8. **Publish when ready.** Publishing produces a versioned, Darwin
   Core–compliant export — full edit history and every contributor's name
   intact — ready to hand to an IPT.
9. **Come back, instead of starting over.** As the watcher finds new
   candidates or the backbone is revised, maintainers return to the same
   review queue rather than re-compiling the checklist from scratch.

---

## Field 3 — Video or screencast (max. 5 minutes)

**Link:** *[to be added — recording in progress]*

**Planned content** (≤5 minutes, talking-head intro + screen recording):
1. ~30s: open with the human problem — the care that goes into a checklist,
   and how quietly it can drift out of date afterward. No GBIF-blaming, just
   the natural pace of taxonomy vs. the shelf life of a static document.
2. ~2 min demo: start a checklist solo, add species, watch a synonym get
   flagged and resolved through the review workflow.
3. ~1 min demo: the watcher surfaces a new candidate species from a live
   GBIF/eBird record; a reviewer looks at it and accepts it.
4. ~30s demo: publish to a versioned Darwin Core export.
5. ~30s close: open source, MIT license, repository link on screen, an
   invitation for viewers to try it on their own checklist.

**Openness checklist before submitting this field:**
- [ ] Hosted on a platform requiring no login to view (e.g. YouTube
      "Public" or "Unlisted" — not "Private"; Vimeo public/unlisted).
- [ ] Repository link and license visible on screen or in the
      description.
- [ ] Captions/transcript included if possible, for accessibility.

**Video description (to paste alongside the upload):**

> If you've ever built a species checklist, you know the real work isn't
> writing it down — it's keeping it true after the fact. Taxonomy moves on,
> new records turn up, and the list you cared so much about quietly starts
> drifting out of date. In this video I introduce **Checklist Hub** — a
> collaborative platform that treats a species checklist as something you
> keep tending, not something you publish once and walk away from.
>
> I show how anyone — a solo taxonomist, a regional expert, a whole working
> group — can start a checklist against the GBIF Backbone Taxonomy, how the
> system flags synonyms and authority conflicts for a real person to decide
> on instead of quietly auto-correcting them, and how a background watcher
> keeps an eye on GBIF and eBird for new occurrence records in the
> checklist's region, gently surfacing anything new worth reviewing. I walk
> through the review workflow that keeps every accepted species traceable
> to an actual decision, and the final step: publishing a versioned, Darwin
> Core–compliant dataset ready for an IPT.
>
> Checklist Hub is open source (MIT license), built to be the missing
> collaborative layer between "a list of names someone cared about" and "a
> published GBIF dataset" — and built for anyone who's ever wished their
> checklist could just keep itself current.
>
> Repository: github.com/Ashwin-Chhetri/Checklist-Hub
> Submitted to the GBIF Ebbe Nielsen Challenge 2026.

---

## Supporting reference (not a form field — context for the judges' deep-dive)

- **Status:** functional end-to-end (checklist creation, taxonomy
  resolution, review workflow, Darwin Core publication, watcher
  monitoring, literature evidence pipeline all working in the current
  build). A self-run production audit is documented in-repo
  (`PRODUCTION_AUDIT.md`); hosted public deployment is in progress.
- **Core technology:** Next.js, Supabase (Postgres, Auth, Realtime, RLS),
  local GBIF Backbone Taxonomy + GADM SQLite reference stores, Darwin Core
  export, a standalone multi-source literature-discovery pipeline.
