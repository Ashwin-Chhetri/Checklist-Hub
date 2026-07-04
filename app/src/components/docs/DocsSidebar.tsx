"use client";

import { useEffect, useState } from "react";

interface NavLink {
  slug: string;
  label: string;
  icon: string;
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    links: [
      { slug: "introduction", label: "Introduction", icon: "info" },
      { slug: "how-it-works", label: "How it works", icon: "route" },
      { slug: "create-a-checklist", label: "Create a checklist", icon: "add_circle" },
      { slug: "review-species", label: "Review species", icon: "fact_check" },
      { slug: "publish", label: "Publish", icon: "cloud_upload" },
      { slug: "watch-a-checklist", label: "Watch a checklist", icon: "visibility" },
    ],
  },
  {
    label: "Components",
    links: [
      { slug: "checklist-organizer", label: "Checklist Organizer", icon: "table_view" },
      { slug: "workbench", label: "Workbench", icon: "dashboard" },
      { slug: "evidence", label: "Evidence", icon: "science" },
      { slug: "export", label: "Export", icon: "file_download" },
      { slug: "watcher", label: "Watcher", icon: "radar" },
      { slug: "collaboration-invites", label: "Collaboration & Invites", icon: "group_add" },
      { slug: "history-activity", label: "History & Activity", icon: "history" },
      { slug: "discussion-pinging", label: "Discussion & Pinging", icon: "forum" },
    ],
  },
];

const highlights = [
  { href: "#collaboration-invites", icon: "group_add", text: "Email invites" },
  { href: "#discussion-pinging", icon: "forum", text: "Live @ pings" },
  { href: "#watcher", icon: "radar", text: "Auto Watcher" },
  { href: "#history-activity", icon: "history", text: "Full history" },
];

const allSlugs = navGroups.flatMap((group) => group.links.map((link) => link.slug));

export default function DocsSidebar() {
  const [activeSlug, setActiveSlug] = useState<string>(allSlugs[0]);

  useEffect(() => {
    const SCROLL_OFFSET = 120;

    function updateActiveSlug() {
      let current = allSlugs[0];
      for (const slug of allSlugs) {
        const el = document.getElementById(slug);
        if (el && el.getBoundingClientRect().top - SCROLL_OFFSET <= 0) {
          current = slug;
        }
      }
      setActiveSlug(current);
    }

    updateActiveSlug();
    window.addEventListener("scroll", updateActiveSlug, { passive: true });
    return () => window.removeEventListener("scroll", updateActiveSlug);
  }, []);

  return (
    <aside className="w-full md:w-60 md:shrink-0 md:sticky md:top-24">
      <div>
        {navGroups.map((group, i) => (
          <div key={group.label} className={i > 0 ? "mt-6 pt-4 border-t border-outline-variant" : undefined}>
            <p className="workbench-sidebar-section-title">{group.label}</p>
            <ul className="space-y-0.5">
              {group.links.map((link) => {
                const isActive = link.slug === activeSlug;
                return (
                  <li key={link.slug}>
                    <a
                      href={`#${link.slug}`}
                      className={`workbench-sidebar-item ${isActive ? "workbench-sidebar-item-active" : ""}`}
                    >
                      <span className="workbench-sidebar-item-left">
                        <span
                          className="material-symbols-outlined workbench-sidebar-icon"
                          style={isActive ? { color: "var(--color-primary-container)" } : undefined}
                        >
                          {link.icon}
                        </span>
                        <span className="truncate">{link.label}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-outline-variant">
        <p className="workbench-sidebar-section-title">Built for teams</p>
        <div className="flex flex-col gap-1.5">
          {highlights.map((h) => (
            <a
              key={h.href}
              href={h.href}
              className="flex items-center gap-1.5 border border-outline-variant rounded-sm px-2 py-1.5 text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined text-[14px] shrink-0">{h.icon}</span>
              <span className="font-code-md text-[11px] truncate">{h.text}</span>
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
}
