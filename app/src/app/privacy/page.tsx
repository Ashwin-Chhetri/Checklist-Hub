import type { Metadata } from "next";
import SiteNavbar from "@/components/shared/SiteNavbar";
import SiteFooter from "@/components/shared/SiteFooter";
import FoldText from "@/components/shared/FoldText";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Checklist Hub collects, uses, and protects your data.",
  alternates: { canonical: "/privacy" },
};

const sections = [
  {
    title: "1. What We Collect",
    body: "When you sign in with Google, we receive your email address, name, and profile photo. When you create or join a checklist, we store the species data, evidence, comments, votes, and collaboration history you and your collaborators add. If you invite a collaborator by email, we store that email address to send and track the invitation.",
  },
  {
    title: "2. Third-Party Data Sources We Query",
    body: "To gather evidence and validate taxonomy, Checklist Hub queries public biodiversity databases — GBIF, iNaturalist, eBird, the GBIF Backbone Taxonomy, and Catalogue of Life — and, for the literature-discovery feature, Crossref and OpenAlex. These lookups retrieve public data; they do not send your checklist data to these services.",
  },
  {
    title: "3. Publishing to GBIF",
    body: "Publishing is an explicit, manual action you take. When you publish a checklist, Checklist Hub generates a Darwin Core Archive package that you download and upload yourself to a GBIF-registered IPT installation you select. We do not publish or transmit your data to GBIF automatically or without this step.",
  },
  {
    title: "4. How We Store Your Data",
    body: "Application data (accounts, checklists, evidence, comments, review history) is stored in our Supabase-hosted Postgres database, which also provides authentication and real-time collaboration features. Large reference datasets (GBIF Backbone, Catalogue of Life) are stored as local, read-only files on our servers and are never linked to your personal data. We do not sell your data, and we do not use third-party advertising or analytics trackers.",
  },
  {
    title: "5. Email",
    body: "We send collaboration invites, Watcher alerts (new species/observations found on a checklist you're watching), and account-related emails via our email provider. These emails go only to addresses you or your collaborators provide for that specific checklist.",
  },
  {
    title: "6. Cookies",
    body: "Checklist Hub uses only essential cookies required to keep you signed in (session cookies managed by Supabase Auth). We do not use advertising cookies or third-party tracking pixels.",
  },
  {
    title: "7. Data Retention and Deletion",
    body: "We retain your account and checklist data for as long as your account is active. To request deletion of your account or personal data, contact us at the email below — we will remove your account information and disassociate you from any checklists you collaborated on, without deleting the underlying scientific record other reviewers rely on.",
  },
  {
    title: "8. Children's Privacy",
    body: "Checklist Hub is intended for biodiversity researchers, taxonomists, and reviewers, and is not directed at children under 13.",
  },
  {
    title: "9. Changes to This Policy",
    body: "We may update this Privacy Policy as the platform evolves. Continued use of Checklist Hub after changes take effect constitutes acceptance of the revised policy.",
  },
  {
    title: "10. Contact",
    body: "Questions about this Privacy Policy or your data can be sent to checklisthub.review@gmail.com.",
  },
];

export default function PrivacyPage() {
  return (
    <>
      <SiteNavbar />

      <main className="bg-surface">
        <section className="py-16 md:py-24">
          <div className="w-full px-xl max-w-3xl">
            <div className="w-16 h-1.5 bg-primary mb-lg" />
            <h1 className="font-headline-lg text-headline-lg uppercase tracking-tighter font-bold mb-md">
              <FoldText
                text="Privacy Policy"
                splitBy="word"
                hinge="top"
                trigger="mount"
                duration={0.6}
                stagger={0.08}
                fontSize="inherit"
                fontWeight="inherit"
                color="inherit"
              />
            </h1>
            <p className="font-body-sm text-body-sm text-secondary mb-xl">
              Last updated: 2026-07-04
            </p>

            <div className="space-y-xl">
              {sections.map((section) => (
                <div key={section.title}>
                  <h2 className="font-headline-md text-[16px] uppercase tracking-tight mb-2">
                    {section.title}
                  </h2>
                  <p className="font-body-sm text-body-sm text-secondary leading-relaxed">
                    {section.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
