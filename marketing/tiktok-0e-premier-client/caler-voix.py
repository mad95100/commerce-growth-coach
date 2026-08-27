#!/usr/bin/env python3
"""Cale une voix-off enregistrée d'une traite sur le montage, puis la colle.

    python3 caler-voix.py voix.mp3

Le fichier est découpé à ses silences : chaque bloc de parole est ensuite posé
à la seconde prévue dans voix-off.json. La parole n'est ni étirée ni repitchée —
seuls les silences entre les phrases changent de longueur. C'est ce qui permet
à une prise unique de suivre des coupes qu'elle n'a pas connues.

Si le nombre de blocs détectés ne correspond pas au nombre de répliques, le
script le DIT et ne devine pas : ajustez --seuil / --pause, ou réenregistrez en
marquant mieux les pauses.
"""
from __future__ import annotations
import argparse, json, re, shutil, subprocess, sys
from pathlib import Path

ICI = Path(__file__).parent


def ffmpeg() -> str:
    if shutil.which('ffmpeg'):
        return 'ffmpeg'
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit('ffmpeg est introuvable. Installez-le, ou : pip install imageio-ffmpeg')


def duree(chemin: Path) -> float:
    err = subprocess.run([ffmpeg(), '-hide_banner', '-i', str(chemin), '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', err)
    if not m:
        sys.exit(f'Durée illisible pour {chemin}')
    h, mn, s = m.groups()
    return int(h) * 3600 + int(mn) * 60 + float(s)


def blocs_de_parole(audio: Path, seuil: str, pause: float) -> list[tuple[float, float]]:
    """Intervalles de parole, déduits des silences détectés par ffmpeg."""
    err = subprocess.run(
        [ffmpeg(), '-hide_banner', '-i', str(audio),
         '-af', f'silencedetect=noise={seuil}:d={pause}', '-f', 'null', '-'],
        capture_output=True, text=True).stderr
    total = duree(audio)
    silences = []
    debut = None
    for m in re.finditer(r'silence_(start|end): ([\d.]+)', err):
        genre, t = m.group(1), float(m.group(2))
        if genre == 'start':
            debut = t
        elif debut is not None:
            silences.append((debut, t)); debut = None
    if debut is not None:
        silences.append((debut, total))

    blocs, curseur = [], 0.0
    for a, b in silences:
        if a - curseur > 0.05:
            blocs.append((curseur, a))
        curseur = b
    if total - curseur > 0.05:
        blocs.append((curseur, total))
    return blocs


def coller(video: Path, audio: Path, blocs, cibles, dest: Path, marge: float) -> None:
    fils, etiquettes = [f'[0:a]asplit={len(blocs)}' + ''.join(f'[s{i}]' for i in range(len(blocs)))], []
    for i, ((a, b), cible) in enumerate(zip(blocs, cibles)):
        debut = max(0.0, a - marge)
        retard = max(0, round((cible - (a - debut)) * 1000))
        fils.append(f'[s{i}]atrim=start={debut:.3f}:end={b + marge:.3f},asetpts=PTS-STARTPTS,'
                    f'adelay={retard}|{retard}[v{i}]')
        etiquettes.append(f'[v{i}]')
    fils.append(''.join(etiquettes) +
                f'amix=inputs={len(blocs)}:duration=longest:normalize=0,'
                'alimiter=limit=0.95,aresample=48000[voix]')
    subprocess.run(
        [ffmpeg(), '-y', '-i', str(video), '-i', str(audio),
         '-filter_complex', ';'.join(fils).replace('[0:a]', '[1:a]', 1),
         '-map', '0:v', '-map', '[voix]', '-c:v', 'copy',
         '-c:a', 'aac', '-b:a', '192k', '-shortest', str(dest)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('audio', help='la prise enregistrée (mp3, wav…)')
    p.add_argument('--video', default=str(ICI / 'sortie' / '0e-premier-client-tiktok.mp4'))
    p.add_argument('--seuil', default='-45dB', help='niveau sous lequel c’est du silence')
    p.add_argument('--pause', type=float, default=0.16, help='silence minimal, en secondes')
    p.add_argument('--marge', type=float, default=0.06, help='garde avant/après chaque bloc')
    p.add_argument('--forcer', action='store_true',
                   help='coller même si le nombre de blocs ne correspond pas')
    a = p.parse_args()

    audio, video = Path(a.audio), Path(a.video)
    for f in (audio, video):
        if not f.exists():
            sys.exit(f'Introuvable : {f}')

    conf = json.loads((ICI / 'voix-off.json').read_text(encoding='utf-8'))
    repliques = conf['repliques']
    blocs = blocs_de_parole(audio, a.seuil, a.pause)

    print(f'{len(blocs)} blocs de parole détectés · {len(repliques)} répliques attendues')
    for i, (d, f) in enumerate(blocs):
        texte = repliques[i]['texte'] if i < len(repliques) else '—'
        cible = repliques[i]['debut'] if i < len(repliques) else None
        creneau = (repliques[i]['fin'] - repliques[i]['debut']) if i < len(repliques) else None
        alerte = '  ← DÉBORDE' if creneau and (f - d) > creneau + 0.25 else ''
        pose = f'{cible:5.2f} s' if cible is not None else '  —  '
        print(f'  {i + 1:2}. {d:6.2f}→{f:6.2f} ({f - d:4.2f} s) → {pose}{alerte}  « {texte[:42]} »')

    if len(blocs) != len(repliques) and not a.forcer:
        sys.exit(
            f'\nLe découpage ne correspond pas ({len(blocs)} ≠ {len(repliques)}).\n'
            'Les phrases seraient posées les unes sur les autres. Essayez un autre\n'
            'découpage (--seuil -40dB, --pause 0.10), ou --forcer pour aligner les\n'
            'premiers blocs seulement.')

    n = min(len(blocs), len(repliques))
    dest = video.with_name(video.stem + '-voix.mp4')
    coller(video, audio, blocs[:n], [r['debut'] for r in repliques[:n]], dest, a.marge)
    print(f'\nVidéo sonorisée : {dest}')


if __name__ == '__main__':
    main()
