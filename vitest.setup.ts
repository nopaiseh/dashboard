import { vi } from "vitest";

// server-only throws outside Next server bundles; stub for unit tests.
vi.mock("server-only", () => ({}));
