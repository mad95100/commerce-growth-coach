import { z } from "zod";

/**
 * Schéma du "plan de production" que Claude génère à partir du prompt utilisateur
 * (étape 4.2 de SKILL.md). C'est la source de vérité unique consommée par :
 *   - scripts/tts.mjs        (voiceover.fullText)
 *   - scripts/transcribe.mjs (juste besoin du wav généré, pas du plan)
 *   - src/Composition.tsx    (tout le reste)
 */

export const BackgroundSchema = z.object({
  type: z.enum(["solid", "gradient", "image", "video"]),
  // Pour "solid": couleur hex. Pour "gradient": deux couleurs hex séparées par une virgule.
  // Pour "image"/"video": chemin relatif dans assets/ (copié dans public/ au build).
  source: z.string(),
});

export const SceneSchema = z.object({
  id: z.string(),
  type: z.enum(["hook", "point", "cta"]),
  // Durée en secondes ; convertie en frames avec meta.fps au rendu.
  durationInSeconds: z.number().positive(),
  onScreenText: z.string().max(140),
  background: BackgroundSchema,
  animation: z
    .enum(["zoom-in", "zoom-out", "pan-left", "pan-right", "fade", "none"])
    .default("zoom-in"),
});

export const VoiceoverSchema = z.object({
  fullText: z.string().min(1),
  language: z.string().default("fr"),
  voice: z.string().default("af_heart"),
  speed: z.number().min(0.5).max(2).default(1.0),
});

export const MetaSchema = z.object({
  title: z.string(),
  fps: z.number().int().default(30),
  width: z.number().int().default(1080),
  height: z.number().int().default(1920),
  // Durée cible fournie par l'utilisateur ; la durée réelle du rendu est recalée
  // sur la durée mesurée de voiceover.wav (voir scripts/tts.mjs).
  targetDurationInSeconds: z.number().positive().default(30),
});

export const VideoPlanSchema = z.object({
  meta: MetaSchema,
  voiceover: VoiceoverSchema,
  scenes: z.array(SceneSchema).min(1),
  cta: z.object({ text: z.string() }),
  captionsStyle: z
    .object({
      highlightColor: z.string().default("#FFD700"),
      fontFamily: z.string().default("Inter, system-ui, sans-serif"),
      combineTokensWithinMilliseconds: z.number().int().default(1200),
    })
    .default({
      highlightColor: "#FFD700",
      fontFamily: "Inter, system-ui, sans-serif",
      combineTokensWithinMilliseconds: 1200,
    }),
});

export type VideoPlan = z.infer<typeof VideoPlanSchema>;
export type Scene = z.infer<typeof SceneSchema>;

/**
 * Type des sous-titres générés par scripts/transcribe.mjs, aligné sur le type
 * `Caption` officiel de @remotion/captions (text, startMs, endMs, timestampMs, confidence).
 * On le redéfinit ici uniquement pour ne pas dépendre du package au moment du typage
 * si l'utilisateur n'a pas encore lancé `npm install`.
 */
export type CaptionToken = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};

export type CaptionPage = {
  startMs: number;
  tokens: CaptionToken[];
};
