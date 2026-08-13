import type { Metadata } from "next";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";

export const metadata: Metadata = {
  title: "AI MCP & Chat Box — Docs",
  description:
    "An MCP for Checklist Hub, so your checklist's species, evidence, and review status are reachable from whatever AI chat interface you already use.",
  alternates: { canonical: "/docs/features/ai-mcp" },
};

export default function AiMcpPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        AI MCP &amp; Chat Box
      </h2>
      <DocsBreadcrumb items={["Checklist", "Workbench", "AI MCP & Chat Box"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-4 max-w-2xl">
        What could you ask your checklist if you didn&apos;t have to click through the
        Workbench to find out?
      </p>
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        We&apos;re building an <Highlight>MCP </Highlight>  for Checklist Hub. MCP (Model Context Protocol) is what lets an AI chat assistant reach outside its own
        conversation and pull in outside tools and data. Once ours is ready, you&apos;ll
        plug the Checklist Hub MCP into whatever chat interface you already work in, and
        the checklist you&apos;re working on comes with you: the same species, evidence,
        and review status you&apos;d see in the Workbench, reachable from a chat window.
      </p>

      <div className="max-w-2xl">
        <h3 className="font-body-sm text-[15px] font-semibold text-on-surface mb-3">
          A few things this should make possible once it&apos;s live
        </h3>
        <ul className="space-y-3 font-body-sm text-body-sm text-secondary list-disc pl-5 mb-10">
          <li>
            Ask for an infographic, species counts by family or order, an
            evidence-strength breakdown, a map of where occurrences cluster, and get it
            charted straight from your checklist data, no export to a spreadsheet
            first.
          </li>
          <li>
            Ask a question instead of building a view for it: which species are still
            sitting at Low evidence, how this list compares to the last published
            version, what changed in the latest Watcher run.
          </li>
          <li>
            Ask it to draft something grounded in your own evidence: a species
            description, a metadata abstract, a funder update summarizing a Watcher
            run, talking points before a collaboration discussion.
          </li>
          <li>
            Follow up the way you would with a colleague sitting next to you, instead
            of reopening a dialog or rerunning a search for every new angle on the same
            question.
          </li>
        </ul>
      </div>

      <div className="border border-outline-variant bg-surface-container-low p-md max-w-2xl">
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">
          Coming soon
        </p>
        <p className="font-body-sm text-body-sm text-secondary">
          This is early. We&apos;re still working out which parts of the Workbench,
          Evidence, and Watcher data make sense to hand to an MCP client before building
          the server itself.
        </p>
      </div>
    </section>
  );
}
