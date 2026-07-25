/**
 * Property 4: Redaction Completeness
 *
 * For any token string `t` of length ≥ 4 and for any input string `s` that contains `t`
 * as a substring, `redact(s, t)` SHALL produce output that does NOT contain `t` and
 * SHALL contain `[REDACTED]` at least once.
 *
 * Feature: user-github-token-pr-creation, Property 4: Redaction Completeness
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { redact } from "../../lambda/utils/redactor";

describe("Property 4: Redaction Completeness", () => {
  it("redact(s, t) removes all occurrences of t and contains [REDACTED] when t.length >= 4", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 100 }).filter((s) => s.trim().length >= 4),
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.string({ minLength: 0, maxLength: 100 }),
        (token, prefix, suffix) => {
          const input = prefix + token + suffix;
          const result = redact(input, token);

          // Output must not contain the token
          expect(result).not.toContain(token);
          // Output must contain [REDACTED] at least once
          expect(result).toContain("[REDACTED]");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("handles token appearing multiple times in the input", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 50 }).filter((s) => s.trim().length >= 4),
        fc.integer({ min: 2, max: 5 }),
        fc.string({ minLength: 0, maxLength: 30 }),
        (token, repetitions, separator) => {
          // Build input with multiple occurrences of the token
          const parts: string[] = [];
          for (let i = 0; i < repetitions; i++) {
            parts.push(token);
          }
          const input = parts.join(separator);
          const result = redact(input, token);

          // Output must not contain the token
          expect(result).not.toContain(token);
          // Output must contain [REDACTED] at least once
          expect(result).toContain("[REDACTED]");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("handles token at the very start of the input", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 50 }).filter((s) => s.trim().length >= 4),
        fc.string({ minLength: 1, maxLength: 100 }),
        (token, suffix) => {
          const input = token + suffix;
          const result = redact(input, token);

          expect(result).not.toContain(token);
          expect(result).toContain("[REDACTED]");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("handles token at the very end of the input", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 50 }).filter((s) => s.trim().length >= 4),
        fc.string({ minLength: 1, maxLength: 100 }),
        (token, prefix) => {
          const input = prefix + token;
          const result = redact(input, token);

          expect(result).not.toContain(token);
          expect(result).toContain("[REDACTED]");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("handles overlapping patterns (token contains repeated substrings)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 2, maxLength: 25 }).filter((s) => s.trim().length >= 2),
        fc.integer({ min: 2, max: 4 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        (base, repeats, surrounding) => {
          // Create a token from repeating a base string (e.g., "abab", "xyzxyz")
          const token = base.repeat(repeats);
          if (token.length < 4) return; // skip if too short

          const input = surrounding + token + surrounding;
          const result = redact(input, token);

          expect(result).not.toContain(token);
          expect(result).toContain("[REDACTED]");
        }
      ),
      { numRuns: 100 }
    );
  });
});
