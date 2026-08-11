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
    body: "Workbench, Evidence, Reconciliation, Watcher, Export, History, and Collaboration.",
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
          Why Checklist Hub?
        </h2>
        <div className="space-y-4 font-body-sm text-body-sm text-secondary">
          <p>
            GBIF hosts more than one kind of dataset, including checklists and occurrence
            datasets. An occurrence dataset is a collection of individual sightings pulled from
            open sources, and on its own it isn&apos;t enough to say a species belongs on a
            region&apos;s list. Occurrence records can carry errors: a misidentified species, an
            incorrect taxonomic classification, wrong coordinates, or a simple data-entry
            mistake. Confirming that a species is actually present takes expert review of the
            evidence behind each occurrence, not just the occurrence itself.
          </p>
          <p>
            Most published checklists come out of biodiversity hotspots, regions with enough
            attention and funding to support that kind of sustained work. Plenty of other regions
            carry similar biodiversity but have never had a checklist built for them, so what
            lives there stays undocumented. Citizen science platforms are now generating records
            from many of these regions, often faster than anyone is turning them into a
            checklist. Checklist Hub is built to close that gap, making it easier to take those
            records and turn them into a published checklist for a region that has not had one
            before.
          </p>
          <p>
            Building a checklist has traditionally been tedious. You gather occurrence records
            from{" "}
            <a
              href="https://www.gbif.org"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              GBIF
            </a>
            , sightings from{" "}
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
            </a>
            , and mentions in literature, and pull them into one place by hand. You check each
            name against a taxonomic authority and resolve synonyms one at a time. Once you have
            a draft list, you share it with collaborators for review, usually back and forth over
            email or spreadsheets, with no single record of who approved what. And at the end,
            you still have to convert the list into a Darwin Core Archive, the format GBIF
            requires, attach the right metadata, and publish it to GBIF.
          </p>
          <p>Checklist Hub is built to take on each of those steps:</p>
          <ul className="space-y-3 list-disc pl-5">
            <li>
              Every name you import is checked against the GBIF Backbone and Catalogue of Life,
              with synonyms resolved automatically.
            </li>
            <li>
              Evidence for each species is gathered in one place, from GBIF, iNaturalist, eBird,
              and literature, instead of across separate tabs you&apos;d otherwise cross-reference
              by hand.
            </li>
            <li>
              Reviewers work on the same list together. Nothing reaches the checklist without{" "}
              <Highlight>at least one qualified reviewer</Highlight> signing off, and every
              decision is logged with who made it and when.
            </li>
            <li>
              Reconciliation checks your checklist against other published checklists for the
              same region or taxon, so conflicts surface before publication.
            </li>
            <li>
              When you&apos;re ready to publish, Checklist Hub generates a compliant Darwin Core
              Archive, with metadata included, and walks you through submitting it to a
              GBIF-registered IPT.
            </li>
          </ul>
          <div className="border border-outline-variant bg-surface-container-low p-lg">
            <p>
              Citizen science has grown large enough that a species new to a region can turn up
              between one publication and the next. The{" "}
              <Highlight>Watcher</Highlight> module tracks sources on a schedule after
              publication and alerts experts when a new sighting suggests a species should be
              added to the list.
            </p>
          </div>
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
