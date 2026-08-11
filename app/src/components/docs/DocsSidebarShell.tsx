"use client";

import { useEffect, useRef, type ReactNode } from "react";
import DocsSidebar from "./DocsSidebar";
import { useDocsMobileNav } from "./DocsMobileNavProvider";

export default function DocsSidebarShell({ children }: { children: ReactNode }) {
  const { mobileOpen, setMobileOpen, setSidebarWidth } = useDocsMobileNav();
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setSidebarWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [setSidebarWidth]);

  return (
    <div className="flex flex-row items-start gap-xl pl-sm">
      <DocsSidebar ref={sidebarRef} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} />

      <div className="flex-1 min-w-0 w-full pr-md md:pr-xl">{children}</div>
    </div>
  );
}
