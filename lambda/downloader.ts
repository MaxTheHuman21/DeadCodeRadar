/**
 * Módulo de descarga de repositorios GitHub para DeadCode Radar.
 * Obtiene archivos JS/TS de un repositorio público usando la API de GitHub (Octokit),
 * filtra por extensiones y directorios excluidos, y los escribe a /tmp para análisis.
 */

import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DownloadResult, DownloaderConfig } from "./types";
import { AppError, ErrorType } from "./errors";

/**
 * Descarga archivos fuente JS/TS de un repositorio GitHub a un directorio temporal.
 *
 * @param owner - Propietario del repositorio (usuario u organización)
 * @param repo - Nombre del repositorio
 * @param jobId - Identificador único del job para crear el directorio temporal
 * @param config - Configuración del descargador (token, límites, extensiones, etc.)
 * @returns Resultado con la ruta del directorio temporal y cantidad de archivos descargados
 */
export async function downloadRepo(
  owner: string,
  repo: string,
  jobId: string,
  config: DownloaderConfig
): Promise<DownloadResult> {
  // Validar que GITHUB_TOKEN esté configurado
  if (!config.githubToken) {
    throw new AppError(
      ErrorType.AUTH_FAILED,
      "La autenticación con GitHub falló: GITHUB_TOKEN no está configurado"
    );
  }

  const octokit = new Octokit({ auth: config.githubToken });

  // Obtener el árbol recursivo del repositorio
  let tree: Array<{ path?: string; type?: string; sha?: string }>;
  try {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: "HEAD",
      recursive: "true",
    });
    tree = data.tree;
  } catch (error: unknown) {
    throw mapGitHubError(error);
  }

  // Filtrar archivos por extensiones permitidas y excluir directorios no deseados
  const eligibleFiles = tree.filter((item) => {
    if (item.type !== "blob" || !item.path) return false;
    // Excluir archivos dentro de directorios no permitidos
    const pathParts = item.path.split("/");
    for (const part of pathParts.slice(0, -1)) {
      if (config.excludedDirs.includes(part)) return false;
    }
    // Incluir solo extensiones permitidas
    const ext = getExtension(item.path);
    return config.allowedExtensions.includes(ext);
  });

  // Verificar presencia de package.json en raíz
  const packageJsonEntry = tree.find(
    (item) => item.type === "blob" && item.path === "package.json"
  );
  if (!packageJsonEntry) {
    throw new AppError(
      ErrorType.NO_PACKAGE_JSON,
      "El repositorio no es un proyecto Node.js válido: no se encontró package.json en la raíz"
    );
  }

  // Verificar que existan archivos JS/TS
  if (eligibleFiles.length === 0) {
    throw new AppError(
      ErrorType.NO_JS_TS_FILES,
      "No se encontraron archivos JavaScript/TypeScript en el repositorio"
    );
  }

  // Verificar que archivos elegibles no excedan el límite
  if (eligibleFiles.length > config.maxFiles) {
    throw new AppError(
      ErrorType.FILES_LIMIT_EXCEEDED,
      `El repositorio excede el límite de archivos permitido: ${eligibleFiles.length} archivos (máximo ${config.maxFiles})`
    );
  }

  // Identificar archivos de configuración opcionales presentes en el repositorio
  const configFileEntries = tree.filter(
    (item) =>
      item.type === "blob" &&
      item.path !== undefined &&
      config.configFiles.includes(item.path)
  );

  // Preparar la lista completa de archivos a descargar
  const filesToDownload = [
    packageJsonEntry,
    ...eligibleFiles,
    ...configFileEntries,
  ];

  // Crear directorio temporal
  const tmpDir = `/tmp/${jobId}`;
  await mkdir(tmpDir, { recursive: true });

  // Descargar archivos en paralelo (batches de 10)
  const batchSize = 10;
  for (let i = 0; i < filesToDownload.length; i += batchSize) {
    const batch = filesToDownload.slice(i, i + batchSize);
    await Promise.all(
      batch.map((file) =>
        downloadAndWriteFile(octokit, owner, repo, file, tmpDir)
      )
    );
  }

  return {
    tmpDir,
    filesDownloaded: filesToDownload.length,
  };
}

/**
 * Descarga un blob individual de GitHub y lo escribe al sistema de archivos.
 */
async function downloadAndWriteFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  file: { path?: string; sha?: string },
  tmpDir: string
): Promise<void> {
  if (!file.path || !file.sha) return;

  try {
    const { data } = await octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: file.sha,
    });

    // Decodificar contenido base64
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    // Escribir archivo preservando estructura de directorios
    const filePath = join(tmpDir, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
  } catch (error: unknown) {
    throw mapGitHubError(error);
  }
}

/**
 * Mapea errores de la API de GitHub a errores de dominio (AppError).
 */
function mapGitHubError(error: unknown): AppError {
  if (error instanceof RequestError) {
    switch (error.status) {
      case 401:
        return new AppError(
          ErrorType.AUTH_FAILED,
          "La autenticación con GitHub falló: token inválido o expirado",
          error
        );
      case 403:
        return new AppError(
          ErrorType.REPO_PRIVATE,
          "El repositorio es privado o inaccesible",
          error
        );
      case 404:
        return new AppError(
          ErrorType.REPO_NOT_FOUND,
          "El repositorio no fue encontrado",
          error
        );
      case 429:
        return new AppError(
          ErrorType.GITHUB_UNAVAILABLE,
          "El servicio de GitHub no está disponible temporalmente: límite de tasa excedido",
          error
        );
      default:
        return new AppError(
          ErrorType.GITHUB_UNAVAILABLE,
          `Error de GitHub API: ${error.message}`,
          error
        );
    }
  }

  // Timeout u otros errores de red
  if (error instanceof Error) {
    if (
      error.message.includes("timeout") ||
      error.message.includes("ETIMEDOUT")
    ) {
      return new AppError(
        ErrorType.GITHUB_UNAVAILABLE,
        "El servicio de GitHub no está disponible temporalmente: timeout",
        error
      );
    }
    return new AppError(
      ErrorType.GITHUB_UNAVAILABLE,
      `Error al comunicarse con GitHub: ${error.message}`,
      error
    );
  }

  return new AppError(
    ErrorType.INTERNAL_ERROR,
    "Error interno inesperado al descargar el repositorio"
  );
}

/**
 * Obtiene la extensión de un nombre de archivo.
 */
function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filePath.slice(lastDot);
}
