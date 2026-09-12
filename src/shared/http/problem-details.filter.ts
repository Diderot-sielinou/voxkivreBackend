import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Response } from 'express';

import { DomainError } from '@/shared/kernel';
import { requestContext } from '@/shared/observability/request-context';

import { statusFromCode, titleFromStatus } from './error-status';
import { type ProblemDetails } from './problem-details';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** RFC 7807 : pas de page de documentation dédiée par type d'erreur. */
const PROBLEM_TYPE = 'about:blank';

/** Marqueur posé par `raw-body` quand un corps dépasse la limite du parser. */
const PAYLOAD_TOO_LARGE_TYPE = 'entity.too.large';

function isPayloadTooLarge(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'type' in exception &&
    (exception as { type?: unknown }).type === PAYLOAD_TOO_LARGE_TYPE
  );
}

/**
 * Filter global : toute erreur sortante devient un payload RFC 7807.
 *
 * - `DomainError` → status dérivé du `code` ; `code` + `details` remontés.
 * - `HttpException` Nest (ValidationPipe, ParseUUIDPipe…) → status préservé,
 *   body normalisé.
 * - Corps trop volumineux (`raw-body`) → 413 (sinon il tomberait en 500).
 * - Tout le reste → 500 avec `detail` neutre : pas de leak de stack/SQL.
 *
 * Le `requestId` vient de l'AsyncLocalStorage — le client mobile peut le
 * remonter au support, et on retrouve la ligne de log correspondante.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception as Error;
    }

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<{ url?: string }>();

    const problem = this.buildProblem(exception, req.url);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, requestId: problem.requestId, url: req.url },
        problem.detail,
      );
    } else if (problem.status >= 400) {
      this.logger.warn(
        { code: problem.code, requestId: problem.requestId, url: req.url },
        problem.detail,
      );
    }

    res.status(problem.status).setHeader('content-type', PROBLEM_CONTENT_TYPE).json(problem);
  }

  private buildProblem(exception: unknown, url: string | undefined): ProblemDetails {
    const requestId = requestContext.getRequestId();

    if (exception instanceof DomainError) {
      const status = statusFromCode(exception.code);
      return {
        type: PROBLEM_TYPE,
        title: titleFromStatus(status),
        status,
        detail: exception.message,
        instance: url,
        code: exception.code,
        details: exception.details,
        requestId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        type: PROBLEM_TYPE,
        title: titleFromStatus(status),
        status,
        detail: this.extractDetail(exception.getResponse(), exception.message),
        instance: url,
        requestId,
      };
    }

    if (isPayloadTooLarge(exception)) {
      return {
        type: PROBLEM_TYPE,
        title: titleFromStatus(HttpStatus.PAYLOAD_TOO_LARGE),
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        detail: 'Request body exceeds the maximum accepted size.',
        instance: url,
        requestId,
      };
    }

    return {
      type: PROBLEM_TYPE,
      title: titleFromStatus(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'Internal server error',
      instance: url,
      requestId,
    };
  }

  private extractDetail(response: string | object, fallback: string): string {
    if (typeof response === 'string') return response;
    if ('message' in response) {
      const message: unknown = response.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.map(String).join('; ');
    }
    return fallback;
  }
}
