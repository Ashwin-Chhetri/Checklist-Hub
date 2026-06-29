import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="bg-surface-container-low border-t border-outline-variant py-16">
      <div className="w-full px-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-xl">
        <div className="flex flex-col gap-sm">
          <span className="font-headline-md text-headline-md text-primary tracking-tight font-bold">
            Checklist Hub
          </span>
          <p className="font-body-sm text-secondary font-code-md text-xs">
            © 2026 Checklist Hub. All rights reserved. Turning species lists into evidence-backed,
            publishable checklists.
          </p>
        </div>
        <div className="flex gap-xl">
          <Link
            className="text-secondary font-code-md text-code-md hover:text-primary transition-all underline underline-offset-4"
            href="/about"
          >
            About
          </Link>
          <Link
            className="text-secondary font-code-md text-code-md hover:text-primary transition-all underline underline-offset-4"
            href="/terms"
          >
            Terms of Service
          </Link>
          <Link
            className="text-secondary font-code-md text-code-md hover:text-primary transition-all underline underline-offset-4"
            href="/contact"
          >
            Contact Us
          </Link>
        </div>
      </div>
    </footer>
  );
}
