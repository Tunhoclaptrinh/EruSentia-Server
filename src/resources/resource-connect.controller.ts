import { Controller, Get, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import { Public } from "../auth/auth.guards";
@Public()
@ApiExcludeController()
@Controller("resource-gateway")
export class ResourceConnectController {
  @Get("connect") async page(@Res() response: ServerResponse) {
    const nonce = randomBytes(18).toString("base64");
    const html = await readFile(
      resolve(process.cwd(), "public/resource-connect.html"),
      "utf8",
    );
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'`,
    );
    response.end(html.replace("__ERU_NONCE__", nonce));
  }
}
