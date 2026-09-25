import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Cenas, história e personagem persistente no Canvas da Mesa Foto (dono,
 * 25/09 à noite; docs/mesa-foto/cenas/PESQUISA.md e docs/mesa-videos/CONTRATO.md):
 * a foto de um Resultado entra noutro com papel (personagem, produto, cenário,
 * estilo), a montagem do pedido com a referência de personagem, a ordem da
 * história e o filtro de acervo da Mesa Vídeos.
 */

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), functions: { invoke: vi.fn() }, storage: { from: () => ({}) } } }));

import {
  avisosDaCena,
  CONTINUIDADE_DA_CENA,
  entradasDaSaida,
  fotoDoResultadoParaUso,
  garantirQueDaParaGerar,
  grupoNaMesaDeVideos as grupoNaFuncao,
  historiaDoCanvas,
  idsDoCanvas,
  lerCena,
  lerPedidoDePersonagem,
  MARCA_DO_PERSONAGEM,
  normalizarCanvas,
  ordenarComBase,
  pessoaDaFoto,
  promptDoCanvas,
  type ReferenciaCandidata,
} from "../../supabase/functions/mesa-foto/canvas-regras";
import { normalizarFicha } from "../../supabase/functions/mesa-foto/personas";
import {
  bloqueiosDoGerar,
  corpoDoCanvas,
  corpoDoPersonagem,
  entradasDoGerar,
  fotoDaLigacao,
  ligar,
  mudarLigacao,
  normalizarCanvas as normalizarNaTela,
  novoNo,
  podeLigar,
  resumoDoResultado,
  type Canvas,
  type NoDoCanvas,
  type ResultadoDoCanvas,
} from "@/components/mesa-foto/canvasApi";
import {
  acervoDaMesaDeVideos,
  cenaNova,
  cenasDaHistoria,
  duplicarCena,
  grupoNaMesaDeVideos,
  marcarComoCena,
  moverCena,
  pacoteDaHistoria,
  proximaCena,
  reordenarCenas,
  tirarDaHistoria,
} from "@/components/mesa-foto/canvas/historia";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const KIT = "22222222-2222-2222-2222-222222222222";
const F1 = "aaaaaaaa-0000-0000-0000-000000000001";
const F2 = "aaaaaaaa-0000-0000-0000-000000000002";
const F3 = "aaaaaaaa-0000-0000-0000-000000000003";
const PERSONA = "bbbbbbbb-0000-0000-0000-000000000001";
const GPT = "openrouter:openai/gpt-image-2.5-sunburst";

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

const resultado = (imagem: string, extra: Partial<ResultadoDoCanvas> = {}): ResultadoDoCanvas => ({
  geracao_id: `g-${imagem.slice(-1)}`,
  imagem_id: imagem,
  storage_bucket: "mesa",
  storage_path: `${CLIENTE}/foto/canvas/c/${imagem}.png`,
  url: "",
  motor_id: GPT,
  status: "gerada",
  erro: "",
  custo_usd: 0.1,
  conferencia: null,
  criado_em: "2026-09-25T20:00:00Z",
  grupo: null,
  quadro: null,
  tipo: "foto",
  ...extra,
});

// ------------------------------------------------------------------ quadro base: produto + cena 1 (com foto) + cena 2

function quadro(): { c: Canvas; produto: NoDoCanvas; cena1: NoDoCanvas; cena2: NoDoCanvas } {
  const produto = { ...novoNo("produto", 0, 0, { kit_id: KIT }), id: "p1" };
  const cena1 = { ...novoNo("gerar", 400, 0, { motores: [GPT], resultados: [resultado(F1), resultado(F2)], cena: cenaNova(1, { titulo: "Ela chega" }) }), id: "s1" };
  const cena2 = { ...novoNo("gerar", 800, 0, { motores: [GPT], cena: cenaNova(2, { titulo: "Ela usa" }) }), id: "s2" };
  let c: Canvas = { id: "c-1", client_id: CLIENTE, nome: "História da Lia", nos: [produto, cena1, cena2], ligacoes: [], viewport: { x: 0, y: 0, zoom: 1 }, versao: 1, atualizado_em: "" };
  c = ligar(c, "p1", "s1");
  return { c, produto, cena1, cena2 };
}

describe("tela: Resultado ligado a outro Resultado", () => {
  it("liga a foto de uma cena na outra como personagem (pela alça), sem laço", () => {
    const { c } = quadro();
    expect(podeLigar(c, "s1", "s2", "personagem")).toBe("pessoa");
    const ligado = ligar(c, "s1", "s2", "personagem");
    const l = ligado.ligacoes.find((x) => x.de === "s1" && x.para === "s2");
    expect(l).toMatchObject({ papel: "personagem", entrada: "pessoa", imagem_id: null });
    // Laço: a cena 2 não alimenta a cena 1 se a 1 já alimenta a 2.
    expect(podeLigar(ligado, "s2", "s1", "personagem")).toBeNull();
    // Cartão comum continua ligando do mesmo jeito.
    expect(podeLigar(ligado, "p1", "s2")).toBe("produto");
  });

  it("trocar o papel muda a alça e a ordem; a foto escolhida vai no corpo do salvar", () => {
    const { c } = quadro();
    let ligado = ligar(c, "s1", "s2", "personagem");
    const id = ligado.ligacoes.find((x) => x.de === "s1")!.id;
    const s2 = ligado.ligacoes.find((x) => x.para === "s2")!;
    ligado = mudarLigacao(ligado, s2.id, { papel: "cenario", imagem_id: F1 });
    expect(ligado.ligacoes.find((x) => x.id === s2.id)).toMatchObject({ papel: "cenario", entrada: "ambiente", imagem_id: F1 });
    const corpo = corpoDoCanvas(ligado) as { ligacoes: Record<string, unknown>[] };
    expect(corpo.ligacoes.find((x) => x.id === s2.id)).toEqual({ id: s2.id, de: "s1", para: "s2", ordem: 0, papel: "cenario", imagem_id: F1 });
    // A ligação de cartão comum não leva papel.
    expect(corpo.ligacoes.find((x) => x.de === "p1")).not.toHaveProperty("papel");
    expect(id).toBeTruthy();
  });

  it("a foto que entra: a escolhida, senão a da cena, senão a mais nova aprovada, senão a mais nova", () => {
    const { cena1 } = quadro();
    expect(fotoDaLigacao(cena1, F1)!.imagem_id).toBe(F1);
    expect(fotoDaLigacao(cena1, null)!.imagem_id).toBe(F2);
    expect(fotoDaLigacao(cena1, null, [F1])!.imagem_id).toBe(F1);
    const comFotoDaCena = { ...cena1, dados: { ...cena1.dados, cena: cenaNova(1, { imagem_id: F1 }) } };
    expect(fotoDaLigacao(comFotoDaCena, null, [F2])!.imagem_id).toBe(F1);
  });

  it("bloqueia a cena que usa outra cena ainda sem foto, e o resumo diz o papel", () => {
    const { c } = quadro();
    const reverso = ligar(c, "s2", "s1", "personagem");
    expect(bloqueiosDoGerar(reverso, "s1").join(" ")).toMatch(/Personagem de Ela usa: gere a foto dele antes/);
    const ligado = ligar(c, "s1", "s2", "personagem");
    expect(bloqueiosDoGerar(ligado, "s2")).toEqual([]);
    expect(resumoDoResultado(entradasDoGerar(ligado, "s2"), (n) => (n.tipo === "gerar" ? "Ela chega" : "Kit"))).toBe("Junta: personagem de Ela chega");
  });

  it("salvar e reabrir mantém cena, papel, foto e sinopse (a função aceita a mesma forma)", () => {
    const { c } = quadro();
    const ligado = { ...mudarLigacao(ligar(c, "s1", "s2", "produto"), "x", {}), historia: { sinopse: "Um dia com a Lia", formato: "9:16" } };
    const corpo = corpoDoCanvas(ligado);
    expect(corpo.historia).toEqual({ sinopse: "Um dia com a Lia", formato: "9:16" });
    const naFuncao = normalizarCanvas(corpo);
    const l = naFuncao.ligacoes.find((x) => x.de === "s1")!;
    expect(l.papel).toBe("produto");
    expect((naFuncao.nos.find((n) => n.id === "s1")!.dados.cena as { titulo: string }).titulo).toBe("Ela chega");
    const reaberto = normalizarNaTela({ ...corpo, id: "c-1", client_id: CLIENTE }, CLIENTE)!;
    expect(reaberto.ligacoes.find((x) => x.de === "s1")).toMatchObject({ papel: "produto", entrada: "produto" });
    expect(reaberto.historia).toEqual({ sinopse: "Um dia com a Lia", formato: "9:16" });
    expect(reaberto.nos.find((n) => n.id === "s2")!.dados.cena).toMatchObject({ ordem: 2, titulo: "Ela usa" });
  });
});

describe("função: montagem do pedido com a referência de personagem", () => {
  const canvasNaFuncao = () => {
    const { c } = quadro();
    return normalizarCanvas(corpoDoCanvas(ligar(c, "s1", "s2", "personagem")));
  };

  it("valida a ligação entre resultados: papel padrão personagem, foto do acervo conferida, laço recusado", () => {
    const n = canvasNaFuncao();
    const e = entradasDaSaida(n, "s2");
    expect(e.resultados).toHaveLength(1);
    expect(e.resultados![0]).toMatchObject({ papel: "personagem" });
    expect(() => garantirQueDaParaGerar(e)).not.toThrow();
    const semPapel = normalizarCanvas({ nos: n.nos, ligacoes: [{ de: "s1", para: "s2", imagem_id: F3 }] });
    expect(semPapel.ligacoes[0]).toMatchObject({ papel: "personagem", imagem_id: F3 });
    expect(idsDoCanvas(semPapel).imagens).toContain(F3);
    expect(() => normalizarCanvas({ nos: n.nos, ligacoes: [{ de: "s1", para: "s2" }, { de: "s2", para: "s1" }] })).toThrow(/cadeia de cenas/);
  });

  it("na cena, a personagem vai como Imagem 1 (antes do produto) e o texto amarra o papel de cada imagem", () => {
    const candidatas: ReferenciaCandidata[] = [
      { papel: "produto", origem: { tipo: "kit", id: KIT, no_id: "p1" }, imagem_id: F3, titulo: "Óculos", legenda: "identidade" },
      { papel: "pessoa", origem: { tipo: "resultado", id: F2, no_id: "s1" }, imagem_id: F2, titulo: "Ela chega", legenda: "personagem" },
    ];
    const naCena = ordenarComBase(null, candidatas, 8, { pessoaPrimeiro: true });
    expect(naCena.referencias.map((r) => r.papel)).toEqual(["pessoa", "produto"]);
    const fora = ordenarComBase(null, candidatas, 8);
    expect(fora.referencias.map((r) => r.papel)).toEqual(["produto", "pessoa"]);
    const prompt = promptDoCanvas({
      referencias: naCena.referencias,
      produtos: [{ no_id: "p1", nome: "Óculos Aurora", variante: null, invariantes: ["armação tartaruga"], lacunas: [] }],
      pessoas: [],
      ambientes: [],
      estilos: [],
      textos: [],
      formato: "9:16",
      deResultados: [{ no_id: "s1", papel: "personagem", nome: "Ela chega", pessoa: "sintetica" }],
      cena: { numero: 2, total: 3, titulo: "Ela usa", acao: "ela coloca o óculos no espelho", enquadramento: "plano_medio", cenario: "banheiro claro", narrativa: "Depois do trabalho, o ritual.", sinopse: "Um dia com a Lia" },
    });
    expect(prompt).toContain('Imagem 1: A PERSONAGEM "Ela chega"');
    expect(prompt).toContain('Imagem 2: O PRODUTO "Óculos Aurora"');
    expect(prompt.indexOf("Imagem 1:")).toBeLessThan(prompt.indexOf("Imagem 2:"));
    expect(prompt).toContain('CENA 2 DE 3, "Ela usa": ela coloca o óculos no espelho');
    expect(prompt).toContain("ENQUADRAMENTO DA CENA: plano médio");
    expect(prompt).toContain("HISTÓRIA (contexto, não escreva texto na imagem): Um dia com a Lia");
    expect(prompt).toContain(CONTINUIDADE_DA_CENA);
    expect(prompt).toMatch(/Ignore o fundo, a pose e o enquadramento desta imagem/);
    // Pessoa sintética: as regras de persona valem; nada de "sem mudar traços" de pessoa real.
    expect(prompt).not.toContain("pessoa real adulta, a mesma da foto");
    expect(prompt).not.toMatch(/—/);
  });

  it("personagem que veio de uma persona volta à âncora; a foto da cena anterior só dá roupa e cabelo", () => {
    const refs = ordenarComBase(null, [
      { papel: "pessoa", origem: { tipo: "persona", id: PERSONA, no_id: "s1" }, imagem_id: F3, titulo: "Lia", legenda: "âncora" },
      { papel: "pessoa", origem: { tipo: "resultado", id: F2, no_id: "s1" }, imagem_id: F2, titulo: "Ela chega", legenda: "personagem" },
    ], 8, { pessoaPrimeiro: true }).referencias;
    const prompt = promptDoCanvas({
      referencias: refs,
      produtos: [],
      pessoas: [{ no_id: "s1", nome: "Lia", ficha: normalizarFicha({ idade_aparente: 28, cabelo: "cacheado castanho" }), invariantes: ["cabelo cacheado"] }],
      ambientes: [],
      estilos: [],
      textos: [],
      formato: "4:5",
      deResultados: [{ no_id: "s1", papel: "personagem", nome: "Ela chega", pessoa: "persona" }],
      cena: { numero: 1, total: 1, titulo: null, acao: null, enquadramento: "livre", cenario: null, narrativa: null },
    });
    expect(prompt).toContain('Imagem 1: A PESSOA SINTÉTICA "Lia"');
    expect(prompt).toContain('Imagem 2: A MESMA PESSOA "Ela chega", como ela aparece na cena anterior: copie daqui a roupa');
  });

  it("pessoa real herdada segue as regras de pessoa real; produto e cenário de outra cena têm o texto deles", () => {
    const refs = ordenarComBase(null, [
      { papel: "pessoa", origem: { tipo: "resultado", id: F1, no_id: "s1" }, imagem_id: F1, titulo: "A", legenda: "" },
      { papel: "ambiente", origem: { tipo: "resultado", id: F2, no_id: "s3" }, imagem_id: F2, titulo: "B", legenda: "" },
      { papel: "produto", origem: { tipo: "resultado", id: F3, no_id: "s4" }, imagem_id: F3, titulo: "C", legenda: "" },
    ], 8).referencias;
    const prompt = promptDoCanvas({
      referencias: refs,
      produtos: [],
      pessoas: [],
      ambientes: [],
      estilos: [],
      textos: [],
      formato: "4:5",
      deResultados: [
        { no_id: "s1", papel: "personagem", nome: "Loja", pessoa: "real" },
        { no_id: "s3", papel: "cenario", nome: "Sala", pessoa: null },
        { no_id: "s4", papel: "produto", nome: "Mesa posta", pessoa: null },
      ],
    });
    expect(prompt).toContain('A PESSOA DA CENA ANTERIOR "Loja" (pessoa real, com autorização registrada pela equipe)');
    expect(prompt).toContain("pessoa real adulta, a mesma da foto, sem mudar traços");
    expect(prompt).toContain('O LUGAR desta imagem (da cena "Sala")');
    expect(prompt).toContain('O PRODUTO desta imagem (da cena "Mesa posta")');
    // Fora de cena, o bloco de continuidade não entra.
    expect(prompt).not.toContain("CONTINUIDADE DA HISTÓRIA");
  });

  it("foto do resultado para uso: escolhida, da cena, aprovada, mais nova (igual à tela)", () => {
    const n = canvasNaFuncao().nos.find((x) => x.id === "s1")!;
    expect(fotoDoResultadoParaUso(n, F1)).toBe(F1);
    expect(fotoDoResultadoParaUso(n, null)).toBe(F2);
    expect(fotoDoResultadoParaUso(n, null, [F1])).toBe(F1);
    expect(fotoDoResultadoParaUso(n, F3)).toBe(F2);
  });

  it("quem é a pessoa da foto, pelas etiquetas; avisos de plano geral e gente demais", () => {
    expect(pessoaDaFoto({ tags: ["pessoa_real_autorizada"] }).tipo).toBe("real");
    expect(pessoaDaFoto({ tags: [], modo: "clone" }).tipo).toBe("real");
    expect(pessoaDaFoto({ tags: [`persona:${PERSONA}`] })).toEqual({ tipo: "persona", persona_id: PERSONA });
    expect(pessoaDaFoto({ tags: ["pessoa_sintetica"] }).tipo).toBe("sintetica");
    expect(pessoaDaFoto({ tags: ["canvas"], categoria: "produto" }).tipo).toBeNull();
    expect(avisosDaCena({ enquadramento: "plano_geral", pessoas: 1 })[0]).toMatch(/rosto pequeno/);
    expect(avisosDaCena({ enquadramento: "plano_medio", pessoas: 3 })[0]).toMatch(/Mais de 2 pessoas/);
    expect(avisosDaCena({ enquadramento: "plano_geral", pessoas: 0 })).toEqual([]);
  });

  it("cena guardada só com os campos conhecidos; animação reservada fica 'em_breve'", () => {
    const cena = lerCena({ ordem: 3, titulo: "Fim", enquadramento: "inventado", seed: "42", animacao: { duracao_s: 8, movimento: "travelling", qualquer: 1 } })!;
    expect(cena).toMatchObject({ ordem: 3, titulo: "Fim", enquadramento: "livre", seed: 42 });
    expect(cena.animacao).toEqual({ duracao_s: 8, movimento: "travelling", ultimo_quadro_id: null, audio: null, motor_video: null, status: "em_breve" });
    expect(lerCena(null)).toBeNull();
  });

  it("virar personagem: ética obrigatória, adulta e marcada nas notas", () => {
    expect(() => lerPedidoDePersonagem({ nome: "Lia", idade_aparente: 28 })).toThrow(/sintética, adulta/);
    expect(() => lerPedidoDePersonagem({ nome: "Lia", idade_aparente: 17, etica_confirmada: true })).toThrow();
    const p = lerPedidoDePersonagem({ nome: "Lia", idade_aparente: 28, etica_confirmada: true, invariantes: ["jaqueta jeans"], descricao: "Designer" });
    expect(p.ficha.idade_aparente).toBe(28);
    expect(p.ficha.notas.indexOf(MARCA_DO_PERSONAGEM)).toBe(0);
    expect(p.invariantes).toEqual(["jaqueta jeans"]);
  });

  it("o servidor monta a cena com a pessoa em 1º, a seed da cena e as etiquetas da história", () => {
    const fonte = ler("supabase/functions/mesa-foto/canvas.ts");
    expect(fonte).toContain("ordenarComBase(base, candidatas, limite, { pessoaPrimeiro: !!cena })");
    expect(fonte).toMatch(/: mt\.seed,/);
    expect(fonte).toContain('["cena", `cena:${mt.saida.id}`, `historia:${c.id}`]');
    expect(fonte).toContain("canvas_personagem_criar: canvasPersonagemCriar");
    expect(fonte).toMatch(/ACOES_LONGAS_DO_CANVAS = \[[^\]]*"canvas_personagem_criar"/);
  });
});

describe("ordem da história", () => {
  it("as cenas saem pela ordem da cena (empate: de cima para baixo), numeradas sem buraco, na tela e na função", () => {
    const { c } = quadro();
    const terceira = { ...novoNo("gerar", 0, -500, { cena: cenaNova(2, { titulo: "Antes" }) }), id: "s3" };
    const solto = { ...novoNo("gerar", 0, 900, {}), id: "s4" };
    const com = { ...c, nos: c.nos.concat([terceira, solto]) };
    expect(cenasDaHistoria(com).map((h) => [h.no.id, h.numero])).toEqual([["s1", 1], ["s3", 2], ["s2", 3]]);
    const naFuncao = normalizarCanvas(corpoDoCanvas(com));
    expect(historiaDoCanvas(naFuncao).map((h) => [h.no.id, h.numero])).toEqual([["s1", 1], ["s3", 2], ["s2", 3]]);
  });

  it("mover, reordenar e tirar da história reescrevem a ordem 1, 2, 3", () => {
    const { c } = quadro();
    const com = marcarComoCena({ ...c, nos: c.nos.concat([{ ...novoNo("gerar", 0, 900, {}), id: "s3" }]) }, "s3");
    expect(cenasDaHistoria(com).map((h) => h.no.id)).toEqual(["s1", "s2", "s3"]);
    const movida = moverCena(com, "s3", 1);
    expect(cenasDaHistoria(movida).map((h) => [h.no.id, h.cena.ordem])).toEqual([["s3", 1], ["s1", 2], ["s2", 3]]);
    expect(cenasDaHistoria(moverCena(movida, "s3", 99)).map((h) => h.no.id)).toEqual(["s1", "s2", "s3"]);
    expect(cenasDaHistoria(reordenarCenas(com, ["s2", "s1"])).map((h) => h.no.id)).toEqual(["s2", "s1", "s3"]);
    const sem = tirarDaHistoria(movida, "s1");
    expect(cenasDaHistoria(sem).map((h) => [h.no.id, h.cena.ordem])).toEqual([["s3", 1], ["s2", 2]]);
    expect(sem.nos.some((n) => n.id === "s1")).toBe(true);
  });

  it("duplicar a cena copia as entradas sem as fotos e entra logo depois da original", () => {
    const { c } = quadro();
    const dup = duplicarCena(c, "s1", "s1b");
    const nova = dup.nos.find((n) => n.id === "s1b")!;
    expect(nova.dados.resultados).toEqual([]);
    expect(nova.dados.cena).toMatchObject({ titulo: "Ela chega (outro contexto)", imagem_id: null });
    expect(entradasDoGerar(dup, "s1b").map((e) => e.no.id)).toEqual(["p1"]);
    expect(cenasDaHistoria(dup).map((h) => h.no.id)).toEqual(["s1", "s1b", "s2"]);
  });

  it("próxima cena: liga a foto como personagem, leva os produtos e entra logo depois", () => {
    const { c } = quadro();
    const prox = proximaCena(c, "s1", "s1n");
    const l = prox.ligacoes.find((x) => x.de === "s1" && x.para === "s1n")!;
    expect(l).toMatchObject({ papel: "personagem", entrada: "pessoa" });
    expect(entradasDoGerar(prox, "s1n").map((e) => [e.no.id, e.entrada])).toEqual([["p1", "produto"], ["s1", "pessoa"]]);
    expect(cenasDaHistoria(prox).map((h) => h.no.id)).toEqual(["s1", "s1n", "s2"]);
    expect(bloqueiosDoGerar(prox, "s1n")).toEqual([]);
  });

  it("o pacote da Mesa Vídeos traz as cenas na ordem, a foto de cada uma e quem entra", () => {
    const { c } = quadro();
    const prox = { ...proximaCena(c, "s1", "s1n"), historia: { sinopse: "Um dia com a Lia", formato: "9:16" } };
    const pacote = pacoteDaHistoria(prox);
    expect(pacote.cenas.map((x) => [x.numero, x.no_id])).toEqual([[1, "s1"], [2, "s1n"], [3, "s2"]]);
    expect(pacote.cenas[0]).toMatchObject({ imagem_id: F2, titulo: "Ela chega", animacao: null });
    expect(pacote.cenas[1].personagens).toEqual([{ no_id: "s1", tipo: "cena_anterior", modelo_id: null, imagem_id: F2 }]);
    expect(pacote.cenas[1].produtos).toEqual([{ no_id: "p1", kit_id: KIT, da_cena: false }]);
    expect(pacote).toMatchObject({ sinopse: "Um dia com a Lia", formato: "9:16", sem_foto: 2 });
  });
});

describe("acervo da Mesa Vídeos e personagem", () => {
  const amostras = [
    { nome: "arte", categoria: "arte", tags: [], kit_id: null, esperado: null },
    { nome: "logo", categoria: "logo", tags: [], kit_id: null, esperado: null },
    { nome: "carrossel do canvas", categoria: "pessoa", tags: ["carrossel", "pessoa_sintetica"], kit_id: null, esperado: null },
    { nome: "cena", categoria: "pessoa", tags: ["cena", "cena:s1", "pessoa_sintetica"], kit_id: null, esperado: "cena" },
    { nome: "clone", categoria: "pessoa", tags: ["clone:x"], modo: "clone", kit_id: null, esperado: "clone" },
    { nome: "pessoa real com autorização", categoria: "pessoa", tags: ["pessoa_real_autorizada"], kit_id: null, esperado: "clone" },
    { nome: "personagem", categoria: "pessoa", tags: [`personagem:${PERSONA}`], kit_id: null, esperado: "personagem" },
    { nome: "persona", categoria: "pessoa", tags: [`persona:${PERSONA}`], kit_id: null, esperado: "personagem" },
    { nome: "produto do kit", categoria: "produto", tags: [], kit_id: KIT, esperado: "produto" },
    { nome: "pessoa real sem autorização", categoria: "pessoa", tags: [], kit_id: null, esperado: null },
    { nome: "entrega genérica", categoria: null, tags: [], kit_id: null, esperado: null },
    { nome: "inativa", categoria: "produto", tags: [], kit_id: KIT, ativa: false, esperado: null },
  ];

  it("puxa personagem, clone, produto e cena; deixa fora artes, logos, carrosséis e pessoa sem autorização (tela e função iguais)", () => {
    amostras.forEach((a) => {
      expect([a.nome, grupoNaMesaDeVideos(a)]).toEqual([a.nome, a.esperado]);
      expect([a.nome, grupoNaFuncao(a)]).toEqual([a.nome, a.esperado]);
    });
    const g = acervoDaMesaDeVideos(amostras);
    expect(g.cena.map((x) => x.nome)).toEqual(["cena"]);
    expect(g.produto.map((x) => x.nome)).toEqual(["produto do kit"]);
    expect(g.clone).toHaveLength(2);
  });

  it("o pedido de virar personagem vai com a ética confirmada e os traços fixos", () => {
    expect(corpoDoPersonagem({ clientId: CLIENTE, imagemId: F1, nome: " Lia ", idade: 28.4, invariantes: ["jaqueta jeans", " "] })).toEqual({
      acao: "canvas_personagem_criar",
      client_id: CLIENTE,
      imagem_id: F1,
      nome: "Lia",
      idade_aparente: 28,
      etica_confirmada: true,
      invariantes: ["jaqueta jeans"],
    });
  });
});
