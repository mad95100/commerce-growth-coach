import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CaptionPage } from "../types";

/**
 * Affiche les sous-titres générés par scripts/transcribe.mjs (format `pages` de
 * createTikTokStyleCaptions, voir @remotion/captions). Chaque page est un groupe de
 * mots affichés ensemble ; le mot actuellement prononcé est mis en surbrillance.
 */
export const Captions: React.FC<{
  pages: CaptionPage[];
  highlightColor: string;
  fontFamily: string;
}> = ({ pages, highlightColor, fontFamily }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeMs = (frame / fps) * 1000;

  const activePage = pages.find((page, i) => {
    const nextStart = pages[i + 1]?.startMs ?? Infinity;
    return timeMs >= page.startMs && timeMs < nextStart;
  });

  if (!activePage) return null;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: "62%",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: "88%",
          textAlign: "center",
          fontFamily,
          fontSize: 54,
          fontWeight: 800,
          lineHeight: 1.25,
        }}
      >
        {activePage.tokens.map((token, i) => {
          const isActive = timeMs >= token.startMs && timeMs < token.endMs;
          return (
            <span
              key={i}
              style={{
                color: isActive ? highlightColor : "white",
                textShadow: "0 3px 10px rgba(0,0,0,0.7)",
                transition: "color 80ms linear",
              }}
            >
              {token.text}{" "}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
