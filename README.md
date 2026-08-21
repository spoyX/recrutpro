# RecrutPro — Système de Gestion du Recrutement

Application web de gestion du recrutement : publication de postes, suivi des
candidatures étape par étape, planification et évaluation des entretiens,
décision finale et tableaux de bord. Trois rôles se partagent le processus, et
chacun ne voit que ce qui le concerne.

| | |
|---|---|
| **Auteur** | Adem Ben Chiboub |
| **Cadre** | Projet de stage — 6 semaines |
| **Documents** | `docs/SRS.md` (exigences), `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (décisions d'architecture), `docs/DESIGN.md` |

---

## 1. Présentation

Le recrutement suit un cycle unique, du dépôt de candidature à la décision :

```
Candidature reçue ──▶ Présélection CV validée ──▶ Entretien planifié
        │                                                  │
        └──▶ Rejeté (CV)                                    ▼
                                              Évaluation complétée
                                                  │           │
                                            Accepté       Rejeté
```

**Les trois rôles (FR-1 à FR-11)**

- **Administrateur** — gère les comptes utilisateurs, les départements et
  consulte le journal d'audit. Il n'appartient à aucun département.
- **Recruteur** — publie les postes, enregistre les candidats, examine les CV,
  planifie les entretiens et suit les tableaux de bord.
- **Responsable hiérarchique** — mène les entretiens de son département,
  rédige les évaluations et prend la décision finale.

**Points notables**

- Les CV sont stockés chez Cloudinary en mode `authenticated` : **aucune URL
  publique n'existe**. Le téléchargement passe obligatoirement par un proxy
  côté serveur qui signe une URL valable 60 secondes (FR-23, D-040).
- Un responsable hiérarchique n'atteint le CV que d'un candidat qu'il
  interviewe réellement, dans son propre département (FR-35, D-047). La règle
  est appliquée côté serveur, pas seulement masquée dans l'interface.
- La présélection ne peut pas être **validée** sans CV — il n'y aurait rien à
  évaluer — mais le **rejet** reste ouvert, car « aucun CV n'a été transmis »
  est un motif de rejet légitime (D-105).
- Toute action sensible est écrite dans un journal d'audit consultable par
  l'administrateur (FR-44).

---

## 2. Pile technique

| Couche | Technologie |
|---|---|
| **Frontend** | Angular 20.3 (composants standalone, signals), Angular Material 20.2, Chart.js 4.5.1, FullCalendar 6.1, SCSS |
| **Backend** | Node.js 24, Express 5.2, TypeScript 6 |
| **Base de données** | MongoDB 8 via Mongoose 9.8 |
| **Sessions** | `express-session` + `connect-mongo` — sessions serveur, **pas de JWT** (D-001) |
| **Mots de passe** | `bcrypt` |
| **Stockage des fichiers** | Cloudinary (CV et photos de profil, en `authenticated`) |
| **Téléversement** | `multer` 2.2, avec contrôle des octets d'en-tête du fichier |
| **Documentation API** | `swagger-ui-express` 5 (OpenAPI) |
| **Tests** | Jest 30 (backend), Karma/Jasmine (frontend) |
| **Conteneurs** | Docker Compose — `node:24-alpine`, `nginx:alpine`, `mongo:8` |

---

## 3. Prérequis

- **Node.js 24** et npm — nécessaires pour installer les dépendances, lancer
  les tests et exécuter le script de démonstration depuis la machine hôte.
- **Docker** et **Docker Compose** — pour le démarrage en une commande.
- **Un compte Cloudinary** (l'offre gratuite suffit). Les routes de CV
  renvoient `503` sans identifiants ; **le reste de l'application fonctionne
  normalement**, ce qui permet une démonstration partielle sans compte.

---

## 4. Installation

```bash
git clone <url-du-dépôt> recrutpro
cd recrutpro

# Dépendances — les deux dossiers
cd backend  && npm install
cd ../frontend && npm install
cd ..
```

### Configuration

```bash
cp backend/.env.example backend/.env
```

Puis renseignez `backend/.env` :

| Variable | Rôle |
|---|---|
| `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_DB` | Identifiants MongoDB ; Compose en dérive `MONGO_URI` |
| `MONGO_URI` | Utilisé uniquement hors Docker (`npm run dev`, `npm run seed`) |
| `SESSION_SECRET` | **À remplacer** par une valeur aléatoire longue. La valeur par défaut est un placeholder et l'application le signale bruyamment au démarrage |
| `COOKIE_SECURE` | `false` en local (voir §10). À supprimer pour tout déploiement en HTTPS |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Stockage des CV. **Sans valeur par défaut et jamais versionnés** |

> `backend/.env` est ignoré par git. Aucun identifiant réel n'est présent dans
> le dépôt, et le secret Cloudinary ne doit jamais être journalisé, renvoyé
> dans une réponse ni écrit en dur (D-040).

---

## 5. Démarrage avec Docker Compose

Le fichier `docker-compose.yml` se trouve dans **`backend/`** et démarre les
trois services (API, frontend servi par nginx, MongoDB) :

```bash
cd backend
docker compose up -d
```

| Service | Adresse |
|---|---|
| **Application** | <http://localhost:4200> |
| **API** | <http://localhost:3000> |
| **Documentation Swagger** | <http://localhost:3000/api/docs> |
| MongoDB | `127.0.0.1:27017` — publié sur la boucle locale uniquement |

```bash
docker compose ps          # état des services
docker compose logs -f backend
docker compose down        # arrêt (les données MongoDB sont conservées)
```

### Sans Docker

```bash
# terminal 1 — API (nécessite un MongoDB accessible via MONGO_URI)
cd backend && npm run dev

# terminal 2 — frontend
cd frontend && npm start
```

---

## 6. Jeu de données de démonstration

Le script remplit une base cohérente : 7 départements, 13 utilisateurs, 12
postes, 47 candidats répartis sur toutes les étapes, 24 entretiens, 14
évaluations, 168 entrées d'audit et 81 notifications. Il téléverse également
**un vrai PDF par candidat** chez Cloudinary, en passant par le chemin
d'upload de l'application elle-même.

```bash
cd backend
npm run seed -- --force --password <mot-de-passe>
```

| Option | Effet |
|---|---|
| `--force` | **Obligatoire.** Le script **supprime la base** avant de la recharger et refuse de s'exécuter sans confirmation explicite |
| `--password <valeur>` | Donne le **même** mot de passe aux 13 comptes — pratique pour une démonstration. Minimum 8 caractères. Sans cette option, un mot de passe distinct est généré par compte et affiché **une seule fois** |
| `--no-cv` | Ne téléverse aucun CV (utile sans compte Cloudinary) |

> **Pourquoi le mot de passe n'est pas écrit ici.** Il est transmis à
> l'exécution et n'est stocké que sous forme de hachage bcrypt. Un mot de passe
> versionné dans le dépôt survivrait à toutes les rotations ultérieures et
> serait lisible par quiconque lit le code (D-089). Choisissez la valeur au
> moment du seed : c'est celle des 13 comptes ci-dessous.

Le script nettoie ce qu'il a créé : il **supprime les CV chez Cloudinary avant
de vider la base**, afin de ne pas laisser d'objets orphelins.

---

## 7. Comptes de démonstration

Les 13 comptes partagent le mot de passe passé à `--password`.

### Administrateur — 2 comptes
| Email | Particularité |
|---|---|
| `sonia.belhadj@recrutpro.fr` | — |
| `marc.lefevre@recrutpro.fr` | — |

### Recruteur — 4 comptes
| Email | Particularité |
|---|---|
| `amelie.rousseau@recrutpro.fr` | — |
| `thomas.girard@recrutpro.fr` | — |
| `nadia.cherif@recrutpro.fr` | **Changement de mot de passe imposé** à la connexion (FR-10) |
| `julien.mercier@recrutpro.fr` | **Compte désactivé** — la connexion est refusée malgré un mot de passe valide (FR-8) |

### Responsable hiérarchique — 7 comptes
| Email | Particularité |
|---|---|
| `claire.fontaine@recrutpro.fr` | — |
| `hugo.bertrand@recrutpro.fr` | — |
| `rachid.nasri@recrutpro.fr` | — |
| `lea.dumont@recrutpro.fr` | — |
| `antoine.vasseur@recrutpro.fr` | — |
| `camille.perrin@recrutpro.fr` | — |
| `farah.zouari@recrutpro.fr` | — |

Les deux derniers cas ne sont pas des anomalies : ils existent pour que FR-8 et
FR-10 soient démontrables sans manipulation préalable.

---

## 8. Documentation de l'API

Swagger UI est servi par l'API elle-même :

- **<http://localhost:3000/api/docs>**
- Spécification brute : <http://localhost:3000/api/docs.json>

Toutes les routes sont préfixées par `/api/v1`. L'authentification repose sur
un **cookie de session** (`recrutpro.sid`, `HttpOnly`, `SameSite=Lax`) : il faut
d'abord appeler `POST /api/v1/auth/login`, puis conserver le cookie. Dans
Swagger UI, connectez-vous d'abord depuis l'application dans le même
navigateur ; le cookie sera envoyé automatiquement.

---

## 9. Tests

```bash
cd backend  && npm test      # 694 tests — Jest
cd frontend && npm test      # 608 tests — Karma/Jasmine
```

Vérification des types du backend :

```bash
cd backend && npm run typecheck
```

Les tests backend utilisent une base en mémoire et des identifiants Cloudinary
factices : **aucun test ne touche à un service réel ni à la base de
démonstration.**

---

## 10. Notes de déploiement

L'application tourne en local sur HTTP simple. Les points suivants doivent être
traités **avant toute mise en ligne** ; ils sont suivis dans `docs/TASKS.md`.

### À faire impérativement

1. **`SESSION_SECRET`** — remplacer le placeholder par une valeur aléatoire
   longue. Sans cela, une session peut être forgée. L'application émet un
   avertissement au démarrage tant que la valeur par défaut est utilisée.
2. **`COOKIE_SECURE`** — supprimer la ligne `COOKIE_SECURE=false` de `.env`
   (ou la passer à `true`). L'attribut `Secure` est activé automatiquement
   sous `NODE_ENV=production`.
   > **Attention en local :** avec `secure` activé sur du HTTP simple,
   > `POST /auth/login` renvoie `200` **sans poser de cookie**, et la requête
   > suivante arrive anonyme. La panne se présente comme un succès — d'où la
   > ligne explicite dans `.env.example`.
3. **`app.set('trust proxy', 1)`** est déjà en place (D-025) et reste
   nécessaire : derrière nginx, Express détermine si la connexion est sécurisée
   à partir de `X-Forwarded-Proto`.
4. **Identifiants Cloudinary** — ne jamais les versionner. En cas d'exposition,
   générer une nouvelle paire de clés **puis supprimer l'ancienne** : chez
   Cloudinary, générer une clé n'invalide pas la précédente.
5. **HTTPS obligatoire** — les CV sont des documents personnels et transitent
   par l'API.

### Limites connues, énoncées plutôt que masquées

- **NFR-01/02** — les objectifs de performance (page < 2 s, enregistrement
  < 1 s à 50 utilisateurs simultanés) **n'ont pas été mesurés sous charge**.
- **NFR-03/04/05** — la revue de sécurité complète reste à faire. Le contrôle
  du type de fichier lit les marqueurs d'entrée ZIP plutôt que d'analyser le
  répertoire central de l'archive.
- **Atomicité** — certaines opérations écrivent dans plusieurs collections sans
  transaction (D-033, D-046, D-050) : une panne au mauvais moment peut laisser
  un état partiel.
- **NFR-07** — la disponibilité n'est pas testable avant déploiement.

---

## Structure du dépôt

```
recrutpro/
├── backend/
│   ├── src/
│   │   ├── config/         session, base de données, Cloudinary
│   │   ├── models/         schémas Mongoose
│   │   ├── services/       règles métier
│   │   ├── controllers/    HTTP
│   │   ├── routes/         routage + rôles requis
│   │   ├── middleware/     authentification, téléversement, erreurs
│   │   └── docs/           spécification OpenAPI
│   ├── scripts/            script de démonstration
│   ├── tests/              694 tests
│   └── docker-compose.yml  ← les trois services
├── frontend/
│   ├── src/app/
│   │   ├── core/           services, gardes, intercepteurs
│   │   ├── shared/         composants réutilisables
│   │   └── features/       une page par fonctionnalité
│   └── src/styles/         thème, vocabulaire de page, polices
└── docs/                   SRS, PRD, architecture, décisions, design
```
