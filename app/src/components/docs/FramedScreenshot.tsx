"use client";

import { useState } from "react";
import Image from "next/image";

const FRAME_SRC = "/res/docs/placeholder.png";
const FRAME_ASPECT = "2064 / 1811";

// Screen cutout inside placeholder.png, as a percentage of the frame's
// full width/height — measured by scanning the bezel image for where the
// light-gray bezel gives way to the white screen.
const SCREEN = { left: 3.488, top: 4.639, width: 92.83, height: 66.266 };

export default function FramedScreenshot({
  src,
  alt,
  variant = "full",
  aspect = "16 / 10",
  scale = 1,
}: {
  src: string;
  alt: string;
  /**
   * "full" fills the whole screen cutout, cropping to cover — for full-page
   * app screenshots whose aspect ratio is close to the cutout's own.
   * "dialog" centers the screenshot in the screen cutout, inset with padding
   * on a white background — for screenshots of the checklist wizard's
   * dialog steps.
   * "flush" fills the cutout completely on every edge — zero margin, top,
   * bottom, left, or right — cropping evenly off the sides as needed. Use
   * for full-page screenshots that must never show a gap against the
   * mockup's screen edge, even at the cost of a horizontal crop.
   */
  variant?: "full" | "dialog" | "flush";
  /** Intrinsic aspect ratio of `src` itself, e.g. "1398 / 1205". */
  aspect?: string;
  /** Shrinks a "dialog" screenshot within the cutout, e.g. 0.5 for half size. */
  scale?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="relative w-full cursor-zoom-in"
        style={{ aspectRatio: FRAME_ASPECT }}
        onClick={() => setOpen(true)}
      >
        <Image
          src={FRAME_SRC}
          alt=""
          fill
          sizes="(min-width: 1024px) 55vw, 100vw"
          className="object-contain pointer-events-none select-none"
          quality={100}
          priority
          aria-hidden
        />
        <div
          className="absolute overflow-hidden"
          style={{
            left: `${SCREEN.left}%`,
            top: `${SCREEN.top}%`,
            width: `${SCREEN.width}%`,
            height: `${SCREEN.height}%`,
          }}
        >
          {variant === "flush" ? (
            <Image
              src={src}
              alt={alt}
              fill
              sizes="(min-width: 1024px) 55vw, 100vw"
              className="object-cover"
              quality={100}
              priority
            />
          ) : variant === "dialog" ? (
            <div className="relative w-full h-full bg-white flex items-start justify-center p-[4%]">
              <div
                className="relative"
                style={{
                  aspectRatio: aspect,
                  maxWidth: "100%",
                  maxHeight: "100%",
                  width: `${scale * 100}%`,
                  height: `${scale * 100}%`,
                }}
              >
                <Image
                  src={src}
                  alt={alt}
                  fill
                  sizes="(min-width: 1024px) 47vw, 84vw"
                  className="object-contain"
                  quality={100}
                  priority
                />
              </div>
            </div>
          ) : (
            <div className="relative w-full h-full bg-white">
              <Image
                src={src}
                alt={alt}
                fill
                sizes="(min-width: 1024px) 51vw, 92vw"
                className="object-contain object-top"
                quality={100}
                priority
              />
            </div>
          )}
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-h-[90vh]"
            style={{ maxWidth: "min(90vw, 1600px)", aspectRatio: aspect }}
          >
            <Image src={src} alt={alt} fill sizes="90vw" className="object-contain" quality={100} />
          </div>
          <button
            type="button"
            className="absolute top-4 right-4 text-white bg-black/40 hover:bg-black/70 rounded-full w-10 h-10 flex items-center justify-center text-xl font-bold transition-colors"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
