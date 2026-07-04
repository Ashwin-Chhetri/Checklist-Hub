import type { Metadata } from "next";
import Link from "next/link";
import SiteNavbar from "@/components/shared/SiteNavbar";
import SiteFooter from "@/components/shared/SiteFooter";

export const metadata: Metadata = {
  title: "About",
  description:
    "Checklist Hub turns raw species lists into evidence-based, reviewer-approved checklists — validated taxonomy, aggregated evidence, and a transparent decision trail, published straight to GBIF.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <SiteNavbar />

      <main className="bg-surface">
        <section className="py-16 md:py-24">
          <div className="w-full px-xl max-w-3xl">
            <div className="w-16 h-1.5 bg-primary mb-lg" />
            <h1 className="font-headline-lg text-headline-lg uppercase tracking-tighter font-bold mb-lg">
              About Checklist Hub
            </h1>

            <p className="font-body-lg text-body-lg text-secondary leading-relaxed mb-xl">
              Checklist Hub helps biodiversity experts validate, review, and publish species
              checklists through evidence-based taxonomic workflows. Our objective is simple:
              turn raw species lists into defensible scientific checklists — backed by evidence,
              validated taxonomy, expert review, and a transparent decision trail — and get them
              published to GBIF without the manual spreadsheet-and-email grind.
            </p>

            <p className="font-body-lg text-body-lg text-secondary leading-relaxed mb-xl">
              We don&apos;t replace experts. We gather, organize, and validate the information
              experts need so they can make informed taxonomic decisions faster, together, and
              with a record of why each species was included.
            </p>

            <div className="border border-outline-variant bg-white p-lg mb-xl">
              <h2 className="font-headline-md text-[18px] uppercase tracking-tight mb-3">
                Built by
              </h2>
              <p className="font-body-sm text-body-sm text-secondary">
                Checklist Hub is built by{" "}
                <a
                  href="mailto:ashwinchhetri272@gmail.com"
                  className="text-primary underline underline-offset-4 hover:opacity-80"
                >
                  Ashwin Chhetri
                </a>
                .
              </p>
            </div>

            <div className="border border-outline-variant bg-white p-lg">
              <h2 className="font-headline-md text-[18px] uppercase tracking-tight mb-3">
                Get in touch
              </h2>
              <p className="font-body-sm text-body-sm text-secondary mb-4">
                Questions, feedback, or partnership inquiries — we&apos;d like to hear from you.
              </p>
              <Link
                href="/contact"
                className="text-primary font-code-md text-code-md underline underline-offset-4 hover:opacity-80"
              >
                Contact Us →
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
