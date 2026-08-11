"use client";

import { useState } from "react";
import Image from "next/image";

export default function DocsImage({
  src,
  alt,
  aspect = "16 / 10",
}: {
  src: string;
  alt: string;
  aspect?: string;
}) {
  const [open, setOpen] = useState(false);

  const [w, h] = aspect.split("/").map((n) => parseFloat(n.trim()));
  const isPortrait = w && h ? w / h < 1 : false;

  return (
    <>
      <div
        className="border border-outline-variant bg-white p-lg mt-6 cursor-zoom-in"
        onClick={() => setOpen(true)}
        title="Click to enlarge"
      >
        <div className="relative w-full mx-auto" style={{ aspectRatio: aspect, maxWidth: isPortrait ? 420 : undefined }}>
          <Image
            src={src}
            alt={alt}
            fill
            sizes="(min-width: 1024px) 768px, 100vw"
            className="object-contain"
            quality={100}
          />
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-h-[90vh]"
            style={{ maxWidth: "min(90vw, 1400px)", aspectRatio: "16/10" }}
          >
            <Image
              src={src}
              alt={alt}
              fill
              sizes="90vw"
              className="object-contain"
              quality={100}
            />
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
