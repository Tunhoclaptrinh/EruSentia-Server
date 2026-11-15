import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { EntityManager } from "typeorm";
import { ADMIN_BATCH_LIMIT, CategoryImportRowDto } from "./dto/batch.dto";

export interface ImportIssue {
  row: number;
  field?: string;
  message: string;
}
const keys = new Set(["name", "slug", "description", "displayOrder"]);
export async function inspectCategoryImport(
  input: Record<string, unknown>[],
  reader: Pick<EntityManager, "query">,
) {
  if (
    !Array.isArray(input) ||
    !input.length ||
    input.length > ADMIN_BATCH_LIMIT
  )
    throw new BadRequestException("Mỗi lần nhập từ 1 đến 100 chuyên mục.");
  const issues: ImportIssue[] = [],
    rows: CategoryImportRowDto[] = [];
  const names = new Map<string, number>(),
    slugs = new Map<string, number>();
  for (let index = 0; index < input.length; index++) {
    const raw = input[index],
      row = index + 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push({ row, message: "Dòng dữ liệu phải là một bản ghi." });
      continue;
    }
    if (Object.keys(raw).some((key) => !keys.has(key))) {
      issues.push({
        row,
        message:
          "Chỉ hỗ trợ các cột name, slug, description, displayOrder. Hãy dùng tệp mẫu.",
      });
      continue;
    }
    let order = raw.displayOrder;
    if (order === undefined || order === "") order = 0;
    else if (typeof order === "string" && /^[0-9]+$/.test(order.trim()))
      order = Number(order.trim());
    const value = plainToInstance(CategoryImportRowDto, {
      name: raw.name,
      slug: raw.slug,
      description: raw.description ?? "",
      displayOrder: order,
    });
    const errors = await validate(value, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    for (const error of errors)
      issues.push({
        row,
        field: error.property,
        message:
          error.property === "slug"
            ? "Đường dẫn dài 1–64 ký tự, dùng chữ thường không dấu, số và dấu gạch ngang."
            : error.property === "displayOrder"
              ? "Thứ tự phải là số nguyên từ 0 đến 9999."
              : error.property === "name"
                ? "Tên chuyên mục phải có 1–64 ký tự."
                : "Mô tả tối đa 255 ký tự.",
      });
    if (errors.length) continue;
    for (const [field, map] of [
      ["name", names],
      ["slug", slugs],
    ] as const) {
      const previous = map.get(value[field]);
      if (previous)
        issues.push({
          row,
          field,
          message: `Trùng với dòng dữ liệu ${previous}.`,
        });
      else map.set(value[field], row);
    }
    rows.push(value);
  }
  if (!issues.length) {
    const existing: { name: string; slug: string }[] = await reader.query(
      "SELECT name,slug FROM categories WHERE name=ANY($1::text[]) OR slug=ANY($2::text[])",
      [rows.map((row) => row.name), rows.map((row) => row.slug)],
    );
    for (let index = 0; index < rows.length; index++)
      for (const field of ["name", "slug"] as const)
        if (existing.some((item) => item[field] === rows[index][field]))
          issues.push({
            row: index + 1,
            field,
            message:
              "Đã tồn tại trong hệ thống; chức năng nhập chỉ tạo chuyên mục mới.",
          });
  }
  return { rows, issues, inputCount: input.length };
}
