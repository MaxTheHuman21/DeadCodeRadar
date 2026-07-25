/**
 * GitHub API orchestrator for PR creation.
 * Creates a branch, commits file deletions via the Trees API, and opens a Pull Request.
 */

export interface PrCreationInput {
  token: string;
  owner: string;
  repo: string;
  jobId: string;
  filesToDelete: string[];
  prTitle: string;
  prBody: string;
}

export interface PrCreationResult {
  prUrl: string;
  branchName: string;
}

const GITHUB_API = "https://api.github.com";
const TIMEOUT_MS = 30_000;

/**
 * Makes a GitHub API request with standard headers and 30s timeout.
 */
async function githubFetch(
  url: string,
  token: string,
  options: { method?: string; body?: object } = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "DeadCode-Radar",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new Error(
      isAbort
        ? "GitHub API request timed out after 30 seconds"
        : `Network error contacting GitHub API: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Creates a branch, commits file deletions, and opens a PR.
 * Branch name: deadcode-radar/cleanup-{first 8 chars of jobId}
 */
export async function createPullRequest(
  input: PrCreationInput
): Promise<PrCreationResult> {
  const { token, owner, repo, jobId, filesToDelete, prTitle, prBody } = input;
  const branchName = `deadcode-radar/cleanup-${jobId.slice(0, 8)}`;

  // Step 1: Get default branch name and its SHA
  const repoResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}`,
    token
  );

  if (repoResponse.status === 403) {
    throw new Error(
      "Repository access denied — ensure your token has write access to this repository"
    );
  }
  if (!repoResponse.ok) {
    throw new Error(
      `Failed to fetch repository info: GitHub returned ${repoResponse.status}`
    );
  }

  const repoData = (await repoResponse.json()) as { default_branch: string };
  const defaultBranch = repoData.default_branch;

  // Get the SHA of the default branch
  const refResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
    token
  );

  if (refResponse.status === 403) {
    throw new Error(
      "Branch access denied — ensure your token has write access to this repository"
    );
  }
  if (!refResponse.ok) {
    throw new Error(
      `Failed to get default branch ref: GitHub returned ${refResponse.status}`
    );
  }

  const refData = (await refResponse.json()) as {
    object: { sha: string };
  };
  const defaultBranchSha = refData.object.sha;

  // Step 2: Create new branch from default branch
  const createBranchResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/refs`,
    token,
    {
      method: "POST",
      body: {
        ref: `refs/heads/${branchName}`,
        sha: defaultBranchSha,
      },
    }
  );

  if (createBranchResponse.status === 403) {
    throw new Error(
      "Cannot create branch — ensure your token has write access to this repository"
    );
  }
  if (!createBranchResponse.ok) {
    throw new Error(
      `Failed to create branch: GitHub returned ${createBranchResponse.status}`
    );
  }

  // Step 3: Delete files in a single commit using Trees API

  // Get base tree SHA from the commit
  const commitResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/commits/${defaultBranchSha}`,
    token
  );

  if (!commitResponse.ok) {
    throw new Error(
      `Failed to get base commit: GitHub returned ${commitResponse.status}`
    );
  }

  const commitData = (await commitResponse.json()) as {
    tree: { sha: string };
  };
  const baseTreeSha = commitData.tree.sha;

  // Create new tree with deletions (sha: null removes a file)
  const treeItems = filesToDelete.map((filePath) => ({
    path: filePath,
    mode: "100644" as const,
    type: "blob" as const,
    sha: null,
  }));

  const createTreeResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees`,
    token,
    {
      method: "POST",
      body: {
        base_tree: baseTreeSha,
        tree: treeItems,
      },
    }
  );

  if (createTreeResponse.status === 403) {
    throw new Error(
      "Cannot modify repository tree — ensure your token has write access to this repository"
    );
  }
  if (!createTreeResponse.ok) {
    throw new Error(
      `Failed to create tree: GitHub returned ${createTreeResponse.status}`
    );
  }

  const treeData = (await createTreeResponse.json()) as { sha: string };
  const newTreeSha = treeData.sha;

  // Create commit
  const createCommitResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/commits`,
    token,
    {
      method: "POST",
      body: {
        message: `chore: remove dead code files\n\nRemoves ${filesToDelete.length} file(s) identified as dead code by DeadCode Radar.`,
        tree: newTreeSha,
        parents: [defaultBranchSha],
      },
    }
  );

  if (createCommitResponse.status === 403) {
    throw new Error(
      "Cannot create commit — ensure your token has write access to this repository"
    );
  }
  if (!createCommitResponse.ok) {
    throw new Error(
      `Failed to create commit: GitHub returned ${createCommitResponse.status}`
    );
  }

  const newCommitData = (await createCommitResponse.json()) as { sha: string };
  const newCommitSha = newCommitData.sha;

  // Update branch ref to point to new commit
  const updateRefResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branchName}`,
    token,
    {
      method: "PATCH",
      body: {
        sha: newCommitSha,
      },
    }
  );

  if (updateRefResponse.status === 403) {
    throw new Error(
      "Cannot update branch ref — ensure your token has write access to this repository"
    );
  }
  if (!updateRefResponse.ok) {
    throw new Error(
      `Failed to update branch ref: GitHub returned ${updateRefResponse.status}`
    );
  }

  // Step 4: Open Pull Request
  const createPrResponse = await githubFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls`,
    token,
    {
      method: "POST",
      body: {
        head: branchName,
        base: defaultBranch,
        title: prTitle,
        body: prBody,
      },
    }
  );

  if (createPrResponse.status === 403) {
    throw new Error(
      "Cannot create pull request — ensure your token has write access to this repository"
    );
  }
  if (!createPrResponse.ok) {
    throw new Error(
      `Failed to create pull request: GitHub returned ${createPrResponse.status}`
    );
  }

  const prData = (await createPrResponse.json()) as { html_url: string };

  return {
    prUrl: prData.html_url,
    branchName,
  };
}
