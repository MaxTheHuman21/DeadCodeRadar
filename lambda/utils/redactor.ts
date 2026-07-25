/**
 * Token redaction utilities.
 * Prevents accidental token leakage to CloudWatch logs.
 */

/**
 * Replaces all occurrences of the full token in the input string with [REDACTED].
 * Returns the original string unchanged if token is null, undefined, or shorter than 4 characters.
 */
export function redact(input: string, token: string | null | undefined): string {
  if (token === null || token === undefined || token.length < 4) {
    return input;
  }

  // Replace all occurrences of the full token
  while (input.includes(token)) {
    input = input.replace(token, "[REDACTED]");
  }

  return input;
}

/**
 * Creates a safe logger that wraps console.log/console.error/console.warn,
 * applying token redaction to all arguments before writing.
 */
export function createSafeLogger(token: string | null | undefined): {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
} {
  function redactArg(arg: unknown): string {
    if (typeof arg === "string") {
      return redact(arg, token);
    }
    // For objects, stringify first then redact
    try {
      const serialized = JSON.stringify(arg);
      return redact(serialized, token);
    } catch {
      return redact(String(arg), token);
    }
  }

  return {
    log: (...args: unknown[]) => {
      console.log(...args.map(redactArg));
    },
    error: (...args: unknown[]) => {
      console.error(...args.map(redactArg));
    },
    warn: (...args: unknown[]) => {
      console.warn(...args.map(redactArg));
    },
  };
}
