# Recherche & comparatif — génération vidéo courte automatisée

Recherche effectuée le 28/08/2026 via GitHub Search / GitHub Topics / npm / Hugging Face.

## Retenus dans l'architecture finale

### `remotion-dev/template-prompt-to-video`
- Officiel Remotion (org `remotion-dev`), 127 ⭐, 47 forks, actif.
- Pattern retenu : un `timeline.json` généré par une étape "plan" (script + assets +
  timing), consommé ensuite par une composition Remotion générique.
- Licence : celle de Remotion (gratuite, licence "company" payante uniquement pour les
  très grandes structures — cf. `LICENSE.md` du repo `remotion-dev/remotion`).
- Limite : le CLI fourni est câblé en dur sur OpenAI + ElevenLabs (payants). On garde
  le **pattern d'architecture** (timeline déclaratif) mais on remplace la génération de
  script par Claude lui-même et la voix off par kokoro-js (local, gratuit).

### `remotion-dev/template-tiktok`
- Officiel Remotion. Sous-titres style TikTok avec whisper.cpp.
- Utilise les packages officiels `@remotion/install-whisper-cpp` et `@remotion/captions`,
  avec la fonction `createTikTokStyleCaptions()` faite exactement pour ce cas d'usage.
- Transcription 100% locale (aucune clé API, aucun envoi de données à un tiers).
- Retenu tel quel comme moteur de sous-titres (`scripts/transcribe.mjs` en est dérivé).

### `@remotion/captions` / `@remotion/install-whisper-cpp` (packages npm officiels)
- Maintenus par l'équipe Remotion, alignés en version avec `remotion` lui-même.
- Documentation à jour (docs.remotion.dev), pas de dépendance tierce non maintenue.

### `kokoro-js` (npm) + `onnx-community/Kokoro-82M-v1.0-ONNX` (Hugging Face)
- Modèle de base `hexgrad/Kokoro-82M` : ~7 900 ⭐ sur GitHub, licence **Apache-2.0**
  (usage commercial explicitement autorisé), 82M paramètres, tourne sur CPU.
- `kokoro-js` : librairie JS officielle de la communauté ONNX/Transformers.js, permet
  de faire tourner Kokoro **100% en local** en Node comme dans le navigateur.
- Choisi plutôt qu'ElevenLabs (payant, cloud) pour respecter l'exigence "capacité à
  fonctionner localement" — ElevenLabs reste documenté comme option cloud premium
  via le package officiel `@remotion/elevenlabs` si l'utilisateur a une clé API.
- Écarté : `edge-tts` (wrapper non officiel autour d'une API Microsoft non publique,
  zone grise de ToS) — pas assez fiable pour une skill destinée à durer.

## Étudiés mais écartés (ou gardés seulement comme inspiration)

| Dépôt | ⭐ | Raison de l'écart |
|---|---|---|
| `itsjwill/vanta` | récent, ambitieux | Combine ~10 modèles IA lourds (voice cloning, avatars, text-to-video Wan/LTX). Excellent pour l'inspiration d'architecture modulaire, mais bien plus complexe que nécessaire pour "prompt → vidéo TikTok avec voix off + sous-titres", et plusieurs briques (GPT-SoVITS, LTX-Video) nécessitent GPU/installations lourdes incompatibles avec "fonctionne localement facilement". Gardé comme référence de design (schéma pipeline) dans ce document, pas comme dépendance. |
| `ezedinff/TikTok-Forge` | outil récent | Empile Remotion + OpenAI + n8n (orchestrateur workflow externe) : ajoute une dépendance d'infrastructure (n8n) non nécessaire ici puisque Claude joue déjà le rôle d'orchestrateur. |
| `GabrielLaxy/TikTokAIVideoGenerator` | outil Python | Bon pipeline (Llama3 + Together AI + Kokoro + Whisper + MoviePy) mais écosystème **Python**, pas TypeScript/Remotion comme demandé ; MoviePy remplace Remotion alors que Remotion est explicitement requis. |
| Modèles text-to-video (Wan 2.2, LTX, Veo, Seedance...) | — | Hors scope : le besoin est un montage de scènes (texte/image/voix off), pas de la génération vidéo par diffusion — ajouterait coût, latence et incertitude de licence sans bénéfice pour ce cas d'usage. |
| `edge-tts`-based repos | variable | Non officiel, dépend d'une API non documentée par Microsoft, risque de rupture silencieuse. |

## Critères appliqués à chaque candidat
Étoiles/activité récente, date des derniers commits, qualité doc, licence, compatibilité
TS/React/Remotion, facilité d'intégration, dépendances, usage commercial possible,
capacité à fonctionner en local, automatisation possible. Les dépôts abandonnés (pas de
commit depuis longtemps) ou aux licences ambiguës ont été systématiquement écartés.
