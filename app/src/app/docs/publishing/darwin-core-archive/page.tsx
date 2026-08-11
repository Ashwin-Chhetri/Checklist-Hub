import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";

export const metadata: Metadata = {
  title: "Darwin Core, IPT & GBIF — Docs",
  description:
    "What a GBIF checklist is, and the step-by-step walkthrough for packaging a validated checklist as a Darwin Core Archive and publishing it to GBIF through an IPT.",
  alternates: { canonical: "/docs/publishing/darwin-core-archive" },
};

export default function DarwinCoreArchivePage() {
  return (
    <>
      <section id="gbif" className="py-6 md:py-8 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
          GBIF checklists
        </h2>
        <div className="space-y-4 font-body-sm text-body-sm text-secondary">
          <p>
            A GBIF checklist is a <Highlight>dataset type</Highlight> on{" "}
            <a
              href="https://www.gbif.org"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              GBIF
            </a>{" "}
            (the Global Biodiversity Information Facility) — one of four kinds of dataset
            GBIF recognizes, alongside occurrence, sampling-event, and metadata-only
            datasets. Where an occurrence dataset records individual sightings or
            specimens, a checklist records <Highlight>which taxa are known to occur</Highlight>{" "}
            in a region or taxonomic group, each backed by a taxonomic concept rather than
            a single observation.
          </p>
          <p>
            Once published through a GBIF-registered{" "}
            <Highlight>IPT (Integrated Publishing Toolkit)</Highlight>, a checklist gets
            its own GBIF dataset page, a persistent DOI, and becomes queryable alongside
            every other checklist on GBIF — which is what lets reconciliation tools (like
            Checklist Hub&apos;s own Reconciliation view) compare one region&apos;s
            checklist against another&apos;s.
          </p>
        </div>
      </section>

      <section id="darwin-core" className="py-10 md:py-12 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
          Darwin Core Archive
        </h2>
        <div className="space-y-4 font-body-sm text-body-sm text-secondary mb-6">
          <p>
            Structurally, a checklist is published as a{" "}
            <Highlight>Darwin Core Archive</Highlight> built around a Taxon core file —
            one row per accepted name, with fields like scientific name, taxonomic rank,
            and accepted-name usage — plus optional extensions such as Distribution,
            VernacularName, or Species Profile that add region-specific occurrence status,
            common names, or ecological attributes to each taxon.
          </p>
          <p>
            Publishing a Darwin Core Archive (DwC-A) to GBIF means packaging your
            validated checklist into this standard exchange format and submitting it
            through an <Highlight>IPT</Highlight> — GBIF doesn&apos;t accept checklist
            uploads directly, since the IPT is what registers the dataset, assigns it a
            DOI, and keeps it re-harvestable whenever you publish an update.
          </p>
        </div>
        <ol className="space-y-4">
          <li className="flex gap-4 items-start">
            <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
              1
            </span>
            <div>
              <span className="font-bold text-on-surface">Get the checklist review-ready</span>
              <span className="text-secondary font-body-sm text-body-sm">
                {" "}
                — every species needs at least one reviewer&apos;s sign-off and no open
                taxonomy conflicts. Checklist Hub&apos;s{" "}
                <Link
                  href="/docs/getting-started/validate-species"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  Review species
                </Link>{" "}
                step blocks you here until that&apos;s true.
              </span>
            </div>
          </li>
          <li className="flex gap-4 items-start">
            <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
              2
            </span>
            <div>
              <span className="font-bold text-on-surface">Fill in dataset metadata</span>
              <span className="text-secondary font-body-sm text-body-sm">
                {" "}
                — title, description, contributors, and a license (GBIF requires CC0,
                CC-BY, or CC-BY-NC). Checklist Hub&apos;s{" "}
                <Link
                  href="/docs/getting-started/define-metadata"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  Define Metadata
                </Link>{" "}
                step collects this before generating the package — dataset summary,
                source counts, and the classification breakdown are filled in for you
                from the Workbench data already gathered.
              </span>
            </div>
          </li>
          <li className="flex gap-4 items-start">
            <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
              3
            </span>
            <div>
              <span className="font-bold text-on-surface">Generate the Darwin Core Archive</span>
              <span className="text-secondary font-body-sm text-body-sm">
                {" "}
                — Checklist Hub builds the Taxon core file, extensions like
                vernacularname.txt and multimedia.txt, plus <Highlight>meta.xml</Highlight>{" "}
                and <Highlight>eml.xml</Highlight> automatically and packages them into a
                single zip, previewed in the{" "}
                <Link
                  href="/docs/getting-started/darwin-core-format"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  Darwin Core Format
                </Link>{" "}
                step before you download it.
              </span>
            </div>
          </li>
        </ol>
      </section>

      <section id="ipt" className="py-10 md:py-12">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
          IPT
        </h2>
        <div className="space-y-4 font-body-sm text-body-sm text-secondary mb-6">
          <p>
            Either your institution&apos;s own IPT installation, or one run by a
            publishing partner (a national GBIF participant node, museum, or
            university). If you don&apos;t have one yet, GBIF&apos;s{" "}
            <a
              href="https://www.gbif.org/ipt"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              IPT page
            </a>{" "}
            explains how to request access through your country&apos;s GBIF node.
          </p>
        </div>
        <ol className="space-y-4" start={4}>
          <li className="flex gap-4 items-start">
            <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
              4
            </span>
            <div>
              <span className="font-bold text-on-surface">Get access to a GBIF-registered IPT</span>
            </div>
          </li>
          <li className="flex gap-4 items-start">
            <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
              5
            </span>
            <div>
              <span className="font-bold text-on-surface">Upload it to the IPT and register</span>
              <span className="text-secondary font-body-sm text-body-sm">
                {" "}
                — in{" "}
                <Link
                  href="/docs/getting-started/publish-to-gbif"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  Publish to GBIF
                </Link>
                , pick the publisher org and installation, download the package, and
                upload it as a resource on that IPT. The IPT publishes it, GBIF
                harvests it, and it&apos;s assigned a dataset key and DOI.
              </span>
            </div>
          </li>
          <li className="flex gap-4 items-start">
            <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
              6
            </span>
            <div>
              <span className="font-bold text-on-surface">Paste the published URL back</span>
              <span className="text-secondary font-body-sm text-body-sm">
                {" "}
                — this marks the checklist <Highlight>Published</Highlight> in Checklist
                Hub and records the DOI/citation against it for good.
              </span>
            </div>
          </li>
        </ol>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: "How to Publish a Darwin Core Archive to GBIF",
            description:
              "Step-by-step guide to packaging a validated species checklist as a Darwin Core Archive and publishing it to GBIF through an IPT.",
            author: { "@id": "https://checklisthub.in/#founder" },
            publisher: { "@id": "https://checklisthub.in/#organization" },
            datePublished: "2026-07-04",
            dateModified: "2026-08-10",
            mainEntityOfPage: "https://checklisthub.in/docs/publishing/darwin-core-archive",
          }),
        }}
      />
    </>
  );
}
