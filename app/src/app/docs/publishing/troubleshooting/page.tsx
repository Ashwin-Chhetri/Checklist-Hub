import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Troubleshooting — Docs",
  description:
    "Common blockers when publishing a checklist to GBIF, and how each step's readiness or blocker list tells you what to fix.",
  alternates: { canonical: "/docs/publishing/troubleshooting" },
};

export default function TroubleshootingPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
        Troubleshooting
      </h2>
      <p className="font-body-sm text-body-sm text-secondary mb-6">
        Stuck? Every step shows a readiness or blocker list before letting you proceed —
        fix what&apos;s flagged, then continue.
      </p>
      <div className="border border-outline-variant bg-surface-container-low p-md">
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
          Common blocker
        </p>
        <p className="font-body-sm text-body-sm text-secondary">
          No IPT access yet? You don&apos;t need to run your own — most national GBIF
          participant nodes host a shared IPT for exactly this case. Reach out to your
          country&apos;s node (listed on{" "}
          <a
            href="https://www.gbif.org"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            gbif.org
          </a>
          ) before assuming you need institutional infrastructure of your own.
        </p>
      </div>
    </section>
  );
}
