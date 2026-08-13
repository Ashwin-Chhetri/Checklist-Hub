"use client";

import { forwardRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLink {
  href: string;
  label: string;
  icon?: string;
  image?: string;
  children?: NavLink[];
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

const navGroups: NavGroup[] = [
  {
    label: "Getting Started",
    links: [
      { href: "/docs", label: "Overview", icon: "auto_stories" },
      { href: "/docs/getting-started/what-is-checklist-hub", label: "What is Checklist Hub?", image: "/res/landing/checklist_hub_logo.png" },
      {
        href: "/docs/getting-started/create-a-checklist",
        label: "Create your first checklist",
        icon: "add_circle",
        children: [
          { href: "/docs/getting-started/define-scope", label: "Define taxa and region", icon: "travel_explore" },
          { href: "/docs/getting-started/import-data", label: "Import data", icon: "upload_file" },
          { href: "/docs/getting-started/validate-species", label: "Review species", icon: "fact_check" },
          { href: "/docs/getting-started/collaborate", label: "Collaborate", icon: "group_add" },
          { href: "/docs/getting-started/workbench", label: "Workbench", icon: "dashboard" },
          { href: "/docs/getting-started/define-metadata", label: "Define Metadata", icon: "description" },
          { href: "/docs/getting-started/darwin-core-format", label: "Darwin Core Format", icon: "folder_zip" },
          { href: "/docs/getting-started/publish-to-gbif", label: "Publish to GBIF", icon: "cloud_upload" },
          { href: "/docs/getting-started/checklist-organizer", label: "Checklist Organizer", icon: "table_view" },
        ],
      },
    ],
  },
  {
    label: "Features",
    links: [
      { href: "/docs/features/workbench", label: "Workbench", icon: "dashboard" },
      { href: "/docs/features/evidence", label: "Evidence", icon: "science" },
      { href: "/docs/features/reconciliation", label: "Reconciliation", icon: "compare_arrows" },
      { href: "/docs/features/watcher", label: "Watcher", icon: "radar" },
      { href: "/docs/features/export", label: "Export", icon: "file_download" },
      { href: "/docs/features/history", label: "History", icon: "history" },
      { href: "/docs/features/collaboration", label: "Collaboration", icon: "forum" },
      { href: "/docs/features/ai-mcp", label: "AI MCP & Chat Box", icon: "smart_toy" },
    ],
  },
  {
    label: "Publishing",
    links: [
      { href: "/docs/publishing/darwin-core-archive#darwin-core", label: "Darwin Core", icon: "menu_book" },
      { href: "/docs/publishing/darwin-core-archive#ipt", label: "IPT", icon: "dns" },
      { href: "/docs/publishing/darwin-core-archive#gbif", label: "GBIF", icon: "public" },
      { href: "/docs/publishing/troubleshooting", label: "Troubleshooting", icon: "build" },
    ],
  },
  {
    label: "Reference",
    links: [
      { href: "/docs/reference/faq", label: "FAQ", icon: "quiz" },
      { href: "/docs/reference/terminology", label: "Terminology", icon: "translate" },
      { href: "/docs/reference/citation", label: "Citation", icon: "format_quote" },
    ],
  },
];

const highlights = [
  { href: "/docs/features/collaboration", icon: "group_add", text: "Email invites" },
  { href: "/docs/features/collaboration#discussion", icon: "forum", text: "Live @ pings" },
  { href: "/docs/features/watcher", icon: "radar", text: "Auto Watcher" },
  { href: "/docs/features/history", icon: "history", text: "Full history" },
];

function pathOf(href: string) {
  return href.split("#")[0];
}

const DocsSidebar = forwardRef<HTMLElement, { mobileOpen?: boolean; onNavigate?: () => void }>(function DocsSidebar(
  { mobileOpen = false, onNavigate },
  ref
) {
  const pathname = usePathname();

  return (
    <aside
      ref={ref}
      className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] overflow-y-auto bg-surface border-r border-outline-variant shadow-xl transition-transform duration-300 ease-in-out ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      } md:static md:z-auto md:w-60 md:max-w-none md:translate-x-0 md:border-0 md:shadow-none md:sticky md:top-24`}
    >
      <div className="w-full">
        {navGroups.map((group, i) => (
          <div key={group.label} className={i > 0 ? "mt-6 pt-4 border-t border-outline-variant" : undefined}>
            <p className="workbench-sidebar-section-title">{group.label}</p>
            <ul className="space-y-0.5">
              {group.links.map((link) => {
                const isActive = pathname === pathOf(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={onNavigate}
                      className={`workbench-sidebar-item ${isActive ? "workbench-sidebar-item-active" : ""}`}
                    >
                      <span className="workbench-sidebar-item-left">
                        {link.image ? (
                          <span className="relative w-[18px] h-[18px] shrink-0">
                            <Image src={link.image} alt="" fill sizes="18px" className="object-contain" />
                          </span>
                        ) : (
                          <span
                            className="material-symbols-outlined workbench-sidebar-icon"
                            style={isActive ? { color: "var(--color-primary-container)" } : undefined}
                          >
                            {link.icon}
                          </span>
                        )}
                        <span className="truncate">{link.label}</span>
                      </span>
                    </Link>
                    {link.children && (
                      <ul className="space-y-0.5 mt-0.5 ml-[27px] border-l border-outline-variant pl-2">
                        {link.children.map((child) => {
                          const isChildActive = pathname === pathOf(child.href);
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                onClick={onNavigate}
                                className={`workbench-sidebar-item ${isChildActive ? "workbench-sidebar-item-active" : ""}`}
                              >
                                <span className="workbench-sidebar-item-left">
                                  <span
                                    className="material-symbols-outlined workbench-sidebar-icon text-[14px]"
                                    style={isChildActive ? { color: "var(--color-primary-container)" } : undefined}
                                  >
                                    {child.icon}
                                  </span>
                                  <span className="truncate text-[12px]">{child.label}</span>
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="mt-6 pt-4 border-t border-outline-variant">
          <p className="workbench-sidebar-section-title">Built for teams</p>
          <div className="flex flex-col gap-1.5">
            {highlights.map((h) => (
              <Link
                key={h.href}
                href={h.href}
                onClick={onNavigate}
                className="flex items-center gap-1.5 border border-outline-variant rounded-sm px-2 py-1.5 text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px] shrink-0">{h.icon}</span>
                <span className="font-code-md text-[11px] truncate">{h.text}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
});

export default DocsSidebar;
