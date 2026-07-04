"use client";

import { Player } from "@remotion/player";
import type { ComponentType } from "react";

export function StepAnimationPlayer({
  component,
  durationInFrames,
  fps,
  size,
  className,
}: {
  component: ComponentType;
  durationInFrames: number;
  fps: number;
  size: number;
  className?: string;
}) {
  return (
    <Player
      component={component}
      durationInFrames={durationInFrames}
      fps={fps}
      compositionWidth={size}
      compositionHeight={size}
      style={{ width: "100%", height: "100%" }}
      className={className}
      loop
      autoPlay
      controls={false}
      showVolumeControls={false}
      clickToPlay={false}
    />
  );
}
