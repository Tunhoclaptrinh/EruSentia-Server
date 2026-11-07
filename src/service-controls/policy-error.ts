import { HttpException } from "@nestjs/common";
export class PolicyError extends HttpException {
  constructor(
    readonly policyCode:
      "RATE_LIMITED" | "TEMPLATE_QUOTA_EXCEEDED" | "TEMPLATE_RESTRICTED",
    readonly retryAfter?: number,
  ) {
    super(
      policyCode === "RATE_LIMITED"
        ? "Too many requests; wait before trying again"
        : policyCode === "TEMPLATE_RESTRICTED"
          ? "This template is restricted from publication"
          : "Server template quota exceeded",
      policyCode === "RATE_LIMITED"
        ? 429
        : policyCode === "TEMPLATE_RESTRICTED"
          ? 403
          : 409,
    );
  }
}
