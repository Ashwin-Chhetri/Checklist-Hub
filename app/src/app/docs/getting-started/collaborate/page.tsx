import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsStepNav from "@/components/docs/DocsStepNav";
import DocsStepExplorer from "@/components/docs/DocsStepExplorer";

export const metadata: Metadata = {
  title: "Collaborate — Docs",
  description:
    "Invite reviewers by name or email, and resolve conflicts in per-species discussion threads with @ pings and # references.",
  alternates: { canonical: "/docs/getting-started/collaborate" },
};

export default function CollaboratePage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Collaborate
      </h2>
      <DocsBreadcrumb items={["Checklists", "New", "Collab"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Bring reviewers onto a checklist and resolve conflicts without leaving the
        species panel.
      </p>
      <DocsStepExplorer
        defaultScreen={{
          src: "/res/docs/checklist-step-4.png",
          alt: "The Collab step showing the add-collaborator email field with an automatic invite suggestion",
          variant: "dialog",
          aspect: "1436 / 753",
          scale: 0.7,
        }}
        steps={[
          {
            title: "Invite a reviewer",
            body: (
              <>
                Start typing the collaborator&apos;s email address. If they already
                have a Checklist Hub account,{" "}
                <Highlight>they get notified in-app and by email</Highlight>, with a
                link straight to the checklist — something like{" "}
                <Highlight>checklisthub.org/checklists/&#123;checklist-id&#125;</Highlight>.
                If they don&apos;t have an account yet, they get an email invite to
                create one and join the checklist.
              </>
            ),
            screen: {
              src: "/res/docs/invite-email.png",
              alt: "The invitation email a new collaborator receives, with the checklist name and a link to accept",
              variant: "dialog",
              aspect: "1900 / 1227",
              scale: 0.8,
            },
          },
          {
            title: "Discuss",
            body: (
              <>
                Every species has its own real-time discussion thread. Type{" "}
                <span className="font-bold text-on-surface">@</span> to tag a
                collaborator — they&apos;re notified directly — or{" "}
                <span className="font-bold text-on-surface">#</span> to tag another
                species or an evidence source inline.
              </>
            ),
            screen: {
              src: "/res/docs/discussion-fitted.png",
              alt: "A species discussion thread with an @ collaborator tag and a # species tag",
              variant: "flush",
              aspect: "1521 / 949",
            },
          },
        ]}
      />
      <p className="font-body-sm text-body-sm text-secondary mt-6">
        See the full deep dive, including managing roles and pending invites, in{" "}
        <Link
          href="/docs/features/collaboration"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          Features → Collaboration
        </Link>
        .
      </p>
      <DocsStepNav
        back={{ href: "/docs/getting-started/validate-species", label: "Review species" }}
        next={{ href: "/docs/getting-started/workbench", label: "Workbench" }}
      />
    </section>
  );
}
