-- Données de l'ADR-0019, séparées du changement de schéma (0009, migrations.md).
--
-- 1. Catalogue provisoire, à ajuster après l'étude de prix locale (CdC §5) par
--    une nouvelle migration : jamais par une variable d'env.
INSERT INTO "offers" ("code", "kind", "price_xaf", "units", "duration_days") VALUES
  ('pass-30d',  'pass',    2000, 250000, 30),
  ('credits-s', 'credits',  500,  50000, NULL),
  ('credits-m', 'credits', 1000, 110000, NULL),
  ('credits-l', 'credits', 2500, 300000, NULL)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
-- 2. Réservations antérieures : toutes prises sur le palier gratuit (seule
--    source avant l'ADR-0019) ; un remboursement leur rend donc leur part.
UPDATE "quota_reservations"
SET "free_units" = "chars"
WHERE "free_units" = 0 AND "pass_units" = 0 AND "credit_units" = 0;
