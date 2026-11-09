import { Injectable } from "@nestjs/common";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
interface Request {
  method: string;
  requestId?: string;
  route?: { path?: unknown };
}
interface Response {
  statusCode: number;
  writableFinished: boolean;
  setHeader(name: string, value: string): void;
  once(name: string, listener: () => void): void;
}
interface Metric {
  requests: number;
  errors: number;
  aborted: number;
  totalMs: number;
  maxMs: number;
}
@Injectable()
export class ApiOperations {
  private readonly startedAt = new Date();
  private readonly metrics = new Map<string, Metric>();
  middleware() {
    return (request: Request, response: Response, next: () => void) => {
      // Always create a server ID. Incoming headers may contain private data or spoof another request.
      const requestId = randomUUID();
      request.requestId = requestId;
      response.setHeader("X-Request-Id", requestId);
      const start = performance.now();
      let recorded = false;
      const record = () => {
        if (recorded) return;
        recorded = true;
        const method = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"].includes(
          request.method,
        )
          ? request.method
          : "OTHER";
        const route =
          typeof request.route?.path === "string" &&
          /^\/[A-Za-z0-9_/:{}-]{0,120}$/.test(request.route.path)
            ? request.route.path
            : "unmatched";
        if (route === "/health") return;
        let key = method + " " + route;
        if (!this.metrics.has(key) && this.metrics.size >= 64)
          key = "OTHER overflow";
        const value = this.metrics.get(key) || {
            requests: 0,
            errors: 0,
            aborted: 0,
            totalMs: 0,
            maxMs: 0,
          },
          duration = Math.max(0, performance.now() - start);
        value.requests++;
        value.errors += response.statusCode >= 500 ? 1 : 0;
        value.aborted += response.writableFinished ? 0 : 1;
        value.totalMs += duration;
        value.maxMs = Math.max(value.maxMs, duration);
        this.metrics.set(key, value);
      };
      response.once("finish", record);
      response.once("close", record);
      next();
    };
  }
  snapshot() {
    return {
      scope: "process",
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      routes: [...this.metrics]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([route, v]) => ({
          route,
          requests: v.requests,
          serverErrors: v.errors,
          aborted: v.aborted,
          meanMs: Math.round(v.totalMs / v.requests),
          maxMs: Math.round(v.maxMs),
        })),
    };
  }
}
