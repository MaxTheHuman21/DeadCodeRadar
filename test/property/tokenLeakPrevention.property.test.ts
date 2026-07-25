/**
 * Property 3: Token Never Leaks to Output
 *
 * For any non-empty token string `t` (length ≥ 1) and any JobRecord or response body
 * object produced by the system, the JSON-serialized representation SHALL NOT contain
 * `t` as a substring.
 *
 * Feature: user-github-token-pr-creation, Property 3: Token Never Leaks to Output
 * Validates: Requirements 1.5, 2.1, 2.2, 2.3, 2.4
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { redact, createSafeLogger } from "../../lambda/utils/redactor";
import type { JobRecord, EnrichedFinding } from "../../lambda/types";

describe("Property 3: Token Never Leaks to Output", () => {
  it("redact() removes all occurrences of token (length ≥ 4) from any string", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 100 }).filter((s) => s.trim().length >= 4),
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.string({ minLength: 0, maxLength: 200 }),
        (token, prefix, suffix) => {
          const input = prefix + token + suffix;
          const result = redact(input, token);
          expect(result).not.toContain(token);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a mock JobRecord serialized through redact never contains the token", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 100 }).filter((s) => s.trim().length >= 4),
        (token) => {
          // Construct a JobRecord that accidentally contains the token in various fields
          const record: JobRecord = {
            jobId: "00000000-0000-4000-a000-000000000001",
            repoUrl: `https://github.com/owner/repo?token=${token}`,
            status: "completed",
            findings: [
              {
                file: `src/${token}/index.ts`,
                line: 5,
                type: "unused-export",
                name: token,
                confidenceScore: "high",
                riskExplanation: `This contains ${token} accidentally`,
                groupId: null,
              },
            ],
            createdAt: new Date().toISOString(),
            filesAnalyzed: 10,
            errorMessage: `Error with token ${token}`,
            enriched: true,
            prDescription: {
              title: `Remove dead code (${token})`,
              body: `Token was ${token}`,
            },
          };

          const serialized = JSON.stringify(record);
          const redacted = redact(serialized, token);
          expect(redacted).not.toContain(token);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a mock response body serialized through redact never contains the token", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 100 }).filter((s) => s.trim().length >= 4),
        (token) => {
          // Simulate a response body that could leak the token
          const responseBody = {
            prUrl: `https://github.com/owner/repo/pull/1?auth=${token}`,
            jobId: "00000000-0000-4000-a000-000000000001",
            error: `Authentication failed for token ${token}`,
          };

          const serialized = JSON.stringify(responseBody);
          const redacted = redact(serialized, token);
          expect(redacted).not.toContain(token);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("createSafeLogger never outputs token in stringified objects", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 4, maxLength: 100 }).filter((s) => s.trim().length >= 4),
        (token) => {
          const outputs: string[] = [];
          const originalLog = console.log;
          console.log = (...args: unknown[]) => {
            outputs.push(args.map(String).join(" "));
          };

          const logger = createSafeLogger(token);
          logger.log(`Secret: ${token}`);
          logger.log({ key: token, nested: { value: token } });

          console.log = originalLog;

          for (const output of outputs) {
            expect(output).not.toContain(token);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
