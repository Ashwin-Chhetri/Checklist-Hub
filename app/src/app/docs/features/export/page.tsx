import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import DocsFieldWalkthrough from "@/components/docs/DocsFieldWalkthrough";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";

export const metadata: Metadata = {
  title: "Export — Docs",
  description:
    "Get checklist data out as CSV or color-coded Excel, independent of the formal Darwin Core publication flow.",
  alternates: { canonical: "/docs/features/export" },
};

export default function ExportPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Export
      </h2>
      <DocsBreadcrumb items={["Checklist", "Workbench", "Export"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Need the list in a spreadsheet before it&apos;s ready to publish? Export gets the
        data out of the Workbench in whatever shape you need it, independent of the
        formal Darwin Core publication flow.
      </p>
      <DocsFieldWalkthrough
        hint="Click a step below to see it highlighted in the screenshot."
        screen={{
          src: "/res/docs/csv-export.png",
          alt: "The Export Species dialog with field selection and CSV/Excel format options",
          aspect: "1275 / 958",
          variant: "flush",
        }}
        steps={[
          {
            title: "Click the button",
            target: { x: 3.9, y: 87.7 },
            body: "The Export button sits at the bottom of the Workbench's left sidebar. Click it to open the Export Species dialog.",
            screen: {
              src: "/res/docs/invite-new-collborator-workbench.PNG",
              alt: "The Workbench with the Export button highlighted at the bottom of the left sidebar",
              aspect: "1910 / 948",
              variant: "flush",
            },
          },
          {
            title: "Export what you're viewing",
            target: { x: 66, y: 35 },
            body: "Exports exactly the species currently visible in the table — filter the Workbench first, then export just that slice.",
          },
          {
            title: "Pick your fields",
            target: { x: 45, y: 47 },
            body: "Choose which fields to include: scientific name, taxonomy hierarchy, occurrence, sources, evidence, and review status.",
          },
          {
            title: "CSV or color-coded Excel",
            target: { x: 65, y: 61 },
            body: (
              <>
                Choose CSV for plain text, or Excel — which{" "}
                <Highlight>color-codes each row by taxonomy status</Highlight>{" "}
                (conflict, synonym/unresolved, accepted) with a legend sheet included.
              </>
            ),
          },
        ]}
      />
    </section>
  );
}
