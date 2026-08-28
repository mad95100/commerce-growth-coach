---
name: tiktok-video-generator
description: >
  Génère automatiquement une vidéo courte verticale (TikTok/Reels/Shorts) à partir
  d'un simple prompt texte : script, voix off locale, sous-titres animés style TikTok,
  scènes Remotion, rendu MP4 9:16. À utiliser dès que l'utilisateur demande une vidéo
  TikTok/Reels/Short, une "vidéo courte", un "faceless video", ou mentionne un sujet
  à transformer en vidéo verticale avec voix off et sous-titres.
---

# TikTok Video Generator — Skill Remotion

## 1. Quand utiliser cette skill

Déclenche cette skill quand l'utilisateur demande :
- "crée une vidéo TikTok / Reels / Short sur ..."
- "fais-moi une vidéo verticale expliquant ..."
- "génère une vidéo avec voix off et sous-titres sur ..."
- une modification d'une vidéo déjà générée par cette skill (nouveau script, nouveau style de sous-titres, nouvelle durée, etc.)
- la génération de plusieurs vidéos en batch à partir d'une liste de sujets

Ne pas utiliser cette skill pour du montage vidéo classique sur un fichier fourni par
l'utilisateur (utilise ffmpeg / le skill vidéo générique dans ce cas), ni pour des
vidéos longues format paysage (>3 min, 16:9).

## 2. Stack retenue (voir RESEARCH.md pour le détail des comparatifs)

| Rôle | Outil | Pourquoi |
|---|---|---|
| Moteur de composition/rendu | **Remotion** (`remotion`, `@remotion/cli`) | Standard demandé, React + timing frame-accurate, export MP4 natif |
| Architecture de référence | `remotion-dev/template-prompt-to-video`, `remotion-dev/template-tiktok` | Dépôts **officiels** Remotion, maintenus, licence Remotion (gratuite hors grandes entreprises), patterns testés en prod |
| Sous-titres | `@remotion/captions` + `@remotion/install-whisper-cpp` | Package officiel Remotion, transcription **locale** (whisper.cpp), timing mot-par-mot, fonction native `createTikTokStyleCaptions()` |
| Voix off (par défaut) | **kokoro-js** (npm) sur modèle `onnx-community/Kokoro-82M-v1.0-ONNX` | 100% local, licence **Apache-2.0** (usage commercial libre), pas de clé API, TypeScript natif, qualité proche de solutions payantes |
| Voix off (optionnel, meilleure qualité) | `@remotion/elevenlabs` | Officiel Remotion, cloud, nécessite `ELEVENLABS_API_KEY`, à activer uniquement si l'utilisateur fournit sa clé |
| Assets images/vidéo | Fournis par l'utilisateur dans `assets/`, ou générés via une skill/connecteur d'image déjà disponible dans la conversation | Jamais de téléchargement automatique de contenu protégé non vérifié |

Aucun outil n'a été ajouté "parce qu'il est populaire" : chaque dépendance ci-dessus
comble un rôle précis du pipeline demandé et rien de plus.

## 3. Pipeline complet

```
PROMPT UTILISATEUR
  │
  ▼
1. ANALYSE DU PROMPT (Claude, dans ce tour de conversation)
   → sujet, durée cible, ton, langue, présence/absence d'assets fournis
  │
  ▼
2. GÉNÉRATION DU PLAN DE PRODUCTION (Claude écrit plan/plan.json)
   → hook, script complet, découpage en scènes, texte à l'écran, CTA
  │
  ▼
3. VOIX OFF — scripts/tts.mjs
   → plan.json (voiceover.fullText) → public/audio/voiceover.wav
  │
  ▼
4. SOUS-TITRES — scripts/transcribe.mjs
   → voiceover.wav → whisper.cpp (local) → public/captions/captions.json
     (timing mot-par-mot, style TikTok via createTikTokStyleCaptions)
  │
  ▼
5. ASSETS — assets/images/*, assets/video/* (fournis) ou placeholders neutres
  │
  ▼
6. COMPOSITION REMOTION — src/Composition.tsx assemble scenes + audio + captions
  │
  ▼
7. RENDU — npx remotion render → out/video.mp4 (1080×1920, H.264)
  │
  ▼
8. VÉRIFICATION — durée, résolution, présence audio, sync sous-titres
```

## 4. Étape par étape (ce que Claude doit faire concrètement)

### 4.1 Recevoir et analyser le prompt utilisateur
Extraire : sujet, durée souhaitée (défaut 30s si non précisé), ton (dynamique/pro/humoristique...),
langue (défaut = langue du prompt), présence d'un CTA spécifique.
Si une info est manquante, choisir une valeur neutre raisonnable et le dire à l'utilisateur
plutôt que d'inventer un fait présenté comme réel (ex : jamais de fausses statistiques).

### 4.2 Générer le storyboard (`plan/plan.json`)
Claude rédige lui-même le JSON (pas d'appel API externe nécessaire — c'est Claude qui
joue le rôle de "l'IA" de planification demandée dans le cahier des charges).
Respecter le schéma décrit dans `src/types.ts`. Règles de qualité TikTok :
- Hook fort dans les 3 premières secondes (question, chiffre choc réel ou promesse claire — jamais inventé).
- 1 idée par scène, changement visuel toutes les 2-4 secondes.
- Texte à l'écran court (≤ 8 mots par scène), lisible en un coup d'œil mobile.
- CTA naturel en fin de vidéo.
- Durée totale des scènes = durée cible × fps (30 fps par défaut).

### 4.3 Générer la voix off
```bash
node scripts/tts.mjs plan/plan.json
```
Utilise kokoro-js en local (voir §5). Produit `public/audio/voiceover.wav` +
`public/audio/voiceover.duration.json` (durée réelle mesurée, utilisée pour caler
les scènes si le script est plus long/court que prévu).

### 4.4 Générer les sous-titres
```bash
node scripts/transcribe.mjs public/audio/voiceover.wav
```
Télécharge whisper.cpp + un modèle local (une seule fois), transcrit le wav,
convertit en captions Remotion, puis en style TikTok (mots groupés, surbrillance).
Sortie : `public/captions/captions.json`.

### 4.5 Placer les assets
- Si l'utilisateur a fourni des images/vidéos : les copier dans `assets/images/` ou `assets/video/`
  et les référencer dans `plan.json` (`scene.background.source`).
- Sinon : utiliser un fond de couleur/dégradé animé (`background.type: "solid"` ou `"gradient"`)
  généré directement en React/CSS dans Remotion — zéro dépendance, zéro problème de droits.
- Ne jamais scraper automatiquement des images depuis le web sans vérification de licence.

### 4.6 Rendu
```bash
npm install
npx remotion render src/index.ts TikTokVideo out/video.mp4 --props=plan/plan.json
```
Résolution et fps sont définis dans `plan.json` → `meta` (défaut 1080×1920 @ 30fps).

### 4.7 Vérification (obligatoire avant de dire à l'utilisateur que c'est prêt)
```bash
node scripts/verify.mjs out/video.mp4 plan/plan.json
```
Vérifie : le fichier existe et n'est pas vide, résolution = 1080×1920, durée ≈ durée
attendue (±1s), présence d'une piste audio. Si `ffprobe` n'est pas disponible dans
l'environnement d'exécution, le dire explicitement à l'utilisateur plutôt que
prétendre que la vérification a été faite.

### 4.8 Modifier une vidéo existante
Éditer `plan/plan.json` (texte, durée, scène) et/ou relancer uniquement l'étape
concernée (pas besoin de refaire TTS si seul le style visuel change). Puis relancer
uniquement `npx remotion render`.

### 4.9 Génération en batch
Boucler sur une liste de plans (`plan/plan-1.json`, `plan/plan-2.json`, ...) et
répéter 4.3 → 4.7 pour chacun, avec un nom de sortie distinct dans `out/`.

## 5. Voix off avec kokoro-js — détails

```js
import { KokoroTTS } from "kokoro-js";

const tts = await KokoroTTS.from_pretrained(
  "onnx-community/Kokoro-82M-v1.0-ONNX",
  { dtype: "q8", device: "cpu" } // 100% local, CPU suffit
);

const audio = await tts.generate(script, { voice: "af_heart", speed: 1.0 });
audio.save("public/audio/voiceover.wav");
```
Voix disponibles : `tts.list_voices()` (voix EN par défaut ; pour d'autres langues,
utiliser un modèle Kokoro multilingue ou, si l'utilisateur a une clé, `@remotion/elevenlabs`
qui supporte nativement le multilingue et le clonage de voix).

## 6. Sous-titres style TikTok — détails

Basé sur le pattern officiel `remotion-dev/template-tiktok` :
```js
import { installWhisperCpp, downloadWhisperModel, transcribe } from "@remotion/install-whisper-cpp";
import { toCaptions, createTikTokStyleCaptions } from "@remotion/captions";

const whisperCppOutput = await transcribe({
  inputPath: "public/audio/voiceover.wav",
  model: "medium",          // ou "medium.en" si anglais uniquement
  tokenLevelTimestamps: true,
  splitOnWord: true,
});
const { captions } = toCaptions({ whisperCppOutput });
const { pages } = createTikTokStyleCaptions({
  captions,
  combineTokensWithinMilliseconds: 1200, // regroupe les mots en "pages" affichées ensemble
});
```
Le style visuel (police, couleur de surbrillance, animation bounce/glow) est dans
`src/scenes/Captions.tsx` et peut être modifié librement sans refaire la transcription.

## 7. Gestion des erreurs

- **kokoro-js échoue à charger le modèle (pas de réseau)** : le modèle ONNX (~90 Mo)
  doit être téléchargé une première fois depuis Hugging Face — nécessite une connexion
  internet au premier lancement, puis fonctionne hors-ligne (cache local).
- **whisper.cpp introuvable** : `installWhisperCpp()` le télécharge automatiquement
  (nécessite réseau la première fois, ~cross-platform binaire + modèle ~1.5 Go pour `medium`).
- **Durée du script ≠ durée voulue** : ajuster automatiquement le rythme des scènes sur
  la durée réelle de `voiceover.wav` plutôt que de forcer une durée fixe qui désynchroniserait
  l'audio.
- **Rendu Remotion échoue (Chromium manquant)** : `npx remotion browser ensure`.
- Toujours rapporter précisément à l'utilisateur quelle étape a échoué et pourquoi,
  jamais dire "c'est fait" si une étape n'a pas réellement été exécutée avec succès.

## 8. Fichiers de la skill

```
tiktok-video-skill/
├── SKILL.md                 ← ce fichier
├── RESEARCH.md               ← comparatif des dépôts GitHub étudiés
├── package.json
├── tsconfig.json
├── remotion.config.ts
├── plan/
│   └── plan.example.json     ← exemple de plan de production
├── src/
│   ├── index.ts               ← registerRoot
│   ├── Root.tsx                ← déclare la composition TikTokVideo
│   ├── Composition.tsx          ← assemble scènes + audio + captions
│   ├── types.ts                  ← schéma Zod du plan.json
│   └── scenes/
│       ├── SceneView.tsx          ← rend hook/point/cta (scene.type) dans un seul composant
│       ├── Background.tsx         ← fond (solid/gradient/image/vidéo) + animation de plan
│       ├── Captions.tsx           ← sous-titres style TikTok
│       └── ProgressBar.tsx
├── scripts/
│   ├── tts.mjs                 ← génération voix off (kokoro-js)
│   ├── transcribe.mjs           ← sous-titres (whisper.cpp)
│   └── verify.mjs                ← vérification du MP4 final
├── assets/
│   ├── images/                 (vide, à remplir par l'utilisateur)
│   └── music/                  (vide, optionnel)
└── public/                    (générés : audio/, captions/)
```


## 9. État vérifié dans cet environnement (28/08/2026)

Installée et testée réellement ici, avec ces résultats :

- **npm install** : OK. `zod` a été fixé à `4.4.3` (version exacte attendue par
  Remotion 4.0.508 ; `^3.23.8` déclenchait un avertissement de version au
  lancement — sans casser le rendu observé, mais gardez la version exacte).
- **Rendu Remotion** : OK, mais nécessite deux corrections absentes du plan
  d'origine dans un environnement sans sortie réseau vers `remotion.media`
  (source du Chrome Headless Shell que Remotion télécharge par défaut) :
  1. Pointer `REMOTION_BROWSER_EXECUTABLE` vers un Chromium déjà présent sur la
     machine (`remotion.config.ts` le lit désormais si la variable est posée —
     comportement par défaut inchangé sinon).
  2. `Config.setChromeMode("chrome-for-testing")` dans ce cas : le mode par
     défaut `headless-shell` envoie `--headless=old`, un indicateur supprimé
     des Chromium récents (141+), ce qui fait échouer le lancement du
     navigateur avec « Old Headless mode has been removed ».
- **Kokoro (voix off)** : **bloqué**. `KokoroTTS.from_pretrained` télécharge le
  modèle ONNX depuis `huggingface.co`, refusé par la politique réseau (403
  explicite : « Host not in allowlist »). Aucune voix n'a pu être générée
  dans cet environnement — c'est une contrainte réseau, pas un défaut du code.
- **whisper.cpp (sous-titres)** : **bloqué** pour la même raison — le binaire
  se compile (le dépôt GitHub est joignable, `gcc`/`make`/`cmake` sont
  présents), mais `downloadWhisperModel()` télécharge les poids
  (`ggml-medium.bin`, ~1,5 Go) depuis `huggingface.co/ggerganov/whisper.cpp`,
  également refusé.
- **scripts/verify.mjs** : corrigé — se rabat sur `ffmpeg -i` quand `ffprobe`
  n'est pas sur le PATH (cas de `imageio-ffmpeg`, qui n'installe que `ffmpeg`).
- Un rendu réel de 26 s, 1080×1920, avec piste audio (silencieuse — voix
  bloquée) a été produit et vérifié par ce script. Voir `out/video.mp4`
  après exécution de `plan/plan.test.json`.

Dans un environnement dont la sortie réseau atteint `huggingface.co` et
`remotion.media`, aucune de ces deux dernières corrections n'est nécessaire :
laissez `REMOTION_BROWSER_EXECUTABLE` non définie et Remotion gère son propre
navigateur comme prévu.
