import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), storage: { from: vi.fn() }, functions: { invoke: vi.fn() } } }));
import { moldeNoQuadro, normalizarMolde, promptDoReplicar, type MarcaParaDirecao, type MoldeDaReferencia } from "../../supabase/functions/_shared/direcao-arte";
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

  it("replicar: fotos do cliente primeiro, depois as referências; prompt próprio, qualidade alta e o modo gravado na versão", () => {
    // 26/09: os anexos são candidatos com prioridade (anexosDaLamina): foto do cliente, elemento, referência da equipe, logo...
    expect(gerar.indexOf('tipo: "foto_cliente"')).toBeLessThan(gerar.indexOf('tipo: "referencia_equipe"'));
    expect(gerar.indexOf("FOTO REAL do cliente")).toBeLessThan(gerar.indexOf("REFERÊNCIA 1 escolhida pela equipe"));
    const bloco = gerar.slice(gerar.indexOf("// 0) Replicar a referência"), gerar.indexOf("// 1a) Foto de fundo"));
    // 27/09: o replicar tem prompt PRÓPRIO (promptDoReplicar), sem a cena do diretor (baseComCampanha).
    expect(bloco).toContain("const replica = promptDoReplicar({");
    expect(bloco).not.toContain("baseComCampanha");
    expect(bloco).not.toContain("blocoDaSerie");
    expect(bloco).toContain("regrasDeRender(t, { ...card, texto_exato: replica.textoExato }, legendas, regraDaLogo, true)");
    // O molde (leitura por visão) vai no prompt e as posições são convertidas para o quadro da lâmina.
    expect(bloco).toContain("moldeNoQuadro(r.molde, origemDoMolde, quadro)");
    expect(bloco).toContain('const qualidadeDoReplicar: Qualidade = "alta";');
    expect(bloco).toContain("qualidade: qualidadeDoReplicar,");
    // Sem máscara: a foto é recomposta, não devolvida.
    expect(bloco).not.toContain("mascara(");
    expect(bloco).not.toContain("devolverOriginal");
    expect(bloco).toContain('modo: "replicar_referencia"');
    expect(bloco).toContain("foto_recomposta: fotosReplicar.length > 0");
    // Transparência: o prompt e as legendas ficam na versão.
    expect(bloco).toContain("...transparencia(prompt, legendas,");
    // Referência sem imagem: não gera às cegas.
    expect(gerar).toContain('"referencia_sem_imagem"');
    // Uma chamada de imagem, sem laço de correção.
    expect(bloco.match(/await chamarImagem\(/g) ?? []).toHaveLength(1);
    // A capa da série não vai anexada no replicar (puxava a cena de volta).
    expect(gerar).toContain("if (capa && !replicar) {");
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

const MOLDE: MoldeDaReferencia = {
  versao: 1,
  proporcao: "4:5",
  fundo: "cor lisa clara",
  cor_do_fundo: "#F2F2EE",
  grade: "Título enorme na faixa de cima; pessoa centralizada embaixo; textos pequenos nos cantos.",
  assunto: { tipo: "pessoa", descricao: "pessoa olhando para a câmera", enquadramento: "plano médio frontal", x0: 24, y0: 30, x1: 76, y1: 100 },
  blocos: [
    { papel: "titulo", x0: 6, y0: 6, x1: 94, y1: 27, altura_da_letra: 9.5, linhas: 2, caixa_alta: true, familia: "sem serifa", largura_da_letra: "condensada", peso: "black", cor: "#1E4FD8", alinhamento: "centro" },
    { papel: "rotulo", x0: 5, y0: 2, x1: 30, y1: 4.5, altura_da_letra: 1.4, linhas: 1, caixa_alta: true, familia: "sem serifa", largura_da_letra: "normal", peso: "medio", cor: "#111111", alinhamento: "esquerda" },
    { papel: "texto", x0: 5, y0: 88, x1: 32, y1: 96, altura_da_letra: 1.6, linhas: 3, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "regular", cor: "#111111", alinhamento: "esquerda" },
    { papel: "perfil", x0: 70, y0: 92, x1: 95, y1: 95.5, altura_da_letra: 1.5, linhas: 1, caixa_alta: false, familia: "sem serifa", largura_da_letra: "normal", peso: "medio", cor: "#111111", alinhamento: "direita" },
  ],
  elementos: [{ descricao: "celulares inclinados em volta da pessoa", cor: "#1E4FD8", x0: 4, y0: 35, x1: 96, y1: 85 }],
  tratamento: "Luz de estúdio frontal, cores chapadas, acabamento de pôster editorial.",
};
const CARD_2 = {
  ordem: 2,
  funcao: "conteudo",
  texto_exato: "Vale a pena?\nConsulta de rotina evita dor e gasto.",
  blocos: [{ papel: "headline" as const, texto: "Vale a pena?" }, { papel: "apoio" as const, texto: "Consulta de rotina evita dor e gasto." }],
};
const entrada = (extra: Partial<Parameters<typeof promptDoReplicar>[0]> = {}): Parameters<typeof promptDoReplicar>[0] => ({
  card: CARD_2,
  marca: MARCA,
  total: 3,
  referencias: [{ indice: 1, molde: MOLDE }],
  editando: true,
  fotos: [],
  logo: { leva: true, indice: 3, medida: { tom: "#FFFFFF", clara: true, aspecto: 3 }, descricao: 'As letras da logo formam exatamente "Sorria".' },
  quadro: { largura: 1080, altura: 1350 },
  ...extra,
});

describe("prompt do modo replicar (27/09: prompt próprio com o molde)", () => {
  it("nada da cena do diretor: sem imagem, ponto focal, fundo, tratamento, zona, tamanhos, série nem estilo de cena", () => {
    // Mesmo com layout e ilustração no card, nada disso entra.
    const { prompt } = promptDoReplicar(entrada({ card: { ...CARD_2, layout: CARD.layout, ilustracao: CARD.ilustracao } as never }));
    expect(prompt).not.toContain("dentista sorrindo");
    expect(prompt).not.toContain("consultório claro");
    expect(prompt).not.toContain("- Área do texto:");
    expect(prompt).not.toMatch(/letra de cerca de \d+ px/);
    expect(prompt).not.toContain("CONTINUIDADE DA SÉRIE");
    expect(prompt).not.toContain("SÉRIE DO CARROSSEL");
    expect(prompt).not.toContain("fotografia natural, luz de manhã");
    expect(prompt).not.toContain("PADRÃO DE DESIGN");
    // As proibições do replicar não brigam com a referência (pessoa, centralizado).
    expect(prompt).not.toContain("tudo centralizado");
    expect(prompt).not.toContain("—");
  });

  it("a imagem 1 é a base a editar e o layout vem do molde, bloco por bloco", () => {
    const { prompt, textoExato, mapa } = promptDoReplicar(entrada());
    expect(prompt).toContain("A imagem 1 é a BASE A EDITAR");
    expect(prompt).toContain("LAYOUT DA REFERÊNCIA 1 (medido na imagem");
    expect(prompt).toContain("- Grade: Título enorme na faixa de cima");
    // Headline no lugar do título, em caixa alta, com a altura medida e a fonte da marca no desenho da referência.
    expect(prompt).toContain('- HEADLINE: "VALE A PENA?" no lugar do TÍTULO da referência, de 6% a 94% da largura e de 6% a 27% da altura do quadro, em CAIXA ALTA');
    expect(prompt).toContain("(128 px)");
    expect(prompt).toContain("fonte Fonte Título com o desenho da referência (sem serifa, condensada, peso black)");
    // Apoio no texto corrido; o rótulo do canto fica vago (sem texto inventado).
    expect(prompt).toContain('- APOIO: "Consulta de rotina evita dor e gasto." no lugar do TEXTO da referência');
    expect(prompt).toContain("ficam sem texto nenhum");
    expect(mapa!.vagos.map((v) => v.papel)).toEqual(["rotulo"]);
    // A logo no lugar do @perfil da referência, no tamanho da marca.
    expect(prompt).toContain("onde a referência põe a marca dela (de 70% a 95% da largura e de 92% a 96% da altura do quadro)");
    expect(prompt).toContain('As letras da logo formam exatamente "Sorria".');
    // Cores da referência trocadas pelas da marca na mesma função.
    expect(prompt).toContain("na marca, #F5F0E6 no lugar de #F2F2EE");
    // Pessoa da referência vira outra pessoa.
    expect(prompt).toContain("outra pessoa (nunca a da referência)");
    // O texto das regras finais sai com a caixa alta do molde (a conferência compara sem caixa).
    expect(textoExato).toBe("VALE A PENA?\nConsulta de rotina evita dor e gasto.");
  });

  it("com a foto do cliente: ela é o assunto, idêntica, no lugar do assunto da referência", () => {
    const { prompt } = promptDoReplicar(entrada({ fotos: [{ indice: 2, papel: "fundo" }] }));
    expect(prompt).toContain("A pessoa ou o produto da foto real do cliente (imagem 2) entra no lugar do assunto da referência (de 24% a 76% da largura");
    expect(prompt).toContain("mesmo rosto, feições");
    expect(prompt).toContain("não escureça a foto");
  });

  it("sem molde (leitura falhou): cai na cópia geral da estrutura; duas referências, a 2ª só no acabamento", () => {
    const { prompt } = promptDoReplicar(entrada({ referencias: [{ indice: 1, molde: null }, { indice: 2, molde: null }], editando: false }));
    expect(prompt).toContain("Referência 1 (imagem 1): recrie a lâmina seguindo de perto o layout dela");
    expect(prompt).toContain("Referência 2 (imagem 2): dela vem só o acabamento");
    expect(prompt).toContain("Copie dela a estrutura do layout");
    expect(prompt).toContain('- HEADLINE: "Vale a pena?"');
  });

  it("molde normalizado: números no quadro, papéis conhecidos, sem bloco de texto é nulo", () => {
    const m = normalizarMolde({ blocos: [{ papel: "xyz", x0: -5, y0: 10, x1: 140, y1: 30, altura_da_letra: 8, linhas: 2, caixa_alta: true, cor: "#abcdef" }], assunto: { tipo: "pessoa", x0: 0, y0: 0, x1: 50, y1: 50 } });
    expect(m!.blocos[0]).toMatchObject({ papel: "texto", x0: 0, x1: 100, cor: "#ABCDEF", caixa_alta: true });
    expect(normalizarMolde({ blocos: [{ papel: "marca", x0: 1, y0: 1, x1: 20, y1: 5 }] })).toBeNull();
    expect(normalizarMolde(null)).toBeNull();
  });

  it("molde no quadro: referência 1:1 recortada em 4:5 muda as posições horizontais", () => {
    const quadrado = moldeNoQuadro(MOLDE, { largura: 1000, altura: 1000 }, { largura: 1088, altura: 1360 });
    // 1:1 em 4:5: sobra 80% da largura; x = 6% vira (6 - 10) / 0,8 = 0 e x = 94% vira 105 (limitado a 100).
    expect(quadrado.blocos[0].x0).toBe(0);
    expect(quadrado.blocos[0].x1).toBe(100);
    expect(quadrado.blocos[0].y0).toBe(6);
    expect(moldeNoQuadro(MOLDE, { largura: 1080, altura: 1350 }, { largura: 1088, altura: 1360 })).toBe(MOLDE);
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
