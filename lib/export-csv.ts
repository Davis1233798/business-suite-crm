/**
 * C08: CSV Export with formula injection safety escaping and Asia/Taipei timezone formatting.
 */

export function sanitizeCsvField(val: any): string {
  if (val === null || val === undefined) return "";
  let str = String(val);

  // Prevent CSV / Excel formula injection:
  // If field starts with =, +, -, @, \t, \r, prepend a single quote
  const dangerousChars = ["=", "+", "-", "@", "\t", "\r"];
  if (dangerousChars.some((ch) => str.startsWith(ch))) {
    str = `'${str}`;
  }

  // If contains commas, quotes, or newlines, quote the field
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function generateCsv(headers: string[], rows: any[][]): string {
  const headerLine = headers.map(sanitizeCsvField).join(",");
  const bodyLines = rows.map((r) => r.map(sanitizeCsvField).join(","));
  return [headerLine, ...bodyLines].join("\r\n");
}

export function formatTaipeiDate(utcIsoString: string): string {
  try {
    const d = new Date(utcIsoString);
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return utcIsoString;
  }
}
