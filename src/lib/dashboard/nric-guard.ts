/**
 * Singapore NRIC / FIN (CPF account number equals NRIC).
 * Word-boundary aware so currency like "S$1234" and bare years are not matched.
 * Never log a matched value — callers must only log a generic reason.
 */
const SINGAPORE_NRIC_OR_FIN = /\b[STFGM]\d{7}[A-Z]\b/i;

/**
 * Recursively scan strings (values and object keys) for NRIC/FIN patterns.
 */
export function containsSingaporeNricOrFin(value: unknown): boolean {
  const seen = new WeakSet<object>();

  function walk(node: unknown): boolean {
    if (typeof node === "string") {
      return SINGAPORE_NRIC_OR_FIN.test(node);
    }
    if (node === null || typeof node !== "object") {
      return false;
    }
    if (seen.has(node)) {
      return false;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        if (walk(item)) return true;
      }
      return false;
    }

    for (const [key, child] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (SINGAPORE_NRIC_OR_FIN.test(key)) return true;
      if (walk(child)) return true;
    }
    return false;
  }

  return walk(value);
}
