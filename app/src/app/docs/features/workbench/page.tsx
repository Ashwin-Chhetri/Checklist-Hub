import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import FramedScreenshot from "@/components/docs/FramedScreenshot";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsStepList from "@/components/docs/DocsStepList";

const WORKBENCH_SCREEN = {
  src: "/res/docs/workbench.png",
  alt: "The Workbench species table with taxonomy, evidence, and review status columns",
  aspect: "2562 / 1899",
};

export const metadata: Metadata = {
  title: "Workbench — Docs",
  description:
    "The Notion-style surface where a checklist actually gets reviewed — every species as its own row, with taxonomy, evidence, and review status side by side.",
  alternates: { canonical: "/docs/features/workbench" },
};

export default function WorkbenchPage() {
  return (
    <>
      <section className="py-6 md:py-8 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
          Workbench
        </h2>
        <DocsBreadcrumb items={["Checklists", "Workbench"]} />
        <p className="font-body-sm text-body-sm text-secondary max-w-2xl">
          The Workbench is where a checklist gets built, one species at a time. Every
          collaborator works from the same screen, and a species can&apos;t reach the
          published list until <Highlight>at least one collaborator</Highlight> has
          accepted or rejected its row.
        </p>
        <p className="font-body-sm text-body-sm text-secondary mt-4 max-w-2xl">
          The screen has three parts: a table in the middle listing every species, a
          sidebar on the left for finding and managing rows, and a panel on the right
          that opens up when you click into one. This page walks through all three.
        </p>
      </section>

      <section className="py-10 md:py-12 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
          1. The Main Table
        </h2>
        <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
          Every species on the checklist gets its own row. Read left to right and
          you&apos;ve got everything needed to make a call on it, without opening
          anything.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
          <div className="w-full max-w-[95%] mx-auto lg:mx-0">
            <FramedScreenshot {...WORKBENCH_SCREEN} />
          </div>
          <DocsStepList
            interactive
            items={[
              {
                title: "Species",
                body: "The scientific name and author come first, with the common name underneath. The taxon ID below that links straight through to the matching record on the GBIF Backbone, so you can check it against the source of truth in one click.",
              },
              {
                title: "Evidence",
                body: (
                  <>
                    A <Highlight>Low</Highlight>, <Highlight>Medium</Highlight>, or{" "}
                    <Highlight>High</Highlight> badge, built from a score: literature
                    and eBird records count for more than GBIF or iNaturalist records,
                    a source with a lot of occurrences scores higher, and having more
                    than one independent source counts for extra. Six points or more is
                    High, three to five is Medium, under three is Low. Click the badge
                    to see the breakdown.
                  </>
                ),
              },
              {
                title: "Taxonomy Resolution",
                body: 'A row marked "Taxonomy Clean" matched the GBIF Backbone with no issues. Anything else, a synonym, a name two sources classify differently, or a name that never matched, is flagged right there in the row. You see a conflict at a glance, without digging for it.',
              },
              {
                title: "Review Status",
                body: "Accepted, Rejected, or still open. A row stays open until at least one collaborator makes the call, and every comment or agree/disagree on it is counted right in the column, so you can see which rows still need a voice.",
              },
            ]}
          />
        </div>
      </section>

      <section className="py-10 md:py-12 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
          2. The Left Sidebar
        </h2>
        <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
          The sidebar doesn&apos;t hold extra data. It slices the same table you just
          saw, so you&apos;re always looking at fewer rows, not different ones.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
          <div className="w-full max-w-[95%] mx-auto lg:mx-0">
            <FramedScreenshot {...WORKBENCH_SCREEN} />
          </div>
          <DocsStepList
            interactive
            items={[
              {
                title: "View mode",
                body: "All Species, Needs Review, Accepted, and Rejected filter the table by review status. Accept or reject a row and it jumps to the matching view immediately, so there's no separate list to keep in sync by hand.",
              },
              {
                title: "Taxonomy status",
                body: "Synonyms, Conflicts, Unresolved, and Merged/Hidden filter the table by taxonomy status instead. Each one is there because a row needs a decision: a synonym to confirm, a conflict between sources to settle, a name that didn't resolve, or a past merge to review.",
              },
              {
                title: "Activity",
                body: (
                  <>
                    Recent Changes, Recent Comments, and History Timeline log every
                    status flip, taxonomy vote, merge, and comment across the whole
                    checklist, so a decision made months ago is still traceable back to
                    who made it. See{" "}
                    <Link
                      href="/docs/features/history"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      Features → History
                    </Link>{" "}
                    for the full breakdown.
                  </>
                ),
              },
              {
                title: "Watcher",
                body: (
                  <>
                    Turn on the Watcher and Checklist Hub keeps checking GBIF,
                    iNaturalist, and eBird for this checklist on a schedule, even after
                    you&apos;ve moved on. See{" "}
                    <Link
                      href="/docs/features/watcher"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      Features → Watcher
                    </Link>{" "}
                    for the full walkthrough.
                  </>
                ),
              },
              {
                title: "Export",
                body: (
                  <>
                    Pull whatever&apos;s currently visible in the table out as a
                    spreadsheet, independent of the formal publish flow. See{" "}
                    <Link
                      href="/docs/features/export"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      Features → Export
                    </Link>{" "}
                    for the full field list.
                  </>
                ),
              },
            ]}
          />
        </div>
      </section>

      <section className="py-10 md:py-12 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
          3. The Right Panel
        </h2>
        <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
          Click any row and the right panel opens for that one species, with three
          tabs: Taxonomy, Evidence, and Discussion.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
          <div className="w-full max-w-[95%] mx-auto lg:mx-0">
            <FramedScreenshot {...WORKBENCH_SCREEN} />
          </div>
          <DocsStepList
            interactive
            items={[
              {
                title: "Taxonomy",
                body: "The species' photo, when one is available, sits above its full classification, kingdom down to species. Start typing a correction and Checklist Hub suggests matches straight from the GBIF backbone. Pick one and the whole hierarchy updates with it.",
              },
              {
                title: "Evidence",
                body: (
                  <>
                    A map of the checklist&apos;s region with every occurrence point
                    plotted on it, colored by source. See{" "}
                    <Link
                      href="/docs/features/evidence"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      Features → Evidence
                    </Link>{" "}
                    for the full breakdown.
                  </>
                ),
              },
              {
                title: "Discussion",
                body: (
                  <>
                    A comment thread for this species alone. Tag a collaborator with @
                    or another species with # when a decision needs a second opinion.
                    See{" "}
                    <Link
                      href="/docs/features/collaboration"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      Features → Collaboration
                    </Link>{" "}
                    for the full breakdown.
                  </>
                ),
              },
            ]}
          />
        </div>
      </section>

      <section className="py-10 md:py-12">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
          Merging Duplicates
        </h2>
        <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
          Two sources can pull in the same species under slightly different names. The
          Workbench catches it before you do the deleting.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
          <div className="w-full max-w-[95%] mx-auto lg:mx-0">
            <FramedScreenshot
              src="/res/docs/workbench.png"
              alt="The Workbench species table, where merged rows move to the Merged / Hidden view"
              aspect="2562 / 1899"
            />
          </div>
          <DocsStepList
            interactive
            items={[
              {
                title: "Flagged before you save",
                body: "When a correction matches a name already in the checklist, Checklist Hub flags it as a duplicate before you save. The fix becomes a merge instead of two separate rows.",
              },
              {
                title: "Non-destructive",
                body: (
                  <>
                    Merging is <Highlight>non-destructive</Highlight>: evidence,
                    comments, and history from both rows carry over onto the surviving
                    row, and nothing is deleted outright.
                  </>
                ),
              },
              {
                title: "Reversible",
                body: "Merged rows don't disappear. They move to the Merged/Hidden view, so the decision stays visible and reversible.",
              },
            ]}
          />
        </div>
      </section>
    </>
  );
}
