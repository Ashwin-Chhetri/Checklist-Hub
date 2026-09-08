"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

export interface TourStop {
  step: number;
  title: string;
  body: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 6;
const CARD_GAP = 12;
const CARD_HEIGHT_ESTIMATE = 160;

/**
 * First-time guided tour for the "Create Checklist" wizard: one contextual
 * callout per wizard step, shown against whichever step the user is
 * currently on rather than driving navigation itself — the wizard already
 * gates its own Continue button (e.g. Step 1 requires a title/scope/region),
 * so the tour just follows the user through it instead of trying to force
 * them forward.
 */
export function ChecklistTour({
  step,
  targets,
  stops,
  onSkip,
  onFinish,
}: {
  step: number;
  targets: Partial<Record<number, RefObject<HTMLElement | null>>>;
  stops: TourStop[];
  onSkip: () => void;
  onFinish: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState<Set<number>>(new Set());
  const [rect, setRect] = useState<Rect | null>(null);

  const activeIndex = stops.findIndex((s) => s.step === step && !acknowledged.has(s.step));
  const activeStop = activeIndex >= 0 ? stops[activeIndex] : null;
  const targetRef = activeStop ? targets[activeStop.step] : undefined;

  useLayoutEffect(() => {
    const el = targetRef?.current;
    if (!el) {
      setRect(null);
      return;
    }

    function update() {
      const r = el!.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    window.addEventListener("resize", update);
    // capture:true so scroll from any nested scrollable ancestor (the wizard
    // dialog, the species table, etc.) is picked up — plain 'scroll' doesn't
    // bubble to window/document on its own.
    document.addEventListener("scroll", update, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [targetRef, activeStop?.step]);

  if (!activeStop || !rect) return null;

  function dismiss() {
    setAcknowledged((prev) => new Set(prev).add(activeStop!.step));
  }

  const isLast = activeIndex === stops.length - 1;

  const placeAbove =
    rect.top + rect.height + CARD_HEIGHT_ESTIMATE + CARD_GAP > window.innerHeight && rect.top > CARD_HEIGHT_ESTIMATE;
  const top = placeAbove ? rect.top - CARD_GAP : rect.top + rect.height + CARD_GAP;

  const cardWidth = Math.min(300, window.innerWidth - 32);
  const left = Math.min(Math.max(rect.left, 16), window.innerWidth - cardWidth - 16);

  return createPortal(
    <div className="fixed inset-0 z-[200] pointer-events-none">
      {/* Dimmed backdrop with a highlighted ring around the target — purely
          decorative (pointer-events-none), so nothing under the tour is ever
          blocked; the wizard's own step gating already controls what the
          user can do next. */}
      <div
        className="absolute rounded-sm border-2 border-primary transition-all duration-200"
        style={{
          top: rect.top - SPOTLIGHT_PADDING,
          left: rect.left - SPOTLIGHT_PADDING,
          width: rect.width + SPOTLIGHT_PADDING * 2,
          height: rect.height + SPOTLIGHT_PADDING * 2,
          boxShadow: "0 0 0 2000px rgba(27,28,28,0.55)",
        }}
      />

      <div
        className="absolute bg-surface border border-outline-variant hard-shadow p-4 flex flex-col gap-2 pointer-events-auto transition-all duration-200"
        style={{
          top,
          left,
          width: cardWidth,
          transform: placeAbove ? "translateY(-100%)" : undefined,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-label-caps text-[10px] uppercase tracking-wider text-primary">
            {activeIndex + 1} / {stops.length}
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="font-label-caps text-[10px] uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors"
          >
            Skip tour
          </button>
        </div>
        <h3 className="text-sm font-bold text-on-surface">{activeStop.title}</h3>
        <p className="text-xs text-on-surface-variant">{activeStop.body}</p>
        <button
          type="button"
          onClick={isLast ? onFinish : dismiss}
          className="self-end bg-primary text-on-primary px-4 py-1.5 font-label-caps text-[11px] hard-shadow hover:translate-y-[-2px] transition-transform active:translate-y-[2px] mt-1"
        >
          {isLast ? "FINISH" : "GOT IT"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
