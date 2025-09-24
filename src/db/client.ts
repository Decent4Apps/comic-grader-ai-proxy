// src/db/client.ts
// DB disabled in this proxy-only build.
// Export no-op placeholders to satisfy any accidental imports.

export type DB = unknown;

export const db: DB = undefined as unknown as DB;

export async function sql<T = unknown>(_strings: TemplateStringsArray, ..._vals: any[]): Promise<T[]> {
  throw new Error("Database is disabled in this deployment.");
}

// If someone calls a drizzle-like API:
export const drizzle = (..._args: any[]) => {
  throw new Error("Database is disabled in this deployment.");
};
