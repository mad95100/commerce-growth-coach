/* Scène TikTok « 0 € → Premier client » — 1080×1920, 30 s.
   Le rendu est DÉTERMINISTE : aucune horloge réelle n'est lue.
   Toutes les animations sont créées en pause, puis positionnées par rendre(t). */

const OUT   = 'cubic-bezier(.16,1,.3,1)';   // entrée franche, arrivée douce
const INOUT = 'cubic-bezier(.65,0,.35,1)';
const DUREE = 30;

const ANIMS = [];
const $ = (s) => document.querySelector(s);

function an(el, kf, delai, duree, easing = OUT, opts = {}) {
  const a = el.animate(kf, {
    delay: delai * 1000, duration: duree * 1000,
    fill: 'both', easing, ...opts,
  });
  a.pause();
  ANIMS.push(a);
  return a;
}

/** Rend une section visible sur [t0,t1[ et invisible partout ailleurs. */
function section(el, t0, t1) {
  an(el, [
    { opacity: 0, offset: 0 }, { opacity: 1, offset: 0.0001 },
    { opacity: 1, offset: 0.9999 }, { opacity: 0, offset: 1 },
  ], t0, t1 - t0, 'linear');
}

/** Entrée standard : le bloc monte et apparaît. */
function monte(el, delai, duree = 0.6, dy = 26) {
  an(el, [
    { opacity: 0, transform: `translateY(${dy}px)` },
    { opacity: 1, transform: 'translateY(0)' },
  ], delai, duree);
}

/** Révélation par masque : le texte glisse depuis le bas de sa propre ligne. */
function revele(el, delai, duree = 0.68) {
  an(el, [{ transform: 'translateY(112%)' }, { transform: 'translateY(0)' }], delai, duree);
}

/** Tracé progressif d’un chemin SVG. */
function trace(path, delai, duree) {
  const L = path.getTotalLength();
  path.style.strokeDasharray = L;
  an(path, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], delai, duree, OUT);
}

/* ============================ CHRONOLOGIE ============================ */
const B1 = 3.0, B2 = 10.0, B3 = 17.0, B4 = 24.0;

/* ---- fond permanent ---- */
an($('#prog'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 0, DUREE, 'linear');
an($('#lueur'), [
  { transform: 'translate(0,0) scale(1)' },
  { transform: 'translate(-130px,80px) scale(1.1)' },
  { transform: 'translate(80px,-60px) scale(1)' },
], 0, DUREE, 'linear');
an($('#grain'), [
  { transform: 'translate(0,0)' }, { transform: 'translate(-28px,18px)' },
  { transform: 'translate(24px,-14px)' }, { transform: 'translate(-9px,-24px)' },
  { transform: 'translate(17px,11px)' }, { transform: 'translate(0,0)' },
], 0, 0.2, 'steps(5,end)', { iterations: Infinity });

/* ---- volets de transition ---- */
[[ '#v1', B1 ], [ '#v2', B2 ], [ '#v3', B3 ], [ '#v4', B4 ]].forEach(([sel, b]) => {
  an($(sel), [{ transform: 'translateX(100%)' }, { transform: 'translateX(-101%)' }],
     b - 0.26, 0.52, INOUT);
});

/* ================= 0 · HOOK (0 → 3) ================= */
section($('#s0'), 0, B1);

const hookA = $('#s0a'), hookB = $('#s0b');
an(hookA, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 0.999 }, { opacity: 0, offset: 1 }],
   0, 1.70, 'linear');
an(hookA.querySelector('h1'), [
  { transform: 'scale(1) translateY(0)' }, { transform: 'scale(1.045) translateY(-10px)' },
], 0, 1.90, 'linear');
hookA.querySelectorAll('.masque>span').forEach((s, i) => revele(s, 0.16 + i * 0.115, 0.70));

an(hookB, [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.0001 }, { opacity: 1, offset: 1 }],
   1.70, 1.30, 'linear');
an(hookB.querySelector('h1'), [
  { transform: 'scale(.982) translateY(6px)' }, { transform: 'scale(1.035) translateY(-6px)' },
], 1.70, 1.30, 'linear');
hookB.querySelectorAll('.masque>span').forEach((s, i) => revele(s, 1.74 + i * 0.11, 0.62));

/* ================= 1 · ERREUR 1 (3 → 10) ================= */
section($('#s1'), B1, B2);
an($('#fil1'), [
  { opacity: 0, transform: 'translate(-50%,-46%) scale(1.12)', easing: OUT },
  { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.16 },
  { opacity: 1, transform: 'translate(-50%,-54%) scale(1.05)' },
], B1 + 0.05, 6.9, 'linear');
monte($('#p1'), B1 + 0.30, 0.55, 20);
monte($('#t1'), B1 + 0.44, 0.62, 30);
an($('#sc1'), [{ opacity: 0 }, { opacity: 1 }], B1 + 0.92, 0.40, 'linear');

/* grille : 9 × 6 points. Les deux points centraux sont la « personne précise ». */
const COLS = 9, LIGNES = 7, T_DIM = 6.35, T_FIN = 6.95;
const CIBLES = new Set([3 * COLS + 4]);
const grille = $('#g1');
for (let i = 0; i < COLS * LIGNES; i++) {
  const d = document.createElement('i');
  d.className = 'pt0';
  grille.appendChild(d);
  const t0 = 4.00 + (i % COLS) * 0.018 + Math.floor(i / COLS) * 0.030;
  const D = T_FIN - t0;
  const cible = CIBLES.has(i);
  an(d, [
    { opacity: 0, transform: 'scale(0)', backgroundColor: '#3A414C', offset: 0, easing: OUT },
    { opacity: 1, transform: 'scale(1)', backgroundColor: '#3A414C', offset: 0.50 / D },
    { opacity: 1, transform: 'scale(1)', backgroundColor: '#3A414C', offset: (T_DIM - t0) / D, easing: OUT },
    cible
      ? { opacity: 1, transform: 'scale(2.4)', backgroundColor: '#6FE3A0', offset: 1 }
      : { opacity: 0.22, transform: 'scale(1)', backgroundColor: '#3A414C', offset: 1 },
  ], t0, D, 'linear');
}

/* anneau : large et flou d'abord, resserré et net ensuite */
an($('#a1'), [
  { width: '132px', height: '132px', opacity: 0, borderColor: '#FF7A59', offset: 0, easing: OUT },
  { width: '880px', height: '430px', opacity: 1, borderColor: '#FF7A59', offset: 0.22 },
  { width: '880px', height: '430px', opacity: 1, borderColor: '#FF7A59', offset: 0.50, easing: INOUT },
  { width: '132px', height: '132px', opacity: 1, borderColor: '#6FE3A0', offset: 0.72 },
  { width: '132px', height: '132px', opacity: 1, borderColor: '#6FE3A0', offset: 1 },
], 4.45, 3.05, 'linear');

an($('#e1a'), [
  { opacity: 0, filter: 'blur(0px)', transform: 'translateX(-50%) translateY(16px)', offset: 0 },
  { opacity: 1, filter: 'blur(0px)', transform: 'translateX(-50%) translateY(0)', offset: 0.20 },
  { opacity: 1, filter: 'blur(0px)', transform: 'translateX(-50%) translateY(0)', offset: 0.44 },
  { opacity: 1, filter: 'blur(12px)', transform: 'translateX(-50%) translateY(0)', offset: 0.72 },
  { opacity: 0, filter: 'blur(16px)', transform: 'translateX(-50%) translateY(0)', offset: 0.94 },
  { opacity: 0, filter: 'blur(16px)', transform: 'translateX(-50%) translateY(0)', offset: 1 },
], 4.80, 1.60, 'linear');

an($('#e1b'), [
  { opacity: 0, filter: 'blur(12px)', transform: 'translateX(-50%) translateY(12px)' },
  { opacity: 1, filter: 'blur(0px)', transform: 'translateX(-50%) translateY(0)' },
], 6.55, 0.75);

monte($('#ap1'), 7.70, 0.62, 22);

/* ================= 2 · ERREUR 2 (10 → 17) ================= */
section($('#s2'), B2, B3);
an($('#fil2'), [
  { opacity: 0, transform: 'translate(-50%,-46%) scale(1.12)', easing: OUT },
  { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.16 },
  { opacity: 1, transform: 'translate(-50%,-54%) scale(1.05)' },
], B2 + 0.05, 6.9, 'linear');
monte($('#p2'), B2 + 0.30, 0.55, 20);
monte($('#t2'), B2 + 0.44, 0.62, 30);

const FLECHE = (c) =>
  `<svg width="26" height="18" viewBox="0 0 26 18" fill="none">
     <path d="M1 9h20M15 2l7 7-7 7" stroke="${c}" stroke-width="3"
           stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Construit un enchaînement d'étapes et l'anime. */
function flux(hote, { titre, couleur, etapes, sceau, sceauTexte, note, t0 }) {
  hote.innerHTML =
    `<div class="fluxTitre" style="color:${couleur}">${titre}</div>
     <div class="rang">${etapes.map((e, i) =>
        (i ? `<span class="fl">${FLECHE('#7C838E')}</span>` : '') +
        `<div class="boite">${e}</div>`).join('')}
       <div class="badge" style="color:${couleur};border-color:${couleur};background:${couleur}14">${sceau}</div>
     </div>
     <div class="note" style="color:${couleur}">${note}</div>`;

  monte(hote.querySelector('.fluxTitre'), t0, 0.45, 14);
  hote.querySelectorAll('.boite').forEach((b, i) =>
    an(b, [
      { opacity: 0, transform: 'translateY(24px) scale(.94)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], t0 + 0.16 + i * 0.20, 0.50));
  hote.querySelectorAll('.fl').forEach((f, i) =>
    an(f, [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'translateX(0)' }],
       t0 + 0.30 + i * 0.20, 0.34));
  an(hote.querySelector('.badge'), [
    { opacity: 0, transform: 'scale(.5)' }, { opacity: 1, transform: 'scale(1)' },
  ], t0 + 0.78, 0.46);
  monte(hote.querySelector('.note'), t0 + 0.96, 0.44, 12);
  hote.dataset.sceauTexte = sceauTexte;
}

flux($('#fx1'), {
  titre: "L’ordre qui coince", couleur: '#FF7A59',
  etapes: ['Idée', 'Créer', 'Vendre'], sceau: '✕', sceauTexte: 'échec',
  note: "personne n’en veut", t0: B2 + 1.00,
});
flux($('#fx2'), {
  titre: "L’ordre qui tient", couleur: '#6FE3A0',
  etapes: ['Écouter', 'Vérifier', 'Créer'], sceau: '✓', sceauTexte: 'validé',
  note: 'tu construis sur du réel', t0: B2 + 3.15,
});
/* le premier enchaînement s'efface quand le second arrive */
an($('#fx1'), [{ opacity: 1 }, { opacity: 0.3 }], B2 + 2.95, 0.45, 'linear');
monte($('#ap2'), B2 + 5.10, 0.60, 22);

/* ================= 3 · ERREUR 3 (17 → 24) ================= */
section($('#s3'), B3, B4);
an($('#fil3'), [
  { opacity: 0, transform: 'translate(-50%,-46%) scale(1.12)', easing: OUT },
  { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.16 },
  { opacity: 1, transform: 'translate(-50%,-54%) scale(1.05)' },
], B3 + 0.05, 6.9, 'linear');
monte($('#p3'), B3 + 0.30, 0.55, 20);
monte($('#t3'), B3 + 0.44, 0.62, 30);

/* phase A : « prêt » recule à chaque fois qu'on s'en approche */
an($('#axeWrap'), [
  { opacity: 0, offset: 0 }, { opacity: 1, offset: 0.06 },
  { opacity: 1, offset: 0.90 }, { opacity: 0, offset: 1 },
], B3 + 0.90, 2.85, 'linear');
an($('#cur'), [
  { left: '60px', offset: 0 }, { left: '300px', offset: 0.30, easing: INOUT },
  { left: '500px', offset: 0.60, easing: INOUT }, { left: '660px', offset: 0.88 },
  { left: '660px', offset: 1 },
], B3 + 1.05, 2.50, 'linear');
an($('#dra'), [
  { left: '380px', offset: 0 }, { left: '380px', offset: 0.24 },
  { left: '560px', offset: 0.32, easing: OUT }, { left: '560px', offset: 0.54 },
  { left: '720px', offset: 0.62, easing: OUT }, { left: '720px', offset: 0.82 },
  { left: '800px', offset: 0.90, easing: OUT }, { left: '800px', offset: 1 },
], B3 + 1.05, 2.50, 'linear');
monte($('#noteA'), B3 + 2.30, 0.50, 14);

/* phase B : la boucle lancer → retours → ajuster */
const boucle = $('#bou');
boucle.innerHTML =
  `<div class="cyc">
     <div class="chip">Lancer</div><span class="fl">${FLECHE('#6FE3A0')}</span>
     <div class="chip">Retours</div><span class="fl">${FLECHE('#6FE3A0')}</span>
     <div class="chip">Ajuster</div>
   </div>
   <svg width="660" height="96" viewBox="0 0 660 96" fill="none">
     <path id="retour" d="M636 4 C660 52 600 82 330 82 C60 82 12 56 26 16"
           stroke="#6FE3A0" stroke-width="4" stroke-linecap="round" fill="none"/>
     <path id="pointe" d="M14 30 L26 12 L40 28" stroke="#6FE3A0" stroke-width="4"
           stroke-linecap="round" stroke-linejoin="round" fill="none"/>
   </svg>`;
an(boucle, [{ opacity: 0 }, { opacity: 1 }], B3 + 3.80, 0.35, 'linear');
boucle.querySelectorAll('.chip').forEach((c, i) =>
  an(c, [
    { opacity: 0, transform: 'translateY(22px) scale(.94)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ], B3 + 3.85 + i * 0.22, 0.50));
boucle.querySelectorAll('.fl').forEach((f, i) =>
  an(f, [{ opacity: 0 }, { opacity: 1 }], B3 + 4.00 + i * 0.22, 0.30, 'linear'));
trace(boucle.querySelector('#retour'), B3 + 4.65, 0.95);
an(boucle.querySelector('#pointe'), [{ opacity: 0 }, { opacity: 1 }], B3 + 5.50, 0.25, 'linear');
monte($('#ap3'), B3 + 5.40, 0.60, 22);

/* ================= 4 · FIN (24 → 30) ================= */
section($('#s4'), B4, DUREE);
an($('#s4a'), [{ transform: 'scale(.995)' }, { transform: 'scale(1.02)' }], B4, 6.0, 'linear');
monte($('#f0'), B4 + 0.28, 0.50, 16);
an($('#f1'), [
  { opacity: 0, transform: 'translateY(34px) scale(.88)' },
  { opacity: 1, transform: 'translateY(0) scale(1)' },
], B4 + 0.42, 0.75);
an($('#f2'), [{ opacity: 0 }, { opacity: 1 }], B4 + 0.80, 0.30, 'linear');
$('#fleche').querySelectorAll('path').forEach((p, i) => trace(p, B4 + 0.86 + i * 0.16, 0.42));
monte($('#f2').querySelector('.versT'), B4 + 1.02, 0.60, 22);

/* les inclus arrivent un par un */
const inclus = $('#f3');
inclus.innerHTML = ['30 jours', 'Scripts', 'Templates', 'Toolkit']
  .map((m, i) => (i ? '<i>•</i>' : '') + `<span>${m}</span>`).join('');
inclus.querySelectorAll('span, i').forEach((m, i) =>
  an(m, [
    { opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' },
  ], B4 + 1.72 + i * 0.11, 0.42));

monte($('#f4'), B4 + 3.05, 0.60, 22);
an($('#f4t'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], B4 + 3.45, 0.60);

/* ============================ SORTIE ============================ */
window.rendre = (t) => {
  const ms = Math.max(0, Math.min(DUREE, t)) * 1000;
  for (const a of ANIMS) a.currentTime = ms;
};
window.DUREE = DUREE;
window.PRET = document.fonts.ready.then(() => { window.rendre(0); return true; });
