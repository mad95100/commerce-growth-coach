#!/usr/bin/env node
// Génère public/audio/voiceover.wav à partir de plan.json (champ voiceover.fullText)
// en utilisant kokoro-js, 100% local (aucune clé API requise).
//
// Usage: node scripts/tts.mjs plan/plan.json

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { KokoroTTS } from "kokoro-js";

const planPath = process.argv[2] ?? "plan/plan.json";
const outDir = "public/audio";
const outFile = path.join(outDir, "voiceover.wav");
const durationFile = path.join(outDir, "voiceover.duration.json");

async function main() {
  const plan = JSON.parse(await readFile(planPath, "utf-8"));
  const { fullText, voice, speed } = plan.voiceover;

  if (!fullText || !fullText.trim()) {
    throw new Error("plan.voiceover.fullText est vide — rien à synthétiser.");
  }

  await mkdir(outDir, { recursive: true });

  console.log("Chargement du modèle Kokoro-82M (local, premier lancement = téléchargement)...");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "cpu",
  });

  console.log(`Génération de la voix off (voix: ${voice}, vitesse: ${speed})...`);
  const audio = await tts.generate(fullText, { voice, speed });
  await audio.save(outFile);

  const durationSeconds = audio.audio.length / audio.sampling_rate;
  await writeFile(
    durationFile,
    JSON.stringify({ durationSeconds, samplingRate: audio.sampling_rate }, null, 2)
  );

  console.log(`OK -> ${outFile} (${durationSeconds.toFixed(2)}s)`);

  const targetSeconds = plan.scenes.reduce((s, sc) => s + sc.durationInSeconds, 0);
  const drift = Math.abs(durationSeconds - targetSeconds);
  if (drift > 1.5) {
    console.warn(
      `⚠️  La voix off dure ${durationSeconds.toFixed(1)}s mais les scènes du plan totalisent ` +
        `${targetSeconds.toFixed(1)}s. Ajuste les "durationInSeconds" des scènes dans ${planPath} ` +
        `pour resynchroniser avant de rendre la vidéo.`
    );
  }
}

main().catch((err) => {
  console.error("Échec de la génération de la voix off:", err);
  process.exit(1);
});
