/**
 * Tests unitarios del módulo enricher de DeadCode Radar.
 */
import { describe, it, expect } from "vitest";
import { parseBedrockResponse, stripMarkdownCodeFence } from "../../lambda/enricher";
import type { Finding } from "../../lambda/types";

const sampleFindings: Finding[] = [
  { file: "src/utils.ts", line: 12, type: "unused-export", name: "helperFn" },
  { file: "src/old.ts", line: null, type: "unused-file", name: "old.ts" },
];

const validBedrockJson = JSON.stringify({
  findings: [
    { index: 0, confidenceScore: "high", riskExplanation: "No incoming imports.", groupId: null },
    { index: 1, confidenceScore: "medium", riskExplanation: "File has no consumers.", groupId: "abcd1234" },
  ],
  prDescription: {
    title: "chore: remove unused exports and dead files",
    body: "## Summary\n\nRemove dead code.",
  },
});

describe("stripMarkdownCodeFence", () => {
  it("strips ```json ... ``` fence", () => {
    const input = "```json\n{\"key\": \"value\"}\n```";
    expect(stripMarkdownCodeFence(input)).toBe("{\"key\": \"value\"}");
  });

  it("strips ``` ... ``` fence without language tag", () => {
    const input = "```\n{\"key\": \"value\"}\n```";
    expect(stripMarkdownCodeFence(input)).toBe("{\"key\": \"value\"}");
  });

  it("returns trimmed string when no fence present", () => {
    const input = "  {\"key\": \"value\"}  ";
    expect(stripMarkdownCodeFence(input)).toBe("{\"key\": \"value\"}");
  });

  it("handles extra whitespace around the fenced block", () => {
    const input = "  ```json\n{\"key\": \"value\"}\n```  ";
    expect(stripMarkdownCodeFence(input)).toBe("{\"key\": \"value\"}");
  });
});

describe("parseBedrockResponse – Markdown code fence stripping", () => {
  it("parses response wrapped in ```json ... ``` code fence correctly", () => {
    const wrappedResponse = "```json\n" + validBedrockJson + "\n```";

    const result = parseBedrockResponse(wrappedResponse, sampleFindings);

    expect(result.enrichedFindings).toHaveLength(2);
    expect(result.enrichedFindings[0].confidenceScore).toBe("high");
    expect(result.enrichedFindings[1].confidenceScore).toBe("medium");
    expect(result.enrichedFindings[1].groupId).toBe("abcd1234");
    expect(result.prDescription.title).toBe("chore: remove unused exports and dead files");
    expect(result.prDescription.body).toContain("## Summary");
  });

  it("parses response wrapped in ``` ... ``` (no language tag) code fence", () => {
    const wrappedResponse = "```\n" + validBedrockJson + "\n```";

    const result = parseBedrockResponse(wrappedResponse, sampleFindings);

    expect(result.enrichedFindings).toHaveLength(2);
    expect(result.enrichedFindings[0].confidenceScore).toBe("high");
  });

  it("parses plain JSON without code fence (regression check)", () => {
    const result = parseBedrockResponse(validBedrockJson, sampleFindings);

    expect(result.enrichedFindings).toHaveLength(2);
    expect(result.enrichedFindings[0].confidenceScore).toBe("high");
  });

  it("throws on invalid JSON even after stripping code fence", () => {
    const badResponse = "```json\n{ invalid json }\n```";

    expect(() => parseBedrockResponse(badResponse, sampleFindings)).toThrow(
      "Bedrock response is not valid JSON"
    );
  });
});
