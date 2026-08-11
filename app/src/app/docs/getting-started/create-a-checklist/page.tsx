import type { Metadata } from "next";
import FramedScreenshot from "@/components/docs/FramedScreenshot";
import DocsStepNav from "@/components/docs/DocsStepNav";

export const metadata: Metadata = {
  title: "Create your first checklist — Docs",
  description:
    "A full walkthrough of building a checklist in Checklist Hub: define scope, import data, validate, collaborate, review in the Workbench, and publish to GBIF.",
  alternates: { canonical: "/docs/getting-started/create-a-checklist" },
};

export default function CreateAChecklistPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Create your first checklist
      </h2>
      <p className="font-label-caps text-[11px] tracking-wider uppercase text-on-surface-variant mb-6 flex items-center gap-1.5">
        <span>Checklists</span>
        <span className="text-outline-variant">/</span>
        <span className="text-primary">New</span>
      </p>
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        This walks through building a checklist from the first screen to publication.
        Open Checklist Hub in another tab and follow along step by step — use Next below
        to move through each step, with the full detail and screenshots on its own page.
      </p>

      <div className="border-b border-outline-variant pb-10 mb-10">
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-1.5">
            <p className="font-label-caps text-[11px] tracking-wider uppercase text-primary/70 shrink-0">
              Step 0
            </p>
            <span className="w-10 border-t border-primary/25" />
          </div>
          <h3 className="font-code-md text-[19px] tracking-tight text-primary/70">
            Sign in and create a checklist
          </h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
          <div className="w-full max-w-[95%] mx-auto lg:mx-0">
            <FramedScreenshot
              src="/res/docs/landing-page-full-2x.png"
              alt="Checklist Hub landing page, with Sign In in the top right and Create Checklist below the headline"
            />
          </div>
          <ol className="flex flex-col lg:h-full">
            <li className="flex gap-4 items-baseline pb-6 border-b border-outline-variant">
              <span className="font-code-md text-code-md text-primary font-bold shrink-0">
                1
              </span>
              <div>
                <h4 className="font-body-sm text-[15px] font-semibold text-on-surface mb-1.5">
                  Sign in
                </h4>
                <p className="font-body-sm text-body-sm text-secondary">
                  Using <span className="font-bold text-on-surface">email</span>,{" "}
                  <span className="font-bold text-on-surface">Google</span>, or{" "}
                  <span className="font-bold text-on-surface">ORCID</span>.
                </p>
              </div>
            </li>
            <li className="flex gap-4 items-baseline pt-6">
              <span className="font-code-md text-code-md text-primary font-bold shrink-0">
                2
              </span>
              <div>
                <h4 className="font-body-sm text-[15px] font-semibold text-on-surface mb-1.5">
                  Create checklist
                </h4>
                <p className="font-body-sm text-body-sm text-secondary">
                  Click Create Checklist to open the wizard and start the first step,
                  Define the taxa and region.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>

      <DocsStepNav
        back={{ href: "/docs/getting-started/what-is-checklist-hub", label: "What is Checklist Hub?" }}
        next={{ href: "/docs/getting-started/define-scope", label: "Define scope and taxa" }}
      />
    </section>
  );
}
