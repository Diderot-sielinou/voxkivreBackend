# 0013. Synthèse vocale : Amazon Polly (fr-FR) à la place de Google Cloud TTS

- Statut : accepted
- Date : 2026-10-07
- Tags : `conversion`, `tts`, `coût`, `aws`
- Remplace : le choix du fournisseur d'ADR-0008 (Google WaveNet). Les autres
  décisions d'ADR-0008 restent valables : une `<mark>` par mot, sortie MP3,
  parties d'environ 10 minutes, fournisseur derrière `TtsPort`.

## Contexte

Le porteur n'a pas pu ouvrir de compte Google Cloud ; il dispose d'un compte
AWS (plan Free, crédits jusqu'au 2 avril 2027) sur lequel le projet est
désormais hébergé (ADR-0012). Vérifié le 2026-10-07 dans eu-west-3 (Paris)
avec `polly describe-voices` : Léa (neural + standard), Rémi (neural),
Céline (standard), Mathieu (standard).

Faits de la documentation de `SynthesizeSpeech` :

- requête : 6 000 caractères au total, dont 3 000 facturés ; **les balises
  SSML ne sont pas facturées** (nos `<mark>` sont gratuites) ;
- `<mark>` pleinement disponible pour les voix standard et neuronales ;
- l'horodatage (_Speech Marks_, `OutputFormat=json`) est une **seconde
  requête**, facturée comme l'audio : le coût par caractère double ;
- tarifs : standard 4 $, neural 16 $ par million de caractères ;
- l'en-tête de réponse `RequestCharacters` donne les caractères facturés.

## Décision

1. **Amazon Polly** remplace Google derrière le `TtsPort` existant : un
   `PollyTtsAdapter` (SDK `@aws-sdk/client-polly`), aucun changement du
   domaine, des use-cases, du découpage ni du cache (RNF-17).
2. **Deux requêtes en parallèle par segment** : MP3 (`SampleRate=24000`,
   `TextType=ssml`) et Speech Marks de type `ssml` (nos marques `w<i>`). La
   latence reste celle d'une requête ; le contrat (`audio`, `marks`,
   `durationMs`) est inchangé.
3. **Voix** (identifiants Voxlivre inchangés, défaut `fr-f1`) :

   | Voxlivre                         | Polly   | Moteur   | Prix (audio + marques) |
   | -------------------------------- | ------- | -------- | ---------------------- |
   | `fr-f1` Voix féminine naturelle  | Léa     | neural   | 32 $ / M car.          |
   | `fr-m1` Voix masculine naturelle | Rémi    | neural   | 32 $ / M car.          |
   | `fr-f2` Voix féminine standard   | Céline  | standard | 8 $ / M car.           |
   | `fr-m2` Voix masculine standard  | Mathieu | standard | 8 $ / M car.           |

   MP3 en **24 kHz pour toutes les voix** : un seul format par conversion,
   concaténable sans surprise (ADR-0011).

4. **Identifiants : la chaîne par défaut du SDK AWS**, jamais de clé dans
   l'environnement de l'application — profil `voxlivre` en local, rôle
   d'instance en production (ADR-0012).
5. **Choix explicite du moteur** : `TTS_PROVIDER=fake|polly` (`fake` par
   défaut, `polly` obligatoire en production) et `AWS_REGION` obligatoire avec
   Polly. L'adapter Google et les variables `GOOGLE_TTS_*` sont supprimés
   (le code reste dans l'historique git ; pas de code « au cas où »).
6. Erreurs : SSML invalide, texte trop long, moteur ou langue non supportés →
   `TtsRequestRejectedError` (définitif, la conversion échoue et est
   remboursée) ; limitation de débit, panne Polly, réseau, identifiants →
   `TtsUnavailableError` (la file réessaie).

## Conséquences

- **Coût** : un livre de 200 pages (~450 000 caractères) coûte ~14,40 $ en
  voix naturelle, ~3,60 $ en voix standard — 4 à 8 fois plus que WaveNet
  (ADR-0008). Supportable sur les crédits pour le développement ; le quota
  utilisateur ne distingue pas encore les voix : à revoir avec la grille
  tarifaire (étape `billing`). Le cache (RNF-26) et l'idempotence (RNF-12)
  limitent les dépenses inutiles.
- Chaque appel logge `tts.call` avec les caractères facturés (`RequestCharacters`)
  des deux requêtes : c'est la facture.
- Le cache est invalidé naturellement : la signature du moteur
  (`polly|neural|Lea|mp3|24000`) diffère de celle du moteur factice.
- **Constaté à l'essai réel (2026-10-07, 3 pages, 1 891 caractères)** :
  - les marques `ssml` fonctionnent avec les voix neuronales et standard :
    295 repères pour 295 mots, croissants, dernier mot juste avant la fin de
    l'audio ;
  - caractères facturés = 2 × le texte (audio + marques), balises non
    facturées : 690 facturés pour un segment de 2 630 caractères SSML ;
  - MP3 Polly : étiquette ID3v2 de 44 octets (retirée à l'assemblage),
    **aucune trame « Xing »** — pas de dérive du surlignage (ADR-0011) ;
    MPEG-2 Layer III, 24 kHz, **48 kbit/s** (~21,6 Mo par heure d'audio) ;
  - débit de lecture ≈ 18,7 caractères/s (Léa) : une partie de 9 000
    caractères dure ~8 minutes ;
  - coût de l'ensemble des essais : ~0,24 $.
- **Incident et correctif** : le client Polly récent utilise **HTTP/2** par
  défaut ; nos requêtes simultanées partageaient une session que Polly
  coupait (`NGHTTP2_REFUSED_STREAM`), et certaines réponses étaient
  **tronquées sans erreur** à 10,92 s (65 520 octets, la fenêtre de flux
  HTTP/2). Correctifs : client forcé en **HTTP/1.1** (`NodeHttpHandler`), et
  contrôle « audio complet » (le dernier mot doit commencer avant la fin de
  l'audio) appliqué à chaque synthèse **et** à chaque lecture du cache — un
  audio tronqué est une panne réessayée, jamais livré ni mis en cache.
