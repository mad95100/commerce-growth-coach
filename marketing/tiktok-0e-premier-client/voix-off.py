#!/usr/bin/env python3
"""Sous-titres et voix-off française à partir de voix-off.json.

    python3 voix-off.py --srt        écrit sous-titres.srt
    python3 voix-off.py --voix       synthétise la voix et la colle sur la vidéo

La synthèse appelle le service de voix neurale de Microsoft Edge (paquet
`edge-tts`). Elle a besoin d'un accès réseau à speech.platform.bing.com :
lancez-la depuis votre machine, pas depuis un environnement à sortie fermée.
Chaque réplique est synthétisée séparément puis posée à sa seconde exacte,
ce qui garde l'audio calé sur le montage même si une phrase change de durée.
"""
from __future__ import annotations
import argparse, asyncio, json, shutil, subprocess, sys
from pathlib import Path

ICI = Path(__file__).parent
CONF = json.loads((ICI / "voix-off.json").read_text(encoding="utf-8"))
REPLIQUES = CONF["repliques"]


def horodatage(s: float) -> str:
    ms = round(s * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    sec, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"


def ecrire_srt(dest: Path) -> None:
    blocs = [
        f"{i}\n{horodatage(r['debut'])} --> {horodatage(r['fin'])}\n{r['texte']}\n"
        for i, r in enumerate(REPLIQUES, 1)
    ]
    dest.write_text("\n".join(blocs), encoding="utf-8")
    print(f"{dest.name} — {len(REPLIQUES)} répliques")


def ffmpeg() -> str:
    for essai in ("ffmpeg", shutil.which("ffmpeg")):
        if essai and shutil.which(essai):
            return essai
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("ffmpeg est introuvable. Installez-le, ou : pip install imageio-ffmpeg")


def duree(chemin: Path) -> float:
    sortie = subprocess.run(
        [ffmpeg(), "-hide_banner", "-i", str(chemin), "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    derniere = [l for l in sortie.splitlines() if "time=" in l]
    if not derniere:
        return 0.0
    t = derniere[-1].split("time=")[1].split(" ")[0]
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


async def synthetiser(dossier: Path) -> list[Path]:
    try:
        import edge_tts
    except ImportError:
        sys.exit("Voix manquante : pip install edge-tts")
    pistes = []
    for i, r in enumerate(REPLIQUES, 1):
        cible = dossier / f"vo{i:02d}.mp3"
        await edge_tts.Communicate(r["texte"], CONF["voix"], rate=CONF["debit"]).save(str(cible))
        d = duree(cible)
        creneau = r["fin"] - r["debut"]
        alerte = "  ← DÉBORDE" if d > creneau + 0.05 else ""
        print(f"  {i}. {d:5.2f} s (créneau {creneau:.2f} s){alerte}  « {r['texte'][:44]} »")
        pistes.append(cible)
    return pistes


def coller(video: Path, pistes: list[Path], dest: Path) -> None:
    entrees, filtres, etiquettes = ["-i", str(video)], [], []
    for i, (piste, r) in enumerate(zip(pistes, REPLIQUES), start=1):
        entrees += ["-i", str(piste)]
        filtres.append(f"[{i}:a]adelay={round(r['debut'] * 1000)}|{round(r['debut'] * 1000)}[a{i}]")
        etiquettes.append(f"[a{i}]")
    filtres.append(
        "".join(etiquettes)
        + f"amix=inputs={len(pistes)}:duration=longest:normalize=0,"
          "alimiter=limit=0.95,aresample=48000[voix]"
    )
    subprocess.run(
        [ffmpeg(), "-y", *entrees, "-filter_complex", ";".join(filtres),
         "-map", "0:v", "-map", "[voix]", "-c:v", "copy",
         "-c:a", "aac", "-b:a", "192k", "-shortest", str(dest)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"Vidéo sonorisée : {dest}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--srt", action="store_true", help="écrire sous-titres.srt")
    p.add_argument("--voix", action="store_true", help="synthétiser la voix et la coller")
    p.add_argument("--video", default=str(ICI / "sortie" / "0e-premier-client-tiktok.mp4"))
    a = p.parse_args()
    if not (a.srt or a.voix):
        p.error("choisissez --srt et/ou --voix")
    if a.srt:
        ecrire_srt(ICI / "sous-titres.srt")
    if a.voix:
        video = Path(a.video)
        if not video.exists():
            sys.exit(f"Vidéo introuvable : {video}. Lancez d'abord « node rendu.mjs ».")
        dossier = video.parent / "voix"
        dossier.mkdir(parents=True, exist_ok=True)
        print("Synthèse des répliques :")
        pistes = asyncio.run(synthetiser(dossier))
        coller(video, pistes, video.with_name(video.stem + "-voix.mp4"))


if __name__ == "__main__":
    main()
