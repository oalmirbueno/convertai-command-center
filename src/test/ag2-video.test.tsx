import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Frente AG2 (29/09/2026): diretor de vídeo e agente da Mesa Vídeos.
 * - a conversa do diretor mora no banco (agente_conversas "mesa_videos") e o modelo recebe o histórico,
 *   o estado real do roteiro, a referência do pedido ("a segunda") e as regras ensinadas;
 * - gerar e refazer: cartão com o custo de cada plano (o executor não passa do que foi confirmado);
 * - mandar ao editor: ordem clara vai na hora, com prova e Desfazer (a versão fica rejeitada);
 * - aprendizado: regra criada e obedecida, uma vez só não vira regra, repetida reforça, Esquecer tira;
 * - agente da mesa: arquivar e ligar à cena pelo contrato comum; tela que não perde a mensagem.
 * O banco, o Jev, o modelo e o gerador são falsos: nada gasta.
 */

// ------------------------------------------------------------------ mocks (servidor)

const jev = vi.hoisted(() => ({ respostas: {} as Record<string, unknown>, chamadas: [] as Array<{ questions: Record<string, unknown>; state: unknown }> }));
const modelo = vi.hoisted(() => ({ json: {} as Record<string, unknown>, chamadas: [] as Array<Record<string, any>> }));
const gerador = vi.hoisted(() => ({ chamadas: [] as Array<Record<string, any>> }));

vi.mock("../../supabase/functions/_shared/jev.ts", async (original) => {
  const real = await original<typeof import("../../supabase/functions/_shared/jev")>();
  return {
    ...real,
    jevPerguntar: vi.fn(async (p: { questions: Record<string, unknown>; state: unknown }) => {
      jev.chamadas.push(p);
      const answers: Record<string, unknown> = {};
      Object.keys(p.questions).forEach((k) => {
        if (k in jev.respostas) answers[k] = jev.respostas[k];
      });
      return { answers, usage: null, modelo: "jev" };
    }),
  };
});
vi.mock("../../supabase/functions/_shared/ia-motor.ts", () => ({
  chamarTexto: vi.fn(async (e: Record<string, any>) => {
    modelo.chamadas.push(e);
    return { texto: JSON.stringify(modelo.json), json: modelo.json, usoId: "", custoUsd: 0.02, saldoUsd: 9, modeloId: "luna" };
  }),
  cobrarJev: vi.fn(async () => null),
  IaMotorErro: class IaMotorErro extends Error {},
}));
vi.mock("../../supabase/functions/_shared/contexto-cliente.ts", () => ({ lerContextoConsolidado: async () => ({}), lerDossie: async () => null }));
vi.mock("../../supabase/functions/_shared/imagem-reduzida.ts", () => ({ caminhoDaMiniatura: (x: string) => x, reduzidaSemTransformacao: async () => null }));
vi.mock("../../supabase/functions/mesa-videos/modulos/video-armazenar.ts", () => ({ leituraParaAVisao: () => ({ miniatura: false, caixa: 512, opcoes: {} }) }));
vi.mock("../../supabase/functions/mesa-videos/geracao.ts", async () => {
  const m = await import("../../supabase/functions/mesa-videos/modulos/modelos-de-video");
  return {
    catalogo: async () => ({ motores: m.MOTORES_DE_VIDEO, desligados: [] }),
    motorPronto: async (_b: unknown, id: string) => ({ motor: m.motorPorId(id), motores: m.MOTORES_DE_VIDEO }),
    enviarGeracao: async (_b: unknown, p: Record<string, any>) => {
      gerador.chamadas.push(p);
      return { ok: true, pedido_id: "pedido-12345678" };
    },
  };
});

// ------------------------------------------------------------------ mocks (tela)

const tela = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown[]> }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = tela.tabelas[tabela] || [];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: dados[0] ?? null, error: null });
    b.single = b.maybeSingle;
    b.then = (ok: any, falha: any) => Promise.resolve({ data: dados, error: null, count: dados.length }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: tela.invoke },
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      from: (t: string) => consulta(t),
      storage: { from: () => ({ list: () => Promise.resolve({ data: [], error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.test/v.mp4" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import DiretorDoVideo from "@/components/mesa-videos/DiretorDoVideo";
import AgenteDaMesaDeVideo, { tituloDoCartaoDaMesa } from "@/components/mesa-videos/AgenteDaMesaDeVideo";
import { __zerarProjetosDoDiretor, desfazerProjetoDoDiretor, gravarProjetoDoDiretor, projetoAtualDoDiretor } from "@/lib/mesa-videos/api";
import { conversaDoProjeto, desfazerItemDoDiretor, diretorConversar, executarItemDoDiretor, REFERENCIA_DA_CONVERSA } from "../../supabase/functions/mesa-videos/diretor";
import type { BaseDaFuncao } from "../../supabase/functions/mesa-videos/geracao";
import {
  acaoDeGerarPlanos,
  acaoDeMandarAoEditor,
  aplicarRespostaDoDiretor,
  blocoDoEstadoReal,
  normalizarProjetoDoDiretor,
  prometeSemAcao,
  REGRAS_DIRETAS_DO_DIRETOR,
  type ProjetoDoDiretor,
} from "../../supabase/functions/mesa-videos/modulos/diretor-de-video";
import {
  acaoDeArquivarResultados,
  acaoDeLigarACena,
  AGENTE_DOS_RESULTADOS,
  AGENTES_DA_MESA_DE_VIDEO,
  caminhoDaMesaDeVideo,
  intencaoPorPalavras,
  itensReferiveis,
  lerParaDaCena,
  REGRAS_DO_ENVIO,
  REGRAS_DOS_RESULTADOS,
  type ResultadoGerado,
} from "../../supabase/functions/mesa-videos/modulos/agente-de-video";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { rotasDoAprendizado } from "../../supabase/functions/_shared/aprendizado-das-mesas";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const ARQ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROTEIRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8").replace(/\r\n/g, "\n");

// ------------------------------------------------------------------ banco falso (várias tabelas, encadeamento do supabase-js)

type Linha = Record<string, any>;

function bancoFalso(inicial: Record<string, Linha[]> = {}) {
  const tabelas: Record<string, Linha[]> = {};
  Object.keys(inicial).forEach((k) => (tabelas[k] = inicial[k].map((l) => ({ ...l }))));
  let n = 0;
  let relogio = Date.parse("2026-09-29T10:00:00Z");
  const novoId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const consulta = (tabela: string) => {
    const lista = () => (tabelas[tabela] = tabelas[tabela] || []);
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Linha = {};
    let inseridas: Linha[] = [];
    let limite = Infinity;
    let ordem: { col: string; asc: boolean } | null = null;
    const q: Record<string, any> = {};
    const alvo = () => {
      let r = lista().filter((l) => filtros.every((f) => f(l)));
      if (ordem) {
        const o = ordem;
        r = r.slice().sort((a, b) => (String(a[o.col]) < String(b[o.col]) ? -1 : String(a[o.col]) > String(b[o.col]) ? 1 : 0) * (o.asc ? 1 : -1));
      }
      return r.slice(0, limite);
    };
    const fim = (): { data: any; error: any } => {
      if (op === "update") {
        const a = alvo();
        a.forEach((l) => Object.assign(l, patch));
        return { data: a, error: null };
      }
      if (op === "insert") return { data: inseridas, error: null };
      return { data: alvo(), error: null };
    };
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      order: (c: string, o: { ascending?: boolean } = {}) => ((ordem = { col: c, asc: o.ascending !== false }), q),
      limit: (k: number) => ((limite = k), q),
      update: (p: Linha) => ((op = "update"), (patch = p), q),
      insert: (p: Linha | Linha[]) => {
        op = "insert";
        inseridas = (Array.isArray(p) ? p : [p]).map((x) => ({ id: novoId(), criado_em: new Date(relogio++).toISOString(), ativa: true, reforcos: 1, ...x }));
        lista().push(...inseridas);
        return q;
      },
      single: () => {
        const r = fim();
        return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error });
      },
      maybeSingle: () => {
        const r = fim();
        return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error });
      },
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(fim()).then(ok, erro),
    });
    return q;
  };
  const storage = { from: () => ({ createSignedUrl: async (c: string) => ({ data: { signedUrl: `https://arquivo.test/${c}` }, error: null }) }) };
  return { db: { from: consulta, storage }, tabelas };
}

function baseFalsa(db: { from: (t: string) => any }): BaseDaFuncao {
  return {
    servico: () => db as any,
    garantirAcesso: async () => {},
    erro: (status, codigo, mensagem, extra = {}) => Object.assign(new Error(mensagem), { status, codigo, extra }),
    json: (corpo: unknown) => ({ corpo }) as unknown as Response,
    auditar: async () => {},
    userId: "u-1",
    admin: true,
  };
}
const corpoDe = (r: unknown) => (r as { corpo: Record<string, any> }).corpo;

/** Projeto com dois planos prontos (folha do personagem) e um terceiro sem prompt. */
function projetoPronto(extra: Partial<ProjetoDoDiretor> = {}): ProjetoDoDiretor {
  const p = normalizarProjetoDoDiretor({
    titulo: "Padaria",
    biblia: {
      titulo: "Padaria",
      formato: "9:16",
      estilo: { paleta: [], lente: "35mm", luz: "manhã", clima: "", textura: "" },
      personagens: [{ id: "pe1", nome: "Seu João", aparencia: "man in his 60s, grey beard", roupa: "white apron", folha_path: `${CLIENTE}/video/quadros/folha.png` }],
      cenarios: [],
      regras: [],
      fatos: [],
      fontes: [],
      perguntas: [],
    },
    roteiro: {
      planos: [
        { titulo: "Abertura", duracao_s: 6, personagens: ["pe1"], motor: "veo-3.1", modo: "primeiro_quadro", prompt: "man in his 60s, grey beard opens the bakery", quadro_inicial: { tipo: "folha", ref: "pe1" } },
        { titulo: "Pão saindo", duracao_s: 6, personagens: ["pe1"], motor: "veo-3.1", modo: "primeiro_quadro", prompt: "man in his 60s, grey beard takes bread out", quadro_inicial: { tipo: "folha", ref: "pe1" } },
        { titulo: "Sem prompt", duracao_s: 6, motor: "veo-3.1", modo: "texto", prompt: "" },
      ],
      notas: "",
    },
  })!;
  return { ...p, ...extra };
}

const respostaDoModelo = (x: Record<string, unknown> = {}) => ({ resposta: "Certo.", perguntas: [], fontes: [], fatos: [], biblia: null, roteiro: null, acao: null, regra_aprendida: null, regras_seguidas: [], ...x });

beforeEach(() => {
  jev.respostas = {};
  jev.chamadas = [];
  modelo.json = respostaDoModelo();
  modelo.chamadas = [];
  gerador.chamadas = [];
  tela.invoke.mockReset();
  tela.tabelas = {};
  __zerarProjetosDoDiretor();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

// ------------------------------------------------------------------ diretor: conversa guardada e estado real

describe("diretor: a conversa mora no banco e o modelo sabe o estado real", () => {
  it("primeiro pedido cria o projeto e a conversa (agente diretor_arte, referência mesa_videos) com as duas mensagens; o segundo manda o histórico ao modelo sem 'projeto mudou'", async () => {
    const { db, tabelas } = bancoFalso();
    const b = baseFalsa(db);
    modelo.json = respostaDoModelo({ resposta: "Qual é o bairro da padaria?", perguntas: ["Qual é o bairro?"] });
    const r1 = corpoDe(await diretorConversar(b, { client_id: CLIENTE, projeto: projetoPronto(), texto: "quero um filme de 30 s da padaria", fase: "briefing" }));
    // ia_usos: tarefa e agente dentro do check do banco.
    expect(modelo.chamadas[0]).toEqual(expect.objectContaining({ tarefa: "conversa", agente: "diretor_arte" }));
    expect(r1.projeto.id).toBeTruthy();
    expect(r1.mensagem_id).toBeTruthy();
    expect(r1.aviso_registro).toBeUndefined();
    expect(tabelas.agente_conversas).toEqual([expect.objectContaining({ client_id: CLIENTE, agente: "diretor_arte", referencia_tipo: REFERENCIA_DA_CONVERSA, referencia_id: r1.projeto.id })]);
    expect(tabelas.agente_mensagens.map((m) => m.papel)).toEqual(["usuario", "agente"]);
    expect(tabelas.agente_mensagens.every((m) => Array.isArray(m.anexos))).toBe(true);

    // Nada mudou na bíblia nem no roteiro, mas o banco subiu a versão: a resposta traz a versão nova.
    const r2 = corpoDe(await diretorConversar(b, { client_id: CLIENTE, projeto: r1.projeto, texto: "Batel", fase: "briefing" }));
    expect(r2.avisos.join(" ")).not.toMatch(/outra tela/);
    const mensagens = modelo.chamadas[1].mensagens as Array<{ papel: string; conteudo: string }>;
    expect(mensagens.map((m) => m.papel)).toEqual(["usuario", "agente", "usuario"]);
    expect(mensagens[1].conteudo).toBe("Qual é o bairro da padaria?");
    expect(tabelas.agente_mensagens).toHaveLength(4);
    expect(await conversaDoProjeto(b, CLIENTE, r1.projeto.id, false)).toBe(tabelas.agente_conversas[0].id);
  });

  it("o sistema leva o ESTADO REAL (pronto, motivo, gerando) e 'a segunda' vira p2 pelo Jev", async () => {
    const projeto = projetoPronto({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", versao: 3 });
    const { db } = bancoFalso({
      video_diretor_projetos: [{ id: projeto.id, client_id: CLIENTE, versao: 3 }],
      video_pedidos: [{ id: "p-1", client_id: CLIENTE, projeto_id: projeto.id, alvo: { plano_ref: "p1" }, estado: "gerando" }],
    });
    jev.respostas = { alvo: { choice: "p2", probabilities: { p2: 0.92 } } };
    await diretorConversar(baseFalsa(db), { client_id: CLIENTE, projeto, texto: "troca o motor da segunda para o kling", fase: "roteiro" });
    const sistema = String(modelo.chamadas[0].sistema);
    expect(sistema).toMatch(/ESTADO REAL DO ROTEIRO/);
    expect(sistema).toMatch(/p1 \(Abertura\): pronto para gerar; US\$ [\d.]+ por variação; 1 gerando/);
    expect(sistema).toMatch(/p3 \(Sem prompt\): não pronto: Plano sem prompt/);
    expect(sistema).toMatch(/REFERÊNCIA DO PEDIDO: .*p2 \("2\. Pão saindo"\)/);
    // O modelo nunca vê id.
    expect(sistema).not.toContain(projeto.id as string);
  });

  it("outra tela mudou o projeto: a resposta fica na conversa com o aviso (nada some, nada quebra)", async () => {
    const projeto = projetoPronto({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", versao: 2 });
    const { db, tabelas } = bancoFalso({ video_diretor_projetos: [{ id: projeto.id, client_id: CLIENTE, versao: 5 }] });
    modelo.json = respostaDoModelo({ acao: { tipo: "gerar", planos: ["p1"], variacoes: null } });
    const r = corpoDe(await diretorConversar(baseFalsa(db), { client_id: CLIENTE, projeto, texto: "gera o p1", fase: "roteiro" }));
    expect(r.avisos[0]).toMatch(/mudado em outra tela/);
    expect(r.acao).toBeNull();
    expect(tabelas.agente_mensagens).toHaveLength(2);
  });

  it("resposta que promete gerar sem cartão diz que nada foi preparado", async () => {
    const { db } = bancoFalso();
    modelo.json = respostaDoModelo({ resposta: "Vou gerar o p1 agora." });
    const r = corpoDe(await diretorConversar(baseFalsa(db), { client_id: CLIENTE, projeto: projetoPronto(), texto: "e aí?", fase: "livre" }));
    expect(r.resposta).toMatch(/Nenhum cartão foi preparado/);
    expect(prometeSemAcao("Vou gerar os planos")).toBe(true);
    expect(prometeSemAcao("O p2 precisa do quadro inicial.")).toBe(false);
  });
});

// ------------------------------------------------------------------ diretor: gerar, refazer, editor

describe("diretor: gerar e refazer com custo confirmado; editor com Desfazer", () => {
  it("gerar vira cartão na mensagem do agente (nada gera sozinho) e o executor usa o custo DESTE plano como teto", async () => {
    const { db, tabelas } = bancoFalso();
    const b = baseFalsa(db);
    modelo.json = respostaDoModelo({ resposta: "Preparei o cartão.", acao: { tipo: "gerar", planos: ["p1", "p2"], variacoes: 2 } });
    const r = corpoDe(await diretorConversar(b, { client_id: CLIENTE, projeto: projetoPronto(), texto: "gera o p1 e o p2 com 2 variações", fase: "roteiro" }));
    expect(gerador.chamadas).toHaveLength(0);
    expect(r.acao.agente).toBe("diretor_de_video");
    expect(r.acao.executada_em).toBeFalsy();
    expect(r.acao.custo_estimado_usd).toBeGreaterThan(0);
    const custos = r.acao.contexto.custos as Record<string, number>;
    expect(Object.keys(custos)).toEqual(["p1", "p2"]);
    expect(custos.p1 + custos.p2).toBeCloseTo(r.acao.custo_estimado_usd, 4);
    // O cartão mora na mensagem gravada (Confirmar acha por ela).
    const guardada = tabelas.agente_mensagens.find((m) => m.id === r.mensagem_id)!;
    expect(guardada.anexos[0]).toEqual(expect.objectContaining({ tipo: "acao_agente", id: r.acao.id }));
    // Confirmar um item: teto = custo deste plano (antes: Number.MAX_SAFE_INTEGER).
    await executarItemDoDiretor(b, CLIENTE, r.acao.itens[0], r.acao, r.mensagem_id);
    expect(gerador.chamadas[0]).toEqual(expect.objectContaining({ confirmado: custos.p1, variacoes: 2, planoRef: "p1", uid: `${r.mensagem_id}-p1` }));
    expect(ler("supabase/functions/mesa-videos/diretor.ts")).not.toContain("MAX_SAFE_INTEGER");
  });

  it("refazer: o roteiro volta com a composição nova e o cartão diz Refazer com o custo", () => {
    const p = projetoPronto();
    const planos = p.roteiro.planos.map((x) => ({ ...x, quadro_inicial: x.quadro_inicial ? { tipo: x.quadro_inicial.tipo, ref: x.quadro_inicial.ref } : null }));
    planos[1] = { ...planos[1], prompt: "man in his 60s, grey beard, wide shot from above" };
    const r = aplicarRespostaDoDiretor({ resposta: "Refiz a composição do p2.", roteiro: { planos, notas: "" }, acao: { tipo: "refazer", planos: ["p2"], variacoes: 3 } }, p);
    expect(r.acao).toEqual({ tipo: "refazer", planos: ["p2"], variacoes: 3 });
    expect(r.projeto.roteiro.planos[1].prompt).toMatch(/wide shot/);
    const acao = acaoDeGerarPlanos(r.projeto, r.acao!.planos, { variacoes: r.acao!.variacoes, refazer: true })!;
    expect(acao.resumo).toMatch(/^Refazer 1 plano com a composição nova, 3 variações cada\. Custo estimado US\$/);
    expect((acao.contexto as { refazer?: boolean }).refazer).toBe(true);
    // "todos" vale para a lista inteira.
    expect(aplicarRespostaDoDiretor({ resposta: "", acao: { tipo: "gerar", planos: ["todos"], variacoes: null } }, p).acao).toEqual({ tipo: "gerar", planos: ["p1", "p2", "p3"] });
  });

  it("mandar ao editor: sem escolhido é recusado com o motivo; com escolhido pode ir direto (sem custo e com Desfazer)", () => {
    const sem = acaoDeMandarAoEditor(projetoPronto())!;
    expect(sem.itens).toHaveLength(0);
    expect(sem.recusados[0].motivo).toMatch(/Nenhum plano tem resultado escolhido/);
    const p = projetoPronto();
    p.roteiro.planos[0].escolhido = ARQ;
    const com = acaoDeMandarAoEditor(p)!;
    expect(com.itens.map((i) => i.operacao)).toEqual(["mandar_ao_editor"]);
    expect(com.custo_estimado_usd).toBe(0);
    expect(com.sem_desfazer).toBeFalsy();
    expect(podeExecutarDireto(com, REGRAS_DIRETAS_DO_DIRETOR, { pedidoClaro: true }).direto).toBe(true);
    // Gerar nunca vai direto (custa).
    expect(podeExecutarDireto(acaoDeGerarPlanos(p, ["p1"])!, REGRAS_DIRETAS_DO_DIRETOR, { pedidoClaro: true }).direto).toBe(false);
  });

  it("ordem clara 'manda ao editor': feito na hora, versão rascunho do diretor, prova no cartão e Desfazer deixa a versão rejeitada", async () => {
    const p = projetoPronto();
    p.roteiro.planos[0].escolhido = ARQ;
    const { db, tabelas } = bancoFalso({ video_arquivos: [{ id: ARQ, client_id: CLIENTE, nome: "p1.mp4", tipo: "gerado", estado: "ativo", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/gerados/p1.mp4`, duracao_s: 6, largura: 720, altura: 1280 }] });
    const b = baseFalsa(db);
    jev.respostas = { ordem: { noul: 0.95 }, levar: { noul: 0.1 } };
    modelo.json = respostaDoModelo({ resposta: "Mandando ao editor.", acao: { tipo: "mandar_ao_editor", planos: [], variacoes: null } });
    const r = corpoDe(await diretorConversar(b, { client_id: CLIENTE, projeto: p, texto: "manda ao editor", fase: "roteiro" }));
    expect(r.acao.executada_direto).toBe(true);
    expect(r.acao.resultados[0]).toEqual(expect.objectContaining({ ok: true, operacao: "mandar_ao_editor" }));
    expect(r.acao.caminho.destino).toMatch(/^\/mesa-edicao\?client=/);
    expect(r.resposta).toMatch(/Feito: mandei ao editor/);
    expect(tabelas.video_versoes).toEqual([expect.objectContaining({ estado: "rascunho", client_id: CLIENTE })]);
    expect(String(tabelas.video_versoes[0].nota)).toMatch(/^Montado pelo diretor; faltando: p2, p3/);
    // A mensagem guardada foi atualizada com o cartão feito (reabrir mostra "Feito" + Desfazer).
    const guardada = tabelas.agente_mensagens.find((m) => m.id === r.mensagem_id)!;
    expect(guardada.anexos[0].executada_direto).toBe(true);
    expect(guardada.conteudo).toMatch(/Feito: mandei ao editor/);
    // Desfazer: a versão fica rejeitada (nunca some).
    await desfazerItemDoDiretor(b, r.acao.resultados[0]);
    expect(tabelas.video_versoes[0].estado).toBe("rejeitada");
  });

  it("Desfazer do editor não mexe em versão que o diretor não montou", async () => {
    const { db } = bancoFalso({ video_versoes: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", client_id: CLIENTE, estado: "rascunho", nota: "Antes e depois montado na Mesa Vídeos" }] });
    await expect(desfazerItemDoDiretor(baseFalsa(db), { ref: "v1", alvo_id: "x", titulo: "x", operacao: "mandar_ao_editor", ok: true, desfazer: { versao_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } })).rejects.toThrow(/não foi montada pelo diretor/);
  });

  it("estado real sem planos e custo por variação no bloco", () => {
    expect(blocoDoEstadoReal(normalizarProjetoDoDiretor({ titulo: "x", roteiro: { planos: [] } })!)).toMatch(/ainda não tem planos/);
  });
});

// ------------------------------------------------------------------ aprendizado no diretor

describe("aprendizado: o diretor aprende, obedece e devolve", () => {
  const ensinar = (duracao: string) => ({ duracao: { choice: duracao, probabilities: { [duracao]: 0.9 } }, tipo: { choice: "evitar" } });

  it("'nunca use drone' vira regra da mesa vídeo, volta como 'Aprendi' e entra no sistema do próximo pedido; 'Segui' volta", async () => {
    const { db, tabelas } = bancoFalso();
    const b = baseFalsa(db);
    jev.respostas = ensinar("preferencia_duradoura");
    modelo.json = respostaDoModelo({ resposta: "Anotado.", regra_aprendida: "Não usar plano de drone" });
    const r1 = corpoDe(await diretorConversar(b, { client_id: CLIENTE, projeto: projetoPronto(), texto: "nunca use drone nos planos", fase: "roteiro" }));
    expect(tabelas.agente_memoria).toEqual([expect.objectContaining({ client_id: CLIENTE, texto: "Não usar plano de drone", tipo: "evitar", fonte: "mesa_videos" })]);
    expect(r1.anexos[0]).toEqual(expect.objectContaining({ tipo: "aprendizado_do_agente", texto: "Não usar plano de drone", mesa: "video" }));
    // Frente SPP (30/09): o método da casa entra junto como a linha "Método:" (o modelo falso não declara, vale o injetado).
    expect(tabelas.agente_mensagens.find((m) => m.id === r1.mensagem_id)!.anexos).toEqual([expect.objectContaining({ tipo: "aprendizado_do_agente" }), expect.objectContaining({ tipo: "metodo_usado", fonte: "injetado" })]);
    // Obedecer: o bloco das regras vai para o sistema do modelo (EVITAR com apelido g1).
    jev.respostas = {};
    modelo.json = respostaDoModelo({ resposta: "Roteiro sem drone.", regras_seguidas: ["g1", "g9"] });
    const r2 = corpoDe(await diretorConversar(b, { client_id: CLIENTE, projeto: r1.projeto, texto: "monta o roteiro", fase: "roteiro" }));
    expect(String(modelo.chamadas[1].sistema)).toMatch(/EVITAR:\n- g1: Não usar plano de drone/);
    expect(r2.anexos).toEqual([expect.objectContaining({ tipo: "regras_seguidas", regras: [expect.objectContaining({ texto: "Não usar plano de drone" })] }), expect.objectContaining({ tipo: "metodo_usado" })]);
    // O esquema pede os campos do aprendizado.
    const esquema = modelo.chamadas[1].esquemaJson.schema as { required: string[] };
    expect(esquema.required).toEqual(expect.arrayContaining(["regra_aprendida", "regras_seguidas"]));
  });

  it("pedido de uma vez só não vira regra; regra repetida é reforçada (não duplica)", async () => {
    const { db, tabelas } = bancoFalso();
    const b = baseFalsa(db);
    jev.respostas = ensinar("so_desta_vez");
    modelo.json = respostaDoModelo({ regra_aprendida: "Plano mais aberto" });
    await diretorConversar(b, { client_id: CLIENTE, projeto: projetoPronto(), texto: "não gostei do p2, deixa mais aberto só aqui", fase: "roteiro" });
    expect(tabelas.agente_memoria || []).toHaveLength(0);
    jev.respostas = ensinar("preferencia_duradoura");
    modelo.json = respostaDoModelo({ regra_aprendida: "Não usar transição de zoom" });
    const r1 = corpoDe(await diretorConversar(b, { client_id: CLIENTE, projeto: projetoPronto(), texto: "nunca use transição de zoom", fase: "roteiro" }));
    const r2 = corpoDe(await diretorConversar(b, { client_id: CLIENTE, projeto: r1.projeto, texto: "de novo: nunca use transição de zoom", fase: "roteiro" }));
    expect(tabelas.agente_memoria).toHaveLength(1);
    expect(r2.anexos[0]).toEqual(expect.objectContaining({ situacao: "reforcado", reforcos: 2 }));
  });

  it("Esquecer tira a regra (ativa=false) e marca a mensagem; as rotas estão na função", async () => {
    const regra = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const msg = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const { db, tabelas } = bancoFalso({
      agente_memoria: [{ id: regra, client_id: CLIENTE, ativa: true, texto: "Não usar drone" }],
      agente_mensagens: [{ id: msg, client_id: CLIENTE, anexos: [{ tipo: "aprendizado_do_agente", id: regra, texto: "Não usar drone" }] }],
    });
    const rotas = rotasDoAprendizado({ mesa: "video", servico: () => db as any, garantirAcesso: async () => {}, json: (c: unknown) => ({ corpo: c }) as unknown as Response });
    const r = corpoDe(await rotas.aprendizado_esquecer({ userId: "u-1" }, { client_id: CLIENTE, id: regra, mensagem_id: msg }));
    expect(r.ok).toBe(true);
    expect(tabelas.agente_memoria[0].ativa).toBe(false);
    expect(tabelas.agente_mensagens[0].anexos[0].esquecido_em).toBeTruthy();
    const indice = ler("supabase/functions/mesa-videos/index.ts");
    expect(indice).toMatch(/aprendizado_esquecer: \(ch, corpo\) => aprendizadoDaMesa\(corpo\)\.aprendizado_esquecer\(ch, corpo\)/);
    expect(indice).toMatch(/aprendizado_guardar: \(ch, corpo\) => aprendizadoDaMesa\(corpo\)\.aprendizado_guardar\(ch, corpo\)/);
    // Reprovar versão com motivo ensina a mesa (sem bloquear a decisão).
    expect(indice).toMatch(/aprenderDoPedido\(servico\(\), \{ clientId: v\.client_id, mesa: "edicao", pedido: motivo, motivo, userId: ch\.userId, forcar: true \}\)/);
  });
});

// ------------------------------------------------------------------ agente da mesa: arquivar, ligar à cena, referência

describe("agente da Mesa Vídeos: age nos resultados pelo contrato comum", () => {
  const r = (id: string, extra: Partial<ResultadoGerado> = {}): ResultadoGerado => ({ id, nome: `${id}.mp4`, tipo: "gerado", estado: "ativo", edicao_desde: null, grupo: null, ...extra });

  it("itens na ordem da tela viram r1..rN sem id; arquivar tem travas e vai direto quando é ordem clara", () => {
    const lista = [r("a"), r("b", { melhor: true }), r("c", { em_versao_aprovada: true })];
    expect(itensReferiveis(lista)).toEqual([
      { ref: "r1", titulo: "a.mp4", detalhe: null },
      { ref: "r2", titulo: "b.mp4", detalhe: "melhor take" },
      { ref: "r3", titulo: "c.mp4", detalhe: null },
    ]);
    const acao = acaoDeArquivarResultados(lista)!;
    expect(acao.agente).toBe(AGENTE_DOS_RESULTADOS);
    expect(AGENTES_DA_MESA_DE_VIDEO).toContain(AGENTE_DOS_RESULTADOS);
    expect(acao.itens.map((i) => i.alvo_id)).toEqual(["a"]);
    expect(acao.recusados.map((x) => x.motivo)).toEqual(["Marcado como melhor take: desmarque antes de arquivar.", "Está numa versão aprovada: fica no acervo."]);
    const so = acaoDeArquivarResultados([r("a")])!;
    expect(podeExecutarDireto(so, REGRAS_DOS_RESULTADOS, { pedidoClaro: true }).direto).toBe(true);
    expect(tituloDoCartaoDaMesa(so)).toBe("Arquivar vídeos");
  });

  it("ligar à cena: o valor leva o roteiro e a cena, o cartão mostra o rótulo (nunca o id)", () => {
    const cena = { roteiro_id: ROTEIRO, roteiro: "Padaria", cena_ref: "c2", ordem: 2, titulo: "Forno" };
    const acao = acaoDeLigarACena([r("a"), r("b", { roteiro_id: ROTEIRO, cena_ref: "c2" })], cena)!;
    expect(acao.itens).toHaveLength(1);
    expect(acao.itens[0].para_rotulo).toBe("Padaria, cena 2 (Forno)");
    expect(lerParaDaCena(acao.itens[0].para)).toEqual({ roteiro_id: ROTEIRO, cena_ref: "c2" });
    expect(acao.recusados[0].motivo).toBe("Já está ligado a esta cena.");
    expect(tituloDoCartaoDaMesa(acao)).toBe("Ligar à cena");
    expect(lerParaDaCena("x|c2")).toBeNull();
  });

  it("mandar para a Edição pode ir direto; o caminho dos resultados e do editor", () => {
    expect(REGRAS_DO_ENVIO.enviar_para_edicao.direta).toBe(true);
    expect(caminhoDaMesaDeVideo(CLIENTE, { agente: AGENTE_DOS_RESULTADOS })!.destino).toBe(`/mesa-videos?client=${CLIENTE}&etapa=resultados`);
    expect(caminhoDaMesaDeVideo(CLIENTE, { agente: "diretor_de_video", resultados: [{ ref: "v1", alvo_id: "x", titulo: "x", operacao: "mandar_ao_editor", ok: true }] })!.destino).toMatch(/^\/mesa-edicao\?client=.*etapa=editar/);
  });

  it("as palavras reconhecem arquivar, ligar à cena e organizar sem tirar o que já existia", () => {
    expect(intencaoPorPalavras("videos", "arquiva o segundo resultado")).toBe("arquivar");
    expect(intencaoPorPalavras("videos", "vincula esse vídeo à cena 2")).toBe("vincular");
    expect(intencaoPorPalavras("videos", "organiza os takes por cena")).toBe("organizar");
    expect(intencaoPorPalavras("videos", "gera a próxima cena")).toBe("gerar");
    expect(intencaoPorPalavras("videos", "manda os aprovados para a edição")).toBe("enviar_para_edicao");
  });

  it("a função: agente_agir existe, a proposta é gravada ANTES de executar e arquivar nunca pega 'todos' sem a pessoa dizer", () => {
    const f = ler("supabase/functions/mesa-videos/index.ts");
    expect(f).toContain("agente_agir: agenteAgir,");
    const corpo = f.slice(f.indexOf("async function agenteAgir"));
    expect(corpo.indexOf("from(TABELA_DAS_ACOES).insert")).toBeLessThan(corpo.indexOf("executarDireto("));
    expect(corpo).toContain("Arquivar e ligar nunca pegam a lista inteira sem a pessoa dizer");
    expect(corpo).toContain("referenciaDoPedido(texto, itens");
    // O cartão do diretor também é achado na conversa (agente_mensagens).
    expect(f).toMatch(/acaoGuardadaNaMensagem\(servico\(\), corpo\.mensagem_id, exigir, \{ acaoId: corpo\.acao_id \}\)/);
  });
});

// ------------------------------------------------------------------ tela

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Padaria",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-videos?client=${CLIENTE}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valorDaMesa(), children: filho })))));
}

const chamadas = (acao: string) => tela.invoke.mock.calls.filter((c: any[]) => c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

describe("tela: a mensagem nunca some e o estado volta do banco", () => {
  it("diretor: envio que falha tira a bolha, devolve o texto ao campo e mostra o erro", async () => {
    tela.invoke.mockResolvedValue({ data: { error: "saldo_insuficiente", mensagem: "Sem saldo na carteira." }, error: null });
    montar(h(DiretorDoVideo, { irPara: vi.fn(), topo: null }));
    const campo = (await screen.findByRole("textbox", { name: "Pedido para o diretor" })) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: "quero um filme da padaria" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Sem saldo/);
    expect(campo.value).toBe("quero um filme da padaria");
    expect(screen.queryByText("quero um filme da padaria", { selector: "p" })).toBeNull();
  });

  it("diretor: resposta com aviso_registro mostra o aviso; a versão nova do banco vai para o projeto", async () => {
    const p = projetoPronto({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", versao: 1 });
    gravarProjetoDoDiretor(CLIENTE, p, false);
    tela.invoke.mockResolvedValue({ data: { projeto: { ...p, versao: 2 }, resposta: "Qual bairro?", perguntas: [], avisos: [], custo_usd: 0.02, mensagem_id: null, acao: null, anexos: [], aviso_registro: "A resposta chegou, mas não ficou guardada na conversa." }, error: null });
    montar(h(DiretorDoVideo, { irPara: vi.fn(), topo: null }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Pedido para o diretor" }), { target: { value: "oi" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("A resposta chegou, mas não ficou guardada na conversa.")).toBeTruthy();
    expect(projetoAtualDoDiretor(CLIENTE).versao).toBe(2);
  });

  it("Desfazer do diretor volta o conteúdo mas mantém o id e a versão do banco", () => {
    const p1 = projetoPronto({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", versao: 4 });
    gravarProjetoDoDiretor(CLIENTE, p1, false);
    gravarProjetoDoDiretor(CLIENTE, { ...p1, titulo: "Outro", versao: 5 }, true);
    expect(desfazerProjetoDoDiretor(CLIENTE)).toBe(true);
    const atual = projetoAtualDoDiretor(CLIENTE);
    expect(atual.titulo).toBe("Padaria");
    expect(atual.versao).toBe(5);
    expect(atual.id).toBe(p1.id);
  });

  it("agente da mesa: texto vai para agente_agir com a ordem da tela; o cartão feito chega com o título certo", async () => {
    tela.tabelas = {
      video_arquivos: [
      // Como o banco devolve (mais novo primeiro), e um bruto que não entra na lista dos Resultados.
        { id: "a2222222-2222-4222-8222-222222222222", client_id: CLIENTE, nome: "novo.mp4", nome_original: "novo.mp4", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/gerados/n.mp4`, tipo: "gerado", estado: "ativo", melhor: false, criado_em: "2026-09-29T10:00:00Z" },
        { id: "a1111111-1111-4111-8111-111111111111", client_id: CLIENTE, nome: "velho.mp4", nome_original: "velho.mp4", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/gerados/v.mp4`, tipo: "gerado", estado: "ativo", melhor: false, criado_em: "2026-09-28T10:00:00Z" },
        { id: "a3333333-3333-4333-8333-333333333333", client_id: CLIENTE, nome: "bruto.mov", nome_original: "bruto.mov", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/b.mov`, tipo: "bruto", estado: "ativo", melhor: false, criado_em: "2026-09-27T10:00:00Z" },
      ],
    };
    const feita = { tipo: "acao_agente", agente: AGENTE_DOS_RESULTADOS, id: "ag-1", resumo: "Arquivar 1 vídeo (sai da lista, não apaga). Dá para desfazer.", itens: [{ ref: "r1", alvo_id: "a2222222-2222-4222-8222-222222222222", titulo: "novo.mp4", detalhe: null, operacao: "arquivar", rotulo: "Arquivar", para: null }], ignorados: [], recusados: [], custo_estimado_usd: 0, executada_em: "agora", executada_direto: true, resultados: [{ ref: "r1", alvo_id: "a2222222-2222-4222-8222-222222222222", titulo: "novo.mp4", operacao: "arquivar", ok: true, desfazer: { campos: { estado: "ativo" } } }] };
    tela.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "agente_agir" ? { intencao: "arquivar", resposta: "Feito: 1 feito. Arquivar 1 vídeo.", mensagem_id: "99999999-9999-4999-8999-999999999999", acao: feita, anexos: [] } : {}, error: null }));
    montar(h(AgenteDaMesaDeVideo, { mesa: "videos", etapa: "resultados", irPara: vi.fn() } as any));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Pedido para o agente" })).toBeTruthy());
    // Espera a lista chegar antes de pedir (a ordem vai junto).
    await new Promise((ok) => setTimeout(ok, 30));
    fireEvent.change(screen.getByRole("textbox", { name: "Pedido para o agente" }), { target: { value: "arquiva o primeiro" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(chamadas("agente_agir")).toHaveLength(1));
    expect(chamadas("agente_agir")[0]).toEqual(expect.objectContaining({ mesa: "videos", texto: "arquiva o primeiro", ordem: ["a2222222-2222-4222-8222-222222222222", "a1111111-1111-4111-8111-111111111111"] }));
    expect(await screen.findByText("Feito: 1 feito. Arquivar 1 vídeo.")).toBeTruthy();
    expect(screen.getAllByText(/Arquivar vídeos/).length).toBeGreaterThan(0);
  });

  it("agente da mesa: falha do servidor na ação tira a bolha e devolve o texto", async () => {
    tela.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "resultados_para_edicao_propor" ? { error: "banco_indisponivel", mensagem: "Banco fora do ar." } : {}, error: null }));
    montar(h(AgenteDaMesaDeVideo, { mesa: "videos", etapa: "resultados", irPara: vi.fn() } as any));
    fireEvent.click(await screen.findByRole("button", { name: "Mandar para a Edição" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Banco fora do ar/);
    expect(screen.queryByText("Mandar para a Edição", { selector: "p" })).toBeNull();
  });
});
