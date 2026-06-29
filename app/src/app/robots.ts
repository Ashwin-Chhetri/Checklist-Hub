import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authenticated workbench, auth flows, and API routes have nothing
      // useful to index and would otherwise burn crawl budget on pages that
      // 30x/40x for an unauthenticated crawler.
      disallow: ["/api/", "/checklists", "/login", "/onboarding", "/auth"],
    },
    sitemap: "https://checklisthub.in/sitemap.xml",
  };
}
