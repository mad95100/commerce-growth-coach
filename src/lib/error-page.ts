/**
 * DERNIER RECOURS : LA PAGE SERVIE QUAND LE RENDU LUI-MÊME A ÉCHOUÉ.
 *
 * CE QU'ELLE ÉTAIT. Entièrement en anglais, `lang="en"` compris, dans un
 * produit qui vouvoie en français du premier écran au rapport :
 * « This page didn't load », « Something went wrong on our end », « Try again »,
 * « Go home ». Personne ne la relisait parce que personne ne la voit en
 * fonctionnement normal — c'est précisément pour cela qu'elle atteint le
 * marchand au pire moment, et qu'elle est alors la seule chose qu'il ait sous
 * les yeux.
 *
 * PAS DE `onclick`. Le bouton « Try again » rechargeait par un gestionnaire
 * JavaScript en ligne. C'est la règle déjà tenue par les trois retours OAuth,
 * née d'un défaut réel : un script bloqué rend la page morte, et une page morte
 * dans un écran d'erreur ne laisse aucune sortie. Deux liens ordinaires, qui
 * fonctionnent sans JavaScript.
 *
 * AUCUN DÉTAIL TECHNIQUE. Ni code, ni trace, ni nom de module : ils sont déjà
 * dans le journal du serveur, qui est le seul endroit où ils servent.
 */
export function renderErrorPage(chemin = "/"): string {
  /*
    UNE BARRE OBLIQUE NE SUFFIT PAS À FAIRE UN CHEMIN INTERNE.

    Le contrôle exigeait seulement que la valeur commence par `/`. `//exemple.test`
    le satisfait — c'est une adresse PROTOCOLE-RELATIVE, que le navigateur résout
    vers un autre domaine. La page d'erreur serait devenue un tremplin : le
    marchand, déjà désorienté, aurait cliqué « Réessayer » et atterri ailleurs.
    Trouvé par le test qui accompagne cette fonction, pas par relecture.
  */
  const interne = chemin.startsWith("/") && !chemin.startsWith("//");
  const retour = interne && /^\/[A-Za-z0-9\-._~/]*$/.test(chemin) ? chemin : "/";
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Cette page n'a pas pu s'afficher — EcomPilot</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 16px/1.6 system-ui, -apple-system, sans-serif; background: #faf8f4; color: #1a1a1a; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 30rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.375rem; margin: 0 0 0.75rem; }
      p { color: #4b4b4b; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font: inherit; text-decoration: none; border: 1px solid transparent; }
      a:focus-visible { outline: 2px solid #1a1a1a; outline-offset: 2px; }
      .primary { background: #1a1a1a; color: #fff; }
      .secondary { background: #fff; color: #1a1a1a; border-color: #d8d2c8; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Cette page n'a pas pu s'afficher</h1>
      <p>
        Le problème vient de chez nous, pas de votre boutique. Rien n'a été modifié
        et vos diagnostics ne sont pas touchés. Réessayez dans un instant.
      </p>
      <div class="actions">
        <a class="primary" href="${retour}">Réessayer</a>
        <a class="secondary" href="/">Revenir à l'accueil</a>
      </div>
    </div>
  </body>
</html>`;
}
