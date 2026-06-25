import type { SourceKey } from "./types";

// Confirmed via GBIF's own logo guidelines: brand green is Pantone 362C / #509e2f.
// iNaturalist's brand is also green (their logo is a green leaf/icon) — #74ac00
// is the long-standing green from their open-source styleguide, distinct enough
// from GBIF's more forest-toned green to stay visually separable side by side.
// eBird (Cornell Lab of Ornithology) is NOT green — its identity is teal/blue;
// an exact official hex wasn't confirmable from public sources, so a standard
// Tailwind teal is used as a close, clearly-non-green stand-in.
// NOTE: Tailwind's class scanner needs these as literal strings (not built
// from interpolated constants) to generate the arbitrary-value utilities.

/** Per-source accent colors, shared across the inventory summary, table, and chart. */
export const SOURCE_ACCENT: Record<SourceKey, string> = {
  gbif: "border-l-4 border-l-[#509e2f]",
  ebird: "border-l-4 border-l-teal-600",
  inaturalist: "border-l-4 border-l-[#74ac00]",
  literature: "border-l-4 border-l-purple-500",
};

/** Hex equivalents of SOURCE_ACCENT, for use in SVG/canvas charts. */
export const SOURCE_HEX: Record<SourceKey, string> = {
  gbif: "#509e2f",
  ebird: "#0d9488",
  inaturalist: "#74ac00",
  literature: "#a855f7",
};

/** Each source's own landing page, for crediting them inline in copy. */
export const SOURCE_HOMEPAGE: Record<SourceKey, string> = {
  gbif: "https://www.gbif.org/",
  ebird: "https://ebird.org/",
  inaturalist: "https://www.inaturalist.org/",
  literature: "",
};

/** Text color matching SOURCE_ACCENT, for crediting a source inline in copy. */
export const SOURCE_TEXT_COLOR: Record<SourceKey, string> = {
  gbif: "text-[#509e2f]",
  ebird: "text-teal-600",
  inaturalist: "text-[#74ac00]",
  literature: "text-purple-600",
};

/** Light background tint matching SOURCE_ACCENT, for the per-source stat boxes. */
export const SOURCE_BG_TINT: Record<SourceKey, string> = {
  gbif: "bg-[#509e2f]/10",
  ebird: "bg-teal-50",
  inaturalist: "bg-[#74ac00]/10",
  literature: "bg-purple-50",
};
