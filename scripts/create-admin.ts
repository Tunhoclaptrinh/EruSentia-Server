import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { RegisterDto } from "../src/auth/auth.dto";
import { Passwords } from "../src/auth/passwords";
import { dbPool } from "../src/infrastructure/database/postgres";

async function main() {
  try {
    const input = plainToInstance(RegisterDto, {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    if ((await validate(input)).length)
      throw new Error(
        "Set ADMIN_EMAIL to a valid email and ADMIN_PASSWORD to 12–128 characters",
      );
    const encoded = await new Passwords().hash(input.password);
    const result = await dbPool.query(
      "INSERT INTO users (email,password_hash,role) VALUES ($1,$2,'admin') RETURNING id,email,role",
      [input.email, encoded],
    );
    console.log("Admin created:", result.rows[0]);
  } catch (error) {
    console.error(
      "Admin creation failed:",
      (error as { code?: string }).code === "23505"
        ? "Email already exists; no account was modified"
        : error instanceof Error
          ? error.message
          : "Unknown error",
    );
    process.exitCode = 1;
  } finally {
    await dbPool.end();
  }
}
void main();
