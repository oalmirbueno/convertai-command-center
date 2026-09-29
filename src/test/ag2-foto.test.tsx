import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente AG2 (29/09/2026): o diretor de fotografia da Mesa Foto.
 * - a conversa volta ao reabrir (agente_historico), com os cartões no estado guardado;
 * - "promete e não faz" (dado real de 26/09 20:28 e 27/09 15:24): causa (sugestão sem
 *   produto caía calada, UUID no prompt, pessoa real virava campanha) e a trava;
 * - a mensagem digitada nunca some nem duplica; o aviso de registro aparece;
 * - "essa/a segunda/todas" pela lista da etapa; ações novas (renomear e trocar fotos do
 *   produto, montar ensaio) com Desfazer; o que a equipe ensinou vale no sistema e na geração.
 * Função, banco e Jev falsos: nada sai para o Supabase real nem para API paga.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          upload: vi.fn(),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }),
          createSignedUrls: () => Promise.resolve({ data: [], error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
// diretor.ts puxa o criador de item da Agenda (com import https); aqui ele não é usado.
vi.mock("../../supabase/functions/_shared/post-de-fotos-item.ts", () => ({ criarItemDoPostDeFotos: vi.fn() }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { MesaFotoProvider, type MesaFotoValor } from "@/components/mesa-foto/Comuns";
import AgenteDiretor from "@/components/mesa-foto/AgenteDiretor";
import { mensagensDoHistorico, normalizarOpcoesDoDiretor } from "@/components/mesa-foto/fotoApi";
import {
  caminhoDaAcaoDoDiretor,
  chamadaDaGeracao,
  type EntradaDoPacote,
  ensaioPedido,
  fotosDoKitPedidas,
  itensDaReferencia,
  lerFoco,
  montarPacote,
  motivosDasSugestoesQueCairam,
  nomeDoKitPedido,
  normalizarAcoesDoDiretor,
  opcoesDoPacote,
  pareceQuePromete,
  REGRA_DO_PEDIDO_DE_FAZER,
  regrasDoDiretor,
  respostaSemPromessa,
  sugestoesComIds,
  textoDoEvitar,
  type PedidoDaGeracao,
} from "../../supabase/functions/mesa-foto/diretor-agentico";
import { prometeuSemFazer } from "../../supabase/functions/mesa-foto/promessa-do-diretor";
import { acoesDoDiretor } from "../../supabase/functions/mesa-foto/diretor";
import type { FerramentasDaMesa } from "../../supabase/functions/mesa-foto/ferramentas";
import { normalizarSugestoes } from "../../supabase/functions/mesa-foto/calculos";
import { podeExecutarDireto, type AcaoDoAgente } from "../../supabase/functions/_shared/acoes-do-agente";
import { blocoDaReferencia, referenciaDoPedido } from "../../supabase/functions/_shared/conversa-das-mesas";
import { aprenderDoPedido, regrasDaMesa, rotasDoAprendizado, type JulgamentoDoEnsino } from "../../supabase/functions/_shared/aprendizado-das-mesas";

// O jsdom não tem AbortSignal.timeout (o ajudante do Jev usa): um equivalente simples para os testes.
if (typeof (AbortSignal as any).timeout !== "function") {
  (AbortSignal as any).timeout = (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  };
}

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const indice = ler("supabase/functions/mesa-foto/index.ts");
const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const proximos = ["\nasync function ", "\nfunction ", "\nconst ACOES"].map((m) => texto.indexOf(m, i + 10)).filter((x) => x > 0);
  return texto.slice(i, Math.min(...proximos));
};

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const F1 = "aaaaaaaa-0000-4000-8000-000000000001";
const F2 = "aaaaaaaa-0000-4000-8000-000000000002";
const F3 = "aaaaaaaa-0000-4000-8000-000000000003";
const G1 = "aaaaaaaa-0000-4000-8000-000000000009";
const KIT = "bbbbbbbb-0000-4000-8000-000000000001";
const CL = "dddddddd-0000-4000-8000-000000000001";
const ENS = "cccccccc-0000-4000-8000-000000000001";

function entrada(extra: Partial<EntradaDoPacote> = {}): EntradaDoPacote {
  return {
    clientId: CLIENTE,
    cliente: "AcelerIQ",
    foco: lerFoco({ etapa: "acervo", imagem_ids: [F2] }),
    imagens: [
      { id: F1, nome: "mouse-frente.jpg", tags: [], ativa: true, criado_em: "2026-09-28" },
      { id: F2, nome: "mouse-caixa.jpg", tags: [], ativa: true, criado_em: "2026-09-27" },
      { id: F3, nome: "almir-rosto.jpg", tags: ["pessoa_real_autorizada"], ativa: true, criado_em: "2026-09-26" },
      { id: G1, nome: "gerada.png", tags: ["gerada"], ativa: true, gerada: true, aprovada: false, criado_em: "2026-09-29" },
    ],
    clones: [{ id: CL, nome: "Almir", status: "pronta", identidade_real: [{ imagem_id: F3, principal: true }], autorizacao_ok: true }],
    prompts: [],
    books: [],
    kits: [{ id: KIT, nome: "Mouse NTC", variante: "grafite", status: "rascunho", refs: [{ imagem_id: F1, papel: "identidade" }] }],
    personas: [],
    campanhas: [],
    posts: [],
    leituras: {},
    lidasNoStorage: [],
    ...extra,
  };
}

// ------------------------------------------------------------------ 1. causa do "promete e não faz"

describe("promete e não faz: causa e trava", () => {
  it("a sugestão de campanha sem produto caía calada; agora deixa o motivo e a resposta vira aviso honesto", () => {
    const p = montarPacote(entrada());
    // O que o modelo devolveu em 26/09 20:28 (campanha para o clone, sem kit).
    const bruto = [{ tipo: "campanha", titulo: "Almir de óculos", motivo: "3 cenas", kit_id: null, quantidade: 3, fotos: [] }];
    const brutas = sugestoesComIds(bruto, p);
    const ficaram = normalizarSugestoes(brutas, { tomadaIds: [], kitIds: [KIT], kitPadrao: null });
    expect(ficaram).toHaveLength(0);
    const motivos = motivosDasSugestoesQueCairam(brutas, ficaram);
    expect(motivos).toEqual(["a campanha com modelo precisa de um produto (kit) com fotos"]);
    const real = "Entendi: vou usar o clone Almir e as fotos enviadas.\nPlano: 3 imagens verticais 4:5.\nPróximo passo: aplique a campanha abaixo para gerar as três imagens com o clone Almir.";
    expect(pareceQuePromete(real)).toBe(true);
    expect(pareceQuePromete("Entendi: você quer fotos com óculos.\nPlano: preparei uma campanha com 4 fotos.")).toBe(true);
    expect(pareceQuePromete("Qual clone você quer usar, o Almir ou a Marina?")).toBe(false);
    const honesta = respostaSemPromessa(real, { entendi: "vou usar o clone Almir e as fotos enviadas.", motivos, pergunta: null });
    expect(honesta).toContain("Entendi: vou usar o clone Almir");
    expect(honesta).toContain("Atenção: ainda não preparei nada nesta resposta: a campanha com modelo precisa de um produto");
    expect(honesta).toContain("Próximo passo:");
    expect(honesta).not.toMatch(/aplique a campanha abaixo/);
    expect(honesta).not.toMatch(/[—–]/);
    // Opções que o diretor consegue fazer: o clone autorizado vira "Gerar com o clone Almir" (gerar_clone c1).
    const opcoes = opcoesDoPacote(p);
    expect(opcoes[0]).toEqual({ rotulo: "Gerar com o clone Almir", mensagem: "Gere as fotos que pedi com o clone c1 (Almir)." });
    expect(opcoes.some((o) => /Monte o ensaio de variações do produto k1/.test(o.mensagem))).toBe(true);
  });

  it("sugestões falam em apelido (k#, i#): viram id no servidor; apelido inventado some", () => {
    const p = montarPacote(entrada());
    const [plano, ident] = sugestoesComIds([
      { tipo: "plano_de_variacoes", kit_id: "k1", quantidade: 4 },
      { tipo: "identificar_produto", imagem_ids: ["i2", "i99", F1] },
    ], p) as Record<string, unknown>[];
    expect(plano.kit_id).toBe(KIT);
    const i2 = p.imagens.find((i) => i.ref === "i2")!.id;
    expect(ident.imagem_ids).toEqual([i2, F1]);
    // Foto anexada fora do pacote chega como x1.
    const [estilo] = sugestoesComIds([{ tipo: "campanha", referencias_estilo_ids: ["x1"] }], p, { x1: G1 }) as Record<string, unknown>[];
    expect(estilo.referencias_estilo_ids).toEqual([G1]);
  });

  it("trava: só chama o Jev quando a regra desconfia; Jev decide; sem Jev, a regra avisa", async () => {
    const chamado = vi.fn();
    const semPromessa = await prometeuSemFazer("Qual das fotos você prefere?", "faz algo", { chave: "k", fetchImpl: chamado as unknown as typeof fetch });
    expect(semPromessa).toEqual({ prometeu: false, probabilidade: null, fonte: "nenhuma" });
    expect(chamado).not.toHaveBeenCalled();
    const jev = (noul: number) => (async () => new Response(JSON.stringify({ answers: { promessa: { noul } } }), { status: 200 })) as unknown as typeof fetch;
    expect((await prometeuSemFazer("Preparei a campanha abaixo.", "prepare tudo", { chave: "k", fetchImpl: jev(0.93) })).prometeu).toBe(true);
    expect((await prometeuSemFazer("O cartão de ontem já foi feito; quer outro?", "e agora?", { chave: "k", fetchImpl: jev(0.12) })).prometeu).toBe(false);
    const fora = (async () => {
      throw new Error("fora do ar");
    }) as unknown as typeof fetch;
    expect(await prometeuSemFazer("Vou gerar as 3 fotos.", "gera", { chave: "k", fetchImpl: fora, timeoutMs: 200 })).toMatchObject({ prometeu: true, fonte: "regra" });
  });

  it("o sistema do diretor leva a regra do pedido de fazer (pessoa real = clone), sem UUID nos dados", () => {
    expect(REGRA_DO_PEDIDO_DE_FAZER).toContain("gerar_clone com o clone c#");
    expect(REGRA_DO_PEDIDO_DE_FAZER).toContain("UMA pergunta curta em pergunta");
    expect(REGRA_DO_PEDIDO_DE_FAZER).toContain('Nunca escreva "vou gerar"');
    const conv = corpoDe(indice, "agenteConversar");
    expect(conv).toContain("${preparo.bloco}\\n${REGRA_DO_PEDIDO_DE_FAZER}${blocoDaReferencia(referencia, listaDaTela.itens)}${regras.bloco ? `\\n${regras.bloco}` : \"\"}");
    // Anexo, kit e prompt vão pelo apelido; nada de imagem_id: i.id ou id: k.id nos dados do modelo.
    expect(conv).toContain("ref: refDoAnexo(i.id),");
    expect(conv).not.toContain("imagem_id: i.id,");
    expect(conv).not.toContain("id: k.id,");
    expect(conv).toContain("const sugestoesBrutas = sugestoesComIds(r.sugestoes, pacote, anexosForaDoPacote);");
    // A trava só roda sem nada anexado e registra no log.
    expect(conv).toContain("if (!acaoProposta && !geracao && !sugestoes.length) {");
    expect(conv).toContain('registrarFalha("mesa-foto: diretor prometeu sem ação (resposta trocada por aviso)"');
    expect(indice).toContain("pergunta: S([\"string\", \"null\"]),");
    expect(indice).toContain("opcoes: lista(S(\"string\")),");
  });
});

// ------------------------------------------------------------------ 2. gravação e histórico

describe("conversa guardada: gravarTroca, aviso e histórico", () => {
  it("agente_conversar grava com gravarTroca ANTES de fazer na hora; sem mensagem guardada nada é feito", () => {
    const conv = corpoDe(indice, "agenteConversar");
    expect(indice).not.toContain("async function gravarMensagens(");
    expect(conv).toContain("const troca = await gravarTroca(servico(), {");
    expect(conv).toContain("let avisoRegistro: string | null = troca.erro ? AVISO_SEM_REGISTRO : null;");
    expect(conv.indexOf("const troca = await gravarTroca(")).toBeLessThan(conv.indexOf("await DIRETOR.executarDiretoDoDiretor("));
    expect(conv).toContain("if (!troca.agenteId) {");
    expect(conv).toContain("aviso_registro: avisoRegistro,");
    expect(conv).toContain("mensagem_id: troca.agenteId,");
    // O caminho e as respostas prontas ficam na mensagem (voltam ao reabrir).
    expect(conv).toContain("return anexosComCaminho(lista, caminhoDaMensagem);");
    expect(conv).toContain('lista.push({ tipo: "opcoes_do_diretor", pergunta: pergunta || null, opcoes });');
  });

  it("agente_historico existe, sem IA, e lê só a conversa do cliente", () => {
    const hist = corpoDe(indice, "agenteHistorico");
    expect(hist).toContain("await garantirAcesso(ch, clientId);");
    expect(hist).toContain('.eq("conversa_id", conversaId).eq("client_id", clientId)');
    expect(hist).toContain("custo_usd: 0");
    expect(hist).not.toContain("chamarTexto");
    expect(indice).toMatch(/\n {2}agente_historico: agenteHistorico,/);
    // Erro de leitura da conversa não vira conversa nova calada.
    expect(corpoDe(indice, "conversaExistente")).toContain('throw new ErroHttp(503, "conversa_indisponivel"');
  });

  it("a tela remonta cartões, caminho, opções e aprendizado do histórico (nada vai sozinho ao reabrir)", () => {
    const acao = { tipo: "acao_agente", agente: "diretor", id: "d1", resumo: "Arquivar 1", itens: [{ ref: "i2", alvo_id: F2, titulo: "caixa", detalhe: null, operacao: "arquivar_foto", rotulo: "arquivar", para: null }], ignorados: [], recusados: [], executada_em: "2026-09-29T10:00:00Z", executada_direto: true, resultados: [{ ref: "i2", alvo_id: F2, titulo: "caixa", operacao: "arquivar_foto", ok: true, desfazer: { ativa: true } }] };
    const msgs = mensagensDoHistorico([
      { id: "u1", papel: "usuario", conteudo: "Arquive a segunda", anexos: [{ imagem_id: F2 }] },
      { id: "a1", papel: "agente", conteudo: "Entendi: arquivar a i2.\nPróximo passo: conferir em Fotos.", anexos: [acao, { tipo: "opcoes_do_diretor", pergunta: null, opcoes: [{ rotulo: "Ver", mensagem: "Me mostre as fotos" }] }, { tipo: "caminho_do_agente", rotulo: "Ver em Fotos", destino: `/mesa-foto?client=${CLIENTE}&etapa=acervo` }, { tipo: "aprendizado_do_agente", id: null, texto: "Evitar fundo escuro", categoria: "evitar", decisao: "incerto" }] },
      { id: "s1", papel: "sistema", conteudo: "Diretor: 1 feito.", anexos: [] },
    ]);
    expect(msgs.map((m) => m.papel)).toEqual(["usuario", "agente", "agente"]);
    expect(msgs[0].anexos).toBe(1);
    expect(msgs[1].acao && msgs[1].acao.executada_em).toBeTruthy();
    expect(msgs[1].mensagemId).toBe("a1");
    expect(msgs[1].entendi).toBe("arquivar a i2.");
    expect(msgs[1].proximo_passo).toBe("conferir em Fotos.");
    expect(msgs[1].opcoes).toEqual([{ rotulo: "Ver", mensagem: "Me mostre as fotos" }]);
    expect(msgs[1].caminho).toEqual({ rotulo: "Ver em Fotos", destino: `/mesa-foto?client=${CLIENTE}&etapa=acervo` });
    expect(msgs[1].nova).toBe(false);
    expect(msgs[1].anexosBrutos).toHaveLength(4);
    expect(msgs[2].sistema).toBe(true);
    expect(normalizarOpcoesDoDiretor(["a", "a", "b", "c", "d", "e"]).map((o) => o.mensagem)).toEqual(["a", "b", "c", "d"]);
  });
});

// ------------------------------------------------------------------ 3. "essa", "a segunda", "todas"

describe("referência do pedido pela lista da tela", () => {
  it("a lista é a da etapa (fotos com as marcadas primeiro; clones em Clones) e o bloco vai para o sistema", async () => {
    const p = montarPacote(entrada());
    const lista = itensDaReferencia(p);
    expect(lista.itens[0].ref).toBe("i1");
    expect(lista.selecionados).toEqual(["i1"]);
    // i1 é a foto marcada na tela (F2).
    expect(p.imagens[0].id).toBe(F2);
    const clones = itensDaReferencia(montarPacote(entrada({ foco: lerFoco({ etapa: "clones", clone_id: CL }) })));
    expect(clones.itens.map((i) => i.ref)).toEqual(["c1"]);
    expect(clones.selecionados).toEqual(["c1"]);
    const jev = (async () => new Response(JSON.stringify({ answers: { alvo: { choice: "i2", probabilities: { i2: 0.88 } } } }), { status: 200 })) as unknown as typeof fetch;
    const r = await referenciaDoPedido("arquive a segunda", lista.itens, { agente: "diretor", selecionados: lista.selecionados, chave: "k", fetchImpl: jev });
    expect(r).toMatchObject({ refs: ["i2"], alcance: "um", incerta: false });
    expect(blocoDaReferencia(r, lista.itens)).toContain("i2");
    expect(corpoDe(indice, "agenteConversar")).toContain("const referencia = await referenciaDoPedido(mensagem, listaDaTela.itens, { agente: \"diretor de fotografia da Mesa Foto\", ultimaResposta, selecionados: listaDaTela.selecionados });");
  });
});

// ------------------------------------------------------------------ 4. ações novas

type Linha = Record<string, any>;

function bancoDaMesa(tabelas: Record<string, Linha[]>) {
  const updates: Array<{ tabela: string; patch: Linha; filtros: Array<[string, unknown]> }> = [];
  const from = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let patch: Linha | null = null;
    const linhas = () => (tabelas[tabela] || []).filter((l) => filtros.every(([c, v]) => l[c] === v));
    const fim = () => {
      if (patch) {
        updates.push({ tabela, patch, filtros: filtros.slice() });
        linhas().forEach((l) => Object.assign(l, patch));
        return { data: null, error: null };
      }
      return { data: linhas(), error: null };
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
      order: () => q,
      limit: () => q,
      update: (p: Linha) => ((patch = p), q),
      maybeSingle: () => Promise.resolve({ data: linhas()[0] ?? null, error: null }),
      then: (ok: any, erro: any) => Promise.resolve(fim()).then(ok, erro),
    };
    return q;
  };
  return { db: { from }, updates };
}

function diretorFalso(tabelas: Record<string, Linha[]>) {
  const banco = bancoDaMesa(tabelas);
  const chamadas: Array<{ acao: string; corpo: Linha }> = [];
  const f = {
    servico: () => banco.db,
    json: (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s }),
    garantirAcesso: async () => undefined,
    emParalelo: async (itens: unknown[], _n: number, fn: (x: unknown, i: number) => Promise<unknown>) => Promise.all(itens.map(fn)),
    lerImagens: async () => [],
  } as unknown as FerramentasDaMesa;
  const d = {
    chamar: async (acao: string, _ch: unknown, corpo: Linha) => {
      chamadas.push({ acao, corpo });
      if (acao === "agente_aplicar") return { ensaio: { id: ENS, tomadas: [1, 2, 3, 4, 5, 6, 7, 8] }, estimativa_usd: 0.68 };
      return { ok: true };
    },
    custoDoPreparo: async () => 0.04,
    lerPorVisao: async () => ({ bruto: null, custo_usd: 0 }),
    kitsDoCliente: async () => [],
    auditar: async () => undefined,
  };
  return { D: acoesDoDiretor(f, d as never), chamadas, updates: banco.updates };
}

function guardada(acao: AcaoDoAgente) {
  const g = { atual: acao };
  return {
    g: { mensagem: { id: "eeeeeeee-0000-4000-8000-000000000001", client_id: CLIENTE, conversa_id: null }, acao, gravar: async (novo: AcaoDoAgente) => ((g.atual = novo), novo) },
    ler: () => g.atual,
  };
}

const CH = { userId: "u-1", token: "t", doChamador: {} } as never;

describe("ações novas do diretor (produto e ensaio) com Desfazer", () => {
  it("montar ensaio: direto (sem custo, com Desfazer), salva pelo agente_aplicar sem gerar, custo no resultado; Desfazer arquiva", async () => {
    const p = montarPacote(entrada({ foco: lerFoco({ etapa: "kits", kit_id: KIT }) }));
    expect(ensaioPedido("variacoes 8")).toBe("variacoes:8");
    expect(ensaioPedido("campanha")).toBe("campanha:6");
    expect(ensaioPedido("tomar café")).toBeNull();
    const acao = normalizarAcoesDoDiretor({ resumo: "Monto as variações", itens: [{ operacao: "montar_ensaio", ref: "k1", para: "variacoes 8" }] }, p)!;
    expect(acao.itens[0]).toMatchObject({ alvo_id: KIT, para: "variacoes:8", para_rotulo: "variações, 8 fotos" });
    expect(podeExecutarDireto(acao, regrasDoDiretor(p), { pedidoClaro: true }).direto).toBe(true);
    // Produto sem fotos não monta ensaio (recusado com o motivo).
    const semFotos = montarPacote(entrada({ kits: [{ id: KIT, nome: "Mouse", status: "rascunho", refs: [] }] }));
    expect(normalizarAcoesDoDiretor({ resumo: "", itens: [{ operacao: "montar_ensaio", ref: "k1", para: "variacoes" }] }, semFotos)!.recusados[0].motivo).toContain("não tem fotos");

    const tabelas = { foto_ensaios: [{ id: ENS, client_id: CLIENTE, status: "planejado" }] };
    const { D, chamadas, updates } = diretorFalso(tabelas);
    const gd = guardada(acao);
    const r = await (await D.executarProposta(CH, {}, gd.g as never)).json();
    const feito = r.anexo as AcaoDoAgente;
    expect(feito.resultados![0]).toMatchObject({ ok: true, desfazer: { ensaio_id: ENS, tipo: "variacoes" } });
    expect(feito.resultados![0].motivo).toContain("gerar custa ~US$ 0.68");
    expect(chamadas[0]).toMatchObject({ acao: "agente_aplicar", corpo: { client_id: CLIENTE, kit_id: KIT, sugestao: { tipo: "plano_de_variacoes", quantidade: 8, kit_id: KIT } } });
    expect(chamadas.some((c) => /gerar|tomada_gerar|preparar/.test(c.acao))).toBe(false);
    expect(feito.caminho).toEqual({ rotulo: "Abrir as variações", destino: `/mesa-foto?client=${CLIENTE}&etapa=ensaio&ensaio=${ENS}&kit=${KIT}` });
    const volta = await (await D.desfazerProposta(CH, {}, guardada(feito).g as never)).json();
    expect(volta.voltaram).toBe(1);
    expect(updates).toEqual([{ tabela: "foto_ensaios", patch: { status: "arquivado" }, filtros: [["id", ENS], ["client_id", CLIENTE]] }]);
  });

  it("renomear o produto (direto) e trocar as fotos do produto (Confirmar) pelo kit_salvar; Desfazer volta como era", async () => {
    const p = montarPacote(entrada({ foco: lerFoco({ etapa: "kits", kit_id: KIT }) }));
    expect(p.kits[0].detalhe).toContain("fotos i2 identidade");
    expect(nomeDoKitPedido("Mouse NTC | Preto", { nome: "Mouse NTC", variante: "grafite" })).toBe("Mouse NTC|Preto");
    expect(nomeDoKitPedido("Mouse NTC", { nome: "Mouse NTC", variante: "grafite" })).toBeNull();
    const iCaixa = p.imagens.find((i) => i.id === F2)!.ref;
    const iFrente = p.imagens.find((i) => i.id === F1)!.ref;
    const iGerada = p.imagens.find((i) => i.id === G1)!.ref;
    expect(fotosDoKitPedidas(`${iFrente} identidade, ${iCaixa} embalagem`, p, [{ imagem_id: F1, papel: "identidade" }])).toBe(`${F1}:identidade,${F2}:embalagem`);
    // Gerada sem aprovação não vira evidência; o mesmo conjunto não é mudança.
    expect(fotosDoKitPedidas(`${iGerada} identidade`, p)).toBeNull();
    expect(fotosDoKitPedidas(`${iFrente} identidade`, p, [{ imagem_id: F1, papel: "identidade" }])).toBeNull();

    const acao = normalizarAcoesDoDiretor({
      resumo: "Produto",
      itens: [
        { operacao: "renomear_kit", ref: "k1", para: "Mouse NTC X | Preto" },
        { operacao: "fotos_do_kit", ref: "k1", para: `${iFrente} identidade, ${iCaixa} embalagem` },
      ],
    }, p)!;
    expect(acao.itens.map((i) => i.operacao)).toEqual(["renomear_kit", "fotos_do_kit"]);
    const regras = regrasDoDiretor(p);
    expect(regras.renomear_kit.direta).toBe(true);
    expect(regras.fotos_do_kit.direta).toBeUndefined();
    expect(podeExecutarDireto(acao, regras, { pedidoClaro: true }).direto).toBe(false);

    const tabelas = {
      foto_kits: [{ id: KIT, client_id: CLIENTE, tipo: "produto", nome: "Mouse NTC", variante: "grafite", atributos: {}, invariantes: [], lacunas: [], autorizacao: null, frente_imagem_id: F1, status: "rascunho" }],
      foto_kit_refs: [{ kit_id: KIT, imagem_id: F1, papel: "identidade", vista: "frente", prioridade: 0 }],
    };
    const { D, chamadas } = diretorFalso(tabelas);
    const r = await (await D.executarProposta(CH, {}, guardada(acao).g as never)).json();
    expect(r.feitos).toBe(2);
    const salvos = chamadas.filter((c) => c.acao === "kit_salvar");
    expect(salvos[0].corpo.kit).toMatchObject({ id: KIT, nome: "Mouse NTC X", variante: "Preto" });
    expect(salvos[0].corpo.kit.client_id).toBeUndefined();
    expect(salvos[1].corpo.refs).toEqual([{ imagem_id: F1, papel: "identidade", vista: "frente", prioridade: 0 }, { imagem_id: F2, papel: "embalagem", vista: null, prioridade: 100 }]);
    expect(r.anexo.caminho).toEqual({ rotulo: "Abrir o produto", destino: `/mesa-foto?client=${CLIENTE}&etapa=kits&kit=${KIT}` });
    chamadas.length = 0;
    await D.desfazerProposta(CH, {}, guardada(r.anexo).g as never);
    const voltas = chamadas.filter((c) => c.acao === "kit_salvar");
    // Desfaz na ordem inversa: primeiro as fotos, depois o nome.
    expect(voltas[0].corpo.refs).toEqual([{ imagem_id: F1, papel: "identidade", vista: "frente", prioridade: 0 }]);
    expect(voltas[1].corpo.kit).toMatchObject({ nome: "Mouse NTC", variante: "grafite" });
  });

  it("caminho da ação feita: montar campanha abre a Campanha", () => {
    const c = caminhoDaAcaoDoDiretor({ agente: "diretor", itens: [], resultados: [{ ok: true, operacao: "montar_ensaio", alvo_id: KIT, desfazer: { ensaio_id: ENS, tipo: "campanha" } }] }, CLIENTE);
    expect(c).toEqual({ rotulo: "Abrir a campanha", destino: `/mesa-foto?client=${CLIENTE}&etapa=campanha&ensaio=${ENS}&kit=${KIT}` });
  });
});

// ------------------------------------------------------------------ 5. aprendizado ligado à mesa "foto"

function bancoDoCerebro() {
  const linhas: Linha[] = [];
  let n = 0;
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Linha = {};
    let novo: Linha | null = null;
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
    const q: any = {
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
    };
    return q;
  };
  return { db: { from }, linhas };
}
const julgar = (decisao: JulgamentoDoEnsino["decisao"]) => async (): Promise<JulgamentoDoEnsino> => ({ decisao, tipo: "evitar", probabilidade: 0.9, fonte: "jev" });

describe("aprendizado do diretor de fotografia", () => {
  it("a regra é criada na mesa foto e obedecida: entra no sistema da conversa, da direção e no pedido de cada foto", async () => {
    const { db } = bancoDoCerebro();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "foto", pedido: "nunca use fundo escuro nas fotos", regraSugerida: "Não usar fundo escuro nas fotos" }, { julgarEnsino: julgar("preferencia_duradoura"), julgarDuplicidade: null });
    expect(a).toMatchObject({ texto: "Não usar fundo escuro nas fotos", mesa: "foto", situacao: "criado" });
    const r = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "foto" });
    expect(r.bloco).toContain("EVITAR:\n- g1: Não usar fundo escuro nas fotos");
    const conv = corpoDe(indice, "agenteConversar");
    expect(conv).toContain('regrasDaMesa(servico(), { clientId, mesa: "foto", marcaId }),');
    expect(conv).toContain('aprenderDoPedido(servico(), { clientId, mesa: "foto", pedido: mensagem, regraSugerida: r.regra_aprendida, marcaId, userId: ch.userId, ultimaResposta }),');
    expect(conv).toContain("if (geracao && evitar.length) geracao = { ...geracao, contexto: { ...(geracao.contexto || {}), evitar } };");
    expect(indice).toContain("...CAMPOS_DO_APRENDIZADO,");
    for (const nome of ["ensaioPlanejar", "variacoesPlanejar", "campanhaPlanejar"]) expect(corpoDe(indice, nome), nome).toContain("regrasEnsinadas.bloco");
    // Reprovar com motivo ensina (forcar), depois da decisão.
    expect(corpoDe(indice, "versaoDecidir")).toContain('aprenderDoPedido(servico(), { clientId: ensaio.client_id, mesa: "foto", pedido: motivo, motivo,');
    // Na geração: o EVITAR entra no pedido de cada foto.
    const pd: PedidoDaGeracao = { operacao: "gerar_clone", alvo_ref: "c1", alvo_id: CL, cenario: "café", pose: "", roupa: "", livre: "sorrindo", formato: null, prompt_id: null, prompt_texto: "", kit_id: null, clone_id: CL, vez: 1, vezes: 1 };
    const chamada = chamadaDaGeracao(pd, CLIENTE, { evitar: ["Não usar fundo escuro nas fotos"] });
    expect((chamada.corpo.pedido as Linha).livre).toBe("sorrindo. Evite: Não usar fundo escuro nas fotos");
    expect(chamadaDaGeracao(pd, CLIENTE).corpo).toEqual({ modelo_id: CL, pedido: { cenario: "café", pose: "", roupa: "", livre: "sorrindo" } });
    expect(textoDoEvitar([])).toBe("");
  });

  it("pedido de uma vez só não vira regra; repetida reforça; Esquecer tira (rotas na função)", async () => {
    const { db, linhas } = bancoDoCerebro();
    expect(await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "foto", pedido: "não gostei dessa luz, só nesta foto" }, { julgarEnsino: julgar("so_desta_vez") })).toBeNull();
    expect(linhas).toHaveLength(0);
    const pedir = () => aprenderDoPedido(db, { clientId: CLIENTE, mesa: "foto", pedido: "nunca ponha fumaça", regraSugerida: "Não usar fumaça" }, { julgarEnsino: julgar("preferencia_duradoura"), julgarDuplicidade: null });
    const primeira = await pedir();
    const segunda = await pedir();
    expect(linhas).toHaveLength(1);
    expect(segunda).toMatchObject({ id: primeira!.id, situacao: "reforcado" });
    const rotas = rotasDoAprendizado({ mesa: "foto", servico: () => db, garantirAcesso: async () => true, json: (c, s = 200) => new Response(JSON.stringify(c), { status: s }) });
    const r = await rotas.aprendizado_esquecer({ userId: "u1" }, { client_id: CLIENTE, id: primeira!.id });
    expect(r.status).toBe(200);
    expect(linhas[0].ativa).toBe(false);
    expect(indice).toContain('const APRENDIZADO_DO_DIRETOR = rotasDoAprendizado({ mesa: "foto", servico: () => servico(), garantirAcesso: (c, clientId) => garantirAcesso(c as Chamador, clientId), json });');
    for (const a of ["aprendizado_esquecer", "aprendizado_guardar"]) expect(indice).toMatch(new RegExp(`\n  ${a}: APRENDIZADO_DO_DIRETOR\.${a},`));
  });
});

// ------------------------------------------------------------------ 6. tela: reabrir, falha no envio, aviso e opções

const catalogo: ModeloIa[] = [
  {
    id: "openai:gpt-texto", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Texto",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["estrategista", "diretor_arte", "leitura"], ativo: true,
  },
];

let respostas: Record<string, any> = {};

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!(Element.prototype as any).scrollIntoView) (Element.prototype as any).scrollIntoView = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = { cliente_imagens: [] };
  respostas = {};
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: { saldo_usd: 12.5, total_usd: 3.2, por_modelo: [], por_tarefa: [] }, error: null });
  mock.invoke.mockImplementation(async (_nome: string, opcoes: any) => {
    const acao = opcoes && opcoes.body ? opcoes.body.acao : "";
    if (respostas[acao] !== undefined) return { data: typeof respostas[acao] === "function" ? respostas[acao](opcoes.body) : respostas[acao], error: null };
    return { data: { ok: true, custo_usd: 0 }, error: null };
  });
});

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-foto" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar(clientId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mesa: MesaValor = {
    clientId, clientName: "AcelerIQ", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50, catalogo, catalogoCarregando: false,
    atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
  } as MesaValor;
  const foto: MesaFotoValor = { kitId: null, ensaioId: null, imagemId: null, escolherKit: vi.fn(), escolherEnsaio: vi.fn(), irPara: vi.fn(), selecionadas: [], setSelecionadas: vi.fn(), abrirAgente: vi.fn() } as MesaFotoValor;
  return render(
    h(QueryClientProvider, { client: qc },
      h(MemoryRouter, { initialEntries: [`/mesa-foto?client=${clientId}`] },
        h(TooltipProvider, null, h(MesaProvider, { valor: mesa, children: h(MesaFotoProvider, { valor: foto, children: h(AgenteDiretor, {}) }) })))),
  );
}

describe("tela do diretor", () => {
  it("reabrir: a conversa guardada volta com o cartão no estado feito e a próxima mensagem segue nela", async () => {
    const cliente = "11111111-0000-4000-8000-000000000001";
    respostas.agente_historico = {
      conversa_id: "99999999-0000-4000-8000-000000000001",
      mensagens: [
        { id: "u1", papel: "usuario", conteudo: "Arquive a foto da caixa", anexos: [] },
        {
          id: "a1",
          papel: "agente",
          conteudo: "Entendi: arquivar a foto da caixa.\nPróximo passo: conferir em Fotos.",
          anexos: [{ tipo: "acao_agente", agente: "diretor", id: "d1", resumo: "Arquivar 1 foto", itens: [{ ref: "i2", alvo_id: F2, titulo: "caixa", detalhe: null, operacao: "arquivar_foto", rotulo: "arquivar", para: null }], ignorados: [], recusados: [], executada_em: "2026-09-29T10:00:00Z", executada_direto: true, resultados: [{ ref: "i2", alvo_id: F2, titulo: "caixa", operacao: "arquivar_foto", ok: true, desfazer: { ativa: true } }] }],
        },
      ],
    };
    respostas.agente_conversar = { resposta: "Pronto.", sugestoes: [], conversa_id: "99999999-0000-4000-8000-000000000001", custo_usd: 0.01 };
    montar(cliente);
    expect(await screen.findByText("Arquive a foto da caixa")).toBeTruthy();
    expect(chamadasDe("agente_historico")[0]).toEqual({ acao: "agente_historico", client_id: cliente });
    expect(await screen.findByRole("button", { name: /Desfazer/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Mensagem ao diretor"), { target: { value: "E agora?" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(1));
    expect(chamadasDe("agente_conversar")[0].conversa_id).toBe("99999999-0000-4000-8000-000000000001");
  });

  it("envio que falha: a bolha sai, o texto volta ao campo e o erro aparece (reenviar não duplica)", async () => {
    const cliente = "11111111-0000-4000-8000-000000000002";
    respostas.agente_conversar = { error: "conversa_indisponivel", mensagem: "Não foi possível ler a conversa com o diretor agora." };
    montar(cliente);
    const campo = (await screen.findByLabelText("Mensagem ao diretor")) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "Gere 3 fotos do Almir" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(1));
    await waitFor(() => expect(campo.value).toBe("Gere 3 fotos do Almir"));
    expect(screen.queryAllByText("Gere 3 fotos do Almir").filter((el) => el.tagName !== "TEXTAREA")).toHaveLength(0);
    expect(document.querySelector("[data-diretor-vazio]")).toBeTruthy();
  });

  it("aviso de registro aparece; a pergunta vem com respostas prontas que mandam a resposta; Nova conversa fica marcada", async () => {
    const cliente = "11111111-0000-4000-8000-000000000003";
    respostas.agente_conversar = (corpo: any) =>
      corpo.mensagem === "Gere as fotos que pedi com o clone c1 (Almir)."
        ? { resposta: "Entendi: vou gerar.", sugestoes: [], conversa_id: "99999999-0000-4000-8000-000000000003", custo_usd: 0.01 }
        : {
          resposta: "Entendi: fotos suas de óculos.\nAtenção: ainda não preparei nada nesta resposta.\nPróximo passo: Qual destes caminhos eu sigo agora?",
          sugestoes: [],
          conversa_id: "99999999-0000-4000-8000-000000000003",
          mensagem_id: null,
          aviso_registro: "A resposta chegou, mas não ficou guardada na conversa. Os cartões desta resposta não podem ser confirmados; peça de novo.",
          opcoes: [{ rotulo: "Gerar com o clone Almir", mensagem: "Gere as fotos que pedi com o clone c1 (Almir)." }],
          custo_usd: 0.01,
        };
    montar(cliente);
    fireEvent.change(await screen.findByLabelText("Mensagem ao diretor"), { target: { value: "prepare tudo pra mim" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar" }));
    expect(await screen.findByText(/não ficou guardada na conversa/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar com o clone Almir" }));
    await waitFor(() => expect(chamadasDe("agente_conversar")).toHaveLength(2));
    expect(chamadasDe("agente_conversar")[1].mensagem).toBe("Gere as fotos que pedi com o clone c1 (Almir).");
    fireEvent.click(await screen.findByRole("button", { name: "Nova conversa" }));
    expect(window.sessionStorage.getItem(`mesa-foto:conversa-nova:${cliente}`)).toBe("1");
  });

  it("fonte da tela: a bolha otimista sai pelo id no erro e o histórico só entra com a lista vazia", () => {
    const tela = ler("src/components/mesa-foto/AgenteDiretor.tsx");
    expect(tela).toContain("mudarConversa(alvo, (st) => ({ mensagens: st.mensagens.filter((x) => x.id !== idDaBolha) }));");
    expect(tela).toContain("setTexto((t) => t || msg);");
    expect(tela).toContain("e.mensagens.length || e.pendente || e.novaConversa ? {} : { mensagens: r.mensagens, conversaId: r.conversa_id || e.conversaId }");
    expect(tela).toContain("<AprendizadoDoAgente");
  });
});
