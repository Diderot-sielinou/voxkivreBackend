# 0004. Authentification par OTP email/téléphone via better-auth

- Statut : accepted
- Date : 2026-09-13
- Tags : `identity`, `sécurité`, `mobile`

## Contexte

RF-16 / DEC-09 : compte et connexion par email **ou** numéro de téléphone
avec code à usage unique, sans mot de passe ; sessions multi-appareils pour
retrouver sa bibliothèque. RNF-28 : anti-abus du palier gratuit (le point
d'entrée est la demande d'OTP). Marché : téléphone = identité principale.

## Options

1. **better-auth** (lib pure Node, adapter Drizzle) + plugins `emailOTP`,
   `phoneNumber`, `bearer`. Même lib que cinaf-engine.
2. **OTP + JWT maison** : plus pédagogique, mais toute la surface sécurité
   (hash des codes, anti-brute-force, rotation, sessions) à écrire et
   maintenir seul.
3. Keycloak : prévu par le SDD pour un SSO institutionnel (Niveau 4), trop
   lourd au MVP.

## Décision

**Option 1.** Paramètres : OTP 6 chiffres, 5 min, 3 tentatives, stocké
hashé, renvoi = rotation ; session 30 j rafraîchie à l'usage (1 j) ; bearer
signé (`requireSignature`) pour le mobile ; E.164 sans restriction pays.

- Un compte téléphone reçoit un email technique déterministe
  `<digits>@phone.voxlivre.local` (contrainte better-auth : email unique) —
  masqué par le mapper `/v1/me`.
- La table `user` est **possédée par better-auth** ; le domain n'en expose
  qu'une projection (`User`) via `UserQueryPort`.
- Livraison des codes derrière `OtpSenderPort` : `log` en dev (refusé en
  prod sans `OTP_LOG_DELIVERY_UNSAFE_ALLOW`), email/SMS via le module
  notification ensuite.
- Rate-limit better-auth **en base** (`rate_limit`) : les routes
  `/api/auth/*` sont un middleware Express hors `ThrottlerGuard`, et on
  évite Redis sur le chemin d'auth (ADR-0002). 5 envois / 10 min / IP.
  `memory` autorisé uniquement hors production (e2e).
- Rôle `user` | `admin` en colonne, `input: false` (jamais settable client).

## Conséquences

- ~0 code crypto maison ; la surface à auditer est la config.
- Une IP partagée (campus, NAT opérateur) atteint la limite d'envoi vite :
  à surveiller, éventuellement passer la clé à `IP + identifiant`.
- Jest ne charge pas les modules ESM-only (better-auth) sans transform :
  `@swc/jest` sur `.mjs` dans les configs e2e/int.
- Google/Apple sign-in, profils multiples, gestion d'appareils : hors scope,
  à décider par ADR si le besoin apparaît.
