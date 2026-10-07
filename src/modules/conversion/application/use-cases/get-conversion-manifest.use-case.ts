import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result } from '@/shared/kernel';
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/shared/storage/object-storage.port';

import { ConversionNotFoundError } from '../../domain/errors/conversion-not-found.error';
import { ConversionNotReadyError } from '../../domain/errors/conversion-not-ready.error';
import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import { buildManifest, type ConversionManifest } from '../../domain/services/conversion-manifest';
import { type ConversionId } from '../../domain/value-objects/conversion-id.vo';

/**
 * Validité des URL de téléchargement : de quoi lancer chaque partie sur un
 * réseau lent ; au-delà, le mobile redemande le manifeste (une requête en
 * cours n'est pas coupée à l'expiration).
 */
export const DOWNLOAD_URL_TTL_SECONDS = 3600;

export interface DownloadableManifest {
  readonly manifest: ConversionManifest;
  /** URL signées par nom de fichier (`part-001.mp3` → URL). */
  readonly urls: ReadonlyMap<string, string>;
  readonly urlsExpireAt: Date;
}

/**
 * `GET /v1/conversions/:id/manifest` (ADR-0011) : le manifeste et des URL de
 * téléchargement signées, dès la première partie assemblée — l'aperçu
 * (RF-15) s'écoute pendant que le reste se termine. Le téléchargement ne
 * passe pas par l'API (stockage objet direct).
 */
@Injectable()
export class GetConversionManifestUseCase {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: {
    readonly ownerId: string;
    readonly conversionId: ConversionId;
  }): Promise<Result<DownloadableManifest, DomainError>> {
    const conversion = await this.conversions.findByIdForOwner(input.conversionId, input.ownerId);
    if (conversion === null) return Result.err(new ConversionNotFoundError(input.conversionId));
    const parts = await this.conversions.listParts(conversion.id);
    if (!parts.some((part) => part.assembled !== null)) {
      return Result.err(new ConversionNotReadyError(conversion.id, conversion.status));
    }

    const urls = new Map<string, string>();
    for (const part of parts) {
      if (part.assembled === null) continue;
      for (const file of [part.assembled.audio, part.assembled.vtt]) {
        const name = file.key.slice(file.key.lastIndexOf('/') + 1);
        urls.set(name, await this.storage.presignGet(file.key, DOWNLOAD_URL_TTL_SECONDS));
      }
    }
    return Result.ok({
      manifest: buildManifest(conversion, parts),
      urls,
      urlsExpireAt: new Date(this.clock.now().getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    });
  }
}
