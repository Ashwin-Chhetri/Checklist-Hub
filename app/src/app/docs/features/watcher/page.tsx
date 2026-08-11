import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import DocsStepExplorer from "@/components/docs/DocsStepExplorer";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";

const SETUP_SCREEN = {
  src: "/res/docs/watcher-set-up.PNG",
  alt: "The Watcher dialog set to a weekly schedule with a collaborator added to the alert list",
  aspect: "1914 / 950",
};

const ALERT_EMAIL_SCREEN = {
  src: "/res/docs/watcher-alert-email.png",
  alt: "A Watcher alert email showing new species observations found on a checklist",
  aspect: "1744 / 1201",
  variant: "dialog" as const,
  scale: 0.7,
};

const RUNS_SCREEN = {
  src: "/res/docs/watcher-runs.PNG",
  alt: "The Watcher dialog's Runs list, showing a dated history of new and updated occurrences per run",
  aspect: "1905 / 950",
};

const RUN_OCCURRENCES_SCREEN = {
  src: "/res/docs/watcher-run-sample.PNG",
  alt: "A Watcher run showing new occurrences, with previous and new counts side by side for each species",
  aspect: "1903 / 946",
};

const RUN_NEW_SPECIES_SCREEN = {
  src: "/res/docs/watcher-run-sample-with-new-species.PNG",
  alt: "A Watcher run showing a new candidate species with a checkbox to add it to the checklist",
  aspect: "1907 / 946",
};

export const metadata: Metadata = {
  title: "Watcher — Docs",
  description:
    "A weekly or monthly check that re-runs GBIF, iNaturalist, and eBird against a published checklist, strengthening low evidence and surfacing new species.",
  alternates: { canonical: "/docs/features/watcher" },
};

export default function WatcherPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Watcher
      </h2>
      <DocsBreadcrumb items={["Checklist", "Workbench", "Status", "Watcher"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-4 max-w-2xl">
        The Watcher is a weekly or monthly check that runs on its own. Each time it
        fires, it goes back through GBIF, iNaturalist, and eBird (when the checklist is
        scoped to Aves) and rechecks for new occurrences and new species, the same
        recheck a reviewer would otherwise have to remember to do by hand. New
        occurrences on a species already in the checklist strengthen a Low or Medium
        evidence score; a species that was never on the checklist gets flagged as a
        candidate.
      </p>
      <div className="border border-outline-variant bg-surface-container-low p-md mb-10 max-w-2xl">
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
          Who it&apos;s for
        </p>
        <p className="font-body-sm text-body-sm text-secondary">
          Experts monitoring a region with a lot of citizen-science activity, where the
          odds of a genuinely new species turning up between one publication and the
          next are real.
        </p>
      </div>

      <DocsStepExplorer
        defaultScreen={SETUP_SCREEN}
        variant="full"
        steps={[
          {
            title: "Turn it on",
            body: "Open the Watcher from Status in the Workbench sidebar and pick Weekly or Monthly, then save. The dialog shows when it started watching and exactly when the next run happens.",
            screen: SETUP_SCREEN,
          },
          {
            title: "Alert collaborators",
            body: "Add any collaborator to the alert list. When a run turns up something worth a look, everyone on that list gets an in-app notification and an email like this one.",
            screen: ALERT_EMAIL_SCREEN,
          },
          {
            title: "View Watcher runs",
            body: "Every run lands in the Runs list with a date and a count of what it found, so you can tell at a glance whether last week's run was quiet or worth opening. Click any run to see the detail.",
            screen: RUNS_SCREEN,
          },
          {
            title: "New occurrences",
            body: "Open a run and species already on the checklist show their previous occurrence count next to the new one, broken down by source. This is exactly what feeds the evidence score, so more occurrences found here can push a species from Low to Medium, or Medium to High.",
            screen: RUN_OCCURRENCES_SCREEN,
          },
          {
            title: "New species",
            body: "A species the run found that isn't on the checklist yet shows up on its own tab, with its occurrence count and a checkbox next to it.",
            screen: RUN_NEW_SPECIES_SCREEN,
          },
          {
            title: "Update the species table",
            body: (
              <>
                Check the candidates worth keeping and click Update. New occurrences
                apply straight to the matching row&apos;s evidence, and checked
                candidate species get added as new rows in Needs Review.{" "}
                <Highlight>Nothing is accepted automatically</Highlight>. A
                collaborator still has to review and accept each one, the same as any
                other row.
              </>
            ),
            screen: RUN_NEW_SPECIES_SCREEN,
          },
        ]}
      />

      <div className="mt-10 max-w-2xl">
        <h3 className="font-body-sm text-[15px] font-semibold text-on-surface mb-3">
          Why it&apos;s worth turning on
        </h3>
        <ul className="space-y-2 font-body-sm text-body-sm text-secondary list-disc pl-5">
          <li>
            A published checklist doesn&apos;t have to go stale. New occurrences keep
            strengthening its Low and Medium evidence rows without anyone re-importing
            data by hand.
          </li>
          <li>
            The dated Runs history is a running audit trail, so you can point to exactly
            when a species was first flagged as a candidate.
          </li>
          <li>
            Because nothing applies without a click, a bad or noisy source can&apos;t
            quietly pollute an already-published checklist.
          </li>
        </ul>
      </div>
    </section>
  );
}
