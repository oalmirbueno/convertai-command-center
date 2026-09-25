import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  diagnosticar,
  direcaoDoResultado,
  evidenciaDaImportacao,
  evidenciaDoAprendizado,
  LIMIARES_DIAGNOSTICO,
  somarMetricas,
  type Diaria,
} from "../../supabase/functions/mesa-ads/calculos";

/**
 * Mesa Ads (docs/mesa-ads/SPEC.md): conferência da função mesa-ads pelo
 * código (como mesa-v5-servidor) e dos cálculos puros executando de verdade.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/mesa-ads/index.ts");
const calculos = ler("supabase/functions/mesa-ads/calculos.ts");
const conhecimento = ler("supabase/functions/_shared/conhecimento-ads.ts");
const seed = ler("supabase/migrations/20260924021905_mesa_ads_biblioteca.sql");
const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const j = texto.indexOf("\nasync function ", i + 10);
  const k = texto.indexOf("\nfunction ", i + 10);
  const l = texto.indexOf("\nconst ACOES", i + 10);
  const fim = [j, k, l].filter((x) => x > 0).sort((a, b) => a - b)[0];
  return texto.slice(i, fim);
};

const ACOES = {
  briefing_sugerir: "briefingSugerir",
  briefing_salvar: "briefingSalvar",
  referencia_ler: "referenciaLer",
  referencias_importar_proprias: "referenciasImportarProprias",
  plano_gerar: "planoGerar",
  plano_conversar: "planoConversar",
  criativos_produzir: "criativosProduzir",
  copy_variar: "copyVariar",
  resultados_ler: "resultadosLer",
  aprendizado_registrar: "aprendizadoRegistrar",
};

/** Ações da v2 (docs/mesa-ads/v2/CONTRATO-V2.md). */
const ACOES_V2 = {
  oferta_conversar: "ofertaConversar",
  oferta_salvar: "ofertaSalvar",
  oferta_listar: "ofertaListar",
  conta_ao_vivo: "contaAoVivo",
  conta_sincronizar: "contaSincronizar",
  conta_analisar: "contaAnalisar",
  referencia_abrir: "referenciaAbrir",
  referencia_importar_url: "referenciaImportarUrl",
  biblioteca_do_nicho: "bibliotecaDoNicho",
  copy_pacote: "copyPacote",
  pacote_enviar: "pacoteEnviar",
};

const dia =(d: string, o: Partial<Diaria> = {}): Diaria => ({
  ad_id: "1",
  day: d,
  spend: 10,
  impressions: 1000,
  clicks: 20,
  link_clicks: 10,
  frequency: 1.2,
  actions: [],
  ...o,
});

describe("acesso", () => {
  it("só equipe, e o acesso ao cliente é conferido com o JWT de quem chamou", () => {
    const acesso = corpoDe(fonte, "exigirAcessoAoCliente");
    expect(acesso).toContain('clienteDoChamador(chamador.token).rpc("can_access_client", { _client_id: clientId })');
    expect(acesso).toContain("if (data !== true) throw new ErroHttp(403");
    expect(corpoDe(fonte, "identificar")).toContain('servico.rpc("is_staff"');
  });
  it("toda ação passa por exigirAcessoAoCliente (as dez do SPEC e as da v2)", () => {
    for (const nome of [...Object.values(ACOES), ...Object.values(ACOES_V2)]) {
      expect(corpoDe(fonte, nome), nome).toContain("await exigirAcessoAoCliente(chamador,");
    }
  });
  it("nenhuma falha responde 200 e o saldo tem mensagem clara", () => {
    const erro = corpoDe(fonte, "respostaDeErro");
    expect(erro).toContain("err.status");
    expect(erro).toContain("}, 500)");
    expect(fonte).toContain("saldo_insuficiente: { status: 402");
    expect(fonte).toContain("cota_da_chave_esgotada: { status: 402");
    expect(fonte).toContain("provedor_sem_chave: { status: 403");
  });
});

describe("mapa de ações", () => {
  it("tem as dez ações do SPEC e as onze da v2", () => {
    for (const [acao, nome] of Object.entries({ ...ACOES, ...ACOES_V2 })) {
      const linha = acao === nome ? `  ${acao},` : `  ${acao}: ${nome},`;
      expect(fonte).toContain(linha);
    }
  });
});

describe("honestidade", () => {
  it("o estrategista recebe o conhecimento inteiro, com as regras de honestidade e as políticas", () => {
    expect(corpoDe(fonte, "sistemaDoEstrategista")).toContain("CONHECIMENTO_ESTRATEGISTA_ADS");
    const bloco = conhecimento.slice(conhecimento.indexOf("export const CONHECIMENTO_ESTRATEGISTA_ADS"));
    expect(bloco).toContain("REGRAS_DE_HONESTIDADE,");
    expect(bloco).toContain("POLITICAS_META,");
    expect(fonte).toContain("Nunca invente depoimento, número, resultado, prazo, preço, desconto, escassez, urgência ou disponibilidade.");
  });
  it("toda chamada de texto usa a tarefa ads e o sistema do estrategista (ou o do leitor)", () => {
    expect(fonte).toContain('const TAREFA = "ads" as Tarefa;');
    expect(fonte).toContain('const AGENTE = "estrategista_ads" as Agente;');
    // v2: oferta, conta, pacote e nicho usam o MESMO sistema; o conhecimento
    // de oferta, agressivo, conta e pacote já está em CONHECIMENTO_ESTRATEGISTA_ADS.
    // Frente H: o mesmo sistema, com a tarefa escolhendo os blocos dos especialistas e de marketing.
    expect(corpoDe(fonte, "sistemaDoEstrategista")).toContain("function sistemaDoEstrategista(tarefa?: TarefaAds, objetivo?: unknown): string");
    const chamadas = fonte.split("await chamarTexto({").slice(1);
    expect(chamadas.length).toBeGreaterThanOrEqual(14);
    for (const c of chamadas) {
      const trecho = c.slice(0, 400);
      expect(trecho).toContain("tarefa: TAREFA,");
      // v5: o agente sênior de tráfego tem o sistema próprio (a mesma base inteira + os blocos de conta e estratégia).
      expect(trecho).toMatch(/sistema: (sistemaDoEstrategista\("(angulos|copy|pacote|oferta|conta)"[^\n]*\)|SISTEMA_DO_LEITOR|sistemaDoAgenteSenior\(objetivo\)),/);
    }
    const senior = corpoDe(fonte, "sistemaDoAgenteSenior");
    expect(senior).toContain("${CONHECIMENTO_ESTRATEGISTA_ADS}");
    expect(senior).toContain("${REGRAS_DA_EXECUCAO}");
    expect(senior).toContain("ESTRATEGIA_SENIOR_DE_CONTA");
  });
  it("o leitor separa observado de inferido e nunca inventa métrica", () => {
    expect(fonte).toContain("REGRAS_DE_HONESTIDADE,\n  METODO_DA_REFERENCIA,");
    expect(fonte).toContain("Nunca invente métrica, resultado, gasto, data ou autoria.");
    expect(corpoDe(fonte, "referenciaLer")).toContain('resolverModelo(corpo.modelo_id, corpo.raciocinio, "leitura"');
    expect(corpoDe(fonte, "referenciaLer")).not.toMatch(/\.update\(\{[^}]*evidencia/);
  });
  it("plano pede a hipótese no formato do dossiê e só referências reais", () => {
    const p = corpoDe(fonte, "planoGerar");
    expect(p).toContain("Acreditamos que [situação + mecanismo] aumentará [resultado], porque [evidência do público].");
    expect(p).toContain('servico.from("agente_conversas").delete()');
    expect(corpoDe(fonte, "normalizarAngulo")).toContain("refsValidas.has(r)");
    expect(corpoDe(fonte, "referenciasParaOPlano")).toContain('.is("client_id", null)');
  });
});

describe("Jev nas notas", () => {
  it("pontua cada ângulo em clareza, relevância, prova e risco de política", () => {
    const j = corpoDe(fonte, "pontuarAngulosComJev");
    for (const n of ["NIVEIS_CLAREZA", "NIVEIS_RELEVANCIA", "NIVEIS_PROVA", "NIVEIS_RISCO_POLITICA"]) expect(j).toContain(`criteria: ${n}`);
    expect(j).toContain("cobrarJev(r, { clientId: cobranca.clientId, tarefa: TAREFA");
    expect(j).toContain("return { angulos, jev_erro: codigo, custo: 0 };");
  });
  it("confere a copy (risco de política e clareza) antes de criar o criativo", () => {
    const c = corpoDe(fonte, "conferirCopiesComJev");
    expect(c).toContain("criteria: NIVEIS_RISCO_POLITICA");
    expect(c).toContain("tarefa: TAREFA");
    expect(corpoDe(fonte, "criativosProduzir")).toContain("await conferirCopiesComJev(");
    expect(corpoDe(fonte, "copyVariar")).toContain("await conferirCopiesComJev(");
  });
});

describe("criativos", () => {
  const c = corpoDe(fonte, "criativosProduzir");
  it("cria o trabalho do Estúdio tipo ads, já dirigido e sem tarefa", () => {
    expect(c).toContain('tipo: "ads",');
    expect(c).toContain("task_id: null,");
    expect(c).toContain('status: "dirigido",');
    expect(c).toContain("modelo_imagem_id: modeloImagem.id,");
    expect(c).toContain('qualidade: "media",');
    expect(c).toContain("cards: [],");
    expect(c).toContain("trabalho_id: trabalhoId,");
    expect(c).toContain('modeloPadrao("imagem")');
  });
  it("a direção é montada em código, com formato em cada card e prompt vazio", () => {
    const d = corpoDe(fonte, "direcaoDoAnuncio");
    expect(d).toContain("direcaoDoRoteiro(");
    expect(d).toContain("formato: formatoDoCard,");
    expect(d).toContain('const formatoDoCard: Exclude<FormatoAds, "carrossel"> = carrossel ? "feed_4x5" : formato;');
    expect(d).toContain('prompt_imagem: "",');
    expect(d).toContain("fio_visual: info.fioVisual,");
    expect(d).not.toContain("chamarTexto");
  });
  it("carrossel segue a sequência de 3 a 5 cards", () => {
    const r = corpoDe(fonte, "roteiroDaVariacao");
    expect(r).toContain(".slice(0, 5)");
    expect(r).toContain("if (cards.length < 3)");
    expect(fonte).toContain('const ETAPAS_CARROSSEL = ["tensao", "explicacao", "demonstracao", "objecao", "proximo_passo"] as const;');
  });
  it("limites da Meta aplicados em código", () => {
    const n = corpoDe(fonte, "normalizarCopy");
    expect(n).toContain("cortarNaPalavra(tituloBruto, 40)");
    expect(n).toContain("principal.length > 125");
  });
});

describe("importar anúncios próprios", () => {
  const f = corpoDe(fonte, "referenciasImportarProprias");
  it("é grátis e sem IA", () => {
    expect(f).not.toContain("chamarTexto");
    expect(f).not.toContain("jevPerguntar");
    expect(f).toContain("custo_usd: 0");
    expect(f).toContain('origem: "anuncio_proprio"');
    expect(f).toContain("evidenciaDaImportacao(m, anterior?.evidencia)");
  });
  it("E3 só com gasto e resultado; senão E1; E4 nunca desce", () => {
    expect(evidenciaDaImportacao({ gasto: 50, resultados: 3 })).toBe("E3");
    expect(evidenciaDaImportacao({ gasto: 50, resultados: 0 })).toBe("E1");
    expect(evidenciaDaImportacao({ gasto: 0, resultados: 2 })).toBe("E1");
    expect(evidenciaDaImportacao({ gasto: 0, resultados: 0 }, "E4")).toBe("E4");
  });
  it("soma resultados sem contar lead em dobro", () => {
    const m = somarMetricas([
      dia("2026-09-01", { actions: [{ action_type: "lead", value: "3" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "3" }, { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "2" }] }),
      dia("2026-09-02", { actions: [{ action_type: "offsite_conversion.fb_pixel_lead", value: "1" }] }),
    ]);
    expect(m.resultados_por_tipo).toEqual({ leads: 4, mensagens: 2 });
    expect(m.resultados).toBe(6);
    expect(m.gasto).toBe(20);
    expect(m.ctr_saida_pct).toBe(1);
    expect(m.cpm).toBe(10);
    expect(m.custo_por_resultado).toBe(3.33);
  });
  it("conta a conexão de mensagem quando a conversa iniciada não vem, sem somar as duas", () => {
    const m = somarMetricas([
      // Direct da Verzelo: a Meta só registrou a conexão de mensagem.
      dia("2026-09-23", { actions: [{ action_type: "onsite_conversion.total_messaging_connection", value: "1" }, { action_type: "link_click", value: "4" }] }),
      // Dia com as duas: vale a conversa iniciada.
      dia("2026-09-24", { actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "2" }, { action_type: "onsite_conversion.total_messaging_connection", value: "2" }] }),
    ]);
    expect(m.resultados_por_tipo).toEqual({ mensagens: 3 });
    expect(m.resultados).toBe(3);
  });
});

describe("resultados e diagnóstico sem IA", () => {
  it("resultados_ler e os cálculos não chamam IA", () => {
    const r = corpoDe(fonte, "resultadosLer");
    expect(r).not.toContain("chamarTexto");
    expect(r).not.toContain("jevPerguntar");
    expect(r).toContain("diagnosticar(metricas, linhas, tolera)");
    expect(r).toContain("sem_vinculo: semVinculo");
    expect(r).toContain("custo_usd: 0");
    expect(calculos).not.toMatch(/import .*ia-motor|import .*jev/);
  });
  it("pouco volume é inconclusivo", () => {
    const linhas = [dia("2026-09-01", { impressions: 300 })];
    expect(diagnosticar(somarMetricas(linhas), linhas).situacao).toBe("inconclusivo");
    expect(direcaoDoResultado(somarMetricas(linhas))).toBe("inconclusivo");
  });
  it("CTR de saída baixo aponta pouca atenção; cliques sem resultado apontam o destino", () => {
    const linhas = [dia("2026-09-01", { impressions: 10000, link_clicks: 40, clicks: 60 })];
    const d = diagnosticar(somarMetricas(linhas), linhas);
    expect(d.sinais.map((s) => s.codigo)).toEqual(["pouca_atencao", "visitas_sem_contato"]);
    expect(d.limiares).toBe(LIMIARES_DIAGNOSTICO);
  });
  it("frequência alta com custo subindo aponta fadiga", () => {
    const linhas = ["01", "02", "03", "04"].map((d, i) => dia(`2026-09-${d}`, {
      impressions: 2000,
      link_clicks: 40,
      frequency: 3.4,
      spend: i < 2 ? 10 : 20,
      actions: [{ action_type: "lead", value: "2" }],
    }));
    const d = diagnosticar(somarMetricas(linhas), linhas, 3);
    expect(d.sinais.map((s) => s.codigo)).toContain("fadiga");
    expect(d.sinais.map((s) => s.codigo)).toContain("custo_acima_do_toleravel");
  });
});

describe("aprendizado", () => {
  it("E4 só com aprendizado anterior do mesmo ângulo, mesma direção e janela anterior", () => {
    const anterior = { evidencia: "E3", periodo_fim: "2026-08-31", direcao: "positivo" };
    expect(evidenciaDoAprendizado([anterior], "positivo", "2026-09-01")).toBe("E4");
    expect(evidenciaDoAprendizado([anterior], "negativo", "2026-09-01")).toBe("E3");
    expect(evidenciaDoAprendizado([{ ...anterior, periodo_fim: "2026-09-05" }], "positivo", "2026-09-01")).toBe("E3");
    expect(evidenciaDoAprendizado([anterior], "inconclusivo", "2026-09-01")).toBe("E3");
  });
  it("sobe a evidência do criativo e grava o aprendizado também na memória do agente", () => {
    const a = corpoDe(fonte, "aprendizadoRegistrar");
    expect(a).toContain("maiorEvidencia(c.evidencia, evidencia)");
    expect(a).toContain('.from("ads_aprendizados")');
    // Frente H: pelo cérebro do cliente (área ads, resultado medido: vira origem "metrica" no formato antigo).
    expect(a).toContain("await gravarNoCerebro(servico, {");
    expect(a).toContain('categoria: "performou",');
    expect(fonte).toContain("const MEMORIA_ACEITA_ESTRATEGISTA_ADS = true;");
  });
});

describe("biblioteca da agência", () => {
  it("semeia as 39 fontes do catálogo, idempotente por url", () => {
    const linhas = seed.split("\n").filter((l) => l.startsWith("  ('"));
    expect(linhas).toHaveLength(39);
    expect(seed).toContain("SELECT NULL, v.titulo, v.url, 'catalogo', 'E0'");
    expect(seed).toContain("WHERE r.client_id IS NULL AND r.url = v.url");
    expect(seed).not.toMatch(/[\u2014\u2013]/);
  });
});
