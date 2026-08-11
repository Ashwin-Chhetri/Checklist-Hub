import Link from "next/link";

interface StepLink {
  href: string;
  label: string;
}

const secondaryBtn =
  "inline-flex items-center gap-2 border border-outline-variant rounded-sm px-4 py-2.5 font-code-md text-code-md text-on-surface-variant hover:border-primary hover:text-primary transition-colors";

export default function DocsStepNav({ back, next }: { back?: StepLink; next?: StepLink }) {
  if (!back && !next) return null;

  return (
    <div className="mt-10 pt-8 border-t border-outline-variant flex items-center justify-between gap-4">
      {back ? (
        <Link href={back.href} className={secondaryBtn}>
          <span aria-hidden>←</span>
          <span>{back.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} className={secondaryBtn}>
          <span>{next.label}</span>
          <span aria-hidden>→</span>
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
