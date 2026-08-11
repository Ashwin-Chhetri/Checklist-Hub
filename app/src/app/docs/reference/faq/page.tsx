import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ — Docs",
  description:
    "Frequently asked questions about accounts, import formats, synonyms, reviewers, exports, the Watcher, privacy, and evidence strength.",
  alternates: { canonical: "/docs/reference/faq" },
};

const faqs = [
  {
    q: "Do I need a GBIF account to use Checklist Hub?",
    a: "No. You create a Checklist Hub account to build and review checklists. A GBIF account is only needed at the very end, when you upload the Darwin Core Archive to a GBIF-registered IPT for publication.",
  },
  {
    q: "What file formats can I import?",
    a: "CSV, TSV, JSON, and Excel (.xlsx). All formats are mapped to a common species-name column at import time. You can also skip a file entirely and let the automatic discovery pipeline pull species from GBIF, iNaturalist, and eBird.",
  },
  {
    q: "What happens if a species name is a synonym?",
    a: "Names are checked against the GBIF Backbone and Catalogue of Life during import. Synonyms are flagged automatically and resolved to their accepted name — nothing is silently merged. You can review and override any synonym resolution in the Workbench before accepting the species.",
  },
  {
    q: "How many reviewers does a checklist need?",
    a: "Every species must be signed off by at least one reviewer before the checklist can be published. There is no fixed minimum number of reviewers overall — a single expert can review the whole list, or you can spread the work across a team.",
  },
  {
    q: "Can I undo a review decision?",
    a: "Yes. Any Accept or Reject decision can be reversed from the Workbench as long as the checklist has not been published. Every change is logged in the History Timeline with the actor and timestamp, so the audit trail is preserved either way.",
  },
  {
    q: "Can I export my checklist before publishing to GBIF?",
    a: "Yes. The Export dialog (Workbench → Export) lets you download the currently filtered species as a CSV or color-coded Excel file at any point, independent of the formal Darwin Core publication flow.",
  },
  {
    q: "How does the Watcher know about new species?",
    a: "On a weekly or monthly schedule it re-fetches occurrence records from GBIF, iNaturalist, and eBird (eBird only for Aves-scoped checklists) and compares them against the species already in the checklist. Genuinely new candidates are surfaced as alerts — nothing is added automatically.",
  },
  {
    q: "Is my checklist data private?",
    a: "Yes, until you publish. Only you and collaborators you explicitly invite can see a checklist. Publishing to GBIF makes it publicly citable, but Checklist Hub itself never exposes a checklist without your action.",
  },
  {
    q: "Do collaborators need a Checklist Hub account?",
    a: "Not upfront. You can invite anyone by email address. If they already have an account they get access immediately; if not, they receive an invite email and can sign up when they follow the link.",
  },
  {
    q: "What does the evidence strength badge mean?",
    a: "It is a Low / Medium / High score derived from the number of occurrence records and publications linked to that species inside the checklist's region. Click the badge to see exactly how the score was calculated and which sources contributed.",
  },
];

export default function FaqPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
        Frequently Asked Questions
      </h2>
      <dl className="space-y-6">
        {faqs.map(({ q, a }) => (
          <div key={q} className="border border-outline-variant bg-white p-lg">
            <dt className="font-bold text-on-surface mb-2">{q}</dt>
            <dd className="font-body-sm text-body-sm text-secondary">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
