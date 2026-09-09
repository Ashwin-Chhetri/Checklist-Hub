"use client";

import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export interface TourStop {
  id: string;
  step: number;
  /** Emoji shown before the title — kept relevant per stop (👋 intro, 🧬 taxa, 🗺️ region, …). */
  icon: string;
  /** Plays a hand-wave keyframe animation on `icon` (use for the welcome stop). */
  iconAnimate?: boolean;
  title: string;
  body: ReactNode;
  /**
   * Key into the `progress` map passed to ChecklistTour. When set, the
   * "Next" button stays disabled until `progress[checkKey]` is true — the
   * tour waits for the user to actually do the thing it just asked for
   * (type a title, pick a hierarchy, etc.) instead of letting them click
   * through without doing it. Omit for stops that don't gate on anything.
   */
  checkKey?: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

const SPOTLIGHT_PADDING = 6;
const CARD_GAP = 16;
const CARD_WIDTH = 300;
const CARD_HEIGHT_ESTIMATE = 190;
const VIEWPORT_MARGIN = 16;

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
}

/**
 * Bounding box of `el` unioned with all of its rendered descendants. A plain
 * getBoundingClientRect() on the target only covers its own layout box, which
 * excludes absolutely-positioned children like the region field's suggestion
 * dropdown — so the spotlight would stop at the input and leave the dropdown
 * unhighlighted. Walking descendants picks that up automatically, for this
 * target or any other with an overflowing popover.
 */
function measureUnion(el: Element): Rect {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  function consider(r: DOMRect) {
    if (r.width === 0 && r.height === 0) return;
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }

  consider(el.getBoundingClientRect());
  el.querySelectorAll("*").forEach((child) => consider(child.getBoundingClientRect()));

  if (!isFinite(top)) return measure(el);
  return { top, left, width: right - left, height: bottom - top, right, bottom };
}

/**
 * First-time guided tour for the "Create Checklist" wizard: one contextual
 * callout per wizard step (or, for step 1, per sub-section of that step),
 * shown against whichever step the user is currently on rather than driving
 * navigation itself — the wizard already gates its own Continue button (e.g.
 * Step 1 requires a title/scope/region), so the tour just follows the user
 * through it instead of trying to force them forward. Stops with a
 * `checkKey` additionally hold their own "Next" button disabled until the
 * user has actually performed that stop's action.
 */
export function ChecklistTour({
  step,
  targets,
  stops,
  containerRef,
  progress,
  onSkip,
  onFinish,
}: {
  step: number;
  targets: Partial<Record<string, RefObject<HTMLElement | null>>>;
  stops: TourStop[];
  /** The dialog box the tour card should be anchored to the right of. */
  containerRef?: RefObject<HTMLElement | null>;
  /** Live completion state for each stop's `checkKey`. */
  progress?: Partial<Record<string, boolean>>;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [rect, setRect] = useState<Rect | null>(null);
  const [containerRect, setContainerRect] = useState<Rect | null>(null);

  const activeIndex = stops.findIndex((s) => s.step === step && !acknowledged.has(s.id));
  const activeStop = activeIndex >= 0 ? stops[activeIndex] : null;
  const targetRef = activeStop ? targets[activeStop.id] : undefined;

  useLayoutEffect(() => {
    const el = targetRef?.current;
    const containerEl = containerRef?.current;
    if (!el) {
      setRect(null);
      setContainerRect(null);
      return;
    }

    function update() {
      setRect(measureUnion(el!));
      setContainerRect(containerEl ? measure(containerEl) : null);
    }

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    if (containerEl) resizeObserver.observe(containerEl);
    // A popover like the region field's suggestion dropdown mounts/unmounts
    // without changing the target's own size, so ResizeObserver alone won't
    // catch it — watch the subtree for DOM changes too.
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(el, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", update);
    // capture:true so scroll from any nested scrollable ancestor (the wizard
    // dialog, the species table, etc.) is picked up — plain 'scroll' doesn't
    // bubble to window/document on its own.
    document.addEventListener("scroll", update, true);
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [targetRef, containerRef, activeStop?.step, activeStop?.id]);

  if (!activeStop || !rect) return null;

  function dismiss() {
    setAcknowledged((prev) => new Set(prev).add(activeStop!.id));
  }

  function goBack() {
    const prevStop = stops[activeIndex - 1];
    if (!prevStop) return;
    setAcknowledged((prev) => {
      const next = new Set(prev);
      next.delete(prevStop.id);
      return next;
    });
  }

  const isLast = activeIndex === stops.length - 1;
  const isChecked = !activeStop.checkKey || !!progress?.[activeStop.checkKey];
  const canGoBack = activeIndex > 0 && stops[activeIndex - 1].step === activeStop.step;

  // Prefer anchoring the card to the right of the whole dialog box, vertically
  // aligned with the highlighted target. Falls back to placing it above/below
  // the target itself when there isn't enough horizontal room (narrow
  // viewports), so the card never gets clipped off-screen.
  const fitsOnRight =
    !!containerRect && containerRect.right + CARD_GAP + CARD_WIDTH + VIEWPORT_MARGIN <= window.innerWidth;

  let top: number;
  let left: number;
  let placeAbove = false;

  if (fitsOnRight && containerRect) {
    left = containerRect.right + CARD_GAP;
    top = Math.min(
      Math.max(rect.top, VIEWPORT_MARGIN),
      window.innerHeight - CARD_HEIGHT_ESTIMATE - VIEWPORT_MARGIN,
    );
  } else {
    placeAbove =
      rect.top + rect.height + CARD_HEIGHT_ESTIMATE + CARD_GAP > window.innerHeight && rect.top > CARD_HEIGHT_ESTIMATE;
    top = placeAbove ? rect.top - CARD_GAP : rect.top + rect.height + CARD_GAP;
    const cardWidth = Math.min(CARD_WIDTH, window.innerWidth - 32);
    left = Math.min(Math.max(rect.left, 16), window.innerWidth - cardWidth - 16);
  }

  const cardWidth = Math.min(CARD_WIDTH, window.innerWidth - 32);

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
        className="absolute bg-surface border border-outline-variant hard-shadow pointer-events-auto transition-all duration-200"
        style={{
          top,
          left,
          width: cardWidth,
          transform: placeAbove ? "translateY(-100%)" : undefined,
        }}
      >
        <style>{`
          @keyframes tour-wave {
            0%, 40%, 100% { transform: rotate(0deg); }
            10% { transform: rotate(16deg); }
            20% { transform: rotate(-8deg); }
            30% { transform: rotate(16deg); }
          }
        `}</style>
        <div className="flex items-start justify-between gap-2 px-4 pt-4">
          <div className="flex items-center gap-1.5">
            <span
              className="text-base leading-none inline-block origin-[70%_70%]"
              style={activeStop.iconAnimate ? { animation: "tour-wave 1.6s ease-in-out infinite" } : undefined}
              aria-hidden
            >
              {activeStop.icon}
            </span>
            <h3 className="text-sm font-bold text-on-surface">{activeStop.title}</h3>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Skip tour"
            className="material-symbols-outlined text-[16px] text-on-surface-variant hover:text-primary transition-colors -mt-0.5"
          >
            close
          </button>
        </div>

        <div className="text-xs text-on-surface-variant px-4 pt-2 pb-4 space-y-2">{activeStop.body}</div>

        <div className="flex items-center justify-between gap-2 border-t border-outline-variant px-4 py-2.5">
          <button
            type="button"
            onClick={goBack}
            disabled={!canGoBack}
            className="font-label-caps text-[11px] uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            Back
          </button>

          <div className="flex flex-wrap items-center justify-center gap-0.5 max-w-[130px]">
            {stops.map((s, i) => (
              <span
                key={s.id}
                className={`rounded-full shrink-0 transition-all ${
                  i === activeIndex ? "w-2 h-2 bg-primary" : "w-1 h-1 bg-outline-variant"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={isLast ? onFinish : dismiss}
            disabled={!isChecked}
            className="bg-primary text-on-primary px-3 py-1.5 font-label-caps text-[11px] hard-shadow hover:translate-y-[-2px] transition-transform active:translate-y-[2px] disabled:opacity-40 disabled:pointer-events-none disabled:translate-y-0"
          >
            {isLast ? "FINISH" : "NEXT"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
