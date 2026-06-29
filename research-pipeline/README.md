# ChecklistHub Research Pipeline

Standalone literature & ecological research agent. Given a region of
interest and a taxon group, it discovers literature from four independent,
fault-isolated sources (curated-domain Google search, Crossref, OpenAlex,
and Google Scholar as a best-effort supplement), expanded through citation
graphs, resolves legal full text, grounds region ecology in real ecoregion
data, and uses an LLM to judge relevance and extract species/coordinates —
all into a queryable local corpus (`raw/`, `catalog/`, `wiki/`, `outputs/`).

This is intentionally **separate from the ChecklistHub Next.js app**
(`../app`). No Supabase writes, no shared runtime. It's meant to be run and
its output quality manually verified before any later integration back into
ChecklistHub's evidence model.

## Setup

```bash
npm install
cp .env.example .env   # fill in NVIDIA_API_KEY at minimum; others are optional
npm run build:gbif-backbone   # one-time: builds data/gbif-backbone.sqlite
npm run build:ecoregions      # one-time: builds data/ecoregions.sqlite
```

Requires Node >=20 (needed by the `scholar-mcp` MCP server dependency).

## Run

```bash
npm run research -- --region "Darjeeling district, West Bengal" --taxon Aves
```

Output lands in:
- `raw/` — immutable, append-only evidence corpus (per-paper metadata, full
  text, dated LLM analysis snapshots). Never overwritten; re-runs skip
  already-fetched papers unless `--refresh` is passed.
- `catalog/` — one flat, queryable JSON record per paper (region/taxa tags,
  relevance score, has_coordinates, etc.) — regenerated freely.
- `wiki/<Region + Taxon>/` — human-readable markdown pages (overview,
  important papers, historical literature, species, authors, timeline) —
  fully regenerated each run.
- `outputs/` — cross-paper derived JSON artifacts (species, important
  papers, historical checklists, coordinates, literature rankings).

Query the catalog directly:

```bash
npm run research -- query --region "Eastern Himalaya" --taxa Aves --historical --has-coordinates
```

## Design notes

See `../checklistHub_architecture.md` for ChecklistHub's overall principles
(evidence supports decisions, experts decide, never auto-accept). This
pipeline follows the same anti-fabrication discipline in every LLM prompt:
extraction and narrative generation are only ever grounded in retrieved
text or structured data actually present in this run's corpus — never the
model's general knowledge.

Source discovery philosophy (revised after Google Scholar started returning
persistent 429s under real use — see `src/discovery/multiSourceDiscovery.ts`):
discovery is **multi-source and fault-isolated**. A curated, domain-restricted
Google Custom Search (`src/sources/googleCustomSearch.ts` +
`src/discovery/curatedDomains.ts`) is the new primary source — it's an
actual API with a generous-enough free tier, not scraping, restricted to a
fixed, editable allow-list of trusted biodiversity-literature domains.
Crossref and OpenAlex also run as discovery sources again (they were
demoted earlier in this project for surfacing wrong-region false
positives; `src/analysis/regionSpecificity.ts` now flags/sorts those down
instead of letting them pollute results undetected, so re-promoting them is
safe). Google Scholar (via ScholarMCP) is kept only as a **best-effort
supplement** — every source runs isolated in its own try/catch
(`multiSourceDiscovery.ts`), so one failing (Scholar's 429s, a Google CSE
quota exhaustion, anything) never aborts the run; it just means zero
candidates from that source for that run, recorded in `RunStatus.sourceOutcomes`.

The citation graph (references + citing papers, via Semantic Scholar) is
still a second discovery phase on top of all of this, since the most
relevant literature for a region sometimes never surfaces from a keyword
search directly, no matter the source. CORE/BHL stay role-specialized
(open-access PDF resolution, historic literature) rather than parallel
search engines. Full-text retrieval is still a single deterministic chain
(Title → DOI → Crossref → Unpaywall → CORE → BHL → PDF) — ScholarMCP's own
bundled full-text ingestion tool is deliberately not used, to keep that
step auditable.

Google Custom Search's free tier is a **hard 100-queries/day cap** (no
recovery until the daily reset, unlike Scholar's temporary block) —
`src/discovery/queryCache.ts` caches every raw query result on disk for a
week specifically so repeated test runs for the same region+taxon don't
burn through it.
