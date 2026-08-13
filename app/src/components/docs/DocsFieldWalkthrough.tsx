"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import FramedScreenshot from "@/components/docs/FramedScreenshot";
import {
  ARROW_ENTER_MS,
  ARROW_EXIT_MS,
  buildArrow,
  resolveContentRect,
  type ArrowInstance,
  type Point,
} from "@/components/docs/docsArrowKit";

interface WalkthroughScreen {
  src: string;
  alt: string;
  aspect: string;
  variant?: "full" | "dialog" | "flush";
  scale?: number;
}

interface WalkthroughStep {
  title: string;
  body: ReactNode;
  /** Where the arrow points, as a percentage (0-100) of the screenshot image itself. */
  target: Point;
  /** Overrides the shared screen for this step only, e.g. a later wizard step. */
  screen?: WalkthroughScreen;
}

// ---------- component ----------

export default function DocsFieldWalkthrough({
  screen,
  steps,
  hint,
}: {
  /** The screen shown for any step that doesn't specify its own `screen`. */
  screen: WalkthroughScreen;
  steps: WalkthroughStep[];
  /** Small caption above the step list, e.g. prompting the reader to click through. */
  hint?: ReactNode;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentScreen, setCurrentScreen] = useState<WalkthroughScreen>(steps[0]?.screen ?? screen);
  const [imageReady, setImageReady] = useState(true);
  const [arrows, setArrows] = useState<ArrowInstance[]>([]);

  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Tracks which step the on-screen arrow currently belongs to, so a resize
  // (same step, arrow just needs to glide to a new position) can be told
  // apart from an actual step change (old arrow should fade out, not glide).
  const lastStepRef = useRef<number | null>(null);
  const nextArrowIdRef = useRef(0);
  const exitTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useLayoutEffect(() => {
    const timers = exitTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // Layout flips from stacked (screen on top, steps below) to side-by-side
  // (screen left, steps right) at the `lg` breakpoint — matches the
  // `lg:grid-cols-[...]` on the root grid below.
  const [isDesktop, setIsDesktop] = useState(false);
  useLayoutEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const handleSelect = (i: number) => {
    const nextScreen = steps[i].screen ?? screen;
    setActiveIndex(i);
    if (nextScreen.src !== currentScreen.src) {
      // New image: hide the arrow until it's actually loaded and laid out,
      // so it doesn't draw against the previous screenshot's geometry.
      setImageReady(false);
      setCurrentScreen(nextScreen);
    }
  };

  useLayoutEffect(() => {
    if (!imageReady) return;

    let frame = 0;
    const recompute = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        const itemEl = itemRefs.current[activeIndex];
        const content = contentRef.current;
        if (!root || !itemEl || !content) return;

        const rootRect = root.getBoundingClientRect();
        const itemRect = itemEl.getBoundingClientRect();
        const contentBox = content.getBoundingClientRect();
        if (rootRect.width === 0 || contentBox.width === 0) return;

        const contentRect = resolveContentRect(contentBox, currentScreen.aspect, currentScreen.variant);

        // `target` is the field's own edge — right next to it, not deep
        // inside — so it reads the same way whether the arrow approaches
        // from the side (desktop) or from below (mobile).
        const target = steps[activeIndex].target;
        const end: Point = {
          x: contentRect.left - rootRect.left + (target.x / 100) * contentRect.width,
          y: contentRect.top - rootRect.top + (target.y / 100) * contentRect.height,
        };

        const start: Point = isDesktop
          ? // Screen sits left of the steps: originate from the step's own
            // left border, the side facing the screen.
            { x: itemRect.left - rootRect.left, y: itemRect.top + itemRect.height / 2 - rootRect.top }
          : // Stacked: screen sits above the steps, so originate from the
            // step's top border, the side facing the screen.
            { x: itemRect.left + itemRect.width / 2 - rootRect.left, y: itemRect.top - rootRect.top };

        const built = buildArrow(start, end, activeIndex);
        const isNewStep = lastStepRef.current !== activeIndex;
        lastStepRef.current = activeIndex;

        setArrows((prev) => {
          if (!isNewStep) {
            // Same step, just a re-layout (resize/breakpoint change) — jump
            // the live arrow straight to its new geometry, no replay.
            return prev.map((a) => (a.exiting ? a : { ...a, ...built }));
          }
          // Step changed: ease the old arrow out, ease the new one in.
          prev.forEach((a) => {
            if (a.exiting || exitTimersRef.current.has(a.id)) return;
            const timer = setTimeout(() => {
              setArrows((cur) => cur.filter((x) => x.id !== a.id));
              exitTimersRef.current.delete(a.id);
            }, ARROW_EXIT_MS);
            exitTimersRef.current.set(a.id, timer);
          });
          const entering: ArrowInstance = { id: nextArrowIdRef.current++, exiting: false, ...built };
          return [...prev.map((a) => ({ ...a, exiting: true })), entering];
        });
      });
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(rootRef.current!);
    window.addEventListener("resize", recompute);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, imageReady, isDesktop, currentScreen.aspect]);

  return (
    <div
      ref={rootRef}
      className="relative grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4"
    >
      <div className="w-full max-w-[95%] mx-auto lg:mx-0">
        <FramedScreenshot
          key={currentScreen.src}
          ref={contentRef}
          src={currentScreen.src}
          alt={currentScreen.alt}
          variant={currentScreen.variant ?? "dialog"}
          aspect={currentScreen.aspect}
          scale={currentScreen.scale}
          onImageLoad={() => setImageReady(true)}
        />
      </div>

      <div className="flex flex-col lg:h-full">
        {hint && <p className="font-body-sm text-xs text-secondary mb-3">{hint}</p>}
        <ol className="flex flex-col lg:flex-1">
          {steps.map((step, i) => {
            const isActive = activeIndex === i;
            return (
              <li
                key={step.title}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => handleSelect(i)}
                className={`flex gap-4 items-baseline ${i > 0 ? "mt-6" : ""} rounded-sm border px-2 py-1.5 cursor-pointer transition-colors ${
                  isActive
                    ? "bg-surface-container-low border-primary"
                    : "border-outline-variant hover:bg-surface-container-low"
                }`}
              >
                <span
                  className={`font-code-md text-code-md font-bold shrink-0 transition-colors ${
                    isActive ? "text-primary" : "text-secondary/50"
                  }`}
                >
                  {i + 1}
                </span>
                <div>
                  <h4
                    className={`font-body-sm text-[15px] font-semibold mb-1.5 transition-colors ${
                      isActive ? "text-primary" : "text-on-surface"
                    }`}
                  >
                    {step.title}
                  </h4>
                  <p className="font-body-sm text-body-sm text-secondary">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <svg
        className="absolute inset-0 z-20 w-full h-full overflow-visible pointer-events-none"
        aria-hidden
      >
        {arrows.map((a) => (
          <g key={a.id} style={{ color: "#6b4a45" }}>
            {/* Positions the shaft (translate/rotate/scale-to-fit) — set as
                the plain SVG `transform` attribute, not CSS `style.transform`,
                which would anchor around the element's bbox center instead
                of true (0,0) and throw off every point downstream. The grow
                animation below is a separate, nested CSS transform so it
                scales from the shaft's own start point without fighting
                this one. */}
            <g transform={a.transform}>
              <g
                style={{
                  transformOrigin: "0px 0px",
                  animation: a.exiting
                    ? `docs-arrow-shaft-out ${ARROW_EXIT_MS}ms ease-in forwards`
                    : `docs-arrow-shaft-in ${ARROW_ENTER_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards`,
                }}
              >
                <path
                  d={a.shaft}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="6 5.5"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            </g>
            {/* The head sits at the real endpoint, angled to the true exit
                tangent (not inside the scaled shaft group above, so it
                never stretches). `head` is a canonical wedge pointing +x
                with its tip at the local origin — squashing it with
                `scaleY` around that origin (the animation below) collapses
                its ±y spread flat, leaving a line running straight back
                from the tip that continues the shaft's own direction. That
                turns the entry into "a line unfurling into a wedge," and
                the exit into the reverse, instead of a static shape just
                fading. */}
            <g transform={a.headTransform}>
              <g
                style={{
                  transformOrigin: "0px 0px",
                  animation: a.exiting
                    ? `docs-arrow-head-out ${ARROW_EXIT_MS}ms ease-in forwards`
                    : `docs-arrow-head-in 260ms ease-out ${ARROW_ENTER_MS - 260}ms forwards`,
                  opacity: a.exiting ? undefined : 0,
                }}
              >
                <path d={a.head} fill="currentColor" stroke="none" />
              </g>
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}
