import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * UXS 30/09 (IDV-11): com a tipografia salva, o bloco "Gerar combinações"
 * nasce recolhido e nenhuma fonte de par baixa: só a da hierarquia (a prévia
 * do que foi escolhido). Arquivo próprio: o carregador de fontes guarda o que
 * já pediu no módulo, então a conta precisa começar do zero.
 */

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];

vi.mock("@/integrations/supabase/client", () => {
  const resposta = { data: [], error: null };
  const q: any = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok) : () => q),
    apply: () => q,
  });
  const bucket = { createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }), download: async () => ({ data: null, error: new Error("sem arquivo") }), upload: async () => ({ data: null, error: null }) };
  return { supabase: { from: () => q, rpc: () => q, storage: { from: () => bucket }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock("@/lib/mesa/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/mesa/api")>("@/lib/mesa/api");
  return { ...real, chamarFuncao: vi.fn(async () => ({})) };
});

import { MesaProvider } from "@/components/mesa/MesaContexto";
import { ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import EtapaSistema from "@/components/mesa-identidade/EtapaSistema";

const C = "11111111-1111-4111-8111-111111111111";

describe("UXS: Sistema abre leve (IDV-11)", () => {
  it("com a tipografia salva, só a fonte da hierarquia é pedida; abrir o bloco carrega os pares", () => {
    const projeto = {
      id: "33333333-3333-4333-8333-333333333333",
      client_id: C,
      marca_id: null,
      modo: "zero",
      com_naming: true,
      titulo: "Forno",
      etapa: "sistema",
      concluidas: ["inicio"],
      dados: { sistema: { cores: [{ nome: "Verde", papel: "primaria", hex: "#157330" }], tipografia: [{ familia: "Fraunces", uso: "titulo", pesos: [], licenca: "", alternativa: "" }, { familia: "Work Sans", uso: "texto", pesos: [], licenca: "", alternativa: "" }] } },
      versao: 1,
      estado: "ativo",
      custo_usd: 0,
      criado_em: "",
      atualizado_em: "",
    };
    const valor: ProjetoDaMesa = { projeto: projeto as any, salvarParte: vi.fn(async () => projeto as any), concluir: vi.fn(), reabrir: vi.fn(), irPara: vi.fn(), guardar: vi.fn() };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      h(MemoryRouter, null,
        h(QueryClientProvider, { client: qc },
          h(MesaProvider, { valor: { clientId: C, clientName: "Forno", userId: null, isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: () => undefined, abrirRecarga: () => undefined, abrirChaves: () => undefined, abrirModelos: () => undefined } },
            h(ProjetoProvider, { valor }, h(EtapaSistema))))),
    );
    const links = () => document.head.querySelectorAll("link[data-fonte-da-marca]");
    expect(links().length).toBe(1);
    expect(links()[0].getAttribute("href")).toContain("Fraunces");
    expect(document.querySelectorAll("[data-par]").length).toBe(0);
    // Com uma cor só, o gerador de paleta nasce aberto (a etapa pede 2).
    expect(document.querySelector("[data-gerador-de-paleta]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gerar combinações" }));
    expect(document.querySelectorAll("[data-par]").length).toBe(6);
    expect(links().length).toBeGreaterThan(1);
  });
});
