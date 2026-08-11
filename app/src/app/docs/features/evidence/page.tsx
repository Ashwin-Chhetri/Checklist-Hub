import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import FramedScreenshot from "@/components/docs/FramedScreenshot";
import DocsStepList from "@/components/docs/DocsStepList";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";

export const metadata: Metadata = {
  title: "Evidence — Docs",
  description:
    "Every occurrence claim is mapped and sourced, so a species' evidence strength is something you can see, not just a badge you have to trust.",
  alternates: { canonical: "/docs/features/evidence" },
};

export default function EvidencePage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Evidence
      </h2>
      <DocsBreadcrumb items={["Species panel", "Evidence"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Why should a reviewer trust that a species is really present? Every occurrence
        claim behind it is mapped and sourced, so &quot;high evidence&quot; is something
        you can see on the map, not just a badge you have to take on faith.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
        <div className="w-full max-w-[95%] mx-auto lg:mx-0">
          <FramedScreenshot
            src="/res/docs/evidence.png"
            alt="The Evidence tab showing an occurrence map, per-source occurrence counts, and discard toggles"
            aspect="2530 / 1901"
          />
        </div>
        <DocsStepList
          interactive
          items={[
            {
              title: "The region, drawn to scale",
              body: "The checklist's boundary is pulled from GADM and drawn on the map. Every occurrence point, from GBIF, eBird, iNaturalist, and literature, is projected onto it and colored by source, with points that fall outside the boundary shown separately so you can spot bad geocoding at a glance.",
            },
            {
              title: "Sources, with counts",
              body: "GBIF, eBird, iNaturalist, and literature are each listed with an occurrence count, split into inside-region and outside-region totals.",
            },
            {
              title: "Discard a bad source",
              body: (
                <>
                  Found a source that&apos;s wrong for this species? Discard it, the
                  evidence strength <Highlight>recalculates immediately</Highlight>, and
                  it can be restored later without losing history.
                </>
              ),
            },
            {
              title: "Refresh and trace back",
              body: "Refresh re-pulls the latest counts on demand, and external IDs, like the GBIF taxon key, link straight back to the source record.",
            },
          ]}
        />
      </div>

      <div className="mt-16 pt-10 border-t border-outline-variant max-w-2xl">
        <h3 className="font-headline-md text-[18px] uppercase tracking-tight mb-2">
          What Low, Medium, and High Mean
        </h3>
        <p className="font-body-sm text-body-sm text-secondary mb-4">
          The badge on every Workbench row isn&apos;t a judgment call, it&apos;s a
          score built from the active sources on that species:
        </p>
        <ul className="space-y-2 font-body-sm text-body-sm text-secondary list-disc pl-5 mb-6">
          <li>
            Literature and eBird records count for 3 points each, GBIF and iNaturalist
            records count for 2, and legacy records count for 0.
          </li>
          <li>A source past 20 occurrences adds 1 point, and past 100 adds 2.</li>
          <li>
            Every independent source beyond the first adds 1 point, since two sources
            agreeing is stronger than one source saying it twice.
          </li>
        </ul>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 border border-outline-variant p-md">
            <Highlight>High</Highlight>
            <p className="font-body-sm text-body-sm text-secondary mt-1">
              6 points or more
            </p>
          </div>
          <div className="flex-1 border border-outline-variant p-md">
            <Highlight>Medium</Highlight>
            <p className="font-body-sm text-body-sm text-secondary mt-1">
              3 to 5 points
            </p>
          </div>
          <div className="flex-1 border border-outline-variant p-md">
            <Highlight>Low</Highlight>
            <p className="font-body-sm text-body-sm text-secondary mt-1">
              Under 3 points
            </p>
          </div>
        </div>
      </div>

      <div className="mt-10 max-w-2xl border border-outline-variant bg-surface-container-low p-md">
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
          Evidence grows on its own, too
        </p>
        <p className="font-body-sm text-body-sm text-secondary">
          A weekly or monthly Watcher run re-fetches these same counts from GBIF,
          iNaturalist, and eBird. When it finds new occurrences for a species already on
          the checklist, the score recalculates against the new totals, so a Low or
          Medium species can climb between reviews, purely because more evidence turned
          up in the field. See{" "}
          <Link
            href="/docs/features/watcher"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            Features → Watcher
          </Link>{" "}
          for how a run is set up and applied.
        </p>
      </div>
    </section>
  );
}
