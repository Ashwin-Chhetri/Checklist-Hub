"use client";

import { useState, type ReactNode } from "react";
import FramedScreenshot from "@/components/docs/FramedScreenshot";

interface Screen {
  src: string;
  alt: string;
  aspect: string;
  scale?: number;
  /** Overrides the explorer's default variant for this screen only. */
  variant?: "full" | "dialog" | "flush";
}

interface SubStep {
  title: string;
  body?: ReactNode;
  screen?: Screen;
}

interface Step {
  title: string;
  body: ReactNode;
  screen?: Screen;
  subSteps?: SubStep[];
}

export default function DocsStepExplorer({
  defaultScreen,
  steps,
  variant = "dialog",
}: {
  defaultScreen: Screen;
  steps: Step[];
  /**
   * "dialog" (default) centers each screenshot on a white background — for
   * the checklist wizard's dialog-style steps. "full" fills the whole
   * screen cutout edge to edge — for full-page app screenshots.
   */
  variant?: "full" | "dialog" | "flush";
}) {
  const [screen, setScreen] = useState<Screen>(defaultScreen);
  const [activeKey, setActiveKey] = useState<string | null>("0");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[42fr_58fr] lg:items-stretch gap-6 lg:gap-8 mt-4">
      <div className="w-full max-w-[95%] mx-auto lg:mx-0 lg:sticky lg:top-24 lg:self-start">
        <FramedScreenshot
          key={screen.src}
          src={screen.src}
          alt={screen.alt}
          variant={screen.variant ?? variant}
          aspect={screen.aspect}
          scale={screen.scale}
        />
      </div>
      <ol className="flex flex-col lg:h-full">
        {steps.map((step, i) => {
          const stepKey = `${i}`;
          const isStepActive = activeKey === stepKey;

          return (
            <li
              key={step.title}
              onClick={
                step.screen
                  ? () => {
                      setScreen(step.screen as Screen);
                      setActiveKey(stepKey);
                    }
                  : undefined
              }
              className={`flex gap-4 items-baseline ${i > 0 ? "mt-6" : ""} ${
                step.screen
                  ? `rounded-sm border px-2 py-1.5 cursor-pointer transition-colors ${
                      isStepActive
                        ? "bg-surface-container-low border-primary"
                        : "border-outline-variant hover:bg-surface-container-low"
                    }`
                  : ""
              }`}
            >
              <span
                className={`font-code-md text-code-md font-bold shrink-0 transition-colors ${
                  isStepActive || !step.screen ? "text-primary" : "text-secondary/50"
                }`}
              >
                {i + 1}
              </span>
              <div className="w-full min-w-0">
                <div>
                  <h4
                    className={`font-body-sm text-[15px] font-semibold mb-1.5 ${
                      isStepActive ? "text-primary" : "text-on-surface"
                    }`}
                  >
                    {step.title}
                  </h4>
                  <p className="font-body-sm text-body-sm text-secondary">{step.body}</p>
                </div>

                {step.subSteps && (
                  <ol className="mt-4 space-y-2">
                    {step.subSteps.map((sub, j) => {
                      const key = `${i}-${j}`;
                      const isActive = activeKey === key;
                      return (
                        <li
                          key={sub.title}
                          onClick={
                            sub.screen
                              ? (e) => {
                                  e.stopPropagation();
                                  setScreen(sub.screen as Screen);
                                  setActiveKey(key);
                                }
                              : undefined
                          }
                          className={`rounded-sm border px-2 py-1.5 transition-colors ${
                            sub.screen ? "cursor-pointer" : ""
                          } ${
                            isActive
                              ? "bg-surface-container-low border-primary"
                              : sub.screen
                                ? "border-outline-variant hover:bg-surface-container-low"
                                : "border-outline-variant"
                          }`}
                        >
                          <span className="flex items-baseline gap-2">
                            <span
                              className={`font-code-md text-[12px] font-bold shrink-0 transition-colors ${
                                isActive || !sub.screen ? "text-primary" : "text-secondary/50"
                              }`}
                            >
                              {i + 1}.{j + 1}
                            </span>
                            <span
                              className={`font-body-sm text-[13px] font-semibold ${
                                isActive ? "text-primary" : "text-on-surface"
                              }`}
                            >
                              {sub.title}
                            </span>
                          </span>
                          {sub.body && (
                            <p className="font-body-sm text-[13px] text-secondary mt-1 ml-[26px]">
                              {sub.body}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
