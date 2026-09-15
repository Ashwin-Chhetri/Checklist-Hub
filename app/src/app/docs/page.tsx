import type { Metadata } from "next";
import Link from "next/link";
import LegacyAnchorRedirect from "@/components/docs/LegacyAnchorRedirect";
import Highlight from "@/components/docs/Highlight";

export const metadata: Metadata = {
  title: "Docs — How Checklist Hub Works",
  description:
    "How to create, validate, review, and publish a species checklist with Checklist Hub — import, taxonomy validation, the Workbench, the Watcher, collaboration, and Darwin Core / IPT publishing.",
  alternates: { canonical: "/docs" },
};

const steps = [
  {
    number: "01",
    title: "Import & Validate",
    body: "Upload a CSV or run a discovery search. Names are checked against the GBIF Backbone and Catalogue of Life, synonyms resolved automatically.",
  },
  {
    number: "02",
    title: "Gather Evidence & Reconcile",
    body: "Evidence is pulled from GBIF, iNaturalist, eBird, and literature, deduplicated, and compared against other checklists for conflicts.",
  },
  {
    number: "03",
    title: "Review & Collaborate",
    body: "Experts work the Workbench together — comment, discuss, vote. Nothing is accepted without at least one reviewer.",
  },
  {
    number: "04",
    title: "Publish",
    body: "Run readiness checks, generate the Darwin Core package, and publish through a GBIF-registered IPT.",
  },
];

const groups = [
  {
    title: "Getting Started",
    body: "Create your first checklist, import data, validate species, and publish to GBIF.",
    href: "/docs/getting-started/what-is-checklist-hub",
  },
  {
    title: "Features",
    body: "Workbench, Evidence, Reconciliation, Watcher, Export, History, Collaboration, and AI MCP & Chat Box.",
    href: "/docs/features/workbench",
  },
  {
    title: "Publishing",
    body: "Darwin Core, IPT, GBIF, and troubleshooting common publish blockers.",
    href: "/docs/publishing/darwin-core-archive",
  },
  {
    title: "Reference",
    body: "FAQ, terminology, and how to cite Checklist Hub.",
    href: "/docs/reference/faq",
  },
];

export default function DocsIndexPage() {
  return (
    <>
      <LegacyAnchorRedirect />

      <section className="py-6 md:py-8 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-6">
          Overview
        </h2>
        <div className="space-y-4 font-body-sm text-body-sm text-secondary">
          <p>
            Have you ever wondered exactly which butterflies, birds, or reptiles live in your
            region?
          </p>
          <p>
            The list of species found in a region or taxon group is called a{" "}
            <Highlight>checklist</Highlight>.{" "}
            <a
              href="https://www.gbif.org"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              GBIF
            </a>{" "}
            calls a published checklist a <Highlight>dataset</Highlight>.
          </p>
          <p>
            A checklist doesn&apos;t create itself. A group of experts comes together and
            collects every species ever recorded in the region: combing through open-source
            datasets, literature, historical records, and present-day records, and running field
            surveys to confirm what&apos;s still there. From that work, they build a curated list
            of species found in the region and publish it to a global repository.
          </p>
          <p>
            Start with{" "}
            <Link href="/docs/getting-started/what-is-checklist-hub" className="text-primary underline underline-offset-2 hover:opacity-80">
              What is Checklist Hub?
            </Link>{" "}
            or jump straight into a section below.
          </p>
        </div>
      </section>

      <section className="py-10 md:py-12 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
          Why do we need it?
        </h2>
        <div className="space-y-4 font-body-sm text-body-sm text-secondary">
          <p className="font-semibold">For biodiversity experts</p>
          <p>
            Taxonomy doesn&apos;t hold still, and citizen science doesn&apos;t either. The{" "}
            <a
              href="https://www.gbif.org"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              GBIF Backbone
            </a>{" "}
            and Catalogue of Life are revised on an ongoing basis, and platforms like{" "}
            <a
              href="https://www.inaturalist.org"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              iNaturalist
            </a>{" "}
            and{" "}
            <a
              href="https://ebird.org"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              eBird
            </a>{" "}
            add new observations continuously. Keeping an existing checklist accurate means
            re-checking it against both, over and over — chasing down which names have been
            resynonymized, which species now have supporting records they didn&apos;t have last
            year, and which new candidates a citizen science platform has surfaced. Done by hand
            across hundreds of species, that&apos;s slow, repetitive, and easy to get wrong.
            Checklist Hub automates the checking — taxonomy validation, synonym resolution,
            evidence gathering, and change detection — so an expert reviewer spends their time on
            the judgment calls a machine shouldn&apos;t make, not on the busywork of finding what
            changed.
          </p>
          <p className="font-semibold">For GBIF</p>
          <ul className="space-y-3 list-disc pl-5">
            <li>
              <Highlight>Cleaner data arrives in the index.</Highlight> Every species is validated
              against GBIF Backbone / Catalogue of Life and checked for synonym conflicts before
              an expert can accept it, and a checklist is reconciled against other checklists to
              surface overlaps before publication. The Darwin Core Archives that reach GBIF arrive
              with fewer errors and duplicates, which means less manual curation on GBIF&apos;s
              side after the fact.
            </li>
            <li>
              <Highlight>More regional data actually gets published.</Highlight> Many
              taxonomists, park authorities, and conservation planners hold valuable checklists
              that never reach GBIF because building a compliant Darwin Core Archive and standing
              up an IPT is a real technical barrier. Checklist Hub generates the DwC-A
              automatically and publishes through a nearby GBIF-registered IPT, turning
              checklists that would otherwise sit in a spreadsheet into published GBIF datasets.
            </li>
            <li>
              <Highlight>Published checklists stay current instead of going stale.</Highlight> The{" "}
              <Highlight>Watcher</Highlight> re-fetches GBIF, iNaturalist, and eBird on a schedule
              for active checklists and surfaces new candidate species and records over time, with
              every change waiting on a reviewer&apos;s confirmation. A dataset published through
              Checklist Hub doesn&apos;t need a from-scratch resurvey a year later to stay
              accurate — it keeps getting maintained.
            </li>
          </ul>
        </div>
      </section>

      <section className="py-10 md:py-12 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
          How it works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
          {steps.map((step) => (
            <div key={step.number} className="border border-outline-variant bg-white p-lg">
              <span className="font-headline-md text-[28px] font-extrabold text-primary opacity-80">
                {step.number}
              </span>
              <h3 className="font-headline-md text-[16px] uppercase tracking-tight mt-2 mb-2">
                {step.title}
              </h3>
              <p className="font-body-sm text-body-sm text-secondary">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-10 md:py-12">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
          Explore the docs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
          {groups.map((group) => (
            <Link
              key={group.title}
              href={group.href}
              className="border border-outline-variant bg-white p-lg hover:border-primary transition-colors"
            >
              <h3 className="font-headline-md text-[16px] uppercase tracking-tight mb-2">
                {group.title}
              </h3>
              <p className="font-body-sm text-body-sm text-secondary">{group.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
