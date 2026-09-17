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
  legendOn: boolean;
  onLegendOnChange: (on: boolean) => void;
}

// The three "Map Type" thumbnail illustrations — ported verbatim from the
// design prototype's inline SVGs (prototypes/map-view-phase0-darjeeling.html,
// .thumb-default/.thumb-satellite/.thumb-terrain) rather than a flat color
// swatch, so this picker reads as the same validated design.
function DefaultThumbArt() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full block" aria-hidden="true">
      <rect width="100" height="100" fill="#f1efe4" />
      <path d="M-6,8 C10,-4 34,3 38,18 C42,31 28,41 18,47 C6,54 -10,48 -8,35 C-7,25 2,17 -6,8 Z" fill="#6cb7e0" />
      <path d="M56,-4 L106,-4 L106,32 C92,36 80,26 71,31 C60,37 58,16 56,-4 Z" fill="#bcdca0" />
      <path d="M-6,68 C8,62 4,86 -8,89 L-8,104 L22,104 C15,92 22,78 -6,68 Z" fill="#bcdca0" />
      <path d="M-10,98 L46,22" stroke="#8f8d84" strokeWidth={10} strokeLinecap="round" />
      <path d="M-10,98 L46,22" stroke="#fbfaf6" strokeWidth={1.3} strokeDasharray="4 4" strokeLinecap="round" />
      <path d="M46,22 L63,44 M40,30 L58,16" stroke="#a6a49a" strokeWidth={3.5} strokeLinecap="round" fill="none" />
    </svg>
  );
}

function SatelliteThumbArt() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full block" aria-hidden="true">
      <rect width="100" height="100" fill="#26311c" />
      <g fill="#3a4d27">
        <circle cx="12" cy="14" r="8" />
        <circle cx="27" cy="7" r="6.5" />
        <circle cx="7" cy="31" r="6.5" />
        <circle cx="91" cy="19" r="8" />
        <circle cx="78" cy="9" r="6.5" />
        <circle cx="95" cy="35" r="6.5" />
        <circle cx="14" cy="86" r="8" />
        <circle cx="29" cy="93" r="6.5" />
        <circle cx="5" cy="71" r="6.5" />
        <circle cx="89" cy="81" r="8" />
        <circle cx="75" cy="91" r="6.5" />
        <circle cx="93" cy="67" r="6.5" />
      </g>
      <g fill="#4c6634">
        <circle cx="21" cy="21" r="4.5" />
        <circle cx="5" cy="9" r="4" />
        <circle cx="35" cy="15" r="4" />
        <circle cx="84" cy="14" r="4.5" />
        <circle cx="97" cy="27" r="4" />
        <circle cx="21" cy="91" r="4.5" />
        <circle cx="35" cy="85" r="4" />
        <circle cx="81" cy="87" r="4.5" />
        <circle cx="97" cy="75" r="4" />
      </g>
      <path d="M-12,0 L112,92" stroke="#54585c" strokeWidth={21} />
      <path d="M-12,0 L112,92" stroke="#e7e7e4" strokeWidth={1.6} strokeDasharray="5 5" />
      <g transform="rotate(48 50 46)">
        <rect x="21" y="18" width="5.5" height="10" rx="1.6" fill="#1c1f24" />
        <rect x="40" y="33" width="5.5" height="10" rx="1.6" fill="#20242a" />
        <rect x="55" y="48" width="5.5" height="10" rx="1.6" fill="#a53a2b" />
        <rect x="70" y="61" width="5.5" height="10" rx="1.6" fill="#1c1f24" />
      </g>
    </svg>
  );
}

function TerrainThumbArt() {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full block" aria-hidden="true">
      <rect width="100" height="100" fill="#dfe7d2" />
      <rect x="50" width="50" height="100" fill="#c3d5ac" />
      <g fill="none" stroke="#a9bd93" strokeWidth={1.4}>
        <path d="M4,10 C20,18 10,30 26,34 C40,38 30,50 44,56" />
        <path d="M-4,30 C14,36 6,46 22,52 C36,56 26,66 40,72" />
        <path d="M-4,55 C12,60 4,70 18,76 C32,80 24,90 36,96" />
      </g>
      <g fill="none" stroke="#8fa578" strokeWidth={1.3}>
        <path d="M55,4 C66,14 78,10 82,22 C86,34 72,32 76,46" />
        <path d="M52,26 C64,34 76,30 80,42 C84,54 70,52 74,66" />
        <path d="M50,50 C62,58 74,54 78,66 C82,78 68,76 72,90" />
      </g>
      <path d="M0,22 C16,18 20,32 30,40 C42,50 46,66 58,72" fill="none" stroke="#7fb8cf" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function DownloadButton({ disabled = true }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Download (coming soon)" : "Download layer"}
      className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-sm"
      style={{ border: `1px solid ${PROTO.border}`, color: PROTO.inkDim, opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      <DownloadIcon />
    </button>
  );
}

function MapTypeThumb({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 flex-1 min-w-0">
      <span
        className="relative w-full aspect-square rounded-sm overflow-hidden"
        style={{ boxShadow: `0 0 0 ${active ? "1.5px" : "1px"} ${active ? PROTO.brand : PROTO.border}` }}
      >
        {children}
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
        className="mono-text text-[8.5px] uppercase tracking-wider truncate w-full text-center"
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
    <label className="flex-1 flex items-center gap-2 py-1.5 text-[11px] min-w-0" style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="w-3.5 h-3.5 flex-shrink-0" style={{ accentColor: PROTO.brand }} />
      {swatch && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: swatch }} />}
      <span className="flex-1 truncate" style={{ color: PROTO.ink }}>
        {label}
      </span>
      {count != null && (
        <span className="mono-text text-[9px] flex-shrink-0" style={{ color: PROTO.inkDim }}>
          {count.toLocaleString()}
        </span>
      )}
    </label>
  );
}

function LayerRow(props: Parameters<typeof ToggleRow>[0] & { withDownload?: boolean }) {
  const { withDownload, ...toggleProps } = props;
  return (
    <div className="flex items-center gap-1.5">
      <ToggleRow {...toggleProps} />
      {/* Export pipeline isn't wired up yet — always disabled ("coming soon"),
          regardless of the layer's own toggle state. */}
      {withDownload && <DownloadButton disabled />}
    </div>
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

const SOURCE_LINKS: { label: string; href: string }[] = [
  { label: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  { label: "OpenFreeMap", href: "https://openfreemap.org/" },
  { label: "Esri (satellite)", href: "https://www.esri.com/en-us/legal/terms/data-attributions" },
  { label: "Open-Meteo", href: "https://open-meteo.com/" },
  { label: "ESA WorldCover", href: "https://esa-worldcover.org/" },
  { label: "NASA GIBS", href: "https://www.earthdata.nasa.gov/data/tools/gibs" },
  { label: "Overpass", href: "https://overpass-api.de/" },
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
  legendOn,
  onLegendOnChange,
}: LayersPanelProps) {
  const [tab, setTab] = useState<"layers" | "stats">("layers");

  return (
    <div className="w-[300px] flex-shrink-0 flex flex-col" style={{ borderLeft: `1px solid ${PROTO.border}` }}>
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

      <div className="flex-1 overflow-y-auto pl-4 pr-3 pt-4 flex flex-col gap-5">
        {tab === "layers" ? (
          <>
            <div>
              <SectionHeading>Map Type</SectionHeading>
              <div className="flex gap-2">
                <MapTypeThumb active={baseMapType === "default"} onClick={() => onBaseMapTypeChange("default")} label="Default">
                  <DefaultThumbArt />
                </MapTypeThumb>
                <MapTypeThumb active={baseMapType === "satellite"} onClick={() => onBaseMapTypeChange("satellite")} label="Satellite">
                  <SatelliteThumbArt />
                </MapTypeThumb>
                <MapTypeThumb active={terrainEnabled} onClick={() => onTerrainEnabledChange(!terrainEnabled)} label="Terrain">
                  <TerrainThumbArt />
                </MapTypeThumb>
              </div>
              <label className="flex items-center gap-2 py-2 mt-1 text-[11px]" style={{ color: PROTO.ink, cursor: "pointer" }}>
                <input type="checkbox" checked={legendOn} onChange={(e) => onLegendOnChange(e.target.checked)} className="w-3.5 h-3.5" style={{ accentColor: PROTO.brand }} />
                Map Legend (on-map icons)
              </label>
            </div>

            <div>
              <SectionHeading>Layers</SectionHeading>
              <ToggleRow checked={showProtected} onChange={onShowProtectedChange} label="Protected Areas" swatch={PROTECTED_AREA_CLASSES["2"].color} count={protectedAreasCount} disabled={overlaysLoading} />
              <LayerRow checked={showWater} onChange={onShowWaterChange} label="Water Bodies" swatch={MAP_THEME.water} count={waterBodiesCount} disabled={overlaysLoading} withDownload />
              <LayerRow checked={false} onChange={() => {}} label="NDVI (vegetation index)" disabled withDownload />
              <LayerRow checked={false} onChange={() => {}} label="Vegetation / Land Cover (satellite)" disabled withDownload />
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

      <div className="px-4 py-3 text-[9px] leading-relaxed mono-text flex flex-wrap items-center gap-x-2.5 gap-y-1" style={{ borderTop: `1px solid ${PROTO.border}` }}>
        <span className="font-bold uppercase tracking-wider w-full mb-0.5" style={{ color: PROTO.ink }}>
          Map Data
        </span>
        {SOURCE_LINKS.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:opacity-80"
            style={{ color: PROTO.inkDim, borderBottom: `1px dotted ${PROTO.border}`, textDecoration: "none" }}
          >
            {s.label}
          </a>
        ))}
      </div>
    </div>
  );
}
