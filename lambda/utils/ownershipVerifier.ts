/**
 * Ownership verification utility.
 * Verifies the authenticated GitHub user owns the target repository
 * by calling GitHub's GET /user endpoint with the provided token.
 */

export interface OwnershipResult {
  verified: boolean;
  authenticatedUser?: string;
  error?: { statusCode: 401 | 403 | 502; message: string };
}

/**
 * Calls GitHub GET /user with the provided token and compares
 * the authenticated username to the repo owner (case-insensitive).
 * Timeout: 10 seconds via AbortController.
 */
export async function verifyOwnership(
  token: string,
  repoOwner: string
): Promise<OwnershipResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "DeadCode-Radar",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      return {
        verified: false,
        error: {
          statusCode: 401,
          message: "The provided token is invalid or has been revoked",
        },
      };
    }

    if (!response.ok) {
      return {
        verified: false,
        error: {
          statusCode: 502,
          message: `GitHub API returned unexpected status ${response.status}`,
        },
      };
    }

    const data = (await response.json()) as { login?: string };
    const authenticatedUser = data.login ?? "";

    if (authenticatedUser.toLowerCase() === repoOwner.toLowerCase()) {
      return {
        verified: true,
        authenticatedUser,
      };
    }

    return {
      verified: false,
      error: {
        statusCode: 403,
        message: `Authenticated user "${authenticatedUser}" does not own repository owned by "${repoOwner}"`,
      },
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    const isAbort =
      err instanceof Error && err.name === "AbortError";
    const message = isAbort
      ? "GitHub API request timed out after 10 seconds"
      : `Network error contacting GitHub API: ${err instanceof Error ? err.message : String(err)}`;

    return {
      verified: false,
      error: {
        statusCode: 502,
        message,
      },
    };
  }
}
