"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

interface DocsMobileNavContextValue {
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
}

const DocsMobileNavContext = createContext<DocsMobileNavContextValue | null>(null);

export function useDocsMobileNav() {
  const ctx = useContext(DocsMobileNavContext);
  if (!ctx) throw new Error("useDocsMobileNav must be used within DocsMobileNavProvider");
  return ctx;
}

const BUTTON_SIZE = 36; // w-9 h-9
const REST_LEFT = 8; // matches the mobile px-sm container inset
const DRAWER_INSET = 8; // gap kept inside the sidebar's border when open

export default function DocsMobileNavProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(0);

  return (
    <DocsMobileNavContext.Provider value={{ mobileOpen, setMobileOpen, sidebarWidth, setSidebarWidth }}>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/*
        Genuinely sticky: rests mt-6 below the app header (above the red rule
        + "Docs" heading), well past the top-14 stick threshold — which is
        set to exactly the app header's height (h-14) so once stuck, the
        button sits flush against the header's bottom edge with no gap.
        Travels with the page for the first ~24px of scroll before locking
        there. When the drawer opens, it slides via translateX and settles
        just inside the sidebar's top-right border instead of past its edge.
      */}
      <button
        type="button"
        onClick={() => setMobileOpen((o) => !o)}
        style={{
          transform: mobileOpen
            ? `translateX(${sidebarWidth - BUTTON_SIZE - DRAWER_INSET - REST_LEFT}px)`
            : undefined,
          transition: "transform 300ms ease-in-out",
        }}
        className="md:hidden sticky top-14 z-[60] mt-6 ml-sm mb-sm inline-flex items-center justify-center w-9 h-9 border border-outline bg-surface text-on-surface hover:-translate-x-px hover:-translate-y-px active:translate-x-px active:translate-y-px"
        aria-label={mobileOpen ? "Close sidebar" : "Open sidebar"}
        title={mobileOpen ? "Close sidebar" : "Open sidebar"}
      >
        <span className="material-symbols-outlined text-[18px]">
          {mobileOpen ? "keyboard_double_arrow_left" : "keyboard_double_arrow_right"}
        </span>
      </button>

      {children}
    </DocsMobileNavContext.Provider>
  );
}
