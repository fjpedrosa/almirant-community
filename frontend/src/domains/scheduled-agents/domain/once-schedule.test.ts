import { describe, expect, test } from "bun:test";
import {
  isZonedDateTimeInPast,
  isoToZonedDateTimeLocal,
  zonedDateTimeToIso,
} from "./once-schedule";

describe("zonedDateTimeToIso", () => {
  test("convierte una hora local de Madrid (CEST, UTC+2) al instante UTC correcto", () => {
    expect(zonedDateTimeToIso("2026-08-15T14:30", "Europe/Madrid")).toBe(
      "2026-08-15T12:30:00.000Z",
    );
  });

  test("convierte una hora local de Nueva York (EDT, UTC-4) al instante UTC correcto", () => {
    expect(zonedDateTimeToIso("2026-08-15T14:30", "America/New_York")).toBe(
      "2026-08-15T18:30:00.000Z",
    );
  });

  test("una hora en UTC no se desplaza", () => {
    expect(zonedDateTimeToIso("2026-08-15T14:30", "UTC")).toBe(
      "2026-08-15T14:30:00.000Z",
    );
  });

  test("cruza el limite de dia al convertir medianoche de Tokio (UTC+9)", () => {
    expect(zonedDateTimeToIso("2026-01-01T00:00", "Asia/Tokyo")).toBe(
      "2025-12-31T15:00:00.000Z",
    );
  });

  test("devuelve null para un valor que no tiene forma de datetime-local", () => {
    expect(zonedDateTimeToIso("not-a-date", "Europe/Madrid")).toBeNull();
    expect(zonedDateTimeToIso("", "Europe/Madrid")).toBeNull();
  });
});

describe("isoToZonedDateTimeLocal", () => {
  test("es la inversa de zonedDateTimeToIso para Madrid", () => {
    const iso = zonedDateTimeToIso("2026-08-15T14:30", "Europe/Madrid")!;
    expect(isoToZonedDateTimeLocal(iso, "Europe/Madrid")).toBe("2026-08-15T14:30");
  });

  test("es la inversa de zonedDateTimeToIso para Nueva York", () => {
    const iso = zonedDateTimeToIso("2026-08-15T14:30", "America/New_York")!;
    expect(isoToZonedDateTimeLocal(iso, "America/New_York")).toBe("2026-08-15T14:30");
  });

  test("reproyecta un instante UTC a la zona horaria pedida", () => {
    // 2026-08-15T12:30:00.000Z == 14:30 en Madrid (UTC+2 en agosto)
    expect(
      isoToZonedDateTimeLocal("2026-08-15T12:30:00.000Z", "Europe/Madrid"),
    ).toBe("2026-08-15T14:30");
  });

  test("devuelve null para un ISO invalido", () => {
    expect(isoToZonedDateTimeLocal("not-a-date", "Europe/Madrid")).toBeNull();
  });
});

describe("isZonedDateTimeInPast", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  test("es true cuando la hora local ya paso en esa zona", () => {
    expect(isZonedDateTimeInPast("2026-08-15T13:00", "Europe/Madrid", now)).toBe(true);
  });

  test("es false cuando la hora local todavia no llega en esa zona", () => {
    expect(isZonedDateTimeInPast("2026-08-15T15:00", "Europe/Madrid", now)).toBe(false);
  });

  test("es false para un valor vacio o ausente", () => {
    expect(isZonedDateTimeInPast("", "Europe/Madrid", now)).toBe(false);
    expect(isZonedDateTimeInPast(undefined, "Europe/Madrid", now)).toBe(false);
    expect(isZonedDateTimeInPast(null, "Europe/Madrid", now)).toBe(false);
  });

  test("es false para un valor con forma invalida", () => {
    expect(isZonedDateTimeInPast("not-a-date", "Europe/Madrid", now)).toBe(false);
  });
});
