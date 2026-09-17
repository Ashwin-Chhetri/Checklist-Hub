"use client";

/**
 * Custom glyph (not a Material Symbol — nothing in that set reads as "list vs.
 * map") for opening the List/Map dialog: a card split by a dashed divider,
 * list rows on the left, a map pin on the right — the two views this button
 * switches between.
 */
function ListMapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" />
      <line x1="5" y1="9" x2="9.5" y2="9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="5" y1="12.5" x2="9.5" y2="12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="5" y1="16" x2="8" y2="16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M17 8.5c1.4 0 2.5 1.1 2.5 2.5 0 1.8-2.5 4.5-2.5 4.5s-2.5-2.7-2.5-4.5c0-1.4 1.1-2.5 2.5-2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="11" r="0.9" fill="currentColor" />
    </svg>
  );
}

interface MapViewButtonProps {
  onClick: () => void;
  /** "labeled" (icon + "Map" text, btn-secondary) for the workbench toolbar;
   * "icon" (icon-only, for a narrow table cell) for the checklist listing column;
   * "icon-labeled" (icon + small "Map view" caption stacked below) for the checklist
   * listing table's MAP column, where a bare icon reads as unclear on its own. */
  variant?: "labeled" | "icon" | "icon-labeled";
  className?: string;
  title?: string;
}

export default function MapViewButton({
  onClick,
  variant = "labeled",
  className = "",
  title = "Region & species map",
}: MapViewButtonProps) {
  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-sm border border-outline text-on-surface-variant hover:text-primary hover:border-primary transition-colors ${className}`}
      >
        <ListMapIcon />
      </button>
    );
  }
  if (variant === "icon-labeled") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`inline-flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-sm border border-outline text-on-surface-variant hover:text-primary hover:border-primary transition-colors ${className}`}
      >
        <ListMapIcon />
        <span className="font-label-caps text-[9px] font-bold uppercase tracking-wider leading-none">
          Map view
        </span>
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className={`btn-secondary ${className}`}>
      <ListMapIcon />
      Map
    </button>
  );
}
