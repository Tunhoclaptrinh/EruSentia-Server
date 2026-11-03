import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function setupOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("EruSentia Template API")
    .setDescription(
      "Local Template management API. Authentication is not implemented yet. " +
        "Create a template first, then use its returned ID for read/update/delete. " +
        "Slugs remain reserved after soft deletion; choose a new slug when retrying POST.",
    )
    .setVersion("1.0.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "docs-json",
    raw: ["json"],
    customSiteTitle: "EruSentia API Docs",
    swaggerOptions: { persistAuthorization: false },
  });
}
