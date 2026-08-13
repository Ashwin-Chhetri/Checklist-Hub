import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import DocsFieldWalkthrough from "@/components/docs/DocsFieldWalkthrough";

export const metadata: Metadata = {
  title: "Collaboration — Docs",
  description:
    "Invite reviewers by name or email, manage roles, and resolve conflicts in per-species discussion threads with @ pings and # references.",
  alternates: { canonical: "/docs/features/collaboration" },
};

export default function CollaborationPage() {
  return (
    <>
      <section className="py-6 md:py-8 border-b border-outline-variant">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
          Collaboration &amp; Invites
        </h2>
        <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
          How long does it take to get a reviewer onto a checklist? One line, not an
          account-provisioning process.
        </p>
        <DocsFieldWalkthrough
          hint="Click a step below to see it highlighted in the screenshot."
          screen={{
            src: "/res/docs/invite-new-collborator-workbench.PNG",
            alt: "The Team dialog in the Workbench, with a search-by-name-or-email field and an Invite button",
            aspect: "1910 / 948",
            variant: "flush",
          }}
          steps={[
            {
              title: "Search by name",
              target: { x: 42, y: 63 },
              body: "Start typing a name — Checklist Hub searches existing profiles and suggests a match.",
            },
            {
              title: "No match? Use email",
              target: { x: 52, y: 63 },
              body: "Type a full email address to invite someone brand new to Checklist Hub.",
            },
            {
              title: "One click to invite",
              target: { x: 61, y: 63 },
              body: (
                <>
                  One click <Highlight>sends the invitation automatically</Highlight> —
                  no separate email tool to open.
                </>
              ),
            },
            {
              title: "Manage roles anytime",
              target: { x: 47, y: 55 },
              body: "Pending invites are tracked until accepted; owners can manage roles and remove collaborators at any time.",
            },
            {
              title: "Collaborators get the invite via their email",
              target: { x: 42, y: 49 },
              body: (
                <>
                  They get <Highlight>notified in-app and by email</Highlight>, with a
                  link straight to the checklist. If they don&apos;t have a Checklist
                  Hub account yet, the same email lets them create one.
                </>
              ),
              screen: {
                src: "/res/docs/invite-email.png",
                alt: "The invitation email a new collaborator receives, with the checklist name and a link to accept",
                aspect: "1900 / 1227",
                variant: "dialog",
                scale: 0.8,
              },
            },
            {
              title: "Straight into the Workbench",
              target: { x: 88, y: 14 },
              body: (
                <>
                  Accepting drops them right into the <Highlight>Workbench</Highlight>,
                  species panel open and ready — the same place they&apos;ll open a{" "}
                  <Highlight>Discussion</Highlight> thread when they have something to
                  add.
                </>
              ),
              screen: {
                src: "/res/docs/workbench.png",
                alt: "The Workbench species table with the Discussion tab highlighted in the species detail panel",
                aspect: "2562 / 1899",
                variant: "flush",
              },
            },
          ]}
        />
      </section>

      <section id="discussion" className="py-10 md:py-12">
        <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
          Discussion &amp; Pinging
        </h2>
        <p className="font-body-sm text-body-sm text-secondary mb-4 max-w-2xl">
          Where does a disagreement over a species&apos; status actually get resolved?
          In conversation, not in silence — every species has its own real-time
          discussion thread.
        </p>
        <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5 max-w-2xl">
          <li>
            Comment and reply in threads on any species, visible to every collaborator
            the moment it&apos;s posted.
          </li>
          <li>
            Type <span className="font-bold text-on-surface">@</span> to ping a specific
            collaborator — <Highlight>they get notified directly</Highlight>, by email
            and in-app, so a question doesn&apos;t sit unread in a thread nobody
            re-opens.
          </li>
          <li>
            Type <span className="font-bold text-on-surface">#</span> to reference
            another species or an evidence source inline, linking straight to it —
            useful when a decision on one species depends on how a related one was
            resolved.
          </li>
          <li>
            Attach files to a comment when a decision needs a supporting document, like
            a field report or a scan of a museum record.
          </li>
          <li>
            Every thread stays attached to its species permanently, so the reasoning
            behind a review decision is still there months later — see{" "}
            <Link
              href="/docs/features/history"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              History &amp; Activity
            </Link>{" "}
            for the checklist-wide feed of the same activity.
          </li>
        </ul>
      </section>
    </>
  );
}
