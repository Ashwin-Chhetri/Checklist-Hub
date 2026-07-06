// Builds app/data/higher-rank-vernacular.json: an English vernacular-name ->
// classification index for every kingdom/phylum/class/order in the GBIF
// Backbone Taxonomy (~3,800 taxa total). This exists because the local
// gbif-backbone.sqlite mirror (built for species-level lookups) has no rows
// at all for higher ranks, and — separately — its vernacular-names extract
// turns out to be incomplete even where it does have coverage (e.g. class
// Reptilia has zero vernacular rows locally, vs. 16 for Aves, despite GBIF's
// live per-taxon endpoint listing "Reptiles" for it). Rather than hardcode a
// list of group names, this walks GBIF's own kingdom/phylum/class/order taxa
// and pulls each one's real vernacular names, so it covers whatever GBIF
// itself considers a named group — not a vocabulary we picked.
//
// Usage: node scripts/build-higher-rank-vernacular.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "higher-rank-vernacular.json");

const GBIF_BACKBONE_DATASET_KEY = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";
const RANKS = ["KINGDOM", "PHYLUM", "CLASS", "ORDER"];
const CONCURRENCY = 20;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function fetchAllTaxaForRank(rank) {
  const taxa = [];
  let offset = 0;
  const limit = 300;
  for (;;) {
    const url = new URL("https://api.gbif.org/v1/species/search");
    url.searchParams.set("datasetKey", GBIF_BACKBONE_DATASET_KEY);
    url.searchParams.set("rank", rank);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const data = await fetchJson(url);
    for (const r of data.results ?? []) {
      const accepted = r.taxonomicStatus === "ACCEPTED";
      taxa.push({
        key: r.key,
        // Retired-but-searchable groups (e.g. "Reptilia", kept by GBIF as a
        // pro-parte synonym of Crocodylia et al. specifically so common
        // searches like this one still find it — see its own `remarks`
        // field) only get to claim kingdom/phylum: those are stable
        // regardless of which of several accepted targets the synonym
        // points to, but its own `class`/`order` fields reflect only the
        // *first* such target and would misrepresent the rest.
        accepted,
        classification: accepted
          ? {
              kingdom: r.kingdom ?? null,
              phylum: r.phylum ?? null,
              class: r.class ?? null,
              order: r.order ?? null,
              family: r.family ?? null,
              genus: r.genus ?? null,
              species: null,
            }
          : {
              kingdom: r.kingdom ?? null,
              phylum: r.phylum ?? null,
              class: null,
              order: null,
              family: null,
              genus: null,
              species: null,
            },
      });
    }
    offset += limit;
    if (data.endOfRecords || (data.results ?? []).length === 0) break;
  }
  return taxa;
}

async function fetchVernacularNames(taxonId) {
  try {
    const data = await fetchJson(`https://api.gbif.org/v1/species/${taxonId}/vernacularNames?limit=50`);
    return (data.results ?? [])
      .filter((v) => v.language === "eng" || v.language === "en")
      .map((v) => v.vernacularName.trim());
  } catch {
    return [];
  }
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log("Fetching kingdom/phylum/class/order taxa from GBIF backbone...");
  const allTaxa = [];
  for (const rank of RANKS) {
    const taxa = await fetchAllTaxaForRank(rank);
    console.log(`  ${rank}: ${taxa.length}`);
    allTaxa.push(...taxa);
  }
  console.log(`Total taxa: ${allTaxa.length}. Fetching vernacular names (concurrency ${CONCURRENCY})...`);

  // Accepted taxa are processed first (and get to claim a vernacular name
  // outright) so a retired pro-parte synonym like "Reptilia" can only fill
  // in names no accepted taxon already claimed.
  const ordered = [...allTaxa.filter((t) => t.accepted), ...allTaxa.filter((t) => !t.accepted)];

  const index = {};
  let done = 0;
  for (const batch of chunk(ordered, CONCURRENCY * 10)) {
    await mapWithConcurrency(batch, CONCURRENCY, async (taxon) => {
      const names = await fetchVernacularNames(taxon.key);
      for (const name of names) {
        const key = name.toLowerCase();
        if (!index[key]) index[key] = taxon.classification;
      }
      done += 1;
      if (done % 200 === 0) console.log(`  ${done}/${allTaxa.length}`);
    });
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(index));
  console.log(`Wrote ${Object.keys(index).length} vernacular-name entries to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
