# ChecklistHub — Mental Model, Architecture, 4-Step Capability Model

## 1. Mental Model

**The pain point:** Checklist creators today work in spreadsheets. A species name goes in a cell with no taxonomic authority check, no evidence behind it, no reviewer sign-off, and no audit trail. Publishing to GBIF means manually wrangling Darwin Core Archive files and an IPT installation by hand. Mistakes (synonyms, duplicates, unsupported names) ship silently, and nobody can reconstruct *why* a species was included six months later.

**The reframe:** ChecklistHub does not treat a species as a row. It treats a species as a **Species Object** — a decision record carrying identity, taxonomy, evidence, review history, discussion, provenance, and publication status. A checklist is the sum of defensible decisions, not a list of names.

**The system's job** is to feed each Species Object with enough validated information (taxonomy + evidence) that a human expert can make a fast, confident, traceable accept/reject decision — and then turn the accepted set into a publication-ready package. The system never decides for the expert (Principle: *Never Auto-Accept*).

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                          Workbench (UI)                     │
│   Notion-style review surface — Editor Engine renders        │
│   Species Objects: views, filtering, grouping, inline edit   │
└───────────────────────────┬───────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────────┐
        │                   │                       │
 ┌────────────┐     ┌──────────────┐        ┌──────────────────┐
 │  Species    │     │  Taxonomy    │        │   Evidence        │
 │  Engine     │◄───►│  Engine      │◄──────►│   Engine          │
 │ (source of  │     │ GBIF Backbone│        │ GBIF / iNaturalist│
 │  truth)     │     │ + CoL        │        │ eBird / literature│
 └────────────┘     └──────────────┘        └──────────────────┘
        ▲                                            ▲
        │                                            │
 ┌────────────────┐                          ┌──────────────────┐
 │ Reconciliation  │                          │  Collaboration    │
 │ Engine          │                          │  Engine            │
 │ (cross-checklist│                          │ (review, comments, │
 │  conflicts)     │                          │  presence, perms)  │
 └────────────────┘                          └──────────────────┘
        │                                            │
        └───────────────────┬───────────────────────┘
                            ▼
                  ┌──────────────────┐
                  │ Publication       │
                  │ Engine             │
                  │ DwC-A / EML / IPT  │
                  └──────────────────┘
```

**System layers** (one Next.js app, no separate backend):

- **Client** — React + TanStack Query for server state, Zustand only for ephemeral UI/presence. Talks to Supabase directly only for RLS-permitted reads and Realtime.
- **App server** — Next.js API routes (`app/api/**/route.ts`). Auth-checked writes and multi-step logic go through Postgres `security definer` RPCs rather than chained client calls.
- **Supabase** — Postgres, Auth (Google OAuth), Realtime, Storage. RLS is the authorization boundary.
- **Local SQLite (exception)** — GBIF Backbone (~5.5M rows) and Catalogue of Life are too large for Supabase's free tier, so they're built into gitignored `.sqlite` files and served read-only via `better-sqlite3` from dedicated API routes (e.g. `/api/taxonomy/resolve-batch`).

**Tech stack:** Next.js, React, TypeScript, TailwindCSS, TanStack Query/Table/Virtual, Zustand, Supabase JS/SSR, better-sqlite3, xlsx/jszip for import-export.

---

## 3. The 4-Step Capability Model

This is the capability spine that every checklist passes through, end to end — it's how the seven engines map onto what a creator actually experiences.

| Step | Capability | What happens | Engines involved |
|---|---|---|---|
| **1. Import & Validate** | Turn a raw list into validated taxonomy | Upload a CSV or run discovery search; every name is checked against GBIF Backbone / Catalogue of Life, synonyms resolved, accepted names detected | Species, Taxonomy |
| **2. Gather Evidence & Reconcile** | Back every name with proof, surface conflicts | Evidence auto-aggregated from GBIF, iNaturalist, eBird, literature, deduplicated and scored; checklist compared against other checklists for shared/missing species and synonym conflicts | Evidence, Reconciliation |
| **3. Review & Collaborate** | Turn evidence into expert decisions | Experts work the Workbench, discuss, comment, vote on conflicts; every accept/reject requires at least one reviewer — nothing auto-accepts | Editor, Collaboration |
| **4. Publish** | Turn accepted species into a GBIF-ready dataset | Readiness checks (metadata, taxonomy, citation, DwC-A, EML), package generation, IPT registration, DOI/citation capture | Publication |

This is the same shape as the in-app wizards: the **creation wizard** (`Details → Import → Validate → Collab → Create`) covers Step 1–3 setup, and the **publish wizard** (`Validate → Metadata → Review → IPT → Done`) covers Step 4.
