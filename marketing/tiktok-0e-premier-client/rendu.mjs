/* Capture la scène image par image, puis encode en H.264 vertical 1080×1920.
   Aucune horloge réelle : chaque image est demandée à window.rendre(t). */
import { spawn, execSync } from 'node:child_process';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));

/* Playwright peut être installé localement ou globalement (npm i -g playwright). */
async function chargerChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const racine = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    const url = 'file://' + path.join(racine, 'playwright', 'index.mjs');
    return (await import(url)).chromium;
  }
}
const FPS = Number(process.env.FPS ?? 30);
const SORTIE = process.env.SORTIE ?? path.join(ICI, 'sortie');
const IMAGES = path.join(SORTIE, 'images');
/* ffmpeg : celui du système, sinon celui livré par le paquet python imageio-ffmpeg. */
function trouverFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  try {
    return execSync('python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"',
                    { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('ffmpeg introuvable. Installez-le, ou : pip install imageio-ffmpeg');
  }
}
const FFMPEG = trouverFfmpeg();

/* Sélection d'images ponctuelles : APERCU="0.6,4.9,7.2" node rendu.mjs */
const APERCU = process.env.APERCU
  ? process.env.APERCU.split(',').map(Number).filter((n) => !Number.isNaN(n))
  : null;

async function main() {
  await rm(IMAGES, { recursive: true, force: true });
  await mkdir(IMAGES, { recursive: true });

  const chromium = await chargerChromium();
  const navigateur = await chromium.launch({
    args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'],
  });
  const page = await navigateur.newPage({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => { console.error('ERREUR DE PAGE :', e.message); process.exitCode = 1; });

  await page.goto('file://' + path.join(ICI, 'scene.html'), { waitUntil: 'load' });
  await page.evaluate(() => window.PRET);

  const duree = await page.evaluate(() => window.DUREE);
  const temps = APERCU ?? Array.from({ length: Math.round(duree * FPS) }, (_, i) => i / FPS);

  const debut = Date.now();
  for (let i = 0; i < temps.length; i++) {
    await page.evaluate((t) => window.rendre(t), temps[i]);
    const nom = APERCU
      ? `apercu-${temps[i].toFixed(2)}.png`
      : `i${String(i).padStart(5, '0')}.png`;
    await page.screenshot({ path: path.join(IMAGES, nom), type: 'png' });
    if (!APERCU && i % 60 === 0) {
      const pct = ((i / temps.length) * 100).toFixed(0);
      process.stdout.write(`\r  images ${i}/${temps.length} (${pct} %)`);
    }
  }
  process.stdout.write(`\r  ${temps.length} images en ${((Date.now() - debut) / 1000).toFixed(0)} s\n`);
  await navigateur.close();

  if (APERCU) { console.log('Aperçus dans', IMAGES); return; }

  const mp4 = path.join(SORTIE, '0e-premier-client-tiktok.mp4');
  await encode([
    '-y', '-framerate', String(FPS), '-i', path.join(IMAGES, 'i%05d.png'),
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1',
    '-preset', 'slow', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-r', String(FPS), mp4,
  ]);
  console.log('Vidéo :', mp4);

  const srt = path.join(ICI, 'sous-titres.srt');
  if (existsSync(srt)) {
    const st = path.join(SORTIE, '0e-premier-client-tiktok-sous-titres.mp4');
    await encode([
      '-y', '-i', mp4,
      '-vf', `subtitles=${srt}:original_size=1080x1920:force_style='FontName=DejaVu Sans,Fontsize=46,Bold=1,PrimaryColour=&H00EEF3F4,OutlineColour=&HCC000000,BorderStyle=1,Outline=5,Shadow=0,Alignment=2,MarginV=420,MarginL=110,MarginR=110'`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', st,
    ]);
    console.log('Vidéo sous-titrée :', st);
  }
  console.log('Images conservées dans', IMAGES, `(${(await readdir(IMAGES)).length})`);
}

function encode(args) {
  return new Promise((res, rej) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c + '\n' + err.slice(-2500)))));
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
