/* Capture la scène image par image, puis encode en H.264 vertical 1080×1920.
   Aucune horloge réelle : chaque image est demandée à window.rendre(t). */
import { spawn, execSync } from 'node:child_process';
import { mkdir, rm, readdir, readFile } from 'node:fs/promises';
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
  const mp4Final = path.join(SORTIE, '0e-premier-client-tiktok.mp4');
  /* Réincruster les sous-titres sans refabriquer les 900 images. */
  if (process.env.INCRUSTER_SEUL) { await incruster(mp4Final); return; }

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

  /* Les sous-titres ne sont plus incrustés par défaut : cette version mise sur
     l'image et très peu de texte. SOUS_TITRES=1 produit la variante sous-titrée. */
  if (process.env.SOUS_TITRES) await incruster(mp4);

  console.log('Images conservées dans', IMAGES, `(${(await readdir(IMAGES)).length})`);
}

/* Incrustation des sous-titres.
   Le filtre `subtitles` de ffmpeg fixe PlayResY à 288 pour un SRT : les tailles
   et marges s'y expriment dans une autre échelle que la vidéo, et la police de
   la marque n'y est pas atteignable. Les cartons sont donc composés par le
   navigateur — un PNG transparent par carton, posé sur son créneau. */
async function incruster(mp4) {
  const conf = JSON.parse(await readFile(path.join(ICI, 'voix-off.json'), 'utf-8'));
  const cartons = conf.sous_titres;
  const dossier = path.join(SORTIE, 'cartons');
  await mkdir(dossier, { recursive: true });

  const chromium = await chargerChromium();
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(ICI, 'bande.html'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const pngs = [];
  for (let i = 0; i < cartons.length; i++) {
    const large = await page.evaluate((t) => {
      const el = document.getElementById('texte');
      el.textContent = t;
      return el.getBoundingClientRect().width;
    }, cartons[i].texte);
    if (large > 900) console.warn(`  carton ${i + 1} large de ${Math.round(large)} px — à raccourcir`);
    const png = path.join(dossier, `st${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: png, omitBackground: true });
    pngs.push(png);
  }
  await navigateur.close();

  const entrees = ['-i', mp4];
  for (const p of pngs) entrees.push('-loop', '1', '-t', '30', '-i', p);
  const chaine = cartons.map((c, i) =>
    `[${i === 0 ? '0:v' : `v${i}`}][${i + 1}:v]overlay=0:0:enable='between(t,${c.debut},${c.fin})'` +
    `[v${i + 1}]`).join(';');

  const dest = path.join(SORTIE, '0e-premier-client-tiktok-sous-titres.mp4');
  await encode([
    '-y', ...entrees, '-filter_complex', chaine,
    '-map', `[v${cartons.length}]`,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(FPS), dest,
  ]);
  console.log('Vidéo sous-titrée :', dest, `(${cartons.length} cartons)`);
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
