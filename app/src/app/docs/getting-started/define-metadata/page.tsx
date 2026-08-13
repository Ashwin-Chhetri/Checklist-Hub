import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsFieldWalkthrough from "@/components/docs/DocsFieldWalkthrough";
import DocsStepNav from "@/components/docs/DocsStepNav";

export const metadata: Metadata = {
  title: "Define Metadata — Docs",
  description:
    "Fill in the checklist's dataset metadata before publishing — what you have to define by hand, and what Checklist Hub already fills in from the Workbench.",
  alternates: { canonical: "/docs/getting-started/define-metadata" },
};

export default function DefineMetadataPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Define Metadata
      </h2>
      <DocsBreadcrumb items={["Checklists", "New", "Metadata"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Before a checklist can be packaged for GBIF, it needs metadata: the descriptive
        information a reader, or GBIF itself, sees before ever opening the species list.
      </p>
      <DocsFieldWalkthrough
        hint="Click a step below to see it highlighted in the screenshot."
        screen={{
          src: "/res/docs/meta-data.PNG",
          alt: "The Checklist Summary screen, listing dataset summary, geographic scope, historical comparison, source summary, and checklist metadata fields",
          variant: "full",
          aspect: "1888 / 950",
        }}
        steps={[
          {
            title: "What you fill in",
            target: { x: 11, y: 34 },
            body: (
              <>
                Dataset info (title, abstract), temporal coverage, geographic
                coverage, taxonomic coverage, methods, contributors, publishing
                organization, and funding &amp; support.
              </>
            ),
          },
          {
            title: "What's already filled in",
            target: { x: 98, y: 33 },
            body: (
              <>
                Species, family, order, and genera counts, the source-by-source
                record totals, and the classification breakdown are pulled straight
                from the data you&apos;ve already gathered on the{" "}
                <Highlight>Workbench</Highlight> — you&apos;re reviewing them, not
                typing them in.
              </>
            ),
          },
          {
            title: "Completion tracked live",
            target: { x: 10, y: 93 },
            body: "The sidebar checklist (Title Complete, Abstract Provided, Taxonomy Scope, Geography Set, Temporal Valid, Authors Added) flips to Ready only once every required field is in place.",
          },
        ]}
      />
      <h3 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest mb-3 mt-10">
        What each section covers
      </h3>
      <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
        <li>
          <Highlight>Dataset Summary</Highlight> — species, family, order, and genera
          counts, computed from the checklist itself.
        </li>
        <li>
          <Highlight>Geographic Scope</Highlight> — the region the checklist covers,
          carried over from when the checklist was first defined.
        </li>
        <li>
          <Highlight>Historical Comparison</Highlight> — a link to a previous
          publication of the same checklist, if one exists, so a reviewer can see
          what changed.
        </li>
        <li>
          <Highlight>Source Summary</Highlight> — a record count per source (GBIF,
          eBird, iNaturalist, and any others used), tallied automatically.
        </li>
        <li>
          <Highlight>Checklist Metadata</Highlight> — dataset info, temporal
          coverage, geographic coverage, taxonomic coverage, methods, contributors,
          publishing organization, and funding &amp; support. These are the fields
          you fill in directly.
        </li>
      </ul>
      <DocsStepNav
        back={{ href: "/docs/getting-started/workbench", label: "Workbench" }}
        next={{ href: "/docs/getting-started/darwin-core-format", label: "Darwin Core Format" }}
      />
    </section>
  );
}
