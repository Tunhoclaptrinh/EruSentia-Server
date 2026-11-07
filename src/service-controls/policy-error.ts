import { HttpException } from "@nestjs/common";
export class PolicyError extends HttpException {
  constructor(
    readonly policyCode: "RATE_LIMITED" | "TEMPLATE_QUOTA_EXCEEDED",
    readonly retryAfter?: number,
  ) {
    super(
      policyCode === "RATE_LIMITED"
        ? "Too many requests; wait before trying again"
        : "Server template quota exceeded",
      policyCode === "RATE_LIMITED" ? 429 : 409,
    );
  }
}
