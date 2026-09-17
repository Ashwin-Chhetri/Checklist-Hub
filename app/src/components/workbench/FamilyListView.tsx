"use client";

import { useMemo, useRef, useState } from "react";
import type { BoundaryGeometry } from "@/modules/checklist/services/regionApi";
import type { FamilyStat } from "@/modules/species/hooks/useFamilyStats";
import RegionOccurrenceMap from "./panels/RegionOccurrenceMap";

export type { FamilyStat };

interface FamilyListViewProps {
  families: FamilyStat[];
  boundary: BoundaryGeometry | null;
  isBoundaryApproximate?: boolean;
  isBoundaryLoading?: boolean;
}

// Bars beyond this are folded into "Other families" — a real multi-order
// checklist can span dozens of families, and a wheel with that many wedges
// stops being readable (labels collide, gaps vanish).
const MAX_WEDGES = 14;

// 5-stop sequential ramp (violet -> rose -> amber), OKLCH-spaced for a clean
// lightness ramp and >=2:1 contrast at the light end against this card's
// white surface — validated with the dataviz skill's palette checker.
const OCC_RAMP: [number, number, number][] = [
  [0x57, 0x3f, 0x70],
  [0x8f, 0x4f, 0x79],
  [0xbd, 0x5a, 0x6d],
  [0xd9, 0x70, 0x46],
  [0xe8, 0x93, 0x20],
];

function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const segs = OCC_RAMP.length - 1;
  const pos = clamped * segs;
  const i = Math.min(segs - 1, Math.floor(pos));
  const localT = pos - i;
  const a = OCC_RAMP[i];
  const b = OCC_RAMP[i + 1];
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

const CX = 420;
const CY = 420;
const CENTER_R = 88;
const BAR_INNER_R = 104;
const OUTER_R = 300;
const LABEL_LEADER_R = 316;
const LABEL_TEXT_R = 324;
const VIEWBOX = 840;

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
  if (norm < 6 || norm > 354) return { anchor: "middle", dx: 0, dy: -6 };
  if (Math.abs(norm - 180) < 6) return { anchor: "middle", dx: 0, dy: 16 };
  if (norm > 180) return { anchor: "end", dx: -8, dy: 4 };
  return { anchor: "start", dx: 8, dy: 4 };
}

function initials(name: string): string {
  return name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "?";
}

export default function FamilyListView({
  families,
  boundary,
  isBoundaryApproximate = false,
  isBoundaryLoading = false,
}: FamilyListViewProps) {
  const display = useMemo<FamilyStat[]>(() => {
    const sorted = [...families].sort((a, b) => b.species - a.species);
    if (sorted.length <= MAX_WEDGES) return sorted;
    const top = sorted.slice(0, MAX_WEDGES - 1);
    const rest = sorted.slice(MAX_WEDGES - 1);
    const other = rest.reduce(
      (acc, f) => ({ name: "Other families", species: acc.species + f.species, occurrences: acc.occurrences + f.occurrences }),
      { name: "Other families", species: 0, occurrences: 0 },
    );
    return [...top, other];
  }, [families]);

  const totalSpecies = families.reduce((s, f) => s + f.species, 0);
  const totalOcc = families.reduce((s, f) => s + f.occurrences, 0);
  const occMin = Math.min(...display.map((f) => f.occurrences), 0);
  const occMax = Math.max(...display.map((f) => f.occurrences), 1);
  const speciesMax = Math.max(...display.map((f) => f.species), 1);

  const scaleMax = niceCeil(speciesMax * 1.05);
  const ringVals = [Math.round(scaleMax / 3), Math.round((scaleMax * 2) / 3), scaleMax];
  const radiusForSpecies = (v: number) => BAR_INNER_R + (v / scaleMax) * (OUTER_R - BAR_INNER_R);
  const occT = (v: number) => (occMax === occMin ? 0.5 : Math.pow((v - occMin) / (occMax - occMin), 0.55));

  const n = display.length || 1;
  const gapDeg = Math.min(10, Math.max(2, (360 / n) * 0.2));
  const slot = 360 / n;

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; f: FamilyStat } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  function moveTooltip(e: React.MouseEvent, f: FamilyStat) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, f });
  }

  function selectFamily(name: string) {
    setSelected((prev) => (prev === name ? null : name));
    const card = stripRef.current?.querySelector(`[data-fam="${CSS.escape(name)}"]`);
    card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  const activeName = selected ?? hovered;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase">
            Species by family
          </h3>
          <p className="mono-text text-[10px] text-on-surface-variant mt-1">
            {totalSpecies.toLocaleString()} species &middot; {totalOcc.toLocaleString()} occurrence records across{" "}
            {families.length.toLocaleString()} {families.length === 1 ? "family" : "families"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 w-40 flex-shrink-0">
          <span className="font-label-caps text-[9px] font-bold text-slate-400 tracking-widest uppercase">
            Occurrence records
          </span>
          <div
            className="w-full h-2 rounded"
            style={{ background: `linear-gradient(90deg, ${OCC_RAMP.map((c) => `rgb(${c.join(",")})`).join(", ")})` }}
          />
          <div className="w-full flex justify-between mono-text text-[9px] text-slate-400">
            <span>{occMin.toLocaleString()}</span>
            <span>{occMax.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div ref={wrapRef} className="relative mx-auto w-full max-w-[480px]">
        <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="block w-full h-auto overflow-visible">
          <g>
            {ringVals.map((v) => {
              const r = radiusForSpecies(v);
              const tp = polar(r, -3.2);
              return (
                <g key={v}>
                  <circle cx={CX} cy={CY} r={r} fill="none" stroke="#dcd9d0" strokeWidth={1} strokeDasharray="3 4" />
                  <text x={tp.x} y={tp.y} textAnchor="end" fontSize={11} fill="#6b6a63" fontFamily="var(--mono, monospace)">
                    {v.toLocaleString()}
                  </text>
                </g>
              );
            })}
          </g>

          <g>
            {display.map((f, i) => {
              const mid = i * slot;
              return (
                <line
                  key={`spoke-${f.name}`}
                  x1={polar(BAR_INNER_R, mid).x}
                  y1={polar(BAR_INNER_R, mid).y}
                  x2={polar(OUTER_R, mid).x}
                  y2={polar(OUTER_R, mid).y}
                  stroke="#dcd9d0"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
              );
            })}
          </g>

          <foreignObject x={CX - CENTER_R} y={CY - CENTER_R} width={CENTER_R * 2} height={CENTER_R * 2}>
            <div className="w-full h-full rounded-full overflow-hidden" style={{ boxShadow: "0 0 0 1px #dcd9d0" }}>
              <RegionOccurrenceMap
                boundary={boundary}
                points={[]}
                isApproximate={isBoundaryApproximate}
                isLoading={isBoundaryLoading}
                heightClassName="h-full"
                viewBoxWidth={200}
                viewBoxHeight={200}
              />
            </div>
          </foreignObject>
          <circle cx={CX} cy={CY} r={CENTER_R} fill="none" stroke="#dcd9d0" strokeWidth={1} />

          <g>
            {display.map((f, i) => {
              const mid = i * slot;
              const start = mid - (slot - gapDeg) / 2;
              const end = mid + (slot - gapDeg) / 2;
              const barR = radiusForSpecies(f.species);
              const color = rampColor(occT(f.occurrences));
              const dim = activeName != null && activeName !== f.name;
              return (
                <path
                  key={f.name}
                  d={sectorPath(BAR_INNER_R, barR, start, end)}
                  fill={color}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  opacity={dim ? 0.35 : 1}
                  className="cursor-pointer transition-[filter,opacity] hover:brightness-110"
                  style={selected === f.name ? { stroke: "#1f6f43", strokeWidth: 2.5 } : undefined}
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
                  onClick={() => selectFamily(f.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectFamily(f.name);
                    }
                  }}
                />
              );
            })}
          </g>

          <g>
            {display.map((f, i) => {
              const mid = i * slot;
              const lp1 = polar(OUTER_R, mid);
              const lp2 = polar(LABEL_LEADER_R, mid);
              const tp = polar(LABEL_TEXT_R, mid);
              const a = labelAnchor(mid);
              const dim = activeName != null && activeName !== f.name;
              return (
                <g key={`label-${f.name}`}>
                  <line x1={lp1.x} y1={lp1.y} x2={lp2.x} y2={lp2.y} stroke="#dcd9d0" strokeWidth={1} strokeDasharray="2 3" />
                  <text
                    x={tp.x + a.dx}
                    y={tp.y + a.dy}
                    textAnchor={a.anchor}
                    fontSize={14}
                    fontWeight={selected === f.name ? 700 : 600}
                    fill={selected === f.name ? "#1f6f43" : dim ? "#9c9284" : "#1c1c1a"}
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
                    onClick={() => selectFamily(f.name)}
                  >
                    {f.name}
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

      <div>
        <h3 className="font-label-caps text-[10px] font-bold text-slate-400 tracking-widest uppercase mb-2">
          Families
        </h3>
        <div ref={stripRef} className="flex gap-2.5 overflow-x-auto pb-1.5" style={{ scrollSnapType: "x proximity" }}>
          {display.map((f) => {
            const color = rampColor(occT(f.occurrences));
            return (
              <button
                key={f.name}
                type="button"
                data-fam={f.name}
                onClick={() => selectFamily(f.name)}
                style={{ scrollSnapAlign: "start" }}
                className={`flex-shrink-0 w-28 flex flex-col gap-1.5 rounded-sm border p-2 text-left transition-colors ${
                  selected === f.name ? "border-brand" : "border-outline hover:border-slate-400"
                }`}
              >
                <div className="relative aspect-square rounded-sm bg-[#efece1] flex items-center justify-center overflow-hidden">
                  <span
                    className="absolute top-1 right-1 w-2 h-2 rounded-full"
                    style={{ background: color, boxShadow: "0 0 0 1.5px #efece1" }}
                  />
                  <span className="mono-text font-bold text-lg text-on-surface-variant/70">{initials(f.name)}</span>
                </div>
                <div className="text-[11.5px] font-bold leading-tight truncate" title={f.name}>
                  {f.name}
                </div>
                <div className="text-[10px] text-slate-400">({f.species.toLocaleString()} species)</div>
                <div className="text-[10px] text-slate-400 mono-text">{f.occurrences.toLocaleString()} occurrences</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
