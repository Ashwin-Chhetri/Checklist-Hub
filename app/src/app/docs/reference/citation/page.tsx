import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";

export const metadata: Metadata = {
  title: "Citing Checklist Hub — Docs",
  description:
    "How to cite the Checklist Hub platform, in APA and BibTeX format.",
  alternates: { canonical: "/docs/reference/citation" },
};

export default function CitationPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
        Citing Checklist Hub
      </h2>
      <div className="space-y-4 font-body-sm text-body-sm text-secondary mb-6">
        <p>
          A checklist you publish through GBIF gets its own dataset DOI — cite that DOI
          for the checklist itself. If you&apos;re citing the{" "}
          <Highlight>Checklist Hub platform</Highlight> (in a methods section, a tool
          comparison, or an acknowledgment), use the reference below.
        </p>
      </div>
      <div className="space-y-4">
        <div className="border border-outline-variant bg-surface-container-low p-md">
          <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-2">
            APA
          </p>
          <p className="font-body-sm text-body-sm text-on-surface">
            Chhetri, A. (2026). <em>Checklist Hub: Evidence-based species checklist
            platform for biodiversity experts</em> [Computer software]. Checklist Hub.
            https://checklisthub.in
          </p>
        </div>
        <div className="border border-outline-variant bg-surface-container-low p-md">
          <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-2">
            BibTeX
          </p>
          <pre className="font-code-md text-code-md text-on-surface whitespace-pre-wrap break-words">
{`@software{checklisthub2026,
  author  = {Chhetri, Ashwin},
  title   = {Checklist Hub: Evidence-based species checklist platform for biodiversity experts},
  year    = {2026},
  url     = {https://checklisthub.in}
}`}
          </pre>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareSourceCode",
            "@id": "https://checklisthub.in/#citation",
            name: "Checklist Hub",
            description:
              "Checklist Hub: Evidence-based species checklist platform for biodiversity experts.",
            url: "https://checklisthub.in",
            author: { "@id": "https://checklisthub.in/#founder" },
            publisher: { "@id": "https://checklisthub.in/#organization" },
            datePublished: "2026-06-29",
            citation:
              "Chhetri, A. (2026). Checklist Hub: Evidence-based species checklist platform for biodiversity experts [Computer software]. https://checklisthub.in",
            mainEntityOfPage: "https://checklisthub.in/docs/reference/citation",
          }),
        }}
      />
    </section>
  );
}
