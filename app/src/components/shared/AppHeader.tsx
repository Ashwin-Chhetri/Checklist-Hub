"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DotLottie, DotLottieReact } from "@lottiefiles/dotlottie-react";

const MIN_DELAY_MS = 7000;
const MAX_DELAY_MS = 13000;

// The Lottie source's canvas is ~2.1x the size of the icon glyph itself
// (extra headroom for the bounce), so we zoom in to match the static PNG
// placeholder's footprint. Only applied to the Lottie below — the PNG
// already fills its own canvas, so zooming it too would overflow the box.
const ICON_ZOOM = 2.7;

// Frames 100+ in the source file are blank (past every layer's out-point),
// so play only the visible range and reset to the resting frame on complete.
const PLAY_SEGMENT: [number, number] = [0, 99];

export default function AppHeader() {
  const dotLottieRef = useRef<DotLottie | null>(null);
  const [isIconReady, setIsIconReady] = useState(false);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleNextPlay = () => {
      const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
      timeoutId = setTimeout(() => {
        dotLottieRef.current?.play();
        scheduleNextPlay();
      }, delay);
    };

    scheduleNextPlay();

    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <Link href="/" className="flex items-center gap-sm hover:opacity-80 transition-opacity">
      <div className="app-header-logo relative">
        <Image
          src="/res/landing/checklist_hub_logo.png"
          alt=""
          fill
          priority
          className="object-contain scale-130 origin-center"
          style={{ opacity: isIconReady ? 0 : 0.9 }}
        />
        <DotLottieReact
          src="/res/landing/Checklist Hub Icon animation.lottie"
          loop={false}
          autoplay={false}
          segment={PLAY_SEGMENT}
          style={{
            width: "100%",
            height: "100%",
            // The glyph sits ~1.7% left of the Lottie canvas's geometric
            // center (measured from the resting frame's pixel bounds) —
            // scaling around the box center would drag it further left as
            // ICON_ZOOM grows, so the origin is pinned to the glyph's own
            // center instead, matching the PNG placeholder's position.
            transformOrigin: "48.3% 50%",
            transform: `translateX(0.3px) translateY(-1px) scale(${ICON_ZOOM})`,
            opacity: isIconReady ? 1 : 0,
          }}
          dotLottieRefCallback={(dotLottie) => {
            dotLottieRef.current = dotLottie;
            dotLottie?.addEventListener("load", () => {
              setIsIconReady(true);
            });
            dotLottie?.addEventListener("complete", () => {
              dotLottie.setFrame(0);
            });
          }}
        />
      </div>
      <span className="app-header-title">
        Checklist Hub
      </span>
    </Link>
  );
}
