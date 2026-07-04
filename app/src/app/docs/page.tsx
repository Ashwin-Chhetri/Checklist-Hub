import type { Metadata } from "next";
import Image from "next/image";
import SiteNavbar from "@/components/shared/SiteNavbar";
import SiteFooter from "@/components/shared/SiteFooter";
import ChecklistWizardCarousel from "@/components/docs/ChecklistWizardCarousel";
import DocsSidebar from "@/components/docs/DocsSidebar";
import Highlight from "@/components/docs/Highlight";

export const metadata: Metadata = {
  title: "Docs — How Checklist Hub Works",
  description:
    "How to create, validate, review, and publish a species checklist with Checklist Hub — import, taxonomy validation, the Workbench, the Watcher, collaboration, and Darwin Core / IPT publishing.",
  alternates: { canonical: "/docs" },
};

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

const publishSteps: [string, React.ReactNode][] = [
  ["Validate", "Readiness checklist — all species reviewed, no open conflicts."],
  ["Metadata", "Checklist info and contributors."],
  [
    "Review",
    <>
      Preview the generated package (<Highlight>Darwin Core Archive</Highlight> files).
    </>,
  ],
  ["IPT", "Pick a publisher org and IPT installation, download the package, upload it, then paste back the published URL."],
  [
    "Done",
    <>
      Publication complete — <Highlight>DOI</Highlight> and citation recorded.
    </>,
  ],
];

function DocsImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="border border-outline-variant bg-white p-lg mt-6">
      <div className="relative w-full aspect-[16/10]">
        <Image src={src} alt={alt} fill className="object-contain" />
      </div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <>
      <SiteNavbar />

      <main className="bg-surface">
        <section className="border-b border-outline-variant py-16 md:py-20">
          <div className="w-full px-xl max-w-6xl mx-auto">
            <div className="w-16 h-1.5 bg-primary mb-lg" />
            <h1 className="font-headline-lg text-headline-lg uppercase tracking-tighter font-bold mb-md">
              Docs
            </h1>
            <p className="font-body-lg text-body-lg text-secondary max-w-2xl">
              Everything you need to create, review, and publish a checklist.
            </p>
          </div>
        </section>

        <section className="py-12 md:py-16">
          <div className="w-full px-xl max-w-6xl mx-auto flex flex-col md:flex-row gap-xl md:gap-2xl items-start">
            <DocsSidebar />

            <div className="flex-1 min-w-0 max-w-3xl">
              <section id="introduction" className="py-6 md:py-8 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-6">
                  Introduction
                </h2>
                <div className="space-y-4 font-body-sm text-body-sm text-secondary">
                  <p>
                    A checklist is the definitive, evidence-backed list of species known from a
                    region or taxon group — the reference researchers, park authorities, and
                    conservation planners rely on to know what&apos;s actually there.{" "}
                    <a
                      href="https://www.gbif.org"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      GBIF
                    </a>{" "}
                    calls a published one a <Highlight>dataset</Highlight>: a structured,
                    citable snapshot of species occurrence that other tools and researchers can
                    query and build on.
                  </p>
                  <p>
                    Most checklists still live in spreadsheets — a species name typed into a cell
                    with no taxonomic authority check, no evidence behind it, no reviewer sign-off,
                    and no way to know why it was added. Synonyms, duplicates, and unsupported
                    names ship silently, and six months later nobody can reconstruct the reasoning.
                  </p>
                  <p>
                    Checklist Hub treats a species as a{" "}
                    <Highlight>decision record, not a row</Highlight> — identity, taxonomy,
                    evidence, review history, and discussion all attached to it, with nothing
                    accepted until <Highlight>at least one qualified reviewer</Highlight> signs
                    off.
                  </p>
                </div>
                <div className="mt-6 border border-outline-variant bg-surface-container-low p-md flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
                      Reference
                    </p>
                    <p className="font-body-sm text-body-sm text-secondary">
                      GBIF (Global Biodiversity Information Facility) is the network Checklist Hub
                      validates taxonomy against and publishes checklists to as registered datasets.
                    </p>
                  </div>
                  <a
                    href="https://www.gbif.org"
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary shrink-0"
                  >
                    gbif.org ↗
                  </a>
                </div>
              </section>

              <section id="how-it-works" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  How it works
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
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
              </section>

              <section id="create-a-checklist" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Create a checklist
                </h2>
                <p className="font-code-md text-code-md text-secondary mb-6">
                  Checklists → New
                </p>
                <ChecklistWizardCarousel />
              </section>

              <section id="review-species" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Review species
                </h2>
                <p className="font-code-md text-code-md text-secondary mb-6">
                  Checklist → Workbench
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>Open a species to check its evidence, taxonomy, and history.</li>
                  <li>Comment, discuss, and vote on conflicts.</li>
                  <li>
                    Accept or reject — every decision needs{" "}
                    <Highlight>at least one reviewer</Highlight>.
                  </li>
                </ul>
              </section>

              <section id="publish" className="py-10 md:py-12 border-b border-outline-variant">
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
              </section>

              <section id="watch-a-checklist" className="py-10 md:py-12 border-b border-outline-variant">
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
                  <li>
                    <Highlight>Nothing is added or updated automatically</Highlight> — every run
                    waits for a reviewer to apply it.
                  </li>
                </ul>
              </section>

              <section id="checklist-organizer" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Checklist Organizer
                </h2>
                <p className="font-code-md text-code-md text-secondary mb-6">
                  Home → My Checklists
                </p>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  Every checklist you own or collaborate on lives in one table — filter by status
                  and jump straight back into whatever stage you left off at.
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>
                    Tabs for All Checklists, Shared with Me, Watching, Published, and Archived —
                    filtered instantly, no reload.
                  </li>
                  <li>
                    Status pills (Draft, Validating, Reviewing, Published, Archived) and a Watcher
                    badge show a checklist&apos;s state at a glance.
                  </li>
                  <li>
                    A collaborator avatar stack shows everyone with access, including pending
                    invites, with one click to manage the team.
                  </li>
                  <li>
                    Unfinished publish steps — saved metadata, a generated Darwin Core package, a
                    submission awaiting GBIF registration — surface as inline rows so you{" "}
                    <Highlight>resume exactly where you stopped</Highlight>, without redoing the
                    wizard.
                  </li>
                </ul>
                <DocsImage
                  src="/res/docs/checklist-organizer.png"
                  alt="The My Checklists table with status tabs, collaborator avatars, and resume-publish rows"
                />
              </section>

              <section id="workbench" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Workbench
                </h2>
                <p className="font-code-md text-code-md text-secondary mb-6">
                  Checklist → Workbench
                </p>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  The Workbench is the Notion-style surface where a checklist actually gets
                  reviewed — every species as its own row, with taxonomy, evidence, and review
                  status side by side.
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>Views split the list into All Species, Needs Review, Accepted, and Rejected.</li>
                  <li>
                    Taxonomy Issues filters — Synonyms, Conflicts, Unresolved, Merged/Hidden —
                    surface exactly the species that need a taxonomic decision.
                  </li>
                  <li>
                    An evidence-strength badge (Low/Medium/High) is scored from occurrence and
                    publication counts — click it to see how the score was built.
                  </li>
                  <li>
                    Filter by family, evidence strength, taxonomy status, or review status; sort by
                    name, year, occurrence, or evidence strength.
                  </li>
                  <li>
                    Open any species to flip between its Taxonomy, Evidence, and Discussion tabs,
                    then Agree/Disagree or Accept/Reject — every decision needs{" "}
                    <Highlight>at least one reviewer</Highlight>.
                  </li>
                </ul>
                <DocsImage
                  src="/res/docs/workbench.png"
                  alt="The Workbench species table with taxonomy, evidence, and review status columns"
                />
              </section>

              <section id="evidence" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Evidence
                </h2>
                <p className="font-code-md text-code-md text-secondary mb-6">
                  Species panel → Evidence
                </p>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  Every occurrence claim is mapped and sourced, so &quot;high evidence&quot; is
                  something you can see, not just a badge you have to trust.
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>
                    A map plots every occurrence record inside the checklist&apos;s region, with
                    points outside the boundary shown separately so you can spot bad geocoding at a
                    glance.
                  </li>
                  <li>
                    Evidence sources — GBIF, eBird, iNaturalist, literature — are listed with an
                    occurrence count each, split into inside-region and outside-region totals.
                  </li>
                  <li>
                    Found a source that&apos;s wrong for this species? Discard it — the evidence
                    strength <Highlight>recalculates immediately</Highlight>, and it can be
                    restored later without losing history.
                  </li>
                  <li>
                    Refresh re-pulls the latest counts on demand, and external IDs (like the GBIF
                    taxon key) link straight back to the source record.
                  </li>
                </ul>
                <DocsImage
                  src="/res/docs/evidence.png"
                  alt="The Evidence tab showing an occurrence map, per-source occurrence counts, and discard toggles"
                />
              </section>

              <section id="export" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Export
                </h2>
                <p className="font-code-md text-code-md text-secondary mb-6">
                  Checklist → Workbench → Export
                </p>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  Get the data out of the Workbench in whatever shape you need it, independent of
                  the formal Darwin Core publication flow.
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>Exports exactly the species currently visible in the table — filter first, then export just that slice.</li>
                  <li>Pick which fields to include: scientific name, taxonomy hierarchy, occurrence, sources, evidence, and review status.</li>
                  <li>
                    Choose CSV for plain text, or Excel — which{" "}
                    <Highlight>color-codes each row by taxonomy status</Highlight> (conflict,
                    synonym/unresolved, accepted) with a legend sheet included.
                  </li>
                </ul>
                <DocsImage
                  src="/res/docs/csv-export.png"
                  alt="The Export Species dialog with field selection and CSV/Excel format options"
                />
              </section>

              <section id="watcher" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Watcher
                </h2>
                <p className="font-code-md text-code-md text-secondary mb-6">
                  Checklist → Workbench → Status → Watcher
                </p>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  For checklists that stay active after the initial import, the Watcher keeps
                  checking so you don&apos;t have to.
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>
                    On a weekly or monthly schedule, it re-fetches occurrences from GBIF,
                    iNaturalist, and eBird (for checklists scoped to Aves).
                  </li>
                  <li>
                    Surfaces genuinely new candidate species and new observations on species
                    already in the checklist.
                  </li>
                  <li>
                    Collaborators you choose get an email and in-app alert whenever a run finds
                    something, with a results view to review it.
                  </li>
                  <li>
                    <Highlight>Nothing is added or updated automatically</Highlight> — every run
                    waits for a reviewer to apply it.
                  </li>
                </ul>
                <DocsImage
                  src="/res/docs/watcher-alert-email.png"
                  alt="A Watcher alert email showing new species observations found on a checklist"
                />
              </section>

              <section id="collaboration-invites" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Collaboration & Invites
                </h2>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  Getting a reviewer onto a checklist takes one line, not an account-provisioning
                  process.
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>Start typing a name — Checklist Hub searches existing profiles and suggests a match.</li>
                  <li>No match? Type a full email address to invite someone brand new.</li>
                  <li>
                    One click <Highlight>sends the invitation automatically</Highlight> — no
                    separate email tool.
                  </li>
                  <li>
                    Pending invites are tracked until accepted; owners can manage roles and remove
                    collaborators at any time.
                  </li>
                </ul>
                <DocsImage
                  src="/res/docs/invite-email.png"
                  alt="An email inviting a collaborator to a checklist"
                />
              </section>

              <section id="history-activity" className="py-10 md:py-12 border-b border-outline-variant">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  History & Activity
                </h2>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  Every decision on a checklist is <Highlight>provenance, not just a status flip</Highlight> — the
                  Workbench keeps a running record of who did what and when.
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>
                    <span className="font-bold text-on-surface">Recent Changes</span> — a live feed
                    of review-status changes, taxonomy votes, merges, and evidence updates.
                  </li>
                  <li>
                    <span className="font-bold text-on-surface">Recent Comments</span> — every
                    discussion post across the whole checklist, in one feed.
                  </li>
                  <li>
                    <span className="font-bold text-on-surface">History Timeline</span> — the full
                    activity log grouped by genus/taxon, so you can audit one branch of the tree at
                    a time.
                  </li>
                  <li>Every entry records the actor and a relative timestamp, so a decision made months ago is still traceable.</li>
                </ul>
              </section>

              <section id="discussion-pinging" className="py-10 md:py-12">
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  Discussion & Pinging
                </h2>
                <p className="font-body-sm text-body-sm text-secondary mb-4">
                  Conflicts get resolved in conversation, not in silence — every species has its
                  own real-time discussion thread.
                </p>
                <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5">
                  <li>Comment and reply in threads on any species, visible to every collaborator the moment it&apos;s posted.</li>
                  <li>
                    Type <span className="font-bold text-on-surface">@</span> to ping a specific
                    collaborator — <Highlight>they get notified directly</Highlight>.
                  </li>
                  <li>
                    Type <span className="font-bold text-on-surface">#</span> to reference another
                    species or an evidence source inline, linking straight to it.
                  </li>
                  <li>Attach files to a comment when a decision needs a supporting document.</li>
                </ul>
              </section>

              <section
                id="what-is-a-gbif-checklist"
                className="py-10 md:py-12 border-b border-outline-variant"
              >
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  What is a GBIF checklist?
                </h2>
                <div className="space-y-4 font-body-sm text-body-sm text-secondary">
                  <p>
                    A GBIF checklist is a <Highlight>dataset type</Highlight> on{" "}
                    <a
                      href="https://www.gbif.org"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      GBIF
                    </a>{" "}
                    (the Global Biodiversity Information Facility) — one of four kinds of dataset
                    GBIF recognizes, alongside occurrence, sampling-event, and metadata-only
                    datasets. Where an occurrence dataset records individual sightings or
                    specimens, a checklist records <Highlight>which taxa are known to occur</Highlight>{" "}
                    in a region or taxonomic group, each backed by a taxonomic concept rather than
                    a single observation.
                  </p>
                  <p>
                    Structurally, a checklist is published as a{" "}
                    <Highlight>Darwin Core Archive</Highlight> built around a Taxon core file —
                    one row per accepted name, with fields like scientific name, taxonomic rank,
                    and accepted-name usage — plus optional extensions such as Distribution,
                    VernacularName, or Species Profile that add region-specific occurrence status,
                    common names, or ecological attributes to each taxon.
                  </p>
                  <p>
                    Once published through a GBIF-registered{" "}
                    <Highlight>IPT (Integrated Publishing Toolkit)</Highlight>, a checklist gets
                    its own GBIF dataset page, a persistent DOI, and becomes queryable alongside
                    every other checklist on GBIF — which is what lets reconciliation tools (like
                    Checklist Hub&apos;s own Reconciliation view) compare one region&apos;s
                    checklist against another&apos;s.
                  </p>
                </div>
              </section>

              <section
                id="how-to-publish-darwin-core-archive-to-gbif"
                className="py-10 md:py-12 border-b border-outline-variant"
              >
                <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
                  How to publish a Darwin Core Archive to GBIF
                </h2>
                <div className="space-y-4 font-body-sm text-body-sm text-secondary mb-6">
                  <p>
                    Publishing a Darwin Core Archive (DwC-A) to GBIF means packaging your
                    validated checklist into GBIF&apos;s standard exchange format and submitting it
                    through an <Highlight>IPT</Highlight> — GBIF doesn&apos;t accept checklist
                    uploads directly, since the IPT is what registers the dataset, assigns it a
                    DOI, and keeps it re-harvestable whenever you publish an update.
                  </p>
                </div>
                <ol className="space-y-4">
                  <li className="flex gap-4 items-start">
                    <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
                      1
                    </span>
                    <div>
                      <span className="font-bold text-on-surface">Get the checklist review-ready</span>
                      <span className="text-secondary font-body-sm text-body-sm">
                        {" "}
                        — every species needs at least one reviewer&apos;s sign-off and no open
                        taxonomy conflicts. Checklist Hub&apos;s Publish → Validate step blocks
                        you here until that&apos;s true.
                      </span>
                    </div>
                  </li>
                  <li className="flex gap-4 items-start">
                    <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
                      2
                    </span>
                    <div>
                      <span className="font-bold text-on-surface">Get access to a GBIF-registered IPT</span>
                      <span className="text-secondary font-body-sm text-body-sm">
                        {" "}
                        — either your institution&apos;s own IPT installation, or one run by a
                        publishing partner (a national GBIF participant node, museum, or
                        university). If you don&apos;t have one yet, GBIF&apos;s{" "}
                        <a
                          href="https://www.gbif.org/ipt"
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline underline-offset-2 hover:opacity-80"
                        >
                          IPT page
                        </a>{" "}
                        explains how to request access through your country&apos;s GBIF node.
                      </span>
                    </div>
                  </li>
                  <li className="flex gap-4 items-start">
                    <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
                      3
                    </span>
                    <div>
                      <span className="font-bold text-on-surface">Fill in dataset metadata</span>
                      <span className="text-secondary font-body-sm text-body-sm">
                        {" "}
                        — title, description, contributors, and a license (GBIF requires CC0,
                        CC-BY, or CC-BY-NC). Checklist Hub&apos;s Publish → Metadata step collects
                        this before generating the package.
                      </span>
                    </div>
                  </li>
                  <li className="flex gap-4 items-start">
                    <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
                      4
                    </span>
                    <div>
                      <span className="font-bold text-on-surface">Generate the Darwin Core Archive</span>
                      <span className="text-secondary font-body-sm text-body-sm">
                        {" "}
                        — Checklist Hub builds the Taxon core file plus <Highlight>meta.xml</Highlight>{" "}
                        and <Highlight>eml.xml</Highlight> automatically and packages them into a
                        single zip, previewed in Publish → Review before you download it.
                      </span>
                    </div>
                  </li>
                  <li className="flex gap-4 items-start">
                    <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
                      5
                    </span>
                    <div>
                      <span className="font-bold text-on-surface">Upload it to the IPT and register</span>
                      <span className="text-secondary font-body-sm text-body-sm">
                        {" "}
                        — in Publish → IPT, pick the publisher org and installation, download the
                        package, and upload it as a resource on that IPT. The IPT publishes it,
                        GBIF harvests it, and it&apos;s assigned a dataset key and DOI.
                      </span>
                    </div>
                  </li>
                  <li className="flex gap-4 items-start">
                    <span className="font-code-md text-code-md text-primary font-bold w-6 shrink-0">
                      6
                    </span>
                    <div>
                      <span className="font-bold text-on-surface">Paste the published URL back</span>
                      <span className="text-secondary font-body-sm text-body-sm">
                        {" "}
                        — this marks the checklist <Highlight>Published</Highlight> in Checklist
                        Hub and records the DOI/citation against it for good.
                      </span>
                    </div>
                  </li>
                </ol>
                <div className="mt-8 border border-outline-variant bg-surface-container-low p-md">
                  <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
                    Common blocker
                  </p>
                  <p className="font-body-sm text-body-sm text-secondary">
                    No IPT access yet? You don&apos;t need to run your own — most national GBIF
                    participant nodes host a shared IPT for exactly this case. Reach out to your
                    country&apos;s node (listed on{" "}
                    <a
                      href="https://www.gbif.org"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      gbif.org
                    </a>
                    ) before assuming you need institutional infrastructure of your own.
                  </p>
                </div>
              </section>

              <p className="font-body-sm text-body-sm text-secondary pt-10">
                Stuck? Every step shows a readiness or blocker list before letting you proceed —
                fix what&apos;s flagged, then continue.
              </p>
            </div>
          </div>
        </section>
      </main>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TechArticle",
            headline: "How to Publish a Darwin Core Archive to GBIF",
            description:
              "Step-by-step guide to packaging a validated species checklist as a Darwin Core Archive and publishing it to GBIF through an IPT.",
            author: { "@id": "https://checklisthub.in/#founder" },
            publisher: { "@id": "https://checklisthub.in/#organization" },
            datePublished: "2026-07-04",
            dateModified: "2026-07-04",
            mainEntityOfPage: "https://checklisthub.in/docs#how-to-publish-darwin-core-archive-to-gbif",
          }),
        }}
      />

      <SiteFooter />
    </>
  );
}
