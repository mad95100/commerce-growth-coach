import React from "react";
import { Composition, CalculateMetadataFunction } from "remotion";
import { MainComposition } from "./Composition";
import { VideoPlan, VideoPlanSchema } from "./types";
import examplePlan from "../plan/plan.example.json";

const calculateMetadata: CalculateMetadataFunction<VideoPlan> = ({ props }) => {
  const plan = VideoPlanSchema.parse(props);
  const totalSeconds = plan.scenes.reduce((sum, s) => sum + s.durationInSeconds, 0);

  return {
    props: plan,
    durationInFrames: Math.max(1, Math.round(totalSeconds * plan.meta.fps)),
    fps: plan.meta.fps,
    width: plan.meta.width,
    height: plan.meta.height,
  };
};

export const Root: React.FC = () => {
  return (
    <Composition
      id="TikTokVideo"
      component={MainComposition}
      // Valeurs par défaut, écrasées par calculateMetadata + --props=plan/plan.json
      durationInFrames={30 * 30}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={examplePlan as VideoPlan}
      calculateMetadata={calculateMetadata}
    />
  );
};
