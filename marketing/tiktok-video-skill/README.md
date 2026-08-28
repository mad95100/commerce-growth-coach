# TikTok Video Generator Skill

Skill Claude pour générer une vidéo courte verticale (TikTok/Reels/Shorts) à partir
d'un prompt, avec Remotion, voix off locale (kokoro-js) et sous-titres animés
(whisper.cpp + `@remotion/captions`).

👉 Voir `SKILL.md` pour le fonctionnement détaillé de la skill.
👉 Voir `RESEARCH.md` pour le comparatif des dépôts GitHub étudiés.

## Installation (nécessite un accès réseau — non testé dans cet environnement)

```bash
npm install
```

## Générer la vidéo d'exemple

```bash
# 1. Voix off locale (télécharge le modèle Kokoro ~90 Mo au premier lancement)
node scripts/tts.mjs plan/plan.example.json

# 2. Sous-titres locaux (télécharge whisper.cpp + modèle "medium" ~1.5 Go au premier lancement)
node scripts/transcribe.mjs public/audio/voiceover.wav fr

# 3. Aperçu en direct (optionnel)
npm run dev

# 4. Rendu final MP4 1080x1920
npx remotion render src/index.ts TikTokVideo out/video.mp4 --props=plan/plan.example.json

# 5. Vérification automatique (nécessite ffmpeg/ffprobe)
node scripts/verify.mjs out/video.mp4 plan/plan.example.json
```

## Checklist de test — à exécuter dans un environnement avec réseau

Cette skill a été **écrite, relue statiquement (JSON + syntaxe JS + TypeScript hors
résolution de modules) mais pas exécutée de bout en bout**, faute d'accès réseau dans
l'environnement où elle a été générée (impossible de `npm install`, télécharger les
modèles Kokoro/Whisper, ou lancer un rendu Chromium réel). Avant de considérer la skill
comme prête en production, exécute cette checklist :

- [ ] `npm install` se termine sans erreur
- [ ] `node scripts/tts.mjs plan/plan.example.json` produit `public/audio/voiceover.wav`
      d'une durée non nulle
- [ ] `node scripts/transcribe.mjs public/audio/voiceover.wav fr` produit
      `public/captions/captions.json` avec au moins une page de sous-titres
- [ ] `npm run dev` ouvre Remotion Studio et affiche la vidéo sans erreur console
- [ ] `npx remotion render ...` produit un `out/video.mp4` lisible
- [ ] `node scripts/verify.mjs` confirme : 1080×1920, piste audio présente, durée cohérente
- [ ] Vérification visuelle : les sous-titres sont bien synchronisés avec la voix off
- [ ] Vérification visuelle : le texte à l'écran est lisible sur un écran de téléphone

Si une étape échoue, corrige le script concerné avant de publier une vidéo générée
par cette skill — ne jamais considérer une étape comme fonctionnelle sans l'avoir
réellement vue s'exécuter.

## Limites connues (à ce stade, non testées)

- `kokoro-js` en environnement Node pur (pas navigateur) : le champ `device: "cpu"`
  suppose un runtime ONNX Node fonctionnel ; à vérifier sur la machine cible.
- Les voix Kokoro par défaut sont optimisées pour l'anglais ; pour du français de
  qualité, tester `voice: "af_heart"` vs. les autres voix disponibles via
  `tts.list_voices()`, ou basculer vers `@remotion/elevenlabs` (payant) si la qualité
  FR de Kokoro est insuffisante.
- Modèle whisper `medium` = ~1.5 Go de téléchargement et transcription plus lente que
  `small`/`base` ; ajustable dans `scripts/transcribe.mjs` selon les contraintes machine.
