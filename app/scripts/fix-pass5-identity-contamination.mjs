// One-time data repair for a real bug in buildSpeciesPayload.server.ts's Pass 5
// (within-batch common-name cross-reference, now fixed in code): when a row's
// own scientific name couldn't be resolved in the backbone but its COMMON name
// matched another resolved row in the same import batch, the pass flagged an
// `authority_conflict` (correct) but ALSO adopted the other row's
// gbif_taxon_key/canonical_name/classification onto THIS row's own identity
// (wrong) — common-name-only evidence is too weak to safely treat two
// different scientific names as the same taxon, that's exactly why it's
// supposed to be left for the user to decide. The practical symptom: in the
// workbench Taxonomy panel, the row's own "current name" tab silently showed
// the SAME hierarchy as the conflicting option's tab, because both pointed at
// the identical taxon.
//
// Detection: a conflict entry with authority "Common Name Match (within
// batch)" whose `suggested_name` equals the row's own `taxonomy.current_name`
// AND that differs from the row's actual (imported) `scientific_name` — i.e.
// the row's "current name" was overwritten to be the OTHER option's name.
//
// Fix: reset the row's own identity back to unresolved-pending-review —
// gbif_taxon_key and the flat kingdom..genus columns to null, and
// taxonomy.{classification, authorship, name_published_in_year, current_name,
// accepted_name, accepted_taxon_id} cleared (current_name reverts to the
// row's own scientific_name). taxonomy.authority_conflicts is left untouched
// — the suggested option(s) are still valid for the user to review/accept.
//
// Usage: node scripts/fix-pass5-identity-contamination.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ws from "ws";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { realtime: { transport: ws } });

async function run() {
  console.log(DRY_RUN ? "Dry run — no writes will be made.\n" : "Live run — will update Supabase.\n");

  let from = 0;
  const pageSize = 500;
  let totalScanned = 0;
  let totalFixed = 0;

  while (true) {
    const { data, error } = await supabase
      .from("species")
      .select("id, scientific_name, gbif_taxon_key, taxonomy")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("Supabase query failed:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      totalScanned += 1;
      const taxonomy = row.taxonomy ?? {};
      const conflicts = Array.isArray(taxonomy.authority_conflicts) ? taxonomy.authority_conflicts : [];
      const contaminatingConflict = conflicts.find(
        (c) =>
          c.authority === "Common Name Match (within batch)" &&
          taxonomy.current_name &&
          taxonomy.current_name === c.suggested_name &&
          taxonomy.current_name !== row.scientific_name,
      );
      if (!contaminatingConflict) continue;

      totalFixed += 1;
      console.log(
        `Species ${row.id} "${row.scientific_name}": reverting current_name "${taxonomy.current_name}" back to unresolved.`,
      );

      if (!DRY_RUN) {
        const nextTaxonomy = { ...taxonomy };
        delete nextTaxonomy.classification;
        delete nextTaxonomy.authorship;
        delete nextTaxonomy.name_published_in_year;
        delete nextTaxonomy.accepted_name;
        delete nextTaxonomy.accepted_taxon_id;
        nextTaxonomy.current_name = row.scientific_name;

        const { error: updateError } = await supabase
          .from("species")
          .update({
            gbif_taxon_key: null,
            kingdom: null,
            phylum: null,
            class: null,
            order: null,
            family: null,
            genus: null,
            taxonomy: nextTaxonomy,
          })
          .eq("id", row.id);
        if (updateError) {
          console.error(`  Failed to update species ${row.id}:`, updateError.message);
        }
      }
    }

    from += pageSize;
  }

  console.log(`\nDone. Scanned ${totalScanned} species rows, ${totalFixed} reverted.`);
  if (DRY_RUN) console.log("(Dry run — nothing was written. Re-run without --dry-run to apply.)");
}

run();
