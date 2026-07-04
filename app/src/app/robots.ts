import type { MetadataRoute } from "next";

const DISALLOW = ["/api/", "/checklists", "/login", "/onboarding", "/auth"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        // Authenticated workbench, auth flows, and API routes have nothing
        // useful to index and would otherwise burn crawl budget on pages that
        // 30x/40x for an unauthenticated crawler.
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
      // Explicit allow-lines for AI crawlers so a future blanket-block
      // default doesn't silently cut off AI-answer-engine citations.
      { userAgent: "GPTBot", allow: "/", disallow: DISALLOW },
      { userAgent: "OAI-SearchBot", allow: "/", disallow: DISALLOW },
      { userAgent: "ClaudeBot", allow: "/", disallow: DISALLOW },
      { userAgent: "PerplexityBot", allow: "/", disallow: DISALLOW },
      { userAgent: "Google-Extended", allow: "/", disallow: DISALLOW },
    ],
    sitemap: "https://checklisthub.in/sitemap.xml",
  };
}
