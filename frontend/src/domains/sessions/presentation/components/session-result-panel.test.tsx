import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SessionResultPanelContainer as SessionResultPanel } from "../containers/session-result-panel-container";

const originalIntersectionObserver = globalThis.IntersectionObserver;

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds = [0];
  target: Element | null = null;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    IntersectionObserverMock.instances.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  unobserve() {}

  disconnect() {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(isIntersecting: boolean) {
    if (!this.target) throw new Error("Observer has no target");

    this.callback(
      [
        {
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          target: this.target,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

const makeCatalogue = (count: number) => ({
  storeHostname: "example.test",
  productsFound: count,
  products: Array.from({ length: count }, (_, index) => ({
    name: `Producto ${index + 1}`,
    price: index + 1,
    currency: "EUR",
  })),
});

describe("SessionResultPanel", () => {
  beforeEach(() => {
    IntersectionObserverMock.instances = [];
    globalThis.IntersectionObserver =
      IntersectionObserverMock as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver;
  });

  it("muestra un resumen compacto y mantiene el resultado completo colapsado por defecto", () => {
    const { container } = render(
      <SessionResultPanel
        payload={{
          summary: "Importación completada",
          counts: { created: 12, skipped: 2 },
        }}
      />,
    );

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText("Importación completada")).toBeInTheDocument();
    expect(screen.queryByTestId("json-tree-block")).not.toBeInTheDocument();

    fireEvent.click(container.querySelector("summary")!);
    expect(details?.open).toBe(true);
    expect(screen.getByTestId("json-tree-block")).toBeInTheDocument();
    expect(screen.getByText("counts:")).toBeInTheDocument();
  });

  it("permite expandir y volver a colapsar el resultado", () => {
    const { container } = render(
      <SessionResultPanel payload={{ status: "ok" }} />,
    );

    const details = container.querySelector("details");
    const toggle = container.querySelector("summary")!;

    fireEvent.click(toggle);
    expect(details?.open).toBe(true);
    fireEvent.click(toggle);
    expect(details?.open).toBe(false);
  });

  it("revela un único lote al alcanzar el final horizontal y anuncia el progreso", () => {
    const { container } = render(
      <SessionResultPanel payload={makeCatalogue(30)} />,
    );

    expect(
      screen.queryByTestId("result-products-carousel"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("result-product-item")).toHaveLength(0);

    fireEvent.click(container.querySelector("summary")!);

    const carousel = screen.getByTestId("result-products-carousel");
    expect(carousel).toHaveClass("flex", "overflow-x-auto");
    expect(carousel).not.toHaveClass("grid");
    expect(carousel).toHaveAttribute("role", "region");
    expect(carousel).toHaveAttribute(
      "aria-label",
      "Productos del resultado",
    );
    expect(carousel).toHaveAttribute("tabindex", "0");

    expect(screen.getAllByTestId("result-product-item")).toHaveLength(12);
    expect(screen.getAllByTestId("result-product-item")[0]).toHaveClass(
      "w-56",
      "shrink-0",
    );
    expect(
      screen.queryByRole("button", { name: /ver los siguientes/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Mostrando 12 de 30 productos",
    );

    const observer = IntersectionObserverMock.instances[0];
    expect(observer?.root).toBe(carousel);
    expect(observer?.target).toBe(
      screen.getByTestId("result-products-sentinel"),
    );

    act(() => {
      observer?.trigger(true);
      observer?.trigger(true);
    });

    expect(screen.getAllByTestId("result-product-item")).toHaveLength(24);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Mostrando 24 de 30 productos",
    );

    act(() => observer?.trigger(true));
    expect(screen.getAllByTestId("result-product-item")).toHaveLength(24);

    act(() => {
      observer?.trigger(false);
      observer?.trigger(true);
    });
    expect(screen.getAllByTestId("result-product-item")).toHaveLength(30);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Mostrando 30 de 30 productos",
    );
    expect(
      screen.queryByRole("button", { name: /ver los siguientes/i }),
    ).not.toBeInTheDocument();

    act(() => {
      observer?.trigger(false);
      observer?.trigger(true);
    });
    expect(screen.getAllByTestId("result-product-item")).toHaveLength(30);
  });

  it("mantiene la carga incremental con scroll cuando IntersectionObserver no existe", () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;

    const { container } = render(
      <SessionResultPanel payload={makeCatalogue(30)} />,
    );
    fireEvent.click(container.querySelector("summary")!);

    const carousel = screen.getByTestId("result-products-carousel");
    Object.defineProperties(carousel, {
      clientWidth: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 800 },
      scrollWidth: { configurable: true, value: 1_400 },
    });

    fireEvent.scroll(carousel);
    fireEvent.scroll(carousel);
    expect(screen.getAllByTestId("result-product-item")).toHaveLength(24);

    carousel.scrollLeft = 0;
    fireEvent.scroll(carousel);
    carousel.scrollLeft = 800;
    fireEvent.scroll(carousel);
    expect(screen.getAllByTestId("result-product-item")).toHaveLength(30);
  });

  it("delega el scroll vertical al transcript y no crea otro dentro del resultado", () => {
    render(
      <SessionResultPanel
        payload={{
          summary: "Resultado alto",
          rows: Array.from({ length: 150 }, (_, index) => ({ index })),
        }}
      />,
    );

    const resultPanel = screen.getByTestId("session-result-panel");
    expect(resultPanel).not.toHaveClass("overflow-y-auto", "overflow-auto");

    expect(screen.queryByTestId("json-tree-block")).not.toBeInTheDocument();
    fireEvent.click(resultPanel.querySelector("summary")!);

    const jsonTree = screen.getByTestId("json-tree-block");
    expect(jsonTree).not.toHaveClass("max-h-80", "overflow-auto");
    expect(jsonTree).toHaveClass("overflow-x-auto");

    fireEvent.click(screen.getByRole("button", { name: /rows:/i }));
    expect(
      screen.getByRole("button", {
        name: /mostrar los siguientes 50/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("149:")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /mostrar los siguientes 50/i,
      }),
    );

    expect(
      screen.queryByRole("button", {
        name: /mostrar los siguientes 50/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("149:")).toBeInTheDocument();
  });
});
