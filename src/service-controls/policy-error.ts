import { HttpException } from "@nestjs/common";
const errors = {
  RATE_LIMITED: [429, "Too many requests; wait before trying again"],
  TEMPLATE_QUOTA_EXCEEDED: [409, "Server active template quota exceeded"],
  TEMPLATE_RETAINED_QUOTA_EXCEEDED: [
    409,
    "Server retained template/history quota exceeded",
  ],
  REPORT_QUOTA_EXCEEDED: [409, "Server retained report quota exceeded"],
  RESOURCE_UNDER_REVIEW: [
    409,
    "Resolve open reports before permanently deleting this resource",
  ],
  TEMPLATE_RESTRICTED: [403, "This template is restricted from publication"],
  PASSWORD_CONFIRMATION_FAILED: [403, "Password confirmation failed"],
} as const;
export class PolicyError extends HttpException {
  constructor(
    readonly policyCode: keyof typeof errors,
    readonly retryAfter?: number,
  ) {
    super(errors[policyCode][1], errors[policyCode][0]);
  }
}
