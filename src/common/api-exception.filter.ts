import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { QueryFailedError } from "typeorm";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

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
          } as Record<number, string>
        )[status] ?? "HTTP_ERROR";
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
    if (status >= 500)
      this.logger.error(
        error instanceof Error ? error.message : "Unknown error",
      );
    const http = host.switchToHttp();
    if (status === 401)
      http.getResponse().setHeader("WWW-Authenticate", "Bearer");
    http.getResponse().status(status).json({
      statusCode: status,
      code,
      message,
      details,
      path: http.getRequest().path,
      timestamp: new Date().toISOString(),
    });
  }
}
