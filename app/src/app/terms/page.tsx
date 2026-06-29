import SiteNavbar from "@/components/shared/SiteNavbar";
import SiteFooter from "@/components/shared/SiteFooter";

const sections = [
  {
    title: "1. Acceptance of Terms",
    body: "By accessing or using Checklist Hub, you agree to be bound by these Terms of Service. If you do not agree, do not use the platform.",
  },
  {
    title: "2. The Service",
    body: "Checklist Hub provides tools to import, validate, review, and publish species checklists, including taxonomic validation, evidence aggregation, collaborative review, and Darwin Core Archive / IPT publication.",
  },
  {
    title: "3. Accounts",
    body: "You are responsible for the activity that occurs on your account and for keeping your access credentials secure. You must provide accurate information when creating checklists or inviting collaborators.",
  },
  {
    title: "4. Your Content",
    body: "You retain ownership of the species data, evidence, and checklists you upload. By publishing a checklist through Checklist Hub, you confirm you have the right to share that data and agree it may be submitted to GBIF or other registries you select.",
  },
  {
    title: "5. Expert Review",
    body: "Checklist Hub organizes and presents evidence to support taxonomic decisions, but it does not make those decisions. Every accepted species reflects the judgment of the reviewers on that checklist, not an automated determination by the platform.",
  },
  {
    title: "6. Acceptable Use",
    body: "You agree not to misuse the platform — including submitting fraudulent data, infringing on third-party rights, or attempting to disrupt the service.",
  },
  {
    title: "7. Availability",
    body: "We aim to keep Checklist Hub available and reliable but do not guarantee uninterrupted access. Features may change as the platform evolves.",
  },
  {
    title: "8. Disclaimer of Liability for Data Accuracy",
    body: "Checklist Hub aggregates and presents species data, evidence, and taxonomic information from third-party sources and user submissions. We do not warrant the accuracy, completeness, or currency of any data on the platform. Checklist Hub is not liable for any loss, damage, or consequence arising from reliance on incorrect, outdated, or incomplete data, whether sourced from third parties or entered by users or reviewers.",
  },
  {
    title: "9. Changes to These Terms",
    body: "We may update these Terms from time to time. Continued use of Checklist Hub after changes take effect constitutes acceptance of the revised Terms.",
  },
  {
    title: "10. Contact",
    body: "Questions about these Terms can be sent to checklisthub.review@gmail.com.",
  },
];

export default function TermsPage() {
  return (
    <>
      <SiteNavbar />

      <main className="bg-surface">
        <section className="py-16 md:py-24">
          <div className="w-full px-xl max-w-3xl">
            <div className="w-16 h-1.5 bg-primary mb-lg" />
            <h1 className="font-headline-lg text-headline-lg uppercase tracking-tighter font-bold mb-md">
              Terms of Service
            </h1>
            <p className="font-body-sm text-body-sm text-secondary mb-xl">
              Last updated: 2026
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
