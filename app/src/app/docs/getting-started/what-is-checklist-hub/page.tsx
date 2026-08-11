import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import ChecklistHubIcon from "@/components/docs/ChecklistHubIcon";

export const metadata: Metadata = {
  title: "What is Checklist Hub? — Docs",
  description:
    "Checklist Hub is a platform for biodiversity experts to build a species checklist together, in one workspace, from import to publication.",
  alternates: { canonical: "/docs/getting-started/what-is-checklist-hub" },
};

export default function WhatIsChecklistHubPage() {
  return (
    <section className="py-6 md:py-8">
      <div className="flex items-center gap-3 mb-6">
        <ChecklistHubIcon size={56} />
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight">
          What is Checklist Hub?
        </h2>
      </div>
      <div className="space-y-4 font-body-sm text-body-sm text-secondary">
        <p>
          Checklist Hub is a platform for the people who already work with GBIF data:
          taxonomists, park authorities, conservation planners, and researchers who
          need a checklist for a region or taxon group. It gives you and your
          reviewers a <Highlight>shared platform</Highlight> to build that checklist
          together, instead of pulling records from one database, checking names in
          another, and emailing evidence back and forth.
        </p>
        <p>
          Raw occurrence data alone isn&apos;t enough to say a species belongs on a
          region&apos;s list; confirming that takes expert review of the evidence behind it,
          which is exactly the work Checklist Hub is built for.
        </p>
        <p>
          Right now, building a checklist means visiting several databases and
          literature sources one at a time, tracking down every expert who needs to
          sign off on a name, and stitching the result together yourself. Checklist
          Hub puts that whole process in <Highlight>one workspace</Highlight>, from
          the first name you import to the moment it&apos;s published.
        </p>
        <p>It can:</p>
        <ul className="space-y-3 list-disc pl-5">
          <li>Find synonyms for a name and recommend the currently accepted one.</li>
          <li>
            Search existing biodiversity databases and pull together every species
            already recorded in the region.
          </li>
          <li>Find the right literature on the internet and extract the species list straight from it.</li>
          <li>
            Let you collaborate in real time: bring in any expert and tag them
            directly on a species in the checklist.
          </li>
          <li>
            Compare your checklist against other published checklists for the same
            region or taxon, and flag conflicts before you publish.
          </li>
          <li>
            Watch a published checklist for new sightings and alert you when a
            species should be added.
          </li>
          <li>
            Generate the <Highlight>Darwin Core Archive</Highlight> and walk you
            through submitting it to a GBIF-registered IPT.
          </li>
        </ul>
      </div>

      <div className="mt-10">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="font-headline-md text-[16px] uppercase tracking-tight">
            AI integration
          </h3>
          <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider border border-outline-variant px-1.5 py-0.5">
            Ongoing work
          </span>
        </div>
        <p className="font-body-sm text-body-sm text-secondary">
          Checklist Hub is adding support for MCP (Model Context Protocol), so you&apos;ll be
          able to connect your checklist to AI agents like ChatGPT or Claude Code and work with
          your checklist data directly from there.
        </p>
      </div>

      <div className="mt-6 border border-outline-variant bg-surface-container-low p-md flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
            Reference
          </p>
          <p className="font-body-sm text-body-sm text-secondary">
            GBIF (Global Biodiversity Information Facility) is the network Checklist Hub
            validates taxonomy against and publishes checklists to as registered datasets.
          </p>
        </div>
        <a
          href="https://www.gbif.org"
          target="_blank"
          rel="noreferrer"
          className="btn-secondary shrink-0"
        >
          gbif.org ↗
        </a>
      </div>
    </section>
  );
}
