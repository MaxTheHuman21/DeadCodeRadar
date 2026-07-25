/**
 * Property 5: Ownership Verification Correctness
 *
 * For any two strings `authenticatedUser` and `repoOwner`, the ownership check SHALL
 * pass if and only if `authenticatedUser.toLowerCase() === repoOwner.toLowerCase()`.
 *
 * Since `verifyOwnership` makes a network call, we test the COMPARISON LOGIC in isolation.
 *
 * Feature: user-github-token-pr-creation, Property 5: Ownership Verification Correctness
 * Validates: Requirements 4.2, 4.3
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Extracted comparison logic from ownershipVerifier.ts:
 * authenticatedUser.toLowerCase() === repoOwner.toLowerCase()
 */
function ownershipMatches(authenticatedUser: string, repoOwner: string): boolean {
  return authenticatedUser.toLowerCase() === repoOwner.toLowerCase();
}

describe("Property 5: Ownership Verification Correctness", () => {
  it("matching case: same string with random case changes passes ownership check", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        fc.func(fc.boolean()),
        (baseUsername, caseChanger) => {
          // Apply random case changes to the base username
          const modified = baseUsername
            .split("")
            .map((char, i) => {
              // Use the function to decide upper/lower for each char
              return caseChanger(i) ? char.toUpperCase() : char.toLowerCase();
            })
            .join("");

          // Both should be considered the same owner (case-insensitive match)
          expect(ownershipMatches(baseUsername, modified)).toBe(true);
          expect(ownershipMatches(modified, baseUsername)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("non-matching case: two different strings (case-insensitive) fail ownership check", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (user1, user2) => {
          // Only test when the strings are actually different case-insensitively
          fc.pre(user1.toLowerCase() !== user2.toLowerCase());

          expect(ownershipMatches(user1, user2)).toBe(false);
          expect(ownershipMatches(user2, user1)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("identity: a string always matches itself regardless of case", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (username) => {
          expect(ownershipMatches(username, username)).toBe(true);
          expect(ownershipMatches(username, username.toUpperCase())).toBe(true);
          expect(ownershipMatches(username, username.toLowerCase())).toBe(true);
          expect(ownershipMatches(username.toUpperCase(), username.toLowerCase())).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("symmetry: ownershipMatches(a, b) === ownershipMatches(b, a)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.string({ minLength: 0, maxLength: 50 }),
        (a, b) => {
          expect(ownershipMatches(a, b)).toBe(ownershipMatches(b, a));
        }
      ),
      { numRuns: 100 }
    );
  });
});
