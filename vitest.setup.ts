import { vi } from "vitest";

// server-only throws outside Next server bundles; stub for unit tests.
vi.mock("server-only", () => ({}));

// Deterministic 32-byte key for any code path that encrypts item fields in tests.
if (!process.env.FIELD_ENCRYPTION_KEY) {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}));
