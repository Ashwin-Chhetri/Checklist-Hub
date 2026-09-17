"use client";

import type { BaseMapType } from "./mapLayers";
import { PROTECTED_AREA_CLASSES } from "./overpassApi";
import { MAP_THEME } from "./mapTheme";

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
    <label className={`flex items-center gap-2 py-1.5 text-[11px] ${disabled ? "opacity-40" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-brand w-3.5 h-3.5"
      />
      {swatch && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: swatch }} />}
      <span className="text-on-surface-variant flex-1">{label}</span>
      {count != null && <span className="mono-text text-[9px] text-slate-400">{count.toLocaleString()}</span>}
    </label>
  );
}

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
  return (
    <div className="w-[240px] flex-shrink-0 border-l border-surface-dim pl-4 flex flex-col gap-5 overflow-y-auto">
      <div>
        <h4 className="font-label-caps text-[9px] font-bold text-slate-400 tracking-widest uppercase mb-2">Map Type</h4>
        <div className="flex rounded-sm border border-outline overflow-hidden">
          {(["default", "satellite"] as BaseMapType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onBaseMapTypeChange(type)}
              className={`flex-1 mono-text text-[9px] font-bold uppercase tracking-wider px-2 py-1.5 ${
                baseMapType === type ? "bg-brand text-white" : "text-on-surface-variant hover:text-brand"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 py-2 text-[11px] cursor-pointer">
          <input
            type="checkbox"
            checked={terrainEnabled}
            onChange={(e) => onTerrainEnabledChange(e.target.checked)}
            className="accent-brand w-3.5 h-3.5"
          />
          <span className="text-on-surface-variant">3D Terrain</span>
        </label>
      </div>

      <div>
        <h4 className="font-label-caps text-[9px] font-bold text-slate-400 tracking-widest uppercase mb-2">Layers</h4>
        <ToggleRow
          checked={showProtected}
          onChange={onShowProtectedChange}
          label="Protected Areas"
          swatch={PROTECTED_AREA_CLASSES["2"].color}
          count={protectedAreasCount}
          disabled={overlaysLoading}
        />
        <ToggleRow
          checked={showWater}
          onChange={onShowWaterChange}
          label="Water Bodies"
          swatch={MAP_THEME.water}
          count={waterBodiesCount}
          disabled={overlaysLoading}
        />
        <div className="text-[9px] text-slate-400 mt-1 uppercase tracking-widest mono-text">
          {overlaysLoading ? "Fetching from OpenStreetMap…" : "Source: OpenStreetMap (Overpass)"}
        </div>
      </div>

      {(showProtected || showWater) && (
        <div>
          <h4 className="font-label-caps text-[9px] font-bold text-slate-400 tracking-widest uppercase mb-2">Legend</h4>
          <div className="flex flex-col gap-1.5">
            {showProtected &&
              Object.entries(PROTECTED_AREA_CLASSES)
                .filter(([key]) => key !== "other")
                .map(([key, cls]) => (
                  <div key={key} className="flex items-center gap-2 text-[10px] text-on-surface-variant">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cls.color }} />
                    {cls.label}
                  </div>
                ))}
            {showWater && (
              <div className="flex items-center gap-2 text-[10px] text-on-surface-variant">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: MAP_THEME.water }} />
                Rivers, lakes &amp; reservoirs
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
