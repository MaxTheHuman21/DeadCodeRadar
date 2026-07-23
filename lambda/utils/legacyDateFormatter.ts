/**
 * Legacy date formatting utilities, superseded by the native 
 * Intl.DateTimeFormat approach used elsewhere in the codebase.
 * Kept temporarily for reference during the migration.
 */

export function formatLegacyDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function parseLegacyDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split("/").map(Number);
  return new Date(year, month - 1, day);
}