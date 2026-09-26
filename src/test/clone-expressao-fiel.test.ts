import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVISO_SEM_FOTO_SORRINDO,
  blocoDaExpressao,
  detectarPedidoDeExpressao,
  escolherFotosDaExpressao,
  expressaoDasTags,
  emBase64,
  expressaoPelaLeitura,
  LIMITE_BASE64_DAS_IMAGENS,
  LIMITE_DO_PEDIDO,
  lerFotosDaExpressao,
  MAX_FOTOS_DE_EXPRESSAO,
  normalizarLeituraDeExpressao,
  ordemDoEnvio,
  perguntaDoSorriso,
  quantasCabem,
  semLeitura,
  sorrisoPeloJev,
  tagDaExpressaoDoClone,
  tagsComExpressao,
  tagsDaFotoDeExpressao,
  vagasDaExpressao,
  type CandidataDaExpressao,
  type PedidoDeExpressao,
} from "../../supabase/functions/mesa-foto/clones-expressao";
import { lerPedidoDeVariacao, PRESET_UNIFORME, promptDaVariacaoDoClone, PRESETS_DE_VARIACAO } from "../../supabase/functions/mesa-foto/clones-regras";
import { corpoDaVariacaoDoClone, normalizarCloneAberto } from "@/components/mesa-foto/clonesApi";
import hoje from "./fixtures/clone-variacao-hoje.json";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const MB = 1024 * 1024;
const ID = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
const pedido = (x: Record<string, unknown>) => ({ expressao: "", pose: "", livre: "", ...x }) as { expressao: string; pose: string; livre: string };
const fontes = [
  { id: "r1", tipo: "real" as const, vista: null, principal: true },
  { id: "f1", tipo: "folha" as const, vista: "frente" },
  { id: "f2", tipo: "folha" as const, vista: "tres_quartos_esq" },
];

describe("expressão fiel: detecção do pedido de sorriso", () => {
  it("os presets com sorriso são detectados no código, com a intensidade", () => {
    const de = (id: string) => detectarPedidoDeExpressao(lerPedidoDeVariacao({ preset: id }));
    expect(de("sorriso_close").sorriso).toMatchObject({ tipo: "sorriso", intensidade: "aberto", origem: "termo" });
    expect(de("retrato_editorial").sorriso).toMatchObject({ tipo: "sorriso", intensidade: "leve" });
    expect(de("cafe").sorriso).toMatchObject({ tipo: "sorriso", intensidade: "leve" });
    // Sem sorriso no pedido: nada muda (sem Jev).
    for (const id of ["no_trabalho", "em_casa", "lifestyle_rua", "corpo_inteiro_estudio"]) {
      expect(de(id)).toMatchObject({ sorriso: null, ambiguo: false });
    }
    // Ambíguos: o Jev decide (uniforme "confiante e simpática", UGC "espontânea").
    expect(de(PRESET_UNIFORME)).toMatchObject({ sorriso: null, ambiguo: true });
    expect(de("ugc")).toMatchObject({ sorriso: null, ambiguo: true });
  });

  it("termos do texto livre: sorrindo, rindo, feliz, gargalhada; negação e roupa não contam", () => {
    expect(detectarPedidoDeExpressao(pedido({ expressao: "sorrindo para a câmera" })).sorriso).toMatchObject({ intensidade: null });
    expect(detectarPedidoDeExpressao(pedido({ livre: "Ela está rindo com a equipe" })).sorriso).toMatchObject({ intensidade: "riso" });
    expect(detectarPedidoDeExpressao(pedido({ expressao: "gargalhada" })).sorriso).toMatchObject({ intensidade: "riso" });
    expect(detectarPedidoDeExpressao(pedido({ expressao: "feliz" })).sorriso).toMatchObject({ tipo: "sorriso" });
    expect(detectarPedidoDeExpressao(pedido({ expressao: "sorriso largo mostrando os dentes" })).sorriso).toMatchObject({ intensidade: "aberto" });
    expect(detectarPedidoDeExpressao(pedido({ pose: "braços cruzados, meio sorriso" })).sorriso).toMatchObject({ intensidade: "leve" });
    expect(detectarPedidoDeExpressao(pedido({ expressao: "séria, sem sorrir" }))).toMatchObject({ sorriso: null, ambiguo: false });
    expect(detectarPedidoDeExpressao(pedido({ expressao: "não sorri" }))).toMatchObject({ sorriso: null });
    // Roupa, cenário e luz não entram na detecção.
    expect(detectarPedidoDeExpressao({ ...lerPedidoDeVariacao({ roupa: "camiseta com estampa de sorriso", cenario: "festa feliz" }) })).toMatchObject({ sorriso: null, ambiguo: false });
  });

  it("o Jev só desambigua: um Noul sobre o pedido; acima de 0,5 vira sorriso leve", () => {
    const q = perguntaDoSorriso(pedido({ expressao: "confiante e simpática" }));
    expect(Object.keys(q.questions)).toEqual(["sorriso"]);
    expect(q.questions.sorriso.type).toBe("noul");
    expect(q.questions.sorriso.criteria).toHaveProperty("true");
    expect(q.state.pedido.expressao).toBe("confiante e simpática");
    expect(sorrisoPeloJev(0.8, "confiante e simpática")).toMatchObject({ tipo: "sorriso", intensidade: "leve", origem: "jev" });
    expect(sorrisoPeloJev(0.3, "x")).toBeNull();
    expect(sorrisoPeloJev(null, "x")).toBeNull();
  });
});

describe("expressão fiel: escolha das fotos sorrindo pela leitura", () => {
  it("a leitura guardada (etiqueta, Ler foto, diretor) diz se a pessoa sorri; sem falar da expressão, null", () => {
    expect(expressaoPelaLeitura("Mulher de blusa branca sorrindo e mostrando os dentes, fundo claro.")).toBe("sorriso_aberto");
    expect(expressaoPelaLeitura("Homem com meio sorriso, luz de janela")).toBe("sorriso_leve");
    expect(expressaoPelaLeitura("Pessoa rindo muito")).toBe("riso");
    expect(expressaoPelaLeitura("Retrato com expressão neutra")).toBe("neutra");
    expect(expressaoPelaLeitura("Homem sério, sem sorrir")).toBe("neutra");
    expect(expressaoPelaLeitura("Camisa azul, fundo branco, luz frontal")).toBeNull();
    expect(expressaoPelaLeitura("", [])).toBeNull();
    expect(expressaoPelaLeitura(null, ["mulher sorridente", "cabelo cacheado"])).toBe("sorriso");
    expect(expressaoDasTags(["tipo:pessoa", "expressao:sorriso_leve"])).toBe("sorriso_leve");
    expect(expressaoDasTags(["expressao:qualquer"])).toBeNull();
    expect(normalizarLeituraDeExpressao({ expressao: "sorriso_aberto", boca_visivel: true })).toBe("sorriso_aberto");
    expect(normalizarLeituraDeExpressao({ expressao: "sorriso_aberto", boca_visivel: false })).toBe("sem_rosto");
    expect(normalizarLeituraDeExpressao({ expressao: "inventada" })).toBeNull();
  });

  it("escolhe até 2: enviadas primeiro, depois as sorrindo na intensidade pedida, guardada antes de origem, principal antes", () => {
    const aberto: PedidoDeExpressao = { tipo: "sorriso", intensidade: "aberto", texto: "sorriso aberto", origem: "termo" };
    const candidatas: CandidataDaExpressao[] = [
      { id: "neutra", origem: "origem", principal: true, leitura: "neutra" },
      { id: "leve", origem: "origem", leitura: "sorriso_leve" },
      { id: "aberto-origem", origem: "origem", leitura: "sorriso_aberto" },
      { id: "aberto-guardada", origem: "guardada", leitura: "sorriso_aberto" },
      { id: "sem-leitura", origem: "origem", leitura: null },
    ];
    expect(escolherFotosDaExpressao(aberto, candidatas)).toEqual(["aberto-guardada", "aberto-origem"]);
    expect(escolherFotosDaExpressao({ ...aberto, intensidade: "leve" }, candidatas)).toEqual(["leve", "aberto-guardada"]);
    // A que a equipe mandou vale como está (mesmo sem leitura) e vem primeiro.
    const comEnviada = [{ id: "enviada", origem: "enviada" as const, leitura: null }, ...candidatas];
    expect(escolherFotosDaExpressao(aberto, comEnviada)).toEqual(["enviada", "aberto-guardada"]);
    // Ninguém sorrindo: nenhuma (a função avisa e o prompt pede sorriso contido).
    expect(escolherFotosDaExpressao(aberto, [candidatas[0], candidatas[4]])).toEqual([]);
    // Expressão que não é sorriso: só as enviadas.
    expect(escolherFotosDaExpressao({ tipo: "outra", intensidade: null, texto: "surpresa", origem: "foto_enviada" }, comEnviada)).toEqual(["enviada"]);
    // Empate: a principal primeiro.
    expect(escolherFotosDaExpressao({ ...aberto, intensidade: null }, [
      { id: "b", origem: "origem", leitura: "sorriso" },
      { id: "a", origem: "origem", principal: true, leitura: "sorriso" },
    ], 1)).toEqual(["a"]);
    // Leitura barata só para quem não tem leitura (a enviada não precisa).
    expect(semLeitura(comEnviada).map((c) => c.id)).toEqual(["sem-leitura"]);
  });
});

describe("expressão fiel: papel da imagem no prompt", () => {
  const sorriso: PedidoDeExpressao = { tipo: "sorriso", intensidade: "aberto", texto: "sorriso aberto e natural", origem: "termo" };

  it("a foto sorrindo vai como 'sorriso real desta pessoa', depois da identidade e antes do estilo; ordem de prioridade", () => {
    const p = promptDaVariacaoDoClone({
      nome: "Paula",
      fontes,
      invariantes: [],
      pedido: lerPedidoDeVariacao({ preset: "sorriso_close" }),
      formato: "4:5",
      estilo: { inicio: 5, legendas: ["jardim ao sol"] },
      expressao: blocoDaExpressao(sorriso, [{ indice: 4, ja_anexada: false }]),
    });
    expect(p).toContain("Imagem 4: SORRISO REAL DESTA PESSOA: copie o formato da boca, os dentes, a gengiva, as covinhas e como os olhos fecham ao sorrir; não copie roupa, fundo, luz.");
    expect(p.indexOf("Imagem 3: FOLHA")).toBeLessThan(p.indexOf("Imagem 4: SORRISO REAL"));
    expect(p.indexOf("Imagem 4: SORRISO REAL")).toBeLessThan(p.indexOf("Imagem 5: REFERÊNCIA SÓ DE ESTILO"));
    expect(p).toContain("ORDEM DE PRIORIDADE: 1) a identidade do rosto (fotos reais e folha aprovada); 2) a expressão pedida (sorriso aberto e natural), que é a desta pessoa real; 3) o resto");
    expect(p).toContain("nunca um sorriso genérico");
    expect(p).toContain("aqui o sorriso é aberto");
    expect(p).not.toMatch(/[—–]/);
  });

  it("a foto real que já vai como identidade é citada pelo número (sem mandar de novo)", () => {
    const b = blocoDaExpressao(sorriso, [{ indice: 1, ja_anexada: true }])!;
    expect(b.legendas[0]).toBe("Imagem 1 (a mesma foto real acima) também é o SORRISO REAL DESTA PESSOA: copie o formato da boca, os dentes, a gengiva, as covinhas e como os olhos fecham ao sorrir; não copie roupa, fundo, luz.");
    expect(b.instrucoes.join(" ")).toContain("das imagens 1");
  });

  it("sem foto sorrindo: aviso curto e sorriso natural e contido, sem inventar dentes perfeitos", () => {
    const b = blocoDaExpressao(sorriso, [])!;
    expect(b.legendas).toEqual([]);
    expect(b.instrucoes.join(" ")).toContain("sorriso natural e contido, sem inventar dentes perfeitos");
    expect(AVISO_SEM_FOTO_SORRINDO).toBe("Envie uma foto sua sorrindo para o sorriso sair fiel.");
  });

  it("foto enviada de outra expressão: expressão real desta pessoa", () => {
    const b = blocoDaExpressao({ tipo: "outra", intensidade: null, texto: "surpresa", origem: "foto_enviada" }, [{ indice: 4, ja_anexada: false }])!;
    expect(b.legendas[0]).toContain("Imagem 4: EXPRESSÃO REAL DESTA PESSOA");
    expect(b.instrucoes[0]).toContain("2) a expressão pedida (surpresa)");
    expect(blocoDaExpressao(null, [])).toBeNull();
  });
});

describe("expressão fiel: limite de imagens e de bytes", () => {
  it("no máximo 2 fotos da expressão por variação, ids válidos", () => {
    expect(MAX_FOTOS_DE_EXPRESSAO).toBe(2);
    expect(lerFotosDaExpressao(undefined)).toEqual([]);
    expect(lerFotosDaExpressao([ID(1), ID(1), ID(2)])).toEqual([ID(1), ID(2)]);
    expect(() => lerFotosDaExpressao([ID(1), ID(2), ID(3)])).toThrow(/No máximo 2/);
    expect(() => lerFotosDaExpressao(["x"])).toThrow(/inválida/);
    expect(() => lerFotosDaExpressao("x")).toThrow(/lista/);
  });

  it("o pedido fica abaixo de 30 MB (base64): a expressão só entra se couber e nunca tira o que já ia; as já anexadas não ocupam lugar", () => {
    expect(LIMITE_DO_PEDIDO).toBe(30 * MB);
    expect(LIMITE_BASE64_DAS_IMAGENS).toBe(24 * MB);
    expect(emBase64(3)).toBe(4);
    // 7 imagens de 1,5 MB (14 MB em base64) + 2 de 2 MB (5,4 MB): cabem as duas.
    expect(quantasCabem(Array(7).fill(1.5 * MB), [2 * MB, 2 * MB])).toBe(2);
    // 7 imagens de 2 MB (18,7 MB em base64): cabe mais uma de 2 MB; a segunda passaria de 24 MB.
    expect(quantasCabem(Array(7).fill(2 * MB), [2 * MB, 2 * MB])).toBe(1);
    expect(quantasCabem(Array(9).fill(2 * MB), [1 * MB])).toBe(0);
    expect(quantasCabem([], [1, 1, 1])).toBe(2);
    expect(vagasDaExpressao(["r1", "g1"], ["r1"])).toBe(1);
    expect(vagasDaExpressao([], ["r1"])).toBe(0);
    expect(ordemDoEnvio({ identidade: 3, expressao: 2, estilo: 1, logo: true })).toEqual({ inicioDaExpressao: 4, inicioDoEstilo: 6, indiceDaLogo: 7, total: 7 });
  });

  it("etiquetas: a leitura troca a anterior e cabe em 30; guardar e tirar do clone", () => {
    const muitas = Array.from({ length: 30 }, (_x, i) => `t${i}`);
    const t = tagsComExpressao([...muitas, "expressao:neutra"], "sorriso_aberto");
    expect(t).toHaveLength(30);
    expect(t[t.length - 1]).toBe("expressao:sorriso_aberto");
    expect(t.filter((x) => x.indexOf("expressao:") === 0)).toEqual(["expressao:sorriso_aberto"]);
    expect(tagsDaFotoDeExpressao(["original"], "c1", true)).toEqual(["original", tagDaExpressaoDoClone("c1")]);
    expect(tagsDaFotoDeExpressao(["original", "clone_expressao:c1"], "c1", false)).toEqual(["original"]);
    // A etiqueta do clone não é a das variações (clone:<id>): a lista de variações não muda.
    expect(tagDaExpressaoDoClone("c1")).not.toBe("clone:c1");
  });
});

describe("expressão fiel: sem pedido de expressão, tudo igual a hoje", () => {
  it("o prompt é o mesmo de antes (sem expressão e com expressão nula)", () => {
    const casos = {
      sorriso_close: { nome: "Paula", fontes, invariantes: ["pinta acima do lábio"], pedido: lerPedidoDeVariacao({ preset: "sorriso_close" }), formato: "4:5", tracos: ["nariz: nariz fino e reto"] },
      cafe_estilo: { nome: "Paula", fontes, invariantes: [], pedido: lerPedidoDeVariacao({ preset: "cafe" }), formato: "1:1", estilo: { inicio: 4, legendas: ["jardim ao sol"] } },
      uniforme_logo: { nome: "Paula", fontes, invariantes: [], pedido: lerPedidoDeVariacao({ preset: PRESET_UNIFORME }), formato: "4:5", logo: { indice: 4, paleta: "verde #1B5E20" } },
    };
    for (const [k, e] of Object.entries(casos)) {
      expect(promptDaVariacaoDoClone(e)).toBe((hoje as Record<string, string>)[k]);
      expect(promptDaVariacaoDoClone({ ...e, expressao: null })).toBe((hoje as Record<string, string>)[k]);
    }
  });

  it("as entradas: mesma ordem e mesmos lugares do estilo e da logo sem expressão", () => {
    // Hoje: estilo começa logo depois da identidade e a logo é a última.
    expect(ordemDoEnvio({ identidade: 3, expressao: 0, estilo: 2, logo: true })).toEqual({ inicioDaExpressao: 4, inicioDoEstilo: 4, indiceDaLogo: 6, total: 6 });
    expect(ordemDoEnvio({ identidade: 5, expressao: 0, estilo: 0, logo: false })).toMatchObject({ inicioDoEstilo: 6, indiceDaLogo: null, total: 5 });
    // A função só busca expressão nas ações do clone; sem expressão, as vagas e as referências são as de antes.
    const clones = ler("supabase/functions/mesa-foto/clones.ts");
    expect(clones).toContain("const exp = extras.comExpressao ? await expressaoDaVariacao(");
    expect(clones).toContain("const reservadas = exp ? vagasDaExpressao(");
    expect(clones).toContain("const referencias = [...imagens, ...imagensDaExpressao, ...(estilo ? estilo.imagens : []), ...(logo ? [logo.imagem] : [])];");
    expect(clones).toMatch(/gerarVariacao\(ch, c, corpo, \{ comExpressao: true \}\)/);
    // O Book continua sem a expressão automática.
    expect(ler("supabase/functions/mesa-foto/book.ts")).not.toContain("comExpressao");
  });

  it("a tela manda o mesmo corpo de antes sem foto da expressão; com foto, os ids e o guardar", () => {
    const base = { modeloId: "c1", pedido: { preset: "cafe", roupa: "", cenario: "", pose: "", expressao: "", livre: "" }, formato: "4:5", qualidade: "alta" as const };
    expect(corpoDaVariacaoDoClone(base)).toEqual({ acao: "clone_variacao_gerar", modelo_id: "c1", pedido: { preset: "cafe" }, formato: "4:5", qualidade: "alta" });
    expect(corpoDaVariacaoDoClone({ ...base, expressao: { ids: [] } })).not.toHaveProperty("expressao_ref_ids");
    expect(corpoDaVariacaoDoClone({ ...base, expressao: { ids: [ID(1), ID(2), ID(3)], guardar: true } })).toMatchObject({ expressao_ref_ids: [ID(1), ID(2)], guardar_expressao: true });
    const aberto = normalizarCloneAberto({ clone: { id: "c1", nome: "Paula", identidade_real: [] }, fotos_de_expressao: [{ id: ID(1), storage_path: "c/x.jpg", storage_bucket: "mesa", nome: "sorriso.jpg" }] });
    expect(aberto!.fotos_de_expressao.map((f) => f.id)).toEqual([ID(1)]);
    expect(PRESETS_DE_VARIACAO.find((p) => p.id === "sorriso_close")!.rotulo).toBe("Close sorrindo");
  });
});
