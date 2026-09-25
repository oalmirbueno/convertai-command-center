import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  decidirAutocorrecao,
  LIMITE_DE_AUTOCORRECAO,
  NIVEL_POLITICA_QUE_CORRIGE,
  rodadasSeguidas,
  type VerificacaoParaDecidir,
} from "../../supabase/functions/estudio-arte/autocorrecao";
import { NIVEIS_RISCO_POLITICA } from "../../supabase/functions/_shared/conhecimento-ads";
import { conferirECorrigir, motivoCurto, RODADAS_AUTOMATICAS } from "@/components/mesa/autocorrecaoDaLamina";
import { ErroDaMesa } from "@/lib/mesa/api";

// Estúdio: autocorreção antes de mostrar (docs/mesa-ads/v2/CONTRATO-V2.md).
// Pedido do dono: "O Jev tem que avisar o agente tudo que está errado para ele
// corrigir. A conferência tem que vir antes de entregar para mim."

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const arteDoCriativo = ler("src/components/mesa-ads/ArteDoCriativo.tsx");
const abaEstudio = ler("src/components/mesa/AbaEstudio.tsx");
const cicloFront = ler("src/components/mesa/autocorrecaoDaLamina.ts");
const decisaoFonte = ler("supabase/functions/estudio-arte/autocorrecao.ts");

function corpoDe(nome: string): string {
  const ini = estudio.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = estudio.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst [A-Z_]+ = /);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

const nota = (n: number, max = 4) => ({ nota: n, escala_max: max, nivel: `nível ${n}`, confianca: 0.9 });

const certa = (extra: Partial<VerificacaoParaDecidir> = {}): VerificacaoParaDecidir => ({
  pendente: false,
  texto_lido: "Orçamento em 1 dia Chame no WhatsApp",
  ortografia_ok: true,
  faltando: [],
  sobrando: [],
  logo_presente: true,
  logo_ok: true,
  identidade: nota(3.4),
  ...extra,
});

const TEXTO = "Orçamento em 1 dia\nChame no WhatsApp";

describe("decidirAutocorrecao", () => {
  it("tudo certo: não corrige", () => {
    const d = decidirAutocorrecao(certa(), { ads: false, textoExato: TEXTO });
    expect(d).toEqual({ precisa: false, motivos: [], instrucao: null });
    const ads = decidirAutocorrecao(certa({ politica: nota(4), clareza: nota(3) }), { ads: true, textoExato: TEXTO });
    expect(ads.precisa).toBe(false);
  });

  it("texto faltando palavra: manda reescrever EXATAMENTE o texto exato, citando as palavras", () => {
    const d = decidirAutocorrecao(
      certa({ ortografia_ok: false, texto_lido: "Orcamento em 1 dia Chame no", faltando: ["orçamento", "whatsapp"], sobrando: ["orcamento"] }),
      { ads: false, textoExato: TEXTO },
    );
    expect(d.precisa).toBe(true);
    expect(d.motivos[0]).toMatch(/^Texto errado na arte: faltou "orçamento", "whatsapp"; sobrou "orcamento"/);
    expect(d.instrucao).toContain(`EXATAMENTE assim`);
    expect(d.instrucao).toContain(`"${TEXTO}"`);
    expect(d.instrucao).toContain(`"orçamento", "whatsapp"`);
    expect(d.instrucao).toContain(`"orcamento"`);
  });

  it("logo ausente: pede a logo oficial sem redesenhar", () => {
    const d = decidirAutocorrecao(certa({ logo_presente: false, logo_ok: false }), { ads: false, textoExato: TEXTO });
    expect(d.precisa).toBe(true);
    expect(d.motivos).toEqual(["Logo da marca faltando"]);
    expect(d.instrucao).toContain("logo oficial anexada");
    expect(d.instrucao).toContain("sem redesenhar");
    // Logo sobrando (lâmina sem logo): tira.
    const sobrando = decidirAutocorrecao(certa({ logo_presente: true, logo_ok: false }), { ads: false, textoExato: TEXTO });
    expect(sobrando.motivos).toEqual(["Logo onde não devia"]);
  });

  it("identidade baixa vira aviso, não correção automática (24/09: a edição inteira inventava defeitos)", () => {
    const baixa = decidirAutocorrecao(certa({ identidade: nota(1.2) }), { ads: false, textoExato: TEXTO });
    expect(baixa.precisa).toBe(false);
    expect(baixa.motivos[0]).toContain("Identidade da marca baixa (nota 1.2 de 4)");
    expect(baixa.instrucao).toBeNull();
    expect(decidirAutocorrecao(certa({ identidade: nota(2) }), { ads: false, textoExato: TEXTO }).precisa).toBe(false);
    // Jev fora do ar: identidade { erro } não vira correção.
    expect(decidirAutocorrecao(certa({ identidade: { erro: "jev_indisponivel" } }), { ads: false, textoExato: TEXTO }).precisa).toBe(false);
  });

  it("anúncio com risco de política alto ou clareza baixa: aviso para a equipe, sem corrigir sozinho", () => {
    expect(NIVEIS_RISCO_POLITICA[NIVEL_POLITICA_QUE_CORRIGE]).toMatch(/Risco alto/);
    const politica = decidirAutocorrecao(certa({ politica: nota(1), clareza: nota(3) }), { ads: true, textoExato: TEXTO });
    expect(politica.precisa).toBe(false);
    expect(politica.motivos[0]).toBe(`Risco de política alto: ${NIVEIS_RISCO_POLITICA[1]}`);
    expect(politica.instrucao).toBeNull();
    // Moderado (2) fica com a equipe.
    expect(decidirAutocorrecao(certa({ politica: nota(2), clareza: nota(3) }), { ads: true, textoExato: TEXTO }).precisa).toBe(false);
    const clareza = decidirAutocorrecao(certa({ politica: nota(4), clareza: nota(1) }), { ads: true, textoExato: TEXTO });
    expect(clareza.precisa).toBe(false);
    expect(clareza.motivos[0]).toContain("Oferta pouco clara");
    // No post (social), política e clareza não entram.
    expect(decidirAutocorrecao(certa({ politica: nota(0), clareza: nota(0) }), { ads: false, textoExato: TEXTO }).precisa).toBe(false);
  });

  it("verificação com erro de leitura ou pendente: não corrige e explica", () => {
    const erro = decidirAutocorrecao({ pendente: false, texto_lido: null, ortografia_ok: null, identidade: null, erro: "leitura: erro_desconhecido" }, { ads: true, textoExato: TEXTO });
    expect(erro.precisa).toBe(false);
    expect(erro.instrucao).toBeNull();
    expect(erro.motivos[0]).toContain("A leitura da arte falhou");
    const pendente = decidirAutocorrecao({ pendente: true }, { ads: false, textoExato: TEXTO });
    expect(pendente.precisa).toBe(false);
    expect(pendente.motivos[0]).toContain("Conferência ainda não feita");
    expect(decidirAutocorrecao(null, { ads: false, textoExato: TEXTO }).precisa).toBe(false);
  });

  it("vários erros juntos numa instrução só, que preserva o resto e nunca escurece a foto", () => {
    const d = decidirAutocorrecao(
      certa({ ortografia_ok: false, faltando: ["dia"], logo_presente: false, logo_ok: false, identidade: nota(0.5), politica: nota(0), clareza: nota(1) }),
      { ads: true, textoExato: TEXTO },
    );
    expect(d.motivos).toHaveLength(5);
    expect(d.instrucao).toMatch(/^Corrija esta lâmina, só o que está listado:\n1\. /);
    expect(d.instrucao).toContain("Todo o resto fica igual");
    expect(d.instrucao).toContain("Nunca escureça a foto");
    expect(d.instrucao).toContain("contraste, cor, escala e composição");
    expect(d.instrucao).not.toMatch(/[—–]/);
    for (const m of d.motivos) expect(m).not.toMatch(/[—–]/);
  });

  it("o arquivo da decisão não tem travessão em texto", () => {
    expect(decisaoFonte).not.toMatch(/[—–]/);
  });
});

describe("limite de 1 rodada automática seguida por lâmina", () => {
  it("conta da versão mais nova para trás e para na versão sem autocorreção ou pedida pela equipe", () => {
    expect(LIMITE_DE_AUTOCORRECAO).toBe(1);
    expect(rodadasSeguidas([{ versao: 1 }])).toBe(0);
    expect(rodadasSeguidas([{ versao: 1 }, { versao: 2, autocorrecao: { rodada: 1 } }])).toBe(1);
    expect(rodadasSeguidas([{ versao: 3, autocorrecao: { rodada: 2 } }, { versao: 1 }, { versao: 2, autocorrecao: { rodada: 1 } }])).toBe(2);
    // Ajuste da equipe no meio recomeça a conta.
    expect(rodadasSeguidas([{ versao: 1, autocorrecao: { rodada: 1 } }, { versao: 2 }, { versao: 3, autocorrecao: { rodada: 1 } }])).toBe(1);
    // "Corrigir de novo" (pedido da equipe) também fecha a sequência.
    expect(rodadasSeguidas([{ versao: 4, autocorrecao: { rodada: 1, pedido_da_equipe: true } }, { versao: 3, autocorrecao: { rodada: 2 } }, { versao: 2, autocorrecao: { rodada: 1 } }])).toBe(0);
  });

  it("corrigir_card recusa a terceira com 409 limite_de_autocorrecao", () => {
    const c = corpoDe("corrigirCard");
    expect(c).toContain("const seguidas = rodadasSeguidas(t.cards.filter((c) => c.ordem === ordem));");
    expect(c).toContain("if (!pedidoDaEquipe && seguidas >= LIMITE_DE_AUTOCORRECAO) {");
    expect(c).toContain('409,\n      "limite_de_autocorrecao",');
    expect(c).toContain("const rodada = pedidoDaEquipe ? 1 : seguidas + 1;");
  });
});

describe("contratos do servidor", () => {
  it("corrigir_card está no roteador e no cabeçalho", () => {
    expect(estudio).toContain("corrigir_card: corrigirCard,");
    expect(estudio).toContain("ajustar_card: (ch, corpo) => ajustarCard(ch, corpo),");
    expect(estudio.slice(0, estudio.indexOf("import "))).toContain("corrigir_card { trabalho_id, ordem, pedido_da_equipe? }");
  });

  it("conferir_card devolve e grava a decisão da autocorreção", () => {
    const c = corpoDe("conferirCard");
    expect(c).toContain("decidirAutocorrecao(verificacao, { ads: ehAds(t), textoExato: card.texto_exato })");
    expect(c).toContain("verificacao.autocorrecao = autocorrecao;");
    expect(c).toContain("verificacao, autocorrecao, custo_usd: custo");
  });

  it("corrigir_card usa o MESMO caminho do ajuste (sem gerador próprio) e devolve corrigido/rodada", () => {
    const c = corpoDe("corrigirCard");
    expect(c).not.toContain("chamarImagem(");
    expect(c).not.toContain("chamarTexto(");
    expect(c).toContain("await ajustarCard(ch, { trabalho_id: t.id, ordem, instrucao: autocorrecao.instrucao }, marca)");
    expect(c).toContain("corrigido: false, autocorrecao, custo_usd: 0");
    expect(c).toContain("{ ...dados, corrigido: true, rodada, autocorrecao }");
    expect(c).toContain("garantirEditavel(t);");
  });

  it("no modo automático o ajuste fixa o texto exato, não grava memória e marca a versão", () => {
    const a = corpoDe("ajustarCard");
    expect(a).toContain("auto: MarcaDeAutocorrecao | null = null");
    expect(a).toContain("const novoTexto = auto ? card.texto_exato :");
    expect(a).toContain("if (!auto) await gravarNoCerebro(servico(), {");
    expect(a).toContain("...(auto ? { autocorrecao: auto } : {}),");
  });
});

describe("front: confere e corrige antes de revelar", () => {
  const resposta = (precisa: boolean, custo: number, motivos = ["Texto errado na arte: faltou \"dia\""]) => ({
    custo_usd: custo,
    autocorrecao: { precisa, motivos: precisa ? motivos : [], instrucao: precisa ? "Corrija" : null },
  });

  it("corrige uma vez, confere depois e soma o custo de tudo", async () => {
    const etapas: string[] = [];
    const conferir = vi.fn()
      .mockResolvedValueOnce(resposta(true, 0.002))
      .mockResolvedValueOnce(resposta(true, 0.002))
      .mockResolvedValueOnce(resposta(true, 0.002));
    const corrigir = vi.fn().mockResolvedValue({ corrigido: true, rodada: 1, custo_usd: 0.012 });
    const r = await conferirECorrigir({
      conferir,
      corrigir,
      corrigirSozinho: true,
      aoMudarEtapa: (e, d) => etapas.push(d ? `${e}:${d}` : e),
    });
    expect(RODADAS_AUTOMATICAS).toBe(1);
    expect(corrigir).toHaveBeenCalledTimes(1);
    expect(conferir).toHaveBeenCalledTimes(2);
    expect(r.rodadas).toBe(1);
    expect(r.custo_usd).toBeCloseTo(0.002 * 2 + 0.012, 6);
    expect(r.autocorrecao?.precisa).toBe(true);
    expect(etapas).toEqual(["conferindo", "corrigindo:texto errado na arte", "reconferindo"]);
  });

  it("para quando a conferência fica certa", async () => {
    const conferir = vi.fn().mockResolvedValueOnce(resposta(true, 0.002)).mockResolvedValueOnce(resposta(false, 0.002));
    const corrigir = vi.fn().mockResolvedValue({ corrigido: true, custo_usd: 0.01 });
    const r = await conferirECorrigir({ conferir, corrigir, corrigirSozinho: true, aoMudarEtapa: () => undefined });
    expect(corrigir).toHaveBeenCalledTimes(1);
    expect(r.autocorrecao?.precisa).toBe(false);
    expect(r.falha).toBeNull();
  });

  it("com a chave desligada só confere", async () => {
    const conferir = vi.fn().mockResolvedValue(resposta(true, 0.002));
    const corrigir = vi.fn();
    const r = await conferirECorrigir({ conferir, corrigir, corrigirSozinho: false, aoMudarEtapa: () => undefined });
    expect(corrigir).not.toHaveBeenCalled();
    expect(r.autocorrecao?.precisa).toBe(true);
  });

  it("o limite do servidor encerra sem falha; outro erro volta em falha com o custo somado", async () => {
    const limite = await conferirECorrigir({
      conferir: vi.fn().mockResolvedValue(resposta(true, 0.002)),
      corrigir: vi.fn().mockRejectedValue(new ErroDaMesa("limite_de_autocorrecao", "limite")),
      corrigirSozinho: true,
      aoMudarEtapa: () => undefined,
    });
    expect(limite.falha).toBeNull();
    expect(limite.custo_usd).toBeCloseTo(0.002, 6);
    const saldo = await conferirECorrigir({
      conferir: vi.fn().mockResolvedValue(resposta(true, 0.002)),
      corrigir: vi.fn().mockRejectedValue(new ErroDaMesa("saldo_insuficiente", "sem saldo")),
      corrigirSozinho: true,
      aoMudarEtapa: () => undefined,
    });
    expect(saldo.falha).toBeInstanceOf(ErroDaMesa);
  });

  it("'Corrigir de novo' começa corrigindo como pedido da equipe", async () => {
    const corrigir = vi.fn().mockResolvedValue({ corrigido: true, custo_usd: 0.01 });
    const conferir = vi.fn().mockResolvedValue(resposta(false, 0.002));
    await conferirECorrigir({
      conferir,
      corrigir,
      corrigirSozinho: true,
      comecarCorrigindo: { precisa: true, motivos: ["Logo da marca faltando"], instrucao: "x" },
      aoMudarEtapa: () => undefined,
    });
    expect(corrigir).toHaveBeenCalledWith(true);
    expect(conferir).toHaveBeenCalledTimes(1);
  });

  it("motivo curto para o véu", () => {
    expect(motivoCurto("Texto errado na arte: faltou \"dia\"")).toBe("texto errado na arte");
    expect(motivoCurto("Identidade da marca baixa (nota 1 de 4)")).toBe("identidade da marca baixa");
    expect(motivoCurto(undefined)).toBe("");
  });

  it("ArteDoCriativo e o Estúdio da Mesa usam o mesmo ciclo, com a chave DESLIGADA por padrão e o véu", () => {
    for (const fonte of [arteDoCriativo, abaEstudio]) {
      expect(fonte).toContain("conferirECorrigir({");
      expect(fonte).toContain('acao: "corrigir_card"');
      expect(fonte).toContain("useEstadoGuardado<boolean>(chaveDoCorrigirSozinho(");
      expect(fonte).toContain(", false);");
      expect(fonte).toContain("Corrigir sozinho");
      expect(fonte).toContain("onCorrigir={() => corrigirDeNovo(");
    }
    expect(arteDoCriativo).toContain("<VeuDaLamina andamento={andamento} />");
    expect(abaEstudio).toContain("andamento={andamento[cardSelecionado.ordem]}");
    // Props públicas da ArteDoCriativo não mudam (a frente C a renderiza).
    expect(arteDoCriativo).toContain("}: {\n  criativo: CriativoAds;\n  trabalho: Trabalho;\n  onAtualizar: () => void;\n");
    // A Mesa Ads v3 só acrescentou `irmaos` opcional; as props obrigatórias não mudam.
    expect(arteDoCriativo).toContain("  irmaos?: IrmaoDoCriativo[];\n}) {");
  });

  it("o véu tem a etapa em texto claro e nenhum texto de tela tem travessão", () => {
    const prancheta = ler("src/components/mesa/PranchetaDoEstudio.tsx");
    expect(prancheta).toContain('conferindo: "Conferindo texto e identidade"');
    expect(prancheta).toContain('reconferindo: "Conferindo de novo"');
    expect(prancheta).toContain("`Corrigindo: ${a.detalhe}`");
    expect(prancheta).toContain("export function VeuDaLamina(");
    expect(ler("src/components/mesa/CardDoEstudio.tsx")).toContain("Corrigir de novo");
    for (const fonte of [cicloFront, prancheta, arteDoCriativo, ler("src/components/mesa/CardDoEstudio.tsx")]) {
      expect(fonte).not.toMatch(/[—–]/);
    }
  });

  it("compatível com Safari 11 e Chrome 64 (sem lookbehind, \\p{}, grupo nomeado, .at(), backdrop-filter)", () => {
    const prancheta = ler("src/components/mesa/PranchetaDoEstudio.tsx");
    for (const fonte of [cicloFront, arteDoCriativo, prancheta, ler("src/components/mesa/EstudioLaminaGrande.tsx")]) {
      expect(fonte).not.toMatch(/\(\?<[=!]/);
      expect(fonte).not.toMatch(/\\p\{/);
      expect(fonte).not.toMatch(/\(\?<[a-zA-Z]/);
      expect(fonte).not.toMatch(/\.at\(/);
      expect(fonte).not.toContain("backdrop-blur");
      // aspect-ratio em CSS (os comentários dizem "sem aspect-ratio"): nem classe nem estilo.
      expect(fonte).not.toMatch(/aspect-\[|aspect-square|aspect-video|aspectRatio/);
    }
  });
});

describe("correção só na área do texto e refazer diferente (24/09/2026)", () => {
  it("corrigir_card abre só as áreas de texto e logo; o ajuste devolve o original fora delas", () => {
    const c = corpoDe("corrigirCard");
    // 26/09: a logo é gerada junto com a arte; a área dela (a gravada na versão, quando a máscara a fixou) abre com a do texto.
    expect(c).toContain("areasDeDesenho(card, totalCards(t), levaLogo(t, ordem) && !logoArea, quadroDoCard(t, card))");
    expect(c).not.toContain("logoDoCodigo");
    expect(c).toContain("areas: areasDaCorrecao");
    expect(corpoDe("ajustarCard")).toContain("auto ? (auto.areas ?? []) : normalizarAreas(corpo.areas)");
  });
  it("refazer pede outra composição e as regras fixas cobram anatomia e nada de moldura", () => {
    expect(estudio).toContain("blocoDeVariacao(versoesAntes, !!baseFoto || !!recorteNaLamina, replicar, ordem, total > 1 && ordem > 1)");
    expect(estudio).toContain("NÃO repita a composição da versão anterior");
    expect(estudio).toContain("mãos com cinco dedos");
    expect(estudio).toContain("Sem moldura, borda, contorno ou cantos arredondados");
  });
});
