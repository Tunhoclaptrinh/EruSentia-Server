import { BadRequestException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import type { PageResult } from "../dto/pagination.dto";

export interface PageWindow {
  page: number;
  size: number;
  offset: number;
}

/** TypeORM PostgreSQL wraps UPDATE/DELETE results as [rows, affectedCount]. */
export async function queryRows<T>(
  manager: Pick<EntityManager, "query">,
  statement: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result: unknown = await manager.query(statement, values);
  if (!Array.isArray(result))
    throw new Error("Expected a PostgreSQL row result");
  return (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
      ? result[0]
      : result
  ) as T[];
}

export function pageWindow(query: {
  page?: number;
  size?: number;
}): PageWindow {
  const page = query.page ?? 1,
    size = query.size ?? 20;
  const offset = (page - 1) * size;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 100 ||
    !Number.isSafeInteger(offset)
  ) {
    throw new BadRequestException(
      "Invalid pagination: page must be a safe positive integer and size must be between 1 and 100",
    );
  }
  return { page, size, offset };
}

export function readPage<T, Extra extends object = Record<never, never>>(
  database: DataSource,
  query: { page?: number; size?: number },
  read: (
    manager: EntityManager,
    window: PageWindow,
  ) => Promise<{ data: T[]; total: number; extra?: Extra }>,
): Promise<PageResult<T> & Extra> {
  const window = pageWindow(query);
  return database.transaction("REPEATABLE READ", async (manager) => {
    const result = await read(manager, window);
    if (!Number.isSafeInteger(result.total) || result.total < 0)
      throw new Error("Invalid pagination total");
    return {
      ...result.extra,
      data: result.data,
      page: window.page,
      size: window.size,
      totalElements: result.total,
      totalPages: Math.ceil(result.total / window.size),
    } as PageResult<T> & Extra;
  });
}

/** PostgreSQL adaptation of the UniFlow service boundary; domain writes remain explicit. */
export abstract class BaseService {
  constructor(protected readonly dataSource: DataSource) {}

  protected rows<T>(
    manager: EntityManager,
    statement: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return queryRows<T>(manager, statement, values);
  }

  protected transaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(work);
  }

  protected snapshot<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction("REPEATABLE READ", work);
  }

  /** Count, rows and extra counters are read from the same database snapshot. */
  protected paginate<T, Extra extends object = Record<never, never>>(
    query: { page?: number; size?: number },
    read: (
      manager: EntityManager,
      window: PageWindow,
    ) => Promise<{ data: T[]; total: number; extra?: Extra }>,
  ): Promise<PageResult<T> & Extra> {
    return readPage(this.dataSource, query, read);
  }
}
