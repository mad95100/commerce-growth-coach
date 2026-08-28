import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Scene } from "../types";

const animationScale = (
  frame: number,
  durationInFrames: number,
  animation: Scene["animation"]
) => {
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  switch (animation) {
    case "zoom-in":
      return { transform: `scale(${1 + progress * 0.12})` };
    case "zoom-out":
      return { transform: `scale(${1.12 - progress * 0.12})` };
    case "pan-left":
      return { transform: `scale(1.12) translateX(${-progress * 4}%)` };
    case "pan-right":
      return { transform: `scale(1.12) translateX(${progress * 4}%)` };
    default:
      return {};
  }
};

export const Background: React.FC<{ scene: Scene; durationInFrames: number }> = ({
  scene,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, fps / 3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const style = animationScale(frame, durationInFrames, scene.animation);

  if (scene.background.type === "solid") {
    return (
      <AbsoluteFill style={{ backgroundColor: scene.background.source, opacity: fadeIn }} />
    );
  }

  if (scene.background.type === "gradient") {
    const [from, to] = scene.background.source.split(",").map((c) => c.trim());
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(160deg, ${from}, ${to})`,
          opacity: fadeIn,
        }}
      />
    );
  }

  if (scene.background.type === "image") {
    return (
      <AbsoluteFill style={{ overflow: "hidden", opacity: fadeIn }}>
        <Img
          src={staticFile(scene.background.source)}
          style={{ width: "100%", height: "100%", objectFit: "cover", ...style }}
        />
      </AbsoluteFill>
    );
  }

  // video
  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity: fadeIn }}>
      <OffthreadVideo
        src={staticFile(scene.background.source)}
        style={{ width: "100%", height: "100%", objectFit: "cover", ...style }}
        muted
      />
    </AbsoluteFill>
  );
};
