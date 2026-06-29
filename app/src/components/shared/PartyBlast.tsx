"use client";

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";

/**
 * Confetti "party blast" for success dialogs (password reset link sent, new
 * password set) — fires once on mount via canvas-confetti, the standard
 * library for this rather than a hand-rolled animation. The canvas sits
 * absolutely behind the dialog's content (z-index 0 vs. content's z-index
 * 10) so the blast reads as happening behind the box, not on top of it.
 */
export function PartyBlast() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const fire = confetti.create(canvas, { resize: true, useWorker: true });
    fire({
      particleCount: 140,
      spread: 100,
      startVelocity: 45,
      gravity: 0.9,
      origin: { y: 0.55 },
      colors: ["#c63939", "#f59e0b", "#22c55e", "#0ea5e9", "#a855f7", "#ec4899"],
    });
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-0 pointer-events-none"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
