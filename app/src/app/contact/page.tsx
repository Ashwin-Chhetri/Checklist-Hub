import SiteNavbar from "@/components/shared/SiteNavbar";
import SiteFooter from "@/components/shared/SiteFooter";

const CONTACT_EMAIL = "checklisthub.review@gmail.com";

export default function ContactPage() {
  return (
    <>
      <SiteNavbar />

      <main className="bg-surface">
        <section className="py-16 md:py-24">
          <div className="w-full px-xl max-w-3xl">
            <div className="w-16 h-1.5 bg-primary mb-lg" />
            <h1 className="font-headline-lg text-headline-lg uppercase tracking-tighter font-bold mb-lg">
              Contact Us
            </h1>

            <p className="font-body-lg text-body-lg text-secondary leading-relaxed mb-xl">
              For support, feedback, or partnership inquiries, reach us directly by email.
            </p>

            <div className="border border-outline-variant bg-white p-lg hard-shadow inline-flex flex-col gap-2">
              <span className="font-code-md text-code-md text-secondary uppercase tracking-wide">
                Email
              </span>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-headline-md text-[20px] text-primary hover:opacity-80 transition-opacity break-all"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
