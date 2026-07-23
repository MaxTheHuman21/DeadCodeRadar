/**
 * Tests unitarios del handler principal de DeadCode Radar.
 * Validates: Requirements 1.1, 1.4, 1.5, 1.6, 7.1, 7.6
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock módulos externos antes de importar el handler
vi.mock("../../lambda/downloader", () => ({
  downloadRepo: vi.fn(),
}));

vi.mock("../../lambda/analyzer", () => ({
  analyzeDeadCode: vi.fn(),
}));

vi.mock("../../lambda/persistence", () => ({
  saveResult: vi.fn(),
  getResult: vi.fn(),
}));

vi.mock("../../lambda/enricher", () => ({
  enrichFindings: vi.fn(),
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "00000000-0000-4000-a000-000000000001"),
}));

vi.mock("fs/promises", () => ({
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { handler } from "../../lambda/handler";
import { downloadRepo } from "../../lambda/downloader";
import { analyzeDeadCode } from "../../lambda/analyzer";
import { enrichFindings } from "../../lambda/enricher";
import { saveResult, getResult } from "../../lambda/persistence";
import type { LambdaEvent } from "../../lambda/types";

function makeEvent(overrides: Partial<LambdaEvent> & { method?: string }): LambdaEvent {
  const { method = "POST", ...rest } = overrides;
  return {
    requestContext: { http: { method } },
    ...rest,
  } as LambdaEvent;
}

describe("handler – ruteo por método HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "ghp_test_token";
  });

  it("POST → ejecuta pipeline de análisis (Req 1.1)", async () => {
    const findings = [{ file: "src/index.ts", line: 5, type: "unused-export", name: "foo", confidenceScore: null, riskExplanation: null, groupId: null }];
    (downloadRepo as ReturnType<typeof vi.fn>).mockResolvedValue({
      tmpDir: "/tmp/00000000-0000-4000-a000-000000000001",
      filesDownloaded: 10,
    });
    (analyzeDeadCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      findings: [{ file: "src/index.ts", line: 5, type: "unused-export", name: "foo" }],
      engineUsed: "knip",
    });
    (enrichFindings as ReturnType<typeof vi.fn>).mockResolvedValue({
      findings,
      enriched: false,
      prDescription: null,
    });
    (saveResult as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const event = makeEvent({
      method: "POST",
      body: JSON.stringify({ repoUrl: "https://github.com/owner/repo" }),
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    expect(downloadRepo).toHaveBeenCalled();
    expect(analyzeDeadCode).toHaveBeenCalled();
    expect(enrichFindings).toHaveBeenCalled();
    expect(saveResult).toHaveBeenCalled();
  });

  it("GET sin jobId → retorna 400 por jobId inválido (Req 1.1)", async () => {
    const event = makeEvent({ method: "GET" });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    expect(downloadRepo).not.toHaveBeenCalled();
  });

  it("PUT → retorna 405 método no permitido (Req 1.6, 7.6)", async () => {
    const event = makeEvent({ method: "PUT" });
    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(405);
    expect(body.error).toBe("Método no permitido");
  });

  it("DELETE → retorna 405 método no permitido (Req 1.6, 7.6)", async () => {
    const event = makeEvent({ method: "DELETE" });
    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(405);
    expect(body.error).toBe("Método no permitido");
  });

  it("PATCH → retorna 405 método no permitido (Req 1.6, 7.6)", async () => {
    const event = makeEvent({ method: "PATCH" });
    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(405);
    expect(body.error).toBe("Método no permitido");
  });
});

describe("handler – parsing body JSON inválido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "ghp_test_token";
  });

  it("body no es JSON válido → retorna 400 (Req 1.5)", async () => {
    const event = makeEvent({
      method: "POST",
      body: "esto no es json{",
    });

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("body vacío → retorna 400 (Req 1.5)", async () => {
    const event = makeEvent({
      method: "POST",
      body: "",
    });

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("body undefined → retorna 400 (Req 1.5)", async () => {
    const event = makeEvent({
      method: "POST",
    });

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toBeDefined();
  });
});

describe("handler – validación repoUrl ausente/inválido", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "ghp_test_token";
  });

  it("repoUrl ausente → retorna 400 (Req 1.4)", async () => {
    const event = makeEvent({
      method: "POST",
      body: JSON.stringify({ otherField: "value" }),
    });

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("repoUrl formato inválido (no es GitHub) → retorna 400 (Req 1.4)", async () => {
    const event = makeEvent({
      method: "POST",
      body: JSON.stringify({ repoUrl: "https://gitlab.com/owner/repo" }),
    });

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("repoUrl con segmentos extra → retorna 400 (Req 1.4)", async () => {
    const event = makeEvent({
      method: "POST",
      body: JSON.stringify({ repoUrl: "https://github.com/owner/repo/tree/main" }),
    });

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("repoUrl vacío → retorna 400 (Req 1.4)", async () => {
    const event = makeEvent({
      method: "POST",
      body: JSON.stringify({ repoUrl: "" }),
    });

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.error).toBeDefined();
  });
});

describe("handler – respuesta exitosa con estructura correcta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "ghp_test_token";
  });

  it("retorna estructura { jobId, status, repoUrl, filesAnalyzed, findings } (Req 7.1)", async () => {
    const findings = [
      { file: "src/utils.ts", line: 12, type: "unused-export", name: "helperFn" },
      { file: "src/old.ts", line: null, type: "unused-file", name: "old.ts" },
    ];
    const enrichedFindings = [
      { file: "src/utils.ts", line: 12, type: "unused-export", name: "helperFn", confidenceScore: null, riskExplanation: null, groupId: null },
      { file: "src/old.ts", line: null, type: "unused-file", name: "old.ts", confidenceScore: null, riskExplanation: null, groupId: null },
    ];

    (downloadRepo as ReturnType<typeof vi.fn>).mockResolvedValue({
      tmpDir: "/tmp/00000000-0000-4000-a000-000000000001",
      filesDownloaded: 42,
    });
    (analyzeDeadCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      findings,
      engineUsed: "knip",
    });
    (enrichFindings as ReturnType<typeof vi.fn>).mockResolvedValue({
      findings: enrichedFindings,
      enriched: false,
      prDescription: null,
    });
    (saveResult as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const event = makeEvent({
      method: "POST",
      body: JSON.stringify({ repoUrl: "https://github.com/test-owner/test-repo" }),
    });

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.jobId).toBe("00000000-0000-4000-a000-000000000001");
    expect(body.status).toBe("completed");
    expect(body.repoUrl).toBe("https://github.com/test-owner/test-repo");
    expect(body.filesAnalyzed).toBe(42);
    expect(body.findings).toEqual(enrichedFindings);
    expect(body.enriched).toBe(false);
    expect(body.prDescription).toBeNull();
  });
});

describe("handler – Content-Type: application/json en todas las respuestas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_TOKEN = "ghp_test_token";
  });

  it("respuesta exitosa tiene Content-Type application/json (Req 7.1)", async () => {
    (downloadRepo as ReturnType<typeof vi.fn>).mockResolvedValue({
      tmpDir: "/tmp/00000000-0000-4000-a000-000000000001",
      filesDownloaded: 5,
    });
    (analyzeDeadCode as ReturnType<typeof vi.fn>).mockResolvedValue({
      findings: [],
      engineUsed: "knip",
    });
    (enrichFindings as ReturnType<typeof vi.fn>).mockResolvedValue({
      findings: [],
      enriched: false,
      prDescription: null,
    });
    (saveResult as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const event = makeEvent({
      method: "POST",
      body: JSON.stringify({ repoUrl: "https://github.com/owner/repo" }),
    });

    const response = await handler(event);
    expect(response.headers["Content-Type"]).toBe("application/json");
  });

  it("respuesta de error 400 tiene Content-Type application/json (Req 7.1)", async () => {
    const event = makeEvent({
      method: "POST",
      body: "invalid json",
    });

    const response = await handler(event);
    expect(response.headers["Content-Type"]).toBe("application/json");
  });

  it("respuesta de error 405 tiene Content-Type application/json (Req 7.1)", async () => {
    const event = makeEvent({ method: "PATCH" });
    const response = await handler(event);
    expect(response.headers["Content-Type"]).toBe("application/json");
  });

  it("respuesta GET tiene Content-Type application/json (Req 7.1)", async () => {
    const event = makeEvent({ method: "GET" });
    const response = await handler(event);
    expect(response.headers["Content-Type"]).toBe("application/json");
  });
});
