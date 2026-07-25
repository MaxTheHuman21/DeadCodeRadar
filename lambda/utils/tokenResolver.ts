/**
 * Token resolution and validation utilities.
 * Determines which GitHub token to use (user-provided vs environment)
 * and validates user token constraints.
 */

/**
 * Resolves which GitHub token to use.
 * Returns userToken (trimmed) if it's a non-null, non-empty, non-whitespace-only string
 * with length ≤ 255. Otherwise returns the environment token.
 */
export function resolveToken(
  userToken: string | null | undefined,
  envToken: string
): { token: string; source: "user" | "env" } {
  if (
    typeof userToken === "string" &&
    userToken.trim().length > 0 &&
    userToken.length <= 255
  ) {
    return { token: userToken.trim(), source: "user" };
  }

  return { token: envToken, source: "env" };
}

/**
 * Validates the userGithubToken field constraints.
 * Returns an error message if the token is invalid, or null if valid/absent.
 *
 * Rules:
 * - null, undefined, or empty string → valid (absent token)
 * - string exceeding 255 characters → error
 * - any other type that is not a string → error
 * - valid non-empty string ≤ 255 → valid
 */
export function validateUserToken(token: unknown): string | null {
  if (token === null || token === undefined) {
    return null;
  }

  if (typeof token !== "string") {
    return "userGithubToken must be a string";
  }

  if (token === "") {
    return null;
  }

  if (token.length > 255) {
    return "userGithubToken must be at most 255 characters";
  }

  return null;
}
