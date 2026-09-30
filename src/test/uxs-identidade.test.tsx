import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * UXS 30/09: simplificações aprovadas da Mesa Identidade (IDV-01 a IDV-15).
 * Um jeito só de salvar (gravação automática com fila e versão do cache), o
 * que falta leva ao lugar, a barra de etapas mostra o andamento, um seletor de
 * modelo por papel, "Gerar de novo" com Desfazer, Início que volta ao
 * trabalho, prévia da estratégia com um botão, finalistas e votos que gravam
 * sozinhos, geradores recolhidos no Sistema, logo com alvo de envio e
 * "Trocar", Guideline com um primário, e o "Apresentar" que funciona em
 * qualquer aparelho.
 */

HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => undefined;

vi.mock("@/integrations/supabase/client", () => {
  const resposta = { data: [], error: null };
  const q: any = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok) : () => q),
    apply: () => q,
  });
  const bucket = { createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async () => ({ data: null, error: null }), download: async () => ({ data: null, error: new Error("sem arquivo") }), upload: async () => ({ data: null, error: null }) };
  return { supabase: { from: () => q, rpc: () => q, storage: { from: () => bucket }, auth: { getSession: async () => ({ data: { session: null } }) } } };
});

type Chamada = (f: string, corpo: Record<string, unknown>) => Promise<any>;
const padrao: Chamada = async (_f, corpo) => {
  if (corpo.acao === "briefing_montar") return { briefing: { campos: {}, lacunas: [], origem: { respondido: false, briefing_id: null } } };
  if (corpo.acao === "naming_votos") return { votos: [], resumo: {}, votacao: null };
  return {};
};
const chamar = vi.fn(padrao);
vi.mock("@/lib/mesa/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/mesa/api")>("@/lib/mesa/api");
  return { ...real, chamarFuncao: (f: string, c: Record<string, unknown>) => chamar(f, c) };
});

import { MesaProvider } from "@/components/mesa/MesaContexto";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import Etapas from "@/components/sistema/Etapas";
import { CabecalhoDaEtapa, ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import { ContextoDasGravacoes, GravacoesDaMesa, novaFilaDeGravacao, salvarNaFila } from "@/components/mesa-identidade/gravacao";
import { CHAVES } from "@/components/mesa-identidade/identidadeApi";
import EtapaBriefing, { valorParaSalvar } from "@/components/mesa-identidade/EtapaBriefing";
import EtapaEstrategia from "@/components/mesa-identidade/EtapaEstrategia";
import EtapaPesquisa, { jaGuardada } from "@/components/mesa-identidade/EtapaPesquisa";
import EtapaSistema from "@/components/mesa-identidade/EtapaSistema";
import EtapaConceito from "@/components/mesa-identidade/EtapaConceito";
import EtapaEntrega from "@/components/mesa-identidade/EtapaEntrega";
import EtapaInicio from "@/components/mesa-identidade/EtapaInicio";
import EtapaApresentacao from "@/components/mesa-identidade/EtapaApresentacao";
import EtapaGuideline from "@/components/mesa-identidade/EtapaGuideline";
import VotacaoDosNomes from "@/components/mesa-identidade/VotacaoDosNomes";
import EstudioDeNomes from "@/components/mesa-identidade/EstudioDeNomes";
import { ETAPAS_DA_IDENTIDADE, destinoDoQueFalta, etapaFeita, etapasDoProjeto, faltaComDestino, faltaNaEtapa } from "../../supabase/functions/_shared/identidade-etapas";
import { faltaNaEstrategia } from "../../supabase/functions/_shared/estrategia-de-marca";
import { normalizarBrandbook } from "../../supabase/functions/mesa-identidade/modulos/brandbook";
import { separarMinhas } from "../../supabase/functions/mesa-identidade/modulos/naming";

const C = "11111111-1111-4111-8111-111111111111";
const P = "33333333-3333-4333-8333-333333333333";

const MODELOS = [
  { id: "m-sonnet", provedor: "anthropic", modelo_api: "claude-sonnet", tipo: "texto", rotulo: "Claude Sonnet 4.5", preco_entrada_1m: 3, preco_saida_1m: 15, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["identidade", "naming"], ativo: true },
  { id: "m-gpt", provedor: "openai", modelo_api: "gpt-5-mini", tipo: "texto", rotulo: "GPT-5 mini", preco_entrada_1m: 0.25, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: [], ativo: true },
];

function projetoCom(dados: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: P, client_id: C, marca_id: null, modo: "zero", com_naming: true, titulo: "Forno", etapa: "briefing", concluidas: ["inicio"], dados, versao: 5, estado: "ativo", custo_usd: 0, criado_em: "", atualizado_em: "", ...extra } as any;
}

function arvore(filho: ReactNode, valor: ProjetoDaMesa, opcoes: { gravacoes?: GravacoesDaMesa | null; qc?: QueryClient; catalogo?: unknown[] } = {}) {
  const qc = opcoes.qc || new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const corpo = h(ProjetoProvider, { valor }, opcoes.gravacoes ? h(ContextoDasGravacoes.Provider, { value: opcoes.gravacoes }, filho) : filho);
  return h(
    MemoryRouter,
    null,
    h(
      QueryClientProvider,
      { client: qc },
      h(
        MesaProvider,
        { valor: { clientId: C, clientName: "Forno", userId: "u1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: (opcoes.catalogo || []) as any, catalogoCarregando: false, atualizarCusto: () => undefined, abrirRecarga: () => undefined, abrirChaves: () => undefined, abrirModelos: () => undefined } },
        h(ConfirmDialogProvider, null, corpo),
      ),
    ),
  );
}

function contexto(projeto: any, extra: Partial<ProjetoDaMesa> = {}): ProjetoDaMesa {
  return { projeto, salvarParte: vi.fn(async () => projeto), concluir: vi.fn(async () => undefined), reabrir: vi.fn(async () => undefined), irPara: vi.fn(), guardar: vi.fn(), ...extra } as ProjetoDaMesa;
}

beforeEach(() => {
  chamar.mockClear();
  chamar.mockImplementation(padrao);
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ------------------------------------------------------------------ IDV-03 e IDV-07: funções puras

describe("UXS: o que falta leva ao lugar (IDV-03)", () => {
  it("todo texto possível de faltaNaEtapa e de faltaNaEstrategia tem destino; o tipo de faltaNaEtapa continua string[]", () => {
    const textos: string[] = [];
    const juntar = (l: string[]) => l.forEach((t) => (textos.indexOf(t) < 0 ? textos.push(t) : undefined));
    for (const e of ETAPAS_DA_IDENTIDADE) juntar(faltaNaEtapa(e.valor, {}));
    juntar(faltaNaEtapa("conceito", { conceito: { caminhos: [{ id: "c1" }] } }));
    juntar(faltaNaEstrategia({}));
    expect(textos.length).toBeGreaterThanOrEqual(14);
    for (const t of textos) {
      expect(typeof t).toBe("string");
      expect(destinoDoQueFalta("briefing", t), t).not.toBeNull();
    }
  });

  it("destino em etapa que o projeto não tem sai; a Entrega leva ao envio na Guideline", () => {
    const completar = etapasDoProjeto({ modo: "completar", com_naming: false });
    expect(faltaComDestino("naming", {}, completar)[0].destino).toBeNull();
    expect(faltaComDestino("entrega", {}, completar)[0].destino).toEqual({ etapa: "guideline", bloco: "versao", reserva: "montar", campo: "enviar" });
    expect(faltaComDestino("briefing", {})[0]).toEqual({ texto: "O que o negócio faz", destino: { etapa: "briefing", bloco: "marca", reserva: undefined, campo: "negocio" } });
  });

  it("'Falta N' abre a lista e cada item leva ao lugar (outra etapa: abre a etapa)", async () => {
    const valor = contexto(projetoCom({}, { etapa: "entrega", concluidas: ["inicio", "briefing", "pesquisa", "estrategia", "naming", "conceito", "sistema", "mockups", "guideline", "apresentacao"] }));
    render(arvore(h(CabecalhoDaEtapa, { etapa: "entrega" }), valor));
    const falta = document.querySelector('[data-falta-da-etapa="entrega"]') as HTMLButtonElement;
    expect(falta.textContent).toBe("Falta: Enviar o brandbook para aprovação");
    // O Concluir continua o único primário, parado com o mesmo motivo no title.
    const concluir = document.querySelector('[data-concluir-etapa="entrega"]') as HTMLButtonElement;
    expect(concluir.disabled).toBe(true);
    fireEvent.click(falta);
    const item = await waitFor(() => {
      const b = document.querySelector("[data-item-que-falta]") as HTMLButtonElement | null;
      expect(b).toBeTruthy();
      return b as HTMLButtonElement;
    });
    expect(item.textContent).toBe("Enviar o brandbook para aprovação");
    fireEvent.click(item);
    await waitFor(() => expect(valor.irPara).toHaveBeenCalledWith("guideline"));
  });
});

describe("UXS: barra de etapas com o andamento (IDV-07)", () => {
  it("etapaFeita segue a regra do andamento (projeto antigo conta a Estratégia atrás de uma fechada)", () => {
    const antigo = { modo: "zero" as const, com_naming: false, concluidas: ["inicio", "briefing", "pesquisa", "naming", "conceito"] };
    expect(antigo.concluidas.indexOf("estrategia")).toBe(-1);
    expect(etapaFeita(antigo, "estrategia")).toBe(true);
    expect(etapaFeita(antigo, "sistema")).toBe(false);
  });

  it("check no lugar do número, 'concluída' para o leitor de tela; fechada apagada com aria-disabled e o clique chega", () => {
    const escolher = vi.fn();
    render(h(Etapas, { rotulo: "Etapas", numerar: true, valor: "b", onEscolher: escolher, itens: [{ valor: "a", rotulo: "Briefing", feita: true }, { valor: "b", rotulo: "Pesquisa" }, { valor: "c", rotulo: "Estratégia", fechada: true }] }));
    const a = document.querySelector('[data-etapa="a"]') as HTMLButtonElement;
    expect(a.querySelector("[data-etapa-feita]")).toBeTruthy();
    expect(a.textContent).toBe("Briefing, concluída");
    expect((document.querySelector('[data-etapa="b"]') as HTMLElement).textContent).toBe("2Pesquisa");
    const c = document.querySelector('[data-etapa="c"]') as HTMLButtonElement;
    expect(c.getAttribute("aria-disabled")).toBe("true");
    expect(c.disabled).toBe(false);
    fireEvent.click(c);
    expect(escolher).toHaveBeenCalledWith("c");
  });
});

// ------------------------------------------------------------------ IDV-01: Briefing

describe("UXS: Briefing fecha com 1 clique (IDV-01)", () => {
  it("valorParaSalvar: vazio vira null, lista por vírgula até 10, critérios só com a seção à vista", () => {
    const v = valorParaSalvar({ negocio: "  Padaria  ", personalidade: "a, b; c", concorrentes: "   " }, "som\n\nsentido", true);
    expect(v.negocio).toBe("Padaria");
    expect(v.personalidade).toEqual(["a", "b", "c"]);
    expect(v.concorrentes).toBeNull();
    expect(v.publico).toBeNull();
    expect(v.criterios_do_nome).toEqual(["som", "sentido"]);
    expect(Object.prototype.hasOwnProperty.call(valorParaSalvar({}, "x", false), "criterios_do_nome")).toBe(false);
    expect(valorParaSalvar({}, "", true).criterios_do_nome).toBeNull();
    expect((valorParaSalvar({ gosta: Array.from({ length: 14 }, (_, i) => `r${i}`).join(",") }, "", false).gosta as string[]).length).toBe(10);
  });

  it("briefing respondido: sem 'Falta', o botão vira 'Salvar e concluir' e grava tudo antes de concluir", async () => {
    chamar.mockImplementation(async (_f, corpo) => {
      if (corpo.acao === "briefing_montar")
        return {
          briefing: {
            campos: { negocio: { valor: "Padaria de fermentação natural", fonte: "briefing" }, publico: { valor: "Famílias do bairro", fonte: "briefing" }, personalidade: { valor: ["calorosa", "direta", "leve"], fonte: "briefing" } },
            lacunas: [],
            origem: { respondido: true, briefing_id: "b1" },
          },
        };
      return padrao(_f, corpo);
    });
    const ordem: string[] = [];
    const projeto = projetoCom({});
    const valor = contexto(projeto, {
      salvarParte: vi.fn(async () => {
        ordem.push("salvar");
        return projeto;
      }),
      concluir: vi.fn(async () => {
        ordem.push("concluir");
      }),
    });
    render(arvore(h(EtapaBriefing), valor, { gravacoes: new GravacoesDaMesa() }));
    await screen.findByDisplayValue("Padaria de fermentação natural");
    expect(document.querySelector("[data-falta-da-etapa]")).toBeNull();
    const botao = document.querySelector('[data-concluir-etapa="briefing"]') as HTMLButtonElement;
    expect(botao.textContent).toContain("Salvar e concluir");
    expect(botao.disabled).toBe(false);
    // A linha de estado diz que o que está na tela ainda não está no projeto.
    expect(document.querySelector('[data-gravacao="nao-salvo"]')).toBeTruthy();
    fireEvent.click(botao);
    await waitFor(() => expect(valor.concluir).toHaveBeenCalledWith("briefing"));
    expect(ordem).toEqual(["salvar", "concluir"]);
    const [parte, gravado] = (valor.salvarParte as any).mock.calls[0];
    expect(parte).toBe("briefing");
    expect(gravado.negocio).toBe("Padaria de fermentação natural");
    expect(gravado.personalidade).toEqual(["calorosa", "direta", "leve"]);
    expect(gravado.briefing_id).toBe("b1");
  });

  it("apagar vale: o campo esvaziado grava null, só ele, 800 ms depois (e o cabeçalho já diz o que falta)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const projeto = projetoCom({ briefing: { negocio: "Padaria", publico: "Bairro", personalidade: ["a", "b", "c"], segmento: "Alimentação" } });
    const valor = contexto(projeto);
    render(arvore(h(EtapaBriefing), valor, { gravacoes: new GravacoesDaMesa() }));
    const campo = (await screen.findByDisplayValue("Padaria")) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "" } });
    expect((document.querySelector('[data-falta-da-etapa="briefing"]') as HTMLElement).textContent).toBe("Falta: O que o negócio faz");
    expect(valor.salvarParte).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await vi.waitFor(() => expect(valor.salvarParte).toHaveBeenCalledTimes(1));
    const [parte, gravado] = (valor.salvarParte as any).mock.calls[0];
    expect(parte).toBe("briefing");
    expect(gravado).toEqual({ negocio: null });
  });
});

// ------------------------------------------------------------------ IDV-02: um jeito só de salvar

describe("UXS: gravação automática com fila (IDV-02)", () => {
  it("duas gravações rápidas vão em série e sem 409 (a versão sai da resposta anterior, não do render)", async () => {
    let versaoNoServidor = 3;
    const vistas: number[] = [];
    chamar.mockImplementation(async (_f, corpo) => {
      if (corpo.acao !== "projeto_salvar") return padrao(_f, corpo);
      vistas.push(corpo.versao as number);
      await new Promise((r) => setTimeout(r, 15));
      if (corpo.versao !== versaoNoServidor) throw Object.assign(new Error("Outra pessoa salvou este projeto agora."), { codigo: "versao_mudou" });
      versaoNoServidor += 1;
      return { projeto: projetoCom({ briefing: corpo.valor }, { versao: versaoNoServidor }) };
    });
    const qc = new QueryClient();
    qc.setQueryData(CHAVES.projeto(P), projetoCom({}, { versao: 3 }));
    const fila = novaFilaDeGravacao();
    // As duas saem do mesmo render (versão 3): sair do campo e clicar em Concluir.
    const a = salvarNaFila(fila, qc, P, 3, "briefing", { negocio: "A" });
    const b = salvarNaFila(fila, qc, P, 3, "briefing", { negocio: "AB" });
    const [ra, rb] = await Promise.all([a, b]);
    expect(vistas).toEqual([3, 4]);
    expect(ra.versao).toBe(4);
    expect(rb.versao).toBe(5);
    expect((qc.getQueryData(CHAVES.projeto(P)) as any).versao).toBe(5);
  });

  it("digitar durante a gravação não perde letra (e a tela nunca volta ao valor gravado)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pendentes: Array<() => void> = [];
    const projeto = projetoCom({ pesquisa: { resumo: "" } }, { etapa: "pesquisa" });
    const salvarParte = vi.fn(
      () =>
        new Promise<any>((resolver) => {
          pendentes.push(() => resolver(projeto));
        }),
    );
    render(arvore(h(EtapaPesquisa), contexto(projeto, { salvarParte }), { gravacoes: new GravacoesDaMesa() }));
    const resumo = screen.getByLabelText("Resumo da pesquisa") as HTMLTextAreaElement;
    fireEvent.change(resumo, { target: { value: "a" } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await vi.waitFor(() => expect(salvarParte).toHaveBeenCalledTimes(1));
    expect(salvarParte.mock.calls[0]).toEqual(["pesquisa", { resumo: "a" }]);
    // Ainda gravando o "a": a pessoa continua digitando.
    fireEvent.change(resumo, { target: { value: "ab" } });
    await act(async () => {
      pendentes[0]();
    });
    expect(resumo.value).toBe("ab");
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    await vi.waitFor(() => expect(salvarParte).toHaveBeenCalledTimes(2));
    expect(salvarParte.mock.calls[1]).toEqual(["pesquisa", { resumo: "ab" }]);
    await act(async () => {
      pendentes[1]();
    });
    expect(resumo.value).toBe("ab");
  });

  it("Concluir com mudança pendente grava antes de concluir (e o botão diz isso)", async () => {
    const ordem: string[] = [];
    const projeto = projetoCom(
      { estrategia: { proposito: "Pão de verdade", arquetipo: { principal: "cuidador" }, posicionamento: { publico: "bairro", diferencial: "na sua frente" }, tom: { fala_assim: ["Seu pão sai às 7h."] } } },
      { etapa: "estrategia", concluidas: ["inicio", "briefing", "pesquisa"] },
    );
    const valor = contexto(projeto, {
      salvarParte: vi.fn(async () => {
        ordem.push("salvar");
        return projeto;
      }),
      concluir: vi.fn(async () => {
        ordem.push("concluir");
      }),
    });
    render(arvore(h(EtapaEstrategia), valor, { gravacoes: new GravacoesDaMesa() }));
    const botao = document.querySelector('[data-concluir-etapa="estrategia"]') as HTMLButtonElement;
    expect(botao.textContent).toContain("Concluir etapa");
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "Missão nova" } });
    await waitFor(() => expect(botao.textContent).toContain("Salvar e concluir"));
    fireEvent.click(botao);
    await waitFor(() => expect(valor.concluir).toHaveBeenCalledWith("estrategia"));
    expect(ordem).toEqual(["salvar", "concluir"]);
    const [, gravado, opcoes] = (valor.salvarParte as any).mock.calls[0];
    expect(opcoes).toBeUndefined();
    expect(gravado.missao).toBe("Missão nova");
  });

  it("trocar de etapa com pendente grava: pela fila da etapa (salvarTudo) e, se sair sem esperar, ao desmontar", async () => {
    const projeto = projetoCom({ pesquisa: { resumo: "" } }, { etapa: "pesquisa" });
    const salvarParte = vi.fn(async () => projeto);
    const gravacoes = new GravacoesDaMesa();
    const { unmount } = render(arvore(h(EtapaPesquisa), contexto(projeto, { salvarParte }), { gravacoes }));
    const resumo = screen.getByLabelText("Resumo da pesquisa");
    fireEvent.change(resumo, { target: { value: "Todos usam trigo" } });
    expect(gravacoes.temPendente()).toBe(true);
    await act(async () => {
      await gravacoes.salvarTudo();
    });
    expect(salvarParte).toHaveBeenCalledWith("pesquisa", { resumo: "Todos usam trigo" });
    expect(gravacoes.temPendente()).toBe(false);
    fireEvent.change(resumo, { target: { value: "Todos usam trigo e rústico" } });
    unmount();
    await waitFor(() => expect(salvarParte).toHaveBeenCalledWith("pesquisa", { resumo: "Todos usam trigo e rústico" }));
  });

  it("a releitura ignora o próprio eco: a versão que sobe por outra parte não apaga o que está sendo digitado no Sistema", async () => {
    const sistema = { cores: [{ nome: "Verde", papel: "primaria", hex: "#157330" }, { nome: "Papel", papel: "neutra", hex: "#F4F6F4" }], tipografia: [{ familia: "Fraunces", uso: "titulo", pesos: [], licenca: "", alternativa: "" }] };
    const p1 = projetoCom({ sistema }, { etapa: "sistema" });
    const salvarParte = vi.fn(async () => p1);
    const { rerender } = render(arvore(h(EtapaSistema), contexto(p1, { salvarParte })));
    const nome = screen.getAllByLabelText("Nome da cor")[0] as HTMLInputElement;
    fireEvent.change(nome, { target: { value: "Verde mata" } });
    // Chega versão nova (logo enviada por outra parte): a cor em edição continua.
    const p2 = projetoCom({ sistema: { ...sistema, logos: { principal: { caminho: `${C}/marca/identidade/${P}/logo.svg`, mime: "image/svg+xml", rotulo: "" } } } }, { etapa: "sistema", versao: 6 });
    rerender(arvore(h(EtapaSistema), contexto(p2, { salvarParte })));
    expect((screen.getAllByLabelText("Nome da cor")[0] as HTMLInputElement).value).toBe("Verde mata");
    // Linha nova vazia (+ Cor) e HEX incompleto ficam na tela: só o que vai ao servidor é normalizado.
    fireEvent.click(screen.getByRole("button", { name: /Cor$/ }));
    expect(screen.getAllByLabelText("HEX").length).toBe(3);
  });
});

// ------------------------------------------------------------------ IDV-04: um seletor por papel

describe("UXS: um seletor de modelo por papel (IDV-04)", () => {
  it("o seletor do cabeçalho vale para os botões de IA longe dele, que mostram o nome do modelo", async () => {
    const projeto = projetoCom({ sistema: { cores: [], tipografia: [] } }, { etapa: "sistema" });
    render(arvore(h(EtapaSistema), contexto(projeto), { catalogo: MODELOS }));
    expect(document.querySelectorAll('[data-seletor-de-modelo="identidade"]').length).toBe(1);
    // Sem cores nem fontes salvas, os geradores nascem abertos.
    expect(screen.getByRole("button", { name: /Propor 3 paletas · Sonnet 4\.5/ })).toBeTruthy();
    fireEvent.change(document.querySelector('[data-seletor-de-modelo="identidade"]') as HTMLSelectElement, { target: { value: "m-gpt" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Propor 3 paletas · GPT-5 mini/ })).toBeTruthy());
    expect(screen.getByRole("button", { name: /Sugerir pares com IA · GPT-5 mini/ })).toBeTruthy();
  });
});

// ------------------------------------------------------------------ IDV-05: Conceito

describe("UXS: gerar de novo os caminhos (IDV-05)", () => {
  it("o rótulo diz quantos caminhos substitui e o aviso traz Desfazer, que volta o conceito de antes pela gravação da mesa", async () => {
    const conceito = { caminhos: [{ id: "c1", nome: "Forno", ideia: "calor", palavras: [], arquetipo: "", paleta: [], tipografia: { titulo: "", texto: "" }, grafismos: "", tom: [], referencias_visuais: [], riscos: "" }, { id: "c2", nome: "Bairro", ideia: "perto", palavras: [], arquetipo: "", paleta: [], tipografia: { titulo: "", texto: "" }, grafismos: "", tom: [], referencias_visuais: [], riscos: "" }], escolhido: "c1" };
    const projeto = projetoCom({ conceito }, { etapa: "conceito" });
    chamar.mockImplementation(async (_f, corpo) => (corpo.acao === "conceito_gerar" ? { projeto: projetoCom({ conceito: { caminhos: [], escolhido: null } }, { versao: 6 }), custo_usd: 0.02 } : padrao(_f, corpo)));
    const valor = contexto(projeto);
    render(arvore(h(EtapaConceito), valor, { catalogo: MODELOS }));
    fireEvent.click(screen.getByRole("button", { name: "Gerar caminhos" }));
    const botao = screen.getByRole("button", { name: /Gerar de novo \(substitui os 2\)/ });
    fireEvent.click(botao);
    await waitFor(() => expect(chamar).toHaveBeenCalledWith("mesa-identidade", expect.objectContaining({ acao: "conceito_gerar" })));
    await waitFor(() => expect(valor.guardar).toHaveBeenCalled());
  });
});

// ------------------------------------------------------------------ IDV-06: Início

describe("UXS: Início que volta ao trabalho (IDV-06)", () => {
  it("com projetos, a lista vem primeiro; 'Novo projeto' abre a criação ali mesmo; a contagem separa entregues", async () => {
    const lista = [projetoCom({}, { id: "44444444-4444-4444-8444-444444444444", titulo: "Forno", concluidas: ["inicio", "briefing"] }), projetoCom({}, { id: "55555555-5555-4555-8555-555555555555", titulo: "Café", estado: "entregue" })];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["mesa-identidade", "projetos", C, "principal"], lista);
    render(arvore(h(EtapaInicio, { projetoAberto: null, contexto: null, onAbrir: vi.fn() }), contexto(projetoCom({})), { qc }));
    expect(document.querySelector("[data-inicio-com-projetos]")).toBeTruthy();
    expect(screen.getByText("1 em andamento · 1 entregue")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Forno.*Continuar em Pesquisa$/ }).getAttribute("title")).toBe("Continuar em Pesquisa");
    expect(screen.getByRole("button", { name: /^Café.*Abrir$/ }).getAttribute("title")).toBe("Abrir");
    expect(document.querySelector("[data-modo]")).toBeNull();
    fireEvent.click(document.querySelector("[data-novo-projeto]") as HTMLButtonElement);
    expect(document.querySelectorAll("[data-modo]").length).toBe(3);
    fireEvent.click(document.querySelector('[data-modo="completar"]') as HTMLButtonElement);
    expect(document.querySelector("[data-entrada-da-marca-existente]")).toBeTruthy();
    expect(document.querySelector("[data-criar-projeto]")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-novo-projeto]") as HTMLButtonElement);
    expect(document.querySelector("[data-modo]")).toBeNull();
  });
});

// ------------------------------------------------------------------ IDV-08: Pesquisa

describe("UXS: pesquisa com IA fecha a etapa em 1 ou 2 cliques (IDV-08)", () => {
  const ia = {
    resumo: "Todo mundo usa trigo e rústico.",
    concorrentes: [{ nome: "Pão Bom", comunica: "tradição", link: "https://paobom.com" }],
    referencias: [{ titulo: "Aesop", por_que: "sóbria", link: "" }],
  };

  it("repetido não entra: o link bate ou nome e tipo batem, sem maiúsculas e espaços", () => {
    const lista = [{ titulo: " Pão Bom ", link: "https://paobom.com", nota: "", tipo: "concorrente" as const }];
    expect(jaGuardada(lista, { titulo: "outro", link: "https://paobom.com", tipo: "referencia" })).toBe(true);
    expect(jaGuardada(lista, { titulo: "pão bom", link: "", tipo: "concorrente" })).toBe(true);
    expect(jaGuardada(lista, { titulo: "pão bom", link: "", tipo: "referencia" })).toBe(false);
  });

  it("'Guardar todos' grava de uma vez; o guardado mostra 'Guardada'; 'Usar este resumo' grava o resumo", async () => {
    const projeto = projetoCom({ pesquisa: { referencias: [], resumo: "", ia } }, { etapa: "pesquisa" });
    const salvarParte = vi.fn(async () => projeto);
    render(arvore(h(EtapaPesquisa), contexto(projeto, { salvarParte })));
    fireEvent.click(document.querySelector("[data-guardar-todos]") as HTMLButtonElement);
    await waitFor(() => expect(salvarParte).toHaveBeenCalledTimes(1));
    const [parte, valor] = salvarParte.mock.calls[0] as unknown as [string, any];
    expect(parte).toBe("pesquisa");
    expect(valor.referencias.map((r: any) => r.titulo)).toEqual(["Pão Bom", "Aesop"]);
    await waitFor(() => expect(document.querySelectorAll('[data-guardar-achado="guardada"]').length).toBe(2));
    expect((document.querySelector("[data-guardar-todos]") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(document.querySelector("[data-usar-resumo-da-ia]") as HTMLButtonElement);
    await waitFor(() => expect(salvarParte).toHaveBeenCalledWith("pesquisa", { resumo: ia.resumo }));
    expect((screen.getByLabelText("Resumo da pesquisa") as HTMLTextAreaElement).value).toBe(ia.resumo);
  });
});

// ------------------------------------------------------------------ IDV-09: prévia da estratégia

describe("UXS: prévia da estratégia com um botão só (IDV-09)", () => {
  it("'Aplicar (n)' aplica os marcados substituindo; campo com texto marcado avisa 'troca o atual'", async () => {
    const projeto = projetoCom({ estrategia: { proposito: "Antigo" } }, { etapa: "estrategia" });
    chamar.mockImplementation(async (_f, corpo) => (corpo.acao === "estrategia_propor" ? { proposta: { proposito: "Novo", missao: "Missão da IA" }, fontes: ["briefing"], avisos: [], modelo_id: "m-sonnet", custo_usd: 0.1 } : padrao(_f, corpo)));
    const salvarParte = vi.fn(async () => projeto);
    render(arvore(h(EtapaEstrategia), contexto(projeto, { salvarParte }), { catalogo: MODELOS }));
    fireEvent.click(screen.getByRole("button", { name: /Preencher a estratégia inteira/ }));
    const aplicar = await waitFor(() => {
      const b = document.querySelector("[data-aplicar-proposta]") as HTMLButtonElement | null;
      expect(b).toBeTruthy();
      return b as HTMLButtonElement;
    });
    // Só o vazio (missão) vem marcado; a caixa "Substituir o que já tem" e o "Aplicar marcados" saíram.
    expect(aplicar.textContent).toContain("Aplicar (1)");
    expect(screen.queryByText("Substituir o que já tem")).toBeNull();
    expect(screen.queryByRole("button", { name: /Aplicar marcados/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Aplicar Propósito" }));
    expect(document.querySelector('[data-campo-proposto="proposito"] [data-troca-o-atual]')).toBeTruthy();
    expect(aplicar.textContent).toContain("Aplicar (2)");
    fireEvent.click(aplicar);
    await waitFor(() => expect(salvarParte).toHaveBeenCalled());
    const [, valor] = salvarParte.mock.calls[0] as unknown as [string, any];
    expect(valor.proposito).toBe("Novo");
    expect(valor.missao).toBe("Missão da IA");
  });

  it("o ícone de IA do campo some só por opacidade no computador (continua no Tab e com nome)", () => {
    const projeto = projetoCom({ briefing: {} });
    render(arvore(h(EtapaBriefing), contexto(projeto)));
    const icone = screen.getByRole("button", { name: "Preencher o que o negócio faz com IA" });
    expect(icone.className).toContain("[@media(hover:hover)_and_(min-width:768px)]:opacity-0");
    expect(icone.className).toContain("group-focus-within:opacity-100");
    expect(icone.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(icone.closest(".group")).toBeTruthy();
  });
});

// ------------------------------------------------------------------ IDV-10: naming

describe("UXS: finalistas e votos sem salvar pelo meio (IDV-10)", () => {
  it("o servidor devolve as notas de quem chamou, sem a chave de ninguém", () => {
    const { votos, minhas } = separarMinhas(
      [
        { candidato_id: "n1", origem: "equipe", nota: 4, votante: "Ana", comentario: null, atualizado_em: "2", chave: "u1" },
        { candidato_id: "n1", origem: "equipe", nota: 2, votante: "Ana", comentario: null, atualizado_em: "1", chave: "u1" },
        { candidato_id: "n2", origem: "equipe", nota: 5, votante: "Bia", comentario: null, atualizado_em: "1", chave: "u2" },
        { candidato_id: "n2", origem: "cliente", nota: 3, votante: "Cliente", comentario: null, atualizado_em: "1", chave: "u1" },
      ],
      "u1",
    );
    expect(minhas).toEqual({ n1: 4 });
    expect(votos.every((v) => !Object.prototype.hasOwnProperty.call(v, "chave"))).toBe(true);
  });

  it("as estrelas mostram o voto da pessoa e cada estrela grava na hora (sem 'Registrar meu voto')", async () => {
    const candidatos = ["n1", "n2", "n3"].map((id) => ({ id, nome: id.toUpperCase(), tecnica: "evocativo", justificativa: "", nota: 0.5, finalista: true, filtros: { com_br: "nao_conferido", com: "nao_conferido", arroba: "", link_instagram: "", link_inpi: "" } }));
    const rodada = { id: "r1", client_id: C, marca_id: null, projeto_id: P, campanha_id: null, alvo: "marca", pedido: null, criterios: [], tecnicas: [], candidatos, escolhido: null, status: "rascunho", arquivo_pdf_id: null, mensagem_grupo: null, enviado_grupo_em: null, aviso_jev: null, custo_usd: 0, criado_em: "" } as any;
    chamar.mockImplementation(async (_f, corpo) => {
      if (corpo.acao === "naming_votos") return { votos: [], resumo: {}, votacao: null, minhas: { n2: 3 } };
      if (corpo.acao === "naming_votar") return { resumo: {} };
      return padrao(_f, corpo);
    });
    render(arvore(h(VotacaoDosNomes, { rodada }), contexto(projetoCom({}))));
    const grupo = await screen.findByRole("radiogroup", { name: "Seu voto em N2" });
    await waitFor(() => expect(within(grupo).getByRole("radio", { name: "3 de 5" }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.queryByRole("button", { name: /Registrar meu voto/ })).toBeNull();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Seu voto em N1" })).getByRole("radio", { name: "5 de 5" }));
    await waitFor(() => expect(chamar).toHaveBeenCalledWith("mesa-identidade", expect.objectContaining({ acao: "naming_votar", votos: [{ candidato_id: "n1", nota: 5 }] })));
  });

  it("marcar 3 finalistas grava sozinho 600 ms depois do último clique, só a última marcação", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const candidatos = ["n1", "n2", "n3", "n4"].map((id) => ({ id, nome: id.toUpperCase(), tecnica: "evocativo", justificativa: "", nota: 0.5, finalista: false, filtros: { com_br: "nao_conferido", com: "nao_conferido", arroba: "", link_instagram: "", link_inpi: "" } }));
    const rodada = { id: "r1", client_id: C, marca_id: null, projeto_id: P, campanha_id: null, alvo: "marca", pedido: null, criterios: ["som"], tecnicas: ["evocativo"], candidatos, escolhido: null, status: "rascunho", arquivo_pdf_id: null, mensagem_grupo: null, enviado_grupo_em: null, aviso_jev: null, custo_usd: 0, criado_em: "" };
    chamar.mockImplementation(async (_f, corpo) => (corpo.acao === "naming_finalistas" ? { rodada: { ...rodada, candidatos: candidatos.map((c) => ({ ...c, finalista: (corpo.ids as string[]).indexOf(c.id) >= 0 })) } } : padrao(_f, corpo)));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(CHAVES.rodadas(C, `p:${P}`), [rodada]);
    render(arvore(h(EstudioDeNomes, { alvo: "marca", projetoId: P }), contexto(projetoCom({})), { qc }));
    for (const n of ["N1", "N2", "N3"]) fireEvent.click(screen.getByRole("checkbox", { name: `Finalista: ${n}` }));
    expect(screen.queryByRole("button", { name: /Salvar finalistas/ })).toBeNull();
    expect(document.querySelector("[data-motivo-parado]")!.textContent).toBe("Salvando finalistas");
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    await vi.waitFor(() => expect(chamar).toHaveBeenCalledWith("mesa-identidade", expect.objectContaining({ acao: "naming_finalistas", rodada_id: "r1", ids: ["n1", "n2", "n3"] })));
    expect(chamar.mock.calls.filter((c) => c[1].acao === "naming_finalistas").length).toBe(1);
    // A rodada nova começa com as escolhas da última (e dá para voltar ao briefing).
    fireEvent.click(screen.getByRole("button", { name: "Gerar nomes" }));
    expect(document.querySelector("[data-da-rodada-anterior]")).toBeTruthy();
    expect((screen.getByDisplayValue("som") as HTMLTextAreaElement).value).toBe("som");
  });
});

// ------------------------------------------------------------------ IDV-12: logo

describe("UXS: logo com alvo de envio e Trocar (IDV-12)", () => {
  it("slot vazio: a caixa tracejada é um botão de envio (arrastar e soltar passa pela mesma validação); com logo, 'Trocar'", () => {
    const projeto = projetoCom({ sistema: { logos: { principal: { caminho: `${C}/marca/identidade/${P}/logo.svg`, mime: "image/svg+xml", rotulo: "" } } } }, { etapa: "sistema" });
    const valor = contexto(projeto);
    render(arvore(h(EtapaSistema), valor));
    expect(screen.getByRole("button", { name: "Trocar logotipo principal" })).toBeTruthy();
    const zona = screen.getByRole("button", { name: "Enviar logotipo secundário" });
    expect(zona.getAttribute("data-zona-da-logo")).toBe("secundario");
    expect(zona.textContent).toContain("Enviar SVG ou PNG");
    // Arquivo que não é logo: recusado pela mesma validação (nada é enviado).
    fireEvent.drop(zona, { dataTransfer: { files: [new File(["x"], "nota.txt", { type: "text/plain" })] } });
    expect(valor.salvarParte).not.toHaveBeenCalled();
    expect(chamar.mock.calls.filter((c) => c[1].acao === "projeto_salvar").length).toBe(0);
  });
});

// ------------------------------------------------------------------ IDV-13: Guideline

describe("UXS: Guideline com um primário (IDV-13)", () => {
  it("'Enviar para aprovação' é o primário, os downloads ficam no 'Baixar' e sem logo o motivo aparece na tela", async () => {
    const dados = normalizarBrandbook({ marca: { nome: "Forno" } }, C);
    const projeto = projetoCom({ guideline: { brandbook_id: "bb1" } }, { etapa: "guideline" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(CHAVES.brandbooks(P), [{ id: "bb1", projeto_id: P, modelo: "prancha", versao: 1, dados, nota: null, status: "rascunho", arquivo_pdf_id: null, token_publico: null, publicado_em: null, revogado_em: null, criado_em: "" }]);
    render(arvore(h(EtapaGuideline), contexto(projeto), { qc }));
    const enviar = (await waitFor(() => document.querySelector("[data-enviar-brandbook]"))) as HTMLButtonElement;
    expect(enviar.textContent).toContain("Enviar para aprovação");
    expect(enviar.className).toContain("bg-primary");
    expect(enviar.disabled).toBe(true);
    expect(document.querySelector("[data-falta-no-brandbook]")!.textContent).toContain("Sem a logo principal");
    expect(screen.getByRole("button", { name: /Baixar/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Baixar PDF/ })).toBeNull();
  });
});

// ------------------------------------------------------------------ IDV-15: Apresentar

describe("UXS: Apresentar em qualquer aparelho (IDV-15)", () => {
  it("abre a camada (tela cheia própria), toque na metade direita avança, Esc fecha e o foco volta", async () => {
    const projeto = projetoCom({ naming: { nome: "Forno Vivo" }, estrategia: { proposito: "Pão de verdade" } }, { etapa: "apresentacao" });
    render(arvore(h(EtapaApresentacao), contexto(projeto)));
    const apresentar = document.querySelector("[data-apresentar]") as HTMLButtonElement;
    fireEvent.click(apresentar);
    const camada = document.querySelector("[data-camada-da-apresentacao]") as HTMLElement;
    expect(camada).toBeTruthy();
    expect(camada.getAttribute("data-tela-cheia")).toBe("sim");
    const contador = () => (document.querySelector("[data-contador-da-apresentacao]") as HTMLElement).textContent;
    expect(contador()).toMatch(/^1 \/ \d+$/);
    // jsdom: largura 0 no retângulo, então o clique em x=10 cai na "direita" (>= metade de 0).
    fireEvent.click(camada, { clientX: 10 });
    expect(contador()).toMatch(/^2 \/ \d+$/);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(contador()).toMatch(/^1 \/ \d+$/);
    // O Fechar não avança o slide.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-camada-da-apresentacao]")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(apresentar));
  });
});

// ------------------------------------------------------------------ IDV-03: Entrega

describe("UXS: Entrega com linhas que levam ao lugar (IDV-03)", () => {
  it("linha pendente abre a etapa certa; o link das Aprovações continua à vista", () => {
    const projeto = projetoCom({}, { etapa: "entrega", concluidas: ["inicio", "briefing", "pesquisa", "estrategia", "naming", "conceito", "sistema", "mockups", "guideline", "apresentacao"] });
    const valor = contexto(projeto);
    render(arvore(h(EtapaEntrega), valor));
    fireEvent.click(document.querySelector('[data-item-da-entrega="Estratégia da marca"]') as HTMLButtonElement);
    expect(valor.irPara).toHaveBeenCalledWith("estrategia");
    expect(screen.getByRole("link", { name: "abrir Aprovações" })).toBeTruthy();
  });
});
