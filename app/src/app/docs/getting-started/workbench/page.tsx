import type { Metadata } from "next";
import Link from "next/link";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsStepNav from "@/components/docs/DocsStepNav";
import DocsStepExplorer from "@/components/docs/DocsStepExplorer";

const WORKBENCH_SCREEN = {
  src: "/res/docs/workbench.png",
  alt: "The Workbench species table with taxonomy, evidence, and review status columns",
  aspect: "2562 / 1899",
};

const EVIDENCE_SCREEN = {
  src: "/res/docs/evidence.png",
  alt: "The Evidence tab showing an occurrence map, per-source counts, and discard toggles",
  aspect: "2530 / 1901",
};

const DISCUSSION_SCREEN = {
  src: "/res/docs/discussion-fitted.png",
  alt: "A species discussion thread with an @ collaborator tag and a # species tag",
  aspect: "1521 / 949",
  variant: "flush" as const,
};

export const metadata: Metadata = {
  title: "Workbench — Docs",
  description:
    "Every species lands here as its own row for a final pass before you publish, with taxonomy, evidence, and review status side by side.",
  alternates: { canonical: "/docs/getting-started/workbench" },
};

export default function GettingStartedWorkbenchPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Workbench
      </h2>
      <DocsBreadcrumb items={["Checklists", "New", "Workbench"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Every species from the previous steps lands here as its own row, ready for a
        final pass before you publish.
      </p>
      <DocsStepExplorer
        defaultScreen={WORKBENCH_SCREEN}
        variant="full"
        steps={[
          {
            title: "Review species",
            body: "Work through the checklist row by row, starting wherever you like.",
            screen: WORKBENCH_SCREEN,
          },
          {
            title: "Verify with evidence",
            body: "Confirm each species actually belongs by checking the occurrence map and source counts behind it.",
            screen: EVIDENCE_SCREEN,
          },
          {
            title: "Review flagged taxonomy issues",
            body: "Resolve any row flagged as a synonym or an authority conflict.",
            screen: WORKBENCH_SCREEN,
          },
          {
            title: "Communicate with collaborators",
            body: "Leave a comment on the row, tagging a collaborator with @ or a species with # when something needs a second opinion.",
            screen: DISCUSSION_SCREEN,
          },
          {
            title: "Resolve every row",
            body: "Accept, reject, or merge each one until nothing is left in Needs Review.",
            screen: WORKBENCH_SCREEN,
          },
        ]}
      />
      <p className="font-body-sm text-body-sm text-secondary mt-6">
        See the full walkthrough, including taxonomy resolution and merging
        duplicates, in{" "}
        <Link
          href="/docs/features/workbench"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          Features → Workbench
        </Link>
        .
      </p>
      <DocsStepNav
        back={{ href: "/docs/getting-started/collaborate", label: "Collaborate" }}
        next={{ href: "/docs/getting-started/define-metadata", label: "Define Metadata" }}
      />
    </section>
  );
}
