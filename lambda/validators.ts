/**
 * Funciones de validación para DeadCode Radar.
 * Valida URLs de repositorios GitHub, jobIds (UUID v4) y cuerpos JSON.
 */

/**
 * Valida que la URL sea un repositorio público de GitHub con formato:
 * https://github.com/{owner}/{repo}
 *
 * Rechaza: trailing slashes, extra path segments, query params, .git suffix,
 * identificadores inválidos de GitHub.
 *
 * @returns Objeto con valid:true + owner/repo extraídos, o valid:false + error descriptivo.
 */
export function validateRepoUrl(url: string): {
  valid: boolean;
  owner?: string;
  repo?: string;
  error?: string;
} {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "La URL del repositorio es requerida" };
  }

  const trimmed = url.trim();

  // Reject query params and fragments
  if (trimmed.includes("?") || trimmed.includes("#")) {
    return {
      valid: false,
      error: "La URL no debe contener query parameters ni fragmentos",
    };
  }

  // Reject .git suffix
  if (trimmed.endsWith(".git")) {
    return {
      valid: false,
      error: "La URL no debe terminar con .git",
    };
  }

  // Reject trailing slash
  if (trimmed.endsWith("/")) {
    return {
      valid: false,
      error: "La URL no debe terminar con /",
    };
  }

  // Must start with https://github.com/
  const prefix = "https://github.com/";
  if (!trimmed.startsWith(prefix)) {
    return {
      valid: false,
      error: "La URL debe comenzar con https://github.com/",
    };
  }

  // Extract path after prefix
  const path = trimmed.slice(prefix.length);
  const segments = path.split("/");

  // Must have exactly 2 segments: owner and repo
  if (segments.length !== 2) {
    return {
      valid: false,
      error:
        "La URL debe tener el formato https://github.com/{owner}/{repo} sin segmentos adicionales",
    };
  }

  const [owner, repo] = segments;

  // Both must be non-empty
  if (!owner || !repo) {
    return {
      valid: false,
      error: "El owner y el repo no pueden estar vacíos",
    };
  }

  // Validate GitHub identifier format:
  // - Alphanumeric and hyphens only
  // - Cannot start with a hyphen
  // - No consecutive hyphens at start (GitHub restriction)
  const githubIdentifierRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

  if (!githubIdentifierRegex.test(owner)) {
    return {
      valid: false,
      error:
        "El owner no es un identificador válido de GitHub (solo alfanuméricos y guiones, no puede empezar ni terminar con guión)",
    };
  }

  if (!githubIdentifierRegex.test(repo)) {
    return {
      valid: false,
      error:
        "El repo no es un identificador válido de GitHub (solo alfanuméricos y guiones, no puede empezar ni terminar con guión)",
    };
  }

  return { valid: true, owner, repo };
}

/**
 * Valida que el string sea un UUID v4 válido.
 * Formato: 8-4-4-4-12 hex chars, con versión 4 en el tercer grupo
 * y variante (8, 9, a, b) en el cuarto grupo.
 */
export function validateJobId(jobId: string): boolean {
  if (!jobId || typeof jobId !== "string") {
    return false;
  }

  const uuidV4Regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidV4Regex.test(jobId);
}

/**
 * Verifica que el string sea JSON parseable.
 */
export function isValidJson(body: string): boolean {
  if (body === undefined || body === null || body === "") {
    return false;
  }

  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}
