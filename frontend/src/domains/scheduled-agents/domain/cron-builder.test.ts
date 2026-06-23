import { describe, expect, test } from "bun:test";
import {
  buildCronExpression,
  isGuidedCronConfig,
} from "./cron-builder";

describe("buildCronExpression", () => {
  test("construye una expresion semanal con varios dias sin requerir cron manual", () => {
    expect(
      buildCronExpression({
        mode: "weekly",
        daysOfWeek: [1, 3, 5],
        hour: 9,
        minute: 30,
      }),
    ).toBe("30 9 * * 1,3,5");
  });

  test("construye una expresion diaria con hora y minuto guiados", () => {
    expect(
      buildCronExpression({
        mode: "daily",
        hour: 14,
        minute: 15,
      }),
    ).toBe("15 14 * * *");
  });

  test("rechaza la configuracion semanal si no hay dias seleccionados", () => {
    expect(
      buildCronExpression({
        mode: "weekly",
        daysOfWeek: [],
        hour: 9,
        minute: 0,
      }),
    ).toBeNull();
  });
});

describe("isGuidedCronConfig", () => {
  test("detecta expresiones manejables por el constructor visual", () => {
    expect(isGuidedCronConfig("30 9 * * 1,3,5")).toBe(true);
    expect(isGuidedCronConfig("15 14 * * *")).toBe(true);
    expect(isGuidedCronConfig("*/15 * * * *")).toBe(true);
  });

  test("descarta expresiones demasiado complejas para el constructor visual", () => {
    expect(isGuidedCronConfig("0 9 1 * *")).toBe(false);
  });
});
