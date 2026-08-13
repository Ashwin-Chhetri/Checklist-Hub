// Shared math/types behind the docs hand-drawn field-pointing arrow, used by
// both DocsFieldWalkthrough (single-level steps) and DocsStepWalkthrough
// (steps with sub-steps). Pure and stateless — each component keeps its own
// React state machine (the ArrowInstance array, enter/exit timers) around
// these functions, since that wiring is small and component-specific enough
// not to be worth sharing.
import { ARROW_TEMPLATES } from "@/components/docs/docsArrowTemplates";

export interface Point {
  x: number;
  y: number;
}

/** Parses "1398 / 1205" into 1398/1205. */
export function parseAspect(aspect: string) {
  const [w, h] = aspect.split("/").map((n) => parseFloat(n.trim()));
  return w / h;
}

/**
 * FramedScreenshot's "dialog" box is sized with an explicit width *and*
 * height, which makes its `aspect-ratio` CSS a no-op (per spec, `aspect-ratio`
 * only fills in a dimension left as `auto` — with both already definite, it's
 * ignored). So the box's own `getBoundingClientRect()` is the full padded
 * cutout, not the tightly-fit picture — measuring straight off it would put
 * "94% across" well past the picture's real right edge. This recomputes the
 * actual `object-contain` rect inside that box, the same way the browser
 * fits the `<Image>` visually.
 *
 * `align` must match the variant's own `object-position`: "dialog" centers
 * the image (`object-contain`, no position override → 50% 50%), "full"
 * anchors it to the top (`object-contain object-top` → 50% 0%) so any
 * vertical letterboxing (when the image is relatively wider than the box)
 * all sits below the image, none above. Getting this wrong only shows up
 * when the image's own aspect ratio doesn't closely match the box's — sizes
 * that happen to match (or "dialog", which is always centered) mask the bug.
 */
export function containRect(box: DOMRect, imageAspect: number, align: "center" | "top" = "center") {
  const boxAspect = box.width / box.height;
  if (imageAspect > boxAspect) {
    const height = box.width / imageAspect;
    const top = align === "top" ? box.top : box.top + (box.height - height) / 2;
    return { left: box.left, top, width: box.width, height };
  }
  const width = box.height * imageAspect;
  // Horizontal letterboxing is always centered — both variants' object-position
  // keeps the horizontal component at 50% regardless of vertical anchoring.
  return { left: box.left + (box.width - width) / 2, top: box.top, width, height: box.height };
}

/**
 * Resolves the actual visible-picture rect inside a FramedScreenshot's
 * content box, accounting for how each `variant` fits its image:
 * "dialog" and "full" both use `object-contain` (see `containRect`, with
 * "full" top-anchored instead of centered); "flush" uses `object-cover`,
 * which fills the box exactly with no letterboxing at all (it crops the
 * overflow dimension instead) — so the box itself *is* the visible rect.
 */
export function resolveContentRect(
  box: DOMRect,
  aspect: string,
  variant: "full" | "dialog" | "flush" | undefined,
) {
  if (variant === "flush") return { left: box.left, top: box.top, width: box.width, height: box.height };
  return containRect(box, parseAspect(aspect), variant === "full" ? "top" : "center");
}

// ---------- arrow shaft fitting ----------

function seededRandom(seed: number) {
  let t = seed;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A solid filled wedge, in its own canonical local space: tip pinned at the
 * origin, pointing toward +x, with its two back corners fanning out ±34° at
 * a fixed length. Kept separate from the tip's real position/angle (applied
 * afterwards as a `transform`, see buildArrow) so a CSS `scaleY` on this
 * local shape — squashing the ±y spread toward 0 around the same origin —
 * collapses it to a flat line running straight back from the tip along -x,
 * i.e. a stub that continues the shaft's own incoming direction. That's what
 * lets the entry/exit animation turn the head into "a line that unfurls
 * into a wedge" and back, instead of just fading a static triangle.
 */
function arrowHeadLocalPath(length = 15, spreadDeg = 34) {
  const spread = (spreadDeg * Math.PI) / 180;
  const backX = -length * Math.cos(spread);
  const wingY = length * Math.sin(spread);
  return `M 0 0 L ${backX.toFixed(1)} ${wingY.toFixed(1)} L ${backX.toFixed(1)} ${(-wingY).toFixed(1)} Z`;
}

/**
 * Picks one of the curated reference shafts (see docsArrowTemplates.ts) and
 * fits it between `start` and `end`: translate to `start`, rotate so the
 * shaft's own start→tip chord lines up with the real one, then scale
 * uniformly — the shaft keeps its hand-drawn proportions at any length or
 * angle, the same way the reference sketch reuses a handful of doodles at
 * different orientations. The arrowhead is rebuilt separately, directly at
 * the real endpoint, from the shaft's own last segment (`prevTip` → `tip`)
 * rotated to match — so it always sits exactly on the true exit tangent at
 * a fixed pixel size, regardless of the shaft's scale. `seed` picks the
 * shape and keeps it stable for a given step across re-renders (only the
 * endpoints move with layout).
 */
export function buildArrow(start: Point, end: Point, seed: number) {
  const rand = seededRandom(seed);
  const template = ARROW_TEMPLATES[Math.floor(rand() * ARROW_TEMPLATES.length)];

  const localDx = template.tip.x;
  const localDy = template.tip.y;
  const localLen = Math.hypot(localDx, localDy) || 1;
  const localAngle = Math.atan2(localDy, localDx);
  const localTangent = Math.atan2(template.tip.y - template.prevTip.y, template.tip.x - template.prevTip.x);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const scale = len / localLen;
  const rotate = angle - localAngle;

  const transform = `translate(${start.x.toFixed(1)} ${start.y.toFixed(1)}) rotate(${((rotate * 180) / Math.PI).toFixed(2)}) scale(${scale.toFixed(4)})`;
  const headAngleDeg = ((localTangent + rotate) * 180) / Math.PI;
  const headTransform = `translate(${end.x.toFixed(1)} ${end.y.toFixed(1)}) rotate(${headAngleDeg.toFixed(2)})`;

  return { transform, shaft: template.shaft, head: arrowHeadLocalPath(), headTransform };
}

// ---------- animation lifecycle ----------

export interface ArrowInstance {
  id: number;
  transform: string;
  shaft: string;
  head: string;
  headTransform: string;
  exiting: boolean;
}

// Durations, in ms — kept in sync with the CSS animations in globals.css.
// Deliberately slow: the shaft grows in from its start point like it's
// being drawn, and eases out gently rather than snapping away.
export const ARROW_ENTER_MS = 750;
export const ARROW_EXIT_MS = 550;
