import SiteNavbar from "@/components/shared/SiteNavbar";
import SiteFooter from "@/components/shared/SiteFooter";

const steps = [
  {
    number: "01",
    title: "Import & Validate",
    body: "Upload a CSV or run a discovery search. Names are checked against the GBIF Backbone and Catalogue of Life, synonyms resolved automatically.",
  },
  {
    number: "02",
    title: "Gather Evidence & Reconcile",
    body: "Evidence is pulled from GBIF, iNaturalist, eBird, and literature, deduplicated, and compared against other checklists for conflicts.",
  },
  {
    number: "03",
    title: "Review & Collaborate",
    body: "Experts work the Workbench together — comment, discuss, vote. Nothing is accepted without at least one reviewer.",
  },
  {
    number: "04",
    title: "Publish",
    body: "Run readiness checks, generate the Darwin Core package, and publish through a GBIF-registered IPT.",
  },
];

const createSteps = [
  ["Details", "Name the checklist, set taxonomic scope and region."],
  ["Import", "Upload a CSV or run a discovery search."],
  ["Validate", "Review the merged species list."],
  ["Collab", "Invite reviewers by email."],
  ["Create", "Finish setup and open the Workbench."],
];

const publishSteps = [
  ["Validate", "Readiness checklist — all species reviewed, no open conflicts."],
  ["Metadata", "Checklist info and contributors."],
  ["Review", "Preview the generated package (Darwin Core Archive files)."],
  ["IPT", "Pick a publisher org and IPT installation, download the package, upload it, then paste back the published URL."],
  ["Done", "Publication complete — DOI and citation recorded."],
];

export default function DocsPage() {
  return (
    <>
      <SiteNavbar />

      <main className="bg-surface">
        <section className="border-b border-outline-variant py-16 md:py-20">
          <div className="w-full px-xl max-w-4xl">
            <div className="w-16 h-1.5 bg-primary mb-lg" />
            <h1 className="font-headline-lg text-headline-lg uppercase tracking-tighter font-bold mb-md">
              Docs
            </h1>
            <p className="font-body-lg text-body-lg text-secondary max-w-2xl">
              Everything you need to create, review, and publish a checklist.
            </p>
          </div>
        </section>

        <section className="py-16 md:py-20 border-b border-outline-variant">
          <div className="w-full px-xl max-w-4xl">
            <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
              How it works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              {steps.map((step) => (
                <div key={step.number} className="border border-outline-variant bg-white p-lg">
                  <span className="font-headline-md text-[28px] font-extrabold text-primary opacity-80">
                    {step.number}
                  </span>
                  <h3 className="font-headline-md text-[16px] uppercase tracking-tight mt-2 mb-2">
                    {step.title}
                  </h3>
                  <p className="font-body-sm text-body-sm text-secondary">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 md:py-20 border-b border-outline-variant">
          <div className="w-full px-xl max-w-4xl">
            <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
              Create a checklist
            </h2>
            <p className="font-code-md text-code-md text-secondary mb-6">
              Checklists → New
            </p>
            <ol className="space-y-4">
              {createSteps.map(([title, body], i) => (
                <li key={title} className="flex gap-4 items-start">
                  <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
                    {i + 1}
                  </span>
                  <div>
                    <span className="font-bold text-on-surface">{title}</span>
                    <span className="text-secondary font-body-sm text-body-sm"> — {body}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="py-16 md:py-20 border-b border-outline-variant">
          <div className="w-full px-xl max-w-4xl">
            <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
              Review species
            </h2>
            <p className="font-code-md text-code-md text-secondary mb-6">
              Checklist → Workbench
            </p>
            <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
              <li>Open a species to check its evidence, taxonomy, and history.</li>
              <li>Comment, discuss, and vote on conflicts.</li>
              <li>Accept or reject — every decision needs at least one reviewer.</li>
            </ul>
          </div>
        </section>

        <section className="py-16 md:py-20 border-b border-outline-variant">
          <div className="w-full px-xl max-w-4xl">
            <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
              Publish
            </h2>
            <p className="font-code-md text-code-md text-secondary mb-6">
              Checklist → Publish
            </p>
            <ol className="space-y-4">
              {publishSteps.map(([title, body], i) => (
                <li key={title} className="flex gap-4 items-start">
                  <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
                    {i + 1}
                  </span>
                  <div>
                    <span className="font-bold text-on-surface">{title}</span>
                    <span className="text-secondary font-body-sm text-body-sm"> — {body}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="py-16 md:py-20 border-b border-outline-variant">
          <div className="w-full px-xl max-w-4xl">
            <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
              Watch a checklist
            </h2>
            <p className="font-code-md text-code-md text-secondary mb-6">
              Checklist → Workbench → Status → Watcher
            </p>
            <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
              <li>
                <span className="font-bold text-on-surface">Who it&apos;s for</span> — checklists that stay
                active after the initial import, where new field records keep coming in and you don&apos;t
                want to manually re-check for them.
              </li>
              <li>
                <span className="font-bold text-on-surface">What it does</span> — on a weekly or monthly
                schedule, it re-fetches occurrences from GBIF and iNaturalist (and eBird, for checklists
                scoped to Aves), surfacing genuinely new candidate species and new observations on species
                already in the checklist.
              </li>
              <li>
                <span className="font-bold text-on-surface">Alerts</span> — collaborators you choose are
                notified by email and in-app notification whenever a run finds something, with a results
                view to review and apply the changes.
              </li>
              <li>Nothing is added or updated automatically — every run waits for a reviewer to apply it.</li>
            </ul>
          </div>
        </section>

        <section className="py-16 md:py-20">
          <div className="w-full px-xl max-w-4xl">
            <p className="font-body-sm text-body-sm text-secondary">
              Stuck? Every step shows a readiness or blocker list before letting you proceed —
              fix what&apos;s flagged, then continue.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
