import { Config } from "@remotion/cli/config";

// Format vertical TikTok/Reels/Shorts par défaut.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");

/**
 * Échappatoire pour un environnement dont la sortie réseau n'atteint pas
 * remotion.media (source du Chrome Headless Shell que Remotion télécharge par
 * défaut). Sans ces deux variables, le comportement standard de Remotion est
 * inchangé : il télécharge et gère son propre navigateur.
 *
 * REMOTION_BROWSER_EXECUTABLE : chemin vers un Chromium déjà installé.
 * Le mode « headless-shell » par défaut de Remotion envoie `--headless=old`,
 * un indicateur supprimé des builds Chromium récents (141+) ; un exécutable
 * externe doit donc aussi passer en mode `chrome-for-testing`, qui envoie
 * `--headless=new`.
 */
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
  Config.setChromeMode("chrome-for-testing");
}
