import { PolicyError } from "../service-controls/policy-error";
import type { ServiceControlSettings } from "../service-controls/settings";
export interface TemplateUsage {
  templates: number;
  contentBytes: number;
}
export function assertTemplateQuota(
  settings: ServiceControlSettings,
  used: TemplateUsage,
  before: TemplateUsage,
  after: TemplateUsage,
) {
  // Existing accounts above a lowered limit can still shrink, delete or edit metadata.
  const count = used.templates - before.templates + after.templates,
    bytes = used.contentBytes - before.contentBytes + after.contentBytes;
  if (
    (count > settings.maxTemplates && count > used.templates) ||
    (bytes > settings.maxContentBytes && bytes > used.contentBytes)
  )
    throw new PolicyError("TEMPLATE_QUOTA_EXCEEDED");
}
export function contentBytes(content: unknown) {
  return Buffer.byteLength(JSON.stringify(content), "utf8");
}

export interface RetainedUsage {
  templates: number;
  revisions: number;
  contentBytes: number;
}
export function retainedLimits(
  settings: ServiceControlSettings,
): RetainedUsage {
  return {
    templates: settings.maxRetainedTemplates,
    revisions: settings.maxRetainedRevisions,
    contentBytes: settings.maxRetainedBytes,
  };
}
export function assertRetainedQuota(
  settings: ServiceControlSettings,
  before: RetainedUsage,
  after: RetainedUsage,
) {
  const limits = retainedLimits(settings);
  for (const key of ["templates", "revisions", "contentBytes"] as const)
    if (after[key] > limits[key] && after[key] > before[key])
      throw new PolicyError("TEMPLATE_RETAINED_QUOTA_EXCEEDED");
}
