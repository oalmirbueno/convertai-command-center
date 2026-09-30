import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  aplicarNaEstrategia,
  ARQUETIPOS,
  arquetipoDoTexto,
  camposDaEstrategia,
  declaracaoDePosicionamento,
  diferencasDaEstrategia,
  EIXOS_DE_PERSONALIDADE,
  ESQUEMA_DA_ESTRATEGIA,
  estrategiaParaBrandbook,
  estrategiaVazia,
  faltaNaEstrategia,
  juntarProposta,
  normalizarEstrategia,
  progressoDaEstrategia,
  textoDoEixo,
  valoresDoTexto,
} from "../../supabase/functions/_shared/estrategia-de-marca";
import { concluirEtapa, ETAPAS_NOVAS, etapaAtual, faltaNaEtapa, podeAbrir, reabrirEtapa, TAMANHOS_DA_IDENTIDADE } from "../../supabase/functions/_shared/identidade-etapas";
import { avisosDeContraste, coresDaHarmonia, completarPaleta, escalaDaCor, HARMONIAS, hexParaHsl, hslParaHex, matrizDeContraste, neutrasDaMarca, nomeDaCor, paletaHarmonica, paresParaTexto } from "../../supabase/functions/_shared/paleta-da-marca";
import { contraste, luminanciaRelativa } from "../../supabase/functions/_shared/cores-da-marca";
import { estilosDaPersonalidade, familiaSegura, FONTES_DO_CATALOGO, fonteDoCatalogo, hierarquiaDoPar, normalizarParesPropostos, PARES_DE_FONTES, paresParaEstilos, pilhaDaFonte, urlDoGoogleFonts } from "../../supabase/functions/_shared/tipografia-da-marca";
import { dataUrlDoSvg, escaparXml, svgDoPadrao, TIPOS_DE_PADRAO } from "../../supabase/functions/_shared/grafismos-da-marca";
import { assinaturaDeEmail, coresDaPeca, layoutDaPeca, PECAS_DA_MARCA, svgDoLayout } from "../../supabase/functions/_shared/aplicacoes-da-marca";
import { camposDasFalas, prontoParaApresentar, roteiroDaApresentacao, SCRIPT_DA_APRESENTACAO, SLIDES_DA_APRESENTACAO } from "../../supabase/functions/_shared/apresentacao-da-marca";
import {
  IDIOMAS_DO_TESTE,
  linksDoArroba,
  normalizarCandidatos,
  normalizarLeituras,
  normalizarSlogans,
  ordenarSlogans,
  perguntasDoRiscoDeIdioma,
  perguntasDosSlogans,
  resumoDosVotos,
  retratoDaVotacao,
  riscoPelaProbabilidade,
  TECNICAS_DE_NAMING,
} from "../../supabase/functions/_shared/naming";
import { brandbookDoProjeto, brandbookPublico, ehTema, normalizarBrandbook, TEMAS_DO_BRANDBOOK, VERSAO_DO_ESQUEMA } from "../../supabase/functions/_shared/brandbook";
import { gerarPdfDoBrandbook } from "../../supabase/functions/_shared/pdf-identidade";
import { paginasDoPdf } from "../../supabase/functions/_shared/pdf-roteiro";
import { alvosDoDiretor, DESCRICOES_DAS_OPERACOES, normalizarAcoesDoDiretor, OPERACOES_COM_IA, OPERACOES_DO_DIRETOR, regrasDoDiretor } from "../../supabase/functions/mesa-identidade/acoes-do-diretor";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { MESAS_DO_PAINEL } from "@/lib/mesa/preCarga";
import { ETAPAS_DA_IDENTIDADE } from "../../supabase/functions/_shared/identidade-etapas";
import { linhasQueCabem } from "@/lib/identidade/desenharPeca";
import { mensagemDoErroDaVotacao } from "@/pages/VotacaoDeNomes";
import { dadosDoPublico } from "@/pages/BrandbookPublico";
import VisaoDoBrandbook from "@/components/mesa-identidade/VisaoDoBrandbook";
import { chaveDoQuadro, imagensDaApresentacao, SlideDaMarca } from "@/components/mesa-identidade/ApresentacaoDaMarca";
import { itensDoMoodboard } from "@/components/mesa-identidade/Moodboard";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
const C = "11111111-1111-4111-8111-111111111111";

// ------------------------------------------------------------------ 1. estratégia de marca

describe("IDV2: estratégia de marca", () => {
  it("os 12 arquétipos, com leitura por rótulo, sem acento e em inglês", () => {
    expect(ARQUETIPOS.length).toBe(12);
    expect(new Set(ARQUETIPOS.map((a) => a.valor)).size).toBe(12);
    expect(arquetipoDoTexto("Sábio")).toBe("sabio");
    expect(arquetipoDoTexto("o SABIO")).toBe("sabio");
    expect(arquetipoDoTexto("Caregiver")).toBe("cuidador");
    expect(arquetipoDoTexto("Bobo da corte")).toBe("bobo_da_corte");
    expect(arquetipoDoTexto("inventado")).toBe("");
  });

  it("normaliza qualquer JSON: eixos de -2 a 2, valores 'Nome: descrição', secundário diferente do principal", () => {
    const e = normalizarEstrategia({
      proposito: "  Fazer pão de verdade  ",
      valores: ["Cuidado: a massa descansa o tempo que precisa", "- Cuidado", "Proximidade"],
      arquetipo: { principal: "Cuidador", secundario: "cuidador", justificativa: "x" },
      personalidade: { eixos: { formalidade: 7, humor: -9, energia: "1" }, tracos: ["calorosa", "calorosa", "direta"] },
      publico: { persona: { nome: "Ana", dores: "acordar cedo\nfila" } },
      lixo: { nada: 1 },
    });
    expect(e.proposito).toBe("Fazer pão de verdade");
    expect(e.valores).toEqual([{ nome: "Cuidado", descricao: "a massa descansa o tempo que precisa" }, { nome: "Proximidade", descricao: "" }]);
    expect(e.arquetipo).toEqual({ principal: "cuidador", secundario: "", justificativa: "x" });
    expect(e.personalidade.eixos.formalidade).toBe(2);
    expect(e.personalidade.eixos.humor).toBe(-2);
    expect(e.personalidade.eixos.energia).toBe(1);
    expect(e.personalidade.tracos).toEqual(["calorosa", "direta"]);
    expect(e.publico.persona.dores).toEqual(["acordar cedo", "fila"]);
    expect(normalizarEstrategia(null)).toEqual(estrategiaVazia());
    expect(textoDoEixo("formalidade", 2)).toBe("bem descontraída");
    expect(textoDoEixo("tradicao", -1)).toBe("mais clássica");
  });

  it("valores e listas não perdem número que faz parte da frase", () => {
    expect(valoresDoTexto(["24 horas: sempre aberto"])[0].nome).toBe("24 horas");
    expect(normalizarEstrategia({ tom: { fala_assim: ["1. Oi, tudo bem?", "3 pães saem às 7h"] } }).tom.fala_assim).toEqual(["Oi, tudo bem?", "3 pães saem às 7h"]);
  });

  it("a frase de posicionamento no molde clássico; sem as partes, vazia", () => {
    const p = { publico: "Para famílias do bairro", categoria: "a padaria de fermentação natural", diferencial: "que faz o pão na frente de você", prova: "porque a massa descansa 24 horas.", concorrentes: "", declaracao: "" };
    expect(declaracaoDePosicionamento(p, "Forno Vivo")).toBe("Para famílias do bairro, Forno Vivo é a padaria de fermentação natural que faz o pão na frente de você, porque a massa descansa 24 horas.");
    expect(declaracaoDePosicionamento({ ...p, diferencial: "" }, "X")).toBe("");
  });

  it("o mínimo da etapa e o andamento por seção", () => {
    expect(faltaNaEstrategia({})).toEqual(["O propósito ou a missão", "O arquétipo principal", "O posicionamento (para quem e o diferencial)", "O tom de voz (como a marca fala)"]);
    const pronta = { proposito: "x", arquetipo: { principal: "sabio" }, posicionamento: { publico: "a", diferencial: "b" }, tom: { fala_assim: ["oi"] } };
    expect(faltaNaEstrategia(pronta)).toEqual([]);
    expect(progressoDaEstrategia(normalizarEstrategia(pronta)).total).toBe(8);
  });

  it("os campos do Preencher com IA cobrem todas as partes e o arquétipo é escolha entre os 12", () => {
    const campos = camposDaEstrategia(estrategiaVazia());
    const chaves = campos.map((c) => c.chave);
    for (const k of ["proposito", "missao", "visao", "valores", "arquetipo.principal", "arquetipo.justificativa", "personalidade.tracos", "posicionamento.diferencial", "proposta_de_valor.promessa", "publico.persona", "tom.fala_assim", "tom.nao_fala_assim", "tom.exemplos"]) expect(chaves).toContain(k);
    expect(campos.filter((c) => c.chave === "arquetipo.principal")[0].opcoes!.length).toBe(12);
    expect(chaves.filter((k) => k.indexOf("personalidade.eixos.") === 0).length).toBe(EIXOS_DE_PERSONALIDADE.length);
    expect(camposDaEstrategia(estrategiaVazia(), "tom").every((c) => c.chave.indexOf("tom.") === 0)).toBe(true);
  });

  it("aplicar por caminho (rótulo do arquétipo, valores em texto, persona como objeto)", () => {
    const e = aplicarNaEstrategia(estrategiaVazia(), { "arquetipo.principal": "Governante", valores: ["Rigor: conferimos tudo"], "publico.persona": { nome: "Rita", idade: "35 a 44" }, "posicionamento.diferencial": "entrega no mesmo dia" });
    expect(e.arquetipo.principal).toBe("governante");
    expect(e.valores[0].nome).toBe("Rigor");
    expect(e.publico.persona.nome).toBe("Rita");
    expect(e.posicionamento.diferencial).toBe("entrega no mesmo dia");
  });

  it("proposta inteira: por padrão só preenche o vazio; substituir troca; chaves limitam", () => {
    const atual = normalizarEstrategia({ proposito: "o da equipe" });
    const proposta = normalizarEstrategia({ proposito: "o da IA", missao: "missão da IA", tom: { fala_assim: ["oi"] } });
    const a = juntarProposta(atual, proposta);
    expect(a.estrategia.proposito).toBe("o da equipe");
    expect(a.estrategia.missao).toBe("missão da IA");
    expect(a.mudaram).toEqual(["missao", "tom.fala_assim"]);
    expect(juntarProposta(atual, proposta, { substituir: true }).estrategia.proposito).toBe("o da IA");
    expect(juntarProposta(atual, proposta, { chaves: ["tom.fala_assim"] }).mudaram).toEqual(["tom.fala_assim"]);
    expect(diferencasDaEstrategia(atual, proposta).map((d) => d.chave)).toEqual(["proposito", "missao", "tom.fala_assim"]);
  });

  it("o esquema JSON exige todas as partes e restringe o arquétipo aos 12", () => {
    const s = ESQUEMA_DA_ESTRATEGIA.schema as any;
    expect(s.required).toEqual(expect.arrayContaining(["proposito", "arquetipo", "posicionamento", "tom", "avisos"]));
    expect(s.properties.arquetipo.properties.principal.enum.length).toBe(12);
    // Sem minimum/maximum (a Anthropic recusa): a faixa vai como enum, QA 30/09.
    expect(s.properties.personalidade.properties.eixos.properties.humor).toMatchObject({ type: "integer", enum: [-2, -1, 0, 1, 2] });
    expect(s.properties.personalidade.properties.eixos.properties.humor.minimum).toBeUndefined();
  });

  it("a estratégia vai para o brandbook (vale mais que o briefing)", () => {
    const b = estrategiaParaBrandbook({ proposito: "P", arquetipo: { principal: "mago", secundario: "criador" }, posicionamento: { publico: "a", categoria: "b", diferencial: "c" }, tom: { fala_assim: ["assim"], exemplos: [{ situacao: "s", certo: "c", errado: "e" }] } }, "Marca");
    expect(b!.arquetipo).toBe("Mago com Criador");
    expect(b!.posicionamento).toBe("Para a, Marca é b que c.");
    expect(b!.exemplos).toEqual([{ certo: "c", errado: "e" }]);
    expect(estrategiaParaBrandbook({}, "x")).toBeNull();
  });
});

// ------------------------------------------------------------------ 2. etapas novas

describe("IDV2: etapas Estratégia e Apresentação", () => {
  it("projeto de antes da IDV2 não volta no meio: etapa nova atrás de uma já fechada conta como feita", () => {
    expect(ETAPAS_NOVAS).toEqual(["estrategia", "apresentacao"]);
    const antigo = { modo: "zero" as const, com_naming: false, concluidas: ["inicio", "briefing", "pesquisa", "naming", "conceito"] };
    expect(etapaAtual(antigo)).toBe("sistema");
    expect(podeAbrir(antigo, "conceito").pode).toBe(true);
    expect(podeAbrir(antigo, "estrategia").pode).toBe(true);
    // Reabrir a estratégia reabre o que vem depois (a regra de sempre).
    expect(reabrirEtapa(antigo, "estrategia")).toEqual(["inicio", "briefing", "pesquisa"]);
    // Projeto novo parado na pesquisa: a estratégia é a próxima, e ainda não conta.
    expect(etapaAtual({ modo: "zero", com_naming: false, concluidas: ["inicio", "briefing", "pesquisa"] })).toBe("estrategia");
  });

  it("a Estratégia exige o mínimo; a Apresentação não trava a entrega", () => {
    expect(faltaNaEtapa("estrategia", {})).toContain("O arquétipo principal");
    expect(faltaNaEtapa("apresentacao", {})).toEqual([]);
    const p = { modo: "rebranding" as const, com_naming: false, concluidas: ["inicio", "briefing", "pesquisa", "estrategia", "conceito", "sistema", "mockups", "guideline"] };
    const r = concluirEtapa(p, "apresentacao", {});
    expect(r.ok && r.proxima).toBe("entrega");
  });

  it("pré-carga e custos: as duas etapas novas têm tela e tamanho de estimativa", () => {
    expect(Object.keys(MESAS_DO_PAINEL["/mesa-identidade"].etapas)).toEqual(ETAPAS_DA_IDENTIDADE.map((e) => e.valor));
    for (const k of ["estrategia", "paletas", "fontes", "slogans", "idiomas"] as const) expect(TAMANHOS_DA_IDENTIDADE[k].saida).toBeGreaterThan(0);
    expect(ETAPAS_DA_IDENTIDADE.filter((e) => e.valor === "mockups")[0].rotulo).toBe("Aplicações");
  });
});

// ------------------------------------------------------------------ 3. paleta

describe("IDV2: gerador de paleta e contraste WCAG", () => {
  it("HSL ida e volta sem perder a cor", () => {
    for (const hex of ["#157330", "#11BC76", "#191D20", "#FFFFFF", "#4F5AE3"]) expect(hslParaHex(hexParaHsl(hex))).toBe(hex);
  });

  it("harmonias: a base é a primária, a complementar gira 180 graus, sem cor repetida", () => {
    expect(HARMONIAS.length).toBe(6);
    const comp = coresDaHarmonia("#157330", "complementar");
    expect(comp[0]).toMatchObject({ papel: "primaria", hex: "#157330" });
    const destaque = comp.filter((c) => c.papel === "destaque")[0];
    expect(Math.abs(((hexParaHsl(destaque.hex).h - hexParaHsl("#157330").h + 360) % 360) - 180)).toBeLessThan(2);
    for (const h of HARMONIAS) {
      const l = paletaHarmonica("#C0392B", h.valor);
      expect(new Set(l.map((c) => c.hex)).size).toBe(l.length);
      expect(l.length).toBeLessThanOrEqual(8);
    }
    expect(coresDaHarmonia("xyz", "triadica")).toEqual([]);
  });

  it("neutras tingidas: uma escura para texto e uma clara para fundo; escala de 10 tons do claro ao escuro", () => {
    const n = neutrasDaMarca("#157330");
    expect(luminanciaRelativa(n[0].hex)).toBeLessThan(0.05);
    expect(luminanciaRelativa(n[2].hex)).toBeGreaterThan(0.8);
    const e = escalaDaCor("#157330");
    expect(e.map((x) => x.passo)).toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    for (let i = 1; i < e.length; i++) expect(luminanciaRelativa(e[i].hex)).toBeLessThan(luminanciaRelativa(e[i - 1].hex));
  });

  it("pares para texto só com AA ou mais, sem o par invertido; avisos de acessibilidade", () => {
    const pares = paresParaTexto(["#157330", "#F4F6F4"]);
    expect(pares.every((p) => p.razao >= 4.5)).toBe(true);
    expect(new Set(pares.map((p) => [p.frente, p.fundo].sort().join("|"))).size).toBe(pares.length);
    expect(matrizDeContraste(["#157330"]).some((p) => p.fundo === "#FFFFFF")).toBe(true);
    const avisos = avisosDeContraste([{ nome: "Amarelo", papel: "primaria", hex: "#FFD400" }, { nome: "Lima", papel: "destaque", hex: "#C6FF00" }]);
    expect(avisos.some((a) => /Lima/.test(a))).toBe(true);
    expect(avisos.some((a) => /escura para texto/.test(a))).toBe(true);
  });

  it("proposta (da IA ou do gerador) em forma segura: primária garantida e neutras completadas", () => {
    const p = completarPaleta([{ hex: "#ff6600", papel: "qualquer" }, { hex: "#FF6600" }, { hex: "nada" }, { hex: "#3366CC", papel: "destaque" }]);
    expect(p[0]).toMatchObject({ hex: "#FF6600", papel: "primaria" });
    expect(p.filter((c) => c.papel === "neutra").length).toBe(2);
    expect(nomeDaCor("#157330")).toMatch(/Verde/);
    expect(nomeDaCor("#FFFFFF")).toBe("Branco");
  });
});

// ------------------------------------------------------------------ 4. tipografia

describe("IDV2: tipografia do Google Fonts sob demanda", () => {
  it("endereço css2 com display=swap, pesos do catálogo, sem repetir família", () => {
    const url = urlDoGoogleFonts([{ familia: "Playfair Display", pesos: [700, 300] }, { familia: "Inter" }, { familia: "inter" }]);
    expect(url).toBe("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600;700;800&display=swap");
    expect(urlDoGoogleFonts([{ familia: 'Inter"><script>' }])).toBeNull();
    expect(familiaSegura("Inter;drop")).toBe("");
    expect(pilhaDaFonte("Lora")).toMatch(/Georgia/);
  });

  it("os pares usam só famílias do catálogo e a personalidade ordena a lista", () => {
    for (const p of PARES_DE_FONTES) {
      expect(fonteDoCatalogo(p.titulo), p.titulo).toBeTruthy();
      expect(fonteDoCatalogo(p.texto), p.texto).toBeTruthy();
    }
    expect(FONTES_DO_CATALOGO.every((f) => f.licenca === "OFL" || f.licenca === "Apache")).toBe(true);
    const estilos = estilosDaPersonalidade({ arquetipo: "governante", eixos: { tradicao: -2 } });
    expect(estilos).toEqual(expect.arrayContaining(["classica", "elegante", "confiavel"]));
    const pares = paresParaEstilos(estilos);
    expect(pares[0].encaixe).toBeGreaterThanOrEqual(pares[pares.length - 1].encaixe);
    expect(pares[0].estilos.some((s) => estilos.indexOf(s) >= 0)).toBe(true);
    expect(hierarquiaDoPar({ titulo: "Lora", texto: "Inter" }).map((x) => x.nivel)).toEqual(["Título 1", "Título 2", "Subtítulo", "Texto", "Complementar"]);
  });

  it("sugestão da IA: nome seguro e aviso quando a família está fora do catálogo", () => {
    const r = normalizarParesPropostos({ pares: [{ titulo: "Fraunces", texto: "Work Sans", porque: "calor" }, { titulo: "Fonte Inventada", texto: "Inter", porque: "x" }, { titulo: "<b>", texto: "" }] });
    expect(r.map((x) => x.conferida)).toEqual([true, false]);
  });
});

// ------------------------------------------------------------------ 5. grafismos e aplicações

describe("IDV2: grafismos, peças e assinatura de e-mail por código", () => {
  it("todo padrão vira SVG válido com as cores da marca, sem script, e a letra do monograma é escapada", () => {
    for (const t of TIPOS_DE_PADRAO) {
      const svg = svgDoPadrao({ tipo: t.valor, fundo: "#F4F6F4", forma: "#157330", apoio: "#11BC76", letra: "<&", largura: 300, altura: 200 });
      expect(svg.indexOf("<svg")).toBe(0);
      expect(svg).toContain("<pattern");
      expect(svg).toContain("#F4F6F4");
      expect(svg).not.toMatch(/<script|javascript:/i);
    }
    expect(svgDoPadrao({ tipo: "monograma", fundo: "#FFF", forma: "#000", letra: "<&" })).toContain("&lt;&amp;");
    expect(svgDoPadrao({ tipo: "pontos", fundo: "x", forma: "y", escala: 9999 })).toContain('width="160"');
    expect(dataUrlDoSvg("<svg/>").indexOf("data:image/svg+xml")).toBe(0);
    expect(escaparXml(`"'`)).toBe("&quot;&#39;");
  });

  it("toda peça cabe no próprio tamanho e usa a logo real quando há (senão o nome em texto)", () => {
    const base = { nome: "Forno Vivo", slogan: "Pão de verdade", contato: ["(41) 3333-0000", "oi@fornovivo.com"], pessoa: { nome: "Ana", cargo: "Padeira" }, cores: [{ hex: "#157330", papel: "primaria" }, { hex: "#F4F6F4", papel: "neutra" }, { hex: "#191D20", papel: "neutra" }], tituloFamilia: "Fraunces", textoFamilia: "Work Sans", temPadrao: true };
    for (const p of PECAS_DA_MARCA) {
      const comLogo = layoutDaPeca(p.valor, { ...base, temLogo: true });
      expect(comLogo.largura).toBe(p.largura);
      for (const c of comLogo.camadas) {
        if (c.tipo === "texto") continue;
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(p.largura + 0.5);
        expect(c.y + c.h).toBeLessThanOrEqual(p.altura + 0.5);
      }
      const semLogo = layoutDaPeca(p.valor, { ...base, temLogo: false });
      expect(semLogo.camadas.some((c) => c.tipo === "logo")).toBe(false);
    }
    const svg = svgDoLayout(layoutDaPeca("post", { ...base, nome: "A<b>", slogan: "", temLogo: false, temPadrao: false }));
    expect(svg).toContain("A&lt;b&gt;");
    expect(coresDaPeca([]).primaria).toBe("#151B17");
  });

  it("a assinatura de e-mail é HTML de tabela, escapa todo texto e só aceita http(s), mailto e tel", () => {
    const html = assinaturaDeEmail({ nome: "<script>x</script>", cargo: "Sócia", empresa: "Forno Vivo", telefone: "(41) 3333-0000", email: "oi@fornovivo.com", site: "javascript:alert(1)", instagram: "@forno.vivo", logoUrl: "http://inseguro.com/logo.png", cores: [{ hex: "#157330", papel: "primaria" }] });
    expect(html.indexOf("<table")).toBe(0);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="tel:4133330000"');
    expect(html).toContain('href="mailto:oi@fornovivo.com"');
    expect(html).toContain('href="https://instagram.com/forno.vivo"');
    expect(html).not.toMatch(/href="javascript/i);
    expect(html).not.toContain("http://inseguro.com");
  });

  it("o texto da peça quebra em até 3 linhas que cabem", () => {
    const medir = (s: string) => s.length * 10;
    expect(linhasQueCabem(medir, "um dois tres quatro cinco seis sete oito nove dez onze", 100)).toEqual(["um dois", "tres", "quatro..."]);
    expect(linhasQueCabem(medir, "curto", 100)).toEqual(["curto"]);
  });
});

// ------------------------------------------------------------------ 6. apresentação

describe("IDV2: apresentação da marca ao cliente", () => {
  const dados = {
    briefing: { negocio: "Padaria", personalidade: ["calorosa"] },
    estrategia: { proposito: "x", arquetipo: { principal: "cuidador" }, posicionamento: { declaracao: "y" }, tom: { fala_assim: ["oi"] } },
    conceito: { caminhos: [{ id: "c1", nome: "Forno" }], escolhido: "c1" },
    sistema: { logos: { principal: { caminho: `${C}/marca/identidade/p/logo.svg`, previa_png: `${C}/marca/identidade/p/logo.png` } }, cores: [{ hex: "#157330" }, { hex: "#FFFFFF" }], tipografia: [{ familia: "Lora", uso: "titulo" }] },
    naming: { nome: "Forno Vivo" },
  };

  it("a sequência do problema à revelação; slide opcional sem conteúdo sai; nome só com naming", () => {
    expect(SLIDES_DA_APRESENTACAO[0].id).toBe("abertura");
    expect(SLIDES_DA_APRESENTACAO[SLIDES_DA_APRESENTACAO.length - 1].id).toBe("proximos");
    const ids = SLIDES_DA_APRESENTACAO.map((s) => s.id);
    expect(ids.indexOf("posicionamento")).toBeLessThan(ids.indexOf("revelacao"));
    const r = roteiroDaApresentacao(dados, { comNaming: true });
    expect(r.filter((s) => s.id === "moodboard")[0].incluido).toBe(false);
    expect(r.filter((s) => s.id === "nome")[0].incluido).toBe(true);
    expect(roteiroDaApresentacao(dados, { comNaming: false }).some((s) => s.id === "nome")).toBe(false);
    const incluidos = r.filter((s) => s.incluido);
    expect(incluidos.map((s) => s.n)).toEqual(incluidos.map((_, i) => i + 1));
    expect(prontoParaApresentar(r).pronto).toBe(true);
  });

  it("tirar um slide e escrever a fala; os campos do Preencher com IA são as falas dos incluídos", () => {
    const r = roteiroDaApresentacao({ ...dados, apresentacao: { tirados: ["mercado", "tom"], falas: { abertura: "Bem-vindos" } } }, { comNaming: true });
    expect(r.filter((s) => s.id === "tom")[0].incluido).toBe(false);
    expect(r.filter((s) => s.id === "abertura")[0].fala).toBe("Bem-vindos");
    const campos = camposDasFalas(r);
    expect(campos.every((c) => c.chave.indexOf("falas.") === 0)).toBe(true);
    expect(campos.some((c) => c.chave === "falas.tom")).toBe(false);
    expect(SCRIPT_DA_APRESENTACAO).toContain("ArrowRight");
  });

  it("o slide desenha todos os tipos sem quebrar e a logo é a imagem real", () => {
    const urlDe = (c: string | null | undefined) => (c ? `blob:${c}` : null);
    for (const s of SLIDES_DA_APRESENTACAO) {
      const { container, unmount } = render(h(SlideDaMarca, { id: s.id, n: 1, dados, nome: "Forno Vivo", urlDe }));
      expect(container.querySelector(`[data-slide-da-marca="${s.id}"]`)).toBeTruthy();
      unmount();
    }
    const { container } = render(h(SlideDaMarca, { id: "revelacao", n: 13, dados, nome: "Forno Vivo", urlDe }));
    expect(container.querySelector("img")!.getAttribute("src")).toBe(`blob:${C}/marca/identidade/p/logo.png`);
    expect(imagensDaApresentacao(dados)).toContain(`${C}/marca/identidade/p/logo.png`);
    expect(chaveDoQuadro({ imagem: { bucket: "files", caminho: "a/b.jpg" } })).toBe("files::a/b.jpg");
  });
});

// ------------------------------------------------------------------ 7. naming, idiomas, slogans e votação

describe("IDV2: naming com mais técnicas, idiomas, taglines e votação", () => {
  it("16 técnicas; a geração aceita as novas", () => {
    expect(TECNICAS_DE_NAMING.length).toBe(16);
    const c = normalizarCandidatos({ candidatos: [{ nome: "Tic Tac", tecnica: "onomatopeia", justificativa: "som" }, { nome: "Zeus", tecnica: "mitologia" }] });
    expect(c.map((x) => x.tecnica)).toEqual(["onomatopeia", "mitologia"]);
  });

  it("idiomas: leitura só de idioma conhecido; o risco é pergunta Noul do Jev e vira aviso por faixa", () => {
    const l = normalizarLeituras({ nomes: [{ id: "n1", leituras: [{ idioma: "en", pronuncia: "fór-no", significado: "sem sentido próprio" }, { idioma: "xx", pronuncia: "", significado: "" }, { idioma: "en", significado: "repetido" }] }, { id: "bobagem", leituras: [] }] });
    expect(l).toEqual({ n1: [{ idioma: "en", pronuncia: "fór-no", significado: "sem sentido próprio" }] });
    expect(IDIOMAS_DO_TESTE.length).toBe(5);
    const q = perguntasDoRiscoDeIdioma([{ id: "n1", nome: "Forno", idiomas: l.n1 }, { id: "n2", nome: "Sem leitura", idiomas: [] }]);
    expect(Object.keys(q)).toEqual(["n1"]);
    expect(q.n1.type).toBe("noul");
    expect([riscoPelaProbabilidade(0.9), riscoPelaProbabilidade(0.5), riscoPelaProbabilidade(0.1), riscoPelaProbabilidade(null)]).toEqual(["alto", "atencao", "ok", "nao_avaliado"]);
  });

  it("slogans: sem aspas nem repetição, tipo conhecido, ranking do Jev por Score e sem nota no fim", () => {
    const s = normalizarSlogans({ slogans: [{ texto: '"Pão de verdade"', tipo: "tagline" }, { texto: "pão de verdade", tipo: "slogan" }, { texto: "O bairro acorda com a gente", tipo: "estranho" }, { texto: "x" }] });
    expect(s.map((x) => [x.id, x.texto, x.tipo])).toEqual([["s1", "Pão de verdade", "tagline"], ["s2", "O bairro acorda com a gente", "tagline"]]);
    expect(perguntasDosSlogans(s).s1.type).toBe("score");
    expect(ordenarSlogans([{ ...s[0], nota: null }, { ...s[1], nota: 0.8 }]).map((x) => x.id)).toEqual(["s2", "s1"]);
  });

  it("votação: médias separadas da equipe e do cliente; retrato público só com os finalistas e sem nota", () => {
    const r = resumoDosVotos([
      { candidato_id: "n1", origem: "equipe", nota: 5 },
      { candidato_id: "n1", origem: "equipe", nota: 4 },
      { candidato_id: "n1", origem: "cliente", nota: 3 },
      { candidato_id: "n2", origem: "cliente", nota: 9 },
    ]);
    expect(r.n1).toEqual({ equipe: 4.5, n_equipe: 2, cliente: 3, n_cliente: 1 });
    expect(r.n2).toBeUndefined();
    const cands = normalizarCandidatos({ candidatos: [{ nome: "Um", tecnica: "evocativo" }, { nome: "Dois", tecnica: "evocativo" }] }).map((c, i) => ({ ...c, finalista: i === 0, nota: 0.9 }));
    const ret = retratoDaVotacao({ marca: "Forno", alvo: "marca", candidatos: cands });
    expect(ret.finalistas).toEqual([{ id: "n1", nome: "Um", justificativa: "", pronuncia: null }]);
    expect(JSON.stringify(ret)).not.toMatch(/nota|filtros|com_br/);
    expect(linksDoArroba("forno.vivo").map((l) => l.rede)).toEqual(["Instagram", "TikTok", "YouTube", "Facebook"]);
    expect(mensagemDoErroDaVotacao(new Error("votacao_fechada"))).toBe("A votação foi encerrada pela equipe.");
    expect(mensagemDoErroDaVotacao("qualquer coisa")).toMatch(/Tente de novo/);
  });
});

// ------------------------------------------------------------------ 8. brandbook: modelos visuais e dados novos

describe("IDV2: brandbook com modelos visuais, estratégia e página web", () => {
  it("cinco modelos visuais; tema desconhecido vira o clássico; esquema na versão 2", () => {
    expect(TEMAS_DO_BRANDBOOK.map((t) => t.valor)).toEqual(["classico", "editorial", "escuro", "minimal", "vibrante"]);
    expect(ehTema("escuro")).toBe(true);
    expect(normalizarBrandbook({ tema: "neon" }).tema).toBe("classico");
    expect(VERSAO_DO_ESQUEMA).toBe(2);
  });

  it("o rascunho usa a estratégia, o slogan escolhido, as peças e o tema guardado", () => {
    const d = brandbookDoProjeto({
      nomeDaMarca: "Forno",
      clientId: C,
      dados: {
        briefing: { proposito: "do briefing" },
        estrategia: { proposito: "da estratégia", arquetipo: { principal: "cuidador", justificativa: "acolhe" }, posicionamento: { publico: "a", categoria: "b", diferencial: "c" } },
        naming: { nome: "Forno Vivo", slogan: "Pão de verdade" },
        aplicacoes: { itens: [{ tipo: "Post 4:5", descricao: "x", imagem: `${C}/marca/identidade/p/aplicacoes/post.png` }] },
        guideline: { tema: "vibrante" },
      },
    });
    expect(d.plataforma.proposito).toBe("da estratégia");
    expect(d.plataforma.arquetipo).toBe("Cuidador");
    expect(d.plataforma.arquetipo_justificativa).toBe("acolhe");
    expect(d.plataforma.posicionamento).toBe("Para a, Forno Vivo é b que c.");
    expect(d.marca.slogan).toBe("Pão de verdade");
    expect(d.aplicacoes.length).toBe(1);
    expect(d.tema).toBe("vibrante");
    expect(brandbookPublico(d, {}).tema).toBe("vibrante");
  });

  it("o SVG do grafismo só entra se for .svg do próprio cliente", () => {
    const d = normalizarBrandbook({ grafismos: [{ tipo: "pattern", imagem: `${C}/marca/x.png`, svg: `${C}/marca/x.svg` }, { tipo: "pattern", imagem: `${C}/marca/y.png`, svg: "outro/marca/y.svg" }] }, C);
    expect(d.grafismos[0].svg).toBe(`${C}/marca/x.svg`);
    expect(d.grafismos[1].svg).toBeUndefined();
  });

  it("o PDF sai em todos os modelos visuais (24 páginas no paginado)", () => {
    for (const t of TEMAS_DO_BRANDBOOK) {
      const dados = normalizarBrandbook({ tema: t.valor, marca: { nome: "Forno" }, cores: [{ hex: "#157330", papel: "primaria" }, { hex: "#F4F6F4", papel: "neutra" }] });
      expect(paginasDoPdf(gerarPdfDoBrandbook({ modelo: "paginado", dados, versao: 1, imagens: {} }))).toBe(24);
    }
  });

  it("a prévia HTML aplica o tema e a página pública lê os campos novos", () => {
    const dados = normalizarBrandbook({ tema: "escuro", marca: { nome: "Forno" }, plataforma: { posicionamento: "Para a, Forno é b que c." }, cores: [{ hex: "#157330", papel: "primaria" }, { hex: "#191D20", papel: "neutra" }] });
    const { container } = render(h(VisaoDoBrandbook, { dados, modelo: "prancha", urlDe: () => null }));
    expect(container.querySelector("[data-prancha]")!.getAttribute("data-tema")).toBe("escuro");
    const publico = dadosDoPublico(brandbookPublico(dados, {}) as Record<string, any>);
    expect(publico.dados.tema).toBe("escuro");
    expect(publico.dados.plataforma.posicionamento).toBe("Para a, Forno é b que c.");
  });
});

// ------------------------------------------------------------------ 9. diretor de marca

describe("IDV2: diretor de marca com ações novas (custo e Confirmar)", () => {
  const alvos = alvosDoDiretor({ projeto: { id: "33333333-3333-4333-8333-333333333333", titulo: "Forno", etapa: "estrategia" }, caminhos: [], rodada: null, brandbook: null });

  it("montar a estratégia, propor 3 paletas, sugerir fontes e gerar taglines: IA, com Confirmar e custo", () => {
    for (const op of ["montar_estrategia", "propor_paletas", "sugerir_fontes", "gerar_taglines"]) {
      expect(OPERACOES_DO_DIRETOR as readonly string[]).toContain(op);
      expect(OPERACOES_COM_IA as string[]).toContain(op);
      expect(regrasDoDiretor()[op].direta).toBeFalsy();
      expect(DESCRICOES_DAS_OPERACOES[op as keyof typeof DESCRICOES_DAS_OPERACOES]).toMatch(/custo no cartão/);
    }
    const acao = normalizarAcoesDoDiretor({ resumo: "estratégia e paletas", itens: [{ ref: "p1", operacao: "montar_estrategia", para: null }, { ref: "p1", operacao: "propor_paletas", para: "mais sóbrio" }] }, alvos, { montar_estrategia: 0.05, propor_paletas: 0.02 });
    expect(acao).toBeTruthy();
    expect(acao!.itens.map((i) => i.operacao)).toEqual(["montar_estrategia", "propor_paletas"]);
    expect(acao!.custo_estimado_usd).toBeCloseTo(0.07, 6);
    expect(podeExecutarDireto(acao!, regrasDoDiretor(), { pedidoClaro: true }).direto).toBe(false);
  });
});

// ------------------------------------------------------------------ 10. moodboard

describe("IDV2: moodboard com fonte", () => {
  it("guarda só imagem do painel (bucket e caminho) ou https; o resto sai", () => {
    const l = itensDoMoodboard([
      { id: "a", titulo: "Textura", origem: "web", url: "https://x.org/a.jpg", fonte_url: "https://x.org/p", licenca: "CC BY 4.0" },
      { id: "b", origem: "acervo", imagem: { bucket: "files", caminho: `${C}/f.jpg` } },
      { id: "c", origem: "link", url: "javascript:alert(1)" },
      { id: "d", origem: "link", url: "http://inseguro.org/a.jpg" },
    ]);
    expect(l.map((x) => x.id)).toEqual(["a", "b"]);
    expect(l[0].licenca).toBe("CC BY 4.0");
  });
});

// ------------------------------------------------------------------ 11. tela da Estratégia

vi.mock("@/lib/mesa/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/mesa/api")>("@/lib/mesa/api");
  return { ...real, chamarFuncao: vi.fn(async () => ({ projeto: null })) };
});

import { MesaProvider } from "@/components/mesa/MesaContexto";
import { ProjetoProvider, type ProjetoDaMesa } from "@/components/mesa-identidade/Comuns";
import EtapaEstrategia from "@/components/mesa-identidade/EtapaEstrategia";

describe("IDV2: tela da Estratégia", () => {
  it("os 12 arquétipos como escolha, os eixos e a frase montada pelas partes", async () => {
    const salvarParte = vi.fn(async () => projeto as any);
    const projeto = {
      id: "33333333-3333-4333-8333-333333333333", client_id: C, marca_id: null, modo: "zero", com_naming: true, titulo: "Forno", etapa: "estrategia", concluidas: ["inicio", "briefing", "pesquisa"],
      dados: { naming: { nome: "Forno Vivo" }, estrategia: { posicionamento: { publico: "famílias do bairro", categoria: "a padaria de fermentação natural", diferencial: "faz o pão na sua frente" } } },
      versao: 3, estado: "ativo", custo_usd: 0, criado_em: "", atualizado_em: "",
    };
    const valorDoProjeto: ProjetoDaMesa = { projeto: projeto as any, salvarParte, concluir: vi.fn(), reabrir: vi.fn(), irPara: vi.fn(), guardar: vi.fn() };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      h(MemoryRouter, null,
        h(QueryClientProvider, { client: qc },
          h(MesaProvider, { valor: { clientId: C, clientName: "Forno", userId: null, isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: () => undefined, abrirRecarga: () => undefined, abrirChaves: () => undefined, abrirModelos: () => undefined } },
            h(ProjetoProvider, { valor: valorDoProjeto }, h(EtapaEstrategia))))),
    );
    const grupo = screen.getByRole("radiogroup", { name: "Arquétipo principal" });
    expect(grupo.querySelectorAll('[role="radio"]').length).toBe(12);
    fireEvent.click(screen.getByRole("radio", { name: /Sábio/ }));
    expect(screen.getByRole("radio", { name: /Sábio/ }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll("[data-eixo]").length).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "Montar a frase pelas partes" }));
    expect((screen.getByDisplayValue(/Para famílias do bairro, Forno Vivo é a padaria/) as HTMLTextAreaElement).value).toBe("Para famílias do bairro, Forno Vivo é a padaria de fermentação natural que faz o pão na sua frente.");
    // Salvar grava a estratégia inteira (normalizada) na parte "estrategia".
    fireEvent.click(document.querySelector("[data-salvar-estrategia]") as HTMLButtonElement);
    await vi.waitFor(() => expect(salvarParte).toHaveBeenCalled());
    const [parte, valor, opcoes] = salvarParte.mock.calls[0] as unknown as [string, any, any];
    expect(parte).toBe("estrategia");
    expect(valor.arquetipo.principal).toBe("sabio");
    expect(opcoes).toEqual({ substituir: true });
    // Cada seção tem o "Preencher tudo" da peça comum.
    expect(screen.getAllByRole("button", { name: /Preencher tudo/ }).length).toBeGreaterThanOrEqual(8);
  });
});

// ------------------------------------------------------------------ 12. migration e registros

describe("IDV2: migration, função e rotas", () => {
  const sql = ler("supabase/migrations/20260930190000_mesa_identidade_v2.sql");

  it("só amplia: etapas e eventos novos, votação com RLS de leitura e escrita só pelo servidor ou pela RPC", () => {
    expect(sql).toMatch(/idv_projetos_etapa_check[\s\S]*'estrategia'[\s\S]*'apresentacao'/);
    expect(sql).toMatch(/idv_eventos_tipo_check[\s\S]*'votacao_aberta'/);
    expect(sql).toContain("ALTER TABLE public.idv_naming_votos ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.is_staff((select auth.uid())) AND public.can_access_client(client_id)");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.idv_naming_votos FROM authenticated");
    expect(sql).not.toMatch(/DROP TABLE|DROP POLICY IF EXISTS idv_projetos|can_access_client\s*\(\s*\)\s*RETURNS/i);
    expect(sql.match(/SECURITY DEFINER\s+SET search_path = ''/g)!.length).toBe(2);
    expect(sql).toContain("RAISE EXCEPTION 'votacao_fechada'");
    expect(sql).toMatch(/_pessoas >= 40/);
  });

  it("a função registra as ações novas (as de IA com fôlego) e a votação pública tem rota", () => {
    const idx = ler("supabase/functions/mesa-identidade/index.ts");
    for (const a of ["estrategia_propor", "paletas_propor", "fontes_propor", "slogans_gerar", "slogan_escolher", "naming_idiomas", "naming_votacao_abrir", "naming_votar", "moodboard_web"]) expect(idx).toContain(`${a}:`);
    expect(idx).toMatch(/ACOES_LONGAS = new Set\(\[[^\]]*"estrategia_propor"/);
    expect(ler("src/App.tsx")).toContain('<Route path="/nomes/:token" element={<VotacaoDeNomes />} />');
  });

  it("o código novo segue o piso de compatibilidade (sem gap em flex, sem aspect-ratio)", () => {
    for (const arq of ["EtapaEstrategia", "Moodboard", "PaletaDaMarca", "TipoEGrafismos", "PecasDaMarca", "EtapaApresentacao", "ApresentacaoDaMarca", "VotacaoDosNomes", "SlogansDaMarca", "EtapaMockups"]) {
      const fonte = ler(`src/components/mesa-identidade/${arq}.tsx`);
      expect(fonte, arq).not.toMatch(/aspect-\[|aspect-video|aspect-square|aspectRatio/);
      expect(fonte.split("\n").filter((l) => /className="[^"]*\bflex\b[^"]*\bgap-/.test(l)), arq).toEqual([]);
    }
    expect(contraste("#000000", "#FFFFFF")).toBe(21);
  });
});
