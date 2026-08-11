import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import FramedScreenshot from "@/components/docs/FramedScreenshot";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsStepList from "@/components/docs/DocsStepList";
import DocsStepNav from "@/components/docs/DocsStepNav";

export const metadata: Metadata = {
  title: "Checklist Organizer — Docs",
  description:
    "Every checklist you own or collaborate on lives in one table — filter by status and jump straight back into whatever stage you left off at.",
  alternates: { canonical: "/docs/getting-started/checklist-organizer" },
};

export default function ChecklistOrganizerPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Checklist Organizer
      </h2>
      <DocsBreadcrumb items={["Home", "My Checklists"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Every checklist you own or collaborate on lives in one table — filter by status
        and jump straight back into whatever stage you left off at.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
        <div className="w-full max-w-[95%] mx-auto lg:mx-0">
          <FramedScreenshot
            src="/res/docs/checklist-organizer.png"
            alt="The My Checklists table with status tabs, collaborator avatars, and resume-publish rows"
            aspect="2512 / 1687"
          />
        </div>
        <DocsStepList
          interactive
          items={[
            {
              title: "Filter by status",
              body: "Tabs for All Checklists, Shared with Me, Watching, Published, and Archived — filtered instantly, no reload.",
            },
            {
              title: "See state at a glance",
              body: "Status pills (Draft, Validating, Reviewing, Published, Archived) and a Watcher badge show a checklist's state at a glance.",
            },
            {
              title: "Manage the team",
              body: "A collaborator avatar stack shows everyone with access, including pending invites, with one click to manage the team.",
            },
            {
              title: "Resume a publish",
              body: (
                <>
                  Unfinished publish steps — saved metadata, a generated Darwin Core
                  package, a submission awaiting GBIF registration — surface as inline
                  rows so you <Highlight>resume exactly where you stopped</Highlight>,
                  without redoing the wizard.
                </>
              ),
            },
          ]}
        />
      </div>
      <DocsStepNav
        back={{ href: "/docs/getting-started/publish-to-gbif", label: "Publish to GBIF" }}
      />
    </section>
  );
}
