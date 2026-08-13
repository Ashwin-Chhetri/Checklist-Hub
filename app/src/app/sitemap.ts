import type { MetadataRoute } from "next";

// Bump a page's date here when its content actually changes — do not
// replace with `new Date()`. A timestamp that always reads "now" tells
// Google nothing about real freshness and reads as a low-quality signal.
const LAST_EDITED = {
  home: "2026-07-04",
  about: "2026-07-04",
  docs: "2026-08-11",
  contact: "2026-07-04",
  terms: "2026-07-04",
  privacy: "2026-07-04",
};

const DOCS_ROUTES = [
  "",
  "getting-started/what-is-checklist-hub",
  "getting-started/checklist-organizer",
  "getting-started/create-a-checklist",
  "getting-started/define-scope",
  "getting-started/import-data",
  "getting-started/validate-species",
  "getting-started/collaborate",
  "getting-started/workbench",
  "getting-started/define-metadata",
  "getting-started/darwin-core-format",
  "getting-started/publish-to-gbif",
  "features/workbench",
  "features/evidence",
  "features/reconciliation",
  "features/watcher",
  "features/export",
  "features/history",
  "features/collaboration",
  "features/ai-mcp",
  "publishing/darwin-core-archive",
  "publishing/troubleshooting",
  "reference/faq",
  "reference/terminology",
  "reference/citation",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://checklisthub.in";

  return [
    { url: `${base}/`, lastModified: LAST_EDITED.home, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, lastModified: LAST_EDITED.about, changeFrequency: "monthly", priority: 0.7 },
    ...DOCS_ROUTES.map((route) => ({
      url: `${base}/docs${route ? `/${route}` : ""}`,
      lastModified: LAST_EDITED.docs,
      changeFrequency: "monthly" as const,
      priority: route ? 0.6 : 0.7,
    })),
    { url: `${base}/contact`, lastModified: LAST_EDITED.contact, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: LAST_EDITED.terms, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, lastModified: LAST_EDITED.privacy, changeFrequency: "yearly", priority: 0.2 },
  ];
}
