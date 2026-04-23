export interface IsoDateParts {
  iso: string;
  year: number;
  month: number;
  day: number;
  key: number;
}

export function parseIsoDateOnly(input: string | undefined): IsoDateParts | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!matched) {
    return null;
  }

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    iso: `${matched[1]}-${matched[2]}-${matched[3]}`,
    year,
    month,
    day,
    key: year * 10000 + month * 100 + day,
  };
}

export function isValidIsoDateOnly(input: string | undefined): boolean {
  return parseIsoDateOnly(input) !== null;
}

export function getTodayIsoDate(timeZone?: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    const localYear = now.getFullYear();
    const localMonth = String(now.getMonth() + 1).padStart(2, "0");
    const localDay = String(now.getDate()).padStart(2, "0");
    return `${localYear}-${localMonth}-${localDay}`;
  }

  return `${year}-${month}-${day}`;
}

export function compareIsoDateOnly(left: string, right: string): number | null {
  const leftDate = parseIsoDateOnly(left);
  const rightDate = parseIsoDateOnly(right);
  if (!leftDate || !rightDate) {
    return null;
  }
  return leftDate.key === rightDate.key ? 0 : leftDate.key > rightDate.key ? 1 : -1;
}
