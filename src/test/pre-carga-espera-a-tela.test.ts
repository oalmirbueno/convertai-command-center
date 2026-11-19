import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPERA_MAXIMA_DA_TELA_MS, quandoOcioso } from "@/lib/lazyComPreCarga";
import { preCarregarEmSegundoPlano } from "@/lib/appRefresh";

/**
 * 19/11/2026 (painel lento): o "ocioso" do navegador é só a CPU. Em rede lenta
 * as pré-cargas (agente, mesas, todas as telas) dividiam a banda com a tela
 * que a pessoa estava esperando. Agora esperam o esqueleto sair.
 */

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("pré-carga espera a tela aberta", () => {
  it("sem esqueleto na tela: agenda no ócio como antes", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    quandoOcioso(fn);
    vi.advanceTimersByTime(1_200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("com esqueleto: só depois que ele sai", () => {
    vi.useFakeTimers();
    const esqueleto = document.createElement("div");
    esqueleto.setAttribute("aria-busy", "true");
    document.body.appendChild(esqueleto);
    const fn = vi.fn();
    quandoOcioso(fn);
    vi.advanceTimersByTime(5_000);
    expect(fn).not.toHaveBeenCalled();
    esqueleto.remove();
    vi.advanceTimersByTime(250 + 1_200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("esqueleto que nunca sai não segura a pré-carga para sempre", () => {
    vi.useFakeTimers();
    const esqueleto = document.createElement("div");
    esqueleto.setAttribute("aria-busy", "true");
    document.body.appendChild(esqueleto);
    const fn = vi.fn();
    quandoOcioso(fn);
    vi.advanceTimersByTime(ESPERA_MAXIMA_DA_TELA_MS + 250 + 1_200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancelada enquanto espera o esqueleto: não roda", () => {
    vi.useFakeTimers();
    const esqueleto = document.createElement("div");
    esqueleto.setAttribute("aria-busy", "true");
    document.body.appendChild(esqueleto);
    const fn = vi.fn();
    const cancelar = quandoOcioso(fn);
    vi.advanceTimersByTime(1_000);
    cancelar();
    esqueleto.remove();
    vi.advanceTimersByTime(ESPERA_MAXIMA_DA_TELA_MS * 2);
    expect(fn).not.toHaveBeenCalled();
  });

  it("pré-carga em segundo plano respira entre um módulo e o próximo", async () => {
    const ordem: string[] = [];
    const carregar = (n: string) => async () => {
      ordem.push(n);
    };
    const pausa = vi.fn(async () => {
      ordem.push("pausa");
    });
    const falhas = await preCarregarEmSegundoPlano([carregar("a"), carregar("b"), carregar("c")], 1, pausa);
    expect(falhas).toBe(0);
    expect(ordem).toEqual(["a", "pausa", "b", "pausa", "c"]);
  });
});
