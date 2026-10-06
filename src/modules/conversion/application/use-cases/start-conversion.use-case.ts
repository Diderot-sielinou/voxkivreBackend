import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type ClockPort, type DomainError, Result, uuidV7 } from '@/shared/kernel';
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/shared/persistence/unit-of-work.port';

import { type Conversion, newQueuedConversion } from '../../domain/entities/conversion.entity';
import { ConversionConflictError } from '../../domain/errors/conversion-conflict.error';
import { InvalidConversionTextError } from '../../domain/errors/invalid-conversion-text.error';
import { InvalidVoiceError } from '../../domain/errors/invalid-voice.error';
import { SourceDocumentNotFoundError } from '../../domain/errors/source-document-not-found.error';
import { SourceTextNotReadyError } from '../../domain/errors/source-text-not-ready.error';
import { CONVERSION_JOBS, type ConversionJobsPort } from '../../domain/ports/conversion-jobs.port';
import {
  CONVERSION_REPOSITORY,
  type ConversionRepositoryPort,
} from '../../domain/ports/conversion-repository.port';
import {
  DOCUMENT_TEXT_SOURCE,
  type DocumentTextSourcePort,
} from '../../domain/ports/document-text-source.port';
import { QUOTA, type QuotaPort } from '../../domain/ports/quota.port';
import { ConversionId } from '../../domain/value-objects/conversion-id.vo';
import { ConversionStatus } from '../../domain/value-objects/conversion-status.vo';
import { DEFAULT_VOICE_ID, findVoice, VOICES } from '../../domain/voices';

export interface StartConversionInput {
  readonly ownerId: string;
  readonly documentId: string;
  /** Voix de la liste blanche ; voix par défaut si absente (RF-21). */
  readonly voiceId?: string;
}

/**
 * `POST /v1/documents/:id/conversions` : lance la conversion du texte d'un
 * document avec une voix (RF-08). Le quota est **réservé avant toute
 * dépense** (ADR-0010), dans la même transaction que la création de la
 * conversion : les deux existent ensemble ou pas du tout.
 *
 * Idempotent : une conversion active pour (document, voix, révision du
 * texte) est renvoyée telle quelle, sans nouveau débit — double clic ou
 * requête rejouée sur un réseau instable. Lancer la conversion vaut
 * validation du texte (RF-06, PDF natif).
 */
@Injectable()
export class StartConversionUseCase {
  constructor(
    @Inject(CONVERSION_REPOSITORY) private readonly conversions: ConversionRepositoryPort,
    @Inject(DOCUMENT_TEXT_SOURCE) private readonly documents: DocumentTextSourcePort,
    @Inject(QUOTA) private readonly quota: QuotaPort,
    @Inject(CONVERSION_JOBS) private readonly jobs: ConversionJobsPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: StartConversionInput): Promise<Result<Conversion, DomainError>> {
    const requestedVoice = input.voiceId ?? DEFAULT_VOICE_ID;
    const voice = findVoice(requestedVoice);
    if (voice === null) {
      return Result.err(
        new InvalidVoiceError(
          requestedVoice,
          VOICES.map((v) => v.id),
        ),
      );
    }

    const source = await this.documents.findForOwner(input.documentId, input.ownerId);
    if (source === null) return Result.err(new SourceDocumentNotFoundError(input.documentId));
    if (!source.textReady) {
      return Result.err(new SourceTextNotReadyError(source.documentId, source.status));
    }
    if (source.charCount <= 0) return Result.err(new InvalidConversionTextError(source.documentId));

    const existing = await this.conversions.findActive(
      source.documentId,
      voice.id,
      source.textRevision,
    );
    if (existing !== null) return Result.ok(await this.resume(existing));

    const conversion = newQueuedConversion({
      id: ConversionId.of(uuidV7()),
      ownerId: input.ownerId,
      documentId: source.documentId,
      voiceId: voice.id,
      textRevision: source.textRevision,
      reservedChars: source.charCount,
      now: this.clock.now(),
    });

    let reserved: Result<void, DomainError>;
    try {
      reserved = await this.uow.withTransaction(async (tx) => {
        const reservation = await this.quota.reserve({
          reservationId: conversion.id,
          userId: conversion.ownerId,
          chars: conversion.reservedChars,
        });
        if (reservation.isOk()) await this.conversions.insert(conversion, tx);
        return reservation;
      });
    } catch (error) {
      if (!(error instanceof ConversionConflictError)) throw error;
      // Un lancement identique a gagné la course : sa conversion fait foi,
      // notre transaction (réservation comprise) a été annulée.
      const winner = await this.conversions.findActive(
        conversion.documentId,
        conversion.voiceId,
        conversion.textRevision,
      );
      if (winner === null) throw error;
      return Result.ok(winner);
    }
    if (reserved.isErr()) return Result.err(reserved.error);

    // Ne lève jamais : si la file est indisponible, le balayage reprogrammera.
    await this.jobs.schedulePreparation(conversion.id);
    return Result.ok(conversion);
  }

  /** Une conversion restée `queued` (file indisponible au lancement) est reprogrammée. */
  private async resume(existing: Conversion): Promise<Conversion> {
    if (existing.status === ConversionStatus.QUEUED) {
      await this.jobs.schedulePreparation(existing.id);
    }
    return existing;
  }
}
