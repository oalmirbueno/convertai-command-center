import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  layoutPadrao,
  mapearNoMolde,
  type MoldeDaReferencia,
  normalizarMolde,
  promptDaLamina,
  promptDoReplicar,
  VERSAO_DO_MOLDE,
} from "../../supabase/functions/_shared/direcao-arte";
import {
  candidatosDoTermo,
  decidirTermo,
  dividirNasPartes,
  hierarquiaDeCor,
  jogadaSolta,
  linhaDaHierarquia,
  perguntaDoTermo,
  separarCoresRepetidas,
  termoPadrao,
} from "../../supabase/functions/_shared/jogada-do-texto";
import {
  aplicarMioloEnxuto,
  blocoDoMioloDesenhado,
  enxugarMiolo,
  passaDoLimite,
  termoDecorativoDaLamina,
  textoEsperadoNaConferencia,
} from "../../supabase/functions/estudio-arte/composicao-dinamica";
import { MUDANCAS_DO_GERADOR_DO_ESTUDIO } from "../../supabase/functions/_shared/motores";
import { laminasLongasDoRoteiro, textoDoMioloEnxuto } from "../../supabase/functions/estudio-arte/modulos/limite-do-miolo";
import { CASOS_DO_REPLICAR, MARCA_CASO, MOLDE_CASO } from "./fixtures/replicarCasos";

/**
 * Frente R3 (26/09): composição dinâmica no Estúdio.
 * 1. Jogada do texto por nível (posições por bloco, título quebrado, camada).
 * 2. Palavra decorativa trocada pelo termo do assunto (nunca a da referência).
 * 3. Cor por papel dentro da paleta.
 * 4. Limite de texto das lâminas 2+ (enxugar) e o miolo desenhado.
 * 5. Ligação no servidor e registro.
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const servidor = ler("supabase/functions/estudio-arte/index.ts");

const bloco = (x: Partial<MoldeDaReferencia["blocos"][number]>): MoldeDaReferencia["blocos"][number] => ({
  papel: "titulo", x0: 6, y0: 6, x1: 60, y1: 20, altura_da_letra: 8, linhas: 1, caixa_alta: true, familia: "sem serifa", largura_da_letra: "condensada", peso: "black", cor: "#FFFFFF", alinhamento: "esquerda",
  ...x,
});

/** Referência com o título quebrado: uma parte à esquerda no alto, outra embaixo; e uma palavra gigante de fundo. */
const MOLDE_QUEBRADO: MoldeDaReferencia = {
  ...MOLDE_CASO,
  versao: 2,
  cor_do_fundo: "#101010",
  blocos: [
    bloco({ x0: 6, y0: 8, x1: 55, y1: 22 }),
    bloco({ x0: 30, y0: 70, x1: 94, y1: 84, alinhamento: "direita", cor: "#FFD400" }),
    bloco({ papel: "texto", x0: 6, y0: 88, x1: 40, y1: 95, altura_da_letra: 1.8, linhas: 2, caixa_alta: false, peso: "regular", largura_da_letra: "normal", cor: "#DDDDDD" }),
    bloco({ papel: "decorativo", x0: 0, y0: 30, x1: 100, y1: 62, altura_da_letra: 26, peso: "black", cor: "#333333", camada: "atras_do_assunto", texto_decorativo: "melhor" }),
  ],
};

const MEIO = {
  ordem: 2,
  funcao: "conteudo",
  texto_exato: "Sorriso saudável começa cedo\nConsulta de rotina evita dor.",
  blocos: [
    { papel: "headline" as const, texto: "Sorriso saudável começa cedo" },
    { papel: "apoio" as const, texto: "Consulta de rotina evita dor." },
  ],
};

const entrada = (fidelidade: "identica" | "proxima" | "inspirada" | "criativa", extra: Record<string, unknown> = {}) => ({
  card: MEIO,
  marca: MARCA_CASO,
  total: 4,
  referencias: [{ indice: 1, molde: MOLDE_QUEBRADO }],
  editando: fidelidade === "identica",
  fotos: [],
  logo: { leva: false, indice: null, medida: null, descricao: null },
  quadro: { largura: 1080, altura: 1350 },
  fidelidade,
  ...extra,
});

// ------------------------------------------------------------------ 1. jogada

describe("1. Jogada do texto por nível", () => {
  it("molde 2: lê o decorativo e a camada; o molde antigo continua sem os campos; decorativo sozinho não é texto", () => {
    expect(VERSAO_DO_MOLDE).toBe(2);
    const m = normalizarMolde({
      blocos: [
        { papel: "titulo", x0: 5, y0: 5, x1: 50, y1: 20, altura_da_letra: 8, camada: "atras_do_assunto", texto_decorativo: "nada" },
        { papel: "decorativo", x0: 0, y0: 30, x1: 100, y1: 60, altura_da_letra: 25, camada: "xyz", texto_decorativo: "  melhor  " },
      ],
    })!;
    expect(m.blocos[0].camada).toBe("atras_do_assunto");
    expect(m.blocos[0].texto_decorativo).toBeUndefined();
    expect(m.blocos[1]).toMatchObject({ papel: "decorativo", camada: "frente", texto_decorativo: "melhor" });
    const antigo = normalizarMolde({ blocos: [{ papel: "titulo", x0: 5, y0: 5, x1: 50, y1: 20 }] })!;
    expect("camada" in antigo.blocos[0]).toBe(false);
    expect(normalizarMolde({ blocos: [{ papel: "decorativo", x0: 0, y0: 0, x1: 100, y1: 50 }] })).toBeNull();
  });

  it("a headline se divide nos blocos do título da referência (à esquerda e depois embaixo), na ordem de leitura", () => {
    const mapa = mapearNoMolde(MEIO.blocos, MOLDE_QUEBRADO);
    const h = mapa.lugares[0];
    expect(h.partes && h.partes.map((p) => [p.texto, p.alvo.y0])).toEqual([["Sorriso saudável", 8], ["começa cedo", 70]]);
    expect(mapa.lugares[1].alvo && mapa.lugares[1].alvo.papel).toBe("texto");
    // O decorativo nunca recebe texto da lâmina nem vira "bloco vago".
    expect(mapa.vagos.map((v) => v.papel)).toEqual([]);
    expect(dividirNasPartes("Um\nDois três", [1, 1])).toEqual(["Um", "Dois três"]);
    expect(dividirNasPartes("Só", [3, 1])).toEqual(["Só"]);
  });

  it("Idêntica: cada parte no seu lugar, com posição, alinhamento e camada; nada de molde fixo", () => {
    const p = promptDoReplicar(entrada("identica")).prompt;
    expect(p).toContain("- A headline se divide em 2 blocos, como o título da referência");
    expect(p).toContain('- HEADLINE (parte 1 de 2): "SORRISO SAUDÁVEL" no lugar do TÍTULO da referência, de 6% a 55% da largura e de 8% a 22% da altura do quadro');
    expect(p).toContain('- HEADLINE (parte 2 de 2): "COMEÇA CEDO" no lugar do TÍTULO da referência, de 30% a 94% da largura e de 70% a 84% da altura do quadro');
    expect(p).toMatch(/parte 2 de 2[^\n]*alinhado à direita/);
    expect(p).toContain('- APOIO: "Consulta de rotina evita dor." no lugar do TEXTO da referência, de 6% a 40% da largura e de 88% a 95%');
    const comCamada = promptDoReplicar(entrada("identica", {
      referencias: [{ indice: 1, molde: { ...MOLDE_QUEBRADO, blocos: MOLDE_QUEBRADO.blocos.map((b, i) => (i === 2 ? { ...b, camada: "atras_do_assunto" as const } : b)) } }],
    })).prompt;
    expect(comCamada).toMatch(/- APOIO:[^\n]*atrás do assunto, como na referência/);
  });

  it("Próxima: mesma lógica (posições do molde) com liberdade", () => {
    const p = promptDoReplicar(entrada("proxima")).prompt;
    expect(p).toContain("HEADLINE (parte 1 de 2)");
    expect(p).toContain("- Liberdade da Próxima: cada bloco pode andar um pouco e mudar a quebra de linha");
    expect(p).not.toContain("Jogada do texto desta lâmina");
  });

  it("Inspirada e Criativa: jogada própria, sem 'mesmo eixo', variando entre as lâminas da série", () => {
    const i2 = promptDoReplicar(entrada("inspirada")).prompt;
    const i3 = promptDoReplicar(entrada("inspirada", { card: { ...MEIO, ordem: 3 } })).prompt;
    const c2 = promptDoReplicar(entrada("criativa")).prompt;
    for (const p of [i2, i3, c2]) {
      expect(p).toContain("- Jogada do texto desta lâmina (própria, muda de lâmina para lâmina da série): ");
      expect(p).not.toContain("os blocos no mesmo eixo e respiro em volta");
      expect(p).not.toMatch(/HEADLINE[^\n]*de \d+% a \d+% da largura/);
    }
    const jogada = (p: string) => p.split("\n").filter((l) => l.indexOf("- Jogada do texto") === 0)[0];
    expect(jogada(i2)).not.toBe(jogada(i3));
    expect(jogada(i2)).not.toBe(jogada(c2));
    // Inspirada guarda a família da jogada da referência (título quebrado em lugares diferentes).
    expect(i2).toContain("Como a referência, o título pode se quebrar em 2 blocos em lugares diferentes");
    // Idêntica e Próxima não têm jogada solta.
    expect(jogadaSolta({ fidelidade: "identica", ordem: 2, molde: MOLDE_QUEBRADO, papeis: ["headline"], temAssunto: true, capa: false })).toEqual([]);
  });

  it("referência de hoje (sem título quebrado): Idêntica é o fixture", () => {
    const hoje = JSON.parse(ler("src/test/fixtures/replicar-identica-hoje.json")) as { replicar: { prompt: string }[] };
    expect(promptDoReplicar({ ...CASOS_DO_REPLICAR[0].entrada, fidelidade: "identica" }).prompt).toBe(hoje.replicar[0].prompt);
  });
});

// ------------------------------------------------------------------ 2. decorativo

describe("2. Palavra decorativa trocada pelo termo do assunto", () => {
  it("candidatos da copy: palavras cheias da headline primeiro, sem palavra vazia, sem 'nenhum'", () => {
    const c = candidatosDoTermo(MEIO.blocos, MEIO.texto_exato);
    expect(c[0]).toBe("saudável");
    expect(c).toContain("sorriso");
    expect(c).toContain("sorriso saudável");
    expect(c).not.toContain("para");
    expect(c.length).toBeLessThanOrEqual(8);
    expect(termoPadrao(c, "melhor")).toBe("saudável");
    // A palavra da referência só fica quando ela é o tema (está na copy).
    expect(termoPadrao(["rotina", "sorriso"], "Sorriso")).toBe("sorriso");
  });

  it("Idêntica: a palavra da referência sai e o termo entra no mesmo lugar; o termo vai ao texto exato", () => {
    const r = promptDoReplicar(entrada("identica", { termoDecorativo: "sorriso" }));
    expect(r.prompt).toContain('- TEXTO DECORATIVO DE FUNDO: a palavra grande de fundo da referência ("melhor") sai; no lugar dela, de 0% a 100% da largura e de 30% a 62% da altura do quadro, escreva "SORRISO"');
    expect(r.prompt).toContain("Nunca repita a palavra da referência.");
    expect(r.prompt).not.toContain('escreva "MELHOR"');
    expect(r.textoExato.split("\n").pop()).toBe("SORRISO");
    // Sem termo do Jev: o termo padrão da copy, nunca "melhor".
    const padrao = promptDoReplicar(entrada("identica"));
    expect(padrao.prompt).toContain('escreva "SAUDÁVEL"');
  });

  it("Próxima e Inspirada trocam; Criativa não leva palavra decorativa", () => {
    expect(promptDoReplicar(entrada("proxima", { termoDecorativo: "rotina" })).prompt).toContain('escreva "ROTINA"');
    const insp = promptDoReplicar(entrada("inspirada", { termoDecorativo: "rotina" }));
    expect(insp.prompt).toContain('uma palavra gigante de fundo, agora "ROTINA"');
    const cri = promptDoReplicar(entrada("criativa", { termoDecorativo: "rotina" }));
    expect(cri.prompt).not.toContain("TEXTO DECORATIVO");
    expect(cri.textoExato).toBe(MEIO.texto_exato);
  });

  it("Choice do Jev: as opções são os candidatos, com 'nenhum'; fora da lista vira o termo padrão", () => {
    const q = perguntaDoTermo(["sorriso", "rotina"]).termo;
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria)).toEqual(["sorriso", "rotina", "nenhum"]);
    expect(decidirTermo({ termo: { choice: "rotina" } }, ["sorriso", "rotina"], "sorriso")).toEqual({ termo: "rotina", origem: "jev" });
    expect(decidirTermo({ termo: { choice: "nenhum" } }, ["sorriso", "rotina"], "sorriso")).toEqual({ termo: "sorriso", origem: "copy" });
    expect(decidirTermo({ termo: { choice: "melhor" } }, ["sorriso"], "sorriso").termo).toBe("sorriso");
  });

  it("orquestração: um Jev, cobrado e guardado; refazer lê o guardado; falha do Jev usa a copy; Criativa e sem decorativo nem chamam", async () => {
    const guardados: Record<string, unknown> = {};
    const perguntarJev = vi.fn(async () => ({ answers: { termo: { choice: "rotina" } }, usage: null, modelo: "jev" }));
    const cobrarJev = vi.fn(async () => null);
    const deps = {
      pasta: "c/estudio/leituras",
      lerGuardado: async (c: string) => (guardados[c] as Record<string, unknown>) ?? null,
      guardar: async (c: string, v: unknown) => void (guardados[c] = v),
      perguntarJev,
      cobrarJev,
    };
    const e = { molde: MOLDE_QUEBRADO, card: { ...MEIO, texto_exato: "Rotina de cuidado\nSorriso saudável começa cedo" , blocos: [{ papel: "headline" as const, texto: "Rotina de cuidado" }, { papel: "apoio" as const, texto: "Sorriso saudável começa cedo" }] }, total: 4, conceito: "c", criativa: false };
    const r1 = await termoDecorativoDaLamina(e, deps);
    expect(r1).toMatchObject({ termo: "rotina", origem: "jev", palavra_da_referencia: "melhor" });
    expect(perguntarJev).toHaveBeenCalledTimes(1);
    expect(cobrarJev).toHaveBeenCalledTimes(1);
    const r2 = await termoDecorativoDaLamina(e, deps);
    expect(r2 && r2.origem).toBe("guardado");
    expect(perguntarJev).toHaveBeenCalledTimes(1);
    const falha = await termoDecorativoDaLamina({ ...e, card: MEIO }, { ...deps, perguntarJev: vi.fn(async () => { throw new Error("fora"); }) });
    expect(falha).toMatchObject({ termo: "saudável", origem: "copy" });
    expect(await termoDecorativoDaLamina({ ...e, criativa: true }, deps)).toBeNull();
    expect(await termoDecorativoDaLamina({ ...e, molde: MOLDE_CASO }, deps)).toBeNull();
    expect(perguntarJev).toHaveBeenCalledTimes(1);
  });

  it("a conferência espera o termo decorativo que a versão escreveu", () => {
    expect(textoEsperadoNaConferencia("A\nB", { termo_decorativo: "rotina" })).toBe("A\nB\nrotina");
    expect(textoEsperadoNaConferencia("A\nB", {})).toBe("A\nB");
    expect(textoEsperadoNaConferencia("A", null)).toBe("A");
  });
});

// ------------------------------------------------------------------ 3. cor

describe("3. Cor por papel dentro da paleta", () => {
  const TODA_VERDE = [{ nome: "Verde escuro", hex: "#0B3D2E", papel: "fundo" }, { nome: "Verde", hex: "#1F8A4C", papel: "texto" }, { nome: "Verde claro", hex: "#8FD19E", papel: "destaque" }];
  const permitidas = (paleta: { hex?: string }[]) => paleta.map((p) => String(p.hex).toUpperCase()).concat(["#F5F3EE", "#111418"]);

  it("paleta só de verdes em fundo claro: título verde, apoio neutro (não verde), destaque de outra cor", () => {
    const h = hierarquiaDeCor({ paleta: TODA_VERDE, fundo: "#F7F7F2" });
    expect(h.titulo).toBe("#1F8A4C");
    expect(h.apoio).toBe("#111418");
    expect(h.apoio).not.toBe(h.titulo);
    expect(h.destaque && h.destaque.cor).toBe("#0B3D2E");
    for (const c of [h.titulo, h.apoio, h.destaque!.cor, h.cta]) expect(permitidas(TODA_VERDE)).toContain(c);
  });

  it("fundo escuro: apoio claro que lê; destaque que não lê vira traço atrás da palavra", () => {
    const h = hierarquiaDeCor({ paleta: TODA_VERDE, fundo: "#0B3D2E", titulo: "#F5F3EE" });
    expect(h.titulo).toBe("#F5F3EE");
    expect(h.destaque).toEqual({ cor: "#8FD19E", modo: "cor" });
    const semContraste = hierarquiaDeCor({ paleta: [{ hex: "#1F6F43", papel: "fundo" }, { hex: "#F5F0E6", papel: "texto" }, { hex: "#E8742A", papel: "destaque" }], fundo: "#1F6F43", titulo: "#F5F0E6" });
    expect(semContraste.destaque).toEqual({ cor: "#E8742A", modo: "traco" });
    expect(linhaDaHierarquia(semContraste)).toContain("traço grosso de #E8742A");
    expect(linhaDaHierarquia(semContraste, false)).not.toContain("apoio em");
    expect(linhaDaHierarquia(hierarquiaDeCor({ paleta: [], fundo: null }))).toBe("");
  });

  it("Idêntica: duas cores diferentes da referência que viravam a mesma da marca separam; neutras juntas ficam", () => {
    const paleta = [{ hex: "#1F6F43", papel: "fundo" }, { hex: "#F5F0E6", papel: "texto" }, { hex: "#E8742A", papel: "destaque" }];
    expect(separarCoresRepetidas([
      { corDaReferencia: "#1E4FD8", corNaMarca: "#111418" },
      { corDaReferencia: "#FF5500", corNaMarca: "#111418" },
      { corDaReferencia: "#111111", corNaMarca: "#111418" },
    ], paleta, "#F5F0E6")).toEqual(["#111418", "#1F6F43", "#111418"]);
    expect(separarCoresRepetidas([{ corDaReferencia: "#FFD400", corNaMarca: "#E8742A" }, { corDaReferencia: "#FFD400", corNaMarca: "#E8742A" }], paleta, "#F5F0E6")).toEqual(["#E8742A", "#E8742A"]);
  });

  it("lâmina normal: apoio em outra cor quando há neutro legível; a linha da hierarquia entra; anúncio fica como está", () => {
    const marcaVerde = { ...MARCA_CASO, paleta: [{ nome: "Creme", hex: "#F7F7F2", papel: "fundo" }, { nome: "Verde", hex: "#146B3A", papel: "texto" }, { nome: "Verde claro", hex: "#8FD19E", papel: "destaque" }] };
    const card = { ...CASOS_DO_REPLICAR[1].entrada.card, layout: layoutPadrao("conteudo", 2, 4) } as never;
    const p = promptDaLamina(card, marcaVerde, { total: 4, carrosselInfinito: false, levaLogo: false });
    expect(p).toMatch(/- HEADLINE: "Vale a pena\?"[^\n]*cor #146B3A\./);
    expect(p).toMatch(/- APOIO: [^\n]*cor #111418\./);
    expect(p).toContain("- Cor com hierarquia, só da paleta: headline em #146B3A;");
    const ads = promptDaLamina(card, marcaVerde, { total: 1, carrosselInfinito: false, levaLogo: false, anuncio: { formato: "stories_9x16" } });
    expect(ads).not.toContain("Cor com hierarquia");
  });
});

// ------------------------------------------------------------------ 4. limite das lâminas 2+

describe("4. Lâminas 2+ enxutas e desenhadas", () => {
  const longo = "Consulta de rotina evita dor e gasto com tratamento maior porque o problema aparece cedo, sai mais barato, dá para planejar com calma e ainda evita faltar no trabalho por causa de uma dor que podia ter sido evitada lá atrás";
  const cards = [
    { ordem: 1, funcao: "capa", texto_exato: "Uma capa comprida que passaria do limite se fosse miolo, mas capa nunca muda aqui não", blocos: [{ papel: "headline" as const, texto: "Uma capa comprida que passaria do limite se fosse miolo, mas capa nunca muda aqui não" }] },
    { ordem: 2, funcao: "conteudo", texto_exato: `Vale a pena?\n${longo}`, blocos: [{ papel: "headline" as const, texto: "Vale a pena?" }, { papel: "apoio" as const, texto: longo }] },
    { ordem: 3, funcao: "conteudo", texto_exato: "Três passos\nMarque, venha e cuide.", blocos: [{ papel: "headline" as const, texto: "Três passos" }, { papel: "apoio" as const, texto: "Marque, venha e cuide." }] },
    { ordem: 4, funcao: "cta", texto_exato: "Agende hoje\nLink na bio", blocos: [{ papel: "headline" as const, texto: "Agende hoje" }, { papel: "cta" as const, texto: "Link na bio" }] },
  ];

  it("limite: a capa nunca passa; miolo com apoio longo passa; texto curto não", () => {
    expect(passaDoLimite(cards[0], 4)).toBe(false);
    expect(passaDoLimite(cards[1], 4)).toBe(true);
    expect(passaDoLimite(cards[2], 4)).toBe(false);
    expect(passaDoLimite(cards[3], 4)).toBe(false);
  });

  it("uma chamada só para as longas; aplica só o que cabe, é menor e mantém a headline; a capa fica", async () => {
    const escrever = vi.fn(async () => ({
      json: { laminas: [
        { ordem: 2, blocos: [{ papel: "headline", texto: "Vale a pena?" }, { papel: "apoio", texto: "Rotina evita dor — e gasto maior. #saude" }] },
        { ordem: 1, blocos: [{ papel: "headline", texto: "Capa nova" }] },
      ] },
      custoUsd: 0.002,
    }));
    const r = await enxugarMiolo(cards, "conceito", escrever);
    expect(escrever).toHaveBeenCalledTimes(1);
    expect(r.longas).toEqual([2]);
    expect(r.mudou).toEqual([2]);
    expect(r.custoUsd).toBe(0.002);
    expect(r.cards[0]).toBe(cards[0]);
    expect(r.cards[1].texto_exato).toBe("Vale a pena?\nRotina evita dor, e gasto maior.");
    expect(r.cards[1].texto_exato).not.toContain("—");
    expect(r.cards[2]).toBe(cards[2]);
    // Nada longo: nenhuma chamada.
    const nada = vi.fn();
    expect((await enxugarMiolo([cards[0], cards[2], cards[3]], null, nada as never)).mudou).toEqual([]);
    expect(nada).not.toHaveBeenCalled();
    // Falha: tudo como estava.
    const falha = await enxugarMiolo(cards, null, async () => { throw new Error("sem saldo"); });
    expect(falha.cards).toBe(cards);
  });

  it("volta ruim fica como estava: sem headline, maior, perdeu o CTA ou ainda longa", () => {
    const sem = aplicarMioloEnxuto(cards, { laminas: [{ ordem: 2, blocos: [{ papel: "apoio", texto: "curto" }] }] }, [2]);
    expect(sem.mudou).toEqual([]);
    const aindaLonga = aplicarMioloEnxuto(cards, { laminas: [{ ordem: 2, blocos: [{ papel: "headline", texto: "Ok" }, { papel: "apoio", texto: longo }] }] }, [2]);
    expect(aindaLonga.mudou).toEqual([]);
    const semCta = aplicarMioloEnxuto(cards, { laminas: [{ ordem: 4, blocos: [{ papel: "headline", texto: "Agende" }] }] }, [4]);
    expect(semCta.mudou).toEqual([]);
    expect(aplicarMioloEnxuto(cards, null, [2]).mudou).toEqual([]);
  });

  it("a tela usa a mesma regra: lâminas longas do roteiro cru (custo antes) e o aviso depois de preparar", () => {
    const roteiro = [
      { ordem: 1, texto: "Uma capa comprida que passaria do limite se fosse miolo, mas capa nunca conta aqui não senhor" },
      { ordem: 2, texto: `Vale a pena?\n${longo}` },
      { ordem: 3, texto: "Três passos\nMarque, venha e cuide." },
      { ordem: 4, texto: "Agende hoje\nLink na bio" },
      { texto: "  " },
    ];
    expect(laminasLongasDoRoteiro(roteiro)).toEqual([2]);
    expect(laminasLongasDoRoteiro([{}, {}, {}])).toEqual([]);
    expect(laminasLongasDoRoteiro(null)).toEqual([]);
    expect(textoDoMioloEnxuto({ miolo_longo: [2, 3], miolo_enxuto: [2, 3] })).toBe("Lâminas 2 e 3 chegaram enxutas.");
    expect(textoDoMioloEnxuto({ miolo_longo: [2, 4], miolo_enxuto: [2] })).toBe("Lâmina 2 chegou enxuta. Lâmina 4 ainda passa do limite: use Refinar texto.");
    expect(textoDoMioloEnxuto({ miolo_longo: [], miolo_enxuto: [] })).toBeNull();
    expect(textoDoMioloEnxuto({})).toBeNull();
    // A tela lê a mesma regra (custo antes de montar do roteiro) e mostra o aviso depois.
    expect(ler("src/components/mesa/useItensDoMes.ts")).toContain("longas: laminasLongasDoRoteiro(cards).length");
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("const enxuto = textoDoMioloEnxuto(r);");
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("partesEnxugar={partesRefinar}");
  });

  it("miolo desenhado: recurso pelo texto (número, pergunta, lista), nunca na capa, no fechamento ou em post único", () => {
    expect(blocoDoMioloDesenhado({ ordem: 2, total: 4, blocos: [{ papel: "headline", texto: "70% das pessoas" }] })).toContain("o número como protagonista");
    expect(blocoDoMioloDesenhado({ ordem: 2, total: 4, blocos: [{ papel: "headline", texto: "Vale a pena?" }] })).toContain("a pergunta grande");
    expect(blocoDoMioloDesenhado({ ordem: 3, total: 5, blocos: [{ papel: "apoio", texto: "Marque, venha, cuide" }] })).toContain("lista curta de 2 ou 3 itens");
    expect(blocoDoMioloDesenhado({ ordem: 2, total: 4, blocos: [{ papel: "headline", texto: "Cuidado diário" }], cenaFixa: true })).toContain("o recurso é só gráfico");
    expect(blocoDoMioloDesenhado({ ordem: 1, total: 4, blocos: [] })).toBe("");
    expect(blocoDoMioloDesenhado({ ordem: 4, total: 4, blocos: [] })).toBe("");
    expect(blocoDoMioloDesenhado({ ordem: 2, total: 2, blocos: [] })).toBe("");
    expect(blocoDoMioloDesenhado({ ordem: 2, total: 4, blocos: [{ papel: "headline", texto: "Cuidado diário" }] })).not.toContain("—");
  });
});

// ------------------------------------------------------------------ 5. servidor

describe("5. Ligação no servidor e registro", () => {
  it("replicar: termo do Jev antes do prompt e na versão; conferência espera o termo", () => {
    expect(servidor).toContain("const termoDaLamina = await termoDecorativoDaLamina(");
    expect(servidor).toContain("termoDecorativo: termoDaLamina ? termoDaLamina.termo : null,\n      fidelidade,\n    });");
    expect(servidor).toContain("...(termoDaLamina ? { termo_decorativo: termoDaLamina.termo, termo_decorativo_origem: termoDaLamina.origem } : {}),");
    expect(servidor).toContain("textoEsperadoNaConferencia(card.texto_exato, alvo as { termo_decorativo?: unknown })");
  });

  it("preparar: enxuga no diretor e no roteiro (sempre enxuto; sem longa, nada é chamado); miolo desenhado fora do replicar e do anúncio", () => {
    expect(servidor).toContain("if (!postUnico && direcao.cards.length > 1 && corpo.enxugar_miolo !== false) {");
    expect(servidor).not.toContain('direcao.origem === "roteiro" ? corpo.enxugar_miolo === true');
    expect(servidor).toContain("mioloLongo = enxuto.longas;");
    expect(servidor).toContain("const enxuto = await enxugarMiolo(direcao.cards, direcao.conceito,");
    expect(servidor).toContain("miolo_enxuto: mioloEnxuto, miolo_longo: mioloLongo");
    expect(servidor).toContain('replicar || ads ? "" : blocoDoMioloDesenhado({ ordem, total,');
  });

  it("registro em _shared/motores.ts aponta trechos que existem", () => {
    const m = MUDANCAS_DO_GERADOR_DO_ESTUDIO.find((x) => x.id === "composicao_dinamica");
    expect(m).toBeTruthy();
    for (const t of m!.ligacao.trechos) expect(servidor).toContain(t);
  });

  it("arquivos novos sem travessão, lookbehind nem grupo nomeado", () => {
    for (const f of ["supabase/functions/_shared/jogada-do-texto.ts", "supabase/functions/estudio-arte/composicao-dinamica.ts", "supabase/functions/estudio-arte/modulos/limite-do-miolo.ts"]) {
      const s = ler(f);
      expect(s, f).not.toContain("—");
      expect(s, f).not.toContain("(?<");
    }
  });
});
