import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import FramedScreenshot from "@/components/docs/FramedScreenshot";
import DocsStepList from "@/components/docs/DocsStepList";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";

export const metadata: Metadata = {
  title: "History — Docs",
  description:
    "Every decision on a checklist is provenance, not just a status flip, and the Workbench keeps a running record of who did what and when.",
  alternates: { canonical: "/docs/features/history" },
};

export default function HistoryPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        History &amp; Activity
      </h2>
      <DocsBreadcrumb items={["Checklist", "Workbench", "Status", "History"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Six months from now, can you say who accepted a species and why? Every decision
        on a checklist is <Highlight>provenance, not just a status flip</Highlight>, and
        the Workbench keeps a running record of who did what and when, so the answer is
        always yes.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
        <div className="w-full max-w-[95%] mx-auto lg:mx-0">
          <FramedScreenshot
            src="/res/docs/history.PNG"
            alt="The History Timeline showing checklist activity grouped by genus"
            aspect="1909 / 949"
          />
        </div>
        <DocsStepList
          interactive
          items={[
            {
              title: "Recent Changes",
              body: "A live feed of review-status changes, taxonomy votes, merges, and evidence updates, in the order they happened.",
            },
            {
              title: "Recent Comments",
              body: "Every discussion post across the whole checklist, in one feed, so you don't have to open each species to catch up on what reviewers are saying.",
            },
            {
              title: "History Timeline",
              body: "The full activity log grouped by genus/taxon, so you can audit one branch of the tree at a time instead of scrolling a single flat list.",
            },
            {
              title: "Traceable, always",
              body: "Every entry records the actor and a relative timestamp, so a decision made months ago is still traceable back to the person who made it. Entries link straight back to what changed: a status flip opens the species it happened on, a taxonomy vote opens the conflict it resolved.",
            },
          ]}
        />
      </div>
    </section>
  );
}
