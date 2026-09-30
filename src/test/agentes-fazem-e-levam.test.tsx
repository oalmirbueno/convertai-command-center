import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { CaminhoDaMensagem, CaminhoDoTexto } from "@/components/agentes/CaminhoPronto";
import { acaoDoAnexo, caminhoDosAnexos, emAndamento, jaEstaAqui, pendentesDaAcao, type AcaoDoAgente as AcaoNaTela } from "@/lib/agentes/acoesDoAgente";
import {
  anexosComCaminho,
  caminhoNasAcoes,
  comCaminho,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  TIPO_DO_CAMINHO,
  type AcaoDoAgente,
  type AcaoGuardada,
} from "../../supabase/functions/_shared/acoes-do-agente";
import { blocoDoMapaDoPainel, caminhoDaResposta, caminhoNaArea, linkComEstado, linkDaArea, pedeParaLevar } from "../../supabase/functions/_shared/mapa-do-painel";
import { caminhoDosRoteiros } from "../../supabase/functions/mesa-roteiros/acoes-dos-roteiros";
import { caminhoDaPublicidade } from "../../supabase/functions/mesa-publicidade/acoes-da-publicidade";
import { caminhoDoContexto } from "../../supabase/functions/agente-contexto/acoes-do-contexto";
import { caminhoDoLancador } from "../../supabase/functions/voice-assistant-agent/acoes-do-lancador";
import { caminhoDoEstilo } from "../../supabase/functions/agente-estilo/acoes-do-estilo";
import { caminhoDosPerfis } from "../../supabase/functions/_shared/perfis-instagram";
import { caminhoDaMesaDeVideo } from "../../supabase/functions/_shared/agente-de-video";
import { anexosDaRespostaDoDiretor, caminhoDoTrabalho, comCaminhoDoDiretor } from "../../supabase/functions/estudio-arte/acoes-do-diretor";

/**
 * Frente AG (27/09), pedido do dono: "com o agente ele já deixa pronto,
 * aparece ali no chat, e quando termina isso em todos ele dá o caminho pra mim
 * apertar e ir e já fica tudo certinho... um acompanhamento meu humano
 * observando as ações de forma clara e poder parar ou interferir".
 * Confere: 1. a sequência em passos com andamento e Parar (contrato comum);
 * 2. o caminho de cada agente abre o item certo; 3. o "faz e me leva";
 * 4. o cartão e o botão do caminho na tela.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const CLIENTE = U(900);

const itens = (n: number, operacao = "fazer") =>
  Array.from({ length: n }, (_, i) => ({ ref: `x${i + 1}`, alvo_id: U(i + 1), titulo: `Item ${i + 1}`, detalhe: null, operacao, rotulo: operacao, para: null }));

const proposta = (extra: Partial<AcaoDoAgente> = {}): AcaoDoAgente => ({
  tipo: "acao_agente",
  agente: "teste",
  id: "a1",
  resumo: "Vou fazer.",
  itens: itens(7),
  ignorados: [],
  recusados: [],
  ...extra,
});

/** A proposta guardada "na mensagem", em memória (o que o banco faria). */
function guardadaEmMemoria(inicial: AcaoDoAgente): AcaoGuardada & { atual: () => AcaoDoAgente } {
  let atual = inicial;
  const g = {
    mensagem: { id: U(77), client_id: CLIENTE, conversa_id: U(78) },
    get acao() {
      return atual;
    },
    gravar: async (novo: AcaoDoAgente) => {
      atual = novo;
      return novo;
    },
    atual: () => atual,
  };
  return g as unknown as AcaoGuardada & { atual: () => AcaoDoAgente };
}

// ------------------------------------------------------------------ 1. contrato: passos, andamento e Parar

describe("sequência em passos: andamento, Parar e compatível com quem faz de uma vez", () => {
  it("sem porVez, tudo numa chamada (como sempre foi) e terminou", async () => {
    const g = guardadaEmMemoria(proposta());
    const executor = vi.fn(async () => ({ desfazer: { antes: 1 } }));
    const r = await confirmarAcaoGuardada(g, executor, { userId: U(9) });
    expect(executor).toHaveBeenCalledTimes(7);
    expect(r.terminou).toBe(true);
    expect(r.anexo.executada_em).toBeTruthy();
    expect(r.anexo.andamento).toBeUndefined();
  });

  it("com porVez, faz os próximos N, grava o andamento e só termina no último passo", async () => {
    const g = guardadaEmMemoria(proposta());
    const vistos: string[] = [];
    const executor = async (i: { ref: string }) => {
      vistos.push(i.ref);
      return { desfazer: { ref: i.ref } };
    };
    const p1 = await confirmarAcaoGuardada(guardadaEmMemoria(g.atual()), executor, { userId: U(9), porVez: 3 });
    expect(p1.terminou).toBe(false);
    expect(p1.anexo.executada_em).toBeFalsy();
    expect(p1.anexo.andamento).toEqual(expect.objectContaining({ feitos: 3, total: 7 }));
    expect(pendentesDaAcao(p1.anexo).map((i) => i.ref)).toEqual(["x4", "x5", "x6", "x7"]);
    const p2 = await confirmarAcaoGuardada(guardadaEmMemoria(p1.anexo), executor, { userId: U(9), porVez: 3 });
    const p3 = await confirmarAcaoGuardada(guardadaEmMemoria(p2.anexo), executor, { userId: U(9), porVez: 3, caminho: () => ({ rotulo: "Ver", destino: "/kanban" }) });
    expect(vistos).toEqual(["x1", "x2", "x3", "x4", "x5", "x6", "x7"]);
    expect(p3.terminou).toBe(true);
    expect(p3.anexo.executada_em).toBeTruthy();
    expect(p3.anexo.resultados!.length).toBe(7);
    expect(p3.anexo.andamento).toEqual(expect.objectContaining({ feitos: 7, total: 7 }));
    expect(p3.anexo.caminho).toEqual({ rotulo: "Ver", destino: "/kanban" });
  });

  it("parar no meio: o que foi feito fica (com Desfazer), o resto não acontece; o Desfazer volta só o feito", async () => {
    const g1 = guardadaEmMemoria(proposta({ caminho: { rotulo: "Ir", destino: "/mesa", abrir_sozinho: true } }));
    const passo = await confirmarAcaoGuardada(g1, async () => ({ desfazer: { ok: 1 } }), { userId: U(9), porVez: 2 });
    const g2 = guardadaEmMemoria(passo.anexo);
    const executor = vi.fn();
    const parada = await confirmarAcaoGuardada(g2, executor, { userId: U(9), parar: true, caminho: () => ({ rotulo: "Ver no Kanban", destino: "/kanban?task=1" }) });
    expect(executor).not.toHaveBeenCalled();
    expect(parada.anexo.parada_em).toBeTruthy();
    expect(parada.anexo.executada_em).toBeTruthy();
    expect(parada.anexo.resultados!.length).toBe(2);
    // O "faz e me leva" da proposta não se perde quando o caminho é recalculado.
    expect(parada.anexo.caminho).toEqual({ rotulo: "Ver no Kanban", destino: "/kanban?task=1", abrir_sozinho: true });
    const reverter = vi.fn(async () => undefined);
    const volta = await desfazerAcaoGuardada(guardadaEmMemoria(parada.anexo), reverter, { userId: U(9) });
    expect(volta.voltaram).toBe(2);
    // Cancelar com parte feita vira parar (nunca "nada mudou" quando algo mudou).
    const g3 = guardadaEmMemoria(passo.anexo);
    const cancelada = await confirmarAcaoGuardada(g3, vi.fn(), { userId: U(9), descartar: true });
    expect(cancelada.anexo.descartada_em).toBeFalsy();
    expect(cancelada.anexo.parada_em).toBeTruthy();
    // Parar antes de começar é cancelar.
    const nada = await confirmarAcaoGuardada(guardadaEmMemoria(proposta()), vi.fn(), { userId: U(9), parar: true });
    expect(nada.anexo.descartada_em).toBeTruthy();
  });

  it("a tela lê o andamento: em andamento só quando começou e não terminou", () => {
    const meio = acaoDoAnexo({ ...proposta(), resultados: [{ ref: "x1", alvo_id: U(1), titulo: "Item 1", operacao: "fazer", ok: true }] })!;
    expect(emAndamento(meio)).toBe(true);
    expect(emAndamento({ ...meio, executada_em: "2026-09-27" })).toBe(false);
    expect(emAndamento(acaoDoAnexo(proposta())!)).toBe(false);
  });
});

// ------------------------------------------------------------------ 2. caminhos: rota interna com o item certo

describe("caminho de cada agente abre o item certo", () => {
  it("link com estado: cliente, etapa e o item; parâmetro estranho fica de fora; Anúncios lê ?cliente=", () => {
    expect(linkComEstado("mesa_roteiros", { clientId: CLIENTE, etapa: "revisao", estado: { roteiro: U(5) } })).toBe(`/mesa-roteiros?client=${CLIENTE}&etapa=revisao&roteiro=${U(5)}`);
    expect(linkComEstado("kanban", { clientId: CLIENTE, estado: { task: U(3), "x-y": "1", client: "outro", vazio: "" } })).toBe(`/kanban?client=${CLIENTE}&task=${U(3)}`);
    expect(linkDaArea("anuncios", { clientId: CLIENTE })).toBe(`/anuncios?cliente=${CLIENTE}`);
    expect(linkDaArea("mesa_foto", { clientId: CLIENTE, etapa: "campanha" })).toBe(`/mesa-foto?client=${CLIENTE}&etapa=campanha`);
    expect(caminhoNaArea("mesa", { clientId: CLIENTE, etapa: "estudio", abrirSozinho: true })).toEqual({ rotulo: "Abrir Mesa", destino: `/mesa?client=${CLIENTE}&aba=estudio`, abrir_sozinho: true });
    expect(caminhoNaArea("inventada", { clientId: CLIENTE })).toBeNull();
  });

  it("as páginas leem os parâmetros que os caminhos mandam (senão o botão abriria no lugar errado)", () => {
    expect(ler("src/pages/MesaRoteiros.tsx")).toContain('params.get("roteiro")');
    expect(ler("src/pages/Kanban.tsx")).toContain('searchParams.get("task")');
    expect(ler("src/pages/Kanban.tsx")).toContain('searchParams.get("project")');
    const mesa = ler("src/pages/MesaDoCliente.tsx");
    for (const p of ['params.get("aba")', 'params.get("task")', 'params.get("mes")']) expect(mesa).toContain(p);
    expect(ler("src/pages/MesaFoto.tsx")).toContain('params.get("imagem")');
    expect(ler("src/pages/MesaPublicidade.tsx")).toContain('params.get("campanha")');
    expect(ler("src/components/mesa-edicao/useParte.ts")).toContain('params.get("parte")');
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain('parametros.get("fotos")');
    // O Workspace passou a ler o cliente do endereço (antes não lia nada).
    expect(ler("src/pages/Workspace.tsx")).toContain('parametros.get("client")');
  });

  it("Roteiros: gerado abre o roteiro; mudado abre a Revisão (antes e depois); vários, a lista; arquivado, a Agenda", () => {
    const gerar = { itens: [{ ref: "p1", alvo_id: U(40), titulo: "Peça", detalhe: null, operacao: "gerar_roteiro", rotulo: "gerar", para: "fala_camera" }] };
    expect(caminhoDosRoteiros(CLIENTE, { ...gerar, resultados: [{ ref: "p1", alvo_id: U(40), titulo: "Peça", operacao: "gerar_roteiro", ok: true, desfazer: { tipo: "arquivar_criado", roteiro_id: U(41) } }] })!.destino)
      .toBe(`/mesa-roteiros?client=${CLIENTE}&etapa=roteiro&roteiro=${U(41)}`);
    const tom = { itens: [{ ref: "r1", alvo_id: U(50), titulo: "BPC", detalhe: null, operacao: "mudar_tom", rotulo: "tom", para: "leve" }] };
    expect(caminhoDosRoteiros(CLIENTE, tom, { abrirSozinho: true })).toEqual({ rotulo: "Ver o roteiro na Revisão", destino: `/mesa-roteiros?client=${CLIENTE}&etapa=revisao&roteiro=${U(50)}`, abrir_sozinho: true });
    const dois = { itens: [tom.itens[0], { ...tom.itens[0], ref: "r2", alvo_id: U(51) }] };
    expect(caminhoDosRoteiros(CLIENTE, dois)!.destino).toBe(`/mesa-roteiros?client=${CLIENTE}&etapa=revisao`);
    // O que falhou não conta.
    expect(caminhoDosRoteiros(CLIENTE, { ...dois, resultados: [{ ref: "r1", alvo_id: U(50), titulo: "BPC", operacao: "mudar_tom", ok: false }, { ref: "r2", alvo_id: U(51), titulo: "x", operacao: "mudar_tom", ok: true }] })!.destino).toContain(`roteiro=${U(51)}`);
    const arquivar = { itens: [{ ...tom.itens[0], operacao: "arquivar_roteiro" }] };
    expect(caminhoDosRoteiros(CLIENTE, arquivar)!.destino).toBe(`/mesa-roteiros?client=${CLIENTE}&etapa=agenda`);
  });

  it("Publicidade: foto mandada para a Mesa Ads abre o Estúdio de lá com as fotos; briefing abre a campanha", () => {
    const c = { client_id: CLIENTE, id: U(60) };
    const enviar = {
      itens: [{ ref: "f1", alvo_id: U(61), titulo: "Foto", detalhe: null, operacao: "mandar_para_ads", rotulo: "Mandar", para: null }],
      resultados: [{ ref: "f1", alvo_id: U(61), titulo: "Foto", operacao: "mandar_para_ads", ok: true, desfazer: { encaminhamento_ids: [U(62)], imagem_ids: [U(63)], destino: "ads" } }],
    };
    expect(caminhoDaPublicidade(c, enviar)!.destino).toBe(`/mesa-ads?client=${CLIENTE}&etapa=estudio&fotos=${U(63)}`);
    const briefing = { itens: [{ ref: "k1", alvo_id: U(60), titulo: "Campanha", detalhe: null, operacao: "editar_briefing", rotulo: "Mudar", para: "tom: leve" }] };
    expect(caminhoDaPublicidade(c, briefing)!.destino).toBe(`/mesa-publicidade?client=${CLIENTE}&etapa=campanha&campanha=${U(60)}`);
    const tomadas = { itens: [{ ref: "t1", alvo_id: U(64), titulo: "Verão", detalhe: null, operacao: "pedir_tomadas", rotulo: "Pedir", para: null }] };
    expect(caminhoDaPublicidade(c, tomadas)!.destino).toContain("etapa=tomadas");
  });

  it("Contexto: tarefa abre o detalhe no Kanban; foto abre no acervo; kit abre a aba Contexto; arquivo, o Workspace do cliente", () => {
    const tarefa = {
      itens: [{ ref: "tn1", alvo_id: U(70), titulo: "Gravar", detalhe: null, operacao: "criar_tarefa", rotulo: "criar tarefa", para: null }],
      resultados: [{ ref: "tn1", alvo_id: U(70), titulo: "Gravar", operacao: "criar_tarefa", ok: true, desfazer: { tarefa_id: U(71) } }],
    };
    expect(caminhoDoContexto(CLIENTE, tarefa)!.destino).toBe(`/kanban?client=${CLIENTE}&task=${U(71)}`);
    const plano = {
      itens: [
        { ref: "pn1", alvo_id: U(72), titulo: "Projeto", detalhe: null, operacao: "criar_projeto", rotulo: "criar projeto", para: null },
        { ref: "tn1", alvo_id: U(72), titulo: "A", detalhe: null, operacao: "criar_tarefa", rotulo: "criar tarefa", para: null },
        { ref: "tn2", alvo_id: U(72), titulo: "B", detalhe: null, operacao: "criar_tarefa", rotulo: "criar tarefa", para: null },
      ],
      resultados: [
        { ref: "pn1", alvo_id: U(72), titulo: "Projeto", operacao: "criar_projeto", ok: true, desfazer: { projeto_id: U(73) } },
        { ref: "tn1", alvo_id: U(72), titulo: "A", operacao: "criar_tarefa", ok: true, desfazer: { tarefa_id: U(74) } },
        { ref: "tn2", alvo_id: U(72), titulo: "B", operacao: "criar_tarefa", ok: true, desfazer: { tarefa_id: U(75) } },
      ],
    };
    expect(caminhoDoContexto(CLIENTE, plano)).toEqual({ rotulo: "Ver as 2 tarefas no Kanban", destino: `/kanban?client=${CLIENTE}&project=${U(73)}` });
    const foto = { itens: [{ ref: "i1", alvo_id: U(76), titulo: "fachada", detalhe: null, operacao: "marcar_foto", rotulo: "marcar", para: "loja" }] };
    expect(caminhoDoContexto(CLIENTE, foto)!.destino).toBe(`/mesa-foto?client=${CLIENTE}&etapa=acervo&imagem=${U(76)}`);
    const kit = { itens: [{ ref: "e1", alvo_id: CLIENTE, titulo: "Estilo", detalhe: null, operacao: "kit_estilo", rotulo: "estilo", para: null }] };
    expect(caminhoDoContexto(CLIENTE, kit)!.destino).toBe(`/mesa?client=${CLIENTE}&aba=contexto`);
    const arquivo = { itens: [{ ref: "w1", alvo_id: U(77), titulo: "doc", detalhe: null, operacao: "renomear", rotulo: "renomear", para: "novo" }] };
    expect(caminhoDoContexto(CLIENTE, arquivo)!.destino).toBe(`/workspace?client=${CLIENTE}`);
  });

  it("Aceleriq: tarefa criada abre no Kanban; nota abre o contexto do cliente", () => {
    const criada = {
      itens: [{ ref: "p1", alvo_id: U(80), titulo: "Social", detalhe: null, operacao: "criar_tarefa", rotulo: "criar tarefa", para: "Gravar | 2026-10-02 | high" }],
      resultados: [{ ref: "p1", alvo_id: U(80), titulo: "Social", operacao: "criar_tarefa", ok: true, desfazer: { tarefa_id: U(81) } }],
    };
    expect(caminhoDoLancador(CLIENTE, criada)!.destino).toBe(`/kanban?client=${CLIENTE}&task=${U(81)}`);
    const nota = { itens: [{ ref: "c1", alvo_id: CLIENTE, titulo: "Mirante", detalhe: null, operacao: "registrar_nota", rotulo: "anotar", para: "x" }] };
    expect(caminhoDoLancador(CLIENTE, nota)!.destino).toBe(`/mesa?client=${CLIENTE}&aba=contexto`);
  });

  it("Estilo: mudou o estilo ou o template, o caminho é o Estúdio; só teste e gosto ficam no painel", () => {
    const gravar = { itens: [{ ref: "e1", alvo_id: CLIENTE, titulo: "Estilo", detalhe: null, operacao: "gravar_estilo", rotulo: "gravar", para: null }] };
    expect(caminhoDoEstilo(CLIENTE, gravar)!.destino).toBe(`/mesa?client=${CLIENTE}&aba=estudio`);
    const teste = { itens: [{ ...gravar.itens[0], operacao: "gerar_teste" }] };
    expect(caminhoDoEstilo(CLIENTE, teste)).toBeNull();
    const template = { itens: [{ ...gravar.itens[0], operacao: "criar_template" }] };
    expect(caminhoDoEstilo(CLIENTE, template)!.rotulo).toBe("Usar o template no Estúdio");
  });

  it("Perfis: pautas na agenda abrem o plano do mês certo; Vídeos: envio abre a Entrada da Edição; Diretor: o item no Estúdio", () => {
    const agendar = {
      itens: [
        { ref: "q2", alvo_id: "q2", titulo: "Pauta", detalhe: null, operacao: "agendar", rotulo: "Pôr na agenda", para: "2026-11-12" },
        { ref: "q1", alvo_id: "q1", titulo: "Pauta", detalhe: null, operacao: "agendar", rotulo: "Pôr na agenda", para: "2026-10-30" },
      ],
    };
    expect(caminhoDosPerfis(CLIENTE, agendar)!.destino).toBe(`/mesa?client=${CLIENTE}&aba=mes&mes=2026-10-01`);
    expect(caminhoDaMesaDeVideo(CLIENTE, { agente: "envio_para_edicao" })!.destino).toBe(`/mesa-edicao?client=${CLIENTE}&etapa=entrada&parte=videos`);
    expect(caminhoDaMesaDeVideo(CLIENTE, { agente: "diretor_de_video", resultados: [{ ref: "x", alvo_id: "x", titulo: "x", operacao: "gerar_plano", ok: false }] })).toBeNull();
    expect(caminhoDoTrabalho({ client_id: CLIENTE, task_id: U(90), tipo: "carrossel" })!.destino).toBe(`/mesa?client=${CLIENTE}&aba=estudio&task=${U(90)}`);
    expect(caminhoDoTrabalho({ client_id: CLIENTE, task_id: null, tipo: "ads" })).toBeNull();
    const acao = comCaminhoDoDiretor(proposta({ agente: "estudio" }), { client_id: CLIENTE, task_id: U(90) }, "reordene 3,1,2 e me leva lá");
    expect(acao!.caminho).toEqual(expect.objectContaining({ abrir_sozinho: true }));
  });

  it("resposta sem ação que cita outra área vira anexo de caminho; ação com caminho não repete", () => {
    const c = caminhoDaResposta("Isso é na Mesa Ads (/mesa-ads?etapa=conta). Abro para você?", CLIENTE);
    expect(c).toEqual({ rotulo: "Abrir Mesa Ads", destino: `/mesa-ads?client=${CLIENTE}&etapa=conta` });
    const soTexto = anexosComCaminho([], c);
    expect(soTexto).toEqual([{ tipo: TIPO_DO_CAMINHO, ...c }]);
    expect(caminhoDosAnexos(soTexto)).toEqual(c);
    const comAcao = caminhoNasAcoes([proposta()], () => ({ rotulo: "Ver", destino: "/kanban" }));
    expect(anexosComCaminho(comAcao, c).length).toBe(1);
    expect(anexosComCaminho([], { rotulo: "x", destino: "https://fora.test" })).toEqual([]);
    expect(comCaminho(proposta(), null).caminho).toBeUndefined();
    // O diretor do Estúdio guarda o caminho junto das mudanças (o "Aplicar" continua lendo o anexo dele).
    const doDiretor = anexosDaRespostaDoDiretor([{ tipo: "mudancas", mudancas: [] }], "Isso é na Mesa Ads (/mesa-ads).", CLIENTE, "abre a mesa ads");
    expect(doDiretor[0]).toEqual({ tipo: "mudancas", mudancas: [] });
    expect(caminhoDosAnexos(doDiretor)).toEqual({ rotulo: "Abrir Mesa Ads", destino: `/mesa-ads?client=${CLIENTE}`, abrir_sozinho: true });
  });
});

// ------------------------------------------------------------------ 3. "faz e me leva" e o que falta

describe("faz e me leva; e o agente diz o que falta quando não tem a ação", () => {
  it("pede para a pessoa ir (sem o Jev): me leva, abre pra mim, quero ver; mover o item para a Agenda não conta", () => {
    for (const t of ["Aprove o roteiro e me leva lá", "crie a tarefa e abre pra mim", "troca o título, quero ver", "renomeia e já abre"]) expect(pedeParaLevar(t), t).toBe(true);
    for (const t of ["leva isso para a Agenda", "crie a tarefa de gravar", "manda para aprovação", "leve as fotos para a Mesa Ads"]) expect(pedeParaLevar(t), t).toBe(false);
  });

  it("o mapa manda dizer o que falta (área e botão) em vez de fingir que fez, e continua cabendo no teto", () => {
    const b = blocoDoMapaDoPainel("roteiros");
    expect(b).toContain("diga numa frase o que falta");
    expect(b.length).toBeLessThan(5000); // 30/09: +Mesa Proposta, Identidade, Site, Contratos e Motion no mapa (antes 3600)
    expect(b).not.toContain("—");
  });

  it("a execução direta pergunta o levar ao Jev na mesma chamada da ordem (sem chamada a mais)", () => {
    const f = ler("supabase/functions/_shared/ordem-clara.ts");
    expect((f.match(/jevPerguntar\(/g) || []).length).toBe(1);
    expect(f).toContain("levar: {");
    expect(f).toContain("pedeParaLevar(texto)");
  });
});

// ------------------------------------------------------------------ 4. na tela

function Onde() {
  const l = useLocation();
  return h("output", { "data-testid": "onde" }, `${l.pathname}${l.search}`);
}

const naTela = (extra: Partial<AcaoNaTela> = {}): AcaoNaTela => acaoDoAnexo({ ...proposta(), ...extra })!;
const resultado = (n: number) => ({ ref: `x${n}`, alvo_id: U(n), titulo: `Item ${n}`, operacao: "fazer", ok: true, desfazer: { a: 1 } });

describe("cartão: acompanha passo a passo, para no meio e leva ao caminho", () => {
  it("segue os passos até terminar, marcando cada item feito", async () => {
    const r = (feitos: number, fim = false) => ({ anexo: { ...proposta(), resultados: Array.from({ length: feitos }, (_, i) => resultado(i + 1)), ...(fim ? { executada_em: "2026-09-27T12:00:00Z" } : {}), andamento: { feitos, total: 7 } } });
    const onPedido = vi.fn().mockResolvedValueOnce(r(3)).mockResolvedValueOnce(r(6)).mockResolvedValueOnce(r(7, true));
    render(h(MemoryRouter, null, h(CartaoDeAcao, { acao: naTela(), onPedido })));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(document.querySelector("[data-acao-agente]")!.getAttribute("data-acao-agente")).toBe("feita"));
    expect(onPedido.mock.calls.map((c) => c[0])).toEqual(["confirmar", "confirmar", "confirmar"]);
    expect(document.querySelectorAll('[data-item-feito="sim"]').length).toBe(7);
  });

  it("Parar vale depois do passo em curso: o resto não é feito e o cartão diz quanto foi", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    const segura = new Promise((ok) => {
      soltar = ok;
    });
    const parcial = (feitos: number) => ({ anexo: { ...proposta(), resultados: Array.from({ length: feitos }, (_, i) => resultado(i + 1)), andamento: { feitos, total: 7 } } });
    const onPedido = vi.fn(async (p: string) => {
      if (p === "parar") return { anexo: { ...proposta(), resultados: [resultado(1), resultado(2), resultado(3), resultado(4)], executada_em: "x", parada_em: "x", andamento: { feitos: 4, total: 7 } } };
      if (onPedido.mock.calls.length === 1) return parcial(2);
      await segura;
      return parcial(4);
    });
    render(h(MemoryRouter, null, h(CartaoDeAcao, { acao: naTela(), onPedido })));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    const parar = await screen.findByRole("button", { name: /Parar/ });
    expect(screen.getByText(/Fazendo: 2 de 7/)).toBeTruthy();
    fireEvent.click(parar);
    soltar(null);
    await waitFor(() => expect(screen.getByText(/Parado · 4 de 7 feitos/)).toBeTruthy());
    expect(onPedido.mock.calls.map((c) => c[0])).toEqual(["confirmar", "confirmar", "parar"]);
    expect(screen.getByRole("button", { name: /Desfazer/ })).toBeTruthy();
  });

  it("reaberto no meio da sequência: Continuar ou Parar aqui", async () => {
    const meio = naTela({ resultados: [resultado(1), resultado(2)], andamento: { feitos: 2, total: 7 } });
    const onPedido = vi.fn().mockResolvedValue({ anexo: { ...meio, executada_em: "x", parada_em: "x" } });
    render(h(MemoryRouter, null, h(CartaoDeAcao, { acao: meio, onPedido })));
    expect(screen.getByText(/Parou no meio: 2 de 7/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Parar aqui/ }));
    await waitFor(() => expect(onPedido).toHaveBeenCalledWith("parar"));
  });

  it("feita na hora nesta conversa com 'me leva': vai sozinho; a mesma ação relida da conversa não navega", async () => {
    const feita = naTela({
      executada_em: "2026-09-27T12:00:00Z",
      executada_direto: true,
      resultados: [resultado(1)],
      itens: itens(1),
      caminho: { rotulo: "Abrir a tarefa no Kanban", destino: "/kanban?task=t-recem", abrir_sozinho: true },
    });
    render(h(MemoryRouter, { initialEntries: ["/mesa"] }, h(CartaoDeAcao, { acao: feita, onPedido: vi.fn(), recemFeita: true }), h(Onde)));
    await waitFor(() => expect(screen.getByTestId("onde").textContent).toBe("/kanban?task=t-recem"));
    const relida = { ...feita, caminho: { ...feita.caminho!, destino: "/kanban?task=t-relida" } };
    render(h(MemoryRouter, { initialEntries: ["/mesa"] }, h(CartaoDeAcao, { acao: relida, onPedido: vi.fn() }), h(Onde)));
    expect(screen.getAllByTestId("onde").pop()!.textContent).toBe("/mesa");
  });

  it("resposta sem ação: o botão do caminho fica na mensagem; já estando no lugar, some", () => {
    const anexos = [{ tipo: TIPO_DO_CAMINHO, rotulo: "Abrir Mesa Ads", destino: `/mesa-ads?client=${CLIENTE}&etapa=conta` }];
    render(h(MemoryRouter, { initialEntries: ["/mesa-roteiros"] }, h(CaminhoDaMensagem, { anexos })));
    expect(screen.getByRole("button", { name: /Abrir Mesa Ads/ })).toBeTruthy();
    const { container } = render(h(MemoryRouter, { initialEntries: [`/mesa-ads?etapa=conta&client=${CLIENTE}&marca=m1`] }, h(CaminhoDaMensagem, { anexos })));
    expect(container.querySelector("[data-caminho-do-agente]")).toBeNull();
    expect(jaEstaAqui("/mesa?client=c&aba=estudio&task=t", "/mesa?task=t&aba=estudio&client=c&mes=2026-10-01")).toBe(true);
    expect(jaEstaAqui("/mesa?client=c&aba=estudio&task=t", "/mesa?client=c&aba=estudio")).toBe(false);
  });

  it("chat em texto corrido (Workspace): a área citada vira o botão com o cliente", () => {
    render(h(MemoryRouter, { initialEntries: ["/workspace"] }, h(CaminhoDoTexto, { texto: "Os roteiros ficam na Mesa Roteiros (/mesa-roteiros?etapa=revisao).", clientId: CLIENTE })));
    expect(document.querySelector("[data-caminho-do-agente]")!.getAttribute("data-caminho-do-agente")).toBe(`/mesa-roteiros?client=${CLIENTE}&etapa=revisao`);
    const vazio = render(h(MemoryRouter, null, h(CaminhoDoTexto, { texto: "Sem área nenhuma aqui.", clientId: CLIENTE })));
    expect(vazio.container.querySelector("[data-caminho-do-texto]")).toBeNull();
  });
});
