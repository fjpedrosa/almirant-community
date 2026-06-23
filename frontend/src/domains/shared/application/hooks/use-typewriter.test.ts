import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useTypewriter } from "./use-typewriter";

const advance = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

describe("useTypewriter", () => {
  it("revela todo el contenido inmediatamente al montar con isActive=true", () => {
    const target = "Hola mundo, esto ya estaba persistido cuando reabrí el sheet";
    const { result } = renderHook(() => useTypewriter(target, true));

    expect(result.current.content).toBe(target);
    expect(result.current.isRevealing).toBe(false);
  });

  it("solo anima los caracteres añadidos después del montaje", async () => {
    const initial = "Hola mundo";
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useTypewriter(content, true),
      { initialProps: { content: initial } },
    );

    expect(result.current.content).toBe(initial);
    expect(result.current.isRevealing).toBe(false);

    const grown = `${initial}, esto es nuevo`;
    act(() => {
      rerender({ content: grown });
    });

    expect(result.current.content.length).toBeGreaterThanOrEqual(initial.length);
    expect(result.current.content.length).toBeLessThan(grown.length);

    await advance(500);

    expect(result.current.content).toBe(grown);
    expect(result.current.isRevealing).toBe(false);
  });

  it("salta al final cuando isActive cambia de false a true con contenido pre-existente", () => {
    const target = "Contenido que ya estaba antes de activarse el typewriter";
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useTypewriter(target, active),
      { initialProps: { active: false } },
    );

    expect(result.current.content).toBe(target);

    act(() => {
      rerender({ active: true });
    });

    expect(result.current.content).toBe(target);
    expect(result.current.isRevealing).toBe(false);
  });

  it("devuelve el contenido completo cuando isActive=false", () => {
    const target = "Sesión cerrada — render plano";
    const { result } = renderHook(() => useTypewriter(target, false));

    expect(result.current.content).toBe(target);
    expect(result.current.isRevealing).toBe(false);
  });

  it("resetea revealedLength cuando el contenido se vacía", async () => {
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useTypewriter(content, true),
      { initialProps: { content: "Algo" } },
    );

    expect(result.current.content).toBe("Algo");

    act(() => {
      rerender({ content: "" });
    });
    await advance(20);

    expect(result.current.content).toBe("");

    act(() => {
      rerender({ content: "Nuevo turno" });
    });
    await advance(500);

    expect(result.current.content).toBe("Nuevo turno");
  });
});
