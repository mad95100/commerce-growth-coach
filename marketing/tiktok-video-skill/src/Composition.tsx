import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Series,
  continueRender,
  delayRender,
  staticFile,
  useVideoConfig,
} from "remotion";
import { VideoPlan, CaptionPage } from "./types";
import { SceneView } from "./scenes/SceneView";
import { Captions } from "./scenes/Captions";
import { ProgressBar } from "./scenes/ProgressBar";

const useCaptions = () => {
  const [pages, setPages] = useState<CaptionPage[] | null>(null);
  const [handle] = useState(() => delayRender("Loading captions.json"));

  useEffect(() => {
    fetch(staticFile("captions/captions.json"))
      .then((res) => (res.ok ? res.json() : { pages: [] }))
      .then((data) => {
        setPages(data.pages ?? []);
        continueRender(handle);
      })
      .catch(() => {
        // Pas grave si les sous-titres ne sont pas encore générés (étape 4.4 pas
        // encore lancée) : on rend la vidéo sans sous-titres plutôt que d'échouer.
        setPages([]);
        continueRender(handle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return pages;
};

export const MainComposition: React.FC<VideoPlan> = (plan) => {
  const { fps } = useVideoConfig();
  const pages = useCaptions();

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Series>
        {plan.scenes.map((scene) => {
          const durationInFrames = Math.round(scene.durationInSeconds * fps);
          return (
            <Series.Sequence key={scene.id} durationInFrames={durationInFrames}>
              <SceneView scene={scene} durationInFrames={durationInFrames} />
            </Series.Sequence>
          );
        })}
      </Series>

      <ProgressBar />

      {pages && (
        <Captions
          pages={pages}
          highlightColor={plan.captionsStyle.highlightColor}
          fontFamily={plan.captionsStyle.fontFamily}
        />
      )}

      <Audio src={staticFile("audio/voiceover.wav")} />
    </AbsoluteFill>
  );
};
