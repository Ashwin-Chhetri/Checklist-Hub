"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { DotLottie, DotLottieReact } from "@lottiefiles/dotlottie-react";

const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 8000;

// Same source and zoom correction as the AppHeader icon — see that file for
// why the zoom/transform-origin values are what they are.
const ICON_ZOOM = 2.7;
const PLAY_SEGMENT: [number, number] = [0, 99];

export default function ChecklistHubIcon({ size = 56 }: { size?: number }) {
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
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <Image
        src="/res/landing/checklist_hub_logo.png"
        alt="Checklist Hub"
        fill
        sizes={`${size}px`}
        className="object-contain scale-130 origin-center"
        style={{ opacity: isIconReady ? 0 : 0.9 }}
      />
      <DotLottieReact
        src="/res/landing/Checklist Hub Icon animation.lottie"
        loop={false}
        autoplay
        segment={PLAY_SEGMENT}
        style={{
          width: "100%",
          height: "100%",
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
  );
}
