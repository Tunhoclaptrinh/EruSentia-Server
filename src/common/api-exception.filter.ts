import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { QueryFailedError } from "typeorm";
import { PolicyError } from "../service-controls/policy-error";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Pick<Logger, "error"> = new Logger(
      ApiExceptionFilter.name,
    ),
  ) {}

  catch(error: unknown, host: ArgumentsHost) {
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "An unexpected error occurred";
    let details: string[] = [];
    if (error instanceof HttpException) {
      status = error.getStatus();
      const response = error.getResponse();
      const body =
        typeof response === "string"
          ? { message: response }
          : (response as { message?: string | string[] });
      details = Array.isArray(body.message) ? body.message : [];
      message = details.length
        ? "Request validation failed"
        : String(body.message ?? error.message);
      code =
        (
          {
            400: "BAD_REQUEST",
            401: "UNAUTHORIZED",
            403: "FORBIDDEN",
            404: "NOT_FOUND",
            409: "CONFLICT",
            413: "PAYLOAD_TOO_LARGE",
            412: "PRECONDITION_FAILED",
            428: "PRECONDITION_REQUIRED",
            429: "RATE_LIMITED",
            503: "SERVICE_UNAVAILABLE",
          } as Record<number, string>
        )[status] ?? "HTTP_ERROR";
      if (error instanceof PolicyError) code = error.policyCode;
    } else if (error instanceof QueryFailedError) {
      const pgCode = (error.driverError as { code?: string }).code;
      if (pgCode === "23505") {
        status = 409;
        code = "CONFLICT";
        message = "Template slug already exists";
      } else if (pgCode === "23503") {
        status = 400;
        code = "INVALID_REFERENCE";
        message = "Author or category does not exist";
      }
    }
    const http = host.switchToHttp();
    const requestId =
      typeof http.getRequest().requestId === "string" &&
      /^[0-9a-f-]{36}$/.test(http.getRequest().requestId)
        ? http.getRequest().requestId
        : randomUUID();
    http.getResponse().setHeader("X-Request-Id", requestId);
    if (status >= 500) {
      message =
        status === 503
          ? "Service temporarily unavailable"
          : "An unexpected error occurred";
      details = [];
      // SQL errors, upstream messages and stack traces can contain private HTML or credentials.
      this.logger.error(
        JSON.stringify({ event: "api_error", status, code, requestId }),
      );
    }
    if (status === 429 && error instanceof HttpException) {
      const seconds = (error as HttpException & { retryAfter?: unknown })
        .retryAfter;
      if (
        typeof seconds === "number" &&
        Number.isInteger(seconds) &&
        seconds >= 1 &&
        seconds <= 900
      )
        http.getResponse().setHeader("Retry-After", String(seconds));
    }
    if (status === 401)
      http.getResponse().setHeader("WWW-Authenticate", "Bearer");
    http.getResponse().status(status).json({
      requestId,
      statusCode: status,
      code,
      message,
      details,
      path: http.getRequest().path,
      timestamp: new Date().toISOString(),
    });
  }
}
