"use client";

import { useEffect, useRef } from "react";

const PROTO = { border: "#dcd9d0", panel: "#ffffff", ink: "#1c1c1a", inkDim: "#6b6a63" };

interface MapDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  sampleCount: number | null;
}

/**
 * Methodology note — matches the design prototype's #map-details-dialog in
 * spirit, but generalized: the prototype hardcodes a verified named summit
 * (Sandakphu) and valley (Phansidewa) as Darjeeling District's highest/
 * lowest elevation, which has no equivalent for an arbitrary region. This
 * app instead reports the sampled grid's own min/max, called out here as an
 * approximation rather than a claimed geographic extreme.
 */
export default function MapDetailsDialog({ open, onClose, sampleCount }: MapDetailsDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="w-[90%] max-w-[640px] max-h-[78vh] p-0 m-auto rounded-md"
      style={{ border: `1px solid ${PROTO.border}`, boxShadow: "0 8px 30px rgba(0,0,0,0.22)", background: PROTO.panel, color: PROTO.ink }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${PROTO.border}` }}>
        <h2 className="mono-text text-[11px] font-bold uppercase tracking-wider m-0">Map Details</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="leading-none text-[18px] px-1" style={{ color: PROTO.inkDim }}>
          &times;
        </button>
      </div>
      <div className="overflow-y-auto px-4 py-3.5 text-[10.5px] leading-relaxed" style={{ maxHeight: "calc(78vh - 45px)", color: PROTO.inkDim }}>
        <p>
          <b style={{ color: PROTO.ink }}>Data sources (all keyless/open):</b> boundary &amp; basemap — OpenStreetMap (OpenFreeMap tiles); elevation &amp; temperature — Open-Meteo; water bodies &amp; protected
          areas — OpenStreetMap via Overpass (<code>boundary=protected_area</code>/<code>national_park</code>, <code>leisure=nature_reserve</code>); vegetation / land cover — ESA WorldCover via VITO Terrascope;
          satellite imagery — Esri.
        </p>
        <p className="mt-2.5">
          <b style={{ color: PROTO.ink }}>Elevation:</b> mean, highest and lowest are all derived from the same
          {sampleCount != null ? ` ${sampleCount}-point ` : " "}
          sample grid, clipped to the region&apos;s real boundary shape (not just its bounding box) and capped to Open-Meteo&apos;s 100-points-per-request batch limit. Highest/lowest are the sampled grid&apos;s own
          extremes, not a survey of the region&apos;s true geographic summit or valley — a coarse grid like this can miss a real peak or trench entirely, especially in mountainous terrain.
        </p>
        <p className="mt-2.5">
          <b style={{ color: PROTO.ink }}>Climate:</b> annual mean temperature is sampled once at the region&apos;s centroid across the last full calendar year, not averaged across the whole area.
        </p>
        <p className="mt-2.5">
          <b style={{ color: PROTO.ink }}>Land cover:</b> the dominant class is found by rendering one ESA WorldCover map image over the region&apos;s bounding box and classifying the sample grid&apos;s points by
          nearest palette color — a single-image approximation, not a per-pixel land-cover census.
        </p>
        <p className="mt-2.5">
          <b style={{ color: PROTO.ink }}>Protected areas:</b> boundaries stored as OSM relations (e.g. national parks split across many member ways) are assembled into polygons client-side.
        </p>
        <p className="mt-2.5">
          <b style={{ color: PROTO.ink }}>NDVI:</b> NASA GIBS' 8-day MODIS composite, dated a safety margin behind today to avoid an unpublished compositing period; its tiles top out at zoom 9, so the layer's
          opacity fades out above that zoom instead of showing an oversampled, blurry tile stretched past its real resolution.
        </p>
        <p className="mt-2.5">
          <b style={{ color: PROTO.ink }}>Terrain:</b> the Terrain map type, 3D pitch, and hillshade relief all use real elevation data — AWS's public DEM tiles send no CORS headers, so this app proxies them
          same-origin via <code>/api/regions/terrain-tile</code> rather than fetching them directly in the browser.
        </p>
      </div>
    </dialog>
  );
}
