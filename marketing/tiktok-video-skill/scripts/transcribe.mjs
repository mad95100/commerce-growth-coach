#!/usr/bin/env node
// Transcrit public/audio/voiceover.wav en sous-titres mot-par-mot style TikTok,
// via whisper.cpp exécuté en local (aucune donnée envoyée à un tiers).
// Basé sur le pattern officiel remotion-dev/template-tiktok (sub.mjs).
//
// Usage: node scripts/transcribe.mjs [public/audio/voiceover.wav] [langue]

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  installWhisperCpp,
  downloadWhisperModel,
  transcribe,
} from "@remotion/install-whisper-cpp";
import { toCaptions, createTikTokStyleCaptions } from "@remotion/captions";

const WHISPER_PATH = path.join(process.cwd(), "whisper.cpp");
const WHISPER_VERSION = "1.5.5";

const inputPath = process.argv[2] ?? "public/audio/voiceover.wav";
// "medium" pour le multilingue, "medium.en" si le contenu est garanti 100% anglais.
const language = process.argv[3] ?? "fr";
const model = language === "en" ? "medium.en" : "medium";

const outDir = "public/captions";
const outFile = path.join(outDir, "captions.json");

async function main() {
  console.log("Installation de whisper.cpp (une seule fois, ~réseau nécessaire au premier lancement)...");
  await installWhisperCpp({ to: WHISPER_PATH, version: WHISPER_VERSION });
  await downloadWhisperModel({ model, folder: WHISPER_PATH });

  console.log(`Transcription de ${inputPath} (modèle: ${model})...`);
  const whisperCppOutput = await transcribe({
    inputPath,
    model,
    tokenLevelTimestamps: true,
    whisperPath: WHISPER_PATH,
    whisperCppVersion: WHISPER_VERSION,
    translateToEnglish: false,
    language,
    splitOnWord: true,
  });

  const { captions } = toCaptions({ whisperCppOutput });

  const { pages } = createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: 1200,
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify({ pages }, null, 2));

  console.log(`OK -> ${outFile} (${pages.length} pages de sous-titres)`);
}

main().catch((err) => {
  console.error("Échec de la transcription:", err);
  process.exit(1);
});
