import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocosDoTexto,
  caixaDaZona,
  contraste,
  direcaoDoRoteiro,
  promptDaLamina,
  tamanhoDoBloco,
  tamanhosDaLamina,
  type MarcaParaDirecao,
  type ZonaTexto,
} from "../../supabase/functions/_shared/direcao-arte";
import { CONHECIMENTO_DIRETOR, PADRAO_NA_IMAGEM } from "../../supabase/functions/_shared/conhecimento-design";
import { caixaDaZona as caixaDaTela } from "@/lib/mesa/layout";

/**
 * Mesa do cliente, 23/09: contexto automático, base de design e compositor de
 * prompt. O compositor é código puro: estes testes chamam as funções de
 * verdade e conferem as regras da base (docs/mesa-do-cliente/conhecimento).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const ZONAS: ZonaTexto[] = ["topo-esquerda", "topo-centro", "centro-esquerda", "centro", "base-esquerda", "base-centro", "base-direita", "coluna-esquerda", "coluna-direita"];

const marca = (parcial: Partial<MarcaParaDirecao> = {}): MarcaParaDirecao => ({
  nomeCliente: "Cliente Teste",
  paleta: [
    { nome: "Verde", hex: "#1F4D3A", papel: "primaria" },
    { nome: "Areia", hex: "#F2EBDD", papel: "fundo" },
    { nome: "Terracota", hex: "#C8643B", papel: "destaque" },
  ],
  estilo: "Fotografia natural, luz de manhã, tipografia serifada elegante.",
  regras: "Nunca usar neon.",
  fontes: [{ nome: "Montserrat", papel: "titulo" }, { nome: "Open Sans", papel: "texto" }],
  temLogo: true,
  ...parcial,
});

describe("compositor: hierarquia da base (headline pelo menos 3x o apoio)", () => {
  it("em todas as faixas de tamanho, capa e miolo, na lâmina inteira", () => {
    for (const n of [8, 20, 35, 50, 80]) {
      for (const capa of [true, false]) {
        const blocos = [
          { papel: "headline" as const, texto: "x".repeat(n) },
          { papel: "subtitulo" as const, texto: "y".repeat(30) },
          { papel: "apoio" as const, texto: "z".repeat(60) },
          { papel: "cta" as const, texto: "Chame agora" },
        ];
        const t = tamanhosDaLamina(blocos, capa);
        expect(t[0].px).toBeGreaterThanOrEqual(108);
        for (const k of [1, 2, 3]) {
          expect(t[k].px).toBeGreaterThanOrEqual(36);
          expect(t[0].px / t[k].px).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("nada abaixo de 28 px", () => {
    for (const papel of ["headline", "subtitulo", "apoio", "numero", "cta", "selo"] as const) {
      expect(tamanhoDoBloco({ papel, texto: "x".repeat(120) }, false).px).toBeGreaterThanOrEqual(28);
    }
  });

  it("headline junta no máximo 54 caracteres; o resto vai para o apoio", () => {
    const blocos = blocosDoTexto("Uma frase bem comprida para testar\ncomo o compositor quebra\no texto da lâmina", "conteudo");
    expect(blocos[0].papel).toBe("headline");
    expect(blocos[0].texto.replace(/\n/g, " ").length).toBeLessThanOrEqual(54);
  });
});

describe("compositor: margens, contador e recorte da grade", () => {
  it("nenhuma zona de carrossel invade o contador (x > 83,3% e y < 8,1%)", () => {
    for (const z of ZONAS) {
      const c = caixaDaZona(z, false, true);
      if (c.x1 > 83.3) expect(c.y0).toBeGreaterThanOrEqual(8.1);
    }
  });

  it("todas as zonas ficam dentro das margens de 90/100/106 px", () => {
    for (const z of ZONAS) {
      for (const capa of [true, false]) {
        const c = caixaDaZona(z, capa, true);
        expect(c.x0).toBeGreaterThanOrEqual(8.3);
        expect(c.x1).toBeLessThanOrEqual(91.7);
        expect(c.y0).toBeGreaterThanOrEqual(7.4);
        expect(c.y1).toBeLessThanOrEqual(92.1);
      }
    }
  });

  it("a capa protege mais 34 px nas laterais (recorte 3:4 da grade do perfil)", () => {
    expect(caixaDaZona("base-esquerda", true).x0).toBeCloseTo(11.4, 1);
    expect(caixaDaZona("base-esquerda", false).x0).toBeCloseTo(8.3, 1);
  });

  it("a prévia da tela usa exatamente as zonas do compositor", () => {
    for (const z of ZONAS) {
      for (const capa of [true, false]) {
        expect(caixaDaTela(z, capa, true)).toEqual(caixaDaZona(z, capa, true));
      }
    }
  });
});

describe("compositor: marca e segurança do prompt", () => {
  const card = { ordem: 1, funcao: "capa", texto_exato: "Quarto 02\npor dentro", ilustracao: "foto real do quarto" };

  it("gera direto em 4:5, com paleta em hex e fontes da marca", () => {
    const p = promptDaLamina(card, marca(), { total: 5, carrosselInfinito: false, levaLogo: true });
    expect(p).toContain("4:5 (1080 x 1350)");
    expect(p).toContain("#1F4D3A");
    expect(p).toContain("títulos em Montserrat");
    expect(p).toContain("Canto superior direito livre");
    expect(p).not.toContain("1024 x 1536");
  });

  it("sem arquivo de logo, manda NÃO desenhar logo (senão o gerador inventa uma)", () => {
    const p = promptDaLamina(card, marca({ temLogo: false }), { total: 5, carrosselInfinito: false, levaLogo: true });
    expect(p).toContain("NÃO desenhe nem invente logo");
    expect(p).not.toContain("Logo oficial anexada");
  });

  it("texto com contraste baixo troca para o neutro de maior contraste", () => {
    expect(contraste("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
    const p = promptDaLamina(
      { ...card, layout: { zona_texto: "base-esquerda", alinhamento: "esquerda", imagem: "x", ponto_focal: "x", fundo: "x", tratamento: "x", cor_fundo: "#F2EBDD", cor_texto: "#F5F0E6" } },
      marca(),
      { total: 1, carrosselInfinito: false, levaLogo: false },
    );
    expect(p).toContain("cor #111418");
  });

  it("a secundária não vira cor de destaque", () => {
    const semDestaque = marca({ paleta: [{ nome: "A", hex: "#112233", papel: "primaria" }, { nome: "B", hex: "#AA3300", papel: "secundaria" }] });
    const p = promptDaLamina({ ...card, funcao: "cta", texto_exato: "Fale conosco\nChame no WhatsApp", ordem: 3 }, semDestaque, { total: 3, carrosselInfinito: false, levaLogo: true });
    expect(p).not.toContain("cor #AA3300");
  });
});

describe("direção do roteiro (sem custo de IA)", () => {
  it("capa primeiro, fechamento por último e prompt pronto em cada lâmina", () => {
    const d = direcaoDoRoteiro(
      [
        { ordem: 1, funcao: "capa", texto: "Título" },
        { ordem: 2, funcao: "desenvolvimento", texto: "Ponto um\nexplicação curta" },
        { ordem: 3, funcao: "CTA final", texto: "Chame agora" },
      ],
      marca(),
      { postUnico: false, carrosselInfinito: false, levaLogo: (o, t) => o === 1 || o === t },
    );
    expect(d.origem).toBe("roteiro");
    expect(d.cards.map((c) => c.funcao)).toEqual(["capa", "conteudo", "cta"]);
    for (const c of d.cards) expect(c.prompt_imagem.length).toBeGreaterThan(500);
  });
});

describe("base de conhecimento do diretor", () => {
  it("regras com números da base e sem travessão", () => {
    expect(CONHECIMENTO_DIRETOR).toContain("90 px");
    expect(CONHECIMENTO_DIRETOR).toContain("60-30-10");
    // Teto subiu de 6.500 para 7.000 em 25/09 (dono: "reforçar o designer"): logo sem caixa, série pela capa, recorte, variedade.
    expect(CONHECIMENTO_DIRETOR.split(/\s+/).length).toBeLessThanOrEqual(7000);
    expect(PADRAO_NA_IMAGEM.split("\n").length).toBeLessThanOrEqual(14);
    for (const t of [CONHECIMENTO_DIRETOR, PADRAO_NA_IMAGEM]) {
      expect(t).not.toContain("—");
      expect(t).not.toContain("–");
    }
  });

  it("o diretor recebe a base como prefixo fixo (cacheado) e o ajuste recebe o padrão", () => {
    const estudio = ler("supabase/functions/estudio-arte/index.ts");
    // A base continua na frente (prefixo cacheado); as regras aprendidas com o cliente vão por último.
    // Frente H: a base de marketing do diretor entra logo depois da de design; cérebro e dossiê no fim.
    expect(estudio).toContain('sistema: [CONHECIMENTO_DIRETOR, CONHECIMENTO_DA_DIRECAO, prompt, INSTRUCOES_DIRECAO, preferencias.texto].filter(Boolean).join("\\n\\n"),');
    expect(estudio).toContain('sistema: [INSTRUCOES_AJUSTE, PADRAO_NA_IMAGEM, preferencias].filter(Boolean).join("\\n\\n"),');
  });
});

describe("contexto automático do cliente", () => {
  const modulo = ler("supabase/functions/_shared/contexto-cliente.ts");
  const agente = ler("supabase/functions/agente-contexto/index.ts");

  it("lê documentos de identidade primeiro, dossiê, artes aprovadas e pastas de referência", () => {
    expect(modulo).toContain('.from("file_content_chunks")');
    expect(modulo).toContain("PRIORIDADE_DOC");
    expect(modulo).toContain('.from("client_dossiers")');
    expect(modulo).toContain('f.approval_status === "approved" || f.visibility === "client_shared"');
    expect(modulo).toContain("PASTA_DE_REFERENCIA");
  });

  it("montar nunca sobrescreve o que a equipe preencheu (vira sugestão), salvo com forcar", () => {
    expect(agente).toContain("if (forcar || vazio(kit?.paleta)) patch.paleta = paleta;");
    expect(agente).toContain("else sugestoes.paleta = paleta;");
  });

  it("ler não gasta IA; montar e conversar passam pelo motor (carteira do cliente)", () => {
    const ler_ = agente.slice(agente.indexOf("async function ler("), agente.indexOf("// ----------------------------------------------------- leitura de referências"));
    expect(ler_).not.toContain("chamarTexto(");
    expect(agente).toContain('tarefa: "contexto"');
  });

  it("o estúdio e o calendário usam o contexto consolidado", () => {
    expect(ler("supabase/functions/estudio-arte/index.ts")).toContain("lerContextoConsolidado(servico(), clientId)");
    expect(ler("supabase/functions/agente-calendario/index.ts")).toContain('select("paleta, estilo, regras, contexto")');
  });
});

describe("regressão de 23/09: série contínua, capa da marca e logo legível", () => {
  const capa = { ordem: 1, funcao: "capa", texto_exato: "Roupa acumulada?", ilustracao: "mulher com cesto" };
  const miolo = { ordem: 2, funcao: "conteudo", texto_exato: "Separe antes", ilustracao: "mesma mulher de frente" };

  it("o fio visual mantém protagonista, cenário e luz em todas as lâminas; muda só a pose", () => {
    const p = promptDaLamina(miolo, marca(), {
      total: 5, carrosselInfinito: false, levaLogo: false,
      fioVisual: "Mulher de 30 anos, cabelo preso, camiseta branca, lavanderia clara com máquinas verdes, luz da manhã.",
      anteriores: ["mulher de costas carregando o cesto"],
    });
    expect(p).toContain("CONTINUIDADE DA SÉRIE");
    expect(p).toContain("Mantenha a mesma protagonista, cenário e luz");
    expect(p).not.toContain("mude o plano e o assunto");
    expect(p).not.toContain("não repita cena");
  });

  it("a capa existe para parar a rolagem, nunca escurecendo a imagem (correção do dono, 23/09)", () => {
    for (const total of [5, 1]) {
      const p = promptDaLamina(capa, marca(), { total, carrosselInfinito: false, levaLogo: true });
      expect(p).toContain("CAPA QUE PARA A ROLAGEM");
      expect(p).toContain("Não escureça a imagem para criar destaque");
      expect(p).not.toContain("fundo escuro e travado");
      expect(p).not.toMatch(/escurecid|foto escurecida/);
    }
    expect(CONHECIMENTO_DIRETOR).toContain("fazer quem está rolando o feed PARAR");
    expect(CONHECIMENTO_DIRETOR).toContain("Nunca escurecer a imagem para criar destaque");
    expect(CONHECIMENTO_DIRETOR).not.toContain("Fundo escuro só quando");
    expect(ler("supabase/functions/estudio-arte/index.ts")).not.toContain("Não escureça a capa se a marca é clara");
  });

  it("logo escura ou colorida pede fundo claro atrás dela; logo clara pede fundo escuro", () => {
    const escura = promptDaLamina(capa, marca(), { total: 5, carrosselInfinito: false, levaLogo: true, logo: { tom: "#1E5AA8", clara: false } });
    expect(escura).toContain("tom dominante #1E5AA8");
    // Desde 25/09 o prompt não pede fundo claro atrás da logo (o gerador desenhava uma caixa branca).
    expect(escura).toContain("nunca sobre a mesma cor nem o mesmo valor da logo");
    expect(escura).toContain("A logo entra direto sobre a arte, sem caixa, cartão, retângulo ou fundo próprio atrás");
    expect(escura).not.toContain("o fundo atrás dela é claro e liso");
    const clara = promptDaLamina(capa, marca(), { total: 5, carrosselInfinito: false, levaLogo: true, logo: { tom: "#FFFFFF", clara: true } });
    expect(clara).toContain("A logo tem letras ou partes claras: ela fica sobre uma área ESCURA da própria arte");
  });

  it("a base e o estrategista pedem série contínua com variação e quantidade de lâminas pelo conteúdo", () => {
    expect(CONHECIMENTO_DIRETOR).toContain("Continuidade com variação");
    expect(CONHECIMENTO_DIRETOR).toContain("Em geral 4 a 6");
    const calendario = ler("supabase/functions/agente-calendario/index.ts");
    expect(calendario).toContain("As ilustracoes formam UMA série");
    expect(calendario).not.toContain("Cada card tem ilustracao diferente (outro assunto");
  });
});
