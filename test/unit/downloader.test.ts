/**
 * Tests del módulo de descarga (downloader.ts)
 * Validates: Requirements 2.2, 2.4, 2.6, 2.9, 2.10, 2.13
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError, ErrorType } from "../../lambda/errors";

// Mock de fs/promises para evitar escrituras reales en el filesystem
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock de @octokit/rest
const mockGetTree = vi.fn();
const mockGetBlob = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      git: {
        getTree: mockGetTree,
        getBlob: mockGetBlob,
      },
    },
  })),
}));

import { downloadRepo } from "../../lambda/downloader";
import { DownloaderConfig } from "../../lambda/types";

/** Helper: genera una entrada del árbol de GitHub */
function makeTreeEntry(path: string, type: string = "blob", sha?: string) {
  return {
    path,
    type,
    sha: sha || `sha-${path.replace(/[^a-z0-9]/gi, "")}`,
  };
}

/** Configuración base para tests */
function baseConfig(): DownloaderConfig {
  return {
    githubToken: "ghp_test_token_123",
    maxFiles: 500,
    timeoutMs: 30000,
    allowedExtensions: [".js", ".ts", ".jsx", ".tsx"],
    excludedDirs: ["node_modules", "dist", "build", ".git"],
    configFiles: ["tsconfig.json", "knip.json", "knip.config.ts", "knip.config.js"],
  };
}

/** Helper: configura mockGetBlob para devolver contenido base64 */
function setupBlobMock() {
  mockGetBlob.mockResolvedValue({
    data: {
      content: Buffer.from("// file content").toString("base64"),
      encoding: "base64",
    },
  });
}

describe("downloadRepo - Filtrado de extensiones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBlobMock();
  });

  it("acepta archivos con extensiones .js, .ts, .jsx, .tsx", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("src/index.ts"),
      makeTreeEntry("src/app.js"),
      makeTreeEntry("src/component.jsx"),
      makeTreeEntry("src/widget.tsx"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-1", baseConfig());

    // package.json + 4 archivos fuente = 5 archivos descargados
    expect(result.filesDownloaded).toBe(5);
  });

  it("rechaza archivos con extensiones no permitidas (.css, .html, .json, .md)", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("src/index.ts"),
      makeTreeEntry("src/styles.css"),
      makeTreeEntry("README.md"),
      makeTreeEntry("data.json"),
      makeTreeEntry("page.html"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-2", baseConfig());

    // package.json + 1 archivo .ts elegible = 2
    expect(result.filesDownloaded).toBe(2);
  });
});

describe("downloadRepo - Exclusión de directorios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBlobMock();
  });

  it("excluye archivos dentro de node_modules", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("src/index.ts"),
      makeTreeEntry("node_modules/lodash/index.js"),
      makeTreeEntry("node_modules/@types/node/index.d.ts"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-3", baseConfig());

    // Solo package.json + src/index.ts
    expect(result.filesDownloaded).toBe(2);
  });

  it("excluye archivos dentro de dist, build y .git", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("src/app.ts"),
      makeTreeEntry("dist/bundle.js"),
      makeTreeEntry("build/output.js"),
      makeTreeEntry(".git/hooks/pre-commit.js"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-4", baseConfig());

    // Solo package.json + src/app.ts
    expect(result.filesDownloaded).toBe(2);
  });

  it("excluye archivos en subdirectorios anidados de directorios excluidos", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("src/index.ts"),
      makeTreeEntry("node_modules/pkg/lib/utils.js"),
      makeTreeEntry("dist/esm/module.js"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-5", baseConfig());

    expect(result.filesDownloaded).toBe(2);
  });
});

describe("downloadRepo - Detección de archivos de configuración opcionales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBlobMock();
  });

  it("incluye tsconfig.json si existe en el repositorio", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("tsconfig.json"),
      makeTreeEntry("src/index.ts"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-6", baseConfig());

    // package.json + tsconfig.json + src/index.ts = 3
    expect(result.filesDownloaded).toBe(3);
  });

  it("incluye knip.json y knip.config.ts si existen", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("knip.json"),
      makeTreeEntry("knip.config.ts"),
      makeTreeEntry("src/main.ts"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-7", baseConfig());

    // package.json(1) + eligibleFiles(knip.config.ts, src/main.ts = 2) + configFiles(knip.json, knip.config.ts = 2) = 5
    // Note: knip.config.ts appears in both eligibleFiles (.ts ext) and configFileEntries
    expect(result.filesDownloaded).toBe(5);
  });

  it("funciona correctamente sin archivos de configuración opcionales", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("src/index.ts"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-8", baseConfig());

    // package.json + src/index.ts = 2
    expect(result.filesDownloaded).toBe(2);
  });
});

describe("downloadRepo - Error cuando no hay package.json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBlobMock();
  });

  it("lanza AppError con ErrorType.NO_PACKAGE_JSON si no existe package.json", async () => {
    const tree = [
      makeTreeEntry("src/index.ts"),
      makeTreeEntry("src/app.js"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    await expect(
      downloadRepo("owner", "repo", "job-9", baseConfig())
    ).rejects.toThrow(AppError);

    try {
      await downloadRepo("owner", "repo", "job-9", baseConfig());
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).type).toBe(ErrorType.NO_PACKAGE_JSON);
    }
  });
});

describe("downloadRepo - Error cuando no hay archivos JS/TS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBlobMock();
  });

  it("lanza AppError con ErrorType.NO_JS_TS_FILES si no hay archivos elegibles", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("README.md"),
      makeTreeEntry("styles/main.css"),
      makeTreeEntry("data/config.yaml"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    await expect(
      downloadRepo("owner", "repo", "job-10", baseConfig())
    ).rejects.toThrow(AppError);

    try {
      await downloadRepo("owner", "repo", "job-10", baseConfig());
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).type).toBe(ErrorType.NO_JS_TS_FILES);
    }
  });
});

describe("downloadRepo - Error cuando excede 500 archivos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBlobMock();
  });

  it("lanza AppError con ErrorType.FILES_LIMIT_EXCEEDED si hay más de 500 archivos elegibles", async () => {
    // Generar 501 archivos .ts + package.json
    const tree = [
      makeTreeEntry("package.json"),
      ...Array.from({ length: 501 }, (_, i) =>
        makeTreeEntry(`src/file${i}.ts`)
      ),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    await expect(
      downloadRepo("owner", "repo", "job-11", baseConfig())
    ).rejects.toThrow(AppError);

    try {
      await downloadRepo("owner", "repo", "job-11", baseConfig());
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).type).toBe(ErrorType.FILES_LIMIT_EXCEEDED);
    }
  });

  it("no lanza error cuando hay exactamente 500 archivos", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      ...Array.from({ length: 500 }, (_, i) =>
        makeTreeEntry(`src/file${i}.ts`)
      ),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    const result = await downloadRepo("owner", "repo", "job-12", baseConfig());

    // package.json + 500 archivos = 501
    expect(result.filesDownloaded).toBe(501);
  });
});

describe("downloadRepo - Mock de Octokit (GitHub API)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBlobMock();
  });

  it("llama a getTree con owner, repo, tree_sha 'HEAD' y recursive 'true'", async () => {
    const tree = [
      makeTreeEntry("package.json"),
      makeTreeEntry("src/index.ts"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    await downloadRepo("owner", "repo", "job-13", baseConfig());

    expect(mockGetTree).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      tree_sha: "HEAD",
      recursive: "true",
    });
  });

  it("llama a getBlob para cada archivo descargado con el SHA correcto", async () => {
    const tree = [
      makeTreeEntry("package.json", "blob", "sha-pkg"),
      makeTreeEntry("src/index.ts", "blob", "sha-idx"),
    ];

    mockGetTree.mockResolvedValue({ data: { tree } });

    await downloadRepo("owner", "repo", "job-14", baseConfig());

    expect(mockGetBlob).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      file_sha: "sha-pkg",
    });
    expect(mockGetBlob).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      file_sha: "sha-idx",
    });
  });

  it("lanza AppError con ErrorType.AUTH_FAILED si no hay githubToken", async () => {
    const config = baseConfig();
    config.githubToken = "";

    await expect(
      downloadRepo("owner", "repo", "job-15", config)
    ).rejects.toThrow(AppError);

    try {
      await downloadRepo("owner", "repo", "job-15", config);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).type).toBe(ErrorType.AUTH_FAILED);
    }
  });
});
