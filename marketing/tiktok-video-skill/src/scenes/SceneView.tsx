import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene } from "../types";
import { Background } from "./Background";

const TEXT_STYLE_BY_TYPE: Record<Scene["type"], React.CSSProperties> = {
  hook: {
    fontSize: 76,
    fontWeight: 800,
    lineHeight: 1.05,
    textAlign: "center",
  },
  point: {
    fontSize: 56,
    fontWeight: 700,
    lineHeight: 1.15,
    textAlign: "center",
  },
  cta: {
    fontSize: 64,
    fontWeight: 800,
    lineHeight: 1.1,
    textAlign: "center",
  },
};

export const SceneView: React.FC<{ scene: Scene; durationInFrames: number }> = ({
  scene,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 120, mass: 0.7 },
    durationInFrames: fps / 2,
  });

  const textStyle = TEXT_STYLE_BY_TYPE[scene.type];

  return (
    <AbsoluteFill>
      <Background scene={scene} durationInFrames={durationInFrames} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: scene.type === "cta" ? "flex-end" : "center",
          padding: "0 64px",
          paddingBottom: scene.type === "cta" ? 420 : 0,
        }}
      >
        <div
          style={{
            ...textStyle,
            fontFamily: "Inter, system-ui, sans-serif",
            color: "white",
            textShadow: "0 4px 24px rgba(0,0,0,0.55)",
            transform: `translateY(${(1 - enter) * 40}px)`,
            opacity: enter,
          }}
        >
          {scene.onScreenText}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
