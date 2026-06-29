const express = require("express");
const backbone = require("./backbone");
const gadm = require("./gadm");
const literatureMatch = require("./literatureMatch");

const PORT = process.env.PORT || 8080;
const SHARED_SECRET = process.env.INTERNAL_API_SECRET;

if (!SHARED_SECRET) {
  console.error("INTERNAL_API_SECRET is not set — refusing to start without an auth secret.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "5mb" }));

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (req.headers["x-internal-secret"] !== SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

function safe(handler) {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      console.error(`[${req.method} ${req.path}] failed:`, err);
      res.status(503).json({ error: "reference data unavailable", detail: String(err?.message ?? err) });
    }
  };
}

app.post("/backbone/lookup", safe((req, res) => {
  const { input, kingdomHint } = req.body;
  res.json(backbone.lookupBackbone(input ?? {}, kingdomHint));
}));

app.post("/backbone/lookup-batch", safe((req, res) => {
  const { items, kingdomHint } = req.body;
  res.json(backbone.lookupBackboneBatch(items ?? [], kingdomHint));
}));

app.post("/backbone/lookup-exhaustive", safe((req, res) => {
  res.json(backbone.lookupBackboneExhaustive(req.body ?? {}));
}));

app.get("/backbone/subspecies", safe((req, res) => {
  const taxonId = Number(req.query.taxonId);
  res.json(backbone.getSubspecies(taxonId));
}));

app.get("/backbone/vernacular", safe((req, res) => {
  const taxonId = Number(req.query.taxonId);
  res.json(backbone.getVernacularNames(taxonId));
}));

app.post("/backbone/vernacular-batch", safe((req, res) => {
  const { taxonIds } = req.body;
  res.json(backbone.getVernacularNamesBatch(taxonIds ?? []));
}));

app.get("/backbone/search", safe((req, res) => {
  const q = String(req.query.q ?? "");
  const limit = req.query.limit ? Number(req.query.limit) : 8;
  res.json(backbone.searchBackbone(q, limit));
}));

app.post("/backbone/resolve-batch", safe((req, res) => {
  const { speciesKeys, includeVernacularNames } = req.body;
  if (!Array.isArray(speciesKeys) || speciesKeys.length === 0) {
    return res.json({ rows: [] });
  }
  res.json({ rows: backbone.resolveBatchTaxa(speciesKeys, Boolean(includeVernacularNames)) });
}));

app.post("/gadm/lookup", safe((req, res) => {
  res.json(gadm.lookup(req.body ?? {}));
}));

app.get("/gadm/boundary", safe((req, res) => {
  res.json(gadm.readGadmRow(String(req.query.gid ?? "")));
}));

app.post("/literature/match-species", safe((req, res) => {
  const { names, taxonHint } = req.body;
  res.json(literatureMatch.matchCanonicalSpecies(names ?? [], taxonHint));
}));

app.listen(PORT, () => {
  console.log(`reference-data-service listening on :${PORT}`);
});
