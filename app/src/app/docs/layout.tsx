import type { ReactNode } from "react";
import SiteNavbar from "@/components/shared/SiteNavbar";
import SiteFooter from "@/components/shared/SiteFooter";
import DocsSidebarShell from "@/components/docs/DocsSidebarShell";
import DocsMobileNavProvider from "@/components/docs/DocsMobileNavProvider";
import FoldText from "@/components/shared/FoldText";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNavbar />

      <main className="bg-surface">
        <DocsMobileNavProvider>
          <section className="pt-6 md:pt-8 pb-2">
            <div className="w-full px-sm">
              <div className="w-16 h-1.5 bg-primary mb-sm" />
              <h1 className="font-headline-lg text-[32px] md:text-[40px] uppercase tracking-tighter font-bold">
                <FoldText
                  text="Docs"
                  splitBy="char"
                  hinge="top"
                  trigger="mount"
                  duration={0.5}
                  stagger={0.04}
                  fontSize="inherit"
                  fontWeight="inherit"
                  color="inherit"
                />
              </h1>
            </div>
          </section>

          <section className="pt-2 pb-12 md:pb-16">
            <DocsSidebarShell>{children}</DocsSidebarShell>
          </section>
        </DocsMobileNavProvider>
      </main>

      <SiteFooter />
    </>
  );
}
