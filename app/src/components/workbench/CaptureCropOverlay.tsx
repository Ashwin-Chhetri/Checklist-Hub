"use client";

import { useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { triggerBlobDownload } from "./panels/region-explorer/regionExport";

// Snipping-tool style region picker, ported from the design prototype
// (prototypes/map-view-phase0-darjeeling.html: #crop-overlay + captureSelection()).
// Sits directly over `targetRef`'s own box (position:fixed, coordinates
// copied from its getBoundingClientRect) so drag coordinates land in the
// same space html2canvas's returned canvas starts from — confirming with
// nothing dragged captures the whole target, dragging narrows it to a
// sub-region.

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CaptureCropOverlayProps {
  targetRef: React.RefObject<HTMLElement | null>;
  /** Used to name the downloaded file, e.g. "darjeeling-district". */
  regionSlug: string;
  onClose: () => void;
}

const PROTO = { brand: "#1f6f43", brandHover: "#185835", cancel: "#57564f", cancelHover: "#403f3a" };

// Below this size a "drag" almost certainly started as an accidental click —
// fall back to capturing the whole target instead of a near-invisible sliver.
const MIN_DRAG_PX = 12;

export default function CaptureCropOverlay({ targetRef, regionSlug, onClose }: CaptureCropOverlayProps) {
  const [overlayBox, setOverlayBox] = useState<Rect | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [capturing, setCapturing] = useState(false);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    function measure() {
      const el = targetRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setOverlayBox({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [targetRef]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!overlayBox) return;
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current || !overlayBox) return;
      const curX = Math.max(0, Math.min(e.clientX - overlayBox.left, overlayBox.width));
      const curY = Math.max(0, Math.min(e.clientY - overlayBox.top, overlayBox.height));
      const left = Math.min(dragStartRef.current.x, curX);
      const top = Math.min(dragStartRef.current.y, curY);
      setSelection({ left, top, width: Math.abs(curX - dragStartRef.current.x), height: Math.abs(curY - dragStartRef.current.y) });
    }
    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setSelection((sel) => (sel && sel.width >= MIN_DRAG_PX && sel.height >= MIN_DRAG_PX ? sel : null));
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [overlayBox]);

  function handleMouseDown(e: React.MouseEvent) {
    if (!overlayBox || capturing) return;
    draggingRef.current = true;
    const x = e.clientX - overlayBox.left;
    const y = e.clientY - overlayBox.top;
    dragStartRef.current = { x, y };
    setSelection({ left: x, top: y, width: 0, height: 0 });
    e.preventDefault();
  }

  async function handleConfirm() {
    const target = targetRef.current;
    if (!target || !overlayBox || capturing) return;
    const rect: Rect = selection && selection.width >= MIN_DRAG_PX && selection.height >= MIN_DRAG_PX ? selection : { left: 0, top: 0, width: overlayBox.width, height: overlayBox.height };
    setCapturing(true);
    try {
      const scale = window.devicePixelRatio || 1;
      const canvas = await html2canvas(target, {
        backgroundColor: "#faf9f5",
        useCORS: true,
        scale,
        // html2canvas re-renders a CLONE of the DOM into a hidden iframe —
        // cloning a <canvas> element (cloneNode, which is what the DOM spec
        // gives you) never copies its pixel content, only its attributes.
        // The Map tab's live MapLibre canvas (and any other canvas on the
        // page) would otherwise always come out blank, no matter how the
        // map itself is actually rendering. onclone runs against the real,
        // still-live original DOM before it's discarded, so drawImage can
        // still read each canvas's current bitmap here and stamp it onto
        // its clone — this works for the WebGL map canvas specifically
        // because it's created with preserveDrawingBuffer: true.
        onclone: (clonedDoc) => {
          const originalCanvases = target.querySelectorAll("canvas");
          const clonedCanvases = clonedDoc.querySelectorAll("canvas");
          originalCanvases.forEach((original, i) => {
            const clone = clonedCanvases[i];
            const ctx = clone?.getContext("2d");
            if (!ctx) return;
            try {
              ctx.drawImage(original, 0, 0, clone.width, clone.height);
            } catch (err) {
              console.error("[CaptureCropOverlay] failed to copy canvas content into clone", err);
            }
          });
        },
      });
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = Math.round(rect.width * scale);
      cropCanvas.height = Math.round(rect.height * scale);
      const ctx = cropCanvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.drawImage(
        canvas,
        Math.round(rect.left * scale),
        Math.round(rect.top * scale),
        Math.round(rect.width * scale),
        Math.round(rect.height * scale),
        0,
        0,
        cropCanvas.width,
        cropCanvas.height,
      );
      const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Failed to encode capture as PNG");
      triggerBlobDownload(blob, `${regionSlug}-map-clip.png`);
      onClose();
    } catch (err) {
      console.error("[CaptureCropOverlay] capture failed", err);
      onClose();
    } finally {
      setCapturing(false);
    }
  }

  if (!overlayBox) return null;
  const hasSelection = Boolean(selection && selection.width > 0 && selection.height > 0);

  return (
    <div
      className="fixed z-[70] rounded-md overflow-hidden"
      style={{ left: overlayBox.left, top: overlayBox.top, width: overlayBox.width, height: overlayBox.height }}
      // This overlay is rendered as a sibling inside MapListDialog's
      // backdrop div, which closes the whole dialog on click — without this,
      // any click in here (dragging a selection, hitting confirm/cancel)
      // would bubble up and close the dialog out from under the crop tool.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0" style={{ cursor: "crosshair" }} onMouseDown={handleMouseDown} />
      {!hasSelection && (
        <>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(20,20,18,0.55)" }} />
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 mono-text text-[11px] tracking-wide text-white px-3 py-1.5 rounded-sm whitespace-nowrap pointer-events-none"
            style={{ background: "rgba(0,0,0,0.4)" }}
          >
            Press ✓ to capture the whole view, or drag to select just part of it · Esc to cancel
          </div>
        </>
      )}
      {hasSelection && selection && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: selection.left,
            top: selection.top,
            width: selection.width,
            height: selection.height,
            boxShadow: "0 0 0 9999px rgba(20,20,18,0.55)",
            outline: "2px dashed rgba(255,255,255,0.9)",
            outlineOffset: "-2px",
          }}
        />
      )}
      <div className="absolute z-10 flex gap-2 bottom-5 left-1/2 -translate-x-1/2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={capturing}
          title="Capture"
          className="w-[34px] h-[34px] flex items-center justify-center rounded-full text-white transition-colors"
          style={{ background: PROTO.brand, boxShadow: "0 2px 8px rgba(0,0,0,0.35)", opacity: capturing ? 0.6 : 1, cursor: capturing ? "default" : "pointer" }}
          onMouseEnter={(e) => !capturing && (e.currentTarget.style.background = PROTO.brandHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = PROTO.brand)}
        >
          {capturing ? (
            <span className="block w-3.5 h-3.5 rounded-full animate-spin" style={{ border: "2px solid currentColor", borderTopColor: "transparent" }} />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5l5.5 5.5L20 6.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={capturing}
          title="Close"
          className="w-[34px] h-[34px] flex items-center justify-center rounded-full text-white transition-colors"
          style={{ background: PROTO.cancel, boxShadow: "0 2px 8px rgba(0,0,0,0.35)", opacity: capturing ? 0.6 : 1, cursor: capturing ? "default" : "pointer" }}
          onMouseEnter={(e) => !capturing && (e.currentTarget.style.background = PROTO.cancelHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = PROTO.cancel)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
      </div>
    </div>
  );
}
