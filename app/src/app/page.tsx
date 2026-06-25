"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SwapWord from "@/components/landing/SwapWord";
import DotWorldMap from "@/components/landing/DotWorldMap";
import SiteNavbar from "@/components/shared/SiteNavbar";
import SiteFooter from "@/components/shared/SiteFooter";

const emailCards = [
  {
    step: "01 · IMPORT",
    subject: "Re: Fwd: Bird_list_v2.xlsx",
    snippet: "Can everyone send over their occurrence sheets?",
    rotate: -8,
    x: -110,
    y: -70,
  },
  {
    step: "02 · VALIDATE",
    subject: "Re: Re: Re: synonym disagreement",
    snippet: "Wasn't this name already synonymized last year?",
    rotate: 6,
    x: 90,
    y: -40,
  },
  {
    step: "03 · REVIEW",
    subject: "Fwd: checklist_FINAL_v7.xlsx",
    snippet: "Please review and reply before Friday.",
    rotate: -4,
    x: -50,
    y: 50,
  },
  {
    step: "04 · PUBLISH",
    subject: "Re: any update on the IPT upload??",
    snippet: "Still waiting on the published URL...",
    rotate: 8,
    x: 100,
    y: 80,
  },
];

const hubSteps = [
  { label: "Import", detail: "Auto-pulled from GBIF, iNaturalist, eBird & existing checklists." },
  { label: "Validate", detail: "Synonyms resolved instantly against global taxonomic authorities." },
  { label: "Review", detail: "Experts vote and comment together, evidence laid out side by side." },
  { label: "Publish", detail: "DwC-A package generated and pushed through a GBIF-registered IPT." },
];

const processSteps = [
  {
    number: "01",
    title: "UPLOAD",
    image: "/res/landing/step-1.png",
  },
  {
    number: "02",
    title: "COLLABORATE",
    image: "/res/landing/step-2.png",
  },
  {
    number: "03",
    title: "VALIDATE",
    image: "/res/landing/step-3.png",
  },
  {
    number: "04",
    title: "PUBLISH",
    image: "/res/landing/step-4.png",
  },
];

export default function Home() {
  const [activeCard, setActiveCard] = useState(0);
  const [user, setUser] = useState<{
    id: string;
    email?: string;
    user_metadata?: {
      avatar_url?: string;
      picture?: string;
      full_name?: string;
    };
  } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user as any);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user as any);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
      <SiteNavbar />

      {/* Hero Section */}
      <header
        className="relative overflow-hidden py-24 md:py-32"
        style={{ backgroundColor: "#E8E8E8" }}
      >
        <div className="absolute top-0 right-0 bottom-0 left-[30%] z-0 hidden md:block">
          <DotWorldMap />
        </div>
        <div className="w-full px-lg md:px-xl relative z-10 pointer-events-none">
          <div className="max-w-3xl">
            <div className="w-16 h-1.5 bg-primary mb-lg" />
            <h1 className="font-headline-lg text-[28px] md:text-[36px] mb-lg leading-tight tracking-tighter uppercase font-bold">
              CHECKLIST FOR <br />
              ANY REGION, ANY{" "}
              <SwapWord
                words={["TAXA", "BIRDS", "PLANTS", "REPTILES", "MAMMALS"]}
                className="text-primary font-extrabold"
              />{" "}
              <br />
              <span className="text-primary font-extrabold">MADE EASY</span>
            </h1>
            <p className="font-body-lg text-body-lg text-secondary mb-xl leading-relaxed max-w-[34rem]">
              Collaborate in real time, gather evidence automatically, and publish trusted
              species checklists.
            </p>
            <div className="flex flex-col sm:flex-row gap-md pointer-events-auto">
              <Link href={user ? "/checklists/new" : "/login"} className="btn-primary-cta">
                CREATE CHECKLIST
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
              {user && (
                <Link href="/checklists" className="btn-secondary-cta">
                  VIEW CHECKLIST
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Process Steps */}
      <section className="bg-surface-container-low py-16 md:py-20">
        <div className="w-full px-xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-0 border border-outline-variant bg-white">
            {processSteps.map((step, index) => (
              <div
                key={step.number}
                className={`p-8 md:p-10 group hover:bg-surface-container transition-colors flex flex-col items-center text-center ${index < processSteps.length - 1 ? "border-r border-outline-variant" : ""
                  }`}
              >
                <span className="font-headline-lg text-[42px] font-extrabold text-primary opacity-80 mb-3">
                  {step.number}
                </span>
                <h3 className="font-headline-md text-[22px] uppercase tracking-tight mb-6">
                  {step.title}
                </h3>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={step.title}
                  className=" w-full max-w-[240px] h-auto object-contain transition-transform duration-300 group-hover:scale-105 object-contain transition-transform duration-300 group-hover:scale-110"
                  src={step.image}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Checklist Hub */}
      <section className="py-20 border-t border-outline-variant bg-white overflow-hidden">
        <div className="w-full px-xl max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-headline-lg text-[28px] md:text-[32px] uppercase tracking-tight mb-3">
              Why Checklist Hub
            </h2>
            <p className="font-body-sm text-body-sm text-secondary whitespace-nowrap">
              One way takes weeks. The other takes minutes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-20 md:gap-10 items-start">
            {/* Without Checklist Hub */}
            <div>
              <div className="flex items-center gap-2 mb-8 justify-center">
                <span className="material-symbols-outlined text-secondary text-[18px]">close</span>
                <h3 className="font-code-md text-code-md uppercase tracking-wide text-secondary">
                  Without Checklist Hub
                </h3>
              </div>
              <div className="relative h-[300px]">
                {emailCards.map((card, i) => {
                  const isActive = i === activeCard;
                  return (
                    <button
                      key={card.subject}
                      type="button"
                      onClick={() => setActiveCard(i)}
                      className="absolute left-1/2 top-1/2 w-60 text-left bg-surface-container-low border p-3 transition-all duration-300 ease-out cursor-pointer"
                      style={{
                        transform: isActive
                          ? "translate(-50%, -50%) scale(1.08)"
                          : `translate(-50%, -50%) translate(${card.x}px, ${card.y}px) rotate(${card.rotate}deg) scale(0.92)`,
                        zIndex: isActive ? 50 : i,
                        opacity: isActive ? 1 : 0.7,
                        borderColor: isActive ? "var(--color-primary)" : "var(--color-outline-variant)",
                        boxShadow: isActive ? "4px 4px 0px 0px rgba(164, 31, 36, 1)" : undefined,
                      }}
                    >
                      <span className="font-code-md text-[9px] uppercase tracking-wide text-primary/70 block mb-1">
                        {card.step}
                      </span>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="material-symbols-outlined text-secondary text-[13px]">
                          mail
                        </span>
                        <span className="font-code-md text-[10px] text-secondary truncate">
                          {card.subject}
                        </span>
                      </div>
                      <p className="font-body-sm text-[11px] text-secondary/70 leading-snug">
                        {card.snippet}
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="text-center mt-6">
                <span className="font-headline-md text-[22px] text-secondary tracking-tight">
                  ~3-4 WEEKS
                </span>
                <p className="font-body-sm text-[12px] text-secondary/60 mt-1">
                  back-and-forth before anyone agrees
                </p>
              </div>
            </div>

            {/* With Checklist Hub */}
            <div>
              <div className="flex items-center gap-2 mb-8 justify-center">
                <span className="material-symbols-outlined text-primary text-[18px]">check</span>
                <h3 className="font-code-md text-code-md uppercase tracking-wide text-primary">
                  With Checklist Hub
                </h3>
              </div>
              <div className="relative h-[300px] flex flex-col justify-center">
                <div className="absolute left-3 top-3 bottom-3 w-px bg-primary/25" />
                {hubSteps.map((step) => (
                  <div key={step.label} className="relative flex items-start gap-4 py-3.5">
                    <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[14px]">check</span>
                    </div>
                    <div>
                      <span className="font-headline-md text-[14px] uppercase tracking-tight text-on-surface">
                        {step.label}
                      </span>
                      <p className="font-body-sm text-[12px] text-secondary">{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-center mt-6">
                <span className="font-headline-md text-[22px] text-primary tracking-tight">
                  MINUTES
                </span>
                <p className="font-body-sm text-[12px] text-secondary/60 mt-1">
                  from import to publish-ready package
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
