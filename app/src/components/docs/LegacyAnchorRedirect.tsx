"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The docs page used to be one long scrolling page with anchor links
// (e.g. /docs#watcher). Fragments never reach the server, so next.config
// redirects can't catch these — this runs client-side on the new /docs
// landing page and forwards known old anchors to their new route.
const LEGACY_ANCHOR_MAP: Record<string, string> = {
  introduction: "/docs/getting-started/what-is-checklist-hub",
  "create-a-checklist": "/docs/getting-started/create-a-checklist",
  "review-species": "/docs/getting-started/validate-species",
  publish: "/docs/getting-started/publish-to-gbif",
  "watch-a-checklist": "/docs/features/watcher",
  "checklist-organizer": "/docs/getting-started/checklist-organizer",
  workbench: "/docs/features/workbench",
  evidence: "/docs/features/evidence",
  export: "/docs/features/export",
  watcher: "/docs/features/watcher",
  "collaboration-invites": "/docs/features/collaboration",
  "history-activity": "/docs/features/history",
  "discussion-pinging": "/docs/features/collaboration#discussion",
  "what-is-a-gbif-checklist": "/docs/publishing/darwin-core-archive#gbif",
  "how-to-publish-darwin-core-archive-to-gbif": "/docs/publishing/darwin-core-archive#darwin-core",
  "citing-checklist-hub": "/docs/reference/citation",
  faq: "/docs/reference/faq",
};

export default function LegacyAnchorRedirect() {
  const router = useRouter();

  useEffect(() => {
    const slug = window.location.hash.slice(1);
    const destination = LEGACY_ANCHOR_MAP[slug];
    if (destination) router.replace(destination);
  }, [router]);

  return null;
}
