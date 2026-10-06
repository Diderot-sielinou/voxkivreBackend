# 0008. Synthèse vocale : Google Cloud TTS (WaveNet fr-FR), horodatage par marques SSML, sortie en parties MP3 + WebVTT

- Statut : accepted
- Date : 2026-10-06
- Tags : `conversion`, `tts`, `coût`, `mobile`

## Contexte

Décision ouverte du SDD (§13.1) : le moteur TTS. Contraintes :

- **DEC-02** : la synchronisation texte-audio repose sur les horodatages
  **natifs** du moteur ; l'alignement forcé n'est qu'un repli.
- **RF-10** + spécification _scroll-to-seek_ : surlignage **au mot**.
- Voix **française** de qualité correcte.
- **Économie unitaire** (RNF-25, DEC-08) : abonnement de 1 500 à
  3 000 FCFA/mois ; un livre de 200 pages ≈ 450 000 caractères.

Comparatif (tarifs publics, octobre 2026) :

| Moteur                        | $/1 M car.                | Horodatage par mot                     | Remarque                               |
| ----------------------------- | ------------------------- | -------------------------------------- | -------------------------------------- |
| Google Standard / **WaveNet** | **4** (4 M gratuits/mois) | oui (`<mark>`, v1beta1)                | `<mark>` non facturé                   |
| Google Neural2                | 16                        | oui                                    | voix plus naturelle                    |
| Google Chirp 3 HD             | 30                        | **non** (SSML limité, pas de `<mark>`) | contraire à DEC-02                     |
| Amazon Polly neural           | 16 + 16                   | oui (_speech marks_)                   | les marks sont une 2ᵉ requête facturée |
| Azure neural                  | 15–16                     | oui (`WordBoundary`)                   | SDK WebSocket, 4× WaveNet              |

## Décision

1. **Google Cloud Text-to-Speech, voix WaveNet `fr-FR`** par défaut, API
   **v1beta1** (`enableTimePointing: [SSML_MARK]`).
2. **Une marque `<mark>` par mot.** Les marques ne sont pas facturées mais
   comptent dans la limite de **5 000 octets par requête** : une requête
   porte ~1 100 caractères de texte, soit ~400 requêtes par livre — sans
   surcoût, sous le quota de 1 000 requêtes/min.
3. **Sortie MP3** (lecture native iOS et Android ; Opus serait plus léger
   mais mal supporté par iOS).
4. **Audio découpé en parties d'environ 10 minutes**, chacune avec son
   fichier WebVTT, plus un manifeste JSON : pas d'assemblage audio côté
   serveur (pas de FFmpeg, DEC-01), téléchargement et reprise par partie
   sur réseau instable, aperçu (RF-15) = partie 1.
5. Le fournisseur reste derrière un `TtsPort` (RNF-17) : Neural2 pourra être
   proposé comme voix premium par configuration.

## Conséquences

- Coût indicatif : ~1,80 $ (~1 100 FCFA) par livre de 200 pages ; le palier
  gratuit couvre ~9 livres/mois. Le quota (étape `billing`) et le cache par
  empreinte (RNF-26) doivent en tenir compte.
- La qualité de voix WaveNet est correcte mais pas la meilleure du marché :
  à réévaluer avec des retours utilisateurs (Neural2 = ×4).
- La segmentation SSML doit respecter 5 000 octets **marques comprises**.
- Implémentation : sous-étapes 2b (synthèse) et 2c (assemblage WebVTT,
  manifeste). Cette ADR précède le code (AGENTS.md).
