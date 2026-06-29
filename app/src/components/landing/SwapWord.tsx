"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

interface SwapWordProps {
  words: string[];
  holdMs?: number;
  className?: string;
}

export default function SwapWord({ words, holdMs = 2600, className }: SwapWordProps) {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Flip the current word's letters out, then advance to the next word.
  useEffect(() => {
    const letters = containerRef.current?.querySelectorAll<HTMLSpanElement>("[data-letter]");
    if (!letters || letters.length === 0) return;

    const holdTimer = window.setTimeout(() => {
      gsap.to(letters, {
        rotationX: -100,
        opacity: 0,
        duration: 0.35,
        ease: "power2.in",
        stagger: 0.03,
        onComplete: () => setIndex((prev) => (prev + 1) % words.length),
      });
    }, holdMs);

    return () => window.clearTimeout(holdTimer);
  }, [index, holdMs, words.length]);

  // Flip the new word's letters in.
  useEffect(() => {
    const letters = containerRef.current?.querySelectorAll<HTMLSpanElement>("[data-letter]");
    if (!letters || letters.length === 0) return;

    gsap.fromTo(
      letters,
      { rotationX: 100, opacity: 0 },
      { rotationX: 0, opacity: 1, duration: 0.4, ease: "power2.out", stagger: 0.03 }
    );
  }, [index]);

  return (
    <span ref={containerRef} className={`inline-block ${className ?? ""}`}>
      {words[index].split("").map((char, i) => (
        <span key={`${index}-${i}`} className="inline-block" style={{ perspective: 300 }}>
          <span
            data-letter
            className="inline-block"
            style={{ transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
          >
            {char}
          </span>
        </span>
      ))}
    </span>
  );
}
