import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

// PostgreSQL UUID syntax; also accepts the deterministic week-1 seed UUIDs,
// whose version/variant bits are not RFC-generated UUIDv4 bits.
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!UUID_PATTERN.test(value))
      throw new BadRequestException("id must use UUID syntax");
    return value.toLowerCase();
  }
}
