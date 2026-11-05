import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function setupOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("EruSentia Template API")
    .setDescription(
      "Register, log in, then paste accessToken into Authorize. Template routes require JWT. " +
        "The server derives authorId from the authenticated account. " +
        "Slugs remain reserved after soft deletion; choose a new slug when retrying POST.",
    )
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // A shared error schema must not show the 400 example for every status.
  const errorCodes: Record<string, string> = {
    "400": "BAD_REQUEST",
    "401": "UNAUTHORIZED",
    "403": "FORBIDDEN",
    "404": "NOT_FOUND",
    "409": "CONFLICT",
    "413": "PAYLOAD_TOO_LARGE",
    "412": "PRECONDITION_FAILED",
    "428": "PRECONDITION_REQUIRED",
    "500": "INTERNAL_ERROR",
  };
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const candidate of Object.values(operations)) {
      const operation = candidate as NonNullable<(typeof operations)["get"]>;
      if (
        !operation ||
        typeof operation !== "object" ||
        !("responses" in operation)
      )
        continue;
      for (const [status, response] of Object.entries(
        operation.responses ?? {},
      )) {
        if (!errorCodes[status] || !response || !("content" in response))
          continue;
        const json = response.content?.["application/json"];
        if (json)
          json.example = {
            statusCode: Number(status),
            code: errorCodes[status],
            message: errorCodes[status],
            details: [],
            path,
            timestamp: "2026-11-04T00:00:00.000Z",
          };
      }
    }
  }
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "docs-json",
    raw: ["json"],
    customSiteTitle: "EruSentia API Docs",
    swaggerOptions: { persistAuthorization: false, validatorUrl: null },
  });
}
