import { vi } from "vitest";

// server-only throws outside Next server bundles; stub for unit tests.
vi.mock("server-only", () => ({}));

// Deterministic 32-byte keys for field encryption / content_hash HMAC in tests.
if (!process.env.FIELD_ENCRYPTION_KEY) {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
}
if (!process.env.CONTENT_HASH_KEY) {
  process.env.CONTENT_HASH_KEY = Buffer.alloc(32, 8).toString("base64");
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}));
