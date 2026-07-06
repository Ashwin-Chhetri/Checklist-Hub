"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Highlight from "./Highlight";

function LightboxImage({ src, alt, sizes, className }: { src: string; alt: string; sizes: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="relative w-full h-full cursor-zoom-in" onClick={() => setOpen(true)}>
        <Image src={src} alt={alt} fill sizes={sizes} className={className ?? "object-contain"} quality={90} />
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
          onClick={() => setOpen(false)}
        >
          <div className="relative w-full max-h-[90vh]" style={{ maxWidth: "min(90vw, 1400px)", aspectRatio: "16/10" }}>
            <Image src={src} alt={alt} fill sizes="90vw" className="object-contain" quality={100} />
          </div>
          <button
            type="button"
            className="absolute top-4 right-4 text-white bg-black/40 hover:bg-black/70 rounded-full w-10 h-10 flex items-center justify-center text-xl font-bold transition-colors"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

interface HighlightImage {
  src: string;
  alt: string;
}

interface WizardSlide {
  step: string;
  title: string;
  description: ReactNode;
  image?: string;
  imageAlt?: string;
  highlight?: {
    badge: string;
    title: string;
    body: ReactNode;
    images: HighlightImage[];
  };
}

const slides: WizardSlide[] = [
  {
    step: "1",
    title: "Details",
    description:
      "Name the checklist, then set its taxonomic scope (kingdom → phylum → class → order) and region.",
    image: "/res/docs/checklist-step-1.png",
    imageAlt: "The Details step of the checklist creation wizard, with title, taxonomic scope, and region fields",
  },
  {
    step: "2",
    title: "Import",
    description: (
      <>
        Drag in a CSV, TSV, JSON, or Excel species list — or skip the file entirely. Evidence is{" "}
        <Highlight>aggregated automatically</Highlight> from GBIF, eBird, and iNaturalist as soon
        as the taxonomic scope and region are set.
      </>
    ),
    image: "/res/docs/checklist-step-2.png",
    imageAlt: "The Import step showing aggregated species counts from GBIF, eBird, and iNaturalist plus a CSV upload area",
    highlight: {
      badge: "New",
      title: "Deep Literature Search",
      body: (
        <>
          One click runs a standalone research pipeline that discovers literature for the
          checklist&apos;s taxon and region, scores every source for relevance, and{" "}
          <Highlight>extracts a species list straight from the papers</Highlight>. Low-relevance
          results are filtered out automatically, and you can remove anything that doesn&apos;t
          belong before it&apos;s added to the checklist.
        </>
      ),
      images: [
        {
          src: "/res/docs/checklist-step-2-literature.png",
          alt: "Deep Literature Search pipeline in progress: starting pipeline, discovering literature, extracting species list, mapping to backbone",
        },
        {
          src: "/res/docs/checklist-step-2-literature-2.png",
          alt: "Deep Literature Search results showing scored, citable sources with an option to remove any that don't belong",
        },
      ],
    },
  },
  {
    step: "3",
    title: "Validate",
    description:
      "Review the merged species list — filter by family or source, switch between list and chart views, and see the taxonomic composition at a glance before committing to it.",
    image: "/res/docs/checklist-step-3.png",
    imageAlt: "The Validate step showing a family breakdown pie chart and a filterable species table",
  },
  {
    step: "4",
    title: "Collab",
    description: (
      <>
        Add collaborators by email. An existing Checklist Hub account gets access right away — a
        new address <Highlight>gets an invite automatically</Highlight>.
      </>
    ),
    image: "/res/docs/checklist-step-4.png",
    imageAlt: "The Collab step showing the add-collaborator email field with an automatic invite suggestion",
  },
  {
    step: "5",
    title: "Create",
    description: "Finish setup and open the Workbench — the checklist is ready for review.",
  },
];

export default function ChecklistWizardCarousel() {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const isFirst = index === 0;
  const isLast = index === slides.length - 1;

  return (
    <div className="border border-outline-variant bg-white">
      <div className="flex items-center justify-between px-lg py-3 border-b border-outline-variant">
        <div className="flex items-center gap-3">
          <span className="font-code-md text-code-md text-primary font-bold">{slide.step}</span>
          <span className="font-bold text-on-surface">{slide.title}</span>
        </div>
        <span className="font-label-caps text-[11px] text-on-surface-variant">
          {index + 1} / {slides.length}
        </span>
      </div>

      {/* Fixed height keeps the Back/Next footer in the same place on every
          step — without it, a short step (e.g. Create) would shrink the
          whole card and yank the buttons up right as you click Next. Steps
          shorter than this just sit centered; the one step that runs long
          (Import, with the Deep Literature Search callout) scrolls instead
          of growing the card. */}
      <div
        className={`p-lg h-[620px] overflow-y-auto flex flex-col ${
          slide.highlight ? "justify-start" : "justify-center"
        }`}
      >
        <p className="font-body-sm text-body-sm text-secondary mb-4">{slide.description}</p>

        {slide.image && (
          <div className="relative w-full aspect-[16/10] border border-outline-variant shrink-0">
            <LightboxImage
              src={slide.image}
              alt={slide.imageAlt ?? ""}
              sizes="(min-width: 768px) 700px, 100vw"
            />
          </div>
        )}

        {slide.highlight && (
          <div className="mt-4 border border-primary bg-surface-container-low p-md shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-label-caps text-[10px] font-bold uppercase bg-primary text-white px-2 py-0.5">
                {slide.highlight.badge}
              </span>
              <span className="font-bold text-on-surface text-sm">{slide.highlight.title}</span>
            </div>
            <p className="font-body-sm text-body-sm text-secondary mb-3">{slide.highlight.body}</p>
            <div className="flex gap-3">
              {slide.highlight.images.map((img) => (
                <div key={img.src} className="relative flex-1 h-40 border border-outline-variant bg-white">
                  <LightboxImage
                    src={img.src}
                    alt={img.alt}
                    sizes="(min-width: 768px) 340px, 45vw"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-lg py-3 border-t border-outline-variant">
        <button
          type="button"
          className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={isFirst}
        >
          Back
        </button>
        <div className="flex items-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.step}
              type="button"
              aria-label={`Go to step ${s.step}: ${s.title}`}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === index ? "bg-primary" : "bg-outline-variant"
              }`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
          disabled={isLast}
        >
          Next
        </button>
      </div>
    </div>
  );
}
