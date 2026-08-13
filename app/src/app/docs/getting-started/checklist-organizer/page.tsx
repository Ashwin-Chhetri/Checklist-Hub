import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsFieldWalkthrough from "@/components/docs/DocsFieldWalkthrough";
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
      <DocsFieldWalkthrough
        hint="Click a step below to see it highlighted in the screenshot."
        screen={{
          src: "/res/docs/checklist-organizer.png",
          alt: "The My Checklists table with status tabs, collaborator avatars, and resume-publish rows",
          variant: "full",
          aspect: "2512 / 1687",
        }}
        steps={[
          {
            title: "Filter by status",
            target: { x: 52, y: 18 },
            body: "Tabs for All Checklists, Shared with Me, Watching, Published, and Archived — filtered instantly, no reload.",
          },
          {
            title: "See state at a glance",
            target: { x: 34, y: 41 },
            body: "Status pills (Draft, Validating, Reviewing, Published, Archived) and a Watcher badge show a checklist's state at a glance.",
          },
          {
            title: "Manage the team",
            target: { x: 66, y: 41 },
            body: "A collaborator avatar stack shows everyone with access, including pending invites, with one click to manage the team.",
          },
          {
            title: "Resume a publish",
            target: { x: 95, y: 67 },
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
      <DocsStepNav
        back={{ href: "/docs/getting-started/publish-to-gbif", label: "Publish to GBIF" }}
      />
    </section>
  );
}
