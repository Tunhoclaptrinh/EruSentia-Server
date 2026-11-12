export interface TemplatePublishedEvent {
  templateId: string;
  revision: number;
  title: string;
  version: string;
  isPublic: boolean;
  actorId: string;
  authorId: string;
  slug: string;
  occurredAt: string;
}

export function parseTemplatePublishedEvent(
  content: Buffer,
): TemplatePublishedEvent {
  const json = JSON.parse(content.toString("utf8"));
  if (
    !json ||
    typeof json !== "object" ||
    typeof json.templateId !== "string" ||
    typeof json.revision !== "number" ||
    typeof json.title !== "string"
  ) {
    throw new Error("Invalid template published event payload");
  }
  return json as TemplatePublishedEvent;
}

