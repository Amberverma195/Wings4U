import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";

function mapStatusToCode(status: number): string {
  switch (status) {
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "VALIDATION_FAILED";
    case 429:
      return "RATE_LIMITED";
    default:
      return "VALIDATION_FAILED";
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.requestId ?? randomUUID();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resBody = exception.getResponse();
      const payload =
        typeof resBody === "string"
          ? { message: resBody }
          : (resBody as Record<string, unknown>);
      const message = payload["message"];
      const explicitCode =
        typeof payload["code"] === "string" ? payload["code"] : undefined;
      const field = payload["field"] as string | undefined;
      const errors = Array.isArray(message)
        ? message.map((m) => ({
            code: explicitCode ?? mapStatusToCode(status),
            message: String(m)
          }))
        : [
            {
              code: explicitCode ?? mapStatusToCode(status),
              message: typeof message === "string" ? message : "Request failed",
              ...(field ? { field } : {})
            }
          ];
      response.status(status).json({
        data: null,
        meta: { request_id: requestId },
        errors
      });
      return;
    }

    // Surface the actual cause in the server log — otherwise the generic
    // INTERNAL_ERROR body makes debugging impossible.
    const err = exception as Error & { code?: string };
    this.logger.error(
      `Unhandled error for ${request.method} ${request.originalUrl} ` +
        `(request_id=${requestId})${err?.code ? ` code=${err.code}` : ""}: ` +
        (err?.message ?? String(exception)),
      err?.stack,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      data: null,
      meta: { request_id: requestId },
      errors: [{ code: "INTERNAL_ERROR", message: "Internal server error" }]
    });
  }
}
