import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsStepNav from "@/components/docs/DocsStepNav";
import DocsStepWalkthrough from "@/components/docs/DocsStepWalkthrough";

export const metadata: Metadata = {
  title: "Import data — Docs",
  description:
    "Bring species data into a checklist by file upload or automatic discovery — CSV, TSV, JSON, Excel, and the Deep Literature Search pipeline.",
  alternates: { canonical: "/docs/getting-started/import-data" },
};

export default function ImportDataPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Import data
      </h2>
      <DocsBreadcrumb items={["Checklists", "New", "Import"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Checklist Hub pulls species in from three kinds of sources at once, and merges
        them into a single list. Click through the literature sub-steps below to see each
        stage of the pipeline.
      </p>

      <DocsStepWalkthrough
        hint="Click a step below to see it highlighted in the screenshot."
        defaultScreen={{
          src: "/res/docs/checklist-step-2.png",
          alt: "The Import step showing aggregated species counts from GBIF, eBird, and iNaturalist plus a CSV upload area",
          aspect: "1391 / 1484",
        }}
        steps={[
          {
            title: "Global occurrence data",
            target: { x: 94, y: 31 },
            body: (
              <>
                As soon as the taxonomic scope and region are set, evidence is{" "}
                <Highlight>fetched automatically</Highlight> from{" "}
                <Highlight>GBIF</Highlight>, <Highlight>iNaturalist</Highlight>, and{" "}
                <Highlight>eBird</Highlight> — the repositories Checklist Hub currently
                supports — no upload needed.
              </>
            ),
            screen: {
              src: "/res/docs/checklist-step-2.png",
              alt: "The Import step showing aggregated species counts from GBIF, eBird, and iNaturalist",
              aspect: "1391 / 1484",
            },
          },
          {
            title: "Field data",
            target: { x: 94, y: 61 },
            body: (
              <>
                Manually collected field data can also be uploaded — drop a{" "}
                <Highlight>CSV, TSV, JSON, or Excel</Highlight> species list into the
                upload box, or skip the file entirely. Columns should be organized as:{" "}
                <Highlight>Scientific Name</Highlight> (required), plus{" "}
                <Highlight>Common Name</Highlight>, <Highlight>Occurrence Count</Highlight>,
                and <Highlight>Event Date</Highlight> if available — all optional, and
                matched automatically by column header.
              </>
            ),
            screen: {
              src: "/res/docs/checklist-step-2.png",
              alt: "The Import step showing a CSV upload area for manually collected field data",
              aspect: "1391 / 1484",
            },
          },
          {
            title: "Literature pipeline",
            target: { x: 94, y: 59 },
            body: "Deep Literature Search finds, ranks, and extracts a species list from published sources, in three stages:",
            screen: {
              src: "/res/docs/checklist-step-2-literature.png",
              alt: "Deep Literature Search pipeline in progress: starting pipeline, discovering literature, extracting species list, mapping to backbone",
              aspect: "1405 / 1518",
            },
            subSteps: [
              {
                title: "Discover literature",
                target: { x: 94, y: 55 },
                body: (
                  <>
                    Searches the web for documents that are strictly{" "}
                    <Highlight>taxon and region specific</Highlight> to the checklist. If
                    you already have a paper in mind, you can add literature manually
                    instead of waiting on discovery.
                  </>
                ),
                screen: {
                  src: "/res/docs/checklist-step-2-literature.png",
                  alt: "Deep Literature Search pipeline in progress: starting pipeline, discovering literature, extracting species list, mapping to backbone",
                  aspect: "1405 / 1518",
                },
              },
              {
                title: "Rank literature",
                target: { x: 11, y: 31 },
                body: (
                  <>
                    Every discovered source is scored from{" "}
                    <Highlight>100 down to 75</Highlight> based on how relevant it is to
                    the checklist&apos;s taxon and region.
                  </>
                ),
                screen: {
                  src: "/res/docs/checklist-step-2-literature-2.png",
                  alt: "Deep Literature Search results showing scored, citable sources with an option to remove any that don't belong",
                  aspect: "1375 / 1610",
                },
              },
              {
                title: "Extract species",
                target: { x: 94, y: 92 },
                body: (
                  <>
                    Sources scored <Highlight>75 and above</Highlight> are used to extract
                    a species list straight from the papers.
                  </>
                ),
                screen: {
                  src: "/res/docs/checklist-step-2-literature-2.png",
                  alt: "Deep Literature Search results showing scored, citable sources with an option to remove any that don't belong",
                  aspect: "1375 / 1610",
                },
              },
            ],
          },
        ]}
      />

      <p className="font-body-sm text-body-sm text-secondary mt-10">
        Names from every source are checked against the GBIF Backbone and Catalogue of
        Life as they come in, with synonyms resolved automatically. Imported and
        discovered species land together in the same merged list, ready for the{" "}
        <Link
          href="/docs/getting-started/validate-species"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          Review step
        </Link>
        .
      </p>
      <DocsStepNav
        back={{ href: "/docs/getting-started/define-scope", label: "Define scope and taxa" }}
        next={{ href: "/docs/getting-started/validate-species", label: "Review the checklist" }}
      />
    </section>
  );
}
