# Requirements Document

## Introduction

This feature enables any user to create a Pull Request in their own GitHub repository to remove dead code identified by DeadCode Radar. Users provide their personal GitHub token at analysis time, which is used for both repository download and PR creation. The token is never persisted or logged — it exists only in memory during a single Lambda invocation and in React state on the frontend.

## Glossary

- **Analysis_Endpoint**: The existing POST Lambda Function URL that accepts a `repoUrl` and performs dead code analysis
- **PR_Endpoint**: A new Lambda endpoint (or extension of the Analysis_Endpoint) that creates a Pull Request on the user's repository
- **User_Token**: A GitHub Personal Access Token provided by the user with `repo` scope, used for GitHub API operations
- **Env_Token**: The `GITHUB_TOKEN` environment variable configured on the Lambda, used as a fallback for public read-only access
- **Token_Input**: The collapsible UI field in the frontend where users enter their GitHub Personal Access Token
- **PR_Button**: The button in the PrCard component that triggers PR creation
- **Owner_Verification**: The process of calling GitHub's `GET /user` API with the User_Token to confirm the authenticated user matches the repository owner
- **Job_Record**: The DynamoDB item storing analysis results for a given jobId
- **Findings**: The list of dead code detections produced by the analysis engine
- **High_Confidence_Findings**: Findings with a `confidenceScore` of "high", eligible for automated deletion in the PR

## Requirements

### Requirement 1: Accept Optional User Token in Analysis Request

**User Story:** As a user, I want to provide my GitHub token when submitting a repository for analysis, so that I can use my own rate limits and access permissions for the download step.

#### Acceptance Criteria

1. WHEN a POST request is received with a `userGithubToken` field containing a non-empty string in the JSON body, THE Analysis_Endpoint SHALL use the User_Token for all GitHub API operations during that invocation
2. WHEN a POST request is received without a `userGithubToken` field, or with a `userGithubToken` field that is empty, null, or contains only whitespace, THE Analysis_Endpoint SHALL use the Env_Token for GitHub API operations
3. THE Analysis_Endpoint SHALL accept the `userGithubToken` field as an optional string of at most 255 characters alongside the existing `repoUrl` field
4. IF the User_Token is rejected by GitHub API with an authentication or authorization error, THEN THE Analysis_Endpoint SHALL return an error response indicating that the provided token is invalid or lacks sufficient permissions, without falling back to the Env_Token
5. THE Analysis_Endpoint SHALL NOT persist or include the User_Token value in any stored job record or error response body

### Requirement 2: Token Security — No Persistence

**User Story:** As a user, I want assurance that my GitHub token is never stored in any database, so that my credentials remain secure.

#### Acceptance Criteria

1. WHEN the Analysis_Endpoint receives a request containing a User_Token, THE Analysis_Endpoint SHALL use the User_Token only in-memory for GitHub API calls during the request lifecycle and SHALL exclude the User_Token from all DynamoDB write operations, ensuring no attribute in the persisted Job_Record contains the token value
2. WHEN the PR_Endpoint receives a request containing a User_Token, THE PR_Endpoint SHALL use the User_Token only in-memory for GitHub API calls during the request lifecycle and SHALL exclude the User_Token from all DynamoDB write operations, ensuring no attribute in the persisted record contains the token value
3. THE Analysis_Endpoint SHALL NOT include the User_Token in any HTTP response body returned to the caller
4. THE PR_Endpoint SHALL NOT include the User_Token in any HTTP response body returned to the caller
5. IF the Analysis_Endpoint or PR_Endpoint logs request metadata to CloudWatch Logs, THEN the system SHALL redact or omit the User_Token value from all log entries, ensuring the token is not present in plain text within any log stream

### Requirement 3: Token Security — No Logging

**User Story:** As a user, I want assurance that my GitHub token is never written to CloudWatch logs, so that my credentials cannot be extracted from operational logs.

#### Acceptance Criteria

1. THE Analysis_Endpoint SHALL ensure that no console.log or console.error call outputs a string containing the User_Token value (full or partial, 4 or more consecutive characters of the token)
2. THE PR_Endpoint SHALL ensure that no console.log or console.error call outputs a string containing the User_Token value (full or partial, 4 or more consecutive characters of the token)
3. IF any object or string passed to console.log or console.error in the Analysis_Endpoint contains the User_Token value, THEN THE Analysis_Endpoint SHALL replace the User_Token value with the literal string `[REDACTED]` before the output is written
4. IF any object or string passed to console.log or console.error in the PR_Endpoint contains the User_Token value, THEN THE PR_Endpoint SHALL replace the User_Token value with the literal string `[REDACTED]` before the output is written
5. WHEN the Analysis_Endpoint or PR_Endpoint logs an error object that includes request configuration, headers, or environment variables, THE system SHALL replace any occurrence of the User_Token value within the serialized output with the literal string `[REDACTED]`

### Requirement 4: Owner Verification Before PR Creation

**User Story:** As a user, I want the system to verify that my token corresponds to the repository owner, so that PRs are only created on repositories I actually own.

#### Acceptance Criteria

1. WHEN a PR creation request is received, THE PR_Endpoint SHALL call GitHub's `GET /user` API with the provided User_Token to retrieve the authenticated username, applying a timeout of 10 seconds for the API call
2. WHEN the authenticated username matches the owner segment of the repository URL using a case-insensitive comparison, THE PR_Endpoint SHALL proceed with PR creation
3. IF the authenticated username does not match the owner segment of the repository URL (case-insensitive comparison), THEN THE PR_Endpoint SHALL return an error response with HTTP status 403 and a message indicating the user does not own the repository
4. IF the User_Token is missing, empty, or the GitHub `GET /user` API returns HTTP 401, THEN THE PR_Endpoint SHALL return an error response with HTTP status 401 and a message indicating the token is invalid or missing
5. IF the GitHub `GET /user` API call fails due to a network error, returns a non-2xx status other than 401, or exceeds the 10-second timeout, THEN THE PR_Endpoint SHALL return an error response with HTTP status 502 and a message indicating that ownership verification could not be completed

### Requirement 5: PR Creation with High-Confidence Findings

**User Story:** As a user, I want the system to create a PR that removes high-confidence dead code from my repository, so that I can clean up my codebase with minimal effort.

#### Acceptance Criteria

1. WHEN owner verification succeeds, THE PR_Endpoint SHALL create a new branch in the user's repository named with the prefix `deadcode-radar/cleanup-` followed by the first 8 characters of the jobId (e.g., `deadcode-radar/cleanup-a1b2c3d4`), branching from the repository's default branch
2. WHEN the branch is created, THE PR_Endpoint SHALL apply file deletions in a single commit for all Findings associated with the jobId that have a confidenceScore of "high" and type "unused-file"
3. WHEN file deletions are applied, THE PR_Endpoint SHALL open a Pull Request targeting the repository's default branch, with the title and body taken from the stored prDescription field of the Job_Record
4. WHEN the Pull Request is created successfully, THE PR_Endpoint SHALL return HTTP 201 with a JSON response body containing at minimum the fields: `prUrl` (string, the URL of the created Pull Request) and `jobId` (string)
5. IF the PR creation fails due to insufficient permissions (GitHub API returns 403), THEN THE PR_Endpoint SHALL return HTTP 403 with a JSON body containing an error message indicating the user lacks write access to the repository
6. IF the Job_Record for the provided jobId does not exist, THEN THE PR_Endpoint SHALL return HTTP 404 with a JSON body containing an error message indicating no analysis result was found for the given jobId
7. IF the Job_Record contains no Findings with confidenceScore "high" and type "unused-file", or the prDescription field is null, THEN THE PR_Endpoint SHALL return HTTP 422 with a JSON body containing an error message indicating there are no high-confidence file deletions available to create a PR
8. IF the GitHub API returns an error other than 403 (such as network failure, rate limiting, or branch conflict), THEN THE PR_Endpoint SHALL return HTTP 502 with a JSON body containing an error message indicating that the GitHub service request failed

### Requirement 6: PR Endpoint Input and Routing

**User Story:** As a developer, I want a clear API contract for the PR creation endpoint, so that the frontend can call it with the correct parameters.

#### Acceptance Criteria

1. THE PR_Endpoint SHALL accept a POST request with a JSON body containing `jobId` (string, UUID v4 format) and `userGithubToken` (string, non-empty, maximum 255 characters)
2. WHEN the PR_Endpoint receives a valid request, THE PR_Endpoint SHALL retrieve the corresponding Job_Record from DynamoDB using the `jobId` as partition key to obtain the `findings` array and `prDescription` field
3. IF the `jobId` does not correspond to a Job_Record with `status` equal to `"completed"`, THEN THE PR_Endpoint SHALL return an error response with HTTP status 404 and a JSON body containing an `error` field indicating no completed analysis was found for the given jobId
4. IF the `userGithubToken` field is missing or is an empty string in the request body, THEN THE PR_Endpoint SHALL return an error response with HTTP status 400 and a JSON body containing an `error` field indicating the token is required
5. IF the request body is not valid JSON or is empty, THEN THE PR_Endpoint SHALL return an error response with HTTP status 400 and a JSON body containing an `error` field indicating the body must be valid JSON
6. IF the `jobId` field is missing from the request body or is not a valid UUID v4 string, THEN THE PR_Endpoint SHALL return an error response with HTTP status 400 and a JSON body containing an `error` field indicating that a valid jobId is required

### Requirement 7: Frontend Token Input Field

**User Story:** As a user, I want an optional input field to provide my GitHub token, so that I can enable PR creation without it being mandatory for analysis.

#### Acceptance Criteria

1. THE Token_Input SHALL be rendered as a collapsible section in the Testing component with the label "Add your GitHub token to enable PR creation (optional)", collapsed by default on initial render
2. THE Token_Input SHALL include a link to `https://github.com/settings/tokens/new?scopes=repo` with text explaining the required `repo` scope
3. THE Token_Input SHALL render as a password-type input (masking characters) and store the entered value exclusively in React component state (useState), clearing the stored value when the user triggers a reset or navigates away from the Testing component
4. THE Token_Input SHALL NOT persist the token value to localStorage, sessionStorage, cookies, or any other browser persistence mechanism
5. WHEN the user triggers analysis and the Token_Input contains a non-empty value, THE Testing component SHALL include the token value in the API request body so that the backend can use it for PR creation

### Requirement 8: Frontend Token Transmission

**User Story:** As a user, I want my token to be sent with the analysis request when I provide one, so that the backend can use it for all GitHub operations.

#### Acceptance Criteria

1. WHEN the user has entered a non-empty token (at least 1 non-whitespace character) in the Token_Input and submits an analysis, THE Testing component SHALL include the `userGithubToken` field in the POST request body with the trimmed token string value alongside the `repoUrl` field
2. WHEN the user has left the Token_Input empty or containing only whitespace characters and submits an analysis, THE Testing component SHALL send the POST request body without the `userGithubToken` field (the field shall not be present as null, empty string, or any other value)
3. WHEN the user submits an analysis with a token provided, THE Testing component SHALL send the POST request body as a JSON object containing exactly the fields `repoUrl` (string) and `userGithubToken` (string), with Content-Type header set to `application/json`

### Requirement 9: PR Button State Management

**User Story:** As a user, I want the Create PR button to clearly indicate whether I can create a PR, so that I understand what action is needed.

#### Acceptance Criteria

1. WHILE the User_Token value in the Token_Input is empty or contains only whitespace characters, THE PR_Button SHALL be rendered in a disabled state with the HTML `disabled` attribute set to true
2. WHILE the PR_Button is disabled, THE PR_Button SHALL display a tooltip on hover or keyboard focus with the text "Add your GitHub token above to enable this"
3. WHILE the User_Token contains at least one non-whitespace character AND the analysis results include a non-null prDescription, THE PR_Button SHALL be rendered in an enabled state with the HTML `disabled` attribute set to false
4. WHILE the User_Token contains at least one non-whitespace character AND the analysis results do not include a prDescription (prDescription is null), THE PR_Button SHALL remain in a disabled state

### Requirement 10: PR Creation Success State

**User Story:** As a user, I want to see a link to the created PR after successful creation, so that I can navigate to it directly.

#### Acceptance Criteria

1. WHEN the PR_Endpoint returns a successful response with a PR URL, THE PR_Button component SHALL display the PR URL as a clickable link that opens in a new browser tab (target="_blank" with rel="noopener noreferrer")
2. WHEN the PR is successfully created, THE PR_Button component SHALL replace the Create PR button with a success indicator showing a green check icon and the text "PR Created" alongside the clickable PR link

### Requirement 11: PR Creation Error State

**User Story:** As a user, I want to see a clear error message if PR creation fails, so that I understand what went wrong and how to fix it.

#### Acceptance Criteria

1. WHEN the PR_Endpoint returns a 403 error with a response body `error` field containing "does not own", THE PR_Button component SHALL display the message "You don't own this repository"
2. WHEN the PR_Endpoint returns a 403 error with a response body `error` field containing "write access", THE PR_Button component SHALL display the message "You don't have write access to this repository"
3. IF the PR creation request fails due to a network error or timeout (no response received), THEN THE PR_Button component SHALL display the message "Network error — please try again" and return the PR_Button to its enabled state to allow retrying
4. WHEN an error message is displayed, THE PR_Button component SHALL allow the user to dismiss the error by clicking a close icon or by initiating a new PR creation attempt

### Requirement 12: Token Volatility on Frontend

**User Story:** As a user, I want my token to be automatically cleared when I refresh the page, so that there is no risk of token leakage through browser storage.

#### Acceptance Criteria

1. WHEN the browser page is refreshed or navigated away from, THE Token_Input value SHALL be cleared to an empty string (lost from React state), requiring the user to re-enter the token for any subsequent operation
2. THE Token_Input SHALL NOT persist the token value using any browser storage mechanism, including localStorage, sessionStorage, cookies, IndexedDB, or URL parameters; no code path SHALL write the User_Token to any storage that survives a page reload
3. WHEN the application loads for the first time or after a page refresh, THE Token_Input SHALL initialize with an empty string as its default value, displaying no pre-filled or restored token content
