import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { JsonTreeBlock } from "./json-tree-block";

describe("JsonTreeBlock progressive materialization", () => {
  it("no lee valores de objeto fuera de la página visible", () => {
    const readKeys = new Set<string>();
    const source = Object.fromEntries(
      Array.from({ length: 150 }, (_, index) => [`field-${index}`, index]),
    );
    const value = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === "string" && property.startsWith("field-")) {
          readKeys.add(property);
        }
        return Reflect.get(target, property, receiver);
      },
    });

    render(
      <JsonTreeBlock
        value={value}
        defaultOpenDepth={1}
        constrainHeight={false}
      />,
    );

    expect(readKeys.size).toBe(100);
    expect(readKeys.has("field-149")).toBe(false);

    fireEvent.click(
      screen.getByRole("button", {
        name: /mostrar los siguientes 50/i,
      }),
    );

    expect(readKeys.size).toBe(150);
    expect(readKeys.has("field-149")).toBe(true);
  });

  it("solo materializa el slice visible de un array", () => {
    const readIndexes = new Set<string>();
    const source = Array.from({ length: 150 }, (_, index) => index);
    const value = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          readIndexes.add(property);
        }
        return Reflect.get(target, property, receiver);
      },
    });

    render(
      <JsonTreeBlock
        value={value}
        defaultOpenDepth={1}
        constrainHeight={false}
      />,
    );

    expect(readIndexes.size).toBe(100);
    expect(readIndexes.has("149")).toBe(false);
  });
});
