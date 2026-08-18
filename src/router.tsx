import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { estDefinitive, delaiAvantNouvelEssai } from "./lib/query-retry";

export const getRouter = () => {
  /*
    LES NOUVEAUX ESSAIS, RÉGLÉS SUR CE QUI PEUT RÉELLEMENT S'ARRANGER.

    CE QUI SE PASSAIT, MESURÉ AU NAVIGATEUR. Sur une lecture en échec, la page
    boutique affichait son ossature de chargement pendant 8,5 SECONDES avant de
    dire quoi que ce soit. Rien n'était cassé : c'est le réglage par défaut de
    React Query — trois nouveaux essais espacés de 1 s, 2 s puis 4 s — et l'état
    d'échec n'arrive qu'après le dernier.

    Le marchand, lui, regarde une page qui charge indéfiniment. Au bout de trois
    ou quatre secondes il recharge, ce qui remet le compteur à zéro et
    reconstruit exactement la même attente. C'est le comportement que produit une
    page qui ne dit rien : on la relance.

    CE QUI EST CORRIGÉ. Une erreur DÉFINITIVE n'est plus réessayée du tout. Un
    403 ne devient pas un 200 parce qu'on redemande : la politique d'accès ne va
    pas changer entre deux secondes. Un 404 non plus. Les rejouer ne fait
    qu'ajouter du silence à un échec déjà connu — et, sur les écritures, expose
    à rejouer une action.

    Une panne PASSAGÈRE — coupure réseau, 500, 503 — garde deux essais, avec un
    délai plafonné : c'est le cas où redemander a un sens, et deux suffisent à
    absorber un hoquet sans faire attendre une seconde de plus que nécessaire.

    Le budget d'attente passe ainsi de plus de huit secondes à moins de deux dans
    le cas définitif, sans rien perdre de la tolérance aux vraies intermittences.
  */
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (nombreEchecs, erreur) => !estDefinitive(erreur) && nombreEchecs < 2,
        retryDelay: delaiAvantNouvelEssai,
      },
      mutations: {
        // UNE ÉCRITURE NE SE REJOUE JAMAIS TOUTE SEULE. Le produit modifie de
        // vraies boutiques : un budget publicitaire, un code promo, une fiche
        // produit. Une requête dont on ignore l'issue — partie, mais sans
        // réponse — serait rejouée à l'identique, et l'écriture s'appliquerait
        // deux fois. C'est la règle que le moteur applique déjà côté serveur ;
        // elle vaut aussi ici.
        retry: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
