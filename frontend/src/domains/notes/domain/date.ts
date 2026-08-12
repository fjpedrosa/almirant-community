const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

const pad = (value: number) => String(value).padStart(2, "0");

export const formatLocalDate = (date = new Date()): string =>
  `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const isAgendaDate = (value: string): boolean => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const candidate = new Date(year, month - 1, day, 12);
  return candidate.getFullYear() === year
    && candidate.getMonth() === month - 1
    && candidate.getDate() === day;
};

export const isAgendaMonth = (value: string): boolean => {
  const match = MONTH_PATTERN.exec(value);
  return Boolean(match && Number(match[1]) >= 1 && Number(match[2]) >= 1 && Number(match[2]) <= 12);
};

export const agendaMonth = (date: string): string => {
  if (!isAgendaDate(date)) throw new Error("INVALID_AGENDA_DATE");
  return date.slice(0, 7);
};

const dateFromAgenda = (value: string): Date => {
  if (!isAgendaDate(value)) throw new Error("INVALID_AGENDA_DATE");
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12);
};

export const shiftAgendaDate = (value: string, days: number): string => {
  const date = dateFromAgenda(value);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
};

export const shiftAgendaMonth = (value: string, months: number): string => {
  if (!isAgendaMonth(value)) throw new Error("INVALID_AGENDA_MONTH");
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year!, month! - 1 + months, 1, 12);
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}`;
};

/** Notes uses an ISO/Monday-first calendar for every locale. */
export const weekStartsOnForLocale = (locale: string): 1 => {
  void locale;
  return 1;
};

export const weekdayLabels = (locale: string): string[] => {
  const monday = new Date(2024, 0, 1, 12);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  });
};

export const monthCalendarDays = (month: string, weekStartsOn = 1): Array<{ date: string; inMonth: boolean }> => {
  if (!isAgendaMonth(month)) throw new Error("INVALID_AGENDA_MONTH");
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year!, monthNumber! - 1, 1, 12);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  first.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return { date: formatLocalDate(date), inMonth: date.getMonth() === monthNumber! - 1 };
  });
};
