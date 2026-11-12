import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  BadGatewayException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ResourceSettings } from "./resource-settings";
import type { ResourceRequestDto } from "./resource.dto";
const forbidden =
  /^(authorization-proxy|x-eru-gateway-key|host|connection|cookie|set-cookie|proxy-.*|sec-.*|origin|referer|transfer-encoding|accept-encoding|content-length|upgrade|te|trailer)$/i;
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as [string, number][])
  blocked.addSubnet(address, prefix, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const blocked6 = new BlockList();
blocked6.addSubnet("2001::", 23, "ipv6");
blocked6.addSubnet("2001:db8::", 32, "ipv6");
blocked6.addSubnet("2002::", 16, "ipv6");
export function isPublicResourceAddress(address: string) {
  return isIP(address) === 4
    ? !blocked.check(address, "ipv4")
    : isIP(address) === 6 &&
        global6.check(address, "ipv6") &&
        !blocked6.check(address, "ipv6");
}
export async function relayResource(
  input: ResourceRequestDto,
  settings: ResourceSettings,
  signal?: AbortSignal,
) {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new BadRequestException("INVALID_RESOURCE_URL");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(settings.allowLocalTargets && url.protocol === "http:")) ||
    !settings.targetOrigins.includes(url.origin)
  )
    throw new ForbiddenException("RESOURCE_TARGET_NOT_ALLOWED");
  let decoded = url.pathname;
  try {
    for (let i = 0; i < 3; i++) decoded = decodeURIComponent(decoded);
  } catch {
    throw new BadRequestException("INVALID_RESOURCE_PATH");
  }
  if (
    /\/(resource-gateway|resource-documents|admin)(\/|$)/i.test(decoded) ||
    decoded.includes("\\")
  )
    throw new ForbiddenException("RESOURCE_TARGET_PATH_NOT_ALLOWED");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true });
  } catch {
    throw new BadGatewayException("RESOURCE_UPSTREAM_DNS_UNAVAILABLE");
  }
  if (
    !addresses.length ||
    (!settings.allowLocalTargets &&
      addresses.some((item) => !isPublicResourceAddress(item.address)))
  )
    throw new ForbiddenException("RESOURCE_PRIVATE_ADDRESS_BLOCKED");
  const headers: Record<string, string> = { "Accept-Encoding": "identity" };
  if (Object.keys(input.headers || {}).length > 30)
    throw new BadRequestException("TOO_MANY_RESOURCE_HEADERS");
  for (const [name, value] of Object.entries(input.headers || {})) {
    if (
      forbidden.test(name) ||
      typeof value !== "string" ||
      value.length > 8192 ||
      /[\r\n]/.test(value) ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
    )
      throw new BadRequestException("RESOURCE_HEADER_NOT_ALLOWED");
    headers[name] = value;
  }
  if (input.body && Buffer.byteLength(input.body, "utf8") > 524288)
    throw new PayloadTooLargeException("RESOURCE_REQUEST_TOO_LARGE");
  if (["GET", "HEAD"].includes(input.method) && input.body)
    throw new BadRequestException("RESOURCE_BODY_NOT_ALLOWED");
  return new Promise<{
    version: number;
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyBase64: string;
  }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: input.method,
        headers,
        lookup: (_host, options, callback) =>
          options?.all
            ? callback(null, addresses)
            : callback(null, addresses[0].address, addresses[0].family),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            request.destroy(
              new PayloadTooLargeException("RESOURCE_RESPONSE_TOO_LARGE"),
            );
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          if (
            [301, 302, 303, 307, 308].includes(response.statusCode || 0) &&
            response.headers.location
          ) {
            reject(new BadGatewayException("RESOURCE_REDIRECT_BLOCKED"));
            return;
          }
          const safeHeaders = Object.fromEntries(
            Object.entries(response.headers)
              .filter(
                ([name, value]) => !forbidden.test(name) && value !== undefined,
              )
              .map(([name, value]) => [
                name,
                Array.isArray(value) ? value.join(", ") : String(value),
              ]),
          );
          resolve({
            version: 1,
            url: url.href,
            status: response.statusCode || 502,
            statusText: response.statusMessage || "",
            headers: safeHeaders,
            bodyBase64: Buffer.concat(chunks).toString("base64"),
          });
        });
      },
    );
    const timer = setTimeout(
      () =>
        request.destroy(
          new GatewayTimeoutException("RESOURCE_UPSTREAM_TIMEOUT"),
        ),
      12000,
    );
    const abort = () =>
      request.destroy(new BadGatewayException("RESOURCE_REQUEST_ABORTED"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    request.on("close", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    });
    request.on("error", (error) =>
      reject(
        "getStatus" in error
          ? error
          : new BadGatewayException("RESOURCE_UPSTREAM_UNAVAILABLE"),
      ),
    );
    if (input.body) request.write(input.body);
    request.end();
  });
}
