/**
 * Frente AG1 (29/09): os cinco agentes da Mesa do cliente (contexto, Mês,
 * campanha, redes e perfil) sem bug, mais inteligentes e agênticos.
 * Casos reais que viraram teste:
 * - contexto: "não responde, a mensagem some" (a mensagem é gravada antes da
 *   IA e só sai se a IA falhar; o histórico leva o estado dos cartões);
 * - Mês: o refazer de 18 peças da Verzelo (29/09 12:54) seguiu o resumo do
 *   agente, não as palavras do dono ("jardinagem, poda, menos texto");
 * - campanha: Stop Informática (28/09) "roda até o dia 29", o agente disse
 *   "registrei" e o fim continuou 15/10;
 * - redes: Acerbi (28/09) pediu destaques "bem detalhadinho" e o ícone foi
 *   cortado em 80 caracteres no meio da frase; o agente só dizia "copie e cole".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AVISO_RESPOSTA_NAO_GUARDADA,
  ErroDaConversa,
  gravarPedidoAntes,
  gravarResposta,
  historicoParaOModelo,
  hojeParaOAgente,
  resumoDosCartoes,
  soltarPedido,
} from "../../supabase/functions/_shared/conversa-segura";
import { custoEstimadoDoContexto, normalizarAcoesDoContexto, pedeAcaoNoContexto } from "../../supabase/functions/agente-contexto/acoes-do-contexto";
import {
  acaoDaConversaDaCampanha,
  camposDaCampanhaNaConversa,
  dataValida,
  mudancasDaCampanha,
  patchParaVoltar,
  valorCurto,
} from "../../supabase/functions/agente-calendario/campanha-na-conversa";
import { pedidoParaRefazer as pedidoParaRefazerDoServidor } from "../../supabase/functions/agente-calendario/acoes-agenda";
import { pedidoParaRefazer } from "@/components/mesa/planoDoMes";
import { acaoDaBio, acaoDaOrdem, acaoDasCapas, CUSTO_DA_CAPA_USD, estiloPadraoDaCapa, gradeComApelido, ordemConferida, REGRAS_DAS_REDES } from "../../supabase/functions/mesa-instagram/acoes-das-redes";
import { destaquesLimpos, promptDaCapa } from "../../supabase/functions/_shared/conhecimento-perfil-instagram";
import { acaoDaAnalise, analiseDoModelo, CUSTO_DA_ANALISE_USD } from "../../supabase/functions/perfis-instagram/analises-na-conversa";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { aprendizadosDaMarca, aprendizadosDoPainel, chaveDoTexto, fonteDoAprendizado, gruposDosAprendizados } from "@/components/mesa/aprendizadosDoPainel";
import { chaveDoAprendizado } from "../../supabase/functions/_shared/cerebro-do-cliente";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

// ---------------------------------------------------------------- conversa que nunca perde a mensagem

function bancoDaConversa(falhas: { insert?: number } = {}) {
  const chamadas: Array<{ op: string; linha?: Record<string, unknown>; filtros?: Record<string, unknown> }> = [];
  let faltamFalhar = falhas.insert || 0;
  const from = () => {
    const filtros: Record<string, unknown> = {};
    let op = "select";
    let linha: Record<string, unknown> | undefined;
    const q: any = {
      insert: (l: Record<string, unknown>) => ((op = "insert"), (linha = l), q),
      delete: () => ((op = "delete"), q),
      select: () => q,
      single: () => q,
      eq: (c: string, v: unknown) => ((filtros[c] = v), q),
      then: (ok: (r: unknown) => unknown) => {
        chamadas.push({ op, linha, filtros: { ...filtros } });
        if (op === "insert" && faltamFalhar > 0) {
          faltamFalhar--;
          return Promise.resolve(ok({ data: null, error: { message: "null value in column \"anexos\"", code: "23502" } }));
        }
        return Promise.resolve(ok({ data: op === "insert" ? { id: `id-${chamadas.length}` } : null, error: null }));
      },
    };
    return q;
  };
  return { db: { from }, chamadas };
}

describe("conversa segura: a mensagem nunca some", () => {
  it("o pedido é gravado antes da IA, sempre com anexos (a coluna é NOT NULL)", async () => {
    const { db, chamadas } = bancoDaConversa();
    const p = await gravarPedidoAntes(db, { conversa_id: "cv", client_id: "c1", conteudo: "mude a paleta" });
    expect(p.id).toBe("id-1");
    expect(chamadas[0].linha).toMatchObject({ papel: "usuario", conteudo: "mude a paleta", anexos: [] });
  });

  it("se nem o pedido grava, o erro volta antes de gastar (a tela devolve o texto ao campo)", async () => {
    const { db } = bancoDaConversa({ insert: 1 });
    await expect(gravarPedidoAntes(db, { conversa_id: "cv", client_id: "c1", conteudo: "x" })).rejects.toBeInstanceOf(ErroDaConversa);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("a IA falhou: o pedido sai (reenvio não duplica)", async () => {
    const { db, chamadas } = bancoDaConversa();
    await soltarPedido(db, "p1", "c1");
    expect(chamadas[0]).toMatchObject({ op: "delete", filtros: { id: "p1", client_id: "c1", papel: "usuario" } });
  });

  it("a resposta tenta duas vezes; sem gravar, volta null e a tela avisa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const um = bancoDaConversa({ insert: 1 });
    expect(await gravarResposta(um.db, { conversa_id: "cv", client_id: "c1", conteudo: "ok", anexos: [{ tipo: "x" }], depoisDe: "2026-09-29T12:00:00.000Z" })).toBe("id-2");
    expect(um.chamadas[1].linha).toMatchObject({ papel: "agente", anexos: [{ tipo: "x" }] });
    const dois = bancoDaConversa({ insert: 2 });
    expect(await gravarResposta(dois.db, { conversa_id: "cv", client_id: "c1", conteudo: "ok" })).toBeNull();
    expect(AVISO_RESPOSTA_NAO_GUARDADA).toContain("não ficou guardada");
  });

  it("o histórico leva o estado dos cartões e os registros do painel, sem o pedido novo", () => {
    const h = historicoParaOModelo([
      { id: "a", papel: "usuario", conteudo: "refaça as 18 peças de outubro e novembro" },
      { id: "b", papel: "agente", conteudo: "Preparei a lista.", anexos: [{ tipo: "acao_agenda", resumo: "Refazer 18 peças", executada_em: "2026-09-29" }] },
      { id: "c", papel: "sistema", conteudo: "Agenda: 18 peças saíram para ser refeitas." },
      { id: "d", papel: "usuario", conteudo: "vamos afinar mais" },
    ], { excluir: "d" });
    expect(h).toHaveLength(2);
    expect(h[1].papel).toBe("agente");
    expect(h[1].conteudo).toContain("[Cartões desta resposta: Refazer 18 peças (feito)]");
    expect(h[1].conteudo).toContain("[Registro do painel depois: Agenda: 18 peças saíram para ser refeitas.]");
    expect(resumoDosCartoes([{ tipo: "acao_agente", resumo: "Trocar a logo", desfeita_em: "x", executada_em: "y" }])).toContain("(desfeito)");
    expect(resumoDosCartoes([{ tipo: "acao_agente", resumo: "Arquivar 3" }])).toContain("(esperando confirmação)");
  });

  it("hoje em São Paulo com o dia da semana (\"o de ontem\" parte daqui)", () => {
    const h = hojeParaOAgente(new Date("2026-09-29T15:00:00Z"));
    expect(h.data).toBe("2026-09-29");
    expect(h.texto).toContain("terça-feira, 29/09/2026");
    expect(h.texto).toContain("Ontem foi 28/09/2026");
    expect(hojeParaOAgente(new Date("2026-09-30T01:30:00Z")).data).toBe("2026-09-29");
  });

  it("as cinco funções gravam o pedido antes da IA e aprendem com ele", () => {
    const contexto = ler("supabase/functions/agente-contexto/index.ts");
    expect(contexto).toContain("const pedido = await gravarPedidoDoContexto(conversaId, clientId, mensagem);");
    expect(contexto).toContain(".catch(comPedidoSolto<Awaited<ReturnType<typeof chamarTexto>>>(pedido.id, clientId));");
    expect(contexto).not.toContain('{ conversa_id: conversaId, client_id: clientId, papel: "usuario", conteudo: mensagem, criado_em: new Date(agora).toISOString()');
    for (const f of ["mesa-instagram/index.ts", "perfis-instagram/index.ts"]) {
      const t = ler(`supabase/functions/${f}`);
      expect(t).toContain("await gravarPedidoAntes(servico(), {");
      expect(t).toContain("await soltarPedido(servico(), pedido.id,");
      expect(t).toContain("aprenderComOPedido(servico(), {");
    }
    const cal = ler("supabase/functions/agente-calendario/index.ts");
    expect(cal.match(/aprenderComOPedido\(servico, \{/g) || []).toHaveLength(3);
    expect(cal).toContain("lerRegrasDoDono(servico, clientId, { areas: [\"calendario\", \"campanha\", \"copy\"], marcaId: corpo.marca_id })");
  });
});

// ---------------------------------------------------------------- contexto: ler pendentes e montar pela conversa

describe("agente de contexto: ler pendentes e montar de novo", () => {
  const dados = { kit: { logo_path: "a.png", logo_alt_path: null }, referencias: [], fotos: [], nos: [], pendentes: 5, montado_em: "2026-09-20T10:00:00Z" };

  it("x1 lê as pendentes e x2 monta de novo, com o custo no cartão e nunca direto", () => {
    const acao = normalizarAcoesDoContexto({ resumo: "Ler e montar", itens: [{ operacao: "ler_referencias", ref: "x1", para: "" }, { operacao: "montar_contexto", ref: "x2", para: "" }] }, dados as any, "c1")!;
    expect(acao.itens.map((i) => i.operacao)).toEqual(["ler_referencias", "montar_contexto"]);
    expect(acao.custo_estimado_usd).toBe(custoEstimadoDoContexto(acao.itens, 5));
    expect(acao.custo_estimado_usd).toBeGreaterThan(0);
    expect(acao.sem_desfazer).toBeUndefined();
    expect(podeExecutarDireto(acao, {}, { pedidoClaro: true }).direto).toBe(false);
  });

  it("só ler: sem Desfazer; sem pendentes, a leitura é recusada com o motivo", () => {
    const so = normalizarAcoesDoContexto({ resumo: "", itens: [{ operacao: "ler_referencias", ref: "x1", para: "" }] }, dados as any, "c1")!;
    expect(so.sem_desfazer).toBe(true);
    const sem = normalizarAcoesDoContexto({ resumo: "", itens: [{ operacao: "ler_referencias", ref: "x1", para: "" }] }, { ...dados, pendentes: 0 } as any, "c1")!;
    expect(sem.itens).toHaveLength(0);
    expect(sem.recusados[0].motivo).toBe("Nenhuma referência pendente de leitura.");
    // Ler em referência r# não vale (só x1).
    expect(normalizarAcoesDoContexto({ resumo: "", itens: [{ operacao: "montar_contexto", ref: "k1", para: "" }] }, dados as any, "c1")).toBeNull();
  });

  it("pedidos de leitura e montagem trazem as listas para o agente", () => {
    for (const t of ["leia as referências pendentes", "monte o contexto de novo", "atualize o contexto com os documentos novos", "troque a logo"]) expect(pedeAcaoNoContexto(t)).toBe(true);
    expect(pedeAcaoNoContexto("qual o tom de voz?")).toBe(false);
  });

  it("montar guarda o kit de antes e o Desfazer volta para ele; a conversa e a confirmação têm fôlego", () => {
    const f = ler("supabase/functions/agente-contexto/index.ts");
    expect(f).toContain("kit_antes: { contexto: antes.contexto ?? null, paleta: antes.paleta ?? null, estilo: antes.estilo ?? null, regras: antes.regras ?? null");
    expect(f).toContain('if (r.operacao === "montar_contexto") {');
    expect(f).toContain("porVez: comIa ? 1 : emOrdem ? undefined : 6");
    expect(f).toContain('Promise.resolve(respostaComFolego(() => (corpo.modo === "plano" ? conversarNoPlano(ch, corpo) : conversar(ch, corpo))');
  });
});

// ---------------------------------------------------------------- Mês: o refazer segue as palavras do dono

describe("agente do Mês: o refazer leva o pedido do dono", () => {
  const PEDIDO = "Vamos apagar todos os conteúdos que já tem e trabalhar em conteúdos mais diretos, com menos texto, focando em jardinagem, manutenção e limpeza dos jardins, poda de árvores e segurança. Não vamos falar de paisagismo. ".repeat(3);
  const itens = [{ titulo: "Post estático | Não precisa resolver tudo", data: "2026-10-01", formato: "estático" }];

  it("a orientação cabe inteira (1200) na tela e no servidor", () => {
    const t = pedidoParaRefazer(itens, PEDIDO);
    expect(t).toContain("Orientação da equipe para todas: Vamos apagar todos");
    expect(t).toContain("Não vamos falar de paisagismo");
    expect(t.split("Orientação da equipe para todas: ")[1].length).toBeGreaterThan(400);
    expect(pedidoParaRefazerDoServidor(itens as any, PEDIDO)).toBe(t);
  });

  it("a ação na agenda guarda o pedido e a tela usa ele antes do resumo", () => {
    expect(ler("supabase/functions/agente-calendario/index.ts")).toContain("anexosDaResposta.push({ ...acaoNaAgenda, mes, pedido: mensagem.slice(0, 1500) });");
    expect(ler("src/components/mesa/AgenteDoMes.tsx")).toContain("pedidoParaRefazer(lotes[n], atual.pedido || atual.resumo)");
  });
});

// ---------------------------------------------------------------- campanha: muda de verdade, com antes e depois

describe("agente da campanha: período, situação e tipo mudam de verdade", () => {
  const atual = { id: "camp", nome: "Mouse está aqui", objetivo: null, conceito: "antigo", periodo_inicio: "2026-09-24", periodo_fim: "2026-10-15", status: "gravada", identidade: { tipo: "promocao", paleta_apoio: [] }, briefing: {} };

  it("\"roda até o dia 29\" vira periodo_fim conferido; fim antes do começo é recusado com o motivo", () => {
    expect(camposDaCampanhaNaConversa({ periodo_fim: "2026-09-29" }, atual).campos).toEqual({ periodo_fim: "2026-09-29" });
    const r = camposDaCampanhaNaConversa({ periodo_fim: "2026-09-20" }, atual);
    expect(r.campos).toEqual({});
    expect(r.recusas[0]).toContain("antes do começo");
    expect(camposDaCampanhaNaConversa({ periodo_fim: "2026-02-30", status: "pausada", tipo: "liquidacao" }, atual).recusas).toHaveLength(3);
    expect(camposDaCampanhaNaConversa({ status: "encerrada", tipo: "lancamento" }, atual).campos).toEqual({ status: "encerrada", tipo: "lancamento" });
    expect(dataValida("2026-09-31")).toBeNull();
  });

  it("o que mudou vira cartão já feito, com o antes para o Desfazer (nada calado)", () => {
    const depois = { ...atual, nome: "Oferta Stop", conceito: "novo", periodo_fim: "2026-09-29", identidade: { tipo: "promocao", paleta_apoio: [] } };
    const m = mudancasDaCampanha(atual, depois);
    expect(m.map((x) => x.campo)).toEqual(["nome", "conceito", "periodo_fim"]);
    const acao = acaoDaConversaDaCampanha({ id: "camp", nome: "Oferta Stop", client_id: "c1" }, m, { userId: "u1" })!;
    expect(acao).toMatchObject({ tipo: "acao_agente", agente: "mes", executada_direto: true, executada_por: "u1" });
    expect(acao.itens.find((i) => i.titulo === "Fim")).toMatchObject({ detalhe: "antes: 15/10/2026", para_rotulo: "29/09/2026" });
    expect(acao.resultados!.find((r) => r.titulo === "Fim")!.desfazer).toEqual({ campo: "periodo_fim", antes: "2026-10-15" });
    expect(acaoDaConversaDaCampanha({ id: "camp", nome: "x", client_id: "c1" }, [], { userId: "u1" })).toBeNull();
  });

  it("Desfazer volta campo a campo (o tipo mora em identidade.tipo)", () => {
    expect(patchParaVoltar("periodo_fim", "2026-10-15", null)).toEqual({ periodo_fim: "2026-10-15" });
    expect(patchParaVoltar("tipo", "promocao", { tipo: "lancamento", x: 1 })).toEqual({ identidade: { tipo: "promocao", x: 1 } });
    expect(patchParaVoltar("tipo", null, { tipo: "lancamento" })).toEqual({ identidade: {} });
    expect(() => patchParaVoltar("client_id", "x", null)).toThrow();
    expect(valorCurto("tipo", "promocao")).not.toBe("promocao");
  });

  it("a função e a tela ligam o cartão e o Desfazer da campanha", () => {
    const cal = ler("supabase/functions/agente-calendario/index.ts");
    expect(cal).toContain("...CAMPOS_DA_CAMPANHA_NA_CONVERSA,");
    expect(cal).toContain('if (x.operacao === "campanha_campo" || x.operacao === "campanha_conteudos") {');
    const tela = ler("src/components/mesa/CampanhaAgente.tsx");
    expect(tela).toContain('chamarAcaoDoAgente("agente-calendario", m.id, a.id, p)');
    expect(tela).toContain("useEstadoDaTela(`mesa:campanha:agente:rascunho:${campanha.id}`");
  });
});

// ---------------------------------------------------------------- redes: destaques ricos e ações do painel

describe("agente das redes: destaques detalhados e ações", () => {
  it("destaque guarda a direção da capa (até 400) e o que entra nele", () => {
    const longo = "Aperto de mãos entre duas pessoas empreendedoras, com uma loja local ao fundo, traço verde institucional e o amarelo da logo em um detalhe pequeno no canto.";
    const [d] = destaquesLimpos([{ nome: "Associe-se", icone: "aperto de mãos", conceito: longo, conteudo: "1. quem pode se associar; 2. benefícios; 3. como pedir." }]);
    expect(d.conceito).toBe(longo);
    expect(d.conteudo).toContain("benefícios");
    expect(promptDaCapa(d, { fundo: "#ffffff", desenho: "#006b38", traco: "linha" }, null)).toContain("Aperto de mãos entre duas pessoas");
  });

  it("ordem da grade: apelidos conferidos, esquecidos no fim, vai direto com Desfazer", () => {
    const grade = gradeComApelido([{ id: "a", titulo: "A", data: null }, { id: "b", titulo: "B", data: null }, { id: "c", titulo: "C", data: null }], ["a", "b", "c"]);
    const o = ordemConferida(["p3", "p1", "p9", "p1"], grade)!;
    expect(o.ids).toEqual(["c", "a", "b"]);
    expect(o.ignorados).toEqual(["p9", "p1"]);
    expect(ordemConferida(["p1", "p2", "p3"], grade)).toBeNull();
    const acao = acaoDaOrdem({ ids: o.ids, ignorados: [] }, grade);
    expect(acao.itens[0]).toMatchObject({ operacao: "ordenar_grade", para: "c,a,b" });
    expect(podeExecutarDireto(acao, REGRAS_DAS_REDES, { pedidoClaro: true }).direto).toBe(true);
  });

  it("capas: custo antes do Confirmar, cores só do kit; sem paleta, recusa com o motivo", () => {
    const paleta = [{ hex: "#f8f8f5", papel: "fundo" }, { hex: "#006b38", papel: "primaria" }];
    expect(estiloPadraoDaCapa(paleta)).toEqual({ fundo: "#f8f8f5", desenho: "#006b38", traco: "linha" });
    const destaques = destaquesLimpos([{ nome: "Sobre", icone: "prédio" }, { nome: "Contato", icone: "balão" }]);
    const acao = acaoDasCapas(destaques, paleta)!;
    expect(acao.custo_estimado_usd).toBeCloseTo(2 * CUSTO_DA_CAPA_USD, 5);
    expect(podeExecutarDireto(acao, REGRAS_DAS_REDES, { pedidoClaro: true }).direto).toBe(false);
    const sem = acaoDasCapas(destaques, [])!;
    expect(sem.itens).toHaveLength(0);
    expect(sem.recusados[0].motivo).toContain("sem cores no kit");
    expect(acaoDaBio("acerbi").sem_desfazer).toBe(true);
  });

  it("a função liga executar e desfazer das redes, e a tela mostra o cartão", () => {
    const f = ler("supabase/functions/mesa-instagram/index.ts");
    expect(f).toContain("executar_acao_agente: executarAcaoDasRedes,");
    expect(f).toContain("desfazer_acao_agente: desfazerAcaoDasRedes,");
    expect(f).toContain("required: [\"nome\", \"icone\", \"conceito\", \"conteudo\"]");
    const tela = ler("src/components/mesa/instagram/AgenteDoInstagram.tsx");
    expect(tela).toContain('chamarAcaoDoAgente("mesa-instagram", String(m.id), a.id, p,');
    expect(tela).toContain("Capa: {d.conceito}");
  });
});

// ---------------------------------------------------------------- perfil: análises pela conversa

describe("agente do perfil: ler, comparar, ideias e plano pela conversa", () => {
  it("cada análise vira cartão com custo, sem Desfazer (só lê e escreve na conversa)", () => {
    const acao = acaoDaAnalise("comparar", { id: "pf", handle: "concorrente" }, { mes: "2026-10" });
    expect(acao).toMatchObject({ agente: "perfis", sem_desfazer: true, custo_estimado_usd: CUSTO_DA_ANALISE_USD.comparar });
    expect(acao.itens[0]).toMatchObject({ operacao: "comparar", alvo_id: "pf" });
    expect(acao.contexto).toMatchObject({ mes: "2026-10" });
    expect(analiseDoModelo("nenhuma")).toBeNull();
    expect(analiseDoModelo("plano_igual")).toBe("plano_igual");
    const f = ler("supabase/functions/perfis-instagram/index.ts");
    expect(f).toContain("const r = await executarAnaliseDoPerfil(ch, acao, c, marcaId);");
  });
});

// ---------------------------------------------------------------- "O que o painel aprendeu"

describe("O que o painel aprendeu: por agente, marca e edição", () => {
  const linhas = [
    { id: "1", agente: "diretor_arte", texto: "Nunca usar fundo preto", categoria: "evitar", area: "arte", fonte: "agente_contexto", reforcos: 2, referencia_id: "m-cme" },
    { id: "2", agente: "estrategista", texto: "Sempre falar com o dono", categoria: "preferencia", area: "copy", fonte: "agente_do_mes" },
    { id: "3", agente: "estrategista", texto: "Evitar paisagismo", categoria: "evitar", area: "calendario", fonte: "agente_do_mes", referencia_id: "m-acerbi" },
    { id: "4", agente: "geral", texto: "Tom leve", tipo: "preferencia", origem: "manual" },
  ];

  it("pedido a um agente tem origem própria e o filtro mostra só esses", () => {
    expect(fonteDoAprendizado(linhas[0])).toBe("pedido");
    expect(aprendizadosDoPainel(linhas, "pedido").map((a) => a.id).sort()).toEqual(["1", "2", "3"]);
    const [a] = aprendizadosDoPainel([linhas[0]]);
    expect(a).toMatchObject({ agente: "diretor_arte", area: "arte", evitar: true, marca: "m-cme", origem: "agente de contexto" });
  });

  it("agrupa por agente (não fazer primeiro) e filtra pela marca", () => {
    const lista = aprendizadosDoPainel(linhas);
    const g = gruposDosAprendizados(lista);
    expect(g.map((x) => x.rotulo)).toEqual(["Todos os agentes", "Mês, campanhas e textos", "Arte e fotos"]);
    expect(g[1].itens[0].evitar).toBe(true);
    const daCme = aprendizadosDaMarca(lista, "m-cme", ["m-cme", "m-acerbi"]).map((x) => x.id).sort();
    expect(daCme).toEqual(["1", "2", "4"]);
    expect(aprendizadosDaMarca(lista, "todas", ["m-cme"]).length).toBe(4);
  });

  it("editar o texto recalcula a chave igual à do cérebro (a regra dita de novo continua virando reforço)", () => {
    for (const t of ["Nunca usar fundo preto nas artes!", "Evitar Paisagismo, só jardinagem"]) expect(chaveDoTexto(t)).toBe(chaveDoAprendizado(t));
    const tela = ler("src/components/mesa/ContextoAprendizados.tsx");
    expect(tela).toContain('update({ texto, chave: chaveDoTexto(texto) })');
    expect(tela).toContain('rotulo="Marca"');
  });
});

describe("a tela lê as regras das outras frentes também (mesmo cérebro)", () => {
  it("fonte das mesas de mídia e da Central conta como pedido, e a marca da evidência filtra", () => {
    const lista = aprendizadosDoPainel([
      { id: "a", agente: "diretor_arte", texto: "Nunca luz dura", categoria: "evitar", area: "foto", fonte: "mesa_foto", evidencia: 'marca:11111111-1111-4111-8111-111111111111 pedido: "x"' },
      { id: "b", agente: "geral", texto: "Sempre resumir em 3 linhas", categoria: "preferencia", area: "geral", fonte: "aprendeu:central" },
    ]);
    expect(lista.map((x) => x.fonte)).toEqual(["pedido", "pedido"]);
    expect(lista.find((x) => x.id === "a")).toMatchObject({ marca: "11111111-1111-4111-8111-111111111111", origem: "Mesa Foto" });
    expect(aprendizadosDaMarca(lista, "22222222-2222-4222-8222-222222222222", ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]).map((x) => x.id)).toEqual(["b"]);
  });
});
