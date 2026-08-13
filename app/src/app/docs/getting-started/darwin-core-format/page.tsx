import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsFieldWalkthrough from "@/components/docs/DocsFieldWalkthrough";
import DocsStepNav from "@/components/docs/DocsStepNav";

export const metadata: Metadata = {
  title: "Generate Darwin Core Format — Docs",
  description:
    "How Checklist Hub turns a checklist's metadata and Workbench data into a Darwin Core Archive you can edit, download, and share before publishing.",
  alternates: { canonical: "/docs/getting-started/darwin-core-format" },
};

export default function DarwinCoreFormatPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Generate Darwin Core Format
      </h2>
      <DocsBreadcrumb items={["Checklists", "New", "Darwin Core"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        With the metadata in place, Checklist Hub builds the{" "}
        <Highlight>Darwin Core Archive</Highlight> from it automatically — the standard
        exchange format GBIF requires for publishing.
      </p>
      <DocsFieldWalkthrough
        hint="Click a step below to see it highlighted in the screenshot."
        screen={{
          src: "/res/docs/darwin-core-archieve.PNG",
          alt: "The Darwin Core Archive package view, previewing taxon.txt alongside the rest of the package contents and reviewer approval",
          variant: "full",
          aspect: "1892 / 944",
        }}
        steps={[
          {
            title: "Generated automatically",
            target: { x: 13, y: 41 },
            body: (
              <>
                Checklist Hub combines the metadata with the Workbench data to build
                the full package: the <Highlight>taxon.txt</Highlight> core, plus
                extensions like vernacularname.txt, distribution.txt, and
                resourcerelationship.txt, a <Highlight>multimedia.txt</Highlight>{" "}
                pulling in media from every source, and the required eml.xml and
                meta.xml.
              </>
            ),
          },
          {
            title: "Edit, download, share",
            target: { x: 99, y: 10 },
            body: "Preview any file in the package inline, edit records before they're finalized, and download or share the package independent of the publish step itself.",
          },
          {
            title: "Approve, then download",
            target: { x: 98, y: 92 },
            body: "Once a reviewer approves it, the Darwin Core Archive is ready — download it and move on to publishing.",
          },
        ]}
      />
      <p className="font-body-sm text-body-sm text-secondary mt-10">
        See{" "}
        <Link
          href="/docs/publishing/darwin-core-archive"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          Darwin Core, IPT &amp; GBIF
        </Link>{" "}
        for what a GBIF checklist dataset is and what&apos;s inside the archive.
      </p>
      <DocsStepNav
        back={{ href: "/docs/getting-started/define-metadata", label: "Define Metadata" }}
        next={{ href: "/docs/getting-started/publish-to-gbif", label: "Publish to GBIF" }}
      />
    </section>
  );
}
