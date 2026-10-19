import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Laboratório: contrato tela × função (19/10/2026). A tela foi escrita pela
 * especificação antes da função; a função é a fonte da verdade. Aqui as
 * respostas têm o formato REAL de supabase/functions/laboratorio/acoes.ts
 * (e as de canvas, estimativa e planejar saem das próprias funções puras de
 * modulos/regras.ts). A chamada passa pelo chamarFuncao de verdade: só o
 * supabase.functions.invoke é simulado, com 409 de verdade (FunctionsHttpError
 * com o corpo em context) ou 200 com `error` e `status_http` (as ações com
 * fôlego: planejar, pedido_inicio, logo_gerar e no_executar).
 */

const m = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: [], isLoading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/laboratorio/estudio-livre/EstudioLivre", () => ({ default: () => <div data-testid="estudio-livre" /> }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia = (): any => {
    const c: any = new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : c),
      apply: () => c,
    });
    return c;
  };
  return {
    supabase: {
      from: () => cadeia(),
      rpc: () => cadeia(),
      functions: { invoke: m.invoke },
      storage: {
        from: () => ({
          upload: vi.fn(),
          download: () => Promise.resolve({ data: null, error: new Error("sem arquivo") }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/x" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});

import Laboratorio from "@/pages/Laboratorio";
import EditorDoProjeto from "@/components/laboratorio/EditorDoProjeto";
import { caminhoDeEntrada, custoAConfirmar, executarNo, gerarLogo, lerProjeto, rodarTudo } from "@/lib/laboratorio/api";
import { TIPOS_DE_NO as TIPOS_DA_TELA, canvasVazio, criarNo, podeLigar, type CanvasDoLab, type TipoDeNo } from "@/lib/laboratorio/nos";
import { corpoDoLogoGerar } from "@/components/mesa-identidade/identidadeApi";
import { normalizarRespostaDaLogo, type PedidoDaLogo } from "../../supabase/functions/mesa-identidade/modulos/nucleo-da-marca";
import {
  CAMPOS_DO_TIPO,
  TIPOS_DE_NO,
  aplicarOperacoes,
  canvasValido,
  ehExecutavel,
  lerPlano,
  motivoParaNaoLigar,
  normalizarCanvas,
  ordemTopologica,
  somarEstimativa,
  type Chamada,
} from "../../supabase/functions/laboratorio/modulos/regras";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (!(globalThis as any).DOMMatrixReadOnly) {
    (globalThis as any).DOMMatrixReadOnly = class {
      m22 = 1;
    };
  }
  (SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
  if (!(Element.prototype as any).hasPointerCapture) (Element.prototype as any).hasPointerCapture = () => false;
});

// ------------------------------------------------------------------ respostas no formato da função

const P = "aaaaaaaa-0000-4000-8000-000000000001";
const AGENCIA = "cccccccc-0000-4000-8000-00000000000c";
const AGORA = "2026-10-19T10:00:00.000Z";

const canvasSalvo = () =>
  normalizarCanvas({
    nos: [
      { id: "c1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Pedido", texto: "Lançamento de outubro" } },
      { id: "i1", tipo: "imagem", x: 400, y: 80, dados: { titulo: "Arte", prompt: "", quantidade: 2 } },
    ],
    ligacoes: [{ id: "lig_c1_i1", de: "c1", para: "i1" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

/** projetoDaLinha (acoes.ts). */
const linhaDoProjeto = (canvas = canvasSalvo(), versao = 3) => ({ id: P, nome: "Outubro", client_id: null, contexto: null, canvas, versao, status: "ativo", template_de: null, created_by: "u1", created_at: AGORA, updated_at: AGORA });

/** Linha de lab_execucoes (select("*")). */
const linhaDaExecucao = (o: Record<string, unknown>) => ({ id: "e0", projeto_id: P, no_id: "i1", tipo: "imagem", status: "pronto", entrada: {}, saida: null, erro: null, custo_usd: null, uso_id: null, rodada_id: null, operador_slug: null, created_by: "u1", created_at: AGORA, finished_at: AGORA, ...o });

/** Preço fixo por chamada (o precificador real lê o catálogo). */
const preco = (ch: Chamada) => (ch.tipo === "imagem" ? 0.06 * ch.imagens : 0.01);

/** estimar { projeto_id, nos? } como acoes.ts monta. */
function estimarComoAFuncao(corpo: any, canvas = canvasSalvo()) {
  const alvos = Array.isArray(corpo.nos) ? corpo.nos.map(String) : null;
  const ordem = ordemTopologica(canvas, alvos);
  const ids = alvos && alvos.length ? alvos : ordem;
  const r = somarEstimativa(canvas, ids, preco);
  return { ...r, ordem: ordem.filter((id) => { const n = canvas.nos.find((x) => x.id === id); return !!n && ehExecutavel(n.tipo); }), carteira_client_id: AGENCIA, livre: true };
}

/** O que a função manda nos erros (comum.ts: { error, mensagem, ...extra }). */
const ok = (data: unknown) => Promise.resolve({ data, error: null });
/** 4xx de verdade: o supabase-js devolve FunctionsHttpError com a Response em context. */
const http = (status: number, corpo: Record<string, unknown>) =>
  Promise.resolve({ data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError", context: new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } }) }) });
/** Ação com fôlego (respostaComFolego): o cabeçalho já saiu 200; o erro vem no corpo com status_http. */
const folego = (status: number, corpo: Record<string, unknown>) => ok({ ...corpo, status_http: status });

const confirmacao = (total: number, por_no: unknown) => ({ error: "confirmacao_necessaria", mensagem: `Isto custa cerca de US$ ${total.toFixed(4)}. Confirme para rodar.`, total_usd: total, por_no });

type Tratador = (corpo: any) => Promise<{ data: unknown; error: unknown }>;
function funcao(trocas: Record<string, Tratador> = {}) {
  m.invoke.mockImplementation((nome: string, op: { body: any }) => {
    const corpo = op.body;
    if (nome !== "laboratorio") return ok({});
    if (trocas[corpo.acao]) return trocas[corpo.acao](corpo);
    switch (corpo.acao) {
      case "projetos_listar":
        return ok({ projetos: [{ id: P, nome: "Outubro", client_id: null, cliente_nome: null, status: "ativo", versao: 3, template_de: null, nos: 2, created_by: "u1", created_at: AGORA, updated_at: AGORA }] });
      case "templates_listar":
        return ok({ templates: [] });
      case "projeto_ler":
        return ok({ projeto: linhaDoProjeto(), cliente_nome: null, execucoes: {} });
      case "projeto_salvar":
        return ok({ projeto: linhaDoProjeto(canvasValido(corpo.canvas), corpo.versao_esperada + 1) });
      case "execucoes_ler":
        return ok({ execucoes: [] });
      case "estimar":
        return ok(estimarComoAFuncao(corpo));
      default:
        return http(400, { error: "acao_desconhecida", mensagem: "Ação desconhecida." });
    }
  });
}

const corpos = (acao: string) => m.invoke.mock.calls.filter((c) => c[0] === "laboratorio" && c[1].body.acao === acao).map((c) => c[1].body);

function montarEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EditorDoProjeto projetoId={P} clientes={[]} onVoltar={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function montarPagina(inicio: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[inicio]}>
        <Routes>
          <Route path="/laboratorio" element={<Laboratorio />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const janelaDeCusto = () =>
  waitFor(() => {
    const el = document.querySelector("[data-janela-de-custo]");
    if (!el) throw new Error("sem janela de custo");
    return el as HTMLElement;
  });

async function abrirModoLista() {
  fireEvent.click(await screen.findByRole("button", { name: "Modo lista" }));
  return await waitFor(() => {
    const el = document.querySelector("[data-modo-lista-do-lab]");
    if (!el) throw new Error("sem modo lista");
    return el as HTMLElement;
  });
}

beforeEach(() => {
  m.invoke.mockReset();
  funcao();
});

// ------------------------------------------------------------------ regras iguais nos dois lados

describe("contrato: regras do canvas iguais na tela e na função", () => {
  it("toda ligação que a tela aceita a função aceita (e vice-versa), par a par", () => {
    const tipos = TIPOS_DE_NO as readonly TipoDeNo[];
    for (const de of tipos) {
      for (const para of tipos) {
        let c: CanvasDoLab = canvasVazio();
        const a = criarNo(c, de, undefined, undefined, "a");
        c = a.canvas;
        const b = criarNo(c, para, undefined, undefined, "b");
        c = b.canvas;
        const naTela = podeLigar(c, "a", "b").ok;
        const naFuncao = motivoParaNaoLigar(normalizarCanvas(c), "a", "b") === null;
        expect(naTela, `${de} → ${para}`).toBe(naFuncao);
      }
    }
  });

  it("uma Configuração por destino, como a função", () => {
    let c = canvasVazio();
    c = criarNo(c, "config", undefined, undefined, "k1").canvas;
    c = criarNo(c, "config", undefined, undefined, "k2").canvas;
    c = criarNo(c, "imagem", undefined, undefined, "r").canvas;
    c = { ...c, ligacoes: [{ id: "l1", de: "k1", para: "r" }] };
    expect(podeLigar(c, "k2", "r").ok).toBe(false);
    expect(motivoParaNaoLigar(normalizarCanvas(c), "k2", "r")).not.toBeNull();
  });

  it("os campos de cada nó têm os nomes que a função lê (CAMPOS_DO_TIPO) e o canvas da tela passa no canvasValido", () => {
    for (const t of TIPOS_DE_NO) {
      const def = TIPOS_DA_TELA[t];
      for (const campo of def.campos) expect(CAMPOS_DO_TIPO[t], `${t}.${campo.chave}`).toContain(campo.chave);
      for (const chave of Object.keys(def.padrao)) expect(CAMPOS_DO_TIPO[t], `${t}.padrao.${chave}`).toContain(chave);
    }
    let c = canvasVazio();
    for (const t of TIPOS_DE_NO) c = criarNo(c, t).canvas;
    expect(() => canvasValido(c)).not.toThrow();
  });

  it("toda ação que a tela chama existe na função", () => {
    const acoes = ler("supabase/functions/laboratorio/acoes.ts");
    const mapa = acoes.slice(acoes.indexOf("export const ACOES: Record<string, Acao> = {"));
    const existentes = mapa.slice(0, mapa.indexOf("};")).split("\n").slice(1).map((l) => l.trim().replace(/[:,].*$/, "")).filter(Boolean);
    const api = ler("src/lib/laboratorio/api.ts");
    const chamadas = (api.match(/chamar\("[a-z_]+"/g) || []).map((x) => x.slice(8, -1));
    expect(chamadas.length).toBeGreaterThan(10);
    for (const a of chamadas) expect(existentes, a).toContain(a);
    expect(ler("src/components/mesa-identidade/GeradorDeLogo.tsx")).toContain('chamarLaboratorio("logo_gerar"');
  });

  it("mídia de entrada vai para global/laboratorio/<projeto>/entradas (a equipe só grava em global/ ou client/<id>/)", () => {
    expect(caminhoDeEntrada(P, "m_1", "Foto do produto (1).PNG")).toBe(`global/laboratorio/${P}/entradas/m_1-Foto-do-produto-1-.PNG`);
    const politica = ler("supabase/migrations/20260727132145_secure_file_approval_double_gate.sql");
    expect(politica).toContain("IF _folders[1] = 'global' THEN");
    expect(ler("src/components/laboratorio/Inspetor.tsx")).toContain("caminhoDeEntrada(projetoId");
  });
});

// ------------------------------------------------------------------ estimar e confirmar

describe("contrato: custo antes de rodar", () => {
  it("estimar { por_no, total_usd, ordem } vira a janela de custo; Rodar manda no_executar com confirmado e o nó fica pronto", async () => {
    const saida = { imagens: [1, 2].map((i) => ({ path: `global/laboratorio/${P}/e1-0${i}.png`, url: `https://arquivo.test/e1-0${i}.png`, bucket: "workspace", no_workspace_id: `w${i}` })), avisos: [], usos: ["u9"], proporcao: "4:5" };
    funcao({
      no_executar: (c) =>
        c.confirmado === true
          ? folego(200, { execucao_id: "e1", execucao: linhaDaExecucao({ id: "e1", entrada: { estimativa_usd: 0.12 }, saida, custo_usd: 0.118, uso_id: "u9" }), saida })
          : folego(409, confirmacao(0.12, [])),
    });
    montarEditor();
    const lista = await abrirModoLista();
    fireEvent.click(within(lista.querySelector('[data-linha-do-no="i1"]') as HTMLElement).getAllByRole("button")[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Rodar" }));

    const janela = await janelaDeCusto();
    expect(corpos("estimar")[0]).toEqual({ acao: "estimar", projeto_id: P, nos: ["i1"] });
    expect(janela.textContent).toContain("Resultado 1");
    expect(janela.textContent).toMatch(/US\$ 0,12/);
    expect(corpos("no_executar")).toHaveLength(0);

    fireEvent.click(within(janela).getByRole("button", { name: /Rodar · US\$ 0,12/ }));
    await waitFor(() => expect(corpos("no_executar")).toHaveLength(1));
    expect(corpos("no_executar")[0]).toMatchObject({ projeto_id: P, no_id: "i1", confirmado: true });
    await waitFor(() => expect(document.querySelector('[data-linha-do-no="i1"] [data-estado-do-no="pronto"]')).not.toBeNull());
  });

  it("Rodar tudo: rodar_tudo devolve { rodada_id, ordem, execucoes: { no: id } } e cada nó nasce na fila", async () => {
    funcao({ rodar_tudo: () => ok({ rodada_id: "r1", ordem: ["i1"], execucoes: { i1: "e2" }, estimativa_usd: 0.12, status: "rodando", acompanhar: "execucoes_ler" }) });
    montarEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Rodar tudo" }));
    const janela = await janelaDeCusto();
    expect(janela.textContent).toMatch(/US\$ 0,12/);
    fireEvent.click(within(janela).getByRole("button", { name: /Rodar · / }));
    await waitFor(() => expect(corpos("rodar_tudo")).toHaveLength(1));
    expect(corpos("rodar_tudo")[0]).toMatchObject({ projeto_id: P, confirmado: true });
    await abrirModoLista();
    await waitFor(() => expect(document.querySelector('[data-linha-do-no="i1"] [data-estado-do-no="na_fila"]')).not.toBeNull());
  });

  it("409 confirmacao_necessaria (HTTP de verdade ou 200 com status_http) vira o custo a confirmar", async () => {
    const porNo = [{ no_id: "i1", tipo: "imagem", custo_usd: 0.12, chamadas: [] }];
    funcao({
      rodar_tudo: (c) => (c.confirmado === true ? ok({ rodada_id: "r1", ordem: ["i1"], execucoes: { i1: "e2" } }) : http(409, confirmacao(0.12, porNo))),
      no_executar: (c) => (c.confirmado === true ? folego(202, { execucao_id: "e3", status: "rodando", estimativa_usd: 0.12, acompanhar: "execucoes_ler" }) : folego(409, confirmacao(0.12, porNo))),
    });
    const semConfirmar = await rodarTudo(P, undefined, false).catch((e) => e);
    expect(custoAConfirmar(semConfirmar)).toEqual({ total_usd: 0.12, por_no: [{ no_id: "i1", tipo: "imagem", custo_usd: 0.12 }] });
    const r = await rodarTudo(P, undefined, true);
    expect(r.execucoes.map((e) => [e.no_id, e.id, e.status, e.rodada_id])).toEqual([["i1", "e2", "na_fila", "r1"]]);

    const noSemConfirmar = await executarNo(P, "i1", false).catch((e) => e);
    expect(custoAConfirmar(noSemConfirmar)!.total_usd).toBe(0.12);
    // Carrossel e landing: 202 { execucao_id, status: "rodando" } (a linha chega pelo execucoes_ler).
    const longo = await executarNo(P, "i1", true);
    expect([longo.id, longo.no_id, longo.status]).toEqual(["e3", "i1", "rodando"]);
  });
});

// ------------------------------------------------------------------ logo

describe("contrato: logo_gerar", () => {
  const imagens = [0, 1, 2].map((i) => ({
    path: `global/laboratorio/${P}/e9-0${i + 1}.png`,
    url: `https://arquivo.test/e9-0${i + 1}.png`,
    bucket: "workspace",
    no_workspace_id: `w${i}`,
    ordem: i + 1,
    caminho: ["geometrico", "monograma", "figurativo"][i],
    titulo: ["Símbolo geométrico", "Monograma", "Símbolo figurativo"][i],
  }));
  const respostaDaLogo = { execucao_id: "e9", projeto_id: P, imagens, escolha: { indice: 2, caminho: "figurativo", motivo: 'O Jev apontou a variação 3, "Símbolo figurativo" (62% de preferência).', confianca: 0.62 }, aviso_jev: null, avisos: [], usos: ["u1", "u2", "u3"], custo_usd: 0.17 };

  it("Logos: sem confirmado vem 409 com o custo; a janela pede confirmar e reenvia com confirmado; a grade destaca a escolha do Jev", async () => {
    funcao({ logo_gerar: (c) => (c.confirmado === true ? folego(200, respostaDaLogo) : folego(409, confirmacao(0.16, [{ no_id: null, tipo: "logo", custo_usd: 0.16 }]))) });
    montarPagina("/laboratorio?aba=logos");
    fireEvent.change(await screen.findByLabelText("Nome da marca"), { target: { value: "Café Serra" } });
    fireEvent.change(screen.getByLabelText("Quantidade de variações"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar logos" }));

    const janela = await janelaDeCusto();
    expect(janela.textContent).toMatch(/US\$ 0,16/);
    expect(corpos("logo_gerar")).toHaveLength(1);
    expect(corpos("logo_gerar")[0]).toMatchObject({ nome: "Café Serra", client_id: null, n: 3, confirmado: false });
    expect(document.querySelector("[data-variacao]")).toBeNull();

    fireEvent.click(within(janela).getByRole("button", { name: /Rodar · US\$ 0,16/ }));
    await waitFor(() => expect(document.querySelectorAll("[data-variacao]")).toHaveLength(3));
    expect(corpos("logo_gerar")[1]).toMatchObject({ nome: "Café Serra", n: 3, confirmado: true });
    const eleita = document.querySelector("[data-escolhida-do-jev]") as HTMLElement;
    expect(eleita.getAttribute("data-variacao")).toBe("2");
    expect(screen.getByText("O Jev escolheu a 3ª.")).toBeInTheDocument();
    expect(document.querySelector("[data-motivo-do-jev]")!.textContent).toMatch(/Símbolo figurativo/);
  });

  it("gerarLogo lê a resposta real: imagens com caminho, escolha { indice, motivo, confianca }", async () => {
    funcao({ logo_gerar: (c) => (c.confirmado === true ? folego(200, respostaDaLogo) : folego(409, confirmacao(0.16, []))) });
    const so = await gerarLogo({ client_id: null, nome: "X", conceito: "", paleta: "", estilo: "", n: 3 }, false);
    expect([so.variacoes.length, so.estimativa_usd]).toEqual([0, 0.16]);
    const r = await gerarLogo({ client_id: null, nome: "X", conceito: "", paleta: "", estilo: "", n: 3 }, true);
    expect(r.variacoes.map((v) => [v.indice, v.titulo, v.path])).toEqual(imagens.map((im, i) => [i, im.titulo, im.path]));
    expect(r.escolhida).toEqual({ indice: 2, motivo: respostaDaLogo.escolha.motivo, confianca: 0.62 });
    expect([r.custo_usd, r.execucao_id, r.projeto_id]).toEqual([0.17, "e9", P]);
  });

  it("Mesa Identidade: o corpo tem só campos que logo_gerar lê, com os tipos dela, e a resposta real vira a rodada", () => {
    const acoes = ler("supabase/functions/laboratorio/acoes.ts");
    const trecho = acoes.slice(acoes.indexOf("export const logoGerar"), acoes.indexOf("/** Contrato de ações"));
    const lidos = (trecho.match(/corpo\.[a-z_]+/g) || []).map((x) => x.slice(6)).concat(["confirmado"]);
    const pedido: PedidoDaLogo = {
      client_id: "11111111-1111-4111-8111-111111111111",
      nome: "Brasa",
      conceito: "Conceito: Brasa acesa. ".repeat(100),
      paleta: ["#C2410C", "#F5EFE6"],
      estilo: "símbolo + logotipo, fundo liso; ".repeat(20),
      n: 4,
      fontes: ["Fraunces (titulo)", "Inter (texto)"],
      nucleo: { nome: "Brasa" },
    };
    const corpo = corpoDoLogoGerar(pedido, `global/laboratorio/${P}/e9-01.png`);
    for (const k of Object.keys(corpo)) expect(lidos, k).toContain(k);
    expect(corpo.paleta).toBe("#C2410C, #F5EFE6");
    expect(String(corpo.conceito).length).toBeLessThanOrEqual(1500);
    expect(String(corpo.estilo).length).toBeLessThanOrEqual(300);
    expect(corpo.referencias).toEqual([`global/laboratorio/${P}/e9-01.png`]);
    // URL assinada ou caminho de fora do Laboratório não vai como referência (a função só lê global/laboratorio/).
    expect(corpoDoLogoGerar(pedido, "https://x/y.png")).not.toHaveProperty("referencias");
    expect(acoes).toContain('c.indexOf("global/laboratorio/") === 0');

    const rodada = normalizarRespostaDaLogo(respostaDaLogo, AGORA);
    expect(rodada.imagens.map((v) => v.path)).toEqual(imagens.map((i) => i.path));
    expect(rodada.jev.id).toBe(rodada.imagens[2].id);
    expect(rodada.custo_usd).toBe(0.17);
  });
});

// ------------------------------------------------------------------ planejar

describe("contrato: planejar", () => {
  it("as operações aceitas (operacao com ids reais) entram no canvas com Aplicar; a recusada só aparece; o salvo passa no canvasValido", async () => {
    const plano = lerPlano(
      {
        resposta: "Pus uma Copy de anúncio ligada ao pedido.",
        operacoes: [
          { op: "criar", ref: "copy", tipo: "copy", dados_json: JSON.stringify({ titulo: "Copy do anúncio", formato: "anuncio", cta: "Compre" }) },
          { op: "ligar", de: "c1", para: "copy" },
          { op: "gerar" },
          { op: "organizar" },
        ],
      },
      "",
    );
    const aplicado = aplicarOperacoes(canvasSalvo(), plano.operacoes);
    funcao({ planejar: () => folego(200, { resposta: plano.resposta, operacoes: aplicado.recibos, canvas_previsto: aplicado.canvas, versao: 3, custo_usd: 0.021, saldo_usd: 9.9, modelo_id: "openrouter:anthropic/claude-opus-5.5" }) });

    montarEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o agente do projeto" }));
    fireEvent.change(await screen.findByLabelText("Mensagem para o agente do projeto"), { target: { value: "põe uma copy" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar ao agente" }));

    expect(await screen.findByText('Criei Copy "Copy do anúncio". Ignorei: cta.')).toBeInTheDocument();
    expect(screen.getByText('Liguei Contexto "Pedido" → Copy "Copy do anúncio".')).toBeInTheDocument();
    expect(document.querySelector("[data-operacoes-recusadas]")!.textContent).toMatch(/Não gero nem publico/);
    const pedido = corpos("planejar")[0];
    expect(pedido).toMatchObject({ projeto_id: P, mensagem: "põe uma copy", modelo_id: "openrouter:anthropic/claude-opus-5.5" });
    expect(pedido).not.toHaveProperty("canvas");
    expect(corpos("projeto_salvar")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Aplicar no canvas" }));
    await waitFor(() => expect(corpos("projeto_salvar")).toHaveLength(1), { timeout: 6000 });
    const salvo = corpos("projeto_salvar")[0];
    expect(salvo.versao_esperada).toBe(3);
    const valido = canvasValido(salvo.canvas);
    const copy = valido.nos.find((n) => n.tipo === "copy")!;
    expect(copy.id).toBe("no_copy_3");
    expect(copy.dados).toMatchObject({ titulo: "Copy do anúncio", formato: "anuncio" });
    expect(valido.ligacoes.some((l) => l.de === "c1" && l.para === "no_copy_3")).toBe(true);
    expect(corpos("no_executar")).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ projeto_ler

describe("contrato: projeto_ler", () => {
  it("execucoes vem por nó ({ [no_id]: última }) e cada nó mostra o estado e o resultado (logo com a escolha do Jev)", async () => {
    const canvas = normalizarCanvas({
      nos: [
        { id: "c1", tipo: "contexto", x: 80, y: 80, dados: { texto: "Marca de café" } },
        { id: "l1", tipo: "logo", x: 400, y: 80, dados: { nome: "Café Serra", n: 2 } },
        { id: "i1", tipo: "imagem", x: 400, y: 260, dados: { prompt: "Arte" } },
      ],
      ligacoes: [{ id: "a", de: "c1", para: "l1" }, { id: "b", de: "c1", para: "i1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const saidaDaLogo = { imagens: [0, 1].map((i) => ({ path: `global/laboratorio/${P}/e5-0${i + 1}.png`, url: `https://arquivo.test/e5-0${i + 1}.png`, bucket: "workspace", ordem: i + 1, caminho: "geometrico", titulo: "Símbolo geométrico" })), escolha: { indice: 1, caminho: "monograma", motivo: "Monograma lê melhor pequeno.", confianca: 0.7 }, aviso_jev: null, avisos: [], usos: ["u1"] };
    funcao({
      projeto_ler: () =>
        ok({
          projeto: { ...linhaDoProjeto(canvas), client_id: "11111111-1111-4111-8111-111111111111" },
          cliente_nome: "Acerbi",
          execucoes: {
            l1: linhaDaExecucao({ id: "e5", no_id: "l1", tipo: "logo", saida: saidaDaLogo, custo_usd: 0.12 }),
            i1: linhaDaExecucao({ id: "e6", no_id: "i1", status: "erro", saida: null, erro: "Saldo insuficiente na carteira de IA." }),
          },
        }),
    });
    const lido = await lerProjeto(P);
    expect(lido.projeto.cliente_nome).toBe("Acerbi");
    expect(lido.execucoes.map((e) => [e.no_id, e.status])).toEqual([["l1", "pronto"], ["i1", "erro"]]);

    montarEditor();
    // O seletor compacto do Canvas Studio mostra o nome à vista (19/10) e a opção do select também tem o nome.
    expect((await screen.findAllByText("Acerbi")).some((e) => e.hasAttribute("data-nome-curto"))).toBe(true);
    const lista = await abrirModoLista();
    await waitFor(() => expect(lista.querySelector('[data-linha-do-no="l1"] [data-estado-do-no="pronto"]')).not.toBeNull());
    expect(lista.querySelector('[data-linha-do-no="i1"] [data-estado-do-no="erro"]')).not.toBeNull();
    fireEvent.click(within(lista.querySelector('[data-linha-do-no="l1"]') as HTMLElement).getAllByRole("button")[0]);
    const escolha = await waitFor(() => {
      const el = document.querySelector('[data-resultado-do-no="l1"] [data-escolha-do-jev]');
      if (!el) throw new Error("sem escolha");
      return el as HTMLElement;
    });
    expect(escolha.textContent).toMatch(/Jev escolheu a 2ª: Monograma lê melhor pequeno\./);
    // Logo usa `n` (variações), não `quantidade`.
    expect((screen.getByLabelText("Variações") as HTMLInputElement).value).toBe("2");
  });
});
