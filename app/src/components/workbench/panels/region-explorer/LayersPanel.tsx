"use client";

import { useState } from "react";
import type { BaseMapType } from "./mapLayers";
import { PROTECTED_AREA_CLASSES, type Bbox } from "./overpassApi";
import { MAP_THEME } from "./mapTheme";
import { WORLDCOVER_PALETTE, ndviDateString, type RegionStats } from "./regionStats";
import { downloadWaterBodiesForQgis, downloadRasterForQgis, ndviWmsUrl, worldcoverWmsUrl, slugify } from "./regionExport";

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
  showNdvi: boolean;
  onShowNdviChange: (visible: boolean) => void;
  showVegetation: boolean;
  onShowVegetationChange: (visible: boolean) => void;
  protectedAreasCount: number | null;
  protectedAreaNames: string[] | null;
  waterBodiesCount: number | null;
  waterBodiesGeoJSON: GeoJSON.FeatureCollection | null;
  overlaysLoading: boolean;
  legendOn: boolean;
  onLegendOnChange: (on: boolean) => void;
  regionStats: RegionStats | null;
  regionStatsLoading: boolean;
  onOpenMapDetails: () => void;
  /** Region bbox + display name — needed for the NDVI/Vegetation raster downloads (fresh WMS fetch, not the tiled map layer) and for naming the water-bodies export. */
  bbox: Bbox;
  regionName: string | null;
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

function DownloadButton({ onClick, loading, title }: { onClick?: () => void; loading?: boolean; title: string }) {
  const disabled = !onClick || loading;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-sm"
      style={{ border: `1px solid ${PROTO.border}`, color: PROTO.inkDim, opacity: disabled && !loading ? 0.4 : 1, cursor: disabled ? (loading ? "wait" : "default") : "pointer" }}
    >
      {loading ? (
        <span className="block w-2.5 h-2.5 rounded-full animate-spin" style={{ border: "1.5px solid currentColor", borderTopColor: "transparent" }} />
      ) : (
        <DownloadIcon />
      )}
    </button>
  );
}

// Fixed-size icon picker, NOT flex-1 — matching the prototype's own
// `.view-mode-btn { width:25%; max-width:39px }`. A flexed/stretched thumb
// here was the "icons are too big" bug: at this sidebar's width, flex-1
// blew each thumbnail up to ~90px instead of the prototype's compact ~39px.
function MapTypeThumb({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 flex-none w-1/4 max-w-[39px]">
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
  count,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  count?: number | null;
  disabled?: boolean;
}) {
  return (
    <label className="flex-1 flex items-center gap-2 py-1.5 text-[11px] min-w-0" style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? "default" : "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="w-3.5 h-3.5 flex-shrink-0" style={{ accentColor: PROTO.brand }} />
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

function LayerRow(props: Parameters<typeof ToggleRow>[0] & { download?: { onClick?: () => void; loading?: boolean; title: string } }) {
  const { download, ...toggleProps } = props;
  return (
    <div className="flex items-center gap-1.5">
      <ToggleRow {...toggleProps} />
      {download && <DownloadButton onClick={download.onClick} loading={download.loading} title={download.title} />}
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

function StatRow({
  label,
  value,
  sub,
  loading,
  last,
}: {
  label: string;
  value: string | null;
  sub?: string;
  loading?: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 py-1.5" style={{ borderBottom: last ? "none" : `1px dashed ${PROTO.border}` }}>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: PROTO.inkDim }}>
        {label}
      </span>
      <span className="text-[12px] font-bold text-right" style={{ color: value ? PROTO.ink : PROTO.inkDim }}>
        {value ?? (loading ? "loading…" : "unavailable")}
      </span>
      {sub && (
        <span className="w-full text-[9px] mono-text" style={{ color: PROTO.inkDim }}>
          {sub}
        </span>
      )}
    </div>
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

// 5-stop brown -> yellow -> green ramp, matching the design prototype's
// .legend-gradient — GIBS' own NDVI palette runs the same direction (bare/
// water at the low end, dense vegetation at the high end).
function NdviLegend() {
  return (
    <div>
      <div className="h-2 rounded-sm mt-1.5" style={{ background: "linear-gradient(90deg, #a06a3a, #d9c25c, #8fc93a, #2f7d32, #0b4a17)" }} />
      <div className="flex justify-between text-[8.5px] mono-text mt-1" style={{ color: PROTO.inkDim }}>
        <span>Bare / water</span>
        <span>Dense vegetation</span>
      </div>
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

type DownloadKey = "water" | "ndvi" | "vegetation";

export default function LayersPanel({
  baseMapType,
  onBaseMapTypeChange,
  terrainEnabled,
  onTerrainEnabledChange,
  showProtected,
  onShowProtectedChange,
  showWater,
  onShowWaterChange,
  showNdvi,
  onShowNdviChange,
  showVegetation,
  onShowVegetationChange,
  protectedAreasCount,
  protectedAreaNames,
  waterBodiesCount,
  waterBodiesGeoJSON,
  overlaysLoading,
  legendOn,
  onLegendOnChange,
  regionStats,
  regionStatsLoading,
  onOpenMapDetails,
  bbox,
  regionName,
}: LayersPanelProps) {
  const [tab, setTab] = useState<"layers" | "stats">("layers");
  const [downloading, setDownloading] = useState<Partial<Record<DownloadKey, boolean>>>({});
  const [downloadError, setDownloadError] = useState<Partial<Record<DownloadKey, string>>>({});
  const regionSlug = slugify(regionName ?? "region");

  function runDownload(key: DownloadKey, task: () => Promise<void>) {
    setDownloading((d) => ({ ...d, [key]: true }));
    setDownloadError((d) => ({ ...d, [key]: undefined }));
    task()
      .catch((err) => {
        console.error(`[LayersPanel] ${key} download failed`, err);
        const message = err instanceof Error ? err.message : "Download failed";
        setDownloadError((d) => ({ ...d, [key]: message }));
        setTimeout(() => setDownloadError((d) => ({ ...d, [key]: undefined })), 3000);
      })
      .finally(() => setDownloading((d) => ({ ...d, [key]: false })));
  }

  const waterReady = !overlaysLoading && waterBodiesGeoJSON != null && (waterBodiesCount ?? 0) > 0;

  return (
    <div className="w-[340px] flex-shrink-0 flex flex-col" style={{ borderLeft: `1px solid ${PROTO.border}` }}>
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
              <div className="flex gap-4">
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
              <ToggleRow checked={showProtected} onChange={onShowProtectedChange} label="Protected Areas" count={protectedAreasCount} disabled={overlaysLoading} />
              <LayerRow
                checked={showWater}
                onChange={onShowWaterChange}
                label="Water Bodies"
                count={waterBodiesCount}
                disabled={overlaysLoading}
                download={{
                  onClick: waterReady
                    ? () => runDownload("water", () => downloadWaterBodiesForQgis(waterBodiesGeoJSON!, regionName ?? "Region", regionSlug))
                    : undefined,
                  loading: downloading.water,
                  title:
                    downloadError.water ??
                    (overlaysLoading
                      ? "Resolving region — download will be ready shortly"
                      : waterReady
                        ? "Download water-body vector data (GeoJSON + KML) for QGIS"
                        : "No water-body features found in this region"),
                }}
              />
              <LayerRow
                checked={showNdvi}
                onChange={onShowNdviChange}
                label="NDVI (vegetation index)"
                download={{
                  onClick: () => runDownload("ndvi", () => downloadRasterForQgis(bbox, `${regionSlug}-ndvi-${ndviDateString()}`, ndviWmsUrl)),
                  loading: downloading.ndvi,
                  title: downloadError.ndvi ?? "Download georeferenced NDVI raster (PNG + world file) for QGIS",
                }}
              />
              <LayerRow
                checked={showVegetation}
                onChange={onShowVegetationChange}
                label="Vegetation / Land Cover (satellite)"
                download={{
                  onClick: () => runDownload("vegetation", () => downloadRasterForQgis(bbox, `${regionSlug}-worldcover-landcover`, worldcoverWmsUrl)),
                  loading: downloading.vegetation,
                  title: downloadError.vegetation ?? "Download georeferenced land-cover raster (PNG + world file) for QGIS",
                }}
              />
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

            {showNdvi && (
              <div>
                <SectionHeading>NDVI Legend</SectionHeading>
                <NdviLegend />
              </div>
            )}

            {showVegetation && (
              <div>
                <SectionHeading>Land Cover Legend</SectionHeading>
                <div className="flex flex-col gap-1.5">
                  {WORLDCOVER_PALETTE.map((c) => (
                    <LegendSwatch key={c.code} color={c.color} label={c.label} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <SectionHeading>Terrain &amp; Elevation</SectionHeading>
              <StatRow label="Highest elevation" value={regionStats?.elevation ? `${Math.round(regionStats.elevation.maxM).toLocaleString()} m` : null} loading={regionStatsLoading} />
              <StatRow label="Lowest elevation" value={regionStats?.elevation ? `${Math.round(regionStats.elevation.minM).toLocaleString()} m` : null} loading={regionStatsLoading} />
              <StatRow label="Mean elevation" value={regionStats?.elevation ? `${Math.round(regionStats.elevation.meanM).toLocaleString()} m` : null} loading={regionStatsLoading} last />
            </div>

            <div>
              <SectionHeading>Climate</SectionHeading>
              <StatRow
                label="Annual mean temp."
                value={regionStats?.climate ? `${regionStats.climate.meanTempC.toFixed(1)} °C` : null}
                sub={regionStats?.climate ? `${regionStats.climate.year} annual mean, ${regionStats.climate.sampleDays} days sampled at region centroid` : undefined}
                loading={regionStatsLoading}
                last
              />
            </div>

            <div>
              <SectionHeading>Land Cover &amp; Habitat</SectionHeading>
              <StatRow
                label="Dominant vegetation"
                value={regionStats?.dominantVegetation ? `${regionStats.dominantVegetation.label} (~${regionStats.dominantVegetation.pct}%)` : null}
                loading={regionStatsLoading}
              />
              <StatRow
                label="Water bodies found"
                value={waterBodiesCount != null ? `${waterBodiesCount.toLocaleString()} feature${waterBodiesCount === 1 ? "" : "s"}` : null}
                sub={waterBodiesCount != null ? "via OpenStreetMap (Overpass)" : undefined}
                loading={overlaysLoading}
              />
              <StatRow
                label="Protected areas"
                value={protectedAreasCount != null ? `${protectedAreasCount.toLocaleString()} area${protectedAreasCount === 1 ? "" : "s"}` : null}
                sub={protectedAreaNames ? (protectedAreaNames.length ? protectedAreaNames.join(", ") : "none found in this region") : undefined}
                loading={overlaysLoading}
                last
              />
            </div>

            <div>
              <SectionHeading>Methodology</SectionHeading>
              <p className="text-[9px] mono-text leading-relaxed" style={{ color: PROTO.inkDim }}>
                {regionStats
                  ? `${regionStats.gridSampleCount} sample points clipped to the region boundary (Open-Meteo batch limit: 100/request) — used for mean elevation, vegetation and climate sampling only, not the highest/lowest figures above.`
                  : "Sampling elevation, climate and land cover across the region…"}
              </p>
              <button
                type="button"
                onClick={onOpenMapDetails}
                className="flex items-center gap-1.5 mt-2 mono-text text-[9.5px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-sm"
                style={{ border: `1px solid ${PROTO.border}`, color: PROTO.ink, background: "#fff" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5" />
                  <circle cx="12" cy="8" r="0.5" fill="currentColor" />
                </svg>
                View Map Details
              </button>
            </div>
          </>
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
