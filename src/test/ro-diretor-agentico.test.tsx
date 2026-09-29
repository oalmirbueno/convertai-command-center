import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente RO, fase 2 (29/09). Pedidos do dono:
 * - "o agente diretor do Estúdio tem que ser agêntico e completo com base no
 *   que converso com ele, e o de ajuste mais inteligente. Eu converso, ele
 *   entende, mas não está fazendo";
 * - "o agente do ajustar lâmina poderia receber imagens e evoluir ainda mais";
 * - "tem que aprender com cada ajuste... tem coisas que ele não pode mais
 *   fazer quando eu peço e não gostei... cada ação tem que devolver".
 * 1. Pedido de texto claro: feito direto, com Desfazer.
 * 2. Pedido com custo: confirmação com o custo antes.
 * 3. Vários passos: andamento, Parar, prova no fim e Desfazer da versão.
 * 4. "Todas as lâminas".
 * 5. Pergunta quando está ambíguo.
 * 6. Ajuste vago vira proposta.
 * 7. Imagens no Ajustar e na conversa (papéis, arquivo quebrado).
 * 8. Aprender: evitar, uma vez só, Esquecer, reforço; obedecer e devolver.
 * 9. Tela: os cartões na conversa.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown[]> }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const q: any = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit", "range", "neq", "not", "contains", "overlaps"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: (mock.tabelas[tabela] || [])[0] || null, error: null });
    q.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: mock.tabelas[tabela] || [], error: null }).then(ok, erro);
    return q;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      from: (t: string) => consulta(t),
      rpc: vi.fn(async () => ({ data: null, error: null })),
      storage: { from: () => ({ createSignedUrl: (p: string) => Promise.resolve({ data: { signedUrl: `https://assinada/${p}` }, error: null }), createSignedUrls: () => Promise.resolve({ data: [], error: null }), upload: () => Promise.resolve({ error: null }) }) },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import {
  alvoPelaRegra,
  expandirParaTodas,
  lerEntendimento,
  montarPlano,
  pareceOrdemDoEstudio,
  perguntaDeEsclarecimento,
  perguntaSobreImagens,
  perguntasDoEntendimento,
  planoComPasso,
  planoDoAnexo,
  precisaPerguntar,
  resumoDoPlano,
  type LaminaParaEntender,
  type MudancaProposta,
} from "../../supabase/functions/estudio-arte/diretor-agentico";
import {
  devolverLaminaAoTrabalho,
  duplicarLaminaDoTrabalho,
  normalizarAcoesDoDiretor,
  OPERACOES_COM_CUSTO,
  regrasDoDiretor,
  separarDoPlano,
  tirarCopiaDoTrabalho,
  tirarLaminaDoTrabalho,
  type TrabalhoParaAcoes,
} from "../../supabase/functions/estudio-arte/acoes-do-diretor";
import { executarDireto, podeExecutarDireto, TIPO_DA_ACAO, type AcaoDoAgente } from "../../supabase/functions/_shared/acoes-do-agente";
import {
  decidirPapeis,
  legendaParaOGerador,
  legendaParaOLeitor,
  motivoDoDefeito,
  normalizarAnexos,
  papelPelaRegra,
  perguntaDoPapelDoAnexo,
} from "../../supabase/functions/estudio-arte/anexos-do-ajuste";
import { FRASE_DA_IDENTIDADE } from "../../supabase/functions/_shared/uso-da-foto";
import { aprenderDoPedido, blocoDasRegras, esquecerRegra, regrasDaMesa, type JulgamentoDoEnsino } from "../../supabase/functions/_shared/aprendizado-das-mesas";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import PlanoDoDiretor from "@/components/mesa/PlanoDoDiretor";
import DiretorDoEstudio from "@/components/mesa/DiretorDoEstudio";
import CardDoEstudio from "@/components/mesa/CardDoEstudio";
import AnexosComPapel, { anexosComPapel, corpoDosAnexos, usePapeisDosAnexos } from "@/components/mesa/AnexosComPapel";
import { extrasDaMensagem } from "@/components/mesa/diretorDoEstudioApi";
import { ErroDaMesa } from "@/lib/mesa/api";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const servidor = ler("supabase/functions/estudio-arte/index.ts");
const trecho = (de: string, ate: string) => servidor.slice(servidor.indexOf(de), servidor.indexOf(ate, servidor.indexOf(de)));

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const TRABALHO = "55555555-5555-4555-8555-555555555555";
const MENSAGEM = "66666666-6666-4666-8666-666666666666";

const laminas: LaminaParaEntender[] = [
  { ordem: 1, funcao: "capa", texto: "Promoção de Setembro", cena: "xícara de café na mesa de madeira" },
  { ordem: 2, funcao: "conteudo", texto: "Frete grátis em Curitiba", cena: "caminhão de entrega" },
  { ordem: 3, funcao: "cta", texto: "Peça já pelo site", cena: "celular com o site" },
];

const trabalhoParaAcoes = (extra: Partial<TrabalhoParaAcoes> = {}): TrabalhoParaAcoes => ({
  id: TRABALHO,
  status: "pronto",
  qualidade: "media",
  direcao: { cards: laminas.map((l) => ({ ordem: l.ordem, funcao: l.funcao || "conteudo", texto_exato: l.texto || "" })) },
  cards: [{ ordem: 1, versao: 1 }, { ordem: 2, versao: 1 }, { ordem: 3, versao: 1 }],
  ...extra,
});

const mudanca = (m: Partial<MudancaProposta> & { id: string }): MudancaProposta => ({ alvo: "lamina", ordem: 1, titulo: "t", motivo: "m", campos: {}, regerar: [], ...m });

// ------------------------------------------------------------------ 1

describe("1. Ordem clara de texto: feita direto, com Desfazer", () => {
  it("o Jev diz ordem clara (confiança mínima); sem o Jev, verbo de ordem no começo", () => {
    const e = { mensagem: "muda o título da capa para Promoção de Outubro", laminas, emFoco: null };
    expect(lerEntendimento({ pedido: { choice: "executar", confidence: 0.93 }, lamina: { choice: "l1", confidence: 0.9 } }, e)).toMatchObject({ tipo: "executar", claro: true, alvo: 1, por: "jev" });
    expect(lerEntendimento({ pedido: { choice: "executar", confidence: 0.5 } }, e).claro).toBe(false);
    expect(lerEntendimento(null, e)).toMatchObject({ claro: true, alvo: 1, por: "regra" });
    expect(pareceOrdemDoEstudio("tira o preço da segunda")).toBe(true);
    expect(pareceOrdemDoEstudio("o que você mudaria?")).toBe(false);
    const q = perguntasDoEntendimento(e);
    expect(Object.keys(q.questions)).toEqual(["pedido", "lamina"]);
    expect(Object.keys(q.questions.pedido.criteria)).toEqual(["executar", "opiniao", "ambiguo"]);
    expect(Object.keys(q.questions.lamina.criteria)).toEqual(["l1", "l2", "l3", "todas", "trabalho", "nao_diz"]);
  });

  it("mudança de texto como item 'aplicar' (direta): pode ir direto e volta com o Desfazer do executor", async () => {
    const t = trabalhoParaAcoes();
    const acao: AcaoDoAgente = {
      tipo: TIPO_DA_ACAO, agente: "estudio", id: "a1", resumo: "", ignorados: [], recusados: [],
      itens: [{ ref: "l1", alvo_id: "1", titulo: "Título novo", detalhe: null, operacao: "aplicar_mudanca", rotulo: "aplicar", para: "m1" }],
      contexto: { mudancas: [mudanca({ id: "m1", campos: { texto_exato: "Promoção de Outubro" } })] },
    };
    expect(podeExecutarDireto(acao, regrasDoDiretor(t), { pedidoClaro: true, maxItens: 12 })).toEqual({ direto: true, motivo: "pedido claro, sem custo e com Desfazer" });
    expect(podeExecutarDireto(acao, regrasDoDiretor(t), { pedidoClaro: false }).direto).toBe(false);
    const feita = await executarDireto(acao, async () => ({ desfazer: { alvo: "lamina", ordem: 1, card_antes: { ordem: 1, texto_exato: "Promoção de Setembro" } } }), { userId: "u1" });
    expect(feita).toMatchObject({ executada_direto: true, resultados: [{ ref: "l1", ok: true, desfazer: { card_antes: { texto_exato: "Promoção de Setembro" } } }] });
  });

  it("servidor: conversar faz o que não custa pelo contrato (executarDireto) e o Desfazer volta a lâmina de antes", () => {
    const c = trecho("async function conversar(", "/** Frente RO, fase 2: o esquema da conversa");
    expect(c).toContain("const execucao = await executarOQueNaoCusta(ch, t, { mudancas, acaoProposta, entendimento, perguntar: !!pergunta });");
    const e = trecho("async function executarOQueNaoCusta(", "/** Linha curta com as mudanças propostas");
    expect(e).toContain("const direto = e.entendimento.claro && !estaEntregue(t);");
    expect(e).toContain("podeExecutarDireto(junta, regrasDoDiretor(t as unknown as TrabalhoParaAcoes), { pedidoClaro: true, maxItens: 12 })");
    expect(e).toContain("await executarDireto(junta, (item, acao) => executarItemDoDiretor(t.id, item, acao), { userId: ch.userId, lote: 1 })");
    const x = trecho("async function executarItemDoDiretor(", "/** Desfaz uma operação do diretor");
    expect(x).toContain('desfazer = { alvo: "lamina", ordem: m.ordem, card_antes: card };');
    expect(x).toContain("return { direcao: aplicarNaDirecao<Direcao>(x.direcao, [m]).direcao };");
    const d = trecho("async function desfazerItemDoDiretor(", "/** Frente RO, fase 2: tira os ids desfeitos");
    expect(d).toContain("x.direcao.cards.map((c) => (c.ordem === antes.ordem ? antes : c))");
    expect(servidor).toContain("await tirarDasAplicadas(guardada.mensagem.id, t.client_id, desfeitas)");
  });
});

// ------------------------------------------------------------------ 2

describe("2. Com custo ou para fora: confirmação com o custo antes", () => {
  it("refazer, variações, ajustar o texto, entregar e agendar saem da lista sem custo e viram passos do plano", () => {
    const t = trabalhoParaAcoes();
    const acao = normalizarAcoesDoDiretor({ resumo: "r", itens: [
      { operacao: "trocar_texto", ref: "l2", para: "Frete grátis => Frete grátis hoje" },
      { operacao: "refazer", ref: "l1", para: "" },
      { operacao: "variacoes", ref: "l3", para: "2" },
    ] }, t)!;
    const { livre, comCusto } = separarDoPlano(acao);
    expect(livre!.itens.map((i) => i.operacao)).toEqual(["trocar_texto"]);
    expect(comCusto.map((i) => i.operacao)).toEqual(["refazer", "variacoes"]);
    expect(OPERACOES_COM_CUSTO).toEqual(["ajustar_texto", "refazer", "variacoes", "entregar", "agendar"]);
    const plano = montarPlano({ id: "p", itens: comCusto, mudancasFeitas: [], comArte: [1, 2, 3], claro: true })!;
    expect(plano.passos.map((p) => [p.operacao, p.ordem, p.n || null])).toEqual([["refazer", 1, null], ["variacoes", 3, 2]]);
    // Refazer nunca roda sozinho, mesmo numa ordem clara.
    expect(plano.automatico).toBe(false);
    const soRefazer: AcaoDoAgente = { ...acao, itens: acao.itens.filter((i) => i.operacao === "refazer") };
    expect(podeExecutarDireto(soRefazer, regrasDoDiretor(t), { pedidoClaro: true }).direto).toBe(false);
  });

  it("entregar e agendar têm travas (agendar só entregue); o ajuste de texto de custo pequeno numa ordem clara roda sozinho", () => {
    const t = trabalhoParaAcoes();
    const a = normalizarAcoesDoDiretor({ resumo: "r", itens: [{ operacao: "entregar", ref: "t1", para: "" }, { operacao: "agendar", ref: "t1", para: "" }] }, t)!;
    expect(a.itens.map((i) => i.operacao)).toEqual(["entregar"]);
    expect(a.recusados[0].motivo).toMatch(/Entregue o trabalho antes de agendar/);
    const soTexto = montarPlano({ id: "p", itens: [], mudancasFeitas: [mudanca({ id: "m1", campos: { texto_exato: "Novo" } })], comArte: [1], claro: true })!;
    expect(soTexto.passos.map((p) => p.operacao)).toEqual(["ajustar_texto"]);
    expect(soTexto.automatico).toBe(true);
    // Mudança de cena pede refazer (com clique); o refazer da lâmina vale sobre o ajuste de texto dela.
    const cena = montarPlano({ id: "p", itens: [], mudancasFeitas: [mudanca({ id: "m1", campos: { texto_exato: "Novo" } }), mudanca({ id: "m2", campos: { imagem: "praia" }, regerar: [1] })], comArte: [1], claro: true })!;
    expect(cena.passos.map((p) => p.operacao)).toEqual(["refazer"]);
    expect(cena.automatico).toBe(false);
    // Lâmina sem arte: nada a refazer ainda.
    expect(montarPlano({ id: "p", itens: [], mudancasFeitas: [mudanca({ id: "m1", campos: { texto_exato: "x" } })], comArte: [], claro: true })).toBeNull();
  });
});

// ------------------------------------------------------------------ 3

describe("3. Vários passos: andamento, Parar e a prova no fim", () => {
  it("o andamento de cada passo é gravado; parar vale para o que não começou; terminado resume", () => {
    let p = montarPlano({ id: "p1", itens: [], mudancasFeitas: [mudanca({ id: "m1", ordem: 1, campos: { texto_exato: "x" } }), mudanca({ id: "m2", ordem: 2, campos: { imagem: "y" }, regerar: [2] })], comArte: [1, 2], claro: false, agora: "t0" })!;
    expect(p.passos.map((x) => x.id)).toEqual(["p1", "p2"]);
    p = planoComPasso(p, { plano: "confirmar" }, "t1");
    p = planoComPasso(p, { passo_id: "p1", estado: "executando", versao_antes: 3 }, "t2");
    p = planoComPasso(p, { passo_id: "p1", estado: "feito", custo_usd: 0.031 }, "t3");
    expect(p.passos[0]).toMatchObject({ estado: "feito", versao_antes: 3, custo_usd: 0.031 });
    // Feito não volta atrás.
    p = planoComPasso(p, { passo_id: "p1", estado: "pendente" }, "t4");
    expect(p.passos[0].estado).toBe("feito");
    p = planoComPasso(p, { plano: "parar" }, "t5");
    expect(p.passos[1].estado).toBe("parado");
    expect(p.terminado_em).toBe("t5");
    expect(resumoDoPlano(p)).toBe("1 feito, 1 parado");
    expect(() => planoComPasso(p, { passo_id: "p2", estado: "executando" })).toThrow(/parado/);
    const relido = planoDoAnexo(JSON.parse(JSON.stringify(p)))!;
    expect(relido.passos.map((x) => [x.id, x.estado, x.versao_antes ?? null])).toEqual([["p1", "feito", 3], ["p2", "parado", null]]);
    expect([relido.confirmado_em, relido.parado_em, relido.terminado_em, relido.custo_usd]).toEqual(["t1", "t5", "t5", 0.031]);
  });

  it("servidor: plano_passo grava na mensagem e desfazer_versao guarda a versão (nada é apagado)", () => {
    expect(servidor).toContain("plano_passo: planoPasso,");
    expect(servidor).toContain("desfazer_versao: desfazerVersao,");
    const d = trecho("async function desfazerVersao(", "/** A proposta guardada na mensagem do diretor");
    expect(d).toContain("versoes_arquivadas: guardadas.concat([{ ...atual, desfeita_em: new Date().toISOString(), desfeita_por: ch.userId }])");
    expect(d).toContain('"sem_versao_anterior"');
  });

  it("tirar e duplicar lâmina (sem custo, com Desfazer)", () => {
    const t = trabalhoParaAcoes();
    const tirada = tirarLaminaDoTrabalho(t, 2, "agora");
    expect(tirada.patch.direcao.cards.map((c) => [c.ordem, c.funcao, c.texto_exato])).toEqual([[1, "capa", "Promoção de Setembro"], [2, "cta", "Peça já pelo site"]]);
    const depois = { ...t, direcao: tirada.patch.direcao, cards: tirada.patch.cards } as TrabalhoParaAcoes;
    const volta = devolverLaminaAoTrabalho(depois, tirada.desfazer.chave, tirada.desfazer.total_depois);
    expect(volta.direcao.cards.map((c) => [c.ordem, c.texto_exato])).toEqual([[1, "Promoção de Setembro"], [2, "Frete grátis em Curitiba"], [3, "Peça já pelo site"]]);
    const dup = duplicarLaminaDoTrabalho(t, 1);
    expect(dup.patch.direcao.cards.map((c) => [c.ordem, c.texto_exato])).toEqual([[1, "Promoção de Setembro"], [2, "Promoção de Setembro"], [3, "Frete grátis em Curitiba"], [4, "Peça já pelo site"]]);
    const sem = tirarCopiaDoTrabalho({ ...t, direcao: dup.patch.direcao, cards: dup.patch.cards } as TrabalhoParaAcoes, 2, 4);
    expect(sem.direcao.cards.length).toBe(3);
  });
});

// ------------------------------------------------------------------ 4

describe("4. \"Todas as lâminas\"", () => {
  it("as palavras e o Jev dizem todas; a mudança de uma lâmina vira a mesma em cada uma", () => {
    expect(alvoPelaRegra("troca a cor do título em todas", laminas, null)).toBe("todas");
    expect(alvoPelaRegra("tira o preço da segunda", laminas, null)).toBe(2);
    expect(alvoPelaRegra("muda a capa", laminas, null)).toBe(1);
    expect(alvoPelaRegra("sobe o texto da última", laminas, null)).toBe(3);
    expect(alvoPelaRegra("deixa essa aqui mais clara", laminas, 2)).toBe(2);
    expect(lerEntendimento({ pedido: { choice: "executar", confidence: 0.9 }, lamina: { choice: "l1", confidence: 0.85 } }, { mensagem: "a do café mais escura", laminas, emFoco: null }).alvo).toBe(1);
    const e = lerEntendimento({ pedido: { choice: "executar", confidence: 0.9 }, lamina: { choice: "todas", confidence: 0.9 } }, { mensagem: "troca a cor do título", laminas, emFoco: null });
    expect(e.alvo).toBe("todas");
    const todas = expandirParaTodas([mudanca({ id: "m1", ordem: 1, campos: { cor_texto: "#0A7F3F" } })], [1, 2, 3]);
    expect(todas.map((m) => [m.id, m.ordem, m.campos.cor_texto])).toEqual([["m1", 1, "#0A7F3F"], ["m2", 2, "#0A7F3F"], ["m3", 3, "#0A7F3F"]]);
    // Texto, foto e rosto são de uma lâmina só: não repetem.
    expect(expandirParaTodas([mudanca({ id: "m1", campos: { texto_exato: "x" } })], [1, 2, 3]).length).toBe(1);
    expect(servidor).toContain('const comTodas = entendimento.alvo === "todas" ? expandirParaTodas(normalizadas.mudancas, t.direcao.cards.map((c) => c.ordem)) : normalizadas.mudancas;');
  });
});

// ------------------------------------------------------------------ 5

describe("5. Pergunta quando está ambíguo", () => {
  it("ambíguo, lâmina que o pedido não diz e discordância perguntam; opinião nunca", () => {
    const amb = lerEntendimento({ pedido: { choice: "ambiguo", confidence: 0.8 } }, { mensagem: "arruma aquilo", laminas, emFoco: null });
    expect(precisaPerguntar(amb, { total: 3, emFoco: null, ordensDasMudancas: [] })).toEqual({ perguntar: true, motivo: "ambiguo" });
    const qual = lerEntendimento({ pedido: { choice: "executar", confidence: 0.9 }, lamina: { choice: "nao_diz", confidence: 0.8 } }, { mensagem: "muda o título", laminas, emFoco: null });
    expect(precisaPerguntar(qual, { total: 3, emFoco: null, ordensDasMudancas: [1] })).toEqual({ perguntar: true, motivo: "qual_lamina" });
    expect(precisaPerguntar(qual, { total: 3, emFoco: 2, ordensDasMudancas: [1] }).perguntar).toBe(false);
    const disc = lerEntendimento({ pedido: { choice: "executar", confidence: 0.9 }, lamina: { choice: "l2", confidence: 0.9 } }, { mensagem: "tira o frete", laminas, emFoco: null });
    expect(precisaPerguntar(disc, { total: 3, emFoco: null, ordensDasMudancas: [3] })).toEqual({ perguntar: true, motivo: "discordancia" });
    const op = lerEntendimento({ pedido: { choice: "opiniao", confidence: 0.9 } }, { mensagem: "o que acha?", laminas, emFoco: null });
    expect(precisaPerguntar(op, { total: 3, emFoco: null, ordensDasMudancas: [] }).perguntar).toBe(false);
    const p = perguntaDeEsclarecimento({ mensagem: "muda o título.", laminas, motivo: "qual_lamina" });
    expect(p.opcoes.map((o) => o.rotulo)).toEqual(["Lâmina 1 (capa)", "Lâmina 2 (conteúdo)", "Lâmina 3 (fechamento)", "Todas"]);
    expect(p.opcoes[1].mensagem).toBe("Na lâmina 2: muda o título");
    // Na dúvida, o servidor não executa nada.
    expect(trecho("async function executarOQueNaoCusta(", "/** Linha curta com as mudanças propostas")).toContain("if (e.perguntar) return { livre: doModelo, plano: null, aplicadas: [], feitoAgora: false };");
  });

  it("imagem sem texto: pergunta curta sobre o que fazer com ela (sem custo, sem o diretor)", () => {
    const p = perguntaSobreImagens({ quantas: 1, emFoco: 2 });
    expect(p.pergunta).toBe("O que faço com esta imagem?");
    expect(p.opcoes.map((o) => o.rotulo)).toEqual(["Referência de estilo", "Usar a foto exata", "Usar o rosto", "Inserir como elemento", "É um print do erro"]);
    const c = trecho("async function conversar(", "/** Frente RO, fase 2: o esquema da conversa");
    expect(c.indexOf("const pergunta = perguntaSobreImagens(")).toBeLessThan(c.indexOf("const r = await chamarTexto({"));
    expect(c).toContain("custo_usd: 0 });");
  });
});

// ------------------------------------------------------------------ 6

describe("6. Ajuste vago vira proposta, antes de gastar", () => {
  it("servidor: o leitor escreve a proposta; vago com proposta responde 409 ajuste_proposta, sem gerar", () => {
    expect(servidor).toContain('required: ["instrucao_edicao", "texto_exato", "memoria", "entendi", "pergunta", "proposta"]');
    const a = trecho("async function ajustarCard(", "async function recorteDasAreas(");
    expect(a).toContain('comProposta ? "ajuste_proposta" : "ajuste_com_duvida"');
    expect(a.indexOf('"ajuste_proposta"')).toBeLessThan(a.indexOf("chamarImagem("));
    expect(a).toContain("const guardada: DuvidaGuardada = { ordem, pedido: comProposta ? proposta : pedido, pergunta, em: new Date().toISOString() };");
  });
});

// ------------------------------------------------------------------ 7

describe("7. Imagens no Ajustar e na conversa", () => {
  it("papéis: a equipe, o Jev com confiança, a regra do pedido; legendas certas para o leitor e o gerador", () => {
    const anexos = normalizarAnexos([
      { caminho: `${CLIENTE}/pedidos/estilo.png`, nome: "estilo.png", papel: "auto" },
      { caminho: `outro/pedidos/x.png`, nome: "fora.png", papel: "auto" },
      { imagem_id: "77777777-7777-4777-8777-777777777777", nome: "rosto.jpg", papel: "rosto" },
    ], CLIENTE);
    expect(anexos.map((a) => a.nome)).toEqual(["estilo.png", "rosto.jpg"]);
    const d = decidirPapeis(anexos, { papel_1: { choice: "estilo", confidence: 0.9 } }, "deixa com essa cara");
    expect(d.map((a) => [a.papel, a.papel_por])).toEqual([["estilo", "jev"], ["rosto", "equipe"]]);
    expect(decidirPapeis(anexos.slice(0, 1), null, "olha o erro nesse print")[0]).toMatchObject({ papel: "erro", papel_por: "regra" });
    expect(papelPelaRegra("põe esse produto aqui")).toBe("elemento");
    expect(papelPelaRegra("usa esta foto igual")).toBe("exata");
    expect(Object.keys(perguntaDoPapelDoAnexo(0, "x").criteria)).toEqual(["estilo", "elemento", "exata", "rosto", "logo", "erro"]);
    expect(legendaParaOGerador({ papel: "erro", nome: "p" })).toBeNull();
    expect(legendaParaOGerador({ papel: "estilo", nome: "p" })).toMatch(/ESTILO/);
    expect(legendaParaOGerador({ papel: "rosto", nome: "p" })).toMatch(/IDENTIDADE/);
    expect(legendaParaOLeitor({ papel: "rosto", nome: "p" }, 3)).toContain(FRASE_DA_IDENTIDADE);
    expect(legendaParaOLeitor({ papel: "erro", nome: "print.png" }, 2)).toMatch(/^imagem 2: PRINT DO ERRO/);
  });

  it("arquivo quebrado é recusado com o motivo antes de gastar; a cópia leve vai ao modelo", () => {
    expect(motivoDoDefeito("png_truncado", "print.png")).toBe('A imagem "print.png" chegou cortada no envio (o arquivo está incompleto). Tire e envie de novo.');
    const abrir = trecho("async function abrirAnexos(", "/** Frente RO, fase 2: cada mudança da conversa vira");
    expect(abrir.indexOf("const defeito = defeitoDaImagem(cru);")).toBeLessThan(abrir.indexOf("saida.push(await anexoLeve(bucket, caminho, a.nome || \"anexo\"));"));
    expect(abrir).toContain('throw new ErroEstudio(400, "anexo_quebrado", motivoDoDefeito(defeito, a.nome || "anexada"), { defeito });');
    expect(abrir).toContain("if (soma > MAX_BYTES_DOS_ANEXOS)");
    const a = trecho("async function ajustarCard(", "async function recorteDasAreas(");
    // Aberto e conferido ANTES do leitor (que é o primeiro gasto).
    expect(a.indexOf("const imagensDosAnexos = anexosPedidos.length ? await abrirAnexos(t, anexosPedidos) : [];")).toBeLessThan(a.indexOf("const dir = await chamarTexto({"));
    expect(a).toContain(".concat(recorteDaArea ? [recorteDaArea] : []).concat(imagensDosAnexos),");
    expect(a).toContain("const legenda = legendaParaOGerador(x);");
    expect(a).toContain("img = { ...img, png: await colarFotoNaArea(img.png, imagensDosAnexos[k].bytes, area), mime: \"image/png\" };");
    expect(a).toContain('comRostoAnexado ? linhasDaIdentidadeDaFoto().join("\\n") : ""');
  });
});

// ------------------------------------------------------------------ 8

type Linha = Record<string, unknown>;
function bancoFalso(inicial: Linha[] = []) {
  const linhas: Linha[] = inicial.map((l) => ({ ativa: true, reforcos: 1, criado_em: "2026-09-01T00:00:00Z", ...l }));
  let n = 0;
  const consulta = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Linha = {};
    let novo: Linha | null = null;
    let limite = Infinity;
    const q: Record<string, unknown> = {};
    const base = () => (tabela === "agente_memoria" ? linhas : []);
    const alvo = () => base().filter((l) => filtros.every((f) => f(l))).slice(0, limite);
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
      limit: (k: number) => ((limite = k), q),
      update: (p: Linha) => ((op = "update"), (patch = p), q),
      insert: (p: Linha) => {
        op = "insert";
        novo = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ativa: true, criado_em: new Date().toISOString(), ...p };
        linhas.push(novo);
        return q;
      },
      single: () => Promise.resolve(fim()),
      maybeSingle: () => Promise.resolve({ data: alvo()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(fim()).then(ok, erro),
    });
    return q;
  };
  return { db: { from: consulta } as any, linhas };
}
const julga = (decisao: JulgamentoDoEnsino["decisao"], tipo: JulgamentoDoEnsino["tipo"] = "evitar") => async (): Promise<JulgamentoDoEnsino> => ({ decisao, tipo, probabilidade: 0.9, fonte: "jev" });

describe("8. Aprender com cada pedido; obedecer; devolver", () => {
  it("\"não gostei do preço no selo\" vira regra EVITAR do Estúdio e entra na próxima direção (EVITAR primeiro)", async () => {
    const { db, linhas } = bancoFalso();
    const a = await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estudio", pedido: "não gostei do preço dentro do selo, nunca mais faça isso", regraSugerida: "Não usar preço dentro do selo", userId: "u1" }, { julgarEnsino: julga("preferencia_duradoura"), julgarDuplicidade: null });
    expect(a).toMatchObject({ texto: "Não usar preço dentro do selo", categoria: "evitar", situacao: "criado", mesa: "estudio" });
    expect(linhas[0]).toMatchObject({ client_id: CLIENTE, area: "arte", tipo: "evitar", fonte: "estudio_aprendizado" });
    const r = await regrasDaMesa(db, { clientId: CLIENTE, mesa: "estudio" });
    expect(r.regras.map((x) => [x.ref, x.tipo, x.texto])).toEqual([["g1", "evitar", "Não usar preço dentro do selo"]]);
    expect(r.bloco).toContain("EVITAR:\n- g1: Não usar preço dentro do selo");
    // A conversa com o diretor recebe o bloco no sistema e pede regra_aprendida e regras_seguidas.
    const c = trecho("async function conversar(", "/** Frente RO, fase 2: o esquema da conversa");
    expect(c).toContain("regras.bloco,");
    expect(c).toContain('mesa: "estudio",');
    expect(servidor).toContain('required: [...ESQUEMA_CONVERSA.schema.required, "regra_aprendida", "regras_seguidas"],');
    // A geração obedece (EVITAR no prompt) e a conferência avisa se violou (Jev, só aviso).
    expect(servidor).toContain("blocoDoEvitarAprendido,");
    expect(servidor).toContain('"NUNCA FAÇA NESTA ARTE (a equipe pediu e vale acima do estilo e da referência):"');
    expect(servidor).toContain("questions[`evitar_${k + 1}`] = {");
    expect(blocoDasRegras(r.regras)).toContain("EVITAR vale acima");
  });

  it("pedido de uma vez só não vira regra; repetido reforça; Esquecer tira", async () => {
    const { db, linhas } = bancoFalso();
    expect(await aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estudio", pedido: "tira o preço só desta lâmina", regraSugerida: "Sem preço" }, { julgarEnsino: julga("so_desta_vez") })).toBeNull();
    expect(linhas).toHaveLength(0);
    const pedir = () => aprenderDoPedido(db, { clientId: CLIENTE, mesa: "estudio", pedido: "nunca ponha sombra atrás do título", regraSugerida: "Não usar sombra atrás do título" }, { julgarEnsino: julga("preferencia_duradoura"), julgarDuplicidade: null });
    const um = await pedir();
    const dois = await pedir();
    expect(linhas).toHaveLength(1);
    expect(dois).toMatchObject({ id: um!.id, situacao: "reforcado", reforcos: 2 });
    expect((await esquecerRegra(db, { clientId: CLIENTE, id: um!.id! })).ok).toBe(true);
    expect(linhas[0].ativa).toBe(false);
    expect((await regrasDaMesa(db, { clientId: CLIENTE, mesa: "estudio" })).regras).toEqual([]);
    // As rotas do "Esquecer" e do "Guardar como regra" estão no Estúdio; o ajuste também aprende.
    expect(servidor).toContain('...rotasDoAprendizado({ mesa: "estudio"');
    const a = trecho("async function ajustarCard(", "async function recorteDasAreas(");
    expect(a).toContain("const aprendido: Aprendido | null = auto ? null : await aprenderDoPedido(servico() as never, {");
    expect(a).toContain("...(aprendido ? { aprendido } : {}),");
  });
});

// ------------------------------------------------------------------ 9 tela

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "AcelerIQ", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});
function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}
/** Botão com custo sem estimativa pede o segundo clique. */
async function clicar(nome: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: nome }));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const armado = screen.queryByRole("button", { name: /clique de novo/i });
  if (armado) fireEvent.click(armado);
}

const trabalhoDaTela = (versoes: { ordem: number; versao: number }[]): any => ({
  id: TRABALHO, client_id: CLIENTE, task_id: "t1", status: "pronto", file_ids: [], legenda: "", modelo_imagem_id: null, qualidade: "media",
  direcao: { conceito: "c", cards: laminas.map((l) => ({ ordem: l.ordem, funcao: l.funcao, texto_exato: l.texto })) },
  cards: versoes.map((v) => ({ ...v, storage_path: `${CLIENTE}/estudio/l${v.ordem}-v${v.versao}.png`, origem: v.versao > 1 ? "ajuste" : "gerar" })),
  custo_usd: 0, atualizado_em: "2026-09-29",
});

describe("9. Tela", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: any }) => ({ data: body.acao === "plano_passo" ? { plano: null } : {}, error: null }));
    mock.tabelas = {};
  });

  it("plano: um clique confirma; os passos andam na ordem; a prova mostra antes e depois com Desfazer", async () => {
    const plano = montarPlano({ id: "pl", itens: [], mudancasFeitas: [mudanca({ id: "m1", ordem: 1, campos: { texto_exato: "x" } }), mudanca({ id: "m2", ordem: 2, campos: { imagem: "y" }, regerar: [2] })], comArte: [1, 2], claro: false })!;
    const executar = vi.fn(async () => ({ custo_usd: 0.03 }));
    const { container, rerender } = montar(h(PlanoDoDiretor, { plano, mensagemId: MENSAGEM, trabalho: trabalhoDaTela([{ ordem: 1, versao: 1 }, { ordem: 2, versao: 1 }]), executar, partes: () => [], onAtualizar: vi.fn() }));
    expect(container.querySelector("[data-plano-do-diretor='pl']")!.getAttribute("data-estado")).toBe("aberto");
    expect(executar).not.toHaveBeenCalled();
    await clicar(/Confirmar e fazer os 2 passos/);
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(2));
    expect((executar.mock.calls as any[]).map((c) => c[0].operacao)).toEqual(["ajustar_texto", "refazer"]);
    const passos = mock.invoke.mock.calls.filter((c) => c[1].body.acao === "plano_passo").map((c) => [c[1].body.plano || c[1].body.passo_id, c[1].body.estado || ""]);
    expect(passos).toEqual([["confirmar", ""], ["p1", "executando"], ["p1", "feito"], ["p2", "executando"], ["p2", "feito"]]);
    // Prova: com as versões novas, antes e depois de cada lâmina e o Desfazer da versão.
    const qc = new QueryClient();
    rerender(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, h(PlanoDoDiretor, { plano, mensagemId: MENSAGEM, trabalho: trabalhoDaTela([{ ordem: 1, versao: 1 }, { ordem: 1, versao: 2 }, { ordem: 2, versao: 1 }, { ordem: 2, versao: 2 }]), executar, partes: () => [], onAtualizar: vi.fn() })))));
    await waitFor(() => expect(container.querySelectorAll("[data-prova]").length).toBe(2));
    fireEvent.click(container.querySelector("[data-desfazer-versao='2']")!);
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => c[1].body.acao === "desfazer_versao" && c[1].body.ordem === 1 && c[1].body.versao === 2)).toBe(true));
  });

  it("Parar: o passo em curso termina e os seguintes não começam", async () => {
    const plano = montarPlano({ id: "pl2", itens: [], mudancasFeitas: [mudanca({ id: "m1", ordem: 1, campos: { imagem: "a" }, regerar: [1] }), mudanca({ id: "m2", ordem: 2, campos: { imagem: "b" }, regerar: [2] })], comArte: [1, 2], claro: false })!;
    let soltar: () => void = () => undefined;
    const executar = vi.fn(() => new Promise((ok) => { soltar = () => ok({ custo_usd: 0.05 }); }));
    montar(h(PlanoDoDiretor, { plano, mensagemId: MENSAGEM, trabalho: trabalhoDaTela([{ ordem: 1, versao: 1 }, { ordem: 2, versao: 1 }]), executar, partes: () => [], onAtualizar: vi.fn() }));
    await clicar(/Confirmar e fazer os 2 passos/);
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Parar" }));
    await act(async () => { soltar(); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => c[1].body.plano === "parar")).toBe(true));
    expect(executar).toHaveBeenCalledTimes(1);
  });

  it("custo pequeno numa ordem clara (ajuste de texto): roda sozinho, sem clique", async () => {
    const plano = montarPlano({ id: "pl3", itens: [], mudancasFeitas: [mudanca({ id: "m1", ordem: 1, campos: { cor_texto: "#111111" } })], comArte: [1], claro: true })!;
    const executar = vi.fn(async () => ({ custo_usd: 0.02 }));
    montar(h(PlanoDoDiretor, { plano, mensagemId: MENSAGEM, trabalho: trabalhoDaTela([{ ordem: 1, versao: 1 }]), executar, partes: () => [], onAtualizar: vi.fn() }));
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
  });

  it("conversa: cartão feito na hora com Desfazer, plano, pergunta com opções e o Aprendi com Esquecer", async () => {
    const acaoFeita = {
      tipo: "acao_agente", agente: "estudio", id: "estudio-1", resumo: "Vou aplicar: título novo.", ignorados: [], recusados: [],
      itens: [{ ref: "l1", alvo_id: "1", titulo: "Título novo na capa", detalhe: "texto exato: Promoção de Setembro → Promoção de Outubro", operacao: "aplicar_mudanca", rotulo: "aplicar", para: "m1" }],
      executada_em: "2026-09-29T10:00:00Z", executada_direto: true, resultados: [{ ref: "l1", alvo_id: "1", titulo: "Título novo na capa", operacao: "aplicar_mudanca", ok: true, desfazer: { alvo: "lamina", ordem: 1 } }],
    };
    const planoAnexo = montarPlano({ id: "pl4", itens: [{ ref: "l2", alvo_id: "2", titulo: "Lâmina 2", detalhe: null, operacao: "refazer", rotulo: "refazer", para: null }], mudancasFeitas: [], comArte: [1, 2, 3], claro: true });
    const pergunta = perguntaDeEsclarecimento({ mensagem: "muda o título", laminas, motivo: "qual_lamina" });
    mock.tabelas = {
      agente_conversas: [{ id: "c1" }],
      agente_mensagens: [
        { id: MENSAGEM, papel: "agente", conteudo: "Mudei o título. A lâmina 2 espera o seu clique para refazer.", criado_em: "2026-09-29T10:00:00Z", anexos: [
          { tipo: "mudancas", mudancas: [{ id: "m1", alvo: "lamina", ordem: 1, titulo: "Título novo na capa", motivo: "pedido", campos: { texto_exato: "Promoção de Outubro" }, regerar: [], antes: { texto_exato: "Promoção de Setembro" } }], avisos: [], aplicadas: ["m1"] },
          acaoFeita, planoAnexo, pergunta,
          { tipo: "aprendizado_do_agente", id: "88888888-8888-4888-8888-888888888888", texto: "Não usar preço dentro do selo", categoria: "evitar", decisao: "preferencia_duradoura", situacao: "criado", reforcos: 1 },
          { tipo: "regras_seguidas", regras: [{ id: "r0", tipo: "evitar", texto: "Não usar fundo escuro" }] },
        ] },
      ],
    };
    const extras = extrasDaMensagem(mock.tabelas.agente_mensagens[0] && (mock.tabelas.agente_mensagens[0] as any).anexos);
    expect(extras.plano!.id).toBe("pl4");
    expect(extras.pergunta!.opcoes.length).toBe(4);
    const { container } = montar(h(DiretorDoEstudio, { trabalho: trabalhoDaTela([{ ordem: 1, versao: 1 }, { ordem: 2, versao: 1 }]), ordemEmFoco: null, ocupado: false, partesRefazer: () => [], onRefazer: vi.fn(async () => ({})), onAtualizar: vi.fn() }));
    expect(await screen.findByText(/Feito na hora/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Desfazer/ })).toBeTruthy();
    expect(container.querySelector("[data-plano-do-diretor='pl4'] [data-passo='refazer']")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Confirmar e fazer/ })).toBeTruthy();
    // A opção da pergunta vai para o campo (o envio mostra o custo antes).
    fireEvent.click(within(screen.getByRole("group", { name: "Opções da pergunta do diretor" })).getByRole("button", { name: "Lâmina 2 (conteúdo)" }));
    expect((screen.getByLabelText("Mensagem ao diretor de arte") as HTMLTextAreaElement).value).toBe("Na lâmina 2: muda o título");
    expect(container.textContent).toContain("Aprendi:");
    expect(container.textContent).toContain("Segui:");
    fireEvent.click(container.querySelector("[data-esquecer]")!);
    await waitFor(() => expect(mock.invoke.mock.calls.some((c) => c[1].body.acao === "aprendizado_esquecer" && c[1].body.id === "88888888-8888-4888-8888-888888888888")).toBe(true));
    // O campo aceita imagens (colar, arrastar, acervo) com o papel.
    expect(container.querySelector("[data-anexos-com-papel]")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Do acervo/ })).toBeTruthy();
  });

  it("Ajustar: pedido vago volta como proposta; aplicar manda a proposta confirmada", async () => {
    const onAjustar = vi.fn()
      .mockRejectedValueOnce(new ErroDaMesa("ajuste_proposta", "Proponho: aumentar o título em 20%. Aplico assim?", { proposta: "aumentar o título em 20% e alinhar à esquerda", custo_usd: 0.003 }))
      .mockResolvedValueOnce({ custo_usd: 0.04 });
    const versoes = [{ ordem: 1, versao: 1, storage_path: `${CLIENTE}/v1.png`, origem: "gerar" }, { ordem: 1, versao: 2, storage_path: `${CLIENTE}/v2.png`, origem: "ajuste", aprendido: { tipo: "aprendizado_do_agente", id: "99999999-9999-4999-8999-999999999999", texto: "Título sempre à esquerda", categoria: "preferencia", decisao: "preferencia_duradoura", situacao: "criado", reforcos: 1 } }];
    const onDesfazerVersao = vi.fn(async () => ({}));
    const props = {
      conversaId: null, direcao: { ordem: 1, funcao: "capa", texto_exato: "Olá" }, versoes, ocupado: false, conferindo: false, painel: "livre", onPainel: vi.fn(),
      versaoVista: 2, onVersaoVista: vi.fn(), areas: [], onAreas: vi.fn(), partesGerar: () => [], partesAjustar: () => [], partesConferir: () => [],
      onGerar: vi.fn(), onAjustar, onConferir: vi.fn(), onConfigurar: vi.fn(), onConcluido: vi.fn(), onDesfazerVersao,
    };
    const { container } = montar(h(CardDoEstudio, props as any));
    fireEvent.change(container.querySelector("textarea[placeholder^='Ex.: título maior']")!, { target: { value: "deixa mais bonito" } });
    await clicar(/^Ajustar$/);
    await waitFor(() => expect(container.querySelector("[data-proposta-do-ajuste]")).toBeTruthy());
    expect(container.textContent).toContain("Proposta do diretor: aumentar o título em 20% e alinhar à esquerda");
    await clicar(/Aplicar a proposta/);
    await waitFor(() => expect(onAjustar).toHaveBeenCalledTimes(2));
    expect(onAjustar.mock.calls[1]).toEqual(["aumentar o título em 20% e alinhar à esquerda", { confirmado: true }]);
    // O último ajuste mostra o que aprendeu e tem o Desfazer (volta para a versão anterior).
    expect(container.textContent).toContain("Aprendi:");
    fireEvent.click(container.querySelector("[data-desfazer-ajuste='2']")!);
    await waitFor(() => expect(onDesfazerVersao).toHaveBeenCalledWith(2));
  });

  it("imagens com papel: o seletor troca o papel e o corpo leva só as prontas", () => {
    let corpo: unknown = null;
    function Teste() {
      const papeis = usePapeisDosAnexos();
      const [lista] = useState([{ id: "a1", nome: "print.png", previa: null, caminho: `${CLIENTE}/pedidos/print.png`, estado: "pronto" as const }, { id: "a2", nome: "subindo.png", previa: null, caminho: null, estado: "subindo" as const }]);
      const controle: any = { lista, adicionar: vi.fn(), remover: vi.fn(), limpar: vi.fn(), tirarEnviados: vi.fn(), caminhos: [], subindo: true, cheio: false };
      corpo = corpoDosAnexos(anexosComPapel(controle, papeis));
      return h(AnexosComPapel, { controle, papeis });
    }
    montar(h(Teste));
    expect(corpo).toEqual([{ caminho: `${CLIENTE}/pedidos/print.png`, nome: "print.png", papel: "auto" }]);
    fireEvent.change(screen.getByRole("combobox", { name: "Papel de print.png" }), { target: { value: "erro" } });
    expect(corpo).toEqual([{ caminho: `${CLIENTE}/pedidos/print.png`, nome: "print.png", papel: "erro" }]);
  });

  it("arquivos novos da tela: sem travessão e sem recurso fora do Safari 11 / Chrome 64", () => {
    for (const f of ["src/components/mesa/PlanoDoDiretor.tsx", "src/components/mesa/AnexosComPapel.tsx", "supabase/functions/estudio-arte/diretor-agentico.ts", "supabase/functions/estudio-arte/anexos-do-ajuste.ts"]) {
      const s = ler(f);
      expect(s, f).not.toMatch(/[—–]/);
      expect(s, f).not.toMatch(/\(\?<[=!a-zA-Z]|\\p\{|\.at\(|Object\.hasOwn|\.flatMap\(/);
    }
  });
});
