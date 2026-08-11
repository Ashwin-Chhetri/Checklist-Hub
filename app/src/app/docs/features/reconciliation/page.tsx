import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";

export const metadata: Metadata = {
  title: "Reconciliation — Docs",
  description:
    "Compare a checklist's species against other published checklists to surface conflicts before you publish.",
  alternates: { canonical: "/docs/features/reconciliation" },
};

export default function ReconciliationPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-8">
        Reconciliation
      </h2>
      <p className="font-body-sm text-body-sm text-secondary mb-4">
        Would another regional checklist disagree with the one you&apos;re about to
        publish? Reconciliation compares your checklist&apos;s species against other
        published GBIF checklists for the same region or taxon group, surfacing{" "}
        <Highlight>conflicts</Highlight> — a species present in one list but not
        another, or classified differently — so they can be resolved before you publish
        rather than discovered afterward.
      </p>
      <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5 mb-6">
        <li>
          A conflict isn&apos;t automatically an error. It&apos;s a flag that two
          published sources disagree, and a reviewer needs to decide which one reflects
          the current understanding of the region or taxon group.
        </li>
        <li>
          Checking against other checklists before publication catches the kind of
          disagreement that&apos;s much harder to untangle once both datasets are live
          on GBIF and other people are already citing them.
        </li>
        <li>
          Because reconciliation runs against GBIF&apos;s own published checklists, the
          comparison stays current with what&apos;s actually registered — not a static
          snapshot from when you first imported.
        </li>
      </ul>
      <div className="border border-outline-variant bg-surface-container-low p-md">
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
          Coming soon
        </p>
        <p className="font-body-sm text-body-sm text-secondary">
          A full walkthrough of the Reconciliation view, with screenshots, is being
          written up.
        </p>
      </div>
    </section>
  );
}
