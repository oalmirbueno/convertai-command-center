import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente K (26/09), Estúdio da Mesa:
 * 1. Tirar fundo: falha à vista, "Usar o recorte do gerador" ou "Tentar de novo" (em estudio-frente-a).
 * 2. Tela cheia do Estúdio (modo foco), com Voltar e Esc.
 * 3. Referência na hora: arrastar, arquivo, colar imagem ou link.
 * 4. Logo sempre gerada junto com a arte, no tamanho legível, escolhida no kit.
 * 5. Prompt da lâmina priorizado, com proibições e anexos limitados.
 * 6. Refinar texto (lâmina e legenda) com 3 opções.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const direcaoFonte = ler("supabase/functions/_shared/direcao-arte.ts");
const corpoDe = (nome: string) => {
  const i = estudio.indexOf(`function ${nome}(`);
  const fins = [estudio.indexOf("\nasync function ", i + 10), estudio.indexOf("\nfunction ", i + 10), estudio.indexOf("\n// ----", i + 10)].filter((x) => x > 0);
  return estudio.slice(i, Math.min(...fins));
};

const CLIENTE = "11111111-1111-1111-1111-111111111111";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), remove: () => Promise.resolve({ error: null }) }) },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import EstudioReferenciaNaHora from "@/components/mesa/EstudioReferenciaNaHora";
import {
  corpoDaLogo,
  corpoDoImportarLink,
  corpoDoRefinar,
  ehLinkColado,
  juntarReferenciaNaHora,
  laminaLevaLogo,
  OBJETIVOS_DO_REFINO as OBJETIVOS_DA_TELA,
} from "@/components/mesa/estudioUtil";
import {
  anexosDaLamina,
  blocoDaLogo,
  caixaDaLogo,
  logoDaLamina,
  MAX_ANEXOS_DA_LAMINA,
  promptDaLamina,
  tamanhoDaLogo,
  valorDaCor,
  type MarcaParaDirecao,
} from "../../supabase/functions/_shared/direcao-arte";
import {
  IDS_DOS_OBJETIVOS,
  limparOpcoesDoRefino,
  objetivosDoRefino,
  semTravessao,
  tetoDoRefino,
} from "../../supabase/functions/estudio-arte/refinar-texto";

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(MesaProvider, { valor: valorDaMesa() }, filho))));
}

const marca = (temLogo = true): MarcaParaDirecao => ({
  nomeCliente: "Cliente",
  paleta: [{ nome: "Azul", hex: "#0B2A4A", papel: "primaria" }, { nome: "Laranja", hex: "#F28C28", papel: "destaque" }],
  estilo: null,
  regras: null,
  fontes: [{ nome: "Inter", papel: "titulo" }],
  temLogo,
});

const card = (ordem = 1) => ({
  ordem,
  funcao: ordem === 1 ? "capa" : "conteudo",
  texto_exato: "Seu site vende\nou só existe?",
  blocos: [{ papel: "headline" as const, texto: "Seu site vende\nou só existe?" }],
  layout: { zona_texto: "base-esquerda" as const, alinhamento: "esquerda" as const, imagem: "mesa de trabalho", ponto_focal: "mesa", fundo: "parede", tratamento: "editorial" },
  ilustracao: "mesa de trabalho",
});

beforeEach(() => {
  mock.invoke.mockReset();
});

// ------------------------------------------------------------ 4. logo

describe("4. logo gerada junto com a arte, nunca pequenininha", () => {
  it("tamanho pela forma da logo e pelo quadro: empilhada 9% a 12% do lado menor, horizontal até 32% da largura", () => {
    for (const q of [{ largura: 1080, altura: 1350 }, { largura: 1080, altura: 1080 }, { largura: 1080, altura: 1920 }]) {
      const menor = Math.min(q.largura, q.altura);
      const quadrada = tamanhoDaLogo(q, 1);
      expect(quadrada.horizontal).toBe(false);
      expect(quadrada.altura / menor).toBeGreaterThanOrEqual(0.09);
      expect(quadrada.altura / menor).toBeLessThanOrEqual(0.12);
      const empilhada = tamanhoDaLogo(q, 0.8);
      expect(empilhada.altura / menor).toBeCloseTo(0.11, 2);
      const horizontal = tamanhoDaLogo(q, 4);
      expect(horizontal.horizontal).toBe(true);
      expect(horizontal.largura / q.largura).toBeLessThanOrEqual(0.32);
      expect(horizontal.largura / q.largura).toBeGreaterThanOrEqual(0.26);
      expect(horizontal.altura / menor).toBeLessThanOrEqual(0.12);
      // Mínimo legível: nunca abaixo de 80% do pedido.
      expect(horizontal.larguraMinima).toBeGreaterThanOrEqual(Math.round(horizontal.largura * 0.79));
      expect(quadrada.alturaMinima).toBeGreaterThanOrEqual(Math.round(0.07 * menor));
    }
    // Antes: caixa de 22% x 6% (uma logo 4:1 saía com ~59 px de altura; a quadrada com 81 px).
    expect(tamanhoDaLogo({ largura: 1080, altura: 1350 }, 4)).toMatchObject({ largura: 324, altura: 81 });
    expect(tamanhoDaLogo({ largura: 1080, altura: 1350 }, 1)).toMatchObject({ largura: 119, altura: 119 });
    // Proporção inválida: a de uma logo horizontal comum.
    expect(tamanhoDaLogo({ largura: 1080, altura: 1350 }, NaN).aspecto).toBe(3);
  });

  it("a área aberta na máscara (foto real e contínuo) cabe a logo no tamanho pedido", () => {
    for (const post of [null, "quadrado_1x1", "stories_9x16", "retrato_3x4"] as const) {
      const final = post === "quadrado_1x1" ? { largura: 1080, altura: 1080 } : post === "stories_9x16" ? { largura: 1080, altura: 1920 } : post === "retrato_3x4" ? { largura: 1080, altura: 1440 } : { largura: 1080, altura: 1350 };
      for (const aspecto of [1, 4]) {
        const t = tamanhoDaLogo(final, aspecto);
        const c = caixaDaLogo("centro", false, null, post, aspecto);
        expect(((c.x1 - c.x0) / 100) * final.largura).toBeGreaterThanOrEqual(t.largura);
        expect(((c.y1 - c.y0) / 100) * final.altura).toBeGreaterThanOrEqual(t.altura);
        expect(c.x1).toBeLessThanOrEqual(100);
      }
    }
  });

  it("o prompt pede a logo anexada no tamanho, com o lugar da composição, em todos os modos", () => {
    const logo = { tom: "#0B2A4A", clara: false, aspecto: 4 };
    const normal = promptDaLamina(card(), marca(), { total: 3, carrosselInfinito: false, levaLogo: true, logo });
    expect(normal).toContain("3. LOGO");
    expect(normal).toContain("cerca de 324 x 81 px numa arte de 1080 x 1350");
    expect(normal).toContain("nunca um detalhe pequenininho");
    expect(normal).toContain("faz parte da composição, alinhada ao mesmo eixo e à mesma margem do bloco de texto");
    expect(normal).not.toContain("NÃO desenhe logo");
    // Replicando: a referência só orienta o lugar; a logo não diminui.
    const replica = blocoDaLogo({ levaLogo: true, temLogo: true, quadro: { largura: 1080, altura: 1350 }, logo, replicar: true, lugarNoMolde: { x0: 70, y0: 92, x1: 95, y1: 96 } }).join(" ");
    expect(replica).toContain("A referência só orienta o lugar: a logo fica no tamanho acima, nunca menor.");
    expect(replica).toContain("onde a referência põe a marca dela (de 70% a 95% da largura e de 92% a 96% da altura do quadro)");
    // Foto real e contínuo: a área aberta na máscara.
    const foto = promptDaLamina(card(), marca(), { total: 3, carrosselInfinito: false, levaLogo: true, logo, fotoReal: "loja", areaDaLogo: { x0: 11, y0: 7, x1: 46, y1: 15 } });
    expect(foto).toContain("- Lugar: dentro da área reservada para ela (de 11% a 46% da largura e de 7% a 15% da altura do quadro)");
    expect(foto).toContain("Desenhe só o texto e a logo, direto sobre a foto");
    // Anúncio: dentro da zona segura.
    const ads = promptDaLamina(card(), marca(), { total: 1, carrosselInfinito: false, levaLogo: true, logo, anuncio: { formato: "stories_9x16" } });
    expect(ads).toContain("dentro das margens e da zona segura");
    // Sem logo no kit: nada inventado.
    expect(promptDaLamina(card(), marca(false), { total: 3, carrosselInfinito: false, levaLogo: true })).toContain("NÃO desenhe nem invente logo");
    // Lâmina sem logo.
    expect(promptDaLamina(card(2), marca(), { total: 3, carrosselInfinito: false, levaLogo: false })).toContain("Sem logo nesta lâmina: não desenhe logo, símbolo nem marca.");
  });

  it("escolha da logo no kit: a da lâmina, a do conjunto ou a que contrasta com o fundo", () => {
    const duas = [{ id: "principal" as const, clara: false }, { id: "alternativa" as const, clara: true }];
    expect(logoDaLamina(duas, { lamina: "alternativa" }, null)).toBe("alternativa");
    expect(logoDaLamina(duas, { lamina: null, conjunto: "principal" }, 20)).toBe("principal");
    // Auto: fundo escuro pede a clara; fundo claro pede a escura.
    expect(logoDaLamina(duas, {}, 30)).toBe("alternativa");
    expect(logoDaLamina(duas, { conjunto: "auto" }, 230)).toBe("principal");
    // Sem saber o fundo, a principal; pedida que o kit não tem cai no automático.
    expect(logoDaLamina(duas, {}, null)).toBe("principal");
    expect(logoDaLamina([{ id: "principal", clara: false }], { lamina: "alternativa" }, 10)).toBe("principal");
    expect(logoDaLamina([], {}, 10)).toBeNull();
    expect(valorDaCor("#000000")).toBe(0);
    expect(valorDaCor("#FFFFFF")).toBe(255);
    expect(valorDaCor("azul")).toBeNull();
  });

  it("servidor: nenhuma logo colada pelo código nas lâminas; a escolha grava pelo configurar e a ação logos lista o kit", () => {
    const g = corpoDe("gerarCard");
    expect(g).not.toMatch(/aplicarLogo|logo: \{ logos/);
    expect(estudio).not.toContain("aplicarLogo(");
    expect(g).toContain("marca.temLogo = logoNaChamada;");
    const c = corpoDe("configurar");
    expect(c).toContain("logoConjunto = e;");
    expect(c).toContain("if (logoCard === null) delete mudou.logo;");
    expect(c).toContain("logo_escolhida: logoConjunto");
    expect(estudio).toContain("  logos: logosDoTrabalho,");
    expect(corpoDe("logosDoTrabalho")).toContain("const kit = await lerKit(t.client_id, t);");
    // A logo que vai ao gerador é aparada (sem margem vazia) antes de reduzir.
    expect(corpoDe("baixarLogo")).toContain("{ aparar: true }");
  });

  it("tela: corpo da logo e só nas lâminas que levam logo", () => {
    expect(corpoDaLogo("lamina", "alternativa", 2)).toEqual({ card: { ordem: 2, logo: "alternativa" } });
    expect(corpoDaLogo("lamina", null, 2)).toEqual({ card: { ordem: 2, logo: null } });
    expect(corpoDaLogo("conjunto", null)).toEqual({ conjunto: { logo_escolhida: "auto" } });
    expect(laminaLevaLogo(1, 5)).toBe(true);
    expect(laminaLevaLogo(3, 5)).toBe(false);
    expect(laminaLevaLogo(5, 5)).toBe(true);
  });
});

// ------------------------------------------------------------ 5. prompt e anexos

describe("5. prompt priorizado, proibições e anexos limitados", () => {
  it("a imagem vem primeiro (ordem de 23 e 24/09), o desempate continua, as proibições são explícitas e não há travessão", () => {
    const p = promptDaLamina(card(), marca(), { total: 3, carrosselInfinito: false, levaLogo: true, logo: { tom: null, clara: true, aspecto: 1 } });
    // 27/09: a cena voltou a abrir o prompt; o desempate (texto, logo, marca, composição) segue escrito por nome.
    const ordem = ["Em conflito entre regras, vale nesta ordem: o texto exato, a logo oficial", "1. IMAGEM E COMPOSIÇÃO", "2. TEXTO EXATO", "3. LOGO", "4. MARCA", "5. FORMATO", "PADRÃO DE DESIGN", "PROIBIDO"];
    for (let i = 1; i < ordem.length; i++) expect(p.indexOf(ordem[i - 1]), ordem[i]).toBeLessThan(p.indexOf(ordem[i]));
    // O texto da logo é a exceção declarada; a regra da cena não esvazia mais a lâmina.
    expect(p).toContain("Nenhum texto além do texto exato e das letras da própria logo oficial");
    expect(p).toContain("pessoa a mais, objeto solto sem função");
    expect(p).not.toContain("Nenhuma pessoa, rosto, mão, objeto, produto, animal, ícone ou marca que a direção não pediu");
    // As técnicas do padrão voltaram (planos de profundidade, recorte intencional, rei da lâmina).
    expect(p).toContain("Profundidade: foto e texto na mesma cena, em planos (fundo, texto, sujeito), com recorte intencional");
    expect(p).toContain("um só ponto focal (o rei da lâmina)");
    expect(p).toContain("cinco dedos em cada mão");
    expect(p).toContain("A barra ( / ) marca a quebra de linha");
    expect(p).not.toContain("(as barras indicam quebra de linha, não desenhe as barras)");
    expect(p).not.toMatch(/[—–]/);
    // A lista das lâminas anteriores ("mude a pose") saiu: a capa anexada guia a série.
    const miolo = promptDaLamina(card(2), marca(), { total: 3, carrosselInfinito: false, levaLogo: false, anteriores: ["mulher de costas"], fioVisual: "mesma mulher" });
    expect(miolo).not.toContain("Lâminas anteriores desta série mostraram");
    expect(miolo).not.toContain("Só este assunto: nada além do que está descrito.");
  });

  it("anexos: no máximo 6 imagens com a editada, um de cada tipo, na ordem de prioridade", () => {
    expect(MAX_ANEXOS_DA_LAMINA).toBe(6);
    const tipos = ["selo", "identidade", "identidade", "fonte", "fonte", "capa", "logo", "referencia_equipe", "referencia_equipe", "referencia_equipe", "elemento", "foto_cliente"] as const;
    const plano = anexosDaLamina(tipos.map((tipo, i) => ({ tipo, i })), { base: false });
    expect(plano.map((c) => c.tipo)).toEqual(["foto_cliente", "elemento", "referencia_equipe", "referencia_equipe", "logo", "capa"]);
    const comBase = anexosDaLamina(tipos.map((tipo) => ({ tipo })), { base: true });
    expect(comBase).toHaveLength(5);
    const miolo = anexosDaLamina([{ tipo: "fonte" as const }, { tipo: "fonte" as const }, { tipo: "capa" as const }], { base: false });
    expect(miolo.map((c) => c.tipo)).toEqual(["capa", "fonte"]);
  });

  it("gerar_card: a anterior saiu, referência automática só na capa e uma só", () => {
    const g = corpoDe("gerarCard");
    expect(g).not.toContain("const anterior = ordem > 1 ? versaoAtual(t, ordem - 1) : null;");
    expect(g).toContain('? { refs: [] as Referencia[], jev: "serie_pela_capa" }');
    expect(g).toContain("for (const ref of escolhida.refs.slice(0, 1)) {");
    expect(g).toContain("const escolhidosDaLamina = anexosDaLamina(candidatos, { base: temBase });");
    expect(g).toContain("for (const c of escolhidosDaLamina) {");
    // Replicar: a referência 1 vira a imagem 1 editada (molde), quase idêntica.
    expect(g).toContain("if (i1 > 0) escolhidosDaLamina.unshift(escolhidosDaLamina.splice(i1, 1)[0]);");
    expect(g).toContain("...(molde ? { editar: { bytes: molde }, referencias: imagens.slice(1) } : {}),");
    expect(g).toContain("anexos: imagens.length + deslocamento,");
  });
});

// ------------------------------------------------------------ 6. refinar texto

describe("6. Refinar texto: 3 opções com técnica, sem laço", () => {
  it("objetivos conhecidos, até 4, espelhados na tela", () => {
    expect(OBJETIVOS_DA_TELA.map((o) => o.id)).toEqual(IDS_DOS_OBJETIVOS);
    expect(objetivosDoRefino(["gancho", "cta", "gancho", "xpto"])).toEqual(["gancho", "cta"]);
    expect(objetivosDoRefino([])).toEqual(["mais_forte"]);
    expect(objetivosDoRefino(["mais_curto", "mais_forte", "mais_claro", "gancho", "cta"])).toHaveLength(4);
  });

  it("limpa as opções: sem travessão, sem hashtag, sem repetir o atual, no teto e no máximo 3", () => {
    expect(semTravessao("Cuide do sorriso — agende hoje")).toBe("Cuide do sorriso, agende hoje");
    const original = "Seu sorriso merece cuidado";
    const bruto = {
      opcoes: [
        { texto: "Seu sorriso merece cuidado", tecnica: "igual", porque: "x" },
        { texto: "Sorria sem medo — avaliação grátis #dentista", tecnica: "Gancho de cena", porque: "fala da dor" },
        { texto: "Sorria sem medo, avaliação grátis", tecnica: "repetida", porque: "" },
        { texto: "Seu sorriso\nem boas mãos @clinica", tecnica: "Benefício", porque: "confiança" },
        { texto: "x".repeat(tetoDoRefino("lamina", original) + 1), tecnica: "longa", porque: "" },
        { texto: "Agende sua avaliação", tecnica: "CTA", porque: "ação" },
        { texto: "Quarta opção que não entra", tecnica: "sobra", porque: "" },
      ],
    };
    const limpas = limparOpcoesDoRefino(bruto, "lamina", original);
    expect(limpas.map((o) => o.texto)).toEqual(["Sorria sem medo, avaliação grátis", "Seu sorriso\nem boas mãos", "Agende sua avaliação"]);
    for (const o of limpas) expect(o.texto + o.tecnica + o.porque).not.toMatch(/[—–]/);
    expect(limparOpcoesDoRefino(null, "legenda", original)).toEqual([]);
  });

  it("servidor: ação longa com 5 min, base de copy, framework e cérebro do cliente; nada gravado além do custo", () => {
    expect(estudio).toContain("  refinar_texto: refinarTexto,");
    expect(estudio).toMatch(/const ACOES_LONGAS = new Set\(\[[^\]]*"refinar_texto"/);
    const r = corpoDe("refinarTexto");
    expect(r).toContain("timeoutMs: 300_000,");
    expect(r).toContain('resumoDoCerebro(servico(), t.client_id, ["copy", "arte", "campanha"]');
    expect(r).toContain("frameworkPorId(");
    expect(r).toContain("sistema: `${INSTRUCOES_REFINO}\\n\\n${baseDoRefino()}`,");
    expect(r).toContain("await mutarTrabalho(t.id, (x) => ({ custo_usd: arred(num(x.custo_usd) + r.custoUsd) }));");
    // Uma chamada só: sem laço de correção.
    expect(r.match(/await chamarTexto\(/g) ?? []).toHaveLength(1);
    expect(corpoDe("baseDoRefino")).toContain("FORMULAS_DE_TITULO, CTA_PRINCIPIOS, ANTI_GENERICO, REVISAO_DE_MARCA, VOZ_DE_MARCA");
  });

  it("tela: corpo do refino só com o que a equipe escolheu", () => {
    expect(corpoDoRefinar("t-1", { alvo: "lamina", ordem: 2, texto: "  Olá  ", objetivos: ["gancho"], framework: "pas", pedido: "" })).toEqual({
      acao: "refinar_texto",
      trabalho_id: "t-1",
      alvo: "lamina",
      objetivos: ["gancho"],
      ordem: 2,
      texto: "Olá",
      framework: "pas",
    });
    expect(corpoDoRefinar("t-1", { alvo: "legenda", ordem: 2, objetivos: ["cta"] })).toEqual({ acao: "refinar_texto", trabalho_id: "t-1", alvo: "legenda", objetivos: ["cta"] });
    const aba = ler("src/components/mesa/AbaEstudio.tsx");
    expect(aba).toContain('alvo="legenda"');
    expect(aba).toContain('alvo="lamina"');
    expect(ler("src/components/mesa/CardDoEstudio.tsx")).toContain("refinarTexto?: ReactNode;");
  });
});

// ------------------------------------------------------------ 3. referência na hora

describe("3. referência na hora: arrastar, arquivo, colar imagem ou link", () => {
  it("regras: link colado, a nova entra por último e passa de 2 sai a mais antiga", () => {
    expect(ehLinkColado("https://br.pinterest.com/pin/123/")).toBe(true);
    expect(ehLinkColado("https://www.behance.net/gallery/1/x")).toBe(true);
    expect(ehLinkColado("olha isso https://x.com")).toBe(false);
    expect(ehLinkColado("texto qualquer")).toBe(false);
    expect(juntarReferenciaNaHora([], "a")).toEqual({ ids: ["a"], saiu: null });
    expect(juntarReferenciaNaHora(["a"], "b")).toEqual({ ids: ["a", "b"], saiu: null });
    expect(juntarReferenciaNaHora(["a", "b"], "c")).toEqual({ ids: ["b", "c"], saiu: "a" });
    expect(juntarReferenciaNaHora(["a", "b"], "a")).toEqual({ ids: ["b", "a"], saiu: null });
    expect(corpoDoImportarLink(CLIENTE, " https://x.com/a.png ")).toEqual({ acao: "referencias", subacao: "importar_link", client_id: CLIENTE, url: "https://x.com/a.png" });
  });

  it("colar o link no campo vira referência e entra na lâmina na hora", async () => {
    mock.invoke.mockResolvedValue({ data: { referencia: { id: "r-9", papel: "tecnica", ativa: true }, ja_existia: false }, error: null });
    const onGravar = vi.fn().mockResolvedValue(undefined);
    montar(h(EstudioReferenciaNaHora, { escolhidas: ["r-1"], onGravar, alvoRotulo: "lâmina 2", compacto: true }));
    const campo = screen.getByRole("textbox", { name: /Colar link ou imagem de referência/ });
    fireEvent.paste(campo, { clipboardData: { items: [], files: [], getData: () => "https://br.pinterest.com/pin/123/" } });
    await waitFor(() =>
      expect(mock.invoke).toHaveBeenCalledWith("estudio-arte", {
        body: expect.objectContaining({ acao: "referencias", subacao: "importar_link", client_id: CLIENTE, url: "https://br.pinterest.com/pin/123/" }),
      }),
    );
    await waitFor(() => expect(onGravar).toHaveBeenCalledWith(["r-1", "r-9"]));
  });

  it("colar sem clipboardData (navegador antigo) não quebra e não chama nada", () => {
    const onGravar = vi.fn();
    montar(h(EstudioReferenciaNaHora, { escolhidas: [], onGravar, alvoRotulo: "conjunto" }));
    const campo = screen.getByRole("textbox", { name: /Colar link ou imagem de referência/ });
    fireEvent.paste(campo, {});
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(onGravar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Arquivo/ })).toBeTruthy();
  });

  it("servidor: importar_link aceita Pinterest, Behance, imagem e página com og:image, só https público", () => {
    const l = corpoDe("importarLink");
    expect(l).toContain("const u = urlPublicaSegura(texto(corpo.url, 2000));");
    expect(l).toContain('if (tipo === "pinterest") return await importarPinterest(');
    expect(l).toContain("imagensDoBehance(html, 3)");
    expect(l).toContain("lerMetaTags(html, pagina.url.toString()).imagens");
    // A restrição da tabela aceita workspace, pinterest, upload e arquivo.
    expect(l).toContain('origem: "upload", url_origem: canonica,');
    expect(corpoDe("buscarLinkSeguro")).toContain("if (!(await hostResolvePublico(url.hostname))) return null;");
    expect(corpoDe("referencias")).toContain('if (sub === "importar_link") return await importarLink(ch, corpo);');
    // No painel Referências do Estúdio (a Mesa Ads não liga).
    expect(ler("src/components/mesa/ReferenciasDoEstudio.tsx")).toContain("referenciaNaHora = false,");
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("        referenciaNaHora\n");
  });
});

// ------------------------------------------------------------ 2. tela cheia

describe("2. tela cheia do Estúdio (modo foco)", () => {
  const aba = ler("src/components/mesa/AbaEstudio.tsx");
  it("liga o modo foco da casca, esconde as pautas, ocupa a janela e volta pelo botão ou Esc", () => {
    expect(aba).toContain('useModoFoco("estudio", focoLigado);');
    expect(aba).toContain('if (e.key !== "Escape" && e.key !== "Esc") return;');
    expect(aba).toContain('className="fixed inset-0 z-40 flex flex-col bg-background p-2"');
    expect(aba).toContain('{foco ? "Voltar (Esc)" : "Tela cheia"}');
    // Esc de uma janela aberta fecha só ela.
    expect(aba).toContain("if (e.defaultPrevented || temJanelaAberta()) return;");
  });
});

// ------------------------------------------------------------ compatibilidade

describe("Safari 11 e Chrome 64 nos arquivos novos da tela", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, .at(), Object.hasOwn, aspect-ratio, :has nem min()/max()/clamp() em classe", () => {
    for (const arq of [
      "src/components/mesa/EstudioReferenciaNaHora.tsx",
      "src/components/mesa/EstudioLogoDaLamina.tsx",
      "src/components/mesa/EstudioRefinarTexto.tsx",
      "src/components/mesa/estudioUtil.ts",
      "src/components/mesa/AbaEstudio.tsx",
      "src/components/mesa/EstudioFotos.tsx",
    ]) {
      const f = ler(arq);
      expect(f, arq).not.toMatch(/\(\?<[=!]/);
      expect(f, arq).not.toMatch(/\\p\{/);
      expect(f, arq).not.toMatch(/\(\?<[A-Za-z]/);
      expect(f, arq).not.toMatch(/\.at\(/);
      expect(f, arq).not.toContain("Object.hasOwn");
      expect(f, arq).not.toMatch(/aspect-\[|aspect-square|aspect-video|aspectRatio/);
      expect(f, arq).not.toMatch(/:has\(|\[(min|max|clamp)\(/);
    }
    expect(direcaoFonte).not.toMatch(/[—–]/);
  });
});
