#!/usr/bin/env node
// Vérifie que le rendu final respecte les exigences du cahier des charges :
// MP4 vertical, durée cohérente avec le plan, présence d'une piste audio.
// Utilise ffprobe s'il est présent (sortie structurée, la plus fiable). À
// défaut, se rabat sur `ffmpeg -i` (fourni par exemple par le paquet Python
// imageio-ffmpeg, qui n'installe pas de binaire ffprobe séparé) et lit les
// mêmes informations dans le texte que ffmpeg écrit sur stderr. Ce n'est
// qu'à défaut des DEUX qu'on renonce à vérifier — jamais par défaut.
//
// Usage: node scripts/verify.mjs out/video.mp4 plan/plan.json

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const videoPath = process.argv[2] ?? "out/video.mp4";
const planPath = process.argv[3] ?? "plan/plan.json";

async function viaFfprobe(path) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,width,height,duration",
    "-show_entries", "format=duration",
    "-of", "json",
    path,
  ]);
  const probe = JSON.parse(stdout);
  const videoStream = probe.streams?.find((s) => s.codec_type === "video");
  const audioStream = probe.streams?.find((s) => s.codec_type === "audio");
  return {
    width: videoStream?.width,
    height: videoStream?.height,
    hasAudio: Boolean(audioStream),
    duration: Number(probe.format?.duration ?? 0),
  };
}

/** Trouve un exécutable ffmpeg : celui du système, sinon celui du paquet
 * Python imageio-ffmpeg (résolu en dehors de tout shell, sans dépendre du
 * PATH courant). */
async function trouverFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return "ffmpeg";
  } catch {}
  try {
    const { stdout } = await execFileAsync("python3", [
      "-c",
      "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())",
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function viaFfmpeg(path) {
  const ffmpeg = await trouverFfmpeg();
  if (!ffmpeg) return null;
  // `ffmpeg -i` termine toujours en erreur sans -f null -, sa sortie est sur stderr.
  const err = await execFileAsync(ffmpeg, ["-hide_banner", "-i", path])
    .then((r) => r.stderr)
    .catch((e) => e.stderr ?? "");
  const dims = err.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const dur = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return {
    width: dims ? Number(dims[1]) : undefined,
    height: dims ? Number(dims[2]) : undefined,
    hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(err),
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
  };
}

async function main() {
  const fileStat = await stat(videoPath).catch(() => null);
  if (!fileStat || fileStat.size === 0) {
    console.error(`❌ ${videoPath} n'existe pas ou est vide. Le rendu a échoué.`);
    process.exit(1);
  }

  const plan = JSON.parse(await readFile(planPath, "utf-8"));
  const expectedWidth = plan.meta.width;
  const expectedHeight = plan.meta.height;
  const expectedDuration = plan.scenes.reduce((s, sc) => s + sc.durationInSeconds, 0);

  let mesure;
  let source = "ffprobe";
  try {
    mesure = await viaFfprobe(videoPath);
  } catch {
    source = "ffmpeg (repli, ffprobe absent)";
    mesure = await viaFfmpeg(videoPath).catch(() => null);
  }

  if (!mesure) {
    console.warn(
      "⚠️  Ni ffprobe ni ffmpeg ne sont disponibles dans cet environnement : impossible " +
        "de vérifier automatiquement résolution/durée/audio. Vérifie manuellement le " +
        `fichier ${videoPath} avant de le considérer comme prêt.`
    );
    console.log(`Fichier présent : oui (${(fileStat.size / 1_000_000).toFixed(1)} Mo)`);
    return;
  }

  console.log(`(mesuré via ${source})`);
  const checks = [
    {
      name: "Résolution verticale attendue",
      ok: mesure.width === expectedWidth && mesure.height === expectedHeight,
      detail: `${mesure.width}x${mesure.height} (attendu ${expectedWidth}x${expectedHeight})`,
    },
    {
      name: "Piste audio présente",
      ok: mesure.hasAudio,
      detail: mesure.hasAudio ? "présente" : "ABSENTE",
    },
    {
      name: "Durée proche du plan (±1.5s)",
      ok: Math.abs(mesure.duration - expectedDuration) <= 1.5,
      detail: `${mesure.duration.toFixed(1)}s (attendu ~${expectedDuration.toFixed(1)}s)`,
    },
  ];

  let allOk = true;
  for (const check of checks) {
    console.log(`${check.ok ? "✅" : "❌"} ${check.name}: ${check.detail}`);
    if (!check.ok) allOk = false;
  }

  if (!allOk) {
    console.error("\nLa vidéo générée ne passe pas toutes les vérifications.");
    process.exit(1);
  }
  console.log("\nToutes les vérifications sont passées.");
}

main().catch((err) => {
  console.error("Erreur pendant la vérification:", err);
  process.exit(1);
});
