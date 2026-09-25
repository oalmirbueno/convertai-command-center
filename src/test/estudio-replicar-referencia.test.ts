import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), storage: { from: vi.fn() }, functions: { invoke: vi.fn() } } }));
import { blocoReplicarReferencia, promptDaLamina, type MarcaParaDirecao } from "../../supabase/functions/_shared/direcao-arte";
import { baseDaLamina, versaoRecompos, AVISO_FOTO_RECOMPOSTA } from "@/components/mesa/EstudioBaseDaLamina";
import { comTrabalhoTrocado } from "@/components/mesa/estudioUtil";
import { MAX_NO_ESTUDIO, papelDaEscolhida } from "@/components/mesa/ReferenciasDoEstudio";

/**
 * Estúdio, 25/09 (dono): "escolhi a referência e escolhi a imagem, fui gerar
 * e ele gerou nada a ver". Causa: com foto real, gerarCard descartava as
 * referências escolhidas pela equipe (`baseFoto ? { refs: [] }`) e o modo
 * foto real só escreve texto em áreas fixas. Agora há o modo replicar
 * referência: a lâmina segue o layout da(s) referência(s) com a marca, o texto
 * exato e a foto do cliente como assunto (recomposta, com aviso na tela).
 */

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const gerar = estudio.slice(estudio.indexOf("async function gerarCard("), estudio.indexOf("async function gravarVersao("));

const MARCA: MarcaParaDirecao = {
  nomeCliente: "Cliente sintético",
  paleta: [{ nome: "Verde", hex: "#1f6f43", papel: "fundo" }, { nome: "Creme", hex: "#f5f0e6", papel: "texto" }, { nome: "Laranja", hex: "#e8742a", papel: "destaque" }],
  estilo: "fotografia natural, luz de manhã",
  regras: null,
  fontes: [{ nome: "Fonte Título", papel: "titulo" }, { nome: "Fonte Texto", papel: "texto" }],
  temLogo: true,
};
const CARD = {
  ordem: 1,
  funcao: "capa",
  texto_exato: "Seu sorriso merece cuidado",
  blocos: [{ papel: "headline" as const, texto: "Seu sorriso merece cuidado" }],
  layout: {
    zona_texto: "base-esquerda" as const,
    alinhamento: "esquerda" as const,
    imagem: "dentista sorrindo",
    ponto_focal: "rosto",
    fundo: "consultório claro",
    tratamento: "luz natural",
  },
  ilustracao: "dentista sorrindo",
};

describe("servidor: a referência escolhida pela equipe não é mais descartada com foto", () => {
  it("a causa: foto real zerava as referências; agora a escolha da equipe vale e vira o modo replicar", () => {
    expect(gerar).not.toContain('const escolhida = baseFoto ? { refs: [] as Referencia[], jev: "foto_real" } : await escolherReferencias');
    expect(gerar).toContain("const refsDaEquipe = await referenciasDaEquipe(t, card);");
    expect(gerar).toContain("const replicar = refsDaEquipe.length > 0 && !panorama;");
    expect(gerar).toContain('? { refs: refsDaEquipe, jev: "escolha_da_equipe" }');
    // Sem escolha da equipe, a foto real continua como era (alinhada, só texto e a logo gerada na área dela).
    expect(gerar).toContain('? { refs: [] as Referencia[], jev: "foto_real" }');
    // 26/09: só a capa busca referência automática; o miolo segue a capa anexada.
    expect(gerar).toContain('? { refs: [] as Referencia[], jev: "serie_pela_capa" }');
    expect(gerar).toContain(": await escolherReferencias(t, card, kit, ch.userId);");
    expect(gerar).toContain("const fotoFixa = !!baseFoto && !panorama && !elementos.length && !replicar;");
  });

  it("replicar: fotos do cliente primeiro, depois as referências; geração nova e o modo gravado na versão", () => {
    // 26/09: os anexos são candidatos com prioridade (anexosDaLamina): foto do cliente, elemento, referência da equipe, logo...
    expect(gerar.indexOf('tipo: "foto_cliente"')).toBeLessThan(gerar.indexOf('tipo: "referencia_equipe"'));
    expect(gerar.indexOf("FOTO REAL do cliente")).toBeLessThan(gerar.indexOf("REFERÊNCIA 1 escolhida pela equipe"));
    const bloco = gerar.slice(gerar.indexOf("  if (replicar) {\n    const prompt"), gerar.indexOf("// 1a) Foto de fundo"));
    expect(bloco).toContain("blocoReplicarReferencia({ referencias: refsNoPrompt, fotos: fotosReplicar, logo: indiceDaLogo");
    expect(bloco).toContain("regrasDeRender(t, card, legendas, regraDaLogo, true)");
    // Sem máscara: a foto é recomposta, não devolvida.
    expect(bloco).not.toContain("mascara(");
    expect(bloco).not.toContain("devolverOriginal");
    expect(bloco).toContain('modo: "replicar_referencia"');
    expect(bloco).toContain("foto_recomposta: fotosReplicar.length > 0");
    // Referência sem imagem: não gera às cegas.
    expect(gerar).toContain('"referencia_sem_imagem"');
    // Uma chamada, sem laço de correção.
    expect(bloco.match(/await chamarImagem\(/g) ?? []).toHaveLength(1);
  });

  it("o panorama do carrossel contínuo segue a regra de sempre (agora pela capacidade do modelo)", () => {
    expect(gerar).toContain("const panorama = !baseFoto && !elementos.length && usaPanorama(t, card, modeloImagem);");
  });

  it("refazer replicando mantém a estrutura da referência", () => {
    expect(estudio).toContain("export function blocoDeVariacao(versoesAntes: number, cenaFixa: boolean, replicar = false, ordem = 1, serie = false): string {");
    expect(estudio).toContain("continue seguindo a referência escolhida de perto, com a mesma estrutura de layout");
  });

  it("foto grande (Mesa Foto 4K) é reduzida pelo Storage antes de decodificar (limite de CPU)", () => {
    expect(estudio).toContain('transform: { width: 2000, height: 2500, resize: "contain", format: "origin" }');
    expect(gerar).toContain('await fotoDoBucketNaLamina("mesa", fundoLivre.caminho, quadro.largura, quadro.altura)');
    expect(gerar).toContain('imagemReduzida("mesa", el.caminho, "elemento-real")');
  });
});

describe("prompt do modo replicar", () => {
  it("uma referência: copia estrutura, tipografia e tratamento; a foto é o assunto idêntico", () => {
    const b = blocoReplicarReferencia({ referencias: [{ indice: 2, leitura: "Título enorme no topo" }], fotos: [{ indice: 1, papel: "fundo" }], logo: 3, capa: true });
    expect(b).toContain("MODO REPLICAR REFERÊNCIA");
    expect(b).toContain("Referência: imagem 2");
    expect(b).toContain("O que se vê nela: Título enorme no topo");
    expect(b).toContain("foto real do cliente (imagem 1)");
    expect(b).toContain("mesmo rosto, feições");
    expect(b).toContain("não escureça a foto");
    expect(b).toContain("logo oficial (imagem 3)");
    expect(b).not.toContain("—");
  });

  it("duas referências: a 1ª dá a estrutura e a 2ª o tratamento", () => {
    const b = blocoReplicarReferencia({ referencias: [{ indice: 2 }, { indice: 3 }], fotos: [] });
    expect(b).toContain("Referência 1: imagem 2. Dela vem a ESTRUTURA");
    expect(b).toContain("Referência 2: imagem 3. Dela vem o TRATAMENTO");
    expect(b).toContain("vale a referência 1 para posição e tamanho");
    // Sem foto: o assunto é o da lâmina.
    expect(b).toContain("o desta lâmina");
    expect(blocoReplicarReferencia({ referencias: [], fotos: [] })).toBe("");
  });

  it("promptDaLamina replicando: sem área fixa do texto nem tamanho em px; texto exato e marca continuam", () => {
    const normal = promptDaLamina(CARD, MARCA, { total: 3, carrosselInfinito: false, levaLogo: true });
    const replica = promptDaLamina(CARD, MARCA, { total: 3, carrosselInfinito: false, levaLogo: true, replicar: { comFoto: true } });
    expect(normal).toContain("- Área do texto:");
    expect(replica).not.toContain("- Área do texto:");
    expect(normal).toMatch(/letra de cerca de \d+ px/);
    expect(replica).not.toMatch(/letra de cerca de \d+ px/);
    expect(replica).toContain('"Seu sorriso merece cuidado"');
    expect(replica).toContain("mesma posição, escala e peso do texto equivalente da referência");
    expect(replica.toLowerCase()).toContain("#1f6f43");
    expect(replica).toContain("onde a referência põe a marca dela");
    // A referência só orienta o lugar: a logo continua no tamanho da marca (26/09).
    expect(replica).toContain("nunca menor");
    expect(replica).toContain("FOTO REAL do cliente anexada é o assunto");
    expect(replica).not.toContain("CAPA QUE PARA A ROLAGEM");
  });
});

describe("tela: modo da próxima geração e aviso da foto recomposta", () => {
  const foto = { caminho: "c/estudio/fotos/a.png", papel: "fundo" as const };

  it("referência + foto = replicar com a foto recomposta; sem referência, foto real", () => {
    expect(baseDaLamina({ referencias_ids: ["r1"], fotos_livres: [foto] }, [], false)).toMatchObject({ modo: "replicar_referencia", fotoRecomposta: true, daLamina: true });
    expect(baseDaLamina({ fotos_livres: [foto] }, [], false)).toMatchObject({ modo: "foto_real", fotoRecomposta: false });
    expect(baseDaLamina({ imagens_ids: ["i1"] }, ["g:1"], false)).toMatchObject({ modo: "replicar_referencia", daLamina: false, referencias: ["g:1"] });
    expect(baseDaLamina({}, [], false).modo).toBe("normal");
    // Até 2 referências valem.
    expect(baseDaLamina({ referencias_ids: ["a", "b", "c"] }, [], false).referencias).toEqual(["a", "b"]);
  });

  it("carrossel contínuo sem foto: o panorama manda (igual ao servidor)", () => {
    expect(baseDaLamina({ referencias_ids: ["r1"] }, [], true).modo).toBe("continuo");
    expect(baseDaLamina({ referencias_ids: ["r1"], fotos_livres: [foto] }, [], true).modo).toBe("replicar_referencia");
  });

  it("aviso e versão recomposta", () => {
    expect(AVISO_FOTO_RECOMPOSTA).toBe("A foto é recomposta para seguir a referência; confira o rosto.");
    expect(versaoRecompos({ modo: "replicar_referencia", foto_recomposta: true })).toBe(true);
    expect(versaoRecompos({ modo: "replicar_referencia", foto_recomposta: false })).toBe(false);
    expect(versaoRecompos({ modo: "foto_real" })).toBe(false);
  });

  it("o seletor do Estúdio escolhe até 2 (o gerador usa 2) e diz o papel de cada uma", () => {
    expect(MAX_NO_ESTUDIO).toBe(2);
    expect(papelDaEscolhida(0, 1)).toBe("layout a replicar");
    expect(papelDaEscolhida(0, 2)).toBe("1ª: estrutura e layout");
    expect(papelDaEscolhida(1, 2)).toBe("2ª: tratamento da imagem");
  });
});

describe("salvar na lâmina atualiza na hora (cache)", () => {
  it("o trabalho devolvido pelo configurar troca o da lista quando o id bate", () => {
    const antes = { itens: [], trabalhos: { t1: { id: "w1", task_id: "t1", direcao: { cards: [{ ordem: 1 }] } } } };
    const gravado = { id: "w1", task_id: "t1", direcao: { cards: [{ ordem: 1, fotos_livres: [{ caminho: "x", papel: "fundo" }] }] } };
    const depois = comTrabalhoTrocado(antes as any, gravado);
    expect((depois as any).trabalhos.t1.direcao.cards[0].fotos_livres).toEqual([{ caminho: "x", papel: "fundo" }]);
    // Outro trabalho (ou sem task) não mexe em nada.
    expect(comTrabalhoTrocado(antes as any, { id: "w2", task_id: "t1" })).toBe(antes);
    expect(comTrabalhoTrocado(antes as any, { id: "w1", task_id: null })).toBe(antes);
    expect(comTrabalhoTrocado(undefined, gravado)).toBeUndefined();
    expect(JSON.parse(JSON.stringify(depois))).toEqual(depois);
  });

  it("o configurar do Estúdio e o das referências gravam no cache", () => {
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("gravarTrabalhoNoCache(queryClient, clientId, r && r.trabalho);");
    expect(ler("src/components/mesa/ReferenciasDoEstudio.tsx")).toContain("gravarTrabalhoNoCache(queryClient, clientId, r && r.trabalho);");
  });
});

describe("compatibilidade e texto", () => {
  it("sem lookbehind, \\p{}, grupo nomeado, .at(), Object.hasOwn, aspect-ratio, :has, min() nem travessão", () => {
    for (const rel of [
      "src/components/mesa/EstudioBaseDaLamina.tsx",
      "src/components/mesa/EstudioFotos.tsx",
      "src/components/mesa/ReferenciasDoEstudio.tsx",
      "src/components/mesa/SeletorDeReferencias.tsx",
      "src/lib/mesa/referencias.ts",
      "src/lib/mesa/pastas.ts",
    ]) {
      const t = ler(rel);
      expect(t, rel).not.toContain("(?<");
      expect(t, rel).not.toMatch(/\\p\{/);
      expect(t, rel).not.toContain(".at(");
      expect(t, rel).not.toContain("Object.hasOwn(");
      expect(t, rel).not.toMatch(/aspect-\[|aspect-square|aspect-video|aspectRatio/);
      expect(t, rel).not.toContain(":has(");
      // min()/max()/clamp() de CSS (Math.min e Math.max de código valem).
      expect(t, rel).not.toMatch(/(^|[^.\w])(min|max|clamp)\(/m);
      expect(t, rel).not.toContain("—");
      expect(t, rel).not.toContain("–");
    }
    const bloco = estudio.slice(estudio.indexOf("// 0) Replicar a referência"), estudio.indexOf("// 1a) Foto de fundo"));
    expect(bloco).not.toContain("—");
  });
});
