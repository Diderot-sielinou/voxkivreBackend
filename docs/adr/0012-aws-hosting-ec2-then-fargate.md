# 0012. Hébergement sur AWS, par phases : une instance EC2 d'abord, ECS Fargate en vitrine

- Statut : accepted
- Date : 2026-10-07
- Tags : `infra`, `coût`, `déploiement`, `apprentissage`
- Remplace : l'hypothèse « hébergement Railway » d'AGENTS.md (ADR-0003 reste
  valable : `DATABASE_URL` ou composants, quel que soit l'hébergeur).

## Contexte

Le projet visait Railway (un service à ~5 $/mois, ADR-0009). Trois faits
changent la donne :

1. **But du projet** : apprentissage et portfolio. Une infrastructure AWS
   décrite en code (VPC, IAM, conteneurs, base gérée, CI/CD sans clé) parle
   davantage aux recruteurs qu'un PaaS.
2. **Budget** : le compte AWS du porteur (plan Free) dispose de 100 $ de
   crédits, plus 100 $ en réalisant 5 activités, valables jusqu'au
   **2 avril 2027**. Aucune facture n'est possible tant que le compte reste
   sur le plan Free.
3. **Synthèse vocale** : le porteur n'a pas pu ouvrir de compte Google
   Cloud ; Amazon Polly devient le moteur TTS (ADR-0013, à écrire avant son
   adapter). Avoir l'API, le stockage et le TTS chez le même fournisseur
   simplifie l'IAM (un rôle, aucune clé longue durée en production).

Contraintes héritées du code :

- workers BullMQ **dans le processus de l'API**, en continu (ADR-0009) :
  Lambda est exclu, il faut un conteneur toujours actif ;
- Redis persistant (`noeviction`) pour BullMQ, PostgreSQL 16 ;
- stockage S3-compatible avec URL pré-signées (ADR-0007, ADR-0011) : S3 natif
  convient sans changer le port ;
- arrêt propre et reprise sans perte déjà vérifiés (SIGTERM, `kill -9`) :
  éteindre la machine la nuit est sans risque.

## Options

| Option                                | Coût mensuel continu (us-east-1)                    | Pour                                                                         | Contre                                               |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| Railway (statu quo)                   | ~5 à 10 $                                           | Simple, déjà prévu                                                           | Peu valorisant sur un CV ; hors crédits AWS          |
| **EC2 t4g.small + Docker Compose**    | **~18 $** (≈ 6 $ si éteinte la nuit et le week-end) | Le moins cher ; reproduit le compose de dev ; apprend VPC, IAM, Linux, HTTPS | Une seule machine ; sauvegardes à gérer              |
| ECS Fargate + ALB + RDS + ElastiCache | ~62 à 65 $                                          | Architecture « entreprise », rien à administrer                              | ×3,5 ; ALB et ElastiCache ne se mettent pas en pause |
| Lightsail                             | ~7 à 12 $                                           | Prix fixe                                                                    | Peu représentatif d'AWS « réel »                     |
| App Runner                            | —                                                   | —                                                                            | Fermé aux nouveaux clients depuis le 30 avril 2026   |
| EKS                                   | > 75 $ (plan de contrôle seul)                      | Kubernetes                                                                   | Hors budget, surdimensionné                          |

## Décision

Héberger sur AWS en **trois phases**, toute l'infrastructure décrite en
**Terraform** (`infra/`), région **eu-west-3 (Paris)**, la plus proche du
Cameroun (si une voix Polly neuronale y manque : eu-west-1, Irlande) :

1. **Phase 1 — EC2 + Docker Compose** (environnement principal) : une
   instance Graviton `t4g.small` dans un sous-réseau public (pas de NAT),
   Caddy (HTTPS Let's Encrypt), l'API (avec ses workers), PostgreSQL et
   Redis en conteneurs sur un disque EBS gp3 chiffré. S3, Polly, SSM
   Parameter Store, ECR et CloudWatch Logs via le **rôle d'instance** (aucune
   clé). Extinction programmée par EventBridge Scheduler (8 h → 23 h, jours
   ouvrés). Déploiement : GitHub Actions avec **OIDC** → image arm64 dans ECR
   → `docker compose pull && up -d` par SSM Run Command, migrations
   (`node dist/migrate`) avant le démarrage.
2. **Phase 2 — RDS PostgreSQL** (`db.t4g.micro`, sauvegardes automatiques)
   à la place du conteneur Postgres : apprendre une base gérée, sans changer
   le code (ADR-0003).
3. **Phase 3 — vitrine ECS Fargate** : un module Terraform séparé (ALB +
   certificat ACM, service Fargate arm64, RDS, ElastiCache Valkey), **créé
   pour une démo ou un entretien, puis détruit** (~2 $ par jour).

Pourquoi **EC2 d'abord, Fargate ensuite** : la phase 1 tient dans les crédits
pendant toute leur durée de validité et enseigne les fondations (réseau,
IAM, conteneurs, HTTPS, déploiement) ; Fargate réutilise exactement la même
image et les mêmes variables d'environnement — passer de l'un à l'autre est
un changement d'infrastructure, pas de code. Payer 65 $/mois en continu pour
une architecture que personne n'utilise encore n'aurait aucun sens.

## Conséquences

- **Coûts** (détail : [docs/architecture/aws.md](../architecture/aws.md)) :
  ~100 à 150 $ sur six mois (phase 1 en continu, phase 2 deux mois, une
  vingtaine de jours de vitrine), dans les 200 $ de crédits. Garde-fous :
  budget AWS avec alerte à 10 $, pas d'Elastic IP, pas de NAT Gateway,
  rétention des logs à 7 jours, ressources éphémères détruites.
- **Changements de code nécessaires** (petits, chacun dans son commit) :
  - identifiants S3 et Polly par la **chaîne par défaut du SDK** (rôle
    d'instance) quand les clés ne sont pas fournies — aujourd'hui
    `S3_ACCESS_KEY_ID` est obligatoire en production ;
  - image Docker construite pour **arm64** (Graviton) ;
  - adapter Polly derrière le `TtsPort` existant (ADR-0013), sans toucher au
    domaine ni aux use-cases (RNF-17).
- `AGENTS.md`, le README et le Dockerfile ne parlent plus de Railway comme
  hébergeur ; les mentions de Railway dans les commentaires (variables
  `DATABASE_URL`, proxy, SIGTERM) restent exactes pour AWS.
- **Après le 2 avril 2027** : passer au plan payant (~6 à 18 $/mois en phase
  1), ou tout détruire avec Terraform et ne recréer qu'à la demande, ou
  revenir sur Railway — le code reste portable.
- **Critère de révision** : un vrai trafic utilisateur justifierait de
  garder Fargate en continu (haute disponibilité, mise à l'échelle) ; la
  séparation API / workers d'ADR-0009 deviendrait alors deux services ECS.
