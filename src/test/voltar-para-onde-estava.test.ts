import { describe, expect, it } from "vitest";
import { chaveDoLugar, clienteDaUrl, lerLugares, lugarAnterior, lugarAtual, registrarLugar, rotuloDoLugar } from "@/lib/navegacao/lugares";

const C1 = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const C2 = "52f2efb6-9928-4074-b8e2-bc972baf1f6a";

describe("voltar para onde eu estava (29/09)", () => {
  it("dá nome curto ao lugar, com a aba da Mesa e a etapa da Mesa Ads", () => {
    expect(rotuloDoLugar("/mesa", `?client=${C1}&aba=estudio`)).toBe("Mesa · Estúdio");
    expect(rotuloDoLugar("/mesa-ads", `?client=${C1}&etapa=plano`)).toBe("Mesa Ads · Plano de teste");
    expect(rotuloDoLugar("/workspace", "")).toBe("Workspace");
    expect(rotuloDoLugar("/calendario", `?client=${C1}`)).toBe("Agenda");
    expect(rotuloDoLugar("/dashboard", "")).toBe("Dashboard");
  });

  it("não guarda login, páginas públicas nem a raiz", () => {
    expect(lugarAtual("/login", "", null, 1)).toBeNull();
    expect(lugarAtual("/briefing/abc", "", null, 1)).toBeNull();
    expect(lugarAtual("/", "", null, 1)).toBeNull();
  });

  it("o cliente vem da URL ou, sem ela, do foco do cronômetro", () => {
    expect(clienteDaUrl("/mesa", `?client=${C1}`)).toBe(C1);
    expect(clienteDaUrl(`/clientes/${C2}`, "")).toBe(C2);
    expect(lugarAtual("/central", "", C2, 1)?.cliente).toBe(C2);
  });

  it("mesmo lugar com outro filtro atualiza o endereço sem repetir; outro cliente é outro lugar", () => {
    const a = lugarAtual("/mesa", `?client=${C1}&aba=estudio`, null, 1)!;
    const a2 = lugarAtual("/mesa", `?client=${C1}&aba=estudio&task=x`, null, 2)!;
    const b = lugarAtual("/mesa", `?client=${C2}&aba=estudio`, null, 3)!;
    let lista = registrarLugar([], a);
    lista = registrarLugar(lista, a2);
    expect(lista).toHaveLength(1);
    expect(lista[0].url).toContain("task=x");
    lista = registrarLugar(lista, b);
    expect(lista.map((l) => l.cliente)).toEqual([C2, C1]);
  });

  it("o anterior é o primeiro lugar diferente do atual: Mesa → Workspace volta para a Mesa", () => {
    const mesa = lugarAtual("/mesa", `?client=${C1}&aba=estudio`, null, 1)!;
    const ws = lugarAtual("/workspace", "", C1, 2)!;
    const lista = registrarLugar(registrarLugar([], mesa), ws);
    const anterior = lugarAnterior(lista, chaveDoLugar("/workspace", "", C1));
    expect(anterior?.url).toBe(`/mesa?client=${C1}&aba=estudio`);
  });

  it("guarda no máximo 8 lugares e ignora dado guardado quebrado ou endereço externo", () => {
    let lista: ReturnType<typeof registrarLugar> = [];
    for (let i = 0; i < 12; i++) lista = registrarLugar(lista, lugarAtual(`/area${i}`, "", null, i)!);
    expect(lista).toHaveLength(8);
    expect(lerLugares("isso não é json")).toEqual([]);
    expect(lerLugares(JSON.stringify([{ url: "//evil.com", chave: "x", rotulo: "x" }]))).toEqual([]);
  });
});
