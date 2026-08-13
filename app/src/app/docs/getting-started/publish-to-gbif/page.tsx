import type { Metadata } from "next";
import Link from "next/link";
import Highlight from "@/components/docs/Highlight";
import DocsBreadcrumb from "@/components/docs/DocsBreadcrumb";
import DocsStepNav from "@/components/docs/DocsStepNav";
import DocsStepWalkthrough from "@/components/docs/DocsStepWalkthrough";

export const metadata: Metadata = {
  title: "Publish to GBIF — Docs",
  description:
    "Set a publisher and IPT, publish the Darwin Core Archive through it, and register the dataset back in Checklist Hub.",
  alternates: { canonical: "/docs/getting-started/publish-to-gbif" },
};

export default function PublishToGbifPage() {
  return (
    <section className="py-6 md:py-8">
      <h2 className="font-headline-md text-[22px] uppercase tracking-tight mb-2">
        Publish to GBIF
      </h2>
      <DocsBreadcrumb items={["Checklists", "Publish"]} />
      <p className="font-body-sm text-body-sm text-secondary mb-10 max-w-2xl">
        Publishing goes through a GBIF-registered IPT (Integrated Publishing Toolkit) —
        GBIF doesn&apos;t accept checklist uploads directly. Click through the five steps
        below to see each screen.
      </p>

      <DocsStepWalkthrough
        defaultScreen={{
          src: "/res/docs/publish/publisher.JPG",
          alt: "The Publisher step, showing the organization and contact that GBIF will credit for the dataset",
          aspect: "1909 / 932",
        }}
        variant="full"
        steps={[
          {
            title: "Publisher",
            target: { x: 64, y: 30 },
            body: (
              <>
                A <Highlight>publisher</Highlight> is simply whoever GBIF holds
                accountable for the dataset — the organization or person it credits
                and contacts. Every checklist needs one attached before GBIF will
                register it. See{" "}
                <Link
                  href="/docs/reference/terminology#publisher"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  Publisher
                </Link>{" "}
                in the glossary, or{" "}
                <a
                  href="https://www.gbif.org/become-a-publisher"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  register directly with GBIF
                </a>{" "}
                if your organization isn&apos;t endorsed yet.
              </>
            ),
            screen: {
              src: "/res/docs/publish/publisher.JPG",
              alt: "The Publisher step, showing the organization and contact that GBIF will credit for the dataset",
              aspect: "1909 / 932",
            },
          },
          {
            title: "Publishing Partner",
            target: { x: 66, y: 26 },
            body: (
              <>
                Based on the checklist&apos;s region, Checklist Hub lists the nearby{" "}
                <Highlight>GBIF-registered publishers</Highlight> that can host it — a
                national GBIF node, museum, or university running its own IPT — so you
                don&apos;t have to go hunting for one yourself. See{" "}
                <Link
                  href="/docs/reference/terminology#publishing-partner"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  Publishing Partner
                </Link>{" "}
                for why you&apos;d use one instead of your own IPT.
              </>
            ),
            screen: {
              src: "/res/docs/publish/publishing-partner.JPG",
              alt: "The Publishing Partner step, listing GBIF-registered IPT publishers near the checklist's region",
              aspect: "1899 / 935",
            },
          },
          {
            title: "Package",
            target: { x: 49, y: 41 },
            body: (
              <>
                A readiness checklist — <Highlight>Metadata Complete</Highlight>,{" "}
                <Highlight>Taxonomy Validated</Highlight>,{" "}
                <Highlight>Citation Ready</Highlight>, DwC-A and EML generated — then
                download the package before moving on. In plain terms, a{" "}
                <Highlight>Darwin Core Archive (DwC-A)</Highlight> is just a zip file
                built the way GBIF expects it: one master species list plus a couple
                of housekeeping files that tell GBIF how to read the rest. See{" "}
                <Link
                  href="/docs/publishing/darwin-core-archive#darwin-core"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  Darwin Core Archive
                </Link>{" "}
                for what&apos;s inside it.
              </>
            ),
            screen: {
              src: "/res/docs/publish/dwc-package.JPG",
              alt: "The Package step, showing the publication readiness checklist and a Download Package button",
              aspect: "1905 / 907",
            },
          },
          {
            title: "Publish",
            target: { x: 67, y: 33 },
            body: (
              <>
                Upload the package to the IPT and publish it there — the IPT is what
                actually registers the dataset with GBIF. An{" "}
                <Highlight>IPT (Integrated Publishing Toolkit)</Highlight> is GBIF&apos;s
                own upload software; every dataset has to pass through one, since GBIF
                doesn&apos;t accept files directly. See{" "}
                <Link
                  href="/docs/publishing/darwin-core-archive#ipt"
                  className="text-primary underline underline-offset-2 hover:opacity-80"
                >
                  IPT
                </Link>{" "}
                for how to get access to one.
              </>
            ),
            screen: {
              src: "/res/docs/publish/publish.JPG",
              alt: "The Publish step, with instructions for uploading the Darwin Core Archive to the IPT and registering it",
              aspect: "1908 / 909",
            },
            subSteps: [
              { title: "Log in to the publishing partner's IPT." },
              { title: "Create a new resource, set its type to Checklist Dataset." },
              { title: "Import existing Darwin Core Archive, and upload the downloaded package." },
              { title: "The IPT reads the metadata automatically — review it on the resource's overview page." },
              { title: "Click Publish, then Register, to send the dataset to GBIF.org." },
              { title: "Copy the dataset's URL for the next step." },
            ],
          },
          {
            title: "Register",
            target: { x: 58, y: 27 },
            body: (
              <>
                Paste the dataset&apos;s URL back into Checklist Hub — this marks the
                checklist <Highlight>Published</Highlight> and records the DOI and
                citation against it for good.
              </>
            ),
            screen: {
              src: "/res/docs/publish/Register.JPG",
              alt: "The Register step, with a field to paste the dataset's URL from the IPT or GBIF.org",
              aspect: "1915 / 905",
            },
          },
        ]}
      />

      <p className="font-body-sm text-body-sm text-secondary mt-10">
        See{" "}
        <Link
          href="/docs/publishing/darwin-core-archive"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          Darwin Core, IPT &amp; GBIF
        </Link>{" "}
        for what a GBIF checklist dataset is and what&apos;s inside the archive.
      </p>
      <DocsStepNav
        back={{ href: "/docs/getting-started/darwin-core-format", label: "Darwin Core Format" }}
        next={{ href: "/docs/getting-started/checklist-organizer", label: "Checklist Organizer" }}
      />
    </section>
  );
}
