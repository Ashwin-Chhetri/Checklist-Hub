"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import { useTaxonGroupStats, type TaxonGroupParent, type TaxonGroupRank, type TaxonGroupStat } from "@/modules/species/hooks/useTaxonGroupStats";
import { useSpeciesMedia } from "@/modules/taxonomy/hooks/useSpeciesMedia";
import { useGroupOccurrences } from "@/modules/evidence/hooks/useGroupOccurrences";
import RegionHubBadge from "./panels/region-explorer/RegionHubBadge";
import type { Bbox } from "./panels/region-explorer/overpassApi";
import ImageShimmer from "./ImageShimmer";

interface FamilyListViewProps {
  checklistId: string;
  boundary: BoundaryGeometry | null;
  bbox: Bbox | null;
  /** GADM region id — passed straight through to the occurrence-points
   * lookup for whichever group is selected (see useGroupOccurrences). */
  gadmId?: string | null;
  isBoundaryApproximate?: boolean;
  isBoundaryLoading?: boolean;
  regionName?: string | null;
  /** Jumps the parent dialog to the Map tab — wired from the center hub
   * badge's click (it's a static snapshot, not a pannable map). */
  onOpenMap?: () => void;
}

// Wedges beyond this are folded into one "Other" wedge in the WHEEL only
// (see wheelGroups below) — a real multi-order checklist can span dozens of
// families, and a fixed-size wheel with that many slices stops being
// readable (labels collide, gaps vanish) well before it runs out of room
// for the sidebar list, which has no such limit.
const WHEEL_MAX_WEDGES = 15;

// Everything below this line is ported 1:1 from the design prototype's own
// List View (prototypes/map-view-phase0-darjeeling.html, LIST_* constants
// and buildListView()) — geometry ratios, the cube-root radius curve, the
// 10-stop palette, slot ordering, and label placement, so this chart is
// pixel-proportionally the same wheel, not a from-scratch reinterpretation
// of it. Colored by SPECIES COUNT (not occurrences) — matching the
// prototype's own basis.
const LIST_PALETTE: [number, number, number][] = [
  [0x9d, 0x7a, 0x96],
  [0xa7, 0x7f, 0x9a],
  [0xc4, 0x7f, 0x9d],
  [0xde, 0x84, 0x9f],
  [0xe4, 0x67, 0x80],
  [0xe4, 0x6f, 0x85],
  [0xee, 0x76, 0x8e],
  [0xf5, 0x80, 0x95],
  [0xf5, 0x8a, 0x96],
  [0xfe, 0xaf, 0x8f],
];

function listRampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const segs = LIST_PALETTE.length - 1;
  const pos = clamped * segs;
  const i = Math.min(segs - 1, Math.floor(pos));
  const localT = pos - i;
  const a = LIST_PALETTE[i];
  const b = LIST_PALETTE[i + 1];
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * localT);
  return `rgb(${lerp(a[0], b[0])}, ${lerp(a[1], b[1])}, ${lerp(a[2], b[2])})`;
}

function niceCeil(v: number): number {
  if (v <= 0) return 10;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const n = v / base;
  const niceN = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return niceN * base;
}

// Geometry constants, verbatim from the prototype (absolute units don't
// matter — the SVG's viewBox scales everything uniformly, so copying the
// exact numbers guarantees the exact proportions).
const CENTER_R = 665;
const BAR_INNER_R = 680;
const OUTER_R = 880;
const LEADER_R = 910;
const TEXT_R = 930;
const LABEL_SCALE_REF_CX = 620;
const LABEL_SCALE_REF_TEXT_R = 433;
const CX = Math.round(TEXT_R * (LABEL_SCALE_REF_CX / LABEL_SCALE_REF_TEXT_R));
const CY = CX;
const LABEL_SCALE = CX / LABEL_SCALE_REF_CX;
const VIEWBOX = CX * 2;
const LABEL_MARGIN = 14;
const GAP_DEG = 6;

// Cube-root radius scale on top of a raised floor (35% of the full travel
// range) — the floor alone would flatten the smallest families to the same
// height; the cube-root curve applied to the remaining 65% keeps every
// family visually distinct while pulling the smallest much closer to the
// largest than a linear or pure-exponent scale would.
const RADIUS_EXP = 1 / 3;
const MIN_BAR_FRAC = 0.35;

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
}

function sectorPath(rInner: number, rOuter: number, startDeg: number, endDeg: number): string {
  const p1 = polar(rOuter, startDeg);
  const p2 = polar(rOuter, endDeg);
  const p3 = polar(rInner, endDeg);
  const p4 = polar(rInner, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y} Z`;
}

function labelAnchor(angle: number): { anchor: "start" | "end" | "middle"; dx: number; dy: number } {
  const norm = ((angle % 360) + 360) % 360;
  const s = LABEL_SCALE;
  if (norm < 6 || norm > 354) return { anchor: "middle", dx: 0, dy: -27 * s };
  if (Math.abs(norm - 180) < 6) return { anchor: "middle", dx: 0, dy: 22 * s };
  if (norm > 180) return { anchor: "end", dx: -8 * s, dy: -3 * s };
  return { anchor: "start", dx: 8 * s, dy: -3 * s };
}

// How much horizontal room a label at this slot angle has before it runs
// into the chart's edge — a function of the slot's own geometry only.
function slotAvail(mid: number): number {
  const tp = polar(TEXT_R, mid);
  const a = labelAnchor(mid);
  const labelX = tp.x + a.dx;
  if (a.anchor === "start") return VIEWBOX - LABEL_MARGIN - labelX;
  if (a.anchor === "end") return labelX - LABEL_MARGIN;
  return 2 * Math.min(labelX - LABEL_MARGIN, VIEWBOX - LABEL_MARGIN - labelX);
}

// How much radial room a slot has before its own ray exits the chart's
// square canvas — a circle inscribed in a square only reaches the edge at
// CX along the four cardinal directions; the four diagonals reach CX*sqrt(2),
// ~41% further out. Used to put the biggest bars where there's the most
// spare room around them (the diagonal-facing slots).
function slotBoundaryR(mid: number): number {
  const rad = (mid * Math.PI) / 180;
  return CX / Math.max(Math.abs(Math.sin(rad)), Math.abs(Math.cos(rad)));
}

function orderGroupsToFitSlots(groups: TaxonGroupStat[]): TaxonGroupStat[] {
  const n = groups.length;
  const bySize = [...groups].sort((a, b) => b.species - a.species);
  const slots = Array.from({ length: n }, (_, i) => ({ index: i, boundaryR: slotBoundaryR((360 / n) * i) }));
  slots.sort((a, b) => b.boundaryR - a.boundaryR);
  const arrangement = new Array<TaxonGroupStat>(n);
  slots.forEach((slot, k) => {
    arrangement[slot.index] = bySize[k];
  });
  return arrangement;
}

// Generic family-card glyph — matches the design prototype's own
// `#list-glyph-generic` symbol 1:1 (prototypes/map-view-phase0-darjeeling.html)
// rather than a per-family monogram, since the prototype has no per-family
// artwork either.
function FamilyGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" style={{ color: "#1c1c1a", opacity: 0.75 }}>
      <path
        d="M12 3c-1 0-4.2 3-4.2 7.2C7.8 14 10 17 12 21c2-4 4.2-7 4.2-10.8C16.2 6 13 3 12 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.1" fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

// Overall thumbnail footprint — 60px * 1.2, 20% bigger than the original.
const THUMB_SIZE = 72;

// Sidebar thumbnail — one species' own photo at a time (via the same GBIF
// media lookup the workbench Evidence gallery uses), with prev/next arrows
// to page through the group's other sample species. A candidate with no
// usable photo is skipped automatically (not just on manual nav) — several
// high-ranked species in a group can easily have zero GBIF media each, and
// stopping on the first one made "photo not found" the common case instead
// of the exception. Falls back to the generic glyph only once every
// candidate in the sample has been tried and none had a photo.
function FamilyThumbCarousel({ taxonKeys, onOpenImage }: { taxonKeys: number[]; onOpenImage: (url: string) => void }) {
  const [index, setIndex] = useState(0);
  const [imgError, setImgError] = useState(false);
  const clampedIndex = taxonKeys.length > 0 ? Math.min(index, taxonKeys.length - 1) : 0;
  const taxonKey = taxonKeys[clampedIndex] ?? null;
  const { data: mediaItems, isLoading } = useSpeciesMedia(taxonKey);
  const imageUrl = !imgError ? mediaItems?.[0]?.url : undefined;

  // Auto-skip candidates with no usable photo — several high-ranked species
  // in a group can easily have zero GBIF media each, and stopping on the
  // first one made "photo not found" the common case instead of the
  // exception. Adjusted directly during render (React's "adjusting state
  // when a prop changes" pattern — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // rather than in an effect, since this only reacts to this component's own
  // already-computed render output, not an external system. `checkedKey`
  // records which candidate this has already acted on, so it fires at most
  // once per resolved fetch instead of looping.
  const [checkedKey, setCheckedKey] = useState<number | null>(null);
  if (!isLoading && taxonKey !== null && checkedKey !== taxonKey && !imageUrl && clampedIndex < taxonKeys.length - 1) {
    setCheckedKey(taxonKey);
    setIndex(clampedIndex + 1);
  }

  function step(delta: number) {
    if (taxonKeys.length === 0) return;
    setImgError(false);
    setCheckedKey(null);
    setIndex((i) => (Math.min(i, taxonKeys.length - 1) + delta + taxonKeys.length) % taxonKeys.length);
  }

  const showShimmer = taxonKey != null && isLoading;
  const showNav = taxonKeys.length > 1;

  return (
    <div
      className="relative flex-shrink-0 rounded-lg overflow-hidden bg-[#efece1] group"
      style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
    >
      {showShimmer ? (
        <ImageShimmer className="absolute inset-0" />
      ) : imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover cursor-zoom-in"
          loading="lazy"
          onError={() => {
            setImgError(true);
            setCheckedKey(null);
          }}
          onClick={(e) => {
            e.stopPropagation();
            onOpenImage(imageUrl);
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <FamilyGlyph />
        </div>
      )}
      {showNav && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            className="absolute left-0 top-0 bottom-0 w-5 flex items-center justify-center bg-gradient-to-r from-black/40 to-transparent text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <span className="material-symbols-outlined text-[14px]">chevron_left</span>
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            className="absolute right-0 top-0 bottom-0 w-5 flex items-center justify-center bg-gradient-to-l from-black/40 to-transparent text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          </button>
        </>
      )}
    </div>
  );
}

interface LabelFit {
  line1: string;
  line2?: string;
}

export default function FamilyListView({
  checklistId,
  boundary,
  bbox,
  gadmId = null,
  isBoundaryApproximate = false,
  isBoundaryLoading = false,
  regionName = null,
  onOpenMap,
}: FamilyListViewProps) {
  // Navigation stack — [] at the root (families), [familyName] once drilled
  // one rank down into that family's genera. Kept as a stack (rather than a
  // single "drilled family" flag) so the breadcrumb trail and back button
  // fall naturally out of the same state.
  const [path, setPath] = useState<string[]>([]);
  const rank: TaxonGroupRank = path.length === 0 ? "family" : "genus";
  const parent: TaxonGroupParent | null = path.length === 0 ? null : { rank: "family", name: path[0] };
  const { groups } = useTaxonGroupStats(checklistId, rank, parent);

  const display = groups;

  // The wheel is a fixed-size circle — past a certain wedge count the
  // labels collide and it stops being readable no matter how it's drawn, so
  // wedges beyond WHEEL_MAX_WEDGES are folded into one "Other" wedge. This
  // is a WHEEL-ONLY cap: the sidebar list below still shows every group
  // individually (each with its own real photos), uncapped.
  const wheelGroups = useMemo<TaxonGroupStat[]>(() => {
    if (display.length <= WHEEL_MAX_WEDGES) return display;
    const top = display.slice(0, WHEEL_MAX_WEDGES - 1);
    const rest = display.slice(WHEEL_MAX_WEDGES - 1);
    const otherName = rank === "family" ? "Other families" : "Other genera";
    const other = rest.reduce(
      (acc, f) => ({ name: otherName, species: acc.species + f.species, occurrences: acc.occurrences + f.occurrences, sampleTaxonKeys: [] as number[] }),
      { name: otherName, species: 0, occurrences: 0, sampleTaxonKeys: [] as number[] },
    );
    return [...top, other];
  }, [display, rank]);

  // Render order != wheelGroups order — biggest bars go to the roomiest
  // (diagonal-facing) slots, regardless of where they fall in `wheelGroups`.
  const arrangement = useMemo(() => orderGroupsToFitSlots(wheelGroups), [wheelGroups]);
  const n = arrangement.length || 1;
  const slot = 360 / n;

  const totalSpecies = display.reduce((s, f) => s + f.species, 0);
  const totalOcc = display.reduce((s, f) => s + f.occurrences, 0);
  const speciesMax = Math.max(...wheelGroups.map((f) => f.species), 1);
  const scaleMax = niceCeil(speciesMax * 1.05);

  const valueT = (v: number) => Math.max(0, Math.min(1, v / scaleMax));
  const radiusForSpecies = (v: number) => {
    const t = valueT(v);
    const range = OUTER_R - BAR_INNER_R;
    const frac = MIN_BAR_FRAC + (1 - MIN_BAR_FRAC) * Math.pow(t, RADIUS_EXP);
    return BAR_INNER_R + frac * range;
  };

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; f: TaxonGroupStat } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Family thumbnail lightbox — any resolved photo in the sidebar carousel
  // opens full-size here; closes on backdrop click, the X, or Escape.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!lightboxUrl) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxUrl(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxUrl]);

  // Occurrence points for whichever group is currently selected — plotted on
  // the center hub badge so clicking a family/genus shows "where" as well as
  // "how many". Nothing selected -> no lookup, badge renders as before.
  const selectedGroup = display.find((f) => f.name === selected) ?? null;
  const pointsQuery = useGroupOccurrences(selectedGroup?.sampleTaxonKeys ?? [], gadmId);

  // Text-fit safety net — mirrors the prototype's binary-search wrap/break:
  // measure each name's actual rendered width against its slot's available
  // room, and if it doesn't fit, find the longest prefix that does and wrap
  // the remainder onto a second line (splitting mid-word only as a last
  // resort). Runs after paint so getComputedTextLength() sees real layout.
  // Ref targets the name's own <tspan>, never the parent <text> — setting
  // .textContent on <text> itself would wipe out its sibling tspans (the
  // species-count subtitle line) along with it.
  const nameRefs = useRef<Record<string, SVGTSpanElement | null>>({});
  const [labelFits, setLabelFits] = useState<Record<string, LabelFit>>({});

  useLayoutEffect(() => {
    const next: Record<string, LabelFit> = {};
    arrangement.forEach((f, i) => {
      const mid = i * slot;
      const el = nameRefs.current[f.name];
      const available = slotAvail(mid);
      if (!el) {
        next[f.name] = { line1: f.name };
        return;
      }
      el.textContent = f.name;
      if (el.getComputedTextLength() <= available || f.name.length <= 1) {
        next[f.name] = { line1: f.name };
        return;
      }
      let lo = 1;
      let hi = f.name.length;
      let fit = 1;
      while (lo <= hi) {
        const mid2 = (lo + hi) >> 1;
        el.textContent = f.name.slice(0, mid2);
        if (el.getComputedTextLength() <= available) {
          fit = mid2;
          lo = mid2 + 1;
        } else {
          hi = mid2 - 1;
        }
      }
      next[f.name] = { line1: f.name.slice(0, fit), line2: f.name.slice(fit) };
    });
    // Effect deps are [arrangement, slot], not labelFits — this setState
    // doesn't re-trigger the effect itself (it isn't in the dependency
    // list), so this only ever runs once per real arrangement/slot change,
    // never in a loop.
    setLabelFits(next);
  }, [arrangement, slot]);

  function moveTooltip(e: React.MouseEvent, f: TaxonGroupStat) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, f });
  }

  function selectGroup(name: string) {
    setSelected((prev) => (prev === name ? null : name));
    const card = stripRef.current?.querySelector(`[data-fam="${CSS.escape(name)}"]`);
    card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  // Drilling one rank down (family -> genus) is the only level this
  // supports today — genus is already the last rank above the individual
  // species rows themselves, so there's nowhere further down to go.
  function drillInto(name: string) {
    if (rank !== "family") return;
    // Guards the wheel's own synthetic "Other families" wedge (see
    // wheelGroups) — it has no matching real group to drill into.
    if (!groups.some((g) => g.name === name)) return;
    setPath([name]);
    setSelected(null);
    setHovered(null);
    setTooltip(null);
  }

  function goBack() {
    setPath([]);
    setSelected(null);
    setHovered(null);
    setTooltip(null);
  }

  const activeName = selected ?? hovered;
  const rankLabel = rank === "family" ? "Families" : "Genera";
  const unitLabel = (count: number) => (rank === "family" ? (count === 1 ? "family" : "families") : count === 1 ? "genus" : "genera");

  return (
    <div className="flex h-full w-full" style={{ background: "#ffffff" }}>
      <div className="flex-1 min-w-0 relative flex items-center justify-center p-5">
        {/* Back button + breadcrumb — only shown once drilled below the
            family root, top-left of the wheel pane. */}
        {path.length > 0 && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2.5">
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider mono-text hover:bg-black/5 transition-colors"
              style={{ background: "#ffffff", border: "1px solid #dcd9d0", color: "#1c1c1a" }}
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              Back
            </button>
            <div className="text-[11px] mono-text flex items-center" style={{ color: "#6b6a63" }}>
              <button type="button" onClick={goBack} className="hover:underline" style={{ color: "#6b6a63" }}>
                Families
              </button>
              {path.map((name) => (
                <span key={name} className="flex items-center">
                  <span className="mx-1">›</span>
                  <span className="font-bold" style={{ color: "#1c1c1a" }}>
                    {name}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div ref={wrapRef} className="relative h-full flex items-center justify-center">
          <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="block h-full w-auto max-w-full overflow-visible">
            <foreignObject x={CX - CENTER_R} y={CY - CENTER_R} width={CENTER_R * 2} height={CENTER_R * 2}>
              <div className="w-full h-full rounded-full overflow-hidden" style={{ boxShadow: "0 0 0 1px #dcd9d0" }}>
                <RegionHubBadge
                  boundary={boundary}
                  bbox={bbox}
                  isBoundaryApproximate={isBoundaryApproximate}
                  isBoundaryLoading={isBoundaryLoading}
                  regionName={regionName}
                  onOpenMap={onOpenMap}
                  size={200}
                  points={pointsQuery.data}
                />
              </div>
            </foreignObject>
            <circle cx={CX} cy={CY} r={CENTER_R} fill="none" stroke="#dcd9d0" strokeWidth={1} />

            {/* Spokes stop at each group's own bar tip, sitting fully
                underneath the wedge — kept only so a dimmed (opacity-reduced)
                wedge never shows a gap through to the hub behind it. */}
            <g>
              {arrangement.map((f, i) => {
                const mid = i * slot;
                const barR = radiusForSpecies(f.species);
                const s1 = polar(BAR_INNER_R, mid);
                const s2 = polar(barR, mid);
                return <line key={`spoke-${f.name}`} x1={s1.x} y1={s1.y} x2={s2.x} y2={s2.y} stroke="#dcd9d0" strokeWidth={1} strokeDasharray="2 4" />;
              })}
            </g>

            <g>
              {arrangement.map((f, i) => {
                const mid = i * slot;
                const start = mid - (slot - GAP_DEG) / 2;
                const end = mid + (slot - GAP_DEG) / 2;
                const barR = radiusForSpecies(f.species);
                const color = listRampColor(valueT(f.species));
                const dim = activeName != null && activeName !== f.name;
                return (
                  <path
                    key={f.name}
                    d={sectorPath(BAR_INNER_R, barR, start, end)}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    opacity={dim ? 0.35 : 1}
                    className="cursor-pointer transition-[filter,opacity] hover:brightness-[1.08] hover:saturate-[1.08]"
                    tabIndex={0}
                    role="button"
                    aria-label={`${f.name}: ${f.species} species, ${f.occurrences.toLocaleString()} occurrences`}
                    onMouseEnter={(e) => {
                      setHovered(f.name);
                      moveTooltip(e, f);
                    }}
                    onMouseMove={(e) => moveTooltip(e, f)}
                    onMouseLeave={() => {
                      setHovered(null);
                      setTooltip(null);
                    }}
                    onClick={() => selectGroup(f.name)}
                    onDoubleClick={() => drillInto(f.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectGroup(f.name);
                      }
                    }}
                  />
                );
              })}
            </g>

            <g>
              {arrangement.map((f, i) => {
                const mid = i * slot;
                const barR = radiusForSpecies(f.species);
                const lp1 = polar(barR, mid);
                const lp2 = polar(LEADER_R, mid);
                const tp = polar(TEXT_R, mid);
                const a = labelAnchor(mid);
                const dim = activeName != null && activeName !== f.name;
                const isSelected = selected === f.name;
                const labelX = tp.x + a.dx;
                const fit = labelFits[f.name];
                const hasWrap = Boolean(fit?.line2);
                const labelY = hasWrap && a.anchor === "middle" && a.dy < 0 ? tp.y + a.dy - 24 * LABEL_SCALE : tp.y + a.dy;
                return (
                  <g key={`label-${f.name}`}>
                    <line x1={lp1.x} y1={lp1.y} x2={lp2.x} y2={lp2.y} stroke="#000000" strokeWidth={1} opacity={0.8} />
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor={a.anchor}
                      fontSize={23 * LABEL_SCALE}
                      fontWeight={700}
                      fill={dim ? "#6b6a63" : "#1c1c1a"}
                      textDecoration={isSelected ? "underline" : undefined}
                      className="cursor-pointer"
                      tabIndex={0}
                      role="button"
                      onMouseEnter={(e) => {
                        setHovered(f.name);
                        moveTooltip(e, f);
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                        setTooltip(null);
                      }}
                      onClick={() => selectGroup(f.name)}
                      onDoubleClick={() => drillInto(f.name)}
                    >
                      <tspan
                        x={labelX}
                        ref={(el) => {
                          nameRefs.current[f.name] = el;
                        }}
                      >
                        {fit?.line1 ?? f.name}
                      </tspan>
                      {hasWrap && (
                        <tspan x={labelX} dy={24 * LABEL_SCALE}>
                          {fit!.line2}
                        </tspan>
                      )}
                      <tspan
                        x={labelX}
                        dy={18 * LABEL_SCALE}
                        fontFamily="var(--mono, monospace)"
                        fontSize={13 * LABEL_SCALE}
                        fontWeight={700}
                        letterSpacing="0.06em"
                        fill="#6b6a63"
                        style={{ textTransform: "uppercase" }}
                      >
                        {f.species} species
                      </tspan>
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {tooltip && (
            <div
              className="absolute z-10 pointer-events-none -translate-x-1/2 -translate-y-full rounded-md bg-[#1c1c1a] text-white px-2.5 py-1.5 text-[10.5px] leading-relaxed shadow-lg whitespace-nowrap mono-text"
              style={{ left: tooltip.x, top: tooltip.y - 10 }}
            >
              <div className="font-bold text-[11px]">{tooltip.f.name}</div>
              <div className="text-white/70">{tooltip.f.species.toLocaleString()} species</div>
              <div className="text-white/70">{tooltip.f.occurrences.toLocaleString()} occurrences</div>
            </div>
          )}
        </div>
      </div>

      <div className="w-[340px] flex-shrink-0 flex flex-col min-h-0" style={{ borderLeft: "1px solid #dcd9d0" }}>
        <div className="flex-shrink-0 px-4 pt-3.5 pb-2.5">
          <h3 className="mono-text text-[12px] font-bold uppercase tracking-wider" style={{ color: "#1c1c1a" }}>
            {rankLabel}
          </h3>
          <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "#6b6a63" }}>
            {totalSpecies.toLocaleString()} species &middot; {totalOcc.toLocaleString()} occurrences across{" "}
            {display.length.toLocaleString()} {unitLabel(display.length)}
          </p>
        </div>
        <div ref={stripRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3.5 pb-2">
          {display.map((f) => {
            const isSelected = selected === f.name;
            return (
              <button
                key={f.name}
                type="button"
                data-fam={f.name}
                onClick={() => selectGroup(f.name)}
                onDoubleClick={() => drillInto(f.name)}
                className="w-full flex items-center gap-3.5 py-3 px-0.5 text-left transition-colors last:border-b-0"
                style={{
                  borderBottom: "1px solid #dcd9d0",
                  background: isSelected ? "rgba(31,111,67,0.13)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "rgba(31,111,67,0.13)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                <FamilyThumbCarousel taxonKeys={f.sampleTaxonKeys} onOpenImage={setLightboxUrl} />
                <div className="min-w-0 flex flex-col gap-0.5">
                  <div className="text-[13.5px] font-bold leading-tight truncate" style={{ color: "#1c1c1a" }} title={f.name}>
                    {f.name}
                  </div>
                  <div className="text-[10.5px]" style={{ color: "#6b6a63" }}>
                    ({f.species.toLocaleString()} species)
                  </div>
                  <div className="text-[10.5px] mono-text" style={{ color: "#6b6a63" }}>
                    {f.occurrences.toLocaleString()} occurrences
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Family thumbnail lightbox — overlays the whole dialog without
          touching any of the list's own state; closing it (backdrop click,
          X, or Escape) just clears lightboxUrl. */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-8"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightboxUrl(null)}
            title="Close"
          >
            <span className="material-symbols-outlined text-3xl">close</span>
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-sm shadow-hard"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
