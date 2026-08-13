import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsFieldWalkthrough from "@/components/docs/DocsFieldWalkthrough";
import DocsStepNav from "@/components/docs/DocsStepNav";

export const metadata: Metadata = {
  title: "Define scope and taxa — Docs",
  description:
    "Name the checklist and set the taxonomic scope and region that everything else — evidence aggregation, reconciliation, review — is built on.",
  alternates: { canonical: "/docs/getting-started/define-scope" },
};

export default function DefineScopePage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Define scope and taxa
      </h2>
      <DocsBreadcrumb items={["Checklists", "New", "Details"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Name the checklist, then set the two fields that scope everything Checklist Hub
        does next, from evidence aggregation to reconciliation.
      </p>
      <DocsFieldWalkthrough
        hint="Click a step below to see it highlighted in the screenshot."
        screen={{
          src: "/res/docs/checklist-step-1.png",
          alt: "The Details step of the checklist creation wizard, with title, taxonomic scope, and region fields",
          variant: "dialog",
          aspect: "1398 / 1205",
        }}
        steps={[
          {
            title: "Title",
            target: { x: 94, y: 28 },
            body: (
              <>
                Anything works, but a short, descriptive name — like{" "}
                <Highlight>&quot;Birds of Sikkim&quot;</Highlight> — is usually best,
                since it&apos;s often how the checklist gets identified later, by you
                and by collaborators.
              </>
            ),
          },
          {
            title: "Taxa",
            target: { x: 94, y: 52 },
            body: (
              <>
                Checklist Hub organizes species along the taxonomic tree —{" "}
                <em>kingdom → phylum → class → order → family</em>. Define the taxa
                scope that covers a species and all its family, from a whole class
                down to a single genus, for example:
                <span className="block mt-2">
                  • <Highlight>Birds</Highlight> <em>(Animalia → Chordata → Aves)</em>
                </span>
                <span className="block mt-1">
                  • <Highlight>Reptiles</Highlight>{" "}
                  <em>(Animalia → Chordata → Reptilia)</em>
                </span>
              </>
            ),
          },
          {
            title: "Region",
            target: { x: 94, y: 77 },
            body: (
              <>
                The geographic boundary the checklist is limited to — anything down to{" "}
                <Highlight>district level</Highlight> is supported, but{" "}
                <Highlight>it must have a GADM code</Highlight>. GADM (the Database of
                Global Administrative Areas) assigns every country, state, and
                district a unique boundary code — look yours up at{" "}
                <Link
                  href="https://gadm.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  gadm.org
                </Link>
                . Only occurrences that fall inside <Highlight>both</Highlight> the
                taxonomic scope and the region are pulled in later.
              </>
            ),
          },
        ]}
      />
      <DocsStepNav
        back={{ href: "/docs/getting-started/create-a-checklist", label: "Create your first checklist" }}
        next={{ href: "/docs/getting-started/import-data", label: "Import data" }}
      />
    </section>
  );
}
