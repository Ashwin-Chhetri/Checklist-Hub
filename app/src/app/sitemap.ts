import type { MetadataRoute } from "next";

// Bump a page's date here when its content actually changes — do not
// replace with `new Date()`. A timestamp that always reads "now" tells
// Google nothing about real freshness and reads as a low-quality signal.
const LAST_EDITED = {
  home: "2026-07-04",
  about: "2026-07-04",
  docs: "2026-07-04",
  contact: "2026-07-04",
  terms: "2026-07-04",
  privacy: "2026-07-04",
};

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://checklisthub.in";

  return [
    { url: `${base}/`, lastModified: LAST_EDITED.home, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, lastModified: LAST_EDITED.about, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/docs`, lastModified: LAST_EDITED.docs, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/contact`, lastModified: LAST_EDITED.contact, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: LAST_EDITED.terms, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, lastModified: LAST_EDITED.privacy, changeFrequency: "yearly", priority: 0.2 },
  ];
}
