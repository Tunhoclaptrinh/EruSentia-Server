import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function setupOpenApi(app: INestApplication) {
  // Serve the executable guide beside the API so requests work with the same origin.
  for (const [route, filename] of Object.entries({
    '/docs/week-6': 'WEEK_6_TECHNICAL_REPORT.html',
    '/docs/tools/api-explorer': 'API_EXPLORER.html',
    '/docs/tools/notifications': 'NOTIFICATION_FEED.html',
  })) {
    app.getHttpAdapter().get(route, async (_request: IncomingMessage, response: ServerResponse) => {
      try {
        const html = await readFile(resolve(process.cwd(), 'docs', filename), 'utf8');
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cache-Control', 'no-store');
        response.end(html);
      } catch {
        response.statusCode = 404;
        response.end('Guide unavailable. Generate the API tool documents from the app repository.');
      }
    });
  }
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
