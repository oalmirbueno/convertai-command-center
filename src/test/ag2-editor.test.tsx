import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import {
  anexosDoEditor,
  ESQUEMA_DO_PASSO,
  itensDoCorpo,
  lerPasso,
  MAX_FERRAMENTAS,
  NOMES_DAS_FERRAMENTAS,
  podeAplicarDireto,
  referenciaDoCorpo,
  respostaPromete,
  sistemaDoAgente,
  sistemaDoPasso,
} from "../../supabase/functions/editor-video/ferramentas";
import { aprenderDoPedido, blocoDasRegras, regrasDaMesa, rotasDoAprendizado, type JulgamentoDoEnsino } from "../../supabase/functions/_shared/aprendizado-das-mesas";

/**
 * Frente AG2 (29/09): agente editor da Mesa Edição. Conversa que volta ao
 * reabrir, pedido que não some, ordem clara feita na hora com Desfazer,
 * "esse corte"/"o segundo"/"todos", exportar só com Confirmar, pergunta com
 * opções e o aprendizado (regras da mesa "edicao" no sistema do modelo).
 * Função, banco e Jev falsos; nada sai para o Supabase real.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => {
      const b: any = {};
      for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
      b.then = (ok: any, f: any) => Promise.resolve({ data: [], error: null }).then(ok, f);
      return b;
    },
    storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import AgenteEditor, { mensagemDoBanco } from "@/components/mesa-edicao/editor/AgenteEditor";
import { conversaParaOModelo, ErroDoPrimeiroPasso, executarFerramenta, itensDaReferencia, linhasDaTela, pedidoDeExportar, provaDaMudanca, rodarAgente } from "@/lib/editor/agente";
import { acaoDeExportar, arquivosDaExportacao } from "@/lib/editor/exportar";
import { aplicarOperacoes, assinaturaDoProjeto, trilhaPrincipal } from "@/lib/editor/operacoes";
import { apelidosDoProjeto } from "@/lib/editor/apelidos";
import type { ControleDePropostas } from "@/components/mesa-edicao/editor/PainelDeSkills";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const VERSAO = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const AGORA = "2026-09-29T12:00:00Z";
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

function projeto(): ProjetoDeEdicao {
  return projetoDosTakes({
    titulo: "Reel",
    fps: 25,
    takes: [
      { id: "a", nome: "IMG_1.MOV", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mov`, cena_ref: null, melhor: true, duracao_s: 10, largura: 1080, altura: 1920 },
      { id: "b", nome: "IMG_2.MOV", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/b.mov`, cena_ref: null, melhor: true, duracao_s: 6, largura: 1080, altura: 1920 },
      { id: "c", nome: "IMG_3.MOV", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/c.mov`, cena_ref: null, melhor: true, duracao_s: 4, largura: 1080, altura: 1920 },
    ],
  });
}

const passo = (x: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ passo: { plano: "", chamadas: [], resposta: "", terminou: true, recusadas: [], opcoes: [], ...x }, gasto_usd: 0.001, ...extra });

// ------------------------------------------------------------------ 1. laço: estado real, limites que falam

describe("laço do agente editor", () => {
  it("manda o estado real da tela: seleção e cursor em apelidos, itens na ordem, conversa; devolve a referência do passo 1 nos seguintes", async () => {
    const p = projeto();
    const ids = trilhaPrincipal(p)!.clipes.map((c) => c.id);
    const chamar = vi
      .fn()
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "ler_projeto", argumentos: {} }], terminou: false }, { referencia: { refs: ["c2"], alcance: "um", probabilidade: 0.9, incerta: false } }))
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "remover", argumentos: { clipe: "c2", ondular: true } }], resposta: "Tirei o c2." }, { uso_id: "44444444-4444-4444-8444-444444444444" }));
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s", pedido: "tira esse", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA, tela: { selecionados: [ids[1]], cursor_s: 11 }, conversa: "Dono: oi\nAgente: oi" });
    const c1 = chamar.mock.calls[0][0];
    expect(c1.selecionados).toEqual(["c2"]);
    expect(c1.itens_referencia.map((i: any) => i.ref)).toEqual(["c1", "c2", "c3"]);
    expect(JSON.stringify(c1)).not.toContain(ids[1]); // id cru nunca vai
    expect(c1.contexto).toContain("Selecionados na tela: c2.");
    expect(c1.contexto).toContain("Trilha de vídeo na ordem: c1, c2, c3");
    expect(c1.contexto).toMatch(/Cursor em .*sobre c2/);
    expect(c1.conversa).toContain("Agente: oi");
    expect(chamar.mock.calls[1][0].referencia).toEqual({ refs: ["c2"], alcance: "um", probabilidade: 0.9, incerta: false });
    expect(r.operacoes.map((o) => o.op)).toEqual(["remover"]);
    expect(r.uso_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(r.parado).toBe(false);
  });

  it("erro no primeiro passo sobe (o pedido volta ao campo); erro no meio fica com o que já saiu e diz por quê", async () => {
    const p = projeto();
    await expect(rodarAgente({ chamar: vi.fn().mockRejectedValue(new Error("sem saldo")), clientId: CLIENTE, sessao: "s", pedido: "x", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA })).rejects.toBeInstanceOf(ErroDoPrimeiroPasso);
    const chamar = vi
      .fn()
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "remover", argumentos: { clipe: "c3" } }], terminou: false }))
      .mockRejectedValueOnce(new Error("provedor caiu"));
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s", pedido: "x", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA });
    expect(r.operacoes).toHaveLength(1);
    expect(r.parado).toBe(true);
    expect(r.log.some((i) => i.tipo === "aviso" && /passo 2 falhou \(provedor caiu\)/.test(i.texto))).toBe(true);
  });

  it("teto do servidor, ferramentas acima do limite e passo vazio nunca terminam calados", async () => {
    const p = projeto();
    const teto = await rodarAgente({ chamar: vi.fn().mockResolvedValue({ ...passo({ resposta: "Chegou ao teto de US$ 0,50 deste pedido." }), parou: true }), clientId: CLIENTE, sessao: "s", pedido: "x", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA });
    expect(teto.parado).toBe(true);
    expect(teto.log.some((i) => i.tipo === "aviso" && /teto/.test(i.texto))).toBe(true);
    const muitas = Array.from({ length: MAX_FERRAMENTAS + 3 }, () => ({ ferramenta: "ler_projeto", argumentos: {} }));
    const limite = await rodarAgente({ chamar: vi.fn().mockResolvedValue(passo({ chamadas: muitas })), clientId: CLIENTE, sessao: "s", pedido: "x", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA });
    expect(limite.ferramentas).toBe(MAX_FERRAMENTAS);
    expect(limite.log.some((i) => /3 ferramentas ficaram de fora/.test(i.texto))).toBe(true);
    const vazio = await rodarAgente({ chamar: vi.fn().mockResolvedValue({}), clientId: CLIENTE, sessao: "s", pedido: "x", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA });
    expect(vazio.log.some((i) => /voltou vazio/.test(i.texto))).toBe(true);
    // Terminou no último passo permitido: sem aviso falso de limite.
    const chamar = vi.fn();
    for (let k = 0; k < 5; k++) chamar.mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "ler_projeto", argumentos: {} }], terminou: false }));
    chamar.mockResolvedValueOnce(passo({ resposta: "Pronto." }));
    const fim = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s", pedido: "x", projeto: p, modeloId: "m", tetoUsd: 5, agora: AGORA });
    expect(fim.log.some((i) => /limite de 6 passos/.test(i.texto))).toBe(false);
  });

  it("ferramentas novas: trilha (música sem som), exportar (só pede o cartão) e erro inesperado com motivo", () => {
    const p = projeto();
    const t = executarFerramenta(p, { ferramenta: "trilha", argumentos: { trilha: p.trilhas[0].id, muda: true } }, AGORA);
    expect(t.ok).toBe(true);
    expect(t.projeto.trilhas[0].muda).toBe(true);
    expect(executarFerramenta(p, { ferramenta: "trilha", argumentos: { trilha: "audio-9", muda: true } }, AGORA).texto).toContain("Não existe a trilha audio-9");
    const x = executarFerramenta(p, { ferramenta: "exportar", argumentos: {} }, AGORA);
    expect(x).toMatchObject({ ok: true, exportar: true, operacoes: [] });
    expect(NOMES_DAS_FERRAMENTAS).toEqual(expect.arrayContaining(["trilha", "exportar", "reordenar", "aplicar_skill"]));
  });

  it("pergunta com opções: só quando o passo não chama ferramenta; a resposta que promete sem mudar é pega", () => {
    expect(lerPasso({ plano: "", chamadas: [], resposta: "Qual clipe: c2 ou c3?", terminou: true, opcoes: ["c2", "c3", "c2", "", "a", "b", "c"] }, 5).opcoes).toEqual(["c2", "c3", "a", "b"]);
    expect(lerPasso({ chamadas: [{ ferramenta: "ler_projeto", argumentos_json: "{}" }], opcoes: ["c2"] }, 5).opcoes).toEqual([]);
    expect(ESQUEMA_DO_PASSO.schema.required).toContain("opcoes");
    expect(respostaPromete("Vou cortar os silêncios agora.")).toBe(true);
    expect(respostaPromete("Cortei os silêncios de c1.")).toBe(false);
    expect(sistemaDoAgente()).toContain("UMA pergunta curta");
    expect(sistemaDoAgente()).toContain("Selecionados na tela");
  });
});

// ------------------------------------------------------------------ 2. regras de decisão e o que vem da tela

describe("decidir e conferir", () => {
  it("direto só com ordem clara e nada errado no caminho", () => {
    const ok = { operacoes: 3, falhas: 0, recusadas: 0, parado: false, ordemClara: true };
    expect(podeAplicarDireto(ok).direto).toBe(true);
    expect(podeAplicarDireto({ ...ok, ordemClara: false }).direto).toBe(false);
    // 02/10: ferramenta que falhou não mudou nada (entra inteira ou não entra); o resto vale e a falha vai dita.
    expect(podeAplicarDireto({ ...ok, falhas: 1 }).direto).toBe(true);
    expect(podeAplicarDireto({ ...ok, recusadas: 1 }).direto).toBe(false);
    expect(podeAplicarDireto({ ...ok, parado: true }).direto).toBe(false);
    expect(podeAplicarDireto({ ...ok, operacoes: 0 }).direto).toBe(false);
  });

  it("itens e referência da tela: só apelidos de clipe, nunca id; anexos só os conhecidos e com teto", () => {
    const itens = itensDoCorpo([{ ref: "c1", titulo: "A" }, { ref: "c1", titulo: "dup" }, { ref: "11111111-1111-4111-8111-111111111111", titulo: "id cru" }, { ref: "c2", titulo: "B" }, null]);
    expect(itens.map((i) => i.ref)).toEqual(["c1", "c2"]);
    expect(referenciaDoCorpo({ refs: ["c2", "c9"], alcance: "um", probabilidade: 0.8 }, itens)).toMatchObject({ refs: ["c2"], alcance: "um" });
    expect(referenciaDoCorpo({ refs: ["c9"] }, itens)).toBeNull();
    const anexos = anexosDoEditor([{ tipo: "log_do_editor", itens: [] }, { tipo: "qualquer" }, { tipo: "acao_agente", id: "a", itens: [], contexto: { operacoes: Array.from({ length: 30000 }, () => ({ op: "remover", clipe: "xxxxxxxxxx" })) } }]);
    expect(anexos).toHaveLength(2);
    expect((anexos[1] as any).contexto.operacoes).toBeUndefined();
  });

  it("\"essa\", \"o segundo\" e \"todos\": os itens são os clipes da trilha de vídeo na ordem, com a linha da tela", () => {
    const p = projeto();
    expect(itensDaReferencia(p).map((i) => i.ref)).toEqual(["c1", "c2", "c3"]);
    expect(linhasDaTela(p, {}).join("\n")).toContain("Selecionados na tela: nenhum.");
  });

  it("exportar por palavras só quando é só exportar", () => {
    expect(pedidoDeExportar("exporta o vídeo")).toBe(true);
    expect(pedidoDeExportar("pode renderizar")).toBe(true);
    expect(pedidoDeExportar("corta os silêncios e exporta")).toBe(false);
    expect(pedidoDeExportar("legenda tudo")).toBe(false);
  });

  it("exportar: ZIP com projeto, props do Remotion, edl e o passo a passo; cartão sem custo e sem Desfazer", () => {
    const p = projeto();
    const x = arquivosDaExportacao(p, { k: "https://x.supabase.co/v.mp4" }, AGORA);
    expect(Object.keys(x.arquivos).sort()).toEqual(["LEIA-ME.md", "edl.json", "projeto.json", "props.json"]);
    expect(JSON.parse(x.arquivos["props.json"]).projeto.titulo).toBe("Reel");
    expect(x.arquivos["LEIA-ME.md"]).toContain("npx remotion render ComposicaoDoProjeto");
    const a = acaoDeExportar(p, "exportar-1");
    expect(a).toMatchObject({ sem_desfazer: true, custo_estimado_usd: 0, agente: "editor_video" });
    expect(a.itens[0].operacao).toBe("exportar");
  });

  it("prova do que mudou e conversa curta para o modelo", () => {
    const p = projeto();
    const t = trilhaPrincipal(p)!;
    const depois = aplicarOperacoes(p, [{ op: "remover", clipe: t.clipes[2].id, ondular: true }]);
    expect(provaDaMudanca(p, depois)).toMatch(/duração .* para .*; 3 para 2 clipes/);
    expect(conversaParaOModelo([{ quem: "dono", texto: "corta" }, { quem: "agente", texto: "Cortei." }])).toBe("Dono: corta\nAgente: Cortei.");
  });
});

// ------------------------------------------------------------------ 3. reabrir: a conversa volta com os cartões no estado certo

describe("conversa guardada", () => {
  it("cartão feito numa sessão anterior volta feito e sem Desfazer; aberto com operações volta confirmável", () => {
    const p = projeto();
    const feita = { tipo: "acao_agente", agente: "editor_video", id: "agente-velho", resumo: "x", itens: [{ ref: "o1", alvo_id: "a", titulo: "Tirar c3", detalhe: null, operacao: "remover", rotulo: "Tirar", para: null }], ignorados: [], recusados: [], executada_em: AGORA, resultados: [{ ref: "o1", alvo_id: "a", titulo: "Tirar c3", operacao: "remover", ok: true, desfazer: { local: true } }] };
    const m = mensagemDoBanco({ id: MSG, papel: "agente", conteudo: "Tirei.", anexos: [{ tipo: "log_do_editor", itens: [{ tipo: "resposta", texto: "Tirei o c3." }] }, feita, { tipo: "pergunta_do_editor", opcoes: ["c1", "c2"] }] }, p)!;
    expect(m.itens[0].texto).toBe("Tirei o c3.");
    expect(m.acoes[0].resultados![0].desfazer).toBeNull();
    expect(m.opcoes).toEqual(["c1", "c2"]);
    expect(mensagemDoBanco({ id: MSG, papel: "usuario", conteudo: "tira o c3", anexos: [] }, p)!.quem).toBe("dono");
  });
});

// ------------------------------------------------------------------ 4. tela

const modelo: ModeloIa = { id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "GPT-6 Luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["diretor_arte"], ativo: true } as unknown as ModeloIa;
const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [modelo], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() }) as unknown as MesaValor;

const corpos = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "editor-video" && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar(p: ProjetoDeEdicao, controle: ControleDePropostas) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(AgenteEditor, { projeto: p, controle, onAplicarProjeto: vi.fn(), urls: {}, versaoId: VERSAO, selecao: [], cursor: () => 0 }) })))),
  );
}

function responder(mapa: Record<string, unknown | ((b: any) => unknown)>) {
  mock.invoke.mockImplementation((_f: string, { body }: any) => {
    const r = mapa[body.acao];
    if (r instanceof Error) return Promise.resolve({ data: null, error: { message: r.message, context: { status: 500, json: () => Promise.resolve({ error: "provedor_erro", mensagem: r.message }) } } });
    const data = typeof r === "function" ? (r as (b: any) => unknown)(body) : r;
    return Promise.resolve({ data: data === undefined ? {} : data, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("tela do agente editor", () => {
  it("reabrir mostra a conversa guardada da versão, com o cartão feito (sem voltar a Confirmar)", async () => {
    const feita = { tipo: "acao_agente", agente: "editor_video", id: "agente-antigo", resumo: "Tirei o c3.", itens: [{ ref: "o1", alvo_id: "a", titulo: "Tirar c3", detalhe: null, operacao: "remover", rotulo: "Tirar", para: null }], ignorados: [], recusados: [], executada_em: AGORA, executada_direto: true, resultados: [{ ref: "o1", alvo_id: "a", titulo: "Tirar c3", operacao: "remover", ok: true, desfazer: { local: true } }] };
    responder({ conversa_ler: { mensagens: [{ id: "u1", papel: "usuario", conteudo: "tira o último", anexos: [] }, { id: MSG, papel: "agente", conteudo: "Tirei o c3.", anexos: [{ tipo: "log_do_editor", itens: [{ tipo: "resposta", texto: "Tirei o c3." }] }, feita] }] } });
    montar(projeto(), { aplicar: vi.fn(), desfazer: vi.fn() });
    expect(await screen.findByText("tira o último")).toBeTruthy();
    expect(screen.getAllByText("Tirei o c3.").length).toBeGreaterThan(0);
    expect(corpos("conversa_ler")[0]).toMatchObject({ client_id: CLIENTE, versao_id: VERSAO });
    await waitFor(() => expect(document.querySelector('[data-acao-agente="feita"]')).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull(); // o histórico do desfazer era da outra sessão
  });

  it("pedido que falha: a bolha sai, o texto volta ao campo e o erro aparece (reenviar não duplica)", async () => {
    responder({ conversa_ler: { mensagens: [] }, agente_passo: new Error("O provedor falhou.") });
    montar(projeto(), { aplicar: vi.fn(), desfazer: vi.fn() });
    const campo = (await screen.findByRole("textbox", { name: "Pedido para o agente editor" })) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "reordena c2 antes de c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    await waitFor(() => expect(document.querySelector("[data-erro-do-envio]")).toBeTruthy());
    expect(campo.value).toBe("reordena c2 antes de c1");
    expect(document.querySelectorAll('[data-mensagem-do-editor="dono"]')).toHaveLength(0);
    expect(document.querySelector("[data-erro-do-envio]")!.textContent).toContain("O provedor falhou.");
    expect(corpos("conversa_gravar")).toHaveLength(0);
  });

  it("ordem clara: faz na hora com a lista e a prova, guarda na conversa e o Desfazer volta o pedido inteiro", async () => {
    const p = projeto();
    const aplicar = vi.fn(() => true);
    const desfazer = vi.fn(() => true);
    responder({
      conversa_ler: { mensagens: [] },
      agente_passo: passo({ chamadas: [{ ferramenta: "reordenar", argumentos: { ordem: ["c2", "c1", "c3"] } }], resposta: "Pus o c2 antes do c1." }, { aprendido: { tipo: "aprendizado_do_agente", id: "55555555-5555-4555-8555-555555555555", texto: "Não usar zoom", categoria: "evitar", decisao: "preferencia_duradoura", situacao: "criado", reforcos: 1, mesa: "edicao" } }),
      agente_ordem_clara: { clara: true },
      conversa_gravar: { mensagem_id: MSG },
      conversa_marcar: { ok: true },
    });
    montar(p, { aplicar, desfazer });
    const campo = await screen.findByRole("textbox", { name: "Pedido para o agente editor" });
    fireEvent.change(campo, { target: { value: "reordena c2 antes de c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    await waitFor(() => expect(document.querySelector('[data-acao-agente="feita"]')).toBeTruthy());
    expect(aplicar).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Feito na hora/)).toBeTruthy();
    expect(screen.getByText(/Reordenar/)).toBeTruthy();
    expect(screen.getByText(/Aprendi:/)).toBeTruthy();
    await waitFor(() => expect(corpos("conversa_gravar")).toHaveLength(1));
    const g = corpos("conversa_gravar")[0];
    expect(g).toMatchObject({ client_id: CLIENTE, versao_id: VERSAO, usuario: { conteudo: "reordena c2 antes de c1" } });
    const tipos = g.agente.anexos.map((a: any) => a.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["log_do_editor", "acao_agente", "aprendizado_do_agente"]));
    expect(corpos("agente_ordem_clara")[0].pedido).toBe("reordena c2 antes de c1");
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(desfazer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(corpos("conversa_marcar")).toHaveLength(1));
    expect(corpos("conversa_marcar")[0]).toMatchObject({ mensagem_id: MSG });
    expect(corpos("conversa_marcar")[0].cartao.desfeita_em).toBeTruthy();
  });

  it("sem ordem clara: cartão com Confirmar; exportar nunca vai sozinho; pergunta com opções vira botões", async () => {
    const aplicar = vi.fn(() => true);
    responder({
      conversa_ler: { mensagens: [] },
      agente_passo: (b: any) =>
        b.pedido.indexOf("qual") >= 0
          ? passo({ resposta: "Qual clipe: c2 ou c3?", opcoes: ["c2", "c3"] })
          : passo({ chamadas: [{ ferramenta: "remover", argumentos: { clipe: "c3", ondular: true } }], resposta: "Tirei o c3." }),
      agente_ordem_clara: { clara: false },
      conversa_gravar: { mensagem_id: MSG },
    });
    montar(projeto(), { aplicar, desfazer: vi.fn() });
    const campo = await screen.findByRole("textbox", { name: "Pedido para o agente editor" });
    fireEvent.change(campo, { target: { value: "talvez tirar o c3?" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(aplicar).toHaveBeenCalledTimes(1));
    // Exportar: regra fixa, sem modelo, cartão com Confirmar.
    const antes = corpos("agente_passo").length;
    fireEvent.change(campo, { target: { value: "exporta o vídeo" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    expect(await screen.findByText(/Exportar "Reel"/)).toBeTruthy();
    expect(corpos("agente_passo")).toHaveLength(antes);
    // Pergunta com opções.
    fireEvent.change(campo, { target: { value: "tira qual?" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    const grupo = await screen.findByRole("group", { name: "Respostas para o agente" });
    fireEvent.click(within(grupo).getByRole("button", { name: "c3" }));
    await waitFor(() => expect(corpos("agente_passo").some((b: any) => b.pedido === "c3")).toBe(true));
  }, 20000);
});

// ------------------------------------------------------------------ 5. servidor: ligações (contrato no fonte)

describe("editor-video: ligações do servidor", () => {
  const f = ler("supabase/functions/editor-video/index.ts");
  it("regras ensinadas e referência do pedido vão no sistema de TODO passo; Jev só no passo 1 e em paralelo", () => {
    // Frente SYNC (30/09): as regras seguem a marca aberta na tela.
    expect(f).toContain('regrasDaMesa(servico(), { clientId, mesa: "edicao", marcaId })');
    expect(f).toContain("const sistemaCompleto = sistemaDoPasso(sistema, regras.bloco, blocoDaReferencia(ref, itens));");
    // Núcleo das Mesas (09/10): a instrução comum e as leituras entram por cima do sistema completo.
    expect(f).toContain("const sistemaComNucleo = [sistemaCompleto, INSTRUCAO_DO_NUCLEO_DAS_MESAS, nucleo.bloco].filter(Boolean).join(");
    expect(f).toContain("sistema: sistemaComNucleo,");
    expect(f).toMatch(/const \[gasto, regras, refDoPasso1\] = await Promise\.all\(/);
    expect(f).toContain("passo === 1 && itens.length && pedidoAponta(pedido) ? referenciaDoPedido(");
    expect(f).toContain("esquemaJson: ESQUEMA_DO_PASSO_COM_APRENDIZADO");
    expect(f).toContain('aprenderDoPedido(servico(), { clientId, mesa: "edicao"');
    expect(f).toContain("anexoDasRegrasSeguidas(j.regras_seguidas, regras.regras)");
  });

  it("conversa por versão (agente diretor_arte, referencia editor_agente), gravada pelo gravarTroca com a versão conferida no banco", () => {
    expect(f).toContain('const REF_CONVERSA = "editor_agente";');
    expect(f).toContain('const AGENTE_DA_CONVERSA = "diretor_arte";');
    expect(f).toContain("await garantirVersao(clientId, versaoId);");
    expect(f).toContain("await gravarTroca(servico(), {");
    expect(f).toContain("aviso_registro: t.erro ? AVISO_SEM_REGISTRO : null");
    for (const a of ["agente_ordem_clara", "conversa_ler", "conversa_gravar", "conversa_marcar", "aprendizado_esquecer", "aprendizado_guardar"]) expect(f).toMatch(new RegExp(`\\n  ${a}: `));
  });

  it("sistemaDoPasso junta só o que existe", () => {
    expect(sistemaDoPasso("BASE", "", "")).toBe("BASE");
    expect(sistemaDoPasso("BASE", "REGRAS", " REF ")).toBe("BASE\n\nREGRAS\n\nREF");
  });
});

// ------------------------------------------------------------------ 6. aprendizado ligado à mesa "edicao" (banco e Jev falsos)

type Linha = Record<string, unknown>;
function bancoFalso() {
  const linhas: Linha[] = [];
  let n = 0;
  const consulta = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Linha = {};
    let novo: Linha | null = null;
    const q: Record<string, unknown> = {};
    const alvo = () => (tabela === "agente_memoria" ? linhas : []).filter((l) => filtros.every((x) => x(l)));
    const fim = () => {
      if (op === "update") {
        const a = alvo();
        a.forEach((l) => Object.assign(l, patch));
        return { data: a.map((l) => ({ id: l.id })), error: null };
      }
      if (op === "insert" && novo) return { data: novo, error: null };
      return { data: alvo(), error: null };
    };
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      order: () => q,
      limit: () => q,
      update: (p: Linha) => ((op = "update"), (patch = p), q),
      insert: (p: Linha) => {
        op = "insert";
        novo = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ativa: true, reforcos: 1, criado_em: new Date().toISOString(), ...p };
        linhas.push(novo);
        return q;
      },
      single: () => Promise.resolve(fim()),
      maybeSingle: () => Promise.resolve({ data: alvo()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(fim()).then(ok, erro),
    });
    return q;
  };
  return { db: { from: consulta }, linhas };
}
const julgar = (decisao: JulgamentoDoEnsino["decisao"]) => async (): Promise<JulgamentoDoEnsino> => ({ decisao, tipo: "evitar", probabilidade: 0.9, fonte: "jev" });

describe("aprendizado do agente editor", () => {
  it("a regra é criada na mesa edicao e obedecida: entra no sistema do passo", async () => {
    const { db } = bancoFalso();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "edicao", pedido: "nunca use zoom nos cortes", regraSugerida: "Não usar zoom nos cortes" }, { julgarEnsino: julgar("preferencia_duradoura"), julgarDuplicidade: null });
    expect(a).toMatchObject({ texto: "Não usar zoom nos cortes", mesa: "edicao", situacao: "criado" });
    const r = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "edicao" });
    expect(r.regras.map((x) => x.texto)).toEqual(["Não usar zoom nos cortes"]);
    const sistema = sistemaDoPasso(sistemaDoAgente(), r.bloco, "");
    expect(sistema).toContain("EVITAR:\n- g1: Não usar zoom nos cortes");
    expect(r.bloco).toBe(blocoDasRegras(r.regras));
  });

  it("pedido de uma vez só não vira regra; repetida reforça; Esquecer tira", async () => {
    const { db, linhas } = bancoFalso();
    expect(await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "edicao", pedido: "não gostei desse corte, tira só aqui" }, { julgarEnsino: julgar("so_desta_vez") })).toBeNull();
    expect(linhas).toHaveLength(0);
    const pedir = () => aprenderDoPedido(db, { clientId: CLIENTE, mesa: "edicao", pedido: "nunca legenda em caixa alta", regraSugerida: "Não usar legenda em caixa alta" }, { julgarEnsino: julgar("preferencia_duradoura"), julgarDuplicidade: null });
    const primeira = await pedir();
    const segunda = await pedir();
    expect(linhas).toHaveLength(1);
    expect(segunda).toMatchObject({ id: primeira!.id, situacao: "reforcado" });
    const rotas = rotasDoAprendizado({ mesa: "edicao", servico: () => db, garantirAcesso: async () => true, json: (c, s = 200) => new Response(JSON.stringify(c), { status: s }) });
    const r = await rotas.aprendizado_esquecer({ userId: "u1" }, { client_id: CLIENTE, id: primeira!.id });
    expect(r.status).toBe(200);
    expect(linhas[0].ativa).toBe(false);
    expect((await regrasDaMesa(db, { clientId: CLIENTE, mesa: "edicao" })).regras).toHaveLength(0);
  });
});

// Garantia pequena: o apelido do agente continua sendo a única ponte para o id.
it("apelidos: c1..cN na ordem das trilhas", () => {
  const p = projeto();
  expect(apelidosDoProjeto(p).lista.slice(0, 3).map((x) => x.apelido)).toEqual(["c1", "c2", "c3"]);
  expect(assinaturaDoProjeto(p)).toBeTruthy();
});
