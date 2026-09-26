import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conhecimentoAdsPara,
  conhecimentoCalendarioPara,
  conhecimentoContexto,
  conhecimentoEstudioPara,
  conhecimentoMesaFoto,
  montarComTeto,
  PRIORIDADE_DAS_BASES,
  TAREFAS_ADS,
  TETO_ADS,
  TETO_CALENDARIO,
  TETO_CALENDARIO_POR_MOMENTO,
  TETO_CONTEXTO,
  TETO_ESTUDIO,
  TETO_MESA_FOTO,
} from "../../supabase/functions/_shared/conhecimento-dos-agentes";
import {
  CONHECIMENTO_AGRESSIVO,
  CONHECIMENTO_ESTRATEGISTA_ADS,
  CONHECIMENTO_OFERTA,
  NIVEIS_RISCO_POLITICA,
  POLITICAS_META,
  REGRAS_DE_HONESTIDADE,
} from "../../supabase/functions/_shared/conhecimento-ads";
import { CONHECIMENTO_DIRETOR } from "../../supabase/functions/_shared/conhecimento-design";
import { BASE_DO_ESTRATEGISTA } from "../../supabase/functions/_shared/conhecimento-conteudo";
import {
  ANTI_GENERICO,
  CALENDARIO_EDITORIAL,
  CTA_PRINCIPIOS,
  IDENTIDADE_DE_MARCA,
  PLANO_DE_CAMPANHA,
  ROTEIRO_DE_VIDEO,
  VOZ_DE_MARCA,
} from "../../supabase/functions/_shared/conhecimento-marketing";
import {
  CHECKLIST_CRIATIVO_POR_OBJETIVO,
  CRIATIVO_NATALIA,
  ESTRUTURA_DE_CONTA,
  GANCHOS_DOS_ESPECIALISTAS,
  ORCAMENTO_INICIAL,
  PLANO_DE_TESTE,
  REGRAS_DE_CORTE_E_ESCALA,
} from "../../supabase/functions/_shared/conhecimento-especialistas-ads";

/**
 * Frente H (25/09/2026): monta o sistema de cada agente com o conhecimento
 * novo e confere o teto combinado (docs/conhecimento/COMO-INTEGRAR.md) e que
 * as regras antigas continuam lá.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const constante = (fonte: string, nome: string) => {
  const m = new RegExp(`const ${nome} = \`([\\s\\S]*?)\`;`).exec(fonte);
  expect(m, `const ${nome}`).not.toBeNull();
  return m![1];
};
const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const fins = ["\nasync function ", "\nfunction ", "\nconst ", "\nexport "].map((s) => texto.indexOf(s, i + 10)).filter((x) => x > 0);
  return texto.slice(i, Math.min(...fins));
};

const ads = ler("supabase/functions/mesa-ads/index.ts");
const calendario = ler("supabase/functions/agente-calendario/index.ts");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const foto = ler("supabase/functions/mesa-foto/index.ts");
const contexto = ler("supabase/functions/agente-contexto/index.ts");

const OBJETIVOS = [undefined, ...Object.keys(CHECKLIST_CRIATIVO_POR_OBJETIVO)];

describe("montarComTeto: blocos inteiros e ordem de corte", () => {
  it("tira o de menor corte primeiro e nunca corta no meio", () => {
    const blocos = [
      { id: "a", texto: "A".repeat(100), corte: 3 },
      { id: "b", texto: "B".repeat(100), corte: 1 },
      { id: "c", texto: "C".repeat(100), corte: 2 },
    ];
    const m = montarComTeto(blocos, 210, "");
    expect(m.ids).toEqual(["a", "c"]);
    expect(m.cortados).toEqual(["b"]);
    expect(m.texto).toBe(`${"A".repeat(100)}\n\n${"C".repeat(100)}`);
    expect(m.tamanho).toBeLessThanOrEqual(210);
  });

  it("com a frase de prioridade no começo e fora do teto", () => {
    const m = montarComTeto([{ id: "a", texto: "texto", corte: 1 }], 10);
    expect(m.texto.startsWith(PRIORIDADE_DAS_BASES)).toBe(true);
    expect(m.tamanho).toBe(5);
    expect(montarComTeto([{ id: "a", texto: "longo demais", corte: 1 }], 3).texto).toBe("");
  });

  it("a frase de prioridade segue a ordem do COMO-INTEGRAR", () => {
    const i = (s: string) => PRIORIDADE_DAS_BASES.indexOf(s);
    expect(i("dado real do cliente")).toBeGreaterThan(0);
    expect(i("dado real do cliente")).toBeLessThan(i("base principal deste agente"));
    expect(i("base principal deste agente")).toBeLessThan(i("Pedro Sobral e Natália Torres"));
    expect(i("Pedro Sobral e Natália Torres")).toBeLessThan(i("base de marketing"));
  });
});

describe("Mesa Ads: especialistas e marketing por tarefa, com teto", () => {
  const REGRAS_DA_EXECUCAO = constante(ads, "REGRAS_DA_EXECUCAO");
  const antes = `${CONHECIMENTO_ESTRATEGISTA_ADS}\n\n${REGRAS_DA_EXECUCAO}`;

  it("cada tarefa, com e sem objetivo, cabe no teto e o sistema inteiro fica perto dos 57.500 caracteres (Frente W)", () => {
    for (const tarefa of TAREFAS_ADS) {
      for (const objetivo of OBJETIVOS) {
        const k = conhecimentoAdsPara(tarefa, { objetivo });
        expect(k.tamanho, `${tarefa}/${objetivo}`).toBeLessThanOrEqual(TETO_ADS[tarefa]);
        const sistema = `${CONHECIMENTO_ESTRATEGISTA_ADS}\n\n${k.texto}\n\n${REGRAS_DA_EXECUCAO}`;
        expect(sistema.length, `${tarefa}/${objetivo}`).toBeLessThanOrEqual(58_000);
        // Regras antigas: a base inteira primeiro, as regras da execução por último.
        expect(sistema.startsWith(CONHECIMENTO_ESTRATEGISTA_ADS)).toBe(true);
        expect(sistema.endsWith(REGRAS_DA_EXECUCAO)).toBe(true);
        for (const regra of [POLITICAS_META, REGRAS_DE_HONESTIDADE, CONHECIMENTO_OFERTA, CONHECIMENTO_AGRESSIVO]) expect(sistema).toContain(regra);
        expect(sistema.length).toBeGreaterThan(antes.length);
      }
    }
  });

  it("ângulos levam Sobral e Natália; conta leva corte, escala e estrutura; pacote leva teste e orçamento; oferta leva objeções e CTA", () => {
    const angulos = conhecimentoAdsPara("angulos", { objetivo: "mensagens" }).texto;
    for (const b of [GANCHOS_DOS_ESPECIALISTAS, CRIATIVO_NATALIA, ESTRUTURA_DE_CONTA, PLANO_DE_TESTE, REGRAS_DE_CORTE_E_ESCALA, ANTI_GENERICO, CHECKLIST_CRIATIVO_POR_OBJETIVO.mensagens]) {
      expect(angulos).toContain(b);
    }
    const conta = conhecimentoAdsPara("conta").texto;
    for (const b of [REGRAS_DE_CORTE_E_ESCALA, ESTRUTURA_DE_CONTA]) expect(conta).toContain(b);
    expect(conta).not.toContain(CRIATIVO_NATALIA);
    const pacote = conhecimentoAdsPara("pacote", { objetivo: { id: "vendas" } }).texto;
    for (const b of [PLANO_DE_TESTE, ORCAMENTO_INICIAL, CHECKLIST_CRIATIVO_POR_OBJETIVO.vendas]) expect(pacote).toContain(b);
    const oferta = conhecimentoAdsPara("oferta", { objetivo: "vendas" }).texto;
    expect(oferta).toContain(CTA_PRINCIPIOS);
    expect(oferta).not.toContain("CHECKLIST DE CRIATIVO");
    // A Mesa Ads só faz peça estática: o roteiro de vídeo não entra.
    for (const t of TAREFAS_ADS) expect(conhecimentoAdsPara(t).texto).not.toContain(ROTEIRO_DE_VIDEO);
    // Objetivo desconhecido não quebra nem inventa checklist.
    expect(conhecimentoAdsPara("copy", { objetivo: "qualquer" }).ids.some((id) => id.startsWith("checklist_"))).toBe(false);
  });

  it("toda chamada do estrategista passa a tarefa; o sistema mantém base, regras da execução e o Jev 0 a 10 com 10 sem risco", () => {
    const corpo = corpoDe(ads, "sistemaDoEstrategista");
    expect(corpo).toContain("conhecimentoAdsPara(tarefa, { objetivo })");
    expect(corpo).toContain("${CONHECIMENTO_ESTRATEGISTA_ADS}\\n\\n${extra}\\n\\n${REGRAS_DA_EXECUCAO}");
    expect(ads).not.toContain("sistemaDoEstrategista()");
    expect(ads.match(/sistema: sistemaDoEstrategista\("(angulos|copy|pacote|oferta|conta)"/g)?.length).toBeGreaterThanOrEqual(14);
    expect(ads).toContain('sistemaDoEstrategista("conta")');
    expect(ads).toContain('sistemaDoEstrategista("pacote", ctx.objetivo)');
    expect(ads).toContain("em risco_politica, 10 = sem risco");
    expect(NIVEIS_RISCO_POLITICA.length).toBeGreaterThan(0);
    for (const r of ["política de anúncios da Meta", "sem travessões", "Nunca invente depoimento"]) expect(REGRAS_DA_EXECUCAO).toContain(r);
  });

  it("o contexto usa o resumo do cérebro (ads, conta, copy) e só volta à lista crua se o cérebro falhar", () => {
    const corpo = corpoDe(ads, "montarContextoAds");
    expect(corpo).toContain('resumoDoCerebro(servico, clientId, ["ads", "conta", "copy"], { limite: 2000 })');
    expect(corpo).toContain("c.falhou ? { memoria_do_estrategista_ads: memoria.data ?? [] } : { cerebro_do_cliente: c.texto || null }");
    expect(corpo).toContain("aprendizados_registrados: aprendizados.data ?? []");
  });
});

describe("Calendário e campanhas: marketing por momento e cérebro", () => {
  const REGRAS_DE_SAIDA = constante(calendario, "REGRAS_DE_SAIDA");

  it("cada momento cabe no seu teto (campanha em 7.500) e soma à base do estrategista sem vídeo", () => {
    expect(TETO_CALENDARIO_POR_MOMENTO.campanha).toBe(TETO_CALENDARIO);
    for (const m of ["mes", "campanha", "temas", "diagnostico"] as const) {
      const k = conhecimentoCalendarioPara(m);
      expect(k.tamanho, m).toBeLessThanOrEqual(TETO_CALENDARIO_POR_MOMENTO[m]);
      expect(k.cortados.filter((id) => id !== "estruturas_de_conteudo" && id !== "calendario_editorial"), m).toEqual([]);
      expect(k.texto).not.toContain(ROTEIRO_DE_VIDEO);
      expect(k.texto).toContain(ANTI_GENERICO);
      if (m !== "diagnostico") expect(k.texto).toContain(VOZ_DE_MARCA);
      // Base de técnica (no prompt do banco) + conhecimento + regras de saída.
      expect(BASE_DO_ESTRATEGISTA.length + k.texto.length + REGRAS_DE_SAIDA.length, m).toBeLessThanOrEqual(TETO_CALENDARIO_POR_MOMENTO[m] + 3_500);
    }
    expect(conhecimentoCalendarioPara("mes").texto).toContain(CALENDARIO_EDITORIAL);
    expect(conhecimentoCalendarioPara("temas").texto).toContain(CALENDARIO_EDITORIAL);
    expect(conhecimentoCalendarioPara("campanha").texto).toContain(PLANO_DE_CAMPANHA);
  });

  it("o sistema mantém o prompt do banco primeiro e as regras de saída por último, em todas as ações", () => {
    expect(corpoDe(calendario, "sistemaDoCalendario")).toContain("return `${ctx.prompt}\\n\\n${CONHECIMENTO_DO_CALENDARIO[momento]}\\n${REGRAS_DE_SAIDA}`;");
    expect(calendario).not.toContain("sistema: `${ctx.prompt}\\n${REGRAS_DE_SAIDA}`");
    // Frente O: as três frentes do propor_temas usam "temas" e a pesquisa do mês usa "diagnostico".
    expect(calendario.match(/sistema: sistemaDoCalendario\(ctx, "mes"\)/g)?.length).toBe(7);
    expect(calendario.match(/sistema: sistemaDoCalendario\(ctx, "temas"\)/g)?.length).toBe(1);
    expect(calendario.match(/sistema: sistemaDoCalendario\(e\.ctx, "diagnostico"\)/g)?.length).toBe(1);
    expect(calendario.match(/sistema: sistemaDoCalendario\(ctx, "campanha"\)/g)?.length).toBe(3);
    for (const r of ["somente carrossel ou post estático", "Nunca reels, vídeo, stories ou live", "segunda a sexta", "sem travessões", "tipo_editorial e framework"]) expect(REGRAS_DE_SAIDA).toContain(r);
    expect(calendario).toContain("${BASE_DO_ESTRATEGISTA}");
  });

  it("o cérebro entra no lugar da lista crua, sem o plano do mês", () => {
    expect(calendario).toContain('resumoDoCerebro(servico, clientId, ["calendario", "campanha", "copy"], { limite: 2000, manter: (f) => !mesDoPlano(f.texto) })');
    expect(corpoDe(calendario, "contextoEmTexto")).toContain("ctx.cerebro === null ? { memoria_do_estrategista: ctx.memoria } : { cerebro_do_cliente: ctx.cerebro || null }");
    expect(corpoDe(calendario, "contextoEmTexto")).toContain("planos_combinados_com_a_equipe: ctx.planos");
  });
});

describe("Estúdio: marketing do diretor, legenda, cérebro e dossiê", () => {
  it("direção e legenda cabem no teto e o sistema do diretor fica abaixo de 52.500 sem o prompt do banco", () => {
    const d = conhecimentoEstudioPara("direcao");
    const l = conhecimentoEstudioPara("legenda");
    expect(d.tamanho).toBeLessThanOrEqual(TETO_ESTUDIO.direcao);
    expect(l.tamanho).toBeLessThanOrEqual(TETO_ESTUDIO.legenda);
    const INSTRUCOES_DIRECAO = constante(estudio, "INSTRUCOES_DIRECAO");
    // Antes: base de design (39.760) + instruções (cerca de 6.150). Depois: mais o marketing (até 6.700 com a imagem e título da Frente W) e a frase de prioridade.
    expect(CONHECIMENTO_DIRETOR.length + d.texto.length + INSTRUCOES_DIRECAO.length).toBeLessThanOrEqual(53_300);
    // Frente W: a legenda ganhou a revisão em sete passadas (copy-editing).
    expect(l.texto.length + constante(estudio, "INSTRUCOES_LEGENDA").length).toBeLessThanOrEqual(6_400);
  });

  it("a base de design continua primeiro; marketing logo depois; cérebro e dossiê no fim", () => {
    expect(estudio).toContain("sistema: [CONHECIMENTO_DIRETOR, CONHECIMENTO_DA_DIRECAO, prompt, INSTRUCOES_DIRECAO, preferencias.texto].filter(Boolean).join(\"\\n\\n\"),");
    expect(estudio).toContain("sistema: `${CONHECIMENTO_DA_LEGENDA}\\n\\n${prompt}\\n\\n${INSTRUCOES_LEGENDA}`,");
    expect(estudio).toContain("cerebroEDossieDoDiretor(clientId).catch(() => ({ texto: \"\", usouCerebro: false })),");
    const conversa = estudio.slice(estudio.indexOf("  const sistema = [\n    CONHECIMENTO_DIRETOR,"), estudio.indexOf('].filter(Boolean).join("\\n\\n");', estudio.indexOf("  const sistema = [\n    CONHECIMENTO_DIRETOR,")));
    for (const p of ["CONHECIMENTO_DIRETOR", "CONHECIMENTO_DA_DIRECAO", "prompt", "POLITICAS_META", "INSTRUCOES_CONVERSA", "doDiretor.texto"]) expect(conversa, p).toContain(p);
    const c = corpoDe(estudio, "cerebroEDossieDoDiretor");
    expect(c).toContain('contextoParaAgente(servico(), clientId, "arte", {');
    expect(c).toContain("areas: AREAS_DO_AGENTE.diretor_arte,");
    expect(c).toContain("limiteDossie: 3000,");
    // PADRAO_NA_IMAGEM (texto ao gerador) não recebe marketing.
    expect(estudio).toContain("sistema: [INSTRUCOES_AJUSTE, PADRAO_NA_IMAGEM, preferencias].filter(Boolean).join(\"\\n\\n\"),");
  });
});

describe("Mesa Foto: marca e criativo no agente e na campanha, cérebro na área foto", () => {
  it("cabe em 5.000 e só o agente e a campanha recebem", () => {
    const k = conhecimentoMesaFoto();
    expect(k.tamanho).toBeLessThanOrEqual(TETO_MESA_FOTO);
    for (const b of [ANTI_GENERICO, IDENTIDADE_DE_MARCA, CRIATIVO_NATALIA]) expect(k.texto).toContain(b);
    for (const s of ["SISTEMA_AGENTE", "SISTEMA_CAMPANHA"]) {
      const corpo = constante(foto, s);
      expect(corpo, s).toContain("${PADRAO_PUBLICITARIO}\n${REGRAS_DA_CASA}\n${CONHECIMENTO_DA_FOTO}\nResponda só com o JSON pedido.");
      expect(corpo.length + k.texto.length, s).toBeLessThanOrEqual(10_000);
    }
    for (const s of ["SISTEMA_LEITOR", "SISTEMA_KITS", "SISTEMA_CONFERENCIA", "SISTEMA_IDENTIFICAR", "SISTEMA_DIRETOR", "SISTEMA_VARIACOES"]) {
      expect(constante(foto, s), s).not.toContain("CONHECIMENTO_DA_FOTO");
    }
    expect(foto).toContain("Nunca escurecer a foto para dar destaque");
  });

  it("o contexto do diretor usa o resumo do cérebro (foto e arte) e só volta à lista crua se falhar", () => {
    expect(foto).toContain('resumoDoCerebro(servico(), clientId, ["foto", "arte"], { limite: 1500 })');
    expect(foto).toContain("c.falhou ? { memoria_do_diretor: memoria.data ?? [] } : { cerebro_do_cliente: c.texto || null }");
  });
});

describe("Agente de contexto: voz, posicionamento, objeções e identidade", () => {
  it("cabe em 6.500 e entra em montar e conversar", () => {
    const k = conhecimentoContexto();
    expect(k.tamanho).toBeLessThanOrEqual(TETO_CONTEXTO);
    expect(k.texto).toContain(VOZ_DE_MARCA);
    expect(contexto).toContain("sistema: `${SISTEMA_CONTEXTO}\\n\\n${CONHECIMENTO_DO_CONTEXTO}`,");
    expect(contexto).toContain("sistema: `${SISTEMA_CONVERSA}\\n\\n${CONHECIMENTO_DO_CONTEXTO}\\n\\nCONTEXTO ATUAL (JSON):\\n${JSON.stringify(estado)}${dadosDasAcoes");
    expect(contexto).toContain("sistema: SISTEMA_LEITURA,");
    expect(contexto).toContain("sistema: SISTEMA_ACERVO,");
  });
});

describe("Gravação pelo cérebro (dedup, reforço, validade) no lugar dos inserts soltos", () => {
  it("ajuste e conversa do Estúdio, aprendizado da Mesa Ads e conversa do contexto usam gravarNoCerebro", () => {
    const ajuste = corpoDe(estudio, "ajustarCard");
    expect(ajuste).toContain("if (!auto) await gravarNoCerebro(servico(), {");
    expect(ajuste).toContain('categoria: "ajuste",');
    expect(ajuste).not.toContain('from("agente_memoria").insert(');
    expect(estudio).toContain('fonte: "estudio_conversa",');
    expect(estudio).not.toContain('from("agente_memoria").insert(');
    const aprendizado = corpoDe(ads, "aprendizadoRegistrar");
    expect(aprendizado).toContain("await gravarNoCerebro(servico, {");
    expect(aprendizado).toContain('categoria: "performou",');
    expect(aprendizado).not.toContain('from("agente_memoria").insert(');
    expect(contexto).toContain("await gravarNoCerebro(db, {");
    expect(contexto).not.toContain('from("agente_memoria").insert(');
  });

  it("o helper nunca derruba a mesa e usa o Jev só como juiz", () => {
    const h = ler("supabase/functions/_shared/cerebro-nas-mesas.ts");
    expect(h).toContain("registrarAprendizado(db, novo, { julgar })");
    expect(h).toContain("return { gravada: false, situacao: null");
    expect(h).toContain("timeoutMs: TIMEOUT_JEV_DO_CEREBRO_MS");
  });
});

describe("texto novo sem travessão", () => {
  it("nenhum bloco montado tem travessão", () => {
    const todos = [
      ...TAREFAS_ADS.flatMap((t) => OBJETIVOS.map((o) => conhecimentoAdsPara(t, { objetivo: o }).texto)),
      conhecimentoCalendarioPara("mes").texto,
      conhecimentoCalendarioPara("campanha").texto,
      conhecimentoEstudioPara("direcao").texto,
      conhecimentoEstudioPara("legenda").texto,
      conhecimentoMesaFoto().texto,
      conhecimentoContexto().texto,
    ];
    for (const t of todos) expect(t).not.toMatch(/[—–]/);
    expect(ler("supabase/functions/_shared/conhecimento-dos-agentes.ts")).not.toMatch(/[—–]/);
    expect(ler("supabase/functions/_shared/cerebro-nas-mesas.ts")).not.toMatch(/[—–]/);
  });
});
