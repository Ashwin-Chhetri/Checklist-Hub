import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terminology — Docs",
  description:
    "Glossary of terms used throughout Checklist Hub's docs — dataset, decision record, Darwin Core Archive, IPT, DOI, evidence strength, and more.",
  alternates: { canonical: "/docs/reference/terminology" },
};

const terms = [
  {
    term: "Checklist",
    def: "The definitive, evidence-backed list of species known from a region or taxon group.",
  },
  {
    term: "Dataset",
    def: "GBIF's term for a published checklist — a structured, citable snapshot of species occurrence that other tools and researchers can query and build on.",
  },
  {
    term: "Publisher",
    def: "The GBIF-endorsed organization or individual credited as a dataset's point of contact — every checklist needs one attached before GBIF will register it.",
  },
  {
    term: "Publishing Partner",
    def: "A publisher that runs its own IPT and is willing to host datasets it didn't create itself — typically a national GBIF node, museum, or university. Useful if your own organization isn't endorsed or doesn't run an IPT yet.",
  },
  {
    term: "Decision record",
    def: "How Checklist Hub treats a species entry — identity, taxonomy, evidence, review history, and discussion all attached to it, rather than a bare spreadsheet row.",
  },
  {
    term: "Darwin Core Archive (DwC-A)",
    def: "The standard exchange format a checklist is published in — a Taxon core file (one row per accepted name) plus optional extensions like Distribution, VernacularName, or Species Profile.",
  },
  {
    term: "IPT (Integrated Publishing Toolkit)",
    def: "The GBIF-registered tool a Darwin Core Archive is uploaded to for publication — it registers the dataset, assigns it a DOI, and keeps it re-harvestable on future updates.",
  },
  {
    term: "DOI",
    def: "The persistent, citable identifier a checklist is assigned once published and registered through an IPT.",
  },
  {
    term: "Evidence strength",
    def: "A Low / Medium / High score for a species, derived from the number of occurrence records and publications linked to it inside the checklist's region.",
  },
  {
    term: "Reconciliation",
    def: "Comparing a checklist's species against other published checklists for the same region or taxon group to surface conflicts.",
  },
  {
    term: "Watcher",
    def: "A scheduled process that re-fetches occurrences from GBIF, iNaturalist, and eBird for an active checklist and surfaces genuinely new candidates for review.",
  },
  {
    term: "Synonym",
    def: "An alternate name for a taxon that GBIF Backbone / Catalogue of Life resolve to a single accepted name during import.",
  },
];

export default function TerminologyPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
        Terminology
      </h2>
      <dl className="space-y-6">
        {terms.map(({ term, def }) => {
          const slug = term
            .toLowerCase()
            .replace(/[()]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");
          return (
            <div key={term} id={slug} className="border border-outline-variant bg-white p-lg scroll-mt-24">
              <dt className="font-bold text-on-surface mb-2">{term}</dt>
              <dd className="font-body-sm text-body-sm text-secondary">{def}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
