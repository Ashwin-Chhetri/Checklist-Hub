#!/usr/bin/env node
/**
 * Checks that a checklist title resolves to the right taxonomic scope.
 *
 * Run against a dev server:  npm run dev,  then  npm run test:scope
 * Override the target with BASE_URL=https://... npm run test:scope
 *
 * These cases are chosen to break naive implementations rather than to
 * demonstrate the happy path. The first five are impossible for a
 * GBIF-backbone-only resolver: GBIF has no superfamily, suborder or subfamily
 * taxa at all, and no way to express "everything except this group".
 *
 * Assertions are deliberately loose about *which* extra ranks a lineage
 * carries (iNaturalist's ancestry includes ranks we never ask about) and
 * strict about the ones that decide whether the import is right.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

/**
 * @typedef {object} Case
 * @property {string} title      checklist title to resolve
 * @property {string} why        what this case is guarding against
 * @property {object} [expect]   assertions; omit for "expect no match"
 * @property {[string,string]} [expect.deepest]  [rank, name] of the deepest include
 * @property {[string,string][]} [expect.includes] include nodes that must be present
 * @property {[string,string][]} [expect.excludes] exclude nodes that must be present
 * @property {string[]} [expect.anyDeepestName]   accept any one of these as the deepest name
 * @property {string[]} [expect.absentRanks]     ranks that must NOT appear (redundant sub-ranks)
 * @property {boolean} [expectNoMatch]
 */

/** @type {Case[]} */
const CASES = [
  {
    title: "Butterflies of Darjeeling",
    why: "Butterflies are a superfamily, a rank GBIF's backbone does not have. Stopping at order Lepidoptera would include every moth.",
    expect: {
      deepest: ["superfamily", "Papilionoidea"],
      includes: [["order", "Lepidoptera"]],
      // Hexapoda and Pterygota are in iNaturalist's ancestry but say nothing
      // that class Insecta doesn't; a butterfly checklist's scope shouldn't
      // carry them.
      absentRanks: ["subphylum", "subclass", "infraclass"],
    },
  },
  {
    title: "Moths of Darjeeling",
    why: "Moths are not a clade. iNaturalist reports 'Moths' as a common name of Lepidoptera, which also contains every butterfly.",
    expect: {
      deepest: ["order", "Lepidoptera"],
      excludes: [["superfamily", "Papilionoidea"]],
      absentRanks: ["subphylum", "subclass"],
    },
  },
  {
    title: "Snakes of Australia",
    why: "Snakes are suborder Serpentes; GBIF can only reach order Squamata, which is snakes plus every lizard.",
    expect: { deepest: ["suborder", "Serpentes"], absentRanks: ["subphylum"] },
  },
  {
    title: "Tiger Beetles of India",
    why: "A two-word group name that must beat the single word 'Tiger' (Panthera tigris) sitting later in the candidate list.",
    expect: { anyDeepestName: ["Cicindelidae", "Cicindelinae"] },
  },
  {
    title: "Wasps of Karnataka",
    why: "Paraphyletic: wasps are the narrow-waisted Hymenoptera minus bees and ants.",
    expect: { excludes: [["superfamily", "Apoidea"], ["family", "Formicidae"]] },
  },
  {
    title: "Reptiles of Sri Lanka",
    why: "Must land on class Reptilia, not the bird-inclusive Sauropsida.",
    expect: { deepest: ["class", "Reptilia"] },
  },
  {
    title: "Fishes of the Ganges",
    why: "Paraphyletic: must not collapse to a single class, which would silently drop the sharks and rays.",
    expect: { includes: [["subphylum", "Vertebrata"]], excludes: [["class", "Mammalia"]] },
  },
  {
    title: "Sharks of the Andaman Sea",
    why: "Sharks sit at infraclass, another rank GBIF's backbone lacks entirely.",
    expect: { anyDeepestName: ["Selachii", "Elasmobranchii", "Selachimorpha"] },
  },
  {
    title: "Orchids of Sikkim",
    why: "A plant group — guards against an animal-only resolution path.",
    expect: { deepest: ["family", "Orchidaceae"], includes: [["kingdom", "Plantae"]] },
  },
  {
    title: "Oaks of California",
    why: "Genus-level vernacular.",
    expect: { deepest: ["genus", "Quercus"] },
  },
  {
    title: "Bumblebees of Colorado",
    why: "Genus-level vernacular that a fuzzy match would happily resolve to the whole bee superfamily.",
    expect: {
      deepest: ["genus", "Bombus"],
      absentRanks: ["subphylum", "subclass", "suborder", "infraorder", "superfamily", "subfamily", "tribe"],
    },
  },
  {
    title: "Hoverflies of the UK",
    why: "Single-word compound vernacular at family rank.",
    expect: { deepest: ["family", "Syrphidae"] },
  },
  {
    title: "Grasses of Punjab",
    why: "Very common English word that also appears inside many other common names.",
    expect: { deepest: ["family", "Poaceae"] },
  },
  {
    title: "Ferns of the Western Ghats",
    why: "Plant class whose vernacular the GBIF mirror is known to be missing.",
    expect: { anyDeepestName: ["Polypodiopsida", "Pteridophyta"] },
  },
  {
    title: "Mushrooms of Oregon",
    why: "A vernacular that maps to a kingdom, not to any single lower rank.",
    expect: { includes: [["kingdom", "Fungi"]] },
  },
  {
    title: "Bats of Meghalaya",
    why: "Straightforward order — the regression guard for the common case.",
    expect: { deepest: ["order", "Chiroptera"] },
  },
  {
    title: "Tiger",
    why: "A bare species vernacular with no region, which must resolve the full chain down to species.",
    expect: {
      deepest: ["species", "Panthera tigris"],
      absentRanks: ["subphylum", "subclass", "infraclass", "subfamily", "subgenus"],
    },
  },
  {
    title: "Papilionidae of Nepal",
    why: "A scientific name in the title, not a common name.",
    expect: { deepest: ["family", "Papilionidae"] },
  },
  {
    title: "Common Birds and Mammals of Assam",
    why: "Two groups plus a descriptor: must pick one coherent group, and should prefer the one named first.",
    expect: { anyDeepestName: ["Aves", "Mammalia"] },
  },
  {
    title: "Biodiversity of Manas National Park",
    why: "No taxonomic term at all. A fuzzy matcher will invent one; it must return nothing instead.",
    expectNoMatch: true,
  },
];

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function describeNodes(nodes) {
  if (!nodes?.length) return "(none)";
  return nodes
    .map((n) => `${n.mode === "exclude" ? "-" : ""}${n.rank}:${n.name}`)
    .join(" ");
}

function check(testCase, data) {
  const nodes = data.nodes ?? [];
  const includes = nodes.filter((n) => n.mode === "include");
  const excludes = nodes.filter((n) => n.mode === "exclude");
  const failures = [];

  if (testCase.expectNoMatch) {
    if (data.matchedTerm) failures.push(`expected no match, got "${data.matchedTerm}"`);
    return failures;
  }

  if (!data.matchedTerm) {
    failures.push("no match at all");
    return failures;
  }

  const deepest = includes[includes.length - 1];
  const e = testCase.expect ?? {};

  if (e.deepest) {
    const [rank, name] = e.deepest;
    if (!deepest || deepest.rank !== rank || deepest.name !== name) {
      failures.push(`deepest should be ${rank}:${name}, got ${deepest ? `${deepest.rank}:${deepest.name}` : "nothing"}`);
    }
  }
  if (e.anyDeepestName && !e.anyDeepestName.includes(deepest?.name)) {
    failures.push(`deepest should be one of [${e.anyDeepestName.join(", ")}], got ${deepest?.name ?? "nothing"}`);
  }
  for (const [rank, name] of e.includes ?? []) {
    if (!includes.some((n) => n.rank === rank && n.name === name)) {
      failures.push(`missing include ${rank}:${name}`);
    }
  }
  for (const [rank, name] of e.excludes ?? []) {
    if (!excludes.some((n) => n.rank === rank && n.name === name)) {
      failures.push(`missing exclude ${rank}:${name}`);
    }
  }
  for (const rank of e.absentRanks ?? []) {
    const found = nodes.find((n) => n.rank === rank);
    if (found) failures.push(`redundant ${rank}:${found.name} should have been pruned`);
  }
  return failures;
}

// ── Scope resolution ────────────────────────────────────────────────────────
// The cases above check that a title resolves to the right *scope*. These
// check that a scope then resolves to the right *queries* — a separate failure
// surface, and one that fails silently: a family that doesn't resolve simply
// disappears from the import, with no error raised anywhere.

const TARGET_CASES = [
  {
    label: "Papilionoidea keeps Hedylidae",
    why: "Hedylidae is a homonym (Lepidoptera and Gastropoda). species/match refuses ambiguous names and answers HIGHERRANK with kingdom Animalia, so the family was silently dropped — 35 species and ~5k occurrence records worldwide.",
    nodes: [
      { rank: "kingdom", name: "Animalia", inatId: 1, gbifKey: 1, mode: "include" },
      { rank: "order", name: "Lepidoptera", inatId: 47157, gbifKey: 797, mode: "include" },
      { rank: "superfamily", name: "Papilionoidea", inatId: 47224, gbifKey: null, mode: "include" },
    ],
    expect: (t) => {
      const f = [];
      if (!t.includeGbifKeys.includes(6951)) f.push("missing Hedylidae key 6951");
      if (t.includeGbifKeys.includes(1)) f.push("kingdom Animalia (key 1) leaked into the scope");
      if (t.includeGbifKeys.length !== 7) f.push(`expected 7 family keys, got ${t.includeGbifKeys.length}`);
      return f;
    },
  },
  {
    label: "Apoidea recovers absent families at genus level",
    why: "GBIF has no Entomosericidae or Eremiaspheciidae family — it still files both under Crabronidae. Their genera do resolve, which keeps the species reachable.",
    nodes: [
      { rank: "kingdom", name: "Animalia", inatId: 1, gbifKey: 1, mode: "include" },
      { rank: "order", name: "Hymenoptera", inatId: 47201, gbifKey: 1457, mode: "include" },
      { rank: "superfamily", name: "Apoidea", inatId: 47222, gbifKey: null, mode: "include" },
    ],
    expect: (t) => {
      const f = [];
      for (const [n, k] of [["Entomosericus", 4298308], ["Eremiasphecium", 4298307], ["Laphyragogus", 4298306]]) {
        if (!t.includeGbifKeys.includes(k)) f.push(`missing genus ${n} (${k})`);
      }
      if (t.includeGbifKeys.includes(1)) f.push("kingdom Animalia (key 1) leaked into the scope");
      return f;
    },
  },
  {
    label: "Moths exclude every butterfly family",
    why: "The GBIF exclusion is applied by family name against GBIF's own records, so all seven have to be listed or butterflies leak into a moth checklist.",
    nodes: [
      { rank: "kingdom", name: "Animalia", inatId: 1, gbifKey: 1, mode: "include" },
      { rank: "order", name: "Lepidoptera", inatId: 47157, gbifKey: 797, mode: "include" },
      { rank: "superfamily", name: "Papilionoidea", inatId: 47224, gbifKey: null, mode: "exclude" },
    ],
    expect: (t) => {
      const f = [];
      if (t.includeGbifKeys.join() !== "797") f.push(`include should be just Lepidoptera (797), got [${t.includeGbifKeys}]`);
      for (const fam of ["Hedylidae", "Papilionidae", "Nymphalidae", "Riodinidae", "Pieridae", "Hesperiidae", "Lycaenidae"]) {
        if (!t.excludeFamilyNames.includes(fam)) f.push(`missing excluded family ${fam}`);
      }
      if (!t.excludeInatIds.includes(47224)) f.push("iNat exclusion id 47224 missing");
      return f;
    },
  },
];

async function runTargetCases() {
  console.log("Resolving scopes into query targets\n");
  let passed = 0;
  const failed = [];

  for (const [i, tc] of TARGET_CASES.entries()) {
    const label = `${String(i + 1).padStart(2)}. ${tc.label}`;
    let t;
    try {
      const res = await fetch(`${BASE_URL}/api/taxonomy/scope-targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: tc.nodes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      t = await res.json();
    } catch (err) {
      failed.push({ label: tc.label, failures: [`request failed: ${err.message}`] });
      console.log(`${RED}FAIL${RESET} ${label}`);
      console.log(`     ${RED}request failed: ${err.message}${RESET}`);
      continue;
    }

    const failures = tc.expect(t);
    if (failures.length === 0) {
      passed += 1;
      console.log(`${GREEN}PASS${RESET} ${label}`);
      console.log(`     ${DIM}keys=[${t.includeGbifKeys.join(", ")}] excludedFamilies=${t.excludeFamilyNames.length}${RESET}`);
    } else {
      failed.push({ label: tc.label, failures });
      console.log(`${RED}FAIL${RESET} ${label}`);
      console.log(`     ${DIM}why: ${tc.why}${RESET}`);
      for (const f of failures) console.log(`     ${RED}${f}${RESET}`);
    }
  }
  console.log(`\n${passed}/${TARGET_CASES.length} passed\n`);
  return failed;
}

async function main() {
  console.log(`\nResolving ${CASES.length} checklist titles against ${BASE_URL}\n`);

  let passed = 0;
  const failed = [];

  for (const [i, testCase] of CASES.entries()) {
    const label = `${String(i + 1).padStart(2)}. ${testCase.title}`;
    let data;
    try {
      const res = await fetch(`${BASE_URL}/api/taxonomy/suggest-scope?title=${encodeURIComponent(testCase.title)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      failed.push({ testCase, failures: [`request failed: ${err.message}`] });
      console.log(`${RED}FAIL${RESET} ${label}\n     ${RED}request failed: ${err.message}${RESET}`);
      continue;
    }

    const failures = check(testCase, data);
    if (failures.length === 0) {
      passed += 1;
      console.log(`${GREEN}PASS${RESET} ${label}`);
      console.log(`     ${DIM}${describeNodes(data.nodes)}${RESET}`);
    } else {
      failed.push({ testCase, failures });
      console.log(`${RED}FAIL${RESET} ${label}`);
      console.log(`     ${DIM}why: ${testCase.why}${RESET}`);
      console.log(`     ${DIM}got: ${describeNodes(data.nodes)}${RESET}`);
      for (const f of failures) console.log(`     ${RED}${f}${RESET}`);
    }
  }

  console.log(`\n${passed}/${CASES.length} passed\n`);

  const targetFailures = await runTargetCases();

  if (failed.length || targetFailures.length) {
    console.log("Failures:");
    for (const { testCase, failures } of failed) {
      console.log(`  - ${testCase.title}: ${failures.join("; ")}`);
    }
    for (const { label, failures } of targetFailures) {
      console.log(`  - ${label}: ${failures.join("; ")}`);
    }
    console.log("");
    process.exit(1);
  }
}

main();
