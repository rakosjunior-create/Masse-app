# Rappels de repas Masse

Cloudflare Worker + Durable Object SQLite. Les alarmes persistent quand Masse est fermée. Un seul téléphone par service ; connecter un autre téléphone remplace le précédent. Les noms et horaires du menu, le fuseau, les identifiants validés du jour et l’abonnement Push sont stockés. Aucun poids, aliment ou macro n’est envoyé.

## Activer le service

Dans ce dossier, avec Node 22 ou supérieur :

```sh
npm ci
npx wrangler login
npm run keys
npx wrangler secret bulk secrets.json
npm run deploy
```

Conserve les clés privées hors de GitHub. `secrets.json` est ignoré par Git : il contient le code `PAIRING_TOKEN` à saisir dans Masse et les clés VAPID. Ne partage pas ce fichier. `npm run keys` refuse d’écraser un fichier existant. Si `wrangler secret bulk` demande de créer le service, accepte sa création. Utilise le même compte pour le déploiement.

Dans Masse, **Aujourd’hui → Rappels des repas** : indique l’URL HTTPS du Worker publiée après le déploiement, le code `PAIRING_TOKEN` et le fuseau `Europe/Paris`, puis active et envoie un test. Sur iPhone, installe d’abord Masse depuis Safari avec **Partager → Sur l’écran d’accueil**, puis ouvre cette icône et accepte la permission (iOS 16.4+).

Les heures suivent le menu éditable. Un repas validé et synchronisé avant son horaire n’envoie pas de rappel. Chaque jour reprend le menu ; les statuts d’hier ne sont pas reconduits. Une saisie faite hors ligne ne peut pas annuler un rappel avant la prochaine connexion. Seule une saisie liée au repas du menu le valide ; une saisie libre ne suffit pas.

Les alarmes très en retard sont ignorées (plus de 10 minutes). Un échec d’envoi est enregistré, sans renvoi automatique pour éviter les doublons. Les notifications ne garantissent pas une livraison à la seconde et dépendent des services Push et de la connexion du téléphone. Une modification des horaires ne renvoie pas un repas déjà notifié le même jour.

Le code de connexion est un secret conservé seulement dans le stockage de l’appareil ; il n’est pas inclus dans les sauvegardes nutritionnelles. Désactiver dans Masse supprime l’abonnement côté serveur avant de le supprimer du téléphone. Pour supprimer entièrement les données Cloudflare, supprime le Worker et le namespace Durable Object depuis ton compte. Vérifie les limites et tarifs de ton compte avant déploiement.

## Vérification

```sh
npm test
npx wrangler deploy --dry-run --outdir /tmp/masse-worker-build
```
