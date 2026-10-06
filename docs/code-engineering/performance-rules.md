# Performance Rules — voxlivre-api

Contexte : client mobile au Cameroun (2G/3G intermittente, data chère),
Railway avec CPU/RAM bornés, un solo dev. La performance ici = **latence
perçue sur mobile** + **coût fournisseur** (TTS au caractère) + **ne pas
saturer Postgres/Redis** avec des requêtes évitables. Simple et correct
d'abord — mais chaque ligne a un coût, chaque PR doit le connaître.

## Database (PostgreSQL + Drizzle)

### Règles dures

- **Jamais** `SELECT *` : `db.select({ id: users.id, email: users.email })`. Toujours énumérer.
- **Jamais** OFFSET : pagination par **cursor signé** (`shared/kernel/pagination.ts`).
- **Jamais** N+1 : pas de `for … await db.query` ; `inArray(...)` ou JOIN, puis `Map` en mémoire.
- **Index** sur toute colonne en `WHERE` / `ORDER BY` / `JOIN` d'un endpoint
  utilisateur ; index composite `(user_id, <sort>, id)` pour chaque listing paginé.
- **`EXPLAIN ANALYZE`** avant merge sur toute requête d'un endpoint chaud
  (bibliothèque, position de lecture, quota).
- **Transactions** courtes via `UNIT_OF_WORK` pour tout multi-write (débit quota + état).
- Pool `DB_POOL_MAX` (10 par défaut) : Railway Postgres a peu de connexions —
  pas de pool par module, un seul `DrizzleModule` global.
- Pas de blob en colonne : texte extrait OK (`text`), audio/PDF/VTT → stockage objet + clé.
- Le **slow-query logger** (> 100 ms warn, > 500 ms error) est l'alarme : un
  warn récurrent = un index manquant.

```ts
// cursor pagination (limit + 1 pour détecter la suite)
const rows = await db
  .select({ id: documents.id, title: documents.title, updatedAt: documents.updatedAt })
  .from(documents)
  .where(
    and(eq(documents.userId, userId), cursor ? lt(documents.updatedAt, cursor.sort) : undefined),
  )
  .orderBy(desc(documents.updatedAt), desc(documents.id))
  .limit(limit + 1);
return buildPage(rows, limit, (r) => ({ sort: r.updatedAt, id: r.id }), codec.encode);
```

## Transactions

Port `UnitOfWorkPort.withTransaction(fn)` (`shared/persistence`), adapter
Drizzle **réentrant** (rejoint la transaction ambiante via ALS — un use-case
appelé depuis un webhook déjà en transaction ne deadlock pas).

```ts
return this.uow.withTransaction(async (tx) => {
  const debited = await this.quota.debit(userId, chars, tx); // UPDATE … WHERE remaining >= chars
  if (!debited) return Result.err(new QuotaExceededError(remaining));
  await this.conversions.markSegmentDone(segmentId, audioKey, tx);
  return Result.ok();
});
```

- **Pas d'appel réseau lent** (TTS, R2, Mobile Money) dans une transaction.
- Une requête HTTP = au plus une transaction ; pas de transaction en boucle.
- `READ COMMITTED` par défaut ; les invariants financiers (quota, crédits)
  s'appuient sur un `UPDATE … WHERE` conditionnel ou `SELECT … FOR UPDATE`,
  pas sur `SERIALIZABLE`.
- Pas de decorator `@Transactional` magique.

## API & payload mobile

- p99 cible **< 200 ms** hors I/O fournisseur. Tout ce qui dépasse → job BullMQ + endpoint de statut.
- Réponses **minimales** : pas de champ "au cas où", `limit` max 50 sur les listings.
- Audio et VTT servis par **URL présignée** du stockage objet, jamais proxyés par l'API.
- `ETag` / `Cache-Control` sur les ressources stables (catalogue de voix, plans tarifaires).
- Position de lecture (RF-14) : écriture **débouncée côté mobile**, endpoint idempotent, pas d'historique par tick.
- Pas de JSON > 100 KB sur un listing ; le texte complet d'un document a son propre endpoint.

## Cache (Redis)

- Cache-aside, TTL court (60–300 s), pour le **read-heavy stable** : catalogue
  de voix, plans, quota courant (invalidé à chaque débit).
- Clés préfixées `vox:<domain>:<id>` ; invalidation explicite à l'écriture.
- Redis down → on lit la base (dégradation), on ne casse pas la requête.
- Pas de cache sur les données par utilisateur à faible réutilisation
  (bibliothèque) tant qu'un profil ne le justifie pas.

## Queue (BullMQ)

Voir [jobs-and-pipeline.md](jobs-and-pipeline.md). Résumé : timeout + retry
explicites, `jobId` déterministe, idempotence en base, concurrency bornée par
le quota fournisseur, payload = IDs.

## Coût fournisseur = performance

- Segmenter le SSML au plus près des limites fournisseur pour minimiser les appels.
- Ne **jamais** resynthétiser un segment déjà produit (clé de stockage déterministe + état en base).
- Cache des voix / des extraits de démo (RF-08) : un audio de démo par voix, généré une fois.
- OCR seulement si l'extraction texte native échoue (détection de PDF scanné avant).

## Lazy module loading

Non utilisé. Le boot Railway est déjà léger (connexions lazy) ; un
`LazyModuleLoader` ne se justifierait que pour une dépendance lourde et rare
(export massif, outil admin) — décision par ADR.

## En review

1. Combien de requêtes DB par appel HTTP ? Bornée et indépendante de la taille des données ?
2. Un index couvre-t-il chaque `WHERE` / `ORDER BY` ajouté ? Est-il dans la migration ?
3. Le use-case appelle-t-il un fournisseur ? Alors il est dans un job, et il est idempotent.
4. Que renvoie-t-on que le mobile n'affiche pas ?
5. Que se passe-t-il si Redis est down ? (dégradation, pas 500)

## Anti-patterns

- ❌ `findAll()` sans pagination
- ❌ `Promise.all` sur N requêtes DB (batch `inArray`)
- ❌ Appel TTS / OCR / extraction PDF dans un controller
- ❌ Streamer un MP3 à travers Nest
- ❌ Cache sans invalidation ; cache d'une donnée financière sans TTL court
- ❌ `SERIALIZABLE` "pour être sûr"
- ❌ Logs synchrones verbeux dans le hot path (Pino est async hors prod ; en prod stdout sync mais niveau `info`)
