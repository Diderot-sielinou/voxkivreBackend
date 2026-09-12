import { type NestExpressApplication } from '@nestjs/platform-express';

/**
 * Plafond des bodies JSON / urlencoded.
 *
 * Le défaut body-parser (100 KB) suffit pour toutes les routes JSON de
 * Voxlivre : l'import PDF (RF-01) passera par `multipart/form-data`
 * (multer, limite dédiée par route) ou par upload direct vers le stockage
 * objet via URL présignée — jamais en base64 dans un JSON. On relève
 * légèrement pour le texte validé par l'utilisateur (RF-06 : un document de
 * 500 k caractères renvoyé corrigé ≈ 1 MB).
 */
const JSON_BODY_LIMIT = '2mb';

export function configureBodyParser(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });
}
