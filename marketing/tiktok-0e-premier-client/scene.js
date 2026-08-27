/* « 0 € → Premier client » — 30 s, 1080×1920.
   Rendu DÉTERMINISTE : aucune horloge réelle, aucun Math.random.
   scene.js construit des PLANS (décor 3D + interfaces) puis les monte.
   rendre(t) place toutes les animations à la seconde demandée. */

const DUREE = 30;
const OUT   = 'cubic-bezier(.16,1,.3,1)';   // arrivée douce
const LENT  = 'cubic-bezier(.4,0,.25,1)';   // mouvement de caméra
const ANIMS = [];
const $ = (s) => document.querySelector(s);

/* Générateur pseudo-aléatoire à graine : deux rendus donnent la même poussière. */
function alea(graine) {
  return () => {
    graine |= 0; graine = (graine + 0x6D2B79F5) | 0;
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function an(el, kf, delai, duree, easing = OUT, opts = {}) {
  const a = el.animate(kf, { delay: delai * 1000, duration: duree * 1000, fill: 'both', easing, ...opts });
  a.pause(); ANIMS.push(a); return a;
}
/* Rappel payé en v1 : dès qu'il y a des `offset`, l'assouplissement de l'EFFET
   déforme la progression avant l'interpolation — il doit rester linéaire.
   Et la dernière étape doit porter offset 1, sinon Chromium interpole vers la
   valeur CSS d'origine et l'élément réapparaît. */
function visible(el, t0, t1) {
  an(el, [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.0001 },
          { opacity: 1, offset: 0.9999 }, { opacity: 0, offset: 1 }], t0, t1 - t0, 'linear');
}
function fondu(el, t0, t1, montee = 0.28, descente = 0.28) {
  const D = t1 - t0;
  /* Sur une fenêtre courte, des fondus pleins se croiseraient : les offsets
     cesseraient d'être croissants et `animate` refuserait l'animation. */
  const m = Math.min(montee, D * 0.4), d = Math.min(descente, D * 0.4);
  an(el, [{ opacity: 0, offset: 0 }, { opacity: 1, offset: m / D },
          { opacity: 1, offset: 1 - d / D }, { opacity: 0, offset: 1 }], t0, D, 'linear');
}
const T = (c = {}) =>
  `translate3d(${c.x ?? 0}px, ${c.y ?? 0}px, ${c.z ?? 0}px) ` +
  `rotateX(${c.rx ?? 0}deg) rotateY(${c.ry ?? 0}deg) rotateZ(${c.rz ?? 0}deg) scale(${c.s ?? 1})`;

/** Mouvement de caméra sur un plan : de `a` vers `b`, sur toute sa durée. */
function camera(el, a, b, t0, t1, easing = LENT) {
  an(el, [{ transform: T(a) }, { transform: T(b) }], t0, t1 - t0, easing);
}
/** Mise au point : le flou se résorbe (ou s'installe). */
function map(el, de, vers, t0, duree) {
  an(el, [{ filter: `blur(${de}px)` }, { filter: `blur(${vers}px)` }], t0, duree, OUT);
}

/* ============================ FABRIQUE ============================ */
const html = (s, ...v) => s.reduce((a, p, i) => a + (v[i - 1] ?? '') + p, '');
function el(classe, dedans = '', style = '') {
  const d = document.createElement('div');
  d.className = classe; d.innerHTML = dedans;
  if (style) d.setAttribute('style', style);
  return d;
}

const PRISES = $('#prises');
/** Crée un plan visible sur [t0,t1[ et renvoie son conteneur. */
function prise(t0, t1) {
  const p = el('prise');
  PRISES.appendChild(p);
  visible(p, t0, t1);
  p.dataset.t0 = t0; p.dataset.t1 = t1;
  return p;
}
/** Ajoute une couche à une profondeur donnée dans un plan. */
function couche(p, z, dedans) {
  const c = el('couche', '', `transform:translateZ(${z}px)`);
  if (dedans) c.appendChild(dedans);
  p.appendChild(c);
  return c;
}

const barres = (n, larges) =>
  larges.slice(0, n).map((w) => `<div class="barre-txt" style="width:${w}"></div>`).join('');

const telephone = (dedans) => el('tel',
  `<div class="tel-ec">${dedans}<div class="encoche"></div><div class="verre"></div></div>`);

const portable = (dedans) => el('mac',
  `<div class="mac-ec"><div class="mac-in">${dedans}</div></div><div class="mac-socle"></div>`);

const fenetre = (url, corps) => html`
  <div class="fen">
    <div class="fen-barre"><i class="pastille"></i><i class="pastille"></i><i class="pastille"></i>
      <div class="url">${url}</div></div>
    <div class="fen-corps">${corps}</div>
  </div>`;

const CURSEUR = `<svg class="curseur" viewBox="0 0 26 34" fill="none">
  <path d="M2 2 L2 27 L9 21 L13.5 31 L18 29 L14 19.5 L23 19 Z" fill="#F2F0EA" stroke="#0A0D12" stroke-width="1.6"/></svg>`;

/* ============================ DÉCOR PERMANENT ============================ */
{
  const r = alea(20260827);
  const p = $('#poussiere');
  for (let i = 0; i < 44; i++) {
    const taille = 1.5 + r() * 3.4;
    const g = el('', '', `left:${(r() * 100).toFixed(2)}%;top:${(r() * 100).toFixed(2)}%;` +
      `width:${taille.toFixed(1)}px;height:${taille.toFixed(1)}px`);
    p.appendChild(g);
    const dx = (r() - 0.5) * 150, dy = -30 - r() * 130;
    const op = 0.06 + r() * 0.20;
    an(g, [
      { transform: 'translate(0,0)', opacity: 0, offset: 0 },
      { transform: `translate(${(dx / 2).toFixed(0)}px,${(dy / 2).toFixed(0)}px)`, opacity: op, offset: 0.5 },
      { transform: `translate(${dx.toFixed(0)}px,${dy.toFixed(0)}px)`, opacity: 0, offset: 1 },
    ], -r() * 14, 14 + r() * 12, 'linear', { iterations: Infinity });
  }
  an($('#grain'), [
    { transform: 'translate(0,0)' }, { transform: 'translate(-26px,17px)' },
    { transform: 'translate(23px,-13px)' }, { transform: 'translate(-8px,-22px)' },
    { transform: 'translate(16px,10px)' }, { transform: 'translate(0,0)' },
  ], 0, 0.2, 'steps(5,end)', { iterations: Infinity });
  an($('#halo'), [
    { transform: 'translate(0,0) scale(1)' }, { transform: 'translate(-120px,70px) scale(1.12)' },
    { transform: 'translate(90px,-50px) scale(1)' },
  ], 0, DUREE, 'linear');
  an($('#balayage'), [{ transform: 'translateX(0) rotate(9deg)' },
                      { transform: 'translateX(300%) rotate(9deg)' }],
     0, 11, 'linear', { iterations: Infinity });
}

/* Texte à l'écran : rare, court, il ne fait que souligner. */
const TEXTES = $('#textes');
function mot(dedans, y, t0, t1, dy = 30) {
  const m = el('mot', dedans, `top:${y}px`);
  TEXTES.appendChild(m);
  fondu(m, t0, t1, 0.34, 0.30);
  an(m, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], t0, 0.85, OUT);
  return m;
}
/* Coupure franche au noir : ponctue un changement d'acte. */
function coupe(t, duree = 0.16) {
  an($('#noir'), [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 1 }],
     t - duree / 2, duree, 'linear');
}

/* ============================================================
   ACTE 1 — L'ACCROCHE (0 → 3 s)
   Une offre qui a tout pour plaire. Et rien ne se passe.
   ============================================================ */
{
  /* PLAN 1 — poussée lente sur un portable : la page d'offre est belle. */
  const p = prise(0, 1.70);
  couche(p, -420, el('nappe'));
  const mac = portable(fenetre('offre.monsite.fr', html`
    <div style="width:74%">
      <div class="offre-titre">Coaching sportif<br>personnalisé</div>
      <div class="offre-sous">Un programme sur mesure pour progresser<br>durablement, à votre rythme.</div>
      <div class="bouton">Réserver un appel</div>
    </div>`));
  const c = couche(p, 0, mac);
  camera(c, { z: -230, y: 40, rx: 7, s: 1 }, { z: 90, y: 10, rx: 3, s: 1 }, 0, 1.70);
  map(mac, 7, 0, 0, 0.9);
  mot('<h1>Une idée <span class="vert">excellente</span>.</h1>', 1268, 0.25, 1.70);
}
{
  /* PLAN 2 — gros plan sur le compteur : zéro. Travelling latéral. */
  const p = prise(1.70, 3.05);
  couche(p, -420, el('nappe'));
  const mac = portable(fenetre('tableau-de-bord', html`
    <div style="display:flex;align-items:center;gap:52px;height:100%;padding:0 18px">
      <div style="flex:0 0 auto"><div class="kpi corail">0</div>
        <div class="kpi-lab">vente ce mois</div></div>
      <svg width="420" height="230" viewBox="0 0 420 230" fill="none" style="flex:1">
        ${[0, 1, 2, 3].map((i) => `<line x1="0" y1="${40 + i * 50}" x2="420" y2="${40 + i * 50}" stroke="#171D28" stroke-width="2"/>`).join('')}
        <path d="M6 188 H414" stroke="#FF7A59" stroke-width="5" stroke-linecap="round"/>
      </svg>
    </div>`));
  const c = couche(p, 0, mac);
  camera(c, { z: 210, x: 130, rx: 2, ry: -6 }, { z: 300, x: -70, rx: 1, ry: 3 }, 1.70, 3.05);
  mot('<h1>Et pourtant…<br><span class="corail">personne ne l’achète.</span></h1>', 1232, 1.86, 3.05);
  coupe(3.05);
}

/* ============================================================
   ACTE 2 — LE PROBLÈME (3 → 8 s)
   On montre le symptôme. On ne donne pas encore la cause.
   ============================================================ */
{
  /* PLAN 3 — messages envoyés, aucun retour. Basculement vertical. */
  const p = prise(3.05, 4.55);
  couche(p, -430, el('nappe'));
  const tel = telephone(html`
    <div class="tel-entete"><i class="pastille-av"></i>
      <div style="display:flex;flex-direction:column;gap:7px;flex:1">
        <div class="barre-txt" style="width:120px"></div>
        <div class="barre-txt" style="width:74px;height:9px"></div></div></div>
    <div class="fil">
      <div class="bulle moi">Bonjour ! Je propose du coaching, ça vous intéresse ?</div>
      <div class="vu">Vu</div>
      <div class="bulle moi">Je peux vous en dire plus si vous voulez</div>
      <div class="vu">Vu</div>
      <div class="bulle moi">Bonne journée !</div>
      <div class="vu">Vu</div>
    </div>`);
  const c = couche(p, 0, tel);
  camera(c, { z: -120, y: 130, rx: 12, ry: -8, s: .96 }, { z: 60, y: -60, rx: 2, ry: -2, s: 1 }, 3.05, 4.55);
  tel.querySelectorAll('.bulle, .vu').forEach((b, i) =>
    an(b, [{ opacity: 0, transform: 'translateY(16px) scale(.97)' },
           { opacity: 1, transform: 'translateY(0) scale(1)' }], 3.20 + i * 0.10, 0.40));
  mot('<h2 class="corail">0 réponse</h2>', 1330, 4.00, 4.55, 18);
}
{
  /* PLAN 4 — on cherche large sur internet, la liste défile sans fin. */
  const p = prise(4.55, 6.05);
  couche(p, -430, el('nappe'));
  const liste = Array.from({ length: 11 }, (_, i) => html`
    <div class="rangee"><i class="av"></i>
      <div class="rangee-txt">
        <div class="barre-txt" style="width:${[62, 48, 71, 55, 66, 44, 74, 51, 60, 47, 68][i]}%"></div>
        <div class="barre-txt" style="width:${[34, 27, 41, 30, 36, 24, 44, 29, 33, 26, 38][i]}%;height:9px"></div>
      </div></div>`).join('');
  const mac = portable(fenetre('rechercher — « trouver des clients »',
    `<div id="defile" style="position:absolute;left:34px;right:34px;top:20px">${liste}</div>`));
  const c = couche(p, 0, mac);
  camera(c, { z: -60, y: 30, rx: 6, ry: 5, s: 1 }, { z: 250, y: -10, rx: 2, ry: -3, s: 1 }, 4.55, 6.05);
  an(mac.querySelector('#defile'), [{ transform: 'translateY(0)' }, { transform: 'translateY(-560px)' }],
     4.62, 1.40, 'linear');
  mot('<h2 class="doux">Chercher partout,<br>toucher personne.</h2>', 1272, 5.05, 6.05, 18);
}
{
  /* PLAN 5 — le curseur survole le bouton… puis s'en va. */
  const p = prise(6.05, 7.40);
  couche(p, -430, el('nappe'));
  const mac = portable(fenetre('offre.monsite.fr', html`
    <div style="width:74%">
      <div class="offre-titre">Coaching sportif<br>personnalisé</div>
      <div class="offre-sous">Un programme sur mesure pour progresser<br>durablement, à votre rythme.</div>
      <div class="bouton" id="btn">Réserver un appel</div>
    </div>${CURSEUR}`));
  const c = couche(p, 0, mac);
  camera(c, { z: 120, x: -40, rx: 3, ry: 4 }, { z: 320, x: 30, rx: 1, ry: -2 }, 6.05, 7.40);
  const cur = mac.querySelector('.curseur');
  an(cur, [
    { left: '150px', top: '470px', opacity: 0, offset: 0 },
    { left: '210px', top: '392px', opacity: 1, offset: 0.22 },
    { left: '236px', top: '374px', opacity: 1, offset: 0.46 },
    { left: '520px', top: '250px', opacity: 1, offset: 0.86 },
    { left: '690px', top: '120px', opacity: 0, offset: 1 },
  ], 6.10, 1.25, 'linear');
  an(mac.querySelector('#btn'), [
    { filter: 'brightness(1)', offset: 0 }, { filter: 'brightness(1.18)', offset: 0.35 },
    { filter: 'brightness(1.18)', offset: 0.5 }, { filter: 'brightness(.55)', offset: 1 },
  ], 6.10, 1.25, 'linear');
}
{
  /* PLAN 6 — respiration. Le vrai sujet arrive. */
  const p = prise(7.40, 8.15);
  const trait = el('couche', '<div style="width:2px;height:300px;background:linear-gradient(180deg,rgba(111,227,160,0),rgba(111,227,160,.85),rgba(111,227,160,0))"></div>',
    'transform:translateZ(60px)');
  p.appendChild(trait);
  an(trait, [{ opacity: 0, transform: 'translateZ(60px) scaleY(.2)' },
             { opacity: 1, transform: 'translateZ(60px) scaleY(1)' }], 7.42, 0.5);
  mot('<h1>Le problème<br>n’est pas ton <span class="vert">idée</span>.</h1>', 1108, 7.48, 8.15, 22);
  coupe(8.15);
}

/* ============================================================
   ACTE 3 — LES TROIS ERREURS (8 → 15 s)
   ============================================================ */
{
  /* PLAN 7 — une audience immense, survolée : rien n'accroche. */
  const p = prise(8.15, 10.35);
  couche(p, -440, el('nappe'));
  const grille = el('', Array.from({ length: 24 }, () => `<div class="perso"><i class="av"></i></div>`).join(''),
    'display:grid;grid-template-columns:repeat(4,150px);gap:22px');
  const c = couche(p, 0, grille);
  camera(c, { z: -520, y: 260, rx: 30, s: 1.15 }, { z: -120, y: -110, rx: 12, s: 1.02 }, 8.15, 10.35);
  grille.querySelectorAll('.perso').forEach((q, i) =>
    an(q, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: .95, transform: 'scale(1)' }],
       8.20 + i * 0.018, 0.4));
  /* tout s'éteint sauf un */
  grille.querySelectorAll('.perso').forEach((q, i) => {
    if (i === 13) {
      an(q, [{ borderColor: '#1D2432', background: '#11161E', transform: 'scale(1)' },
             { borderColor: 'rgba(111,227,160,.75)', background: 'rgba(111,227,160,.12)', transform: 'scale(1.12)' }],
        9.55, 0.55);
    } else {
      an(q, [{ opacity: .95 }, { opacity: .16 }], 9.55, 0.5, 'linear');
    }
  });
  mot('<span class="puce">Erreur n° 1</span><h2>Une cible<br>trop large</h2>', 1186, 8.55, 10.35, 24);
}
{
  /* PLAN 8 — l'offre est là, mais illisible : la promesse ne se voit pas. */
  const p = prise(10.35, 12.55);
  couche(p, -440, el('nappe'));
  const mac = portable(fenetre('offre.monsite.fr', html`
    <div id="flou" style="width:80%">
      <div class="offre-titre">Accompagnement global<br>et solutions adaptées</div>
      <div class="offre-sous" style="margin-top:18px">${barres(3, ['92%', '84%', '61%']).replace(/class="barre-txt"/g, 'class="barre-txt" style="margin-bottom:12px"')}</div>
      <div class="bouton mort">En savoir plus</div>
    </div>`));
  const c = couche(p, 0, mac);
  camera(c, { z: 40, x: 60, rx: 5, ry: -7 }, { z: 260, x: -50, rx: 2, ry: 4 }, 10.35, 12.55);
  map(mac.querySelector('#flou'), 0, 9, 10.95, 0.9);
  mot('<span class="puce">Erreur n° 2</span><h2>Une offre<br>qu’on ne comprend pas</h2>', 1186, 10.80, 12.55, 24);
}
{
  /* PLAN 9 — le même message, collé vingt fois. */
  const p = prise(12.55, 15.05);
  couche(p, -440, el('nappe'));
  const tel = telephone(html`
    <div class="tel-entete"><i class="pastille-av"></i>
      <div style="display:flex;flex-direction:column;gap:7px;flex:1">
        <div class="barre-txt" style="width:132px"></div></div></div>
    <div class="fil" id="pile"></div>`);
  const pile = tel.querySelector('#pile');
  for (let i = 0; i < 6; i++) {
    const b = el('bulle moi', 'Bonjour ! Je propose du coaching, ça vous intéresse ?');
    pile.appendChild(b);
    an(b, [{ opacity: 0, transform: 'translateX(40px)' }, { opacity: 1 - i * 0.09, transform: 'translateX(0)' }],
       12.80 + i * 0.13, 0.34);
  }
  const c = couche(p, 0, tel);
  camera(c, { z: -140, y: -80, rx: -8, ry: 9, s: .97 }, { z: 90, y: 40, rx: 2, ry: -3, s: 1 }, 12.55, 15.05);
  mot('<span class="puce">Erreur n° 3</span><h2>Le même message<br>pour tout le monde</h2>', 1186, 13.00, 15.05, 24);
  coupe(15.05);
}

/* ============================================================
   ACTE 4 — LA MÉTHODE (15 → 23 s)
   Les mêmes écrans, remis dans l'ordre.
   ============================================================ */
{
  /* PLAN 10 — quatre étapes se mettent en place. */
  const p = prise(15.05, 17.05);
  couche(p, -440, el('nappe'));
  const etapes = ['Choisir une personne', 'Vérifier son problème', 'Formuler une offre', 'Aller lui parler'];
  const bloc = el('', etapes.map((e, i) =>
    `<div class="etape"><i class="num">${i + 1}</i>${e}</div>`).join(''),
    'display:flex;flex-direction:column;gap:16px;width:800px');
  const c = couche(p, 0, bloc);
  camera(c, { z: -260, y: 90, rx: 14, ry: -5 }, { z: 60, y: -30, rx: 3, ry: 2 }, 15.05, 17.05);
  bloc.querySelectorAll('.etape').forEach((e, i) => {
    an(e, [{ opacity: 0, transform: 'translateY(34px) scale(.96)' },
           { opacity: 1, transform: 'translateY(0) scale(1)' }], 15.20 + i * 0.16, 0.5);
    an(e, [{ borderColor: '#1F2735', background: '#101620' },
           { borderColor: 'rgba(111,227,160,.5)', background: 'rgba(111,227,160,.07)' }],
       16.05 + i * 0.11, 0.4);
    an(e.querySelector('.num'), [{ background: '#1B2331', color: '#6E7789' },
                                 { background: '#6FE3A0', color: '#06251A' }], 16.05 + i * 0.11, 0.4);
  });
  mot('<h2>Une <span class="vert">méthode</span>,<br>dans cet ordre.</h2>', 1240, 16.15, 17.05, 20);
}
{
  /* PLAN 11 — la page d'offre se remet au net : une promesse, une personne. */
  const p = prise(17.05, 19.05);
  couche(p, -440, el('nappe'));
  const mac = portable(fenetre('offre.monsite.fr', html`
    <div id="net" style="width:78%">
      <div class="offre-titre">Reprendre le sport<br>après 40 ans, sans <span class="vert">te blesser</span></div>
      <div class="offre-sous">8 semaines, 3 séances par semaine,<br>ajustées à ton emploi du temps.</div>
      <div class="bouton">Réserver un appel</div>
    </div>`));
  const c = couche(p, 0, mac);
  camera(c, { z: 30, x: -70, rx: 5, ry: 6 }, { z: 290, x: 20, rx: 1, ry: -2 }, 17.05, 19.05);
  map(mac.querySelector('#net'), 10, 0, 17.20, 0.85);
  mot('<h2>Une promesse <span class="vert">précise</span></h2>', 1268, 18.15, 19.05, 18);
}
{
  /* PLAN 12 — le message change, la réponse arrive. */
  const p = prise(19.05, 21.05);
  couche(p, -440, el('nappe'));
  const tel = telephone(html`
    <div class="tel-entete"><i class="pastille-av"></i>
      <div style="display:flex;flex-direction:column;gap:7px;flex:1">
        <div class="barre-txt" style="width:120px"></div>
        <div class="barre-txt" style="width:74px;height:9px"></div></div></div>
    <div class="fil" id="fil2">
      <div class="bulle moi">Vous avez repris la course en janvier — comment va le genou&nbsp;?</div>
      <div class="bulle eux ok">Franchement pas terrible 😅 vous faites quoi exactement&nbsp;?</div>
      <div class="bulle moi">Je peux vous montrer en 15 min, ça vous va&nbsp;?</div>
      <div class="bulle eux ok">Oui, avec plaisir</div>
    </div>`);
  const c = couche(p, 0, tel);
  camera(c, { z: -100, y: 70, rx: 9, ry: 7, s: .97 }, { z: 110, y: -40, rx: 2, ry: -2, s: 1 }, 19.05, 21.05);
  tel.querySelectorAll('.bulle').forEach((b, i) =>
    an(b, [{ opacity: 0, transform: 'translateY(20px) scale(.96)' },
           { opacity: 1, transform: 'translateY(0) scale(1)' }], 19.25 + i * 0.30, 0.42));
  mot('<h2 class="vert">Une réponse</h2>', 1330, 20.35, 21.05, 16);
}
{
  /* PLAN 13 — recul : l'activité est rangée, une fiche passe en « Client ». */
  const p = prise(21.05, 23.05);
  couche(p, -440, el('nappe'));
  const col = (titre, n, vif) => html`
    <div class="col"><div class="col-titre">${titre}</div>
      ${Array.from({ length: n }, (_, i) =>
        `<div class="fiche ${vif && i === 0 ? 'vif' : ''}"></div>`).join('')}</div>`;
  const mac = portable(fenetre('mon-suivi', html`
    <div style="display:flex;gap:16px;height:100%">
      ${col('Contactés', 4, false)}${col('En discussion', 3, false)}${col('Client', 1, true)}
    </div>`));
  const c = couche(p, 0, mac);
  camera(c, { z: 320, y: -40, rx: 1, ry: -3, s: 1 }, { z: -130, y: 30, rx: 8, ry: 4, s: 1 }, 21.05, 23.05);
  mac.querySelectorAll('.fiche').forEach((f, i) =>
    an(f, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
       21.15 + i * 0.07, 0.36));
  const gagne = mac.querySelector('.fiche.vif');
  an(gagne, [{ transform: 'scale(1)', offset: 0 }, { transform: 'scale(1.06)', offset: 0.5 },
             { transform: 'scale(1)', offset: 1 }], 22.10, 0.55, 'linear');
  mot('<h2>Ton <span class="vert">premier client</span></h2>', 1268, 22.20, 23.05, 18);
  coupe(23.05);
}

/* ============================================================
   ACTE 5 — LE GUIDE (23 → 30 s)
   ============================================================ */
{
  /* PLAN 14 — la couverture arrive dans la lumière, puis recule derrière le titre. */
  const p = prise(23.05, DUREE);
  couche(p, -440, el('nappe'));
  const livre = el('livre', html`
    <div class="livre-eyebrow">Le guide</div>
    <div>
      <div style="font-family:var(--dsp);font-weight:800;font-size:84px;line-height:.96;letter-spacing:-.045em">0 €</div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:10px">
        <svg width="52" height="18" viewBox="0 0 52 18" fill="none">
          <path d="M2 9H44M36 2l8 7-8 7" stroke="#6FE3A0" stroke-width="3.4"
                stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div style="font-family:var(--dsp);font-weight:800;font-size:38px;letter-spacing:-.025em;
                    text-transform:uppercase">Premier client</div>
      </div>
    </div>
    <div style="margin-top:34px;font-size:17px;color:#6C7688;letter-spacing:.02em">
      30 jours · Scripts · Templates · Toolkit</div>`);
  const c = couche(p, 0, livre);
  camera(c, { z: -300, y: 140, rx: 14, ry: -30, s: 1 }, { z: 330, y: -30, rx: 3, ry: -13, s: 1 }, 23.05, 26.20);
  an(livre, [
    { opacity: 0, filter: 'blur(0px)', offset: 0 },
    { opacity: 1, filter: 'blur(0px)', offset: 0.45 / 6.95 },
    { opacity: 1, filter: 'blur(0px)', offset: 3.05 / 6.95 },
    { opacity: 0.16, filter: 'blur(17px)', offset: 3.55 / 6.95 },
    { opacity: 0.16, filter: 'blur(17px)', offset: 1 },
  ], 23.10, 6.90, 'linear');
}
{
  /* PLAN 15 — le titre passe au premier plan, la couverture s'efface derrière. */
  const bloc = el('final', html`
    <div class="prix">0 €</div>
    <div class="vers">
      <svg width="104" height="30" viewBox="0 0 104 30" fill="none" id="fl">
        <path d="M3 15H86" stroke="#6FE3A0" stroke-width="6" stroke-linecap="round"/>
        <path d="M72 3l14 12-14 12" stroke="#6FE3A0" stroke-width="6"
              stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Premier client</span>
    </div>
    <div style="margin-top:52px;font-size:31px;font-weight:600;color:#8E96A4;letter-spacing:.01em">
      30 jours&nbsp;· Scripts&nbsp;· Templates&nbsp;· Toolkit</div>
    <div style="margin-top:74px"><span class="cta">Découvre la méthode.<i class="trait" id="tr"
      style="position:absolute;left:0;right:0;bottom:-16px;width:100%;margin:0"></i></span></div>`,
    'top:520px');
  TEXTES.appendChild(bloc);
  an(bloc, [{ opacity: 0 }, { opacity: 1 }], 26.30, 0.35, 'linear');
  an(bloc, [{ transform: 'scale(.99)' }, { transform: 'scale(1.02)' }], 26.30, 3.7, 'linear');
  an(bloc.querySelector('.prix'), [
    { opacity: 0, transform: 'translateY(30px) scale(.9)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' }], 26.35, 0.7);
  an(bloc.querySelector('.vers'), [
    { opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], 26.62, 0.6);
  an(bloc.querySelector('.cta').parentElement, [
    { opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'translateY(0)' }], 27.90, 0.6);
  an(bloc.querySelector('#tr'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 28.25, 0.6);
}

/* ============================ SORTIE ============================ */
window.rendre = (t) => {
  const ms = Math.max(0, Math.min(DUREE, t)) * 1000;
  for (const a of ANIMS) a.currentTime = ms;
};
window.DUREE = DUREE;
window.PRET = document.fonts.ready.then(() => { window.rendre(0); return true; });
