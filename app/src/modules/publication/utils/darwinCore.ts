import JSZip from "jszip";
import type { Species, TaxonomyStatus } from "@/types/species.types";
import type { Checklist, ChecklistContributor, ChecklistMetadata } from "@/types/checklist.types";
import type { SpeciesMediaItem } from "@/app/api/taxonomy/species-media/route";
import { citationFor } from "./checklistStats";
import type { BoundingBox } from "./boundingBox";

/** Escapes a value for a tab-separated DwC-A text file — quotes only when the value itself contains a tab, quote, or newline (the actual delimiters in play), not commas. */
function tsvEscape(value: string): string {
  if (value.includes("\t") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Exported so callers (e.g. the package preview's Edit/Save flow) can re-serialize edited rows with the same escaping rules used to generate every TSV file in this module. */
export function tsvFile(columns: readonly string[], rows: string[][]): string {
  const header = columns.join("\t");
  const lines = rows.map((row) => row.map(tsvEscape).join("\t"));
  return [header, ...lines].join("\n");
}

function nomenclaturalCodeFor(kingdom: string | null): string {
  return kingdom === "Plantae" || kingdom === "Fungi" ? "ICN" : "ICZN";
}

const TAXON_COLUMNS = [
  "taxonID",
  "scientificName",
  "scientificNameAuthorship",
  "namePublishedInYear",
  "taxonRank",
  "taxonomicStatus",
  "nomenclaturalCode",
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "vernacularName",
  "modified",
] as const;

const YEAR_PATTERN = /\b(1[5-9]\d{2}|20\d{2})\b/;

/**
 * Extracts a publication year from an authorship string when the dedicated
 * `name_published_in_year` field is empty — common for older names, where
 * the local GBIF backbone mirror's `name_published_in_year` column is
 * sparsely populated even though the year is already present as text in
 * `scientific_name_authorship`.
 */
function extractPublishedYear(authorship: string | null | undefined): string | null {
  return authorship?.match(YEAR_PATTERN)?.[1] ?? null;
}

/**
 * Cleans an authorship string for `scientificNameAuthorship`:
 *  - strips the publication year (belongs exclusively in
 *    `namePublishedInYear`, e.g. "(Pennell, 1934)" → "(Pennell)")
 *  - strips a redundant *fully-wrapping* outer paren pair, e.g.
 *    "(L.)" → "L." — parens are only meaningful in authorship when they
 *    wrap the ORIGINAL author ahead of a combining author outside them,
 *    e.g. "(Pennell) Deam"; a pair wrapping the entire string (no text
 *    outside it) is never correct botanical/zoological convention, just
 *    a data-quality artifact from the backbone.
 */
function cleanAuthorship(authorship: string | null | undefined): string {
  if (!authorship) return "";
  let cleaned = authorship
    .replace(YEAR_PATTERN, "")
    .replace(/,\s*\)/g, ")")
    .replace(/,\s*$/, "")
    .replace(/\(\s*\)/g, "")
    .trim();
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

/**
 * Strips a trailing authorship from `scientificName` when the imported name
 * already had it concatenated in (DwC-A "Option A" style, e.g. "Quercus alba
 * L." or "Gerardia paupercula var. borealis (Pennell) Deam") — common for
 * CSV-imported checklists, since ingestion deliberately never rewrites
 * `scientific_name` (preserves the user's original input). Exporting both a
 * concatenated `scientificName` *and* a separate `scientificNameAuthorship`
 * would duplicate the authorship; this keeps the export to "Option B"
 * (separated components) consistently regardless of import source. Tries
 * the raw (possibly year-bearing) authorship first, then the cleaned one,
 * since the embedded text in an Option-A name matches whichever the
 * original source actually used.
 */
function stripEmbeddedAuthorship(scientificName: string, rawAuthorship: string | null | undefined, cleanedAuthorship: string): string {
  const trimmedName = scientificName.trim();
  for (const candidate of [rawAuthorship?.trim(), cleanedAuthorship]) {
    if (candidate && trimmedName.endsWith(candidate)) {
      return trimmedName.slice(0, trimmedName.length - candidate.length).trim();
    }
  }
  return trimmedName;
}

/** Maps statuses that should never appear in an export (gated out upstream by publish readiness) to a safe, valid DwC taxonomicStatus value, so a bypass of that gate can never produce invalid output. */
function mapTaxonomicStatus(status: TaxonomyStatus): "accepted" | "synonym" | "doubtful" {
  if (status === "accepted" || status === "synonym") return status;
  return "doubtful";
}

/**
 * Resolves `taxonomicStatus` for one row. A synonym only gets
 * `taxonomicStatus = "synonym"` when the taxon it's a synonym of is *also*
 * present as its own row in this export — per GBIF's own checklist
 * data-quality guidance, a synonym should only carry that status "if both
 * synonyms and accepted names are supplied" in the dataset. Otherwise this
 * row is the operative/listed name for the dataset, exported as `accepted`.
 *
 * True pro-parte synonymy (one synonym name shared across multiple accepted
 * taxa as distinct Taxon Core rows) is out of scope — `has synonym` rows in
 * resourcerelationship.txt (see `buildResourceRelationshipFile`) remain the
 * documented way to annotate known synonym names, not a Core-row substitute.
 */
function resolveAcceptedUsage(species: Species, allSpecies: Species[]): { taxonomicStatus: string } {
  if (species.taxonomy_status === "synonym") {
    const acceptedTaxonId = species.taxonomy?.accepted_taxon_id;
    const acceptedRow =
      acceptedTaxonId != null
        ? allSpecies.find((s) => s.id !== species.id && s.gbif_taxon_key === acceptedTaxonId)
        : undefined;
    if (acceptedRow) {
      return { taxonomicStatus: "synonym" };
    }
  }
  return { taxonomicStatus: mapTaxonomicStatus(species.taxonomy_status) };
}

function speciesToTaxonRow(species: Species, allSpecies: Species[]): string[] {
  const { taxonomicStatus } = resolveAcceptedUsage(species, allSpecies);
  const rawAuthorship = species.taxonomy?.authorship;
  const cleanedAuthorship = cleanAuthorship(rawAuthorship);
  const namePublishedInYear =
    species.taxonomy?.name_published_in_year?.toString() ?? extractPublishedYear(rawAuthorship) ?? "";
  const scientificName = stripEmbeddedAuthorship(species.scientific_name, rawAuthorship, cleanedAuthorship);
  return [
    species.id,
    scientificName,
    cleanedAuthorship,
    namePublishedInYear,
    "species",
    taxonomicStatus,
    nomenclaturalCodeFor(species.kingdom),
    species.kingdom ?? "",
    species.phylum ?? "",
    species.class ?? "",
    species.order ?? "",
    species.family ?? "",
    species.genus ?? "",
    species.common_name ?? "",
    species.updated_at,
  ];
}

/** Builds the contents of a Darwin Core Archive `taxon.txt` file (tab-separated). */
export function buildTaxonFile(species: Species[]): string {
  return tsvFile(TAXON_COLUMNS, species.map((s) => speciesToTaxonRow(s, species)));
}

const VERNACULAR_COLUMNS = ["taxonID", "vernacularName", "language"] as const;

/** Builds `vernacularname.txt` (GBIF Vernacular Names extension) — one row per species with a recorded common name. */
export function buildVernacularNameFile(species: Species[], language = "en"): string {
  const rows = species
    .filter((s) => s.common_name?.trim())
    .map((s) => [s.id, s.common_name as string, language]);
  return tsvFile(VERNACULAR_COLUMNS, rows);
}

const DISTRIBUTION_COLUMNS = ["taxonID", "locationID", "locality", "country", "occurrenceStatus", "source"] as const;

/**
 * Builds `distribution.txt` (GBIF Distribution extension) — one row per
 * species, scoped to the checklist's own region. `source` is a
 * semicolon-joined list of real per-source citations (see `citationFor`) —
 * a proper attribution string per platform (GBIF/eBird/iNaturalist) or the
 * literature reference/DOI, not just a bare source-type label.
 */
export function buildDistributionFile(checklist: Checklist, species: Species[]): string {
  const locationId = checklist.region_gadm_id ?? checklist.region_osm_id ?? "";
  const locality = checklist.region_name ?? "";
  const country = checklist.region_country ?? "";
  // One shared access date for the whole build — these citations describe
  // live-queried evidence, not a static dataset, so "accessed on" must
  // reflect when the package was actually generated.
  const accessDate = new Date();

  const rows = species.map((s) => {
    const sourceCitations = Array.from(
      new Set(
        (s.evidence?.sources ?? [])
          .filter((src) => src.status !== "discarded")
          .map((src) => citationFor(src, s.gbif_taxon_key, accessDate)),
      ),
    );
    return [s.id, locationId, locality, country, "present", sourceCitations.join("; ")];
  });

  return tsvFile(DISTRIBUTION_COLUMNS, rows);
}

const RESOURCE_RELATIONSHIP_COLUMNS = [
  "resourceRelationshipID",
  "resourceID",
  "relationshipOfResource",
  "relatedResourceID",
  "relationshipAccordingTo",
  "relationshipRemarks",
] as const;

/** Builds `resourcerelationship.txt` — relates each species to its known GBIF-backbone synonyms. Only emits a row when the synonym carries a real GBIF taxon key; never invents an identifier. */
export function buildResourceRelationshipFile(species: Species[]): string {
  const rows: string[][] = [];
  for (const s of species) {
    const synonyms = s.taxonomy?.synonyms ?? [];
    synonyms.forEach((synonym, index) => {
      if (synonym.taxon_id == null) return;
      rows.push([
        `${s.id}-syn-${index}`,
        s.id,
        "has synonym",
        String(synonym.taxon_id),
        "GBIF Backbone Taxonomy",
        synonym.name,
      ]);
    });
  }
  return tsvFile(RESOURCE_RELATIONSHIP_COLUMNS, rows);
}

const MULTIMEDIA_COLUMNS = [
  "taxonID",
  "identifier",
  "type",
  "format",
  "creator",
  "license",
  "rightsHolder",
  "source",
] as const;

function inferImageFormat(url: string): string {
  const match = /\.(jpe?g|png|gif|webp)(\?|$)/i.exec(url);
  const ext = match?.[1]?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/** Builds `multimedia.txt` (GBIF Multimedia extension) from real GBIF-sourced media (see `packageMediaService.fetchSpeciesMediaMap`) — species with no media simply contribute no rows. */
export function buildMultimediaFile(species: Species[], mediaBySpeciesId: Map<string, SpeciesMediaItem[]>): string {
  const rows: string[][] = [];
  for (const s of species) {
    for (const item of mediaBySpeciesId.get(s.id) ?? []) {
      rows.push([
        s.id,
        item.url,
        "StillImage",
        inferImageFormat(item.url),
        item.creator ?? "",
        item.license ?? "",
        item.rightsHolder ?? "",
        "GBIF",
      ]);
    }
  }
  return tsvFile(MULTIMEDIA_COLUMNS, rows);
}

export function downloadTextFile(filename: string, contents: string, mimeType = "text/plain") {
  downloadBlob(filename, new Blob([contents], { type: mimeType }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Re-indents arbitrary well-formed XML for the package preview's "Preview"
 * tab. `buildEmlXml`/`buildMetaXml` (and user edits to either) produce
 * strings with inconsistent whitespace — conditional blocks that may emit
 * nothing, multi-line attribute lists — so this re-parses via `DOMParser`
 * and re-serializes from the resulting tree rather than regex-patching the
 * original string. Falls back to the original text if it doesn't parse
 * (e.g. invalid XML mid-edit).
 */
export function prettyPrintXml(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement) return xml;

    const serialize = (el: Element, depth: number): string => {
      const indent = "  ".repeat(depth);
      const attrs = Array.from(el.attributes)
        .map((a) => ` ${a.name}="${xmlEscape(a.value)}"`)
        .join("");
      const childNodes = Array.from(el.childNodes).filter(
        (n) => n.nodeType === 1 || (n.nodeType === 3 && (n.textContent ?? "").trim()),
      );
      if (childNodes.length === 0) return `${indent}<${el.tagName}${attrs}/>`;
      if (childNodes.length === 1 && childNodes[0].nodeType === 3) {
        return `${indent}<${el.tagName}${attrs}>${xmlEscape((childNodes[0].textContent ?? "").trim())}</${el.tagName}>`;
      }
      const inner = childNodes
        .filter((n): n is Element => n.nodeType === 1)
        .map((child) => serialize(child, depth + 1))
        .join("\n");
      return `${indent}<${el.tagName}${attrs}>\n${inner}\n${indent}</${el.tagName}>`;
    };

    return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(doc.documentElement, 0)}`;
  } catch {
    return xml;
  }
}

const LICENSE_URLS: Record<string, string> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/legalcode",
  "CC-BY-NC-4.0": "https://creativecommons.org/licenses/by-nc/4.0/legalcode",
};

/** Builds a minimal EML 2.1.1-shaped `eml.xml` describing the dataset for DwC-A publication. */
export function buildEmlXml(
  checklist: Checklist,
  metadata: ChecklistMetadata | null,
  contributors: ChecklistContributor[],
  regionBoundingBox: BoundingBox | null = null,
): string {
  const title = xmlEscape(checklist.title);
  const abstractParagraphs = (metadata?.abstract ?? "")
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<para>${xmlEscape(p)}</para>`)
    .join("\n        ");

  const keywordSet =
    (metadata?.keywords ?? []).length > 0
      ? `<keywordSet>\n${metadata!.keywords.map((k) => `        <keyword>${xmlEscape(k)}</keyword>`).join("\n")}\n      </keywordSet>`
      : "";

  // Creators/authors are the dataset's actual creators for citation purposes;
  // curators/reviewers contributed to the work but didn't author it, so they're
  // documented as associated parties with their role instead — dumping every
  // contributor into <creator> regardless of role misattributes authorship.
  const individualNameBlock = (c: ChecklistContributor) => `<individualName><surName>${xmlEscape(c.name)}</surName></individualName>
        ${c.institution ? `<organizationName>${xmlEscape(c.institution)}</organizationName>` : ""}
        ${c.email ? `<electronicMailAddress>${xmlEscape(c.email)}</electronicMailAddress>` : ""}
        ${c.orcid ? `<userId directory="https://orcid.org/">${xmlEscape(c.orcid)}</userId>` : ""}`;

  const creatorBlocks = contributors
    .filter((c) => c.role === "Creator" || c.role === "Author")
    .map((c) => `      <creator>\n        ${individualNameBlock(c)}\n      </creator>`)
    .join("\n");

  const associatedPartyBlocks = contributors
    .filter((c) => c.role === "Curator" || c.role === "Reviewer")
    .map(
      (c) => `      <associatedParty>
        ${individualNameBlock(c)}
        <role>${c.role.toLowerCase()}</role>
      </associatedParty>`,
    )
    .join("\n");

  const licenseUrl = metadata?.license ? LICENSE_URLS[metadata.license] : undefined;

  const pubDate = metadata?.gbif_publication_year
    ? `${metadata.gbif_publication_year}-01-01`
    : new Date().toISOString().slice(0, 10);

  const alternateIdentifier = metadata?.gbif_doi
    ? `<alternateIdentifier>${xmlEscape(metadata.gbif_doi)}</alternateIdentifier>\n`
    : "";

  // The official, GBIF-assigned citation only exists after IPT publication
  // (gbif_citation). Before that, give users citation guidance anyway —
  // per the guide's "specify precise citation guidance for users" practice
  // — computed from data already on hand (creators, title, version, year).
  const suggestedCitation = (() => {
    if (metadata?.gbif_citation) return null;
    const authorNames = contributors
      .filter((c) => c.role === "Creator" || c.role === "Author")
      .map((c) => c.name)
      .filter(Boolean);
    const year = metadata?.gbif_publication_year ?? new Date().getFullYear();
    const version = metadata?.dataset_version ? ` v${metadata.dataset_version}` : "";
    const authorsPart = authorNames.length > 0 ? `${authorNames.join(", ")} (${year}). ` : "";
    return `${authorsPart}${checklist.title}${version}. Checklist dataset.`;
  })();

  const additionalMetadataItems = [
    metadata?.dataset_version ? `<datasetVersion>${xmlEscape(metadata.dataset_version)}</datasetVersion>` : "",
    metadata?.gbif_citation
      ? `<citation>${xmlEscape(metadata.gbif_citation)}</citation>`
      : suggestedCitation
        ? `<citation>${xmlEscape(suggestedCitation)}</citation>`
        : "",
  ].filter(Boolean);
  const additionalMetadata =
    additionalMetadataItems.length > 0
      ? `<additionalMetadata>\n      <metadata>\n        ${additionalMetadataItems.join("\n        ")}\n      </metadata>\n    </additionalMetadata>`
      : "";

  // Computed by the caller from the checklist's real GADM/OSM region
  // boundary (see `boundingBoxFromGeometry`) — never hand-typed, since the
  // checklist is already scoped to a real administrative region.
  const boundingCoordinates = regionBoundingBox
    ? `\n        <boundingCoordinates>
          <westBoundingCoordinate>${regionBoundingBox.west}</westBoundingCoordinate>
          <eastBoundingCoordinate>${regionBoundingBox.east}</eastBoundingCoordinate>
          <northBoundingCoordinate>${regionBoundingBox.north}</northBoundingCoordinate>
          <southBoundingCoordinate>${regionBoundingBox.south}</southBoundingCoordinate>
        </boundingCoordinates>`
    : "";

  // Structured per-rank coverage, built from the checklist's own taxonomic
  // scope — wired in alongside the existing free-text description rather
  // than replacing it, since both are valid EML taxonomicCoverage content.
  const scopeRanks: [string, string | undefined][] = [
    ["kingdom", checklist.taxonomic_scope?.kingdom],
    ["phylum", checklist.taxonomic_scope?.phylum],
    ["class", checklist.taxonomic_scope?.class],
    ["order", checklist.taxonomic_scope?.order],
    ["family", checklist.taxonomic_scope?.family],
    ["genus", checklist.taxonomic_scope?.genus],
    ["species", checklist.taxonomic_scope?.species],
  ];
  const taxonomicClassification = scopeRanks
    .filter(([, rankValue]) => Boolean(rankValue))
    .map(
      ([rankName, rankValue]) => `        <taxonomicClassification>
          <taxonRankName>${xmlEscape(rankName)}</taxonRankName>
          <taxonRankValue>${xmlEscape(rankValue as string)}</taxonRankValue>
        </taxonomicClassification>`,
    )
    .join("\n");

  // GBIF requires a projectID in EML for datasets funded through a GBIF
  // programme (BID/BIFA/CESP) — "a GUID or other identifier that is near
  // globally unique... required for BID projects" (GBIF data quality
  // requirements for checklists). Most checklists aren't programme-funded,
  // so this only emits <project> when the metadata wizard's funding toggle
  // is on and an ID was actually entered.
  const projectBlock =
    metadata?.is_funded && metadata?.project_id
      ? `<project id="${xmlEscape(metadata.project_id)}">
      <title>${xmlEscape(metadata.project_title || checklist.title)}</title>
      ${metadata.funding_description ? `<funding><para>${xmlEscape(metadata.funding_description)}</para></funding>` : ""}
    </project>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         packageId="${checklist.id}/eml" system="http://gbif.org">
  <dataset>
    ${alternateIdentifier}<title>${title}</title>
${creatorBlocks}
${associatedPartyBlocks}
    <metadataProvider>
      <organizationName>${xmlEscape(metadata?.publishing_org_name ?? "")}</organizationName>
      ${metadata?.publishing_org_website ? `<onlineUrl>${xmlEscape(metadata.publishing_org_website)}</onlineUrl>` : ""}
    </metadataProvider>
    <pubDate>${pubDate}</pubDate>
    <language>${xmlEscape(metadata?.language ?? "English")}</language>
    <abstract>
        ${abstractParagraphs}
    </abstract>
    ${keywordSet}
    <intellectualRights>
      <para>${xmlEscape(metadata?.rights_statement ?? "")}</para>
      ${licenseUrl ? `<para>${licenseUrl}</para>` : ""}
    </intellectualRights>
    <coverage>
      <geographicCoverage>
        <geographicDescription>${xmlEscape(metadata?.geo_description ?? checklist.region_name ?? "")}</geographicDescription>${boundingCoordinates}
      </geographicCoverage>
      <temporalCoverage>
        ${
          metadata?.temporal_earliest_year && metadata?.temporal_latest_year
            ? `<rangeOfDates>
          <beginDate><calendarDate>${metadata.temporal_earliest_year}-01-01</calendarDate></beginDate>
          <endDate><calendarDate>${metadata.temporal_latest_year}-12-31</calendarDate></endDate>
        </rangeOfDates>`
            : ""
        }
      </temporalCoverage>
      <taxonomicCoverage>
        <generalTaxonomicCoverage>${xmlEscape(metadata?.taxonomic_scope_description ?? "")}</generalTaxonomicCoverage>
${taxonomicClassification}
      </taxonomicCoverage>
    </coverage>
    <contact>
      <organizationName>${xmlEscape(metadata?.publishing_org_name ?? "")}</organizationName>
      ${metadata?.resource_contact ? `<positionName>${xmlEscape(metadata.resource_contact)}</positionName>` : ""}
    </contact>
    <methods>
      <methodStep>
        <description><para>${xmlEscape(metadata?.methodology ?? "")}</para></description>
      </methodStep>
    </methods>
    ${projectBlock}
    ${additionalMetadata}
  </dataset>
</eml:eml>
`;
}

function firstText(parent: Element | Document, tagName: string): string | null {
  const el = parent.getElementsByTagName(tagName)[0];
  const text = el?.textContent?.trim();
  return text ? text : null;
}

function allText(parent: Element | Document, tagName: string): string[] {
  return Array.from(parent.getElementsByTagName(tagName))
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);
}

const KNOWN_LICENSE_URLS = new Set(Object.values(LICENSE_URLS));

/**
 * Best-effort inverse of `buildEmlXml` — extracts the same tags it emits
 * back into `ChecklistMetadata` fields, for the eml.xml Edit/Save flow in
 * `PublishPackagePage.tsx`. Deliberately does **not** parse
 * `<creator>`/`<associatedParty>` (contributors) or `<boundingCoordinates>`
 * (computed from real region geometry, not user text) — those only affect
 * the saved version's snapshot, not future regenerations. `DOMParser` is
 * browser-only, so this is client-side only (same as the rest of this
 * module's UI-facing helpers).
 */
export function parseEmlMetadataFields(xml: string): Partial<ChecklistMetadata> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("That XML couldn't be parsed — fix the syntax and try again.");
  }

  const fields: Partial<ChecklistMetadata> = {};

  const abstractParas = Array.from(doc.getElementsByTagName("abstract")[0]?.getElementsByTagName("para") ?? [])
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);
  if (abstractParas.length > 0) fields.abstract = abstractParas.join("\n\n");

  const keywords = allText(doc, "keyword");
  if (keywords.length > 0) fields.keywords = keywords;

  const language = firstText(doc, "language");
  if (language) fields.language = language;

  const rightsParas = Array.from(doc.getElementsByTagName("intellectualRights")[0]?.getElementsByTagName("para") ?? [])
    .map((el) => el.textContent?.trim() ?? "")
    .filter((text) => text && !KNOWN_LICENSE_URLS.has(text));
  if (rightsParas.length > 0) fields.rights_statement = rightsParas.join("\n\n");

  const geoDescription = firstText(doc, "geographicDescription");
  if (geoDescription) fields.geo_description = geoDescription;

  const beginYear = firstText(doc, "beginDate")?.slice(0, 4);
  const endYear = firstText(doc, "endDate")?.slice(0, 4);
  if (beginYear) fields.temporal_earliest_year = Number(beginYear);
  if (endYear) fields.temporal_latest_year = Number(endYear);

  const taxonomicScope = firstText(doc, "generalTaxonomicCoverage");
  if (taxonomicScope) fields.taxonomic_scope_description = taxonomicScope;

  const methodology = doc.getElementsByTagName("methodStep")[0]?.getElementsByTagName("para")[0]?.textContent?.trim();
  if (methodology) fields.methodology = methodology;

  const metadataProviderOrg = doc
    .getElementsByTagName("metadataProvider")[0]
    ?.getElementsByTagName("organizationName")[0]?.textContent?.trim();
  if (metadataProviderOrg) fields.publishing_org_name = metadataProviderOrg;

  const metadataProviderUrl = doc
    .getElementsByTagName("metadataProvider")[0]
    ?.getElementsByTagName("onlineUrl")[0]?.textContent?.trim();
  if (metadataProviderUrl) fields.publishing_org_website = metadataProviderUrl;

  const resourceContact = doc
    .getElementsByTagName("contact")[0]
    ?.getElementsByTagName("positionName")[0]?.textContent?.trim();
  if (resourceContact) fields.resource_contact = resourceContact;

  const projectEl = doc.getElementsByTagName("project")[0];
  if (projectEl) {
    fields.is_funded = true;
    const projectId = projectEl.getAttribute("id");
    if (projectId) fields.project_id = projectId;
    const projectTitle = projectEl.getElementsByTagName("title")[0]?.textContent?.trim();
    if (projectTitle) fields.project_title = projectTitle;
    const funding = projectEl.getElementsByTagName("funding")[0]?.getElementsByTagName("para")[0]?.textContent?.trim();
    if (funding) fields.funding_description = funding;
  }

  const datasetVersion = firstText(doc, "datasetVersion");
  if (datasetVersion) fields.dataset_version = datasetVersion;

  return fields;
}

interface ExtensionSpec {
  fileName: string;
  rowType: string;
  /** [columnName, termUri][], in file column order — column 0 is always the coreid (taxonID) link, not its own <field>. */
  fields: [string, string][];
}

const EXTENSIONS: ExtensionSpec[] = [
  {
    fileName: "vernacularname.txt",
    rowType: "http://rs.gbif.org/terms/1.0/VernacularName",
    fields: [
      ["vernacularName", "http://rs.tdwg.org/dwc/terms/vernacularName"],
      ["language", "http://purl.org/dc/terms/language"],
    ],
  },
  {
    fileName: "distribution.txt",
    rowType: "http://rs.gbif.org/terms/1.0/Distribution",
    fields: [
      ["locationID", "http://rs.tdwg.org/dwc/terms/locationID"],
      ["locality", "http://rs.tdwg.org/dwc/terms/locality"],
      ["country", "http://rs.tdwg.org/dwc/terms/country"],
      ["occurrenceStatus", "http://rs.tdwg.org/dwc/terms/occurrenceStatus"],
      ["source", "http://purl.org/dc/terms/source"],
    ],
  },
  {
    fileName: "resourcerelationship.txt",
    rowType: "http://rs.tdwg.org/dwc/terms/ResourceRelationship",
    fields: [
      ["resourceRelationshipID", "http://rs.tdwg.org/dwc/terms/resourceRelationshipID"],
      ["resourceID", "http://rs.tdwg.org/dwc/terms/resourceID"],
      ["relationshipOfResource", "http://rs.tdwg.org/dwc/terms/relationshipOfResource"],
      ["relatedResourceID", "http://rs.tdwg.org/dwc/terms/relatedResourceID"],
      ["relationshipAccordingTo", "http://rs.tdwg.org/dwc/terms/relationshipAccordingTo"],
      ["relationshipRemarks", "http://rs.tdwg.org/dwc/terms/relationshipRemarks"],
    ],
  },
  {
    fileName: "multimedia.txt",
    rowType: "http://rs.gbif.org/terms/1.0/Multimedia",
    fields: [
      ["identifier", "http://purl.org/dc/terms/identifier"],
      ["type", "http://purl.org/dc/terms/type"],
      ["format", "http://purl.org/dc/terms/format"],
      ["creator", "http://purl.org/dc/terms/creator"],
      ["license", "http://purl.org/dc/terms/license"],
      ["rightsHolder", "http://purl.org/dc/terms/rightsHolder"],
      ["source", "http://purl.org/dc/terms/source"],
    ],
  },
];

/** Builds the DwC-A `meta.xml` describing the archive's core file (taxon.txt) and every extension file's column mapping. */
export function buildMetaXml(): string {
  const coreFieldUris: Record<(typeof TAXON_COLUMNS)[number], string> = {
    taxonID: "http://rs.tdwg.org/dwc/terms/taxonID",
    scientificName: "http://rs.tdwg.org/dwc/terms/scientificName",
    scientificNameAuthorship: "http://rs.tdwg.org/dwc/terms/scientificNameAuthorship",
    namePublishedInYear: "http://rs.tdwg.org/dwc/terms/namePublishedInYear",
    taxonRank: "http://rs.tdwg.org/dwc/terms/taxonRank",
    taxonomicStatus: "http://rs.tdwg.org/dwc/terms/taxonomicStatus",
    nomenclaturalCode: "http://rs.tdwg.org/dwc/terms/nomenclaturalCode",
    kingdom: "http://rs.tdwg.org/dwc/terms/kingdom",
    phylum: "http://rs.tdwg.org/dwc/terms/phylum",
    class: "http://rs.tdwg.org/dwc/terms/class",
    order: "http://rs.tdwg.org/dwc/terms/order",
    family: "http://rs.tdwg.org/dwc/terms/family",
    genus: "http://rs.tdwg.org/dwc/terms/genus",
    vernacularName: "http://rs.tdwg.org/dwc/terms/vernacularName",
    modified: "http://purl.org/dc/terms/modified",
  };

  const coreFields = TAXON_COLUMNS.map(
    (col, index) => `    <field index="${index}" term="${coreFieldUris[col]}"/>`,
  ).join("\n");

  const extensionBlocks = EXTENSIONS.map((ext) => {
    const fields = ext.fields
      .map(([, termUri], i) => `      <field index="${i + 1}" term="${termUri}"/>`)
      .join("\n");
    return `  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="${ext.rowType}">
    <files>
      <location>${ext.fileName}</location>
    </files>
    <coreid index="0"/>
${fields}
  </extension>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Taxon">
    <files>
      <location>taxon.txt</location>
    </files>
    <id index="0"/>
${coreFields}
  </core>
${extensionBlocks}
</archive>
`;
}

export interface DwcaFile {
  name: string;
  contents: string;
}

export interface DwcaPackage {
  files: DwcaFile[];
  blob: Blob;
}

/**
 * Builds every DwC-A file's contents synchronously. `mediaBySpeciesId`
 * defaults to empty so callers can build (and let a reviewer start
 * browsing) the rest of the package immediately, then call this again with
 * the real media map once `packageMediaService.fetchSpeciesMediaMap`
 * resolves — multimedia.txt is the only file that depends on it.
 */
export function buildDwcaFiles(
  checklist: Checklist,
  metadata: ChecklistMetadata | null,
  contributors: ChecklistContributor[],
  species: Species[],
  mediaBySpeciesId: Map<string, SpeciesMediaItem[]> = new Map(),
  regionBoundingBox: BoundingBox | null = null,
): DwcaFile[] {
  return [
    { name: "taxon.txt", contents: buildTaxonFile(species) },
    { name: "vernacularname.txt", contents: buildVernacularNameFile(species) },
    { name: "distribution.txt", contents: buildDistributionFile(checklist, species) },
    { name: "resourcerelationship.txt", contents: buildResourceRelationshipFile(species) },
    { name: "multimedia.txt", contents: buildMultimediaFile(species, mediaBySpeciesId) },
    { name: "eml.xml", contents: buildEmlXml(checklist, metadata, contributors, regionBoundingBox) },
    { name: "meta.xml", contents: buildMetaXml() },
  ];
}

/** Zips a set of DwC-A files into the archive blob. */
export async function zipDwcaFiles(files: DwcaFile[]): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.contents);
  return zip.generateAsync({ type: "blob" });
}

/** Bundles taxon.txt + every extension file + eml.xml + meta.xml into a Darwin Core Archive zip in one call. */
export async function buildDwcaPackage(
  checklist: Checklist,
  metadata: ChecklistMetadata | null,
  contributors: ChecklistContributor[],
  species: Species[],
  mediaBySpeciesId: Map<string, SpeciesMediaItem[]>,
  regionBoundingBox: BoundingBox | null = null,
): Promise<DwcaPackage> {
  const files = buildDwcaFiles(checklist, metadata, contributors, species, mediaBySpeciesId, regionBoundingBox);
  const blob = await zipDwcaFiles(files);
  return { files, blob };
}
