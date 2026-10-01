import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Frente IDR (30/09): "deixe mais inteligente o motor e mais organizado ali
 * da identidade visual, mas curti o fluxo". O fio da marca (direção por
 * arquétipo nos pedidos, conferência por código e pelo Jev) e a linha no alto
 * das etapas, sem mudar o fluxo.
 */

vi.mock("@/integrations/supabase/client", () => {
  const resposta = { data: [], error: null };
  const q: any = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok) : () => q),
    apply: () => q,
  });
  const bucket = { createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }), download: async () => ({ data: null, error: new Error("sem arquivo") }), upload: async () => ({ data: null, error: null }) };
  return { supabase: { from: () => q, rpc: () => q, storage: { from: () => bucket }, auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) } } };
});

const chamadas: Array<{ f: string; corpo: Record<string, unknown> }> = [];
let respostaDaCoerencia: Record<string, unknown> = {};
vi.mock("@/lib/mesa/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/mesa/api")>("@/lib/mesa/api");
  return {
    ...real,
    chamarFuncao: async (f: string, corpo: Record<string, unknown>) => {
      chamadas.push({ f, corpo });
      return respostaDaCoerencia;
    },
  };
});

import {
  conferirPorCodigo,
  DIRECAO_DO_ARQUETIPO,
  direcaoParaPrompt,
  estadoParaOJev,
  fioDaMarca,
  juntarCoerencia,
  notaDaResposta,
  perfilDaPaleta,
  perguntasDaCoerencia,
} from "../../supabase/functions/mesa-identidade/modulos/coerencia-da-marca";
import { ARQUETIPOS } from "../../supabase/functions/_shared/estrategia-de-marca";
import { notaDoScore as notaDoScoreDoNome } from "../../supabase/functions/mesa-identidade/modulos/naming";
import { MesaProvider } from "@/components/mesa/MesaContexto";
import { ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import FioDaMarca, { coerenciaDaTela } from "@/components/mesa-identidade/FioDaMarca";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const estrategiaSabia = {
  arquetipo: { principal: "sabio", secundario: "", justificativa: "ensina" },
  posicionamento: { declaracao: "Para gestores, a Clara é a consultoria que explica antes de vender.", diferencial: "explica antes de vender" },
  tom: { atributos: ["clara", "serena"] },
  personalidade: { tracos: ["credível"] },
};

function dadosCompletos(extra: Record<string, unknown> = {}) {
  return {
    estrategia: estrategiaSabia,
    naming: { nome: "Clara Consultoria", slogan: "Entenda antes de decidir" },
    sistema: {
      cores: [
        { nome: "Marinho", papel: "primaria", hex: "#1B2A4A" },
        { nome: "Azul", papel: "secundaria", hex: "#3A6EA5" },
        { nome: "Gelo", papel: "neutra", hex: "#F2F4F7" },
      ],
      tipografia: [
        { familia: "Merriweather", uso: "titulo" },
        { familia: "Inter", uso: "texto" },
      ],
    },
    ...extra,
  };
}

describe("direção por arquétipo e perfil da paleta", () => {
  it("todo arquétipo tem direção de cor, letra e nome", () => {
    for (const a of ARQUETIPOS) {
      const d = DIRECAO_DO_ARQUETIPO[a.valor];
      expect(d, a.valor).toBeTruthy();
      expect(d.cor.ideia.length).toBeGreaterThan(8);
      expect(d.letra.preferidas.length).toBeGreaterThan(0);
      expect(d.nome.length).toBeGreaterThan(4);
    }
  });

  it("perfil da paleta: temperatura, saturação e luz pelas cores com cor (neutras fora)", () => {
    expect(perfilDaPaleta([{ hex: "#1B2A4A", papel: "primaria" }, { hex: "#3A6EA5", papel: "secundaria" }, { hex: "#F2F4F7", papel: "neutra" }])).toMatchObject({ temperatura: "fria", luz: "escura" });
    expect(perfilDaPaleta([{ hex: "#FF3B1F", papel: "primaria" }, { hex: "#FFB000", papel: "destaque" }])).toMatchObject({ temperatura: "quente", saturacao: "alta" });
    expect(perfilDaPaleta([{ hex: "#EEEEEE", papel: "neutra" }])).toBeNull();
  });

  it("a direção vai no pedido com o que já foi decidido (nome, cores da logo, paleta e fontes)", () => {
    const f = fioDaMarca({ ...dadosCompletos(), leitura_da_logo: { cores: [{ hex: "#042E5F", parte: 0.4 }] } });
    const d = direcaoParaPrompt(f)!;
    expect(d.arquetipo).toBe("Sábio");
    expect(String(d.letra)).toMatch(/evitar manuscrita, display/i);
    expect((d.ja_decidido as any).nome).toBe("Clara Consultoria");
    expect((d.ja_decidido as any).cores_da_logo).toEqual(["#042E5F"]);
    expect(direcaoParaPrompt(fioDaMarca({}))).toBeNull();
  });
});

describe("conferência por código", () => {
  it("sistema coerente com o Sábio passa sem aviso", () => {
    const itens = conferirPorCodigo(fioDaMarca(dadosCompletos()));
    expect(itens.map((i) => [i.dimensao, i.situacao])).toEqual([
      ["estrategia", "ok"],
      ["nome", "ok"],
      ["paleta", "ok"],
      ["tipografia", "ok"],
      ["tagline", "ok"],
    ]);
  });

  it("paleta quente e saturada, letra manuscrita no texto e cor da logo fora: cada aviso diz por quê", () => {
    const dados = dadosCompletos({
      sistema: {
        cores: [
          { nome: "Fogo", papel: "primaria", hex: "#FF3B1F" },
          { nome: "Sol", papel: "destaque", hex: "#FFB000" },
        ],
        tipografia: [
          { familia: "Inter", uso: "titulo" },
          { familia: "Dancing Script", uso: "texto" },
        ],
      },
      leitura_da_logo: { cores: [{ hex: "#042E5F", parte: 0.6 }] },
    });
    const itens = conferirPorCodigo(fioDaMarca(dados));
    const paleta = itens.filter((i) => i.dimensao === "paleta")[0];
    expect(paleta.situacao).toBe("atencao");
    expect(paleta.motivos.join(" ")).toMatch(/quente; o arquétipo Sábio costuma pedir/);
    expect(paleta.motivos.join(" ")).toMatch(/Sem neutra/);
    expect(paleta.motivos.join(" ")).toMatch(/cor principal da logo \(#042E5F/);
    const letra = itens.filter((i) => i.dimensao === "tipografia")[0];
    expect(letra.motivos.join(" ")).toMatch(/Dancing Script é manuscrita: texto corrido pede uma família de leitura/);
    expect(letra.motivos.join(" ")).toMatch(/destoa do Sábio/);
  });

  it("o que falta aparece como falta (e leva à etapa certa)", () => {
    const itens = conferirPorCodigo(fioDaMarca({}));
    expect(itens.every((i) => i.situacao === "falta")).toBe(true);
    expect(itens.filter((i) => i.dimensao === "nome")[0].etapa).toBe("naming");
    expect(itens.filter((i) => i.dimensao === "paleta")[0].etapa).toBe("sistema");
  });
});

describe("Jev: perguntas, nota e junção", () => {
  it("uma pergunta Score por peça que existe, mais o conjunto; o estado fala em palavras, não só em hex", () => {
    const f = fioDaMarca(dadosCompletos());
    const q = perguntasDaCoerencia(f);
    expect(Object.keys(q)).toEqual(["nome", "paleta", "tipografia", "tagline", "conjunto"]);
    for (const k of Object.keys(q)) {
      expect(q[k].type).toBe("score");
      expect((q[k] as any).criteria).toHaveLength(5);
    }
    const e = estadoParaOJev(f) as any;
    expect(e.identidade.paleta[0]).toMatch(/Marinho \(/);
    expect(e.identidade.tipografia[0]).toMatch(/Merriweather para titulo, serifada/i);
    expect(Object.keys(perguntasDaCoerencia(fioDaMarca({})))).toEqual([]);
  });

  it("nomes e slogans: a nota usa a legenda do Jev (0 a 4 na API real); sem legenda, 1 a 5 como antes", () => {
    expect(notaDoScoreDoNome({ score: 3.27, legend: { "0": "", "1": "", "2": "", "3": "", "4": "" } })).toBeCloseTo(0.8175, 4);
    expect(notaDoScoreDoNome({ score: 0.6, legend: { "0": "", "1": "", "2": "", "3": "", "4": "" } })).toBeCloseTo(0.15, 4);
    expect(notaDoScoreDoNome({ score: 3 })).toBe(0.5);
  });

  it("nota pela legenda (0 a 4 ou 1 a 5) e nula sem score", () => {
    expect(notaDaResposta({ score: 3, legend: { "0": "a", "1": "b", "2": "c", "3": "d", "4": "e" } })).toBe(0.75);
    expect(notaDaResposta({ score: 3, probabilities: { "1": 0, "2": 0, "3": 1, "4": 0, "5": 0 } })).toBe(0.5);
    expect(notaDaResposta({ score: 2 })).toBe(0.5);
    expect(notaDaResposta(undefined)).toBeNull();
  });

  it("junta com pesos no código; nota baixa vira aviso com o motivo", () => {
    const f = fioDaMarca(dadosCompletos());
    const legenda = { "0": "", "1": "", "2": "", "3": "", "4": "" };
    const c = juntarCoerencia(conferirPorCodigo(f), {
      nome: { score: 4, legend: legenda },
      paleta: { score: 1, legend: legenda },
      tipografia: { score: 3, legend: legenda },
      tagline: { score: 3, legend: legenda },
      conjunto: { score: 3, legend: legenda },
    }, "2026-09-30T20:00:00Z");
    expect(c.jev).toBe(true);
    // 1*0,25 + 0,25*0,25 + 0,75*0,2 + 0,75*0,1 + 0,75*0,2 = 0,6875 (os pesos somam 1)
    expect(c.nota).toBe(69);
    const paleta = c.itens.filter((i) => i.dimensao === "paleta")[0];
    expect(paleta.situacao).toBe("atencao");
    expect(paleta.motivos.join(" ")).toMatch(/pouca ligação com a estratégia \(nota 25/);
    expect(c.itens.filter((i) => i.dimensao === "conjunto")[0].nota_jev).toBe(0.75);
    const semJev = juntarCoerencia(conferirPorCodigo(f), null, undefined, "fora do ar");
    expect(semJev.nota).toBeNull();
    expect(semJev.aviso).toBe("fora do ar");
  });
});

describe("o motor usa o fio (servidor)", () => {
  it("paletas, fontes e estratégia recebem a direção e a logo; as propostas voltam com a nota do Jev", () => {
    const e = ler("supabase/functions/mesa-identidade/estrategia-acoes.ts");
    expect(e).toContain("direcao_da_marca: direcao,");
    expect(e).toContain('const ranking = await ranquearPropostas(ch, p, brutas, (x) => {');
    expect(e).toContain('"O par de fontes");');
    expect(e).toContain("Siga direcao_da_marca (a cor que o arquétipo pede)");
    expect(e).toContain('{ marca: marca || p.marca_id, area: "identidade" }');
    const n = ler("supabase/functions/mesa-identidade/naming-acoes.ts");
    expect(n).toContain("som_do_nome: (direcaoDoArquetipo(est.arquetipo.principal) || { nome: null }).nome,");
    const i = ler("supabase/functions/mesa-identidade/index.ts");
    expect(i).toContain("coerencia_conferir: coerenciaConferir,");
    expect(i).toMatch(/"logo_ler", "coerencia_conferir"/);
    const c = ler("supabase/functions/mesa-identidade/coerencia-acoes.ts");
    expect(c).toContain("await cobrarJev(r, {");
    expect(c).toContain("AVISO_SEM_JEV");
  });

  it("esquema grande demais no OpenRouter: uma nova tentativa em modo JSON (a estratégia parava em 30/09)", () => {
    const m = ler("supabase/functions/_shared/ia-motor.ts");
    expect(m).toContain("export function ehEsquemaGrandeDemais(err: unknown): boolean {");
    expect(m).toContain('emJson.response_format = { type: "json_object" };');
    expect(m).toMatch(/grammar is too large/);
  });
});

// ------------------------------------------------------------------ a tela

const C = "11111111-1111-4111-8111-111111111111";
function projetoBase(dados: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: "22222222-2222-4222-8222-222222222222", client_id: C, marca_id: null, modo: "zero", com_naming: true, titulo: "Clara", etapa: "sistema", concluidas: ["inicio", "briefing", "pesquisa", "estrategia", "naming", "conceito"], dados, versao: 3, estado: "ativo", custo_usd: 0, criado_em: "2026-09-30T10:00:00Z", atualizado_em: "2026-09-30T19:00:00Z", ...extra } as any;
}

function montar(projeto: any, filho: ReactNode, guardar = vi.fn(), irPara = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const valor: ProjetoDaMesa = { projeto, salvarParte: vi.fn(async () => projeto), concluir: vi.fn(), reabrir: vi.fn(), irPara, guardar };
  return render(
    h(MemoryRouter, null,
      h(QueryClientProvider, { client: qc },
        h(MesaProvider, { valor: { clientId: C, clientName: "Clara", userId: null, isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: () => undefined, abrirRecarga: () => undefined, abrirChaves: () => undefined, abrirModelos: () => undefined } as any },
          h(ProjetoProvider, { valor }, filho)))),
  );
}

describe("a tela: fio da marca", () => {
  it("uma linha com nome, arquétipo, cores e fontes; a janela central mostra cada peça e confere com o Jev", async () => {
    const guardar = vi.fn();
    const p = projetoBase(dadosCompletos({ sistema: { ...dadosCompletos().sistema, cores: [{ nome: "Fogo", papel: "primaria", hex: "#FF3B1F" }, { nome: "Sol", papel: "destaque", hex: "#FFB000" }] } }));
    const { container } = montar(p, h(FioDaMarca), guardar);
    const fio = container.querySelector("[data-fio-da-marca]") as HTMLElement;
    expect(fio).toBeTruthy();
    expect(fio.textContent).toMatch(/Clara Consultoria/);
    expect(fio.textContent).toMatch(/Sábio/);
    expect(fio.textContent).toMatch(/Merriweather \+ Inter/);
    expect(fio.textContent).toMatch(/1 para conferir/);
    fireEvent.click(container.querySelector("[data-abrir-coerencia]") as HTMLElement);
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByText("Coerência da marca")).toBeTruthy();
    expect(janela.querySelector('[data-dimensao="paleta"]')!.getAttribute("data-situacao")).toBe("atencao");
    expect(janela.querySelector('[data-direcao-do-arquetipo="sabio"]')).toBeTruthy();
    const salva = { nota: 64, itens: [{ dimensao: "conjunto", rotulo: "Conjunto", situacao: "ok", motivos: [], etapa: "sistema", nota_jev: 0.7 }], jev: true, aviso: null, em: "2026-09-30T20:00:00Z" };
    respostaDaCoerencia = { projeto: { ...p, dados: { ...p.dados, coerencia: salva } }, coerencia: salva, custo_usd: 0.0001 };
    fireEvent.click(within(janela).getByRole("button", { name: /Conferir com o Jev/ }));
    await waitFor(() => expect(guardar).toHaveBeenCalled());
    expect(chamadas.filter((c) => c.corpo.acao === "coerencia_conferir")[0].corpo).toEqual({ acao: "coerencia_conferir", projeto_id: p.id });
  });

  it("a coerência gravada vale até o projeto mudar; o código é sempre o de agora", () => {
    const salva = { nota: 80, itens: [{ dimensao: "paleta", rotulo: "Paleta", situacao: "atencao", motivos: ["O Jev vê pouca ligação com a estratégia (nota 30 de 100)."], etapa: "sistema", nota_jev: 0.3 }], jev: true, aviso: null, em: "2026-09-30T18:00:00Z" };
    const r = coerenciaDaTela(projetoBase({ ...dadosCompletos(), coerencia: salva }));
    expect(r.desatualizada).toBe(true);
    expect(r.coerencia.nota).toBe(80);
    const paleta = r.coerencia.itens.filter((i) => i.dimensao === "paleta")[0];
    expect(paleta.situacao).toBe("atencao");
    expect(paleta.nota_jev).toBe(0.3);
  });

  it("a página põe o fio no alto de cada etapa, sob demanda", () => {
    const pagina = ler("src/pages/MesaIdentidade.tsx");
    expect(pagina).toContain('const FioDaMarca = lazy(() => import("@/components/mesa-identidade/FioDaMarca"));');
    expect(pagina).toMatch(/<FioDaMarca \/>\s*<\/Suspense>\s*\{etapa === "briefing" && <EtapaBriefing \/>\}/);
  });
});

describe("a tela: logo limpa no Sistema", () => {
  it("bitmap ganha o botão Limpar fundo; a janela abre sob demanda e a versão limpa entra com Desfazer", () => {
    const s = ler("src/components/mesa-identidade/EtapaSistema.tsx");
    expect(s).toContain('const RecorteDaLogo = lazy(() => import("./RecorteDaLogo"));');
    expect(s).toContain("data-limpar-logo={slot}");
    expect(s).toContain('toast.success("Logo limpa no lugar", { duration: 10_000, action: { label: "Desfazer"');
    expect(s).toContain(".then((m) => m.precisaLimpar(arquivo))");
    const r = ler("src/components/mesa-identidade/RecorteDaLogo.tsx");
    // A conta (revisão de 01/10) mora em src/lib/recorte e roda no worker; a janela só pede e mostra.
    expect(r).toContain('limparForaDaTela({ op: "limpar", data: lida.data, largura: lida.largura, altura: lida.altura, furos })');
    expect(ler("src/lib/recorte/contaDaLimpeza.ts")).toContain("recortarFundoSolido(img, { cor: dg.fundo.cor, tolerancia: toleranciaDoFundo(dg.fundo.ruido), furos:");
    expect(r).toContain("titulo=\"Limpar o fundo da logo\"");
  });
});
