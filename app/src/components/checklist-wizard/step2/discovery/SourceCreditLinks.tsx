import type { SourceKey } from "@/modules/evidence/discovery/types";
import { SOURCE_HOMEPAGE, SOURCE_TEXT_COLOR } from "@/modules/evidence/discovery/sourceColors";

/** Comma-separated source names, each linking out to that source's own homepage and colored to match its theme. */
export function SourceCreditLinks({ sources, labels }: { sources: SourceKey[]; labels: Record<SourceKey, string> }) {
  return (
    <>
      {sources.map((key, i) => (
        <span key={key}>
          {SOURCE_HOMEPAGE[key] ? (
            <a
              href={SOURCE_HOMEPAGE[key]}
              target="_blank"
              rel="noopener noreferrer"
              className={`italic underline ${SOURCE_TEXT_COLOR[key]} hover:opacity-75`}
            >
              {labels[key]}
            </a>
          ) : (
            <span className="italic underline">{labels[key]}</span>
          )}
          {i < sources.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
}
