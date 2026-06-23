import { describe, expect, it } from "bun:test";
import { parseMultiQuestions } from "./parse-multi-questions";

describe("parseMultiQuestions", () => {
  it("prefers explicit structured grouped questions", () => {
    expect(
      parseMultiQuestions("Pregunta 1\nPregunta 2", ["A", "B", "C"], [
        { text: "Pregunta 1", options: ["A", "B"] },
        { text: "Pregunta 2", options: ["C"] },
      ]),
    ).toEqual([
      { text: "Pregunta 1", options: ["A", "B"] },
      { text: "Pregunta 2", options: ["C"] },
    ]);
  });

  it("keeps splitting multi-line free-text questions", () => {
    expect(parseMultiQuestions("Pregunta 1\nPregunta 2", [])).toEqual([
      { text: "Pregunta 1", options: [] },
      { text: "Pregunta 2", options: [] },
    ]);
  });

  it("falls back to a single combined question when flat options cannot be safely mapped", () => {
    // Even if the arithmetic split looks deterministic, a runner that
    // emitted Q1=3 + Q2=1 would have the same options array, so we refuse
    // to guess and keep the full text + all options together.
    expect(
      parseMultiQuestions("Pregunta 1\nPregunta 2", ["A1", "A2", "B1", "B2"]),
    ).toEqual([
      { text: "Pregunta 1\nPregunta 2", options: ["A1", "A2", "B1", "B2"] },
    ]);
  });

  it("collapses pilcrow-separated multi-questions to a single combined question without structured data", () => {
    expect(
      parseMultiQuestions("Pregunta 1 ¶ Pregunta 2", ["A1", "A2", "B1", "B2"]),
    ).toEqual([
      { text: "Pregunta 1 ¶ Pregunta 2", options: ["A1", "A2", "B1", "B2"] },
    ]);
  });

  it("falls back to a single question when multi-choice grouping is ambiguous", () => {
    expect(
      parseMultiQuestions("Pregunta 1\nPregunta 2", ["A", "B", "C"]),
    ).toEqual([
      { text: "Pregunta 1\nPregunta 2", options: ["A", "B", "C"] },
    ]);
  });
});
