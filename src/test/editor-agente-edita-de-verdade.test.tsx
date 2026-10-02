import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { clipeNovo, projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { NOMES_DAS_FERRAMENTAS, sistemaDoAgente } from "../../supabase/functions/editor-video/ferramentas";

/**
 * 02/10, dono: "pedi para o agente editor remover uns takes duplicados e ele
 * não mexeu, não editou, não apagou nada". Causa raiz reproduzida aqui:
 * os apelidos (c1, c2...) eram refeitos depois de CADA ferramenta. Duas
 * remoções no mesmo passo ("remover c3" e "remover c5", lidos no começo)
 * tiravam o c3 e depois o clipe que ERA o c6, ou falhavam com "Não existe
 * c5"; a falha mandava a proposta inteira para o Confirmar, com o take
 * errado. Além disso não havia como achar takes repetidos (o modelo só via
 * nomes) e "takes repetidos" caía na skill de FALA repetida (melhor tomada),
 * que ainda pedia o Timestamp pago.
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

import AgenteEditor from "@/components/mesa-edicao/editor/AgenteEditor";
import { executarFerramenta, resumoDoQueMudou, rodarAgente, contextoDoAgente } from "@/lib/editor/agente";
import { apelidosDoProjeto, apelidosEstaveis, resolverApelidos } from "@/lib/editor/apelidos";
import { acharDuplicados, idsRepetidos, nomeBaseDoArquivo, opsDeRemoverDuplicados } from "@/lib/editor/duplicados";
import { aplicarOperacoes, trilhaPrincipal } from "@/lib/editor/operacoes";
import { proporSkill, skillPorPalavras, SKILLS_DO_EDITOR } from "@/lib/editor/skills";
import { pedidoPrecisaDeFala } from "@/lib/editor/fala";
import { pedidoComDica, pedidoDeTakesRepetidosDireto } from "@/components/mesa-edicao/editor/AgenteEditor";
import { clipesQueBatem, filtrarMidia, FILTRO_VAZIO, lerFiltro } from "@/lib/editor/busca";
import { lerBusca, limparFiltro } from "@/components/mesa-edicao/editor/buscaDoEditor";
import type { ControleDePropostas } from "@/components/mesa-edicao/editor/PainelDeSkills";
import type { ItemDaBiblioteca } from "@/lib/editor/biblioteca";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const VERSAO = "22222222-2222-4222-8222-222222222222";
const AGORA = "2026-10-02T12:00:00Z";

const take = (id: string, nome: string, duracao_s: number) => ({ id, nome, tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/${id}.mov`, cena_ref: null, melhor: true, duracao_s, largura: 1080, altura: 1920 });

/**
 * Projeto sintético com takes duplicados, na ordem da linha do tempo:
 * v1 take-t01 (6 s); v2 take-t02 (5 s); v3 take-t02 DE NOVO (mesma fonte, mesmo trecho);
 * v4 take-t03 (4 s); v5 take-t03 subido outra vez (outro arquivo, mesmo nome e duração); v6 take-t04 (3 s).
 */
function projetoComDuplicados(): ProjetoDeEdicao {
  const p = projetoDosTakes({ titulo: "Reel", fps: 25, takes: [take("a1", "take-t01.mov", 6), take("a2", "take-t02.mov", 5), take("a3", "take-t03.mov", 4), take("a3b", "take-t03 (1).mov", 4), take("a4", "take-t04.mov", 3)] });
  const t = p.trilhas[0];
  const fonteT02 = t.clipes[1].fonte as string;
  // Insere o v3 (t02 de novo) depois do t02 e empurra o resto: a montagem que o dono tinha.
  const comDup = aplicarOperacoes(p, [{ op: "inserir", trilha: t.id, empurrar: true, clipe: { id: "v9", fonte: fonteT02, inicio_s: 11, entrada_s: 0, saida_s: 5 } }]);
  return comDup;
}

const ordemDaTrilha = (p: ProjetoDeEdicao) => trilhaPrincipal(p)!.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s).map((c) => p.fontes[c.fonte as string].nome);
const passo = (x: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ passo: { plano: "", chamadas: [], resposta: "", terminou: true, recusadas: [], opcoes: [], ...x }, gasto_usd: 0.001, ...extra });

describe("causa raiz: apelidos que andavam no meio do pedido", () => {
  it("o projeto sintético tem 6 clipes e 2 repetidos (mesma fonte; outro arquivo com o mesmo nome e duração)", () => {
    const p = projetoComDuplicados();
    expect(ordemDaTrilha(p)).toEqual(["take-t01.mov", "take-t02.mov", "take-t02.mov", "take-t03.mov", "take-t03 (1).mov", "take-t04.mov"]);
    const a = apelidosDoProjeto(p);
    const grupos = acharDuplicados(p);
    expect(grupos.map((g) => ({ manter: a.porId[g.manter], repetidos: g.repetidos.map((id) => a.porId[id]), motivo: g.motivo }))).toEqual([
      { manter: "c2", repetidos: ["c3"], motivo: "mesma_fonte" },
      { manter: "c4", repetidos: ["c5"], motivo: "mesmo_nome_e_duracao" },
    ]);
  });

  it("duas remoções no mesmo passo tiram EXATAMENTE os dois que o modelo leu (antes: o segundo virava outro clipe ou falhava)", async () => {
    const p = projetoComDuplicados();
    const a = apelidosDoProjeto(p);
    const esperado = [a.porApelido.c3, a.porApelido.c4];
    const chamar = vi.fn().mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "remover", argumentos: { clipe: "c3", ondular: true } }, { ferramenta: "remover", argumentos: { clipe: "c4", ondular: true } }], resposta: "Tirei c3 e c4." }));
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s", pedido: "remova o c3 e o c4", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA });
    expect(r.falhas).toBe(0);
    expect(r.operacoes.map((o) => (o as { clipe: string }).clipe)).toEqual(esperado);
    const ficaram = trilhaPrincipal(r.resultado)!.clipes.map((c) => c.id);
    esperado.forEach((id) => expect(ficaram).not.toContain(id));
    expect(ficaram).toContain(a.porApelido.c5); // o c5 (que viraria c4 depois da 1a remoção) fica
    expect(r.mudancas).toBe("Tirei c3, c4.");
  });

  it("o mesmo pedido com os apelidos refeitos a cada ferramenta (o jeito antigo) tirava o clipe errado: prova da causa", () => {
    const p = projetoComDuplicados();
    const a = apelidosDoProjeto(p);
    const depoisDo1 = aplicarOperacoes(p, resolverApelidos(p, [{ op: "remover", clipe: "c3", ondular: true }]));
    const segundoAntigo = resolverApelidos(depoisDo1, [{ op: "remover", clipe: "c4", ondular: true }])[0] as { clipe: string };
    expect(segundoAntigo.clipe).toBe(a.porApelido.c5); // apelido renumerado: o c4 do modelo virava o take t03 (1)
    const segundoNovo = resolverApelidos(depoisDo1, [{ op: "remover", clipe: "c4", ondular: true }], apelidosEstaveis(depoisDo1, a))[0] as { clipe: string };
    expect(segundoNovo.clipe).toBe(a.porApelido.c4);
    expect(() => resolverApelidos(depoisDo1, [{ op: "remover", clipe: "c3" }], apelidosEstaveis(depoisDo1, a))).toThrow(/já saiu/);
  });

  it("apelido novo para clipe novo (dividir) sem renumerar os outros; o modelo recebe os apelidos fixos no passo seguinte", async () => {
    const p = projetoComDuplicados();
    const chamar = vi
      .fn()
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "dividir", argumentos: { clipe: "c1", em_s: 3 } }], terminou: false }))
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "remover", argumentos: { clipes: ["c7", "c6"], ondular: true } }], resposta: "Pronto." }));
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s", pedido: "divide o c1 em 3 s e tira a segunda metade e o último", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA });
    expect(r.falhas).toBe(0);
    const hist = chamar.mock.calls[1][0].historico.map((x: any) => x.conteudo).join("\n");
    expect(hist).toMatch(/- c7: take-t01\.mov, 0:03/);
    expect(hist).toMatch(/- c6: take-t04\.mov/);
    expect(trilhaPrincipal(r.resultado)!.clipes).toHaveLength(5);
  });
});

describe("remover_duplicados: ferramenta do servidor e montagem na tela", () => {
  it("está na lista de ferramentas do servidor e no sistema do modelo (com as regras de tirar, buscar e inserir)", () => {
    ["remover_duplicados", "buscar", "inserir_midia"].forEach((n) => expect(NOMES_DAS_FERRAMENTAS).toContain(n));
    const s = sistemaDoAgente();
    expect(s).toMatch(/repetidos ou duplicados = remover_duplicados/);
    expect(s).toMatch(/apelidos ficam FIXOS/);
  });

  it("tira os repetidos (fica o primeiro), encosta o resto e diz quais saíram", () => {
    const p = projetoComDuplicados();
    const r = executarFerramenta(p, { ferramenta: "remover_duplicados", argumentos: {} }, AGORA);
    expect(r.ok).toBe(true);
    expect(ordemDaTrilha(r.projeto)).toEqual(["take-t01.mov", "take-t02.mov", "take-t03.mov", "take-t04.mov"]);
    expect(r.texto).toMatch(/Tirei 2 takes repetidos: c3 repete c2 \(mesmo take\); c5 repete c4/);
    // Sem buraco: a trilha termina na soma das durações que ficaram.
    const fim = Math.max(...trilhaPrincipal(r.projeto)!.clipes.map((c) => c.inicio_s + (c.saida_s - c.entrada_s)));
    expect(fim).toBeCloseTo(6 + 5 + 4 + 3, 2);
    expect(resumoDoQueMudou(p, r.operacoes)).toBe("Tirei c5, c3.");
  });

  it("pedaços de um take dividido não são repetidos; sha256 igual acha o mesmo take com nome diferente; sha diferente não junta", () => {
    const base = projetoDosTakes({ titulo: "R", fps: 25, takes: [take("x1", "abertura.mov", 8), take("x2", "praia.mov", 8)] });
    const dividido = aplicarOperacoes(base, [{ op: "dividir", clipe: "v1", em_s: 4 }]);
    expect(acharDuplicados(dividido)).toEqual([]);
    expect(idsRepetidos(acharDuplicados(base, { x1: { sha256: "aaa" }, x2: { sha256: "aaa" } }))).toEqual(["v2"]);
    const mesmoNome = projetoDosTakes({ titulo: "R", fps: 25, takes: [take("y1", "take.mov", 8), take("y2", "take (2).mov", 8)] });
    expect(acharDuplicados(mesmoNome, { y1: { sha256: "a" }, y2: { sha256: "b" } })).toEqual([]);
    expect(nomeBaseDoArquivo("IMG_2.MOV")).not.toBe(nomeBaseDoArquivo("IMG_3.MOV"));
    expect(nomeBaseDoArquivo("Take T03 (1).mov")).toBe(nomeBaseDoArquivo("take t03.MOV"));
    expect(opsDeRemoverDuplicados(acharDuplicados(projetoComDuplicados()), false).every((o) => o.op === "remover" && (o as any).ondular === false)).toBe(true);
  });

  it("skill Tirar takes repetidos no catálogo; 'takes repetidos' não cai mais na skill de fala nem pede Timestamp", () => {
    expect(SKILLS_DO_EDITOR.map((s) => s.id)).toContain("remover_duplicados");
    const prop = proporSkill("remover_duplicados", projetoComDuplicados(), { agora: AGORA });
    expect(prop.operacoes.filter((o) => o.op === "remover")).toHaveLength(2);
    expect(prop.resumo).toMatch(/2 takes repetidos saem/);
    expect(skillPorPalavras("tira os takes repetidos")).toBe("remover_duplicados");
    expect(skillPorPalavras("remove os vídeos duplicados")).toBe("remover_duplicados");
    expect(skillPorPalavras("tira as frases repetidas")).toBe("ficar_com_melhor_tomada");
    expect(pedidoPrecisaDeFala("tira os takes repetidos")).toBe(false);
    expect(pedidoComDica("apaga os vídeos duplicados")).toMatch(/remover_duplicados/);
    expect(pedidoDeTakesRepetidosDireto("remova os takes duplicados")).toEqual({ direto: true, ordem: true });
    expect(pedidoDeTakesRepetidosDireto("tem take duplicado?")).toEqual({ direto: true, ordem: false });
    expect(pedidoDeTakesRepetidosDireto("tira os duplicados e legenda").direto).toBe(false);
  });

  it("o contexto do modelo já conta os repetidos", () => {
    expect(contextoDoAgente(projetoComDuplicados())).toMatch(/Takes repetidos \(regra fixa\): c3 repete c2 \(mesmo take\); c5 repete c4/);
  });
});

describe("busca com filtros (tela e agente)", () => {
  const midias: ItemDaBiblioteca[] = [
    { id: "a1", arquivo_id: "a1", nome: "take-t01.mov", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a1.mov`, duracao_s: 6, largura: 1080, altura: 1920, origem: "enviado" },
    { id: "g1", arquivo_id: "g1", nome: "praia gerada.mp4", tipo: "gerado", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/gerados/g1.mp4`, duracao_s: 5, largura: 1080, altura: 1920, origem: "gerado" },
    { id: "m1", arquivo_id: "m1", nome: "trilha.mp3", tipo: "audio", storage_bucket: "mesa", storage_path: `${CLIENTE}/audio/m1.mp3`, duracao_s: 62, largura: null, altura: null, origem: "enviado" },
    { id: "k1", arquivo_id: "k1", nome: "logo.png", tipo: "acervo", storage_bucket: "mesa", storage_path: `${CLIENTE}/acervo/logo.png`, duracao_s: null, largura: 500, altura: 500, origem: "enviado" },
  ];
  it("filtra por tipo, origem, uso e duração, e o texto acha por palavra sem acento", () => {
    const p = projetoComDuplicados();
    const ids = (f: Record<string, unknown>) => filtrarMidia(midias, p, lerFiltro(f)).map((i) => i.id);
    expect(ids({})).toEqual(["a1", "g1", "m1", "k1"]);
    expect(ids({ origem: "gerado" })).toEqual(["g1"]);
    expect(ids({ origem: "acervo" })).toEqual(["k1"]);
    expect(ids({ tipo: "audio" })).toEqual(["m1"]);
    expect(ids({ tipo: "imagem" })).toEqual(["k1"]);
    expect(ids({ uso: "usado" })).toEqual(["a1"]);
    expect(ids({ uso: "sem_uso" })).toEqual(["g1", "m1", "k1"]);
    expect(ids({ duracao: "longa" })).toEqual(["m1"]);
    expect(ids({ texto: "PRAIA" })).toEqual(["g1"]);
    expect(lerFiltro({ tipo: "x", duplicados: "sim" })).toEqual(FILTRO_VAZIO);
  });

  it("na linha do tempo: só os repetidos, por texto e por apelido", () => {
    const p = projetoComDuplicados();
    const a = apelidosDoProjeto(p);
    const ap = (f: Record<string, unknown>) => clipesQueBatem(p, lerFiltro(f), a).map((id) => a.porId[id]);
    expect(ap({ duplicados: true })).toEqual(["c3", "c5"]);
    expect(ap({ texto: "t03" })).toEqual(["c4", "c5"]);
    expect(ap({ texto: "c6" })).toEqual(["c6"]);
  });

  it("o agente busca (o filtro vai para a tela) e põe uma mídia achada depois de um clipe", async () => {
    const p = projetoComDuplicados();
    const chamar = vi
      .fn()
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "buscar", argumentos: { origem: "gerado" } }], terminou: false }))
      .mockResolvedValueOnce(passo({ chamadas: [{ ferramenta: "inserir_midia", argumentos: { midia: "m2", onde: "depois", depois_de: "c1" } }], resposta: "Pus a praia depois do c1." }));
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s", pedido: "mostre só os gerados e põe a praia depois do c1", projeto: p, modeloId: "m", tetoUsd: 0.5, agora: AGORA, midias });
    expect(chamar.mock.calls[0][0].contexto).toMatch(/m2: praia gerada\.mp4 \(video, gerado, 0:05/);
    expect(r.filtro).toMatchObject({ origem: "gerado" });
    expect(r.falhas).toBe(0);
    expect(ordemDaTrilha(r.resultado)[1]).toBe("praia gerada.mp4");
    expect(r.mudancas).toMatch(/Pus 1 clipe novo/);
    expect(r.tocados).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ tela: o pedido aplica de verdade e diz o que mudou

const modelo: ModeloIa = { id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "GPT-6 Luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["diretor_arte"], ativo: true } as unknown as ModeloIa;
const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [modelo], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() }) as unknown as MesaValor;
const corpos = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "editor-video" && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(mapa: Record<string, unknown | ((b: any) => unknown)>) {
  mock.invoke.mockImplementation((_f: string, { body }: any) => {
    const r = mapa[body.acao];
    const data = typeof r === "function" ? (r as (b: any) => unknown)(body) : r;
    return Promise.resolve({ data: data === undefined ? {} : data, error: null });
  });
}

/** Controle de verdade: aplica no "editor" (uma variável) como o EditorDeVideo faz. */
function controleDeVerdade(inicial: ProjetoDeEdicao) {
  const estado = { projeto: inicial, passos: 0 };
  const controle: ControleDePropostas = {
    aplicar: (prop) => {
      estado.projeto = prop.resultado;
      estado.passos++;
      return true;
    },
    desfazer: () => {
      estado.projeto = inicial;
      return true;
    },
  };
  return { estado, controle };
}

function montar(p: ProjetoDeEdicao, controle: ControleDePropostas) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(AgenteEditor, { projeto: p, controle, onAplicarProjeto: vi.fn(), urls: {}, versaoId: VERSAO, selecao: [], cursor: () => 0 }) })))),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  limparFiltro(CLIENTE);
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("tela do agente editor: tirar os duplicados de verdade", () => {
  it("'remova os takes duplicados': regra fixa, sem modelo e sem custo; aplica na hora (um passo) e diz quais saíram", async () => {
    const p = projetoComDuplicados();
    const { estado, controle } = controleDeVerdade(p);
    responder({ conversa_ler: { mensagens: [] }, conversa_gravar: { mensagem_id: "33333333-3333-4333-8333-333333333333" } });
    montar(p, controle);
    const campo = await screen.findByRole("textbox", { name: "Pedido para o agente editor" });
    fireEvent.change(campo, { target: { value: "remova os takes duplicados" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    await waitFor(() => expect(document.querySelector('[data-acao-agente="feita"]')).toBeTruthy());
    expect(corpos("agente_passo")).toHaveLength(0);
    expect(estado.passos).toBe(1);
    expect(ordemDaTrilha(estado.projeto)).toEqual(["take-t01.mov", "take-t02.mov", "take-t03.mov", "take-t04.mov"]);
    expect(screen.getAllByText(/Tirei c5, c3\./).length).toBeGreaterThan(0);
    expect(screen.getByText(/Feito na hora/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeTruthy();
  });

  it("pelo modelo: remover_duplicados com ordem clara aplica, e o que mudou vem do código (apelidos)", async () => {
    const p = projetoComDuplicados();
    const { estado, controle } = controleDeVerdade(p);
    responder({
      conversa_ler: { mensagens: [] },
      agente_passo: passo({ chamadas: [{ ferramenta: "remover_duplicados", argumentos: {} }, { ferramenta: "fechar_buracos", argumentos: {} }], resposta: "Pronto, tirei os repetidos." }),
      agente_ordem_clara: { clara: true },
      conversa_gravar: { mensagem_id: "33333333-3333-4333-8333-333333333333" },
    });
    montar(p, controle);
    const campo = await screen.findByRole("textbox", { name: "Pedido para o agente editor" });
    fireEvent.change(campo, { target: { value: "tira os duplicados e encosta tudo, pode fazer" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    await waitFor(() => expect(document.querySelector('[data-acao-agente="feita"]')).toBeTruthy());
    expect(estado.passos).toBe(1);
    expect(ordemDaTrilha(estado.projeto)).toHaveLength(4);
    expect(screen.getAllByText(/Mudei: Tirei c5, c3\./).length).toBeGreaterThan(0);
  });

  it("'ache os takes duplicados': nada muda sozinho; os repetidos ficam filtrados na tela e a proposta pede Confirmar", async () => {
    const p = projetoComDuplicados();
    const { estado, controle } = controleDeVerdade(p);
    responder({ conversa_ler: { mensagens: [] }, conversa_gravar: { mensagem_id: "33333333-3333-4333-8333-333333333333" } });
    montar(p, controle);
    const campo = await screen.findByRole("textbox", { name: "Pedido para o agente editor" });
    fireEvent.change(campo, { target: { value: "tem take duplicado?" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(estado.passos).toBe(1));
    expect(lerBusca(CLIENTE).filtro.duplicados).toBe(true);
    expect(corpos("agente_passo")).toHaveLength(0);
  });

  it("Jev fora do ar: ordem explícita ('remova', 'apague', 'pode fazer') ainda vai na hora; pergunta vai para Confirmar", async () => {
    const p = projetoComDuplicados();
    const { estado, controle } = controleDeVerdade(p);
    responder({
      conversa_ler: { mensagens: [] },
      agente_passo: passo({ chamadas: [{ ferramenta: "remover", argumentos: { clipes: ["c3", "c5"], ondular: true } }], resposta: "Tirei." }),
      agente_ordem_clara: () => {
        throw new Error("jev caiu");
      },
      conversa_gravar: { mensagem_id: "33333333-3333-4333-8333-333333333333" },
    });
    montar(p, controle);
    const campo = await screen.findByRole("textbox", { name: "Pedido para o agente editor" });
    fireEvent.change(campo, { target: { value: "apague o c3 e o c5" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    await waitFor(() => expect(document.querySelector('[data-acao-agente="feita"]')).toBeTruthy());
    expect(estado.passos).toBe(1);
    fireEvent.change(campo, { target: { value: "será que tiro o c3 e o c5?" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    expect(await screen.findByRole("button", { name: "Confirmar" })).toBeTruthy();
    expect(estado.passos).toBe(1);
  });
});
