"use client";

import { useState } from "react";
import type { BaseMapType } from "./mapLayers";
import { PROTECTED_AREA_CLASSES } from "./overpassApi";
import { MAP_THEME } from "./mapTheme";

// Matches the design prototype's own palette
// (prototypes/map-view-phase0-darjeeling.html), not the app's global red
// brand — see MapListDialog.tsx for why.
const PROTO = {
  border: "#dcd9d0",
  ink: "#1c1c1a",
  inkDim: "#6b6a63",
  brand: "#1f6f43",
};

interface LayersPanelProps {
  baseMapType: BaseMapType;
  onBaseMapTypeChange: (type: BaseMapType) => void;
  terrainEnabled: boolean;
  onTerrainEnabledChange: (enabled: boolean) => void;
  showProtected: boolean;
  onShowProtectedChange: (visible: boolean) => void;
  showWater: boolean;
  onShowWaterChange: (visible: boolean) => void;
  protectedAreasCount: number | null;
  waterBodiesCount: number | null;
  overlaysLoading: boolean;
}

function MapTypeThumb({ active, onClick, label, swatch }: { active: boolean; onClick: () => void; label: string; swatch: string }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 flex-1">
      <span
        className="relative w-full aspect-square rounded-sm overflow-hidden"
        style={{ border: `1.5px solid ${active ? PROTO.brand : PROTO.border}`, background: swatch }}
      >
        {active && (
          <span
            className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full flex items-center justify-center text-white"
            style={{ background: PROTO.brand, fontSize: 6 }}
          >
            ✓
          </span>
        )}
      </span>
      <span
        className="mono-text text-[8.5px] uppercase tracking-wider"
        style={{ color: active ? PROTO.brand : PROTO.inkDim, fontWeight: active ? 700 : 400 }}
      >
        {label}
      </span>
    </button>
  );
}

function ToggleRow({
  checked,
  onChange,
  label,
  swatch,
  count,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  swatch?: string;
  count?: number | null;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 py-1.5 text-[11px]" style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="w-3.5 h-3.5" style={{ accentColor: PROTO.brand }} />
      {swatch && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: swatch }} />}
      <span className="flex-1" style={{ color: PROTO.ink }}>
        {label}
      </span>
      {count != null && (
        <span className="mono-text text-[9px]" style={{ color: PROTO.inkDim }}>
          {count.toLocaleString()}
        </span>
      )}
    </label>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="font-label-caps text-[9px] font-bold tracking-widest uppercase mb-2 mono-text" style={{ color: PROTO.inkDim }}>
      {children}
    </h4>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px]" style={{ color: PROTO.ink }}>
      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
      {label}
    </div>
  );
}

const MAP_THEME_LEGEND: { color: string; label: string }[] = [
  { color: MAP_THEME.background, label: "Open / low vegetation" },
  { color: MAP_THEME.forest, label: "Forest / dense vegetation" },
  { color: MAP_THEME.grass, label: "Grassland / parks" },
  { color: MAP_THEME.barren, label: "Barren / sparse vegetation" },
  { color: MAP_THEME.water, label: "Water — rivers, lakes" },
  { color: MAP_THEME.residential, label: "Settlement (built-up area)" },
  { color: MAP_THEME.building, label: "Buildings" },
  { color: MAP_THEME.road, label: "Roads" },
];

export default function LayersPanel({
  baseMapType,
  onBaseMapTypeChange,
  terrainEnabled,
  onTerrainEnabledChange,
  showProtected,
  onShowProtectedChange,
  showWater,
  onShowWaterChange,
  protectedAreasCount,
  waterBodiesCount,
  overlaysLoading,
}: LayersPanelProps) {
  const [tab, setTab] = useState<"layers" | "stats">("layers");
  const [legendOn, setLegendOn] = useState(true);

  return (
    <div className="w-[250px] flex-shrink-0 flex flex-col" style={{ borderLeft: `1px solid ${PROTO.border}` }}>
      <div className="flex" style={{ borderBottom: `1px solid ${PROTO.border}` }}>
        {(["layers", "stats"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="flex-1 mono-text text-[10px] uppercase tracking-wider py-2 transition-colors"
            style={{
              color: tab === t ? PROTO.ink : PROTO.inkDim,
              fontWeight: tab === t ? 700 : 400,
              borderBottom: tab === t ? `2px solid ${PROTO.brand}` : "2px solid transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pl-4 pr-1 pt-4 flex flex-col gap-5">
        {tab === "layers" ? (
          <>
            <div>
              <SectionHeading>Map Type</SectionHeading>
              <div className="flex gap-2">
                <MapTypeThumb active={baseMapType === "default"} onClick={() => onBaseMapTypeChange("default")} label="Default" swatch={MAP_THEME.background} />
                <MapTypeThumb active={baseMapType === "satellite"} onClick={() => onBaseMapTypeChange("satellite")} label="Satellite" swatch="#26311c" />
              </div>
              <label className="flex items-center gap-2 py-2 mt-1 text-[11px]" style={{ color: PROTO.ink, cursor: "pointer" }}>
                <input type="checkbox" checked={terrainEnabled} onChange={(e) => onTerrainEnabledChange(e.target.checked)} className="w-3.5 h-3.5" style={{ accentColor: PROTO.brand }} />
                3D Terrain
              </label>
              <label className="flex items-center gap-2 py-1 text-[11px]" style={{ color: PROTO.ink, cursor: "pointer" }}>
                <input type="checkbox" checked={legendOn} onChange={(e) => setLegendOn(e.target.checked)} className="w-3.5 h-3.5" style={{ accentColor: PROTO.brand }} />
                Map Legend
              </label>
            </div>

            <div>
              <SectionHeading>Layers</SectionHeading>
              <ToggleRow checked={showProtected} onChange={onShowProtectedChange} label="Protected Areas" swatch={PROTECTED_AREA_CLASSES["2"].color} count={protectedAreasCount} disabled={overlaysLoading} />
              <ToggleRow checked={showWater} onChange={onShowWaterChange} label="Water Bodies" swatch={MAP_THEME.water} count={waterBodiesCount} disabled={overlaysLoading} />
              <div className="text-[9px] mt-1 uppercase tracking-widest mono-text" style={{ color: PROTO.inkDim }}>
                {overlaysLoading ? "Fetching from OpenStreetMap…" : "Source: OpenStreetMap (Overpass)"}
              </div>
            </div>

            {legendOn && (
              <div>
                <SectionHeading>Map Theme</SectionHeading>
                <div className="flex flex-col gap-1.5">
                  {MAP_THEME_LEGEND.map((s) => (
                    <LegendSwatch key={s.label} color={s.color} label={s.label} />
                  ))}
                </div>
              </div>
            )}

            {showProtected && (
              <div>
                <SectionHeading>Protected Areas Legend</SectionHeading>
                <div className="flex flex-col gap-1.5">
                  {Object.entries(PROTECTED_AREA_CLASSES)
                    .filter(([key]) => key !== "other")
                    .map(([key, cls]) => (
                      <LegendSwatch key={key} color={cls.color} label={cls.label} />
                    ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-[11px] leading-relaxed" style={{ color: PROTO.inkDim }}>
            <SectionHeading>Terrain &amp; Elevation</SectionHeading>
            <p className="mb-4">Coming soon — sampled elevation min/max/mean across the region.</p>
            <SectionHeading>Climate</SectionHeading>
            <p className="mb-4">Coming soon — regional temperature summary via Open-Meteo.</p>
            <SectionHeading>Land Cover &amp; Habitat</SectionHeading>
            <p>Coming soon — dominant land-cover breakdown from ESA WorldCover.</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 text-[8.5px] leading-relaxed mono-text" style={{ color: PROTO.inkDim, borderTop: `1px solid ${PROTO.border}` }}>
        <div className="font-bold uppercase tracking-wider mb-1" style={{ color: PROTO.ink }}>
          Map Data
        </div>
        OpenStreetMap · OpenFreeMap · Esri (satellite) · Open-Meteo
        <br />
        ESA WorldCover · NASA GIBS · Overpass
      </div>
    </div>
  );
}
