"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
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
  /**
   * A second key into `targets` — spotlighted alongside the primary target
   * for stops that need to show two related things on screen at once (e.g. a
   * table column and the side panel it opens). The card is positioned near
   * whichever of the two sits further along the reading direction.
   */
  secondaryId?: string;
  /**
   * Renders the card centered on screen with no spotlight/target at all —
   * for a closing or summary stop that isn't anchored to any one element.
   */
  center?: boolean;
  /** External docs link surfaced as a "More details" action under the body. */
  docsHref?: string;
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
 * Clamps `rect` to stay within `bounds`. measureUnion() walks every
 * descendant regardless of whether an ancestor actually clips it — a wide
 * chart or a long scrollable species list has rows/columns that are part of
 * the DOM (and so count toward the union) well past what's actually visible
 * inside the dialog's own box, which without this made the spotlight (and
 * the card position derived from it) balloon past the dialog's right edge
 * and bottom edge. Falls back to the unclamped rect if the intersection is
 * degenerate (e.g. the target has actually scrolled fully out of bounds).
 */
function clampRect(rect: Rect, bounds: Rect): Rect {
  const top = Math.max(rect.top, bounds.top);
  const left = Math.max(rect.left, bounds.left);
  const right = Math.min(rect.right, bounds.right);
  const bottom = Math.min(rect.bottom, bounds.bottom);
  if (right <= left || bottom <= top) return rect;
  return { top, left, right, bottom, width: right - left, height: bottom - top };
}

/**
 * First-time guided tour, reused for both the "Create Checklist" wizard and
 * the workbench: one contextual callout per stop, shown against whichever
 * step the host page is currently on rather than driving navigation itself —
 * the host already gates its own progress (e.g. a wizard Continue button, or
 * an `onActiveStopChange` side effect that opens a panel/tab), so the tour
 * just follows along instead of trying to force the user forward. Stops with
 * a `checkKey` additionally hold their own "Next" button disabled until the
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
  onActiveStopChange,
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
  /** Fires whenever the active stop changes (including to null) — for hosts that need to drive a side effect, like opening a panel to a specific tab, when a given stop comes into view. */
  onActiveStopChange?: (stop: TourStop | null) => void;
}) {
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [rect, setRect] = useState<Rect | null>(null);
  const [secondaryRect, setSecondaryRect] = useState<Rect | null>(null);
  const [containerRect, setContainerRect] = useState<Rect | null>(null);

  const activeIndex = stops.findIndex((s) => s.step === step && !acknowledged.has(s.id));
  const activeStop = activeIndex >= 0 ? stops[activeIndex] : null;
  const isCenterStop = !!activeStop?.center;
  const targetRef = activeStop ? targets[activeStop.id] : undefined;
  const secondaryTargetRef = activeStop?.secondaryId ? targets[activeStop.secondaryId] : undefined;

  useEffect(() => {
    onActiveStopChange?.(activeStop ?? null);
    // Only re-fire when the active stop's identity actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStop?.id]);

  useLayoutEffect(() => {
    // Center stops render with no spotlight at all (guarded by `isCenterStop`
    // wherever rect/secondaryRect are read below), so any rect state left
    // over from a previous stop is simply unused rather than needing to be
    // cleared here.
    if (isCenterStop) return;

    const el = targetRef?.current;
    const secondaryEl = secondaryTargetRef?.current;
    const containerEl = containerRef?.current;
    if (!el) {
      setRect(null);
      setSecondaryRect(null);
      setContainerRect(null);
      return;
    }

    function update() {
      const union = measureUnion(el!);
      const container = containerEl ? measure(containerEl) : null;
      setRect(container ? clampRect(union, container) : union);
      setContainerRect(container);
      setSecondaryRect(secondaryEl ? measureUnion(secondaryEl) : null);
    }

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    if (secondaryEl) resizeObserver.observe(secondaryEl);
    if (containerEl) resizeObserver.observe(containerEl);
    // A popover like the region field's suggestion dropdown mounts/unmounts
    // without changing the target's own size, so ResizeObserver alone won't
    // catch it — watch the subtree for DOM changes too.
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(el, { childList: true, subtree: true, attributes: true });
    if (secondaryEl) mutationObserver.observe(secondaryEl, { childList: true, subtree: true, attributes: true });
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
  }, [targetRef, secondaryTargetRef, containerRef, activeStop?.step, activeStop?.id, isCenterStop]);

  if (!activeStop) return null;
  if (!isCenterStop && !rect) return null;

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

  const cardWidth = Math.min(CARD_WIDTH, window.innerWidth - 32);

  let top = 0;
  let left = 0;
  let placeAbove = false;

  if (!isCenterStop && rect) {
    // Position relative to whichever of the primary/secondary targets sits
    // further right — usually the newly-opened panel — so the card doesn't
    // end up floating over content it's meant to be pointing past.
    const anchorRect = secondaryRect && secondaryRect.left > rect.left ? secondaryRect : rect;

    // Prefer anchoring the card to the right of the whole dialog box, vertically
    // aligned with the highlighted target. Falls back to placing it above/below
    // the target itself when there isn't enough horizontal room (narrow
    // viewports), so the card never gets clipped off-screen.
    const fitsOnRight =
      !!containerRect && containerRect.right + CARD_GAP + CARD_WIDTH + VIEWPORT_MARGIN <= window.innerWidth;

    if (fitsOnRight && containerRect) {
      left = containerRect.right + CARD_GAP;
      top = Math.min(
        Math.max(anchorRect.top, VIEWPORT_MARGIN),
        window.innerHeight - CARD_HEIGHT_ESTIMATE - VIEWPORT_MARGIN,
      );
    } else if (anchorRect.right + CARD_GAP + cardWidth + VIEWPORT_MARGIN <= window.innerWidth) {
      // No dialog to anchor to (e.g. the workbench), but there's still room
      // to the right of the anchor target itself.
      left = anchorRect.right + CARD_GAP;
      top = Math.min(
        Math.max(anchorRect.top, VIEWPORT_MARGIN),
        window.innerHeight - CARD_HEIGHT_ESTIMATE - VIEWPORT_MARGIN,
      );
    } else {
      placeAbove =
        anchorRect.top + anchorRect.height + CARD_HEIGHT_ESTIMATE + CARD_GAP > window.innerHeight &&
        anchorRect.top > CARD_HEIGHT_ESTIMATE;
      top = placeAbove ? anchorRect.top - CARD_GAP : anchorRect.top + anchorRect.height + CARD_GAP;
      left = Math.min(Math.max(anchorRect.left, 16), window.innerWidth - cardWidth - 16);
    }
  }

  const card = (
    <div
      className={
        isCenterStop
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-outline-variant hard-shadow pointer-events-auto transition-all duration-200"
          : "absolute bg-surface border border-outline-variant hard-shadow pointer-events-auto transition-all duration-200"
      }
      style={
        isCenterStop
          ? { width: cardWidth }
          : {
              top,
              left,
              width: cardWidth,
              transform: placeAbove ? "translateY(-100%)" : undefined,
            }
      }
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

      <div className="text-xs text-on-surface-variant px-4 pt-2 pb-3 space-y-2">{activeStop.body}</div>

      {activeStop.docsHref && (
        <div className="px-4 pb-3 -mt-1">
          <a
            href={activeStop.docsHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-label-caps text-[10px] uppercase tracking-wider text-primary hover:underline"
          >
            More details
            <span className="material-symbols-outlined text-[12px]">open_in_new</span>
          </a>
        </div>
      )}

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
  );

  // A single dark overlay with a clip-path hole cut per spotlighted rect —
  // rather than one box-shadow "spotlight" per rect, which (when there are
  // two) would each re-darken the other's hole, since a box-shadow spotlight
  // only excludes its own box, not some other element's. `polygon()` can't
  // do this — it's a single closed path, so listing an outer ring plus two
  // hole rings back to back just connects them into one bowtie shape instead
  // of two disjoint holes. `path()` with SVG path syntax supports separate
  // `M...Z` subpaths, so the evenodd fill rule can punch two genuinely
  // separate, undimmed windows out of the same overlay.
  const clipHoles = [rect, secondaryRect].filter((r): r is Rect => !!r);
  const clipPath =
    !isCenterStop && clipHoles.length > 0
      ? `path(evenodd, "M 0 0 H ${window.innerWidth} V ${window.innerHeight} H 0 Z ${clipHoles
          .map((r) => {
            const top = r.top - SPOTLIGHT_PADDING;
            const left = r.left - SPOTLIGHT_PADDING;
            const right = r.right + SPOTLIGHT_PADDING;
            const bottom = r.bottom + SPOTLIGHT_PADDING;
            return `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`;
          })
          .join(" ")}")`
      : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[200] pointer-events-none">
      {/* Dimmed backdrop with highlighted ring(s) around the target(s) —
          purely decorative (pointer-events-none), so nothing under the tour
          is ever blocked; the host page's own gating already controls what
          the user can do next. */}
      <div
        className="absolute inset-0 transition-[clip-path] duration-200"
        style={{ background: "rgba(27,28,28,0.55)", clipPath }}
      />

      {!isCenterStop && rect && (
        <div
          className="absolute rounded-sm border-2 border-primary transition-all duration-200"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
          }}
        />
      )}

      {!isCenterStop && secondaryRect && (
        <div
          className="absolute rounded-sm border-2 border-primary transition-all duration-200"
          style={{
            top: secondaryRect.top - SPOTLIGHT_PADDING,
            left: secondaryRect.left - SPOTLIGHT_PADDING,
            width: secondaryRect.width + SPOTLIGHT_PADDING * 2,
            height: secondaryRect.height + SPOTLIGHT_PADDING * 2,
          }}
        />
      )}

      {card}
    </div>,
    document.body,
  );
}
