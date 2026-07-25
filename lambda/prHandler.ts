/**
 * Handler for the /pr endpoint.
 * Orchestrates PR creation: validates input, verifies ownership,
 * filters eligible files, and delegates to prCreator.
 */

import { LambdaEvent, LambdaResponse, EnrichedFinding, JobRecord } from "./types";
import { getResult } from "./persistence";
import { validateJobId, isValidJson, validateRepoUrl } from "./validators";
import { validateUserToken } from "./utils/tokenResolver";
import { createSafeLogger } from "./utils/redactor";
import { verifyOwnership } from "./utils/ownershipVerifier";
import { createPullRequest } from "./prCreator";

/**
 * Builds a standard JSON response.
 */
function buildResponse(statusCode: number, body: object): LambdaResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Determines which files are eligible for deletion in the PR.
 *
 * A file is eligible if:
 *   (a) It has at least one finding with type "unused-file" and confidenceScore "high", OR
 *   (b) ALL findings for that file are type "unused-export" with confidenceScore "high"
 *       AND they all share the same non-null groupId.
 */
export function getFilesToDelete(findings: EnrichedFinding[]): string[] {
  // Group findings by file
  const byFile = new Map<string, EnrichedFinding[]>();
  for (const f of findings) {
    const group = byFile.get(f.file) ?? [];
    group.push(f);
    byFile.set(f.file, group);
  }

  const eligible: string[] = [];

  for (const [file, fileFindings] of byFile) {
    // Case (a): explicit unused-file with high confidence
    const hasUnusedFileHigh = fileFindings.some(
      (f) => f.type === "unused-file" && f.confidenceScore === "high"
    );
    if (hasUnusedFileHigh) {
      eligible.push(file);
      continue;
    }

    // Case (b): ALL findings are unused-export + high + same non-null groupId
    const allHighExports = fileFindings.every(
      (f) => f.type === "unused-export" && f.confidenceScore === "high"
    );
    if (!allHighExports || fileFindings.length === 0) continue;

    const firstGroupId = fileFindings[0].groupId;
    if (firstGroupId === null) continue;

    const allSameGroup = fileFindings.every((f) => f.groupId === firstGroupId);
    if (allSameGroup) {
      eligible.push(file);
    }
  }

  return eligible;
}

/**
 * Handles POST /pr requests for PR creation.
 */
export async function handlePrCreation(
  event: LambdaEvent
): Promise<LambdaResponse> {
  // 1. Validate JSON body
  if (!event.body || !isValidJson(event.body)) {
    return buildResponse(400, { error: "Request body must be valid JSON" });
  }

  // 2. Parse body, extract fields
  const parsed = JSON.parse(event.body);
  const { jobId, userGithubToken } = parsed;

  // 3. Validate jobId
  if (!jobId || !validateJobId(jobId)) {
    return buildResponse(400, {
      error: "jobId is required and must be a valid UUID v4",
    });
  }

  // 4. Validate userGithubToken with validateUserToken
  const tokenValidationError = validateUserToken(userGithubToken);
  if (tokenValidationError) {
    return buildResponse(400, { error: tokenValidationError });
  }

  // 5. Check token is truthy and non-whitespace after trim
  if (
    !userGithubToken ||
    typeof userGithubToken !== "string" ||
    userGithubToken.trim().length === 0
  ) {
    return buildResponse(400, {
      error: "userGithubToken is required and must not be empty",
    });
  }

  // 6. Create safe logger
  const logger = createSafeLogger(userGithubToken);

  try {
    // 7. Get JobRecord from DynamoDB
    const record = await getResult(jobId);
    if (!record || record.status !== "completed") {
      return buildResponse(404, {
        error: "No completed analysis found for the provided jobId",
      });
    }

    // 8. Extract owner/repo from repoUrl
    const repoValidation = validateRepoUrl(record.repoUrl);
    if (!repoValidation.valid || !repoValidation.owner || !repoValidation.repo) {
      return buildResponse(502, {
        error: "Failed to parse repository information from stored job",
      });
    }

    const { owner, repo } = repoValidation;

    // 9. Verify ownership
    const ownershipResult = await verifyOwnership(userGithubToken, owner);
    if (!ownershipResult.verified) {
      const errorCode = ownershipResult.error?.statusCode ?? 502;
      const errorMessage = ownershipResult.error?.message ?? "Ownership verification failed";
      return buildResponse(errorCode, { error: errorMessage });
    }

    // 10-11. Get files to delete and validate
    const filesToDelete = getFilesToDelete(record.findings);
    if (filesToDelete.length === 0 || !record.prDescription) {
      return buildResponse(422, {
        error:
          "No eligible files for deletion or PR description not available",
      });
    }

    // 12. Create Pull Request
    const result = await createPullRequest({
      token: userGithubToken,
      owner,
      repo,
      jobId,
      filesToDelete,
      prTitle: record.prDescription.title,
      prBody: record.prDescription.body,
    });

    // 13. Return 201 with prUrl and jobId
    return buildResponse(201, { prUrl: result.prUrl, jobId });
  } catch (error: unknown) {
    const errMessage =
      error instanceof Error ? error.message : String(error);

    // Log error safely (token redacted)
    logger.error(
      JSON.stringify({
        level: "ERROR",
        context: "prHandler",
        jobId,
        message: errMessage,
      })
    );

    // 14. Map errors
    if (errMessage.includes("write access")) {
      return buildResponse(403, {
        error: "Your token does not have write access to this repository",
      });
    }

    return buildResponse(502, {
      error: "An error occurred while communicating with GitHub",
    });
  }
}
