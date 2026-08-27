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


def syllabes(texte: str) -> int:
    """Compte approché des syllabes françaises : suffisant pour une PROPORTION."""
    t = texte.lower()
    groupes = re.findall(r'[aeiouyàâäéèêëîïôöùûüœ]+', t)
    n = len(groupes)
    # « -e » final muet, sauf s'il porte seul la syllabe
    if re.search(r'[^aeiouyàâäéèêëîïôöùûüœ]es?$', t) and n > 1:
        n -= 1
    return max(1, n)


def attribuer(blocs, repliques) -> list[int]:
    """Associe chaque bloc à une réplique.

    Le nombre de blocs ne dit RIEN : une phrase peut porter deux points et se
    couper en deux, deux phrases voisines peuvent se souder. On compare donc la
    position de chaque bloc dans la parole totale à la position attendue de
    chaque réplique, pondérée par ses syllabes.
    """
    poids = [r.get('poids') or syllabes(r['texte']) for r in repliques]
    total, parole = sum(poids), sum(b - a for a, b in blocs)
    bornes, acc = [], 0.0
    for p in poids:
        acc += p / total * parole
        bornes.append(acc)

    attribution, acc = [], 0.0
    for a, b in blocs:
        milieu = acc + (b - a) / 2
        acc += b - a
        attribution.append(next((i for i, x in enumerate(bornes) if milieu <= x),
                                len(repliques) - 1))
    return attribution


def unites(blocs, attribution):
    """Regroupe les blocs consécutifs qui portent la même réplique."""
    groupes = []
    for (a, b), i in zip(blocs, attribution):
        if groupes and groupes[-1][2] == i:
            groupes[-1] = (groupes[-1][0], b, i)
        else:
            groupes.append((a, b, i))
    return groupes


def coller(video: Path, audio: Path, blocs, cibles, dest: Path, marge: float) -> None:
    duree_video = duree(video)
    fils, etiquettes = [f'[0:a]asplit={len(blocs)}' + ''.join(f'[s{i}]' for i in range(len(blocs)))], []
    for i, ((a, b), cible) in enumerate(zip(blocs, cibles)):
        debut = max(0.0, a - marge)
        retard = max(0, round((cible - (a - debut)) * 1000))
        fils.append(f'[s{i}]atrim=start={debut:.3f}:end={b + marge:.3f},asetpts=PTS-STARTPTS,'
                    f'adelay={retard}|{retard}[v{i}]')
        etiquettes.append(f'[v{i}]')
    fils.append(''.join(etiquettes) +
                f'amix=inputs={len(blocs)}:duration=longest:normalize=0,'
                'alimiter=limit=0.95,aresample=48000,'
                f'apad=whole_dur={duree_video:.3f}[voix]')
    subprocess.run(
        [ffmpeg(), '-y', '-i', str(video), '-i', str(audio),
         '-filter_complex', ';'.join(fils).replace('[0:a]', '[1:a]', 1),
         '-map', '0:v', '-map', '[voix]', '-c:v', 'copy',
         '-c:a', 'aac', '-b:a', '192k', '-t', f'{duree_video:.3f}', str(dest)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('audio', help='la prise enregistrée (mp3, wav…)')
    p.add_argument('--video', default=str(ICI / 'sortie' / '0e-premier-client-tiktok.mp4'))
    p.add_argument('--seuil', default='-42dB',
                   help='niveau sous lequel c’est du silence (forme --seuil=-38dB)')
    p.add_argument('--pause', type=float, default=0.10, help='silence minimal, en secondes')
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
    groupes = unites(blocs, attribuer(blocs, repliques))

    print(f'{len(blocs)} blocs de parole · {len(groupes)} unités posées · '
          f'{len(repliques)} répliques')
    portees = []
    for k, (d, f, i) in enumerate(groupes):
        suivante = groupes[k + 1][2] if k + 1 < len(groupes) else len(repliques)
        textes = ' + '.join(r['texte'] for r in repliques[i:suivante])
        portees.append(suivante - i)
        fin_posee = repliques[i]['debut'] + (f - d)
        butoir = groupes[k + 1] and repliques[groupes[k + 1][2]]['debut'] if k + 1 < len(groupes) else 30.0
        choc = '  ← CHEVAUCHE LA SUIVANTE' if fin_posee > butoir + 0.01 else ''
        print(f"  {d:6.2f}→{f:6.2f} ({f - d:4.2f} s) → posée à {repliques[i]['debut']:5.2f} s"
              f"{choc}\n      « {textes[:78]} »")

    if max(portees) > 1:
        print('\nCertaines unités portent plusieurs répliques : le silence entre elles\n'
              'était trop court pour être détecté. Elles restent solidaires, donc la\n'
              'seconde arrive plus tôt que prévu. --pause 0.10 tente un découpage plus fin.')

    poses, precedente = [], 0.0
    for d, f, i in groupes:
        depart = max(repliques[i]['debut'], precedente)
        poses.append(depart)
        precedente = depart + (f - d) + 0.12
    decales = [(k, p - repliques[i]['debut'])
               for k, (p, (_, _, i)) in enumerate(zip(poses, groupes))
               if p - repliques[i]['debut'] > 0.01]
    if decales:
        print('\nDécalées pour ne pas se recouvrir : ' +
              ', '.join(f'unité {k + 1} (+{e:.2f} s)' for k, e in decales))
    if precedente > 30:
        print(f'ATTENTION : la voix déborde de {precedente - 30:.2f} s. '
              'Raccourcissez le script ou accélérez la prise.')

    dest = video.with_name(video.stem + '-voix.mp4')
    coller(video, audio, [(d, f) for d, f, _ in groupes], poses, dest, a.marge)
    print(f'\nVidéo sonorisée : {dest}')


if __name__ == '__main__':
    main()
