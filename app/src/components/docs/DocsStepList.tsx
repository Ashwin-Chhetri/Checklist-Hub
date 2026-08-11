"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface Step {
  title: string;
  body: ReactNode;
}

export default function DocsStepList({
  title,
  items,
  interactive = false,
}: {
  title?: string;
  items: Step[];
  /** When true, steps are clickable and highlight on hover/active, like DocsStepExplorer. */
  interactive?: boolean;
}) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const [hasMore, setHasMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      setHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    };

    update();
    el.addEventListener("scroll", update);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);

    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [items]);

  return (
    <div className="relative flex flex-col lg:h-full lg:min-h-0">
      {title && (
        <h4 className="font-code-md text-[13px] tracking-tight text-primary/70 mb-4">
          {title}
        </h4>
      )}
      <ol
        ref={scrollRef}
        className="flex flex-col lg:flex-1 lg:min-h-0 lg:overflow-y-auto no-scrollbar lg:pr-1"
      >
        {items.map((item, i) => {
          const isActive = interactive && activeIndex === i;
          return (
            <li
              key={item.title}
              onClick={interactive ? () => setActiveIndex(i) : undefined}
              className={`flex gap-4 items-baseline ${i > 0 ? "mt-6" : ""} ${
                interactive
                  ? `rounded-sm border px-2 py-1.5 cursor-pointer transition-colors ${
                      isActive
                        ? "bg-surface-container-low border-primary"
                        : "border-outline-variant hover:bg-surface-container-low"
                    }`
                  : i < items.length - 1
                    ? "pb-6 border-b border-outline-variant"
                    : ""
              }`}
            >
              <span
                className={`font-code-md text-code-md font-bold shrink-0 transition-colors ${
                  isActive || !interactive ? "text-primary" : "text-secondary/50"
                }`}
              >
                {i + 1}
              </span>
              <div>
                <h4
                  className={`font-body-sm text-[15px] font-semibold mb-1.5 transition-colors ${
                    isActive ? "text-primary" : "text-on-surface"
                  }`}
                >
                  {item.title}
                </h4>
                <p className="font-body-sm text-body-sm text-secondary">{item.body}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {hasMore && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 hidden lg:flex flex-col items-center gap-1 pt-10 pb-1 bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest/90 to-transparent"
          aria-hidden
        >
          <span className="w-5 h-8 rounded-full border-2 border-secondary/40 flex justify-center pt-1.5">
            <span className="w-[3px] h-[3px] rounded-full bg-secondary/40 animate-bounce" />
          </span>
          <svg
            className="w-3 h-3 text-secondary/40 animate-bounce"
            style={{ animationDelay: "0.15s" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      )}
    </div>
  );
}
