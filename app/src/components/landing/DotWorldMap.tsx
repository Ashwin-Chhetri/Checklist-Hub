"use client";

import { useEffect, useRef } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import gsap from "gsap";
import type { Topology } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const WORLD_ATLAS_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Based on dot_map_viewer.html's config, spacing widened ~5.4% twice over
// (3 / sqrt(0.9) / sqrt(0.9)) to bring dot count down ~19% total, with a
// larger radius to compensate for the sparser grid.
const DOT_SPACING = 3.33;
const DOT_RADIUS = 1;
const DOT_COLOR = "#991b1b";
const DOT_COLOR_GLOW = "#dc2626";
// Matches the hero section's own background color.
const BACKGROUND_COLOR = "#E8E8E8";

const MOUSE_RADIUS = 70;
const REPEL_STRENGTH = 4;
const RETURN_SPEED = 0.15;
const FRICTION = 0.8;
const IDLE_FRAMES_BEFORE_STOP = 90;
const MAX_DPR = 2;

// One-time intro: dots start above the canvas and ease down into their grid
// position. Stagger is driven by each dot's x position, so the drop sweeps
// left to right overall — with random jitter on top of both the start delay
// and the fall duration so it doesn't read as a single clean wavefront, more
// like dots landing at random places as the sweep passes through. The ease
// itself is GSAP's power2.out curve — fast start, long smooth deceleration.
const FALL_START_OFFSET = 0.18; // fraction of canvas height, above the top
const FALL_DURATION_MS = 1100; // baseline time for a dot to land
const FALL_DURATION_JITTER_MS = 400; // random +/- spread around that baseline (varies fall speed)
const FALL_SWEEP_MS = 1000; // spread of start times from the leftmost to rightmost dot
const FALL_DELAY_JITTER_MS = 280; // random +/- noise on top of the x-based start delay
const fallEase = gsap.parseEase("power2.out");

// This component now renders into its own column (separate from the hero
// text), so the map is just centered within whatever space it's given.
const MAP_CENTER_X_RATIO = 0.5;

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  speed: number;
  thickness: number;
  force: number;
}

let worldGeoPromise: Promise<FeatureCollection> | null = null;

function loadWorldGeo(): Promise<FeatureCollection> {
  if (!worldGeoPromise) {
    worldGeoPromise = fetch(WORLD_ATLAS_URL)
      .then((res) => res.json())
      .then((topo: Topology) => {
        const countries = topo.objects.countries;
        const geo = feature(topo, countries) as FeatureCollection;
        geo.features = geo.features.filter(
          (f: Feature<Geometry>) => f.id !== "010" // Antarctica
        );
        return geo;
      });
  }
  return worldGeoPromise;
}

export default function DotWorldMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let destroyed = false;
    let raf = 0;
    let running = false;
    let idleFrames = 0;

    // Struct-of-arrays particle state — avoids one GC-tracked object per dot
    // (tens of thousands of {x,y,vx,vy,...} objects is the other thing that
    // makes this kind of effect hang) and keeps the hot update loop cache-friendly.
    let baseX = new Float32Array(0);
    let baseY = new Float32Array(0);
    let px = new Float32Array(0);
    let py = new Float32Array(0);
    let pvx = new Float32Array(0);
    let pvy = new Float32Array(0);
    let glow = new Uint8Array(0);
    // Intro fall-in state: 0 = still falling/waiting, 1 = landed and under normal physics.
    let fallSettled = new Uint8Array(0);
    let fallStartY = new Float32Array(0);
    let fallDelayMs = new Float32Array(0);
    let fallDurationMs = new Float32Array(0);
    let fallStartAt = 0;

    const mouse = { x: -1000, y: -1000, active: false };
    const ripples: Ripple[] = [];

    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const wake = () => {
      idleFrames = 0;
      if (!running && !destroyed) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };

    function draw(dpr: number) {
      const n = baseX.length;

      // Paint the known background color directly rather than clearing to
      // transparent — avoids depending on the canvas's compositing/alpha
      // behavior to reveal the page background underneath.
      ctx!.fillStyle = BACKGROUND_COLOR;
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      ctx!.fillStyle = DOT_COLOR;
      ctx!.beginPath();
      for (let i = 0; i < n; i++) {
        if (!glow[i]) {
          const r = DOT_RADIUS * dpr;
          ctx!.rect(px[i] * dpr - r, py[i] * dpr - r, r * 2, r * 2);
        }
      }
      ctx!.fill();

      ctx!.fillStyle = DOT_COLOR_GLOW;
      ctx!.globalAlpha = 0.6;
      ctx!.beginPath();
      for (let i = 0; i < n; i++) {
        if (glow[i]) {
          const r = DOT_RADIUS * 0.5 * dpr;
          ctx!.rect(px[i] * dpr - r, py[i] * dpr - r, r * 2, r * 2);
        }
      }
      ctx!.fill();
      ctx!.globalAlpha = 1;
    }

    function buildDots(geo: FeatureCollection) {
      const width = container!.clientWidth;
      const height = container!.clientHeight;
      if (width <= 0 || height <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);

      const hidden = document.createElement("canvas");
      hidden.width = width;
      hidden.height = height;
      const hiddenCtx = hidden.getContext("2d", { willReadFrequently: true });
      if (!hiddenCtx) return;

      const projection = geoMercator()
        .fitSize([width * 1.05, height * 1.05], geo)
        .translate([width * MAP_CENTER_X_RATIO, height / 1.6]);
      const path = geoPath(projection, hiddenCtx);

      hiddenCtx.fillStyle = "#fff";
      hiddenCtx.beginPath();
      path(geo);
      hiddenCtx.fill();

      const imageData = hiddenCtx.getImageData(0, 0, width, height).data;

      const offsetX = (width % DOT_SPACING) / 2;
      const offsetY = (height % DOT_SPACING) / 2;

      const xs: number[] = [];
      const ys: number[] = [];
      const glows: number[] = [];

      for (let gy = offsetY; gy < height; gy += DOT_SPACING) {
        for (let gx = offsetX; gx < width; gx += DOT_SPACING) {
          const idx = (Math.floor(gy) * width + Math.floor(gx)) * 4;
          if (imageData[idx + 3] > 128) {
            xs.push(gx);
            ys.push(gy);
            glows.push(Math.random() > 0.85 ? 1 : 0);
          }
        }
      }

      const n = xs.length;
      baseX = Float32Array.from(xs);
      baseY = Float32Array.from(ys);
      px = baseX.slice();
      py = new Float32Array(n);
      pvx = new Float32Array(n);
      pvy = new Float32Array(n);
      glow = Uint8Array.from(glows);

      fallSettled = new Uint8Array(n);
      fallStartY = new Float32Array(n);
      fallDelayMs = new Float32Array(n);
      fallDurationMs = new Float32Array(n);
      const dropStartY = -height * FALL_START_OFFSET;
      for (let i = 0; i < n; i++) {
        fallStartY[i] = dropStartY - Math.random() * 40;
        py[i] = fallStartY[i];
        fallDelayMs[i] =
          (xs[i] / width) * FALL_SWEEP_MS + (Math.random() - 0.5) * 2 * FALL_DELAY_JITTER_MS;
        fallDurationMs[i] = Math.max(
          400,
          FALL_DURATION_MS + (Math.random() - 0.5) * 2 * FALL_DURATION_JITTER_MS
        );
      }
      fallStartAt = performance.now();

      draw(dpr);
    }

    function tick() {
      if (destroyed) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const n = baseX.length;
      let anyAwake = false;
      const fallElapsed = performance.now() - fallStartAt;

      for (let i = 0; i < n; i++) {
        if (!fallSettled[i]) {
          const t = (fallElapsed - fallDelayMs[i]) / fallDurationMs[i];
          if (t <= 0) {
            anyAwake = true;
            continue;
          }
          if (t >= 1) {
            py[i] = baseY[i];
            fallSettled[i] = 1;
            anyAwake = true;
            continue;
          }
          py[i] = fallStartY[i] + (baseY[i] - fallStartY[i]) * fallEase(t);
          anyAwake = true;
          continue;
        }

        let awake = false;

        if (mouse.active) {
          const dx = px[i] - mouse.x;
          const dy = py[i] - mouse.y;
          if (Math.abs(dx) < MOUSE_RADIUS && Math.abs(dy) < MOUSE_RADIUS) {
            const distSq = dx * dx + dy * dy;
            if (distSq < MOUSE_RADIUS * MOUSE_RADIUS && distSq > 0) {
              const dist = Math.sqrt(distSq);
              const force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS;
              pvx[i] += (dx / dist) * force * REPEL_STRENGTH;
              pvy[i] += (dy / dist) * force * REPEL_STRENGTH;
              awake = true;
            }
          }
        }

        for (let r = 0; r < ripples.length; r++) {
          const rp = ripples[r];
          const dx = px[i] - rp.x;
          const dy = py[i] - rp.y;
          if (Math.abs(dx) < rp.radius + rp.thickness && Math.abs(dy) < rp.radius + rp.thickness) {
            const distSq = dx * dx + dy * dy;
            const outer = (rp.radius + rp.thickness) * (rp.radius + rp.thickness);
            const innerEdge = Math.max(0, rp.radius - rp.thickness);
            if (distSq < outer && distSq > innerEdge * innerEdge) {
              const dist = Math.sqrt(distSq);
              const distToRing = Math.abs(dist - rp.radius);
              const pushFactor = (rp.thickness - distToRing) / rp.thickness;
              if (dist > 0) {
                pvx[i] += (dx / dist) * pushFactor * rp.force;
                pvy[i] += (dy / dist) * pushFactor * rp.force;
                awake = true;
              }
            }
          }
        }

        if (
          awake ||
          Math.abs(pvx[i]) > 0.01 ||
          Math.abs(pvy[i]) > 0.01 ||
          Math.abs(baseX[i] - px[i]) > 0.01 ||
          Math.abs(baseY[i] - py[i]) > 0.01
        ) {
          pvx[i] *= FRICTION;
          pvy[i] *= FRICTION;
          px[i] += pvx[i];
          py[i] += pvy[i];
          px[i] += (baseX[i] - px[i]) * RETURN_SPEED;
          py[i] += (baseY[i] - py[i]) * RETURN_SPEED;
          anyAwake = true;
        } else {
          px[i] = baseX[i];
          py[i] = baseY[i];
          pvx[i] = 0;
          pvy[i] = 0;
        }
      }

      for (let r = ripples.length - 1; r >= 0; r--) {
        const rp = ripples[r];
        rp.radius += rp.speed;
        rp.force *= 0.99;
        if (rp.radius >= rp.maxRadius || rp.force < 0.1) ripples.splice(r, 1);
        else anyAwake = true;
      }

      draw(dpr);

      if (anyAwake || mouse.active) idleFrames = 0;
      else idleFrames++;

      if (idleFrames > IDLE_FRAMES_BEFORE_STOP) {
        stop();
        return;
      }

      raf = requestAnimationFrame(tick);
    }

    function handleMouseMove(e: MouseEvent) {
      const rect = container!.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
      wake();
    }

    function handleMouseLeave() {
      mouse.active = false;
    }

    function handleClick(e: MouseEvent) {
      const rect = container!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const maxRadius =
        Math.max(
          Math.hypot(cx, cy),
          Math.hypot(rect.width - cx, cy),
          Math.hypot(cx, rect.height - cy),
          Math.hypot(rect.width - cx, rect.height - cy)
        ) + 50;

      const spawn = (force: number, thickness: number) => {
        if (destroyed) return;
        ripples.push({ x: cx, y: cy, radius: 0, maxRadius, speed: 12, thickness, force });
        wake();
      };
      spawn(7, 60);
      window.setTimeout(() => spawn(4.5, 45), 300);
      window.setTimeout(() => spawn(2.5, 30), 600);
    }

    let resizeTimer = 0;
    function handleResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        loadWorldGeo().then((geo) => {
          if (destroyed) return;
          buildDots(geo);
          wake();
        });
      }, 250);
    }

    function handleVisibilityChange() {
      if (document.hidden) stop();
      else wake();
    }

    loadWorldGeo().then((geo) => {
      if (destroyed) return;
      buildDots(geo);
      wake();
    });

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);
    container.addEventListener("click", handleClick);
    window.addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) wake();
        else stop();
      },
      { threshold: 0.01 }
    );
    observer.observe(container);

    return () => {
      destroyed = true;
      stop();
      window.clearTimeout(resizeTimer);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      container.removeEventListener("click", handleClick);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
