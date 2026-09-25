import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALCANCE_E_CONVERSAO,
  CARROSSEL_DE_RETENCAO,
  CHECKLIST_SALVA_E_ENVIA,
  DATAS_E_OPORTUNIDADES,
  datasDoPeriodo,
  datasMoveis,
  GANCHOS_POR_TIPO,
  MISTURA_DO_MES,
  pascoa,
  pautasDePesquisa,
  SINAIS_DO_ALGORITMO,
  SINAIS_PARA_MEDIR,
} from "../../supabase/functions/_shared/conhecimento-social";
import {
  diagnosticoDasFrentes,
  ESQUEMA_DIAGNOSTICO,
  GRACA_DO_DIAGNOSTICO_MS,
  misturaDosTemas,
  normalizarDiagnostico,
  pedidoDoDiagnostico,
  porFormato,
  primeirasFrases,
  textoCurtoDoDiagnostico,
  urlsDoTexto,
} from "../../supabase/functions/agente-calendario/diagnostico";
import { conhecimentoCalendarioPara } from "../../supabase/functions/_shared/conhecimento-dos-agentes";

/**
 * Inteligência do Mês (Frente O, 26/09/2026): base de social media, datas do
 * Brasil calculadas, pesquisa do mês em paralelo e diagnóstico estruturado.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/agente-calendario/index.ts");
const TRAVESSAO = /[\u2014\u2013]/;

function corpoDe(nome: string): string {
  const ini = fonte.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = fonte.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst ACOES/);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

describe("base de social media (conhecimento-social.ts)", () => {
  const blocos = { SINAIS_DO_ALGORITMO, GANCHOS_POR_TIPO, CARROSSEL_DE_RETENCAO, CHECKLIST_SALVA_E_ENVIA, MISTURA_DO_MES, ALCANCE_E_CONVERSAO, SINAIS_PARA_MEDIR, DATAS_E_OPORTUNIDADES };

  it("blocos curtos, sem travessão e sem mandar fazer vídeo no calendário", () => {
    for (const [nome, t] of Object.entries(blocos)) {
      expect(t.length, nome).toBeGreaterThan(400);
      expect(t.length, nome).toBeLessThan(2000);
      expect(TRAVESSAO.test(t), nome).toBe(false);
      expect(t, nome).not.toMatch(/\b(poste|faça|grave) (um )?(reels|vídeo)/i);
    }
    expect(SINAIS_DO_ALGORITMO).toContain("envios por alcance");
    expect(SINAIS_DO_ALGORITMO).toContain("5 por post");
    expect(CARROSSEL_DE_RETENCAO).toContain("Lâmina 2 é o segundo gancho");
    expect(MISTURA_DO_MES).toContain("topo 50%, meio 30%, fundo 20%");
  });

  it("datas móveis certas (Páscoa, Carnaval, Mães, Pais, Black Friday)", () => {
    expect(pascoa(2026)).toBe("2026-04-05");
    expect(pascoa(2027)).toBe("2027-03-28");
    const m = Object.fromEntries(datasMoveis(2026).map((d) => [d.nome, d.data]));
    expect(m["Carnaval"]).toBe("2026-02-17");
    expect(m["Corpus Christi"]).toBe("2026-06-04");
    expect(m["Dia das Mães"]).toBe("2026-05-10");
    expect(m["Dia dos Pais"]).toBe("2026-08-09");
    expect(m["Black Friday"]).toBe("2026-11-27");
  });

  it("datas do período em ordem, com antecedência e aviso de fim de semana", () => {
    const out = datasDoPeriodo("2026-10-01", "2026-10-31");
    expect(out.map((d) => d.data)).toEqual(out.map((d) => d.data).slice().sort());
    expect(out.some((d) => d.nome.indexOf("Dia das Crianças") === 0 && d.data === "2026-10-12")).toBe(true);
    expect(out.some((d) => d.nome.indexOf("Outubro Rosa") === 0)).toBe(true);
    const medico = out.find((d) => d.nome === "Dia do Médico");
    expect(medico?.dica).toContain("sexta anterior");
    // Até 21 dias depois: Novembro Azul e Finados entram para preparar.
    expect(out.some((d) => d.nome.indexOf("Novembro Azul") === 0 && (d.dica ?? "").indexOf("preparar dentro dele") >= 0)).toBe(true);
    expect(out.every((d) => d.data <= "2026-11-21")).toBe(true);
    // Virada de ano e entrada inválida.
    expect(datasDoPeriodo("2026-12-15", "2026-12-31").some((d) => d.data === "2027-01-01")).toBe(true);
    expect(datasDoPeriodo("2026-12-31", "2026-12-01")).toEqual([]);
    expect(datasDoPeriodo("x", "2026-12-01")).toEqual([]);
  });

  it("pautas dirigidas ao nicho, à região, ao mês e às datas", () => {
    const pautas = pautasDePesquisa({ inicio: "2026-10-01", regiao: "Curitiba", oferta: "banho e tosa", datas: datasDoPeriodo("2026-10-01", "2026-10-31") });
    expect(pautas[0]).toBe("tendências e assuntos em alta de [nicho] em Curitiba em outubro de 2026");
    expect(pautas.some((p) => p.indexOf("concorrentes") >= 0)).toBe(true);
    expect(pautas.some((p) => p.indexOf("Dia das Crianças") >= 0)).toBe(true);
    expect(pautas[pautas.length - 1]).toContain("banho e tosa");
    expect(pautasDePesquisa({ inicio: "2026-03-01" })[0]).toContain("no Brasil em março de 2026");
  });
});

describe("conhecimento do calendário por momento", () => {
  it("temas e diagnóstico levam a base nova; o mês ganha ganchos, carrossel e checklist", () => {
    const temas = conhecimentoCalendarioPara("temas").texto;
    for (const b of [MISTURA_DO_MES, DATAS_E_OPORTUNIDADES, GANCHOS_POR_TIPO, ALCANCE_E_CONVERSAO]) expect(temas).toContain(b);
    const diag = conhecimentoCalendarioPara("diagnostico").texto;
    for (const b of [SINAIS_DO_ALGORITMO, SINAIS_PARA_MEDIR, ALCANCE_E_CONVERSAO, MISTURA_DO_MES]) expect(diag).toContain(b);
    const mes = conhecimentoCalendarioPara("mes").texto;
    for (const b of [GANCHOS_POR_TIPO, CARROSSEL_DE_RETENCAO, CHECKLIST_SALVA_E_ENVIA]) expect(mes).toContain(b);
    expect(conhecimentoCalendarioPara("campanha").texto).not.toContain(GANCHOS_POR_TIPO);
  });
});

describe("diagnóstico estruturado (agente-calendario/diagnostico.ts)", () => {
  const bruto = {
    resumo: "Carrossel de lista salva 3 vezes a média \u2014 foco do mês é Dia das Crianças.",
    o_que_funciona: [{ ponto: "Carrossel de lista", evidencia: "salvos 3x a média" }, { ponto: "Carrossel de lista", evidencia: "repetido" }],
    o_que_nao_funciona: [{ ponto: "", evidencia: "vazio sai" }],
    oportunidades_do_mes: [
      { data: "2026-10-09", tema: "Presentes", por_que: "Dia das Crianças" },
      { data: "12/10", tema: "Data em formato errado vira null", por_que: "" },
      { data: "2026-10-01", tema: "Outubro Rosa", por_que: "mês" },
    ],
    tendencias_do_nicho: [{ tendencia: "Bastidor", como_usar: "série", fonte: "https://a.com/x" }, { tendencia: "Sem fonte", como_usar: "", fonte: "sem link" }],
    recomendacoes: [
      { acao: "Baixa", por_que: "", prioridade: "baixa" },
      { acao: "Alta", por_que: "", prioridade: "alta" },
      { acao: "Sem prioridade", por_que: "", prioridade: "urgente" },
    ],
    mistura_sugerida: { topo: 2, meio: 2, fundo: 1, justificativa: "x" },
    sinais_para_medir: ["Envios por alcance"],
    limites: ["Sem dado de vendas"],
    fontes: [{ titulo: "Estudo", url: "https://b.com/y" }, { titulo: "Ruim", url: "javascript:x" }],
  };

  it("o esquema é estrito e pede os campos combinados", () => {
    const s = ESQUEMA_DIAGNOSTICO.schema as { required: string[]; additionalProperties: boolean };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["resumo", "o_que_funciona", "o_que_nao_funciona", "oportunidades_do_mes", "tendencias_do_nicho", "recomendacoes", "mistura_sugerida", "sinais_para_medir", "limites", "fontes"]);
  });

  it("normaliza: sem travessão, sem repetido, datas válidas em ordem, prioridade em ordem, mistura soma 100 e só links http", () => {
    const d = normalizarDiagnostico(bruto, { fontesExtras: ["https://c.com/z", "ruim"], agora: new Date("2026-09-26T12:00:00Z") })!;
    expect(d.origem).toBe("pesquisa");
    expect(TRAVESSAO.test(d.resumo)).toBe(false);
    expect(d.o_que_funciona).toHaveLength(1);
    expect(d.o_que_nao_funciona).toEqual([]);
    expect(d.oportunidades_do_mes.map((o) => o.data)).toEqual(["2026-10-01", "2026-10-09", null]);
    expect(d.recomendacoes.map((r) => r.prioridade)).toEqual(["alta", "media", "baixa"]);
    expect(d.mistura_sugerida).toEqual({ topo: 40, meio: 40, fundo: 20, justificativa: "x" });
    expect(d.tendencias_do_nicho[1].fonte).toBeNull();
    expect(d.fontes.map((f) => f.url)).toEqual(["https://b.com/y", "https://a.com/x", "https://c.com/z"]);
    expect(normalizarDiagnostico({ resumo: "  " })).toBeNull();
    expect(normalizarDiagnostico(null)).toBeNull();
  });

  it("texto curto para compatibilidade: resumo primeiro, blocos em linhas e teto", () => {
    const d = normalizarDiagnostico(bruto)!;
    const t = textoCurtoDoDiagnostico(d, { publicos: ["mães"], pilares: ["educação", "oferta"] });
    expect(t.indexOf(d.resumo)).toBe(0);
    expect(t).toContain("Oportunidades: 01/10 Outubro Rosa; 09/10 Presentes");
    expect(t).toContain("Mistura sugerida: topo 40%, meio 40%, fundo 20%.");
    expect(t).toContain("Pilares: educação; oferta.");
    expect(t.length).toBeLessThanOrEqual(2800);
    expect(textoCurtoDoDiagnostico(d, {}, 120).length).toBeLessThanOrEqual(120);
  });

  it("reserva das frentes: resumo, oportunidades dos temas sazonais, mistura real e links", () => {
    const temas = [
      { fase: "1", tema: "A", sazonal: false },
      { fase: "1", tema: "B", sazonal: true, data_sazonal: "2026-10-12", por_que: "Dia das Crianças" },
      { fase: "2", tema: "C" },
      { fase: "3", tema: "D" },
    ];
    const d = diagnosticoDasFrentes({ textoFase1: "Primeira frase. Segunda frase. Terceira.", temas, pesquisas: ["veja https://x.com/a, e https://x.com/a."], hipoteses: ["sem vendas"], motivo: "A pesquisa do mês falhou." })!;
    expect(d.origem).toBe("frentes");
    expect(d.resumo).toBe("Primeira frase. Segunda frase.");
    expect(d.oportunidades_do_mes).toEqual([{ data: "2026-10-12", tema: "B", por_que: "Dia das Crianças" }]);
    expect(d.mistura_sugerida?.topo).toBe(50);
    expect(d.fontes.map((f) => f.url)).toEqual(["https://x.com/a"]);
    expect(d.limites[0]).toBe("A pesquisa do mês falhou.");
    expect(diagnosticoDasFrentes({ textoFase1: "", temas, pesquisas: [], hipoteses: [], motivo: "x" })).toBeNull();
    expect(misturaDosTemas([])).toBeNull();
    expect(urlsDoTexto("a https://y.com/b). c")).toEqual(["https://y.com/b"]);
    expect(primeirasFrases("Uma \u2014 duas. Três.", 1)).toBe("Uma, duas.");
  });

  it("formatos do perfil só com 2 posts ou mais, com salvos e envios por mil", () => {
    const f = porFormato([
      { media_type: "CAROUSEL_ALBUM", reach: 1000, saved: 20, shares: 10, comments_count: 5, like_count: 50 },
      { media_type: "CAROUSEL_ALBUM", reach: 3000, saved: 30, shares: 0, comments_count: 3, like_count: 90 },
      { media_type: "IMAGE", reach: 500, saved: 1, shares: 1, comments_count: 0, like_count: 10 },
      { media_type: "IMAGE", reach: null, saved: 1, shares: 1, comments_count: 0, like_count: 10 },
    ]);
    expect(f).toEqual([{ formato: "carrossel", posts: 2, alcance_medio: 2000, salvos_por_mil: 15, envios_por_mil: 5, comentarios_por_mil: 3 }]);
  });

  it("o pedido leva a leitura do perfil, as datas calculadas, as pautas e as regras de fonte", () => {
    const p = pedidoDoDiagnostico({ pedido: "Proponha temas.", plano: "", datas: datasDoPeriodo("2026-10-01", "2026-10-31"), pautas: ["pauta um"], perfil: { posts_medidos: 12 } });
    expect(p).toContain('{"posts_medidos":12}');
    expect(p).toContain("2026-10-12 Dia das Crianças");
    expect(p).toContain("1. pauta um");
    expect(p).toContain("sem fonte, não é tendência");
    expect(p).toContain("só carrossel ou post estático");
    expect(pedidoDoDiagnostico({ pedido: "", plano: "", datas: [], pautas: [], perfil: null, perfilErro: "x" })).toContain("indisponível agora (x)");
  });
});

describe("agente-calendario: pesquisa do mês em paralelo, sem travar os temas", () => {
  it("pesquisaDoMes pesquisa na web com fôlego, esquema próprio e o sistema do diagnóstico, e nunca lança", () => {
    const p = corpoDe("pesquisaDoMes");
    expect(p).toContain("pesquisaWeb: true");
    expect(p).toContain("timeoutMs: TIMEOUT_CALENDARIO_MS");
    expect(p).toContain("esquemaJson: ESQUEMA_DIAGNOSTICO");
    expect(p).toContain('sistema: sistemaDoCalendario(e.ctx, "diagnostico")');
    expect(p).toContain("await leituraDoPerfil(servico, e.clientId)");
    expect(p).toContain("} catch (err) {");
    const l = corpoDe("leituraDoPerfil");
    expect(l).toContain("lerDesempenhoDoCliente(servico, clientId, periodo)");
    expect(l).toContain("lerEvolucao(");
  });

  it("propor_temas dispara a pesquisa antes das frentes, espera só a graça e grava o estruturado em parametros", () => {
    const p = corpoDe("proporTemas");
    expect(p.indexOf("const pesquisaP = pesquisaDoMes(")).toBeGreaterThan(-1);
    expect(p.indexOf("const pesquisaP = pesquisaDoMes(")).toBeLessThan(p.indexOf("Promise.allSettled(frentes.map("));
    expect(p).toContain('sistema: sistemaDoCalendario(ctx, "temas")');
    expect(p).toContain("comGraca(pesquisaP, GRACA_DO_DIAGNOSTICO_MS)");
    expect(GRACA_DO_DIAGNOSTICO_MS).toBeLessThanOrEqual(60_000);
    expect(p).toContain("parametros.diagnostico_estruturado = { ...estruturado, texto_base: diagnostico }");
    expect(p).toContain('diagnostico_estado: "gerando"');
    expect(p).toContain("textoCurtoDoDiagnostico(pesquisa.estruturado");
    expect(p).toContain("diagnosticoDasFrentes({");
    expect(p).toContain("EdgeRuntime?.waitUntil?.(tarde)");
    expect(p).toContain("if (!r.estruturado || respondendo) return;");
    // As regras de antes continuam: pesquisa nas frentes, Jev e status temas.
    expect(p).toContain("pesquisaWeb: true");
    expect(p).toContain("pontuarTemasComJev(");
    expect(p).toContain('status: "temas"');
    expect(p).toContain("Datas do Brasil no período e logo depois");
  });

  it("a pesquisa atrasada não pisa no texto que a conversa mudou", () => {
    const g = corpoDe("gravarPesquisaAtrasada");
    expect(g).toContain('.select("parametros, diagnostico")');
    expect(g).toContain("const mesmoTexto = (atual.diagnostico ?? \"\") === textoGravado;");
    expect(g).toContain('.eq("client_id", clientId)');
  });

  it("sem SQL novo: o estruturado mora em parametros e o diagnostico em texto continua", () => {
    expect(fonte).not.toMatch(/diagnostico_estruturado:\s*S\(/);
    expect(fonte).toContain("diagnostico: S(\"string\")");
    for (const f of ["supabase/functions/agente-calendario/diagnostico.ts", "supabase/functions/_shared/conhecimento-social.ts"]) {
      expect(TRAVESSAO.test(ler(f).replace(/\\u2014|\\u2013/g, "")), f).toBe(false);
    }
  });
});
