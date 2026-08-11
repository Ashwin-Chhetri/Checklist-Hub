import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import FramedScreenshot from "@/components/docs/FramedScreenshot";
import DocsStepList from "@/components/docs/DocsStepList";
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
      <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
        <div className="w-full max-w-[95%] mx-auto lg:mx-0">
          <FramedScreenshot
            src="/res/docs/csv-export.png"
            alt="The Export Species dialog with field selection and CSV/Excel format options"
            aspect="1275 / 958"
          />
        </div>
        <DocsStepList
          interactive
          items={[
            {
              title: "Export what you're viewing",
              body: "Exports exactly the species currently visible in the table — filter the Workbench first, then export just that slice.",
            },
            {
              title: "Pick your fields",
              body: "Choose which fields to include: scientific name, taxonomy hierarchy, occurrence, sources, evidence, and review status.",
            },
            {
              title: "CSV or color-coded Excel",
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
      </div>
    </section>
  );
}
