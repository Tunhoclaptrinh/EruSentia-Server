import { Injectable } from "@nestjs/common";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

@Injectable()
export class Passwords {
  // A valid dummy hash gives unknown accounts the same password-verification work.
  private readonly dummy = this.hash(randomBytes(32).toString("hex"));

  hash(password: string): Promise<string> {
    return hash(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
  }

  async verify(password: string, encoded?: string): Promise<boolean> {
    const supported = encoded?.startsWith("$argon2id$");
    try {
      const result = await verify(
        supported ? encoded! : await this.dummy,
        password,
      );
      return !!supported && result;
    } catch {
      // Week-1 seed hashes are placeholders, not valid login credentials.
      await verify(await this.dummy, password);
      return false;
    }
  }
}
