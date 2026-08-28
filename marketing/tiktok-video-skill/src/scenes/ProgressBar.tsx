import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = Math.min(1, frame / Math.max(1, durationInFrames - 1));

  return (
    <AbsoluteFill style={{ justifyContent: "flex-start" }}>
      <div style={{ height: 6, width: "100%", background: "rgba(255,255,255,0.25)" }}>
        <div
          style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: "white",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
