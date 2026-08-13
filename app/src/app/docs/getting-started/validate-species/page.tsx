import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsFieldWalkthrough from "@/components/docs/DocsFieldWalkthrough";
import DocsStepNav from "@/components/docs/DocsStepNav";

export const metadata: Metadata = {
  title: "Review species — Docs",
  description:
    "Review the merged species list on the Workbench, discuss and vote on conflicts, and accept or reject with at least one reviewer.",
  alternates: { canonical: "/docs/getting-started/validate-species" },
};

export default function ValidateSpeciesPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Review species
      </h2>
      <DocsBreadcrumb items={["Checklists", "New", "Validate"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Review the merged species list before committing to it: filter by family or
        source, switch between list and chart views, and see the taxonomic composition at
        a glance.
      </p>
      <DocsFieldWalkthrough
        hint="Click a step below to see it highlighted in the screenshot."
        screen={{
          src: "/res/docs/checklist-step-3.png",
          alt: "The Validate step showing a family breakdown pie chart and a filterable species table",
          variant: "dialog",
          aspect: "703 / 872",
        }}
        steps={[
          {
            title: "Overview",
            target: { x: 25, y: 25 },
            body: (
              <>
                See every species pulled into the checklist so far, merged from all
                sources — <Highlight>field data, GBIF, eBird, iNaturalist</Highlight>,
                and literature — into one list.
              </>
            ),
          },
          {
            title: "Pie chart or table",
            target: { x: 92, y: 44 },
            body: (
              <>
                Switch between a family-breakdown pie chart and a filterable table, and
                filter either view by <Highlight>source</Highlight> to see what each one
                contributed.
              </>
            ),
          },
        ]}
      />
      <h3 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest mb-3 mt-10">
        Verify each species
      </h3>
      <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
        <li>
          Resolve synonyms in one click: correct or confirm a name straight
          from the row, and Checklist Hub checks it against the GBIF
          backbone as you type. If the name matches one already in the
          checklist, saving merges the two rows automatically. See{" "}
          <Link
            href="/docs/features/workbench"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            Features → Workbench
          </Link>{" "}
          for how merging works.
        </li>
        <li>
          Verify the evidence: every occurrence claim has a map and a source
          count behind it, one click away. See{" "}
          <Link
            href="/docs/features/evidence"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            Features → Evidence
          </Link>
          .
        </li>
        <li>
          Raise anything unclear by pinging a collaborator right on that
          species&apos; discussion thread instead of a separate email chain.
          See{" "}
          <Link
            href="/docs/features/collaboration"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            Features → Collaboration
          </Link>
          .
        </li>
        <li>
          Once every species carries a decision (accepted, rejected, or
          merged), the checklist is ready to move forward.
        </li>
      </ul>
      <DocsStepNav
        back={{ href: "/docs/getting-started/import-data", label: "Import data" }}
        next={{ href: "/docs/getting-started/collaborate", label: "Collaborate" }}
      />
    </section>
  );
}
