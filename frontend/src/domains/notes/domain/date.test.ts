import { describe, expect, it } from "bun:test";
import {
  agendaMonth,
  formatLocalDate,
  isAgendaDate,
  monthCalendarDays,
  shiftAgendaDate,
  weekdayLabels,
  weekStartsOnForLocale,
} from "./date";

describe("Notes agenda dates", () => {
  it("derives today from the browser-local calendar instead of UTC", () => {
    const localLateNight = new Date(2026, 7, 11, 23, 59, 59);
    expect(formatLocalDate(localLateNight)).toBe("2026-08-11");
    expect(agendaMonth(formatLocalDate(localLateNight))).toBe("2026-08");
  });

  it("validates real calendar dates and navigates without timezone inference", () => {
    expect(isAgendaDate("2028-02-29")).toBe(true);
    expect(isAgendaDate("2027-02-29")).toBe(false);
    expect(isAgendaDate("2026-8-11")).toBe(false);
    expect(shiftAgendaDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftAgendaDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(() => shiftAgendaDate("2026-02-30", 1)).toThrow("INVALID_AGENDA_DATE");
  });

  it("builds a fixed, local calendar grid with the selected month marked", () => {
    const days = monthCalendarDays("2026-08");
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({ date: "2026-07-27", inMonth: false });
    expect(days[5]).toEqual({ date: "2026-08-01", inMonth: true });
    expect(days[41]).toEqual({ date: "2026-09-06", inMonth: false });
  });

  it("keeps calendar headings and cells on the same Monday-first contract", () => {
    const days = monthCalendarDays("2026-08", weekStartsOnForLocale("es"));
    expect(days.findIndex((day) => day.date === "2026-08-01") % 7).toBe(5);
    expect(days.findIndex((day) => day.date === "2026-08-12") % 7).toBe(2);
    expect(weekdayLabels("es").map((label) => label.toLowerCase())).toEqual([
      "lun", "mar", "mié", "jue", "vie", "sáb", "dom",
    ]);
  });
});
