import { describe, expect, it } from "vitest";
import {
  agruparVariantes,
  antesDoTratado,
  baseDoNome,
  categoriaDoArquivo,
  cenasDosClipes,
  decisoesDoJev,
  perguntaDosPares,
  chaveDoPar,
  modoDaEntrada,
  nomeDeCamera,
  nomeDoVideo,
  paresEmDuvida,
  pastasNaTela,
  proporOrganizacaoDaEntrada,
  ruidoDaEntrada,
  semelhancaDaFala,
  type ArquivoDaEntrada,
} from "../../supabase/functions/mesa-videos/modulos/organizador-da-entrada";
import { mesmoArquivo, planoDoEspelho, raizDeVideos } from "../../supabase/functions/mesa-videos/modulos/espelho-no-workspace";
import { acaoDaOrganizacao } from "../../supabase/functions/mesa-videos/modulos/organizador-de-takes";

/**
 * Organizador da Entrada (02/10): um vídeo ou vários, variantes juntas,
 * clipes por cena (nome, fala e Jev), pastas da casa, ruído só quando pedido,
 * e o espelho no Workspace sem copiar arquivo.
 */

let n = 0;
function arq(p: Partial<ArquivoDaEntrada> & { nome: string }): ArquivoDaEntrada {
  n++;
  return {
    id: p.id || `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    nome: p.nome,
    nome_original: p.nome_original || p.nome,
    tipo: p.tipo || "bruto",
    grupo: p.grupo ?? null,
    roteiro_id: p.roteiro_id ?? null,
    cena_ref: p.cena_ref ?? null,
    melhor: p.melhor ?? false,
    estado: p.estado || "ativo",
    gravado_em: p.gravado_em ?? null,
    criado_em: p.criado_em || `2026-10-02T10:${String(n % 60).padStart(2, "0")}:00Z`,
    duracao_s: p.duracao_s ?? 10,
    largura: p.largura ?? 1080,
    altura: p.altura ?? 1920,
    origem: p.origem ?? null,
    mime: p.mime ?? "video/mp4",
    bytes: p.bytes ?? null,
  };
}

describe("organizador da entrada: categorias e variantes", () => {
  it("lê a categoria pelo tipo, pela origem e pelo nome", () => {
    expect(categoriaDoArquivo(arq({ nome: "IMG_1234.MOV" }))).toBe("bruto");
    expect(categoriaDoArquivo(arq({ nome: "voz.m4a", tipo: "audio", mime: "audio/mp4" }))).toBe("audio");
    expect(categoriaDoArquivo(arq({ nome: "Abertura (cena 9:16)", tipo: "cena" }))).toBe("cena_motion");
    expect(categoriaDoArquivo(arq({ nome: "Abertura (still 9:16)", tipo: "still", origem: { motion_id: "m", cena_id: "c" } }))).toBe("cena_motion");
    expect(categoriaDoArquivo(arq({ nome: "Reel v2 (amostra 9:16)", tipo: "amostra" }))).toBe("amostra");
    expect(categoriaDoArquivo(arq({ nome: "Reel v2 (render 9:16)", tipo: "render" }))).toBe("exportado");
    expect(categoriaDoArquivo(arq({ nome: "x (sem legenda).mp4", tipo: "gerado", origem: { tipo: "tratamento", de_arquivo_id: "a" } }))).toBe("tratado");
    expect(categoriaDoArquivo(arq({ nome: "quadro", tipo: "quadro" }))).toBe("imagem");
    expect(baseDoNome("Abertura (amostra 5 s 16:9)")).toBe("Abertura");
  });

  it("a mesma cena do Motion em 4 variantes vira uma linha, com o vídeo final na frente", () => {
    const o = { motion_id: "m1", cena_id: "c1" };
    const lista = [
      arq({ nome: "Abertura (amostra 5 s 9:16)", tipo: "amostra", origem: { ...o, formato: "9:16" } }),
      arq({ nome: "Abertura (still 9:16)", tipo: "still", origem: { ...o, formato: "9:16" } }),
      arq({ nome: "Abertura (cena 9:16)", tipo: "cena", origem: { ...o, formato: "9:16" } }),
      arq({ nome: "Abertura (cena 16:9)", tipo: "cena", origem: { ...o, formato: "16:9" } }),
      arq({ nome: "Fechamento (cena 9:16)", tipo: "cena", origem: { motion_id: "m1", cena_id: "c2" } }),
    ];
    const g = agruparVariantes(lista);
    expect(g).toHaveLength(2);
    expect(g[0].variantes).toHaveLength(4);
    expect(g[0].principal.tipo).toBe("cena");
    expect(g[0].base).toBe("Abertura");
  });

  it("brutos nunca se juntam como variante", () => {
    const g = agruparVariantes([arq({ nome: "take.mp4" }), arq({ nome: "take.mp4" })]);
    expect(g).toHaveLength(2);
  });
});

describe("organizador da entrada: um vídeo ou vários", () => {
  it("um bruto é um vídeo; um longo com extras curtos também; vários parecidos são clipes", () => {
    expect(modoDaEntrada([arq({ nome: "a.mp4", duracao_s: 300 })]).modo).toBe("um_video");
    const longo = arq({ nome: "palestra.mp4", duracao_s: 600 });
    const r = modoDaEntrada([longo, arq({ nome: "b.mp4", duracao_s: 20 }), arq({ nome: "c.mp4", duracao_s: 15 })]);
    expect(r.modo).toBe("um_video");
    expect(r.principal).toBe(longo.id);
    expect(modoDaEntrada([arq({ nome: "a.mp4", duracao_s: 12 }), arq({ nome: "b.mp4", duracao_s: 14 }), arq({ nome: "c.mp4", duracao_s: 9 })]).modo).toBe("varios_clipes");
    expect(modoDaEntrada([arq({ nome: "x (cena 9:16)", tipo: "cena" })]).modo).toBe("sem_gravacao");
  });

  it("nome do vídeo: roteiro, nome dado pela pessoa ou a data (nome de câmera não serve)", () => {
    expect(nomeDeCamera("IMG_1234.MOV")).toBe(true);
    expect(nomeDeCamera("C0012.MP4")).toBe(true);
    expect(nomeDeCamera("Depoimento da Ana.mov")).toBe(false);
    expect(nomeDoVideo(arq({ nome: "Depoimento_da_Ana.mov" }))).toBe("Depoimento da Ana");
    expect(nomeDoVideo(arq({ nome: "IMG_9.MOV", gravado_em: "2026-10-02T12:00:00Z" }))).toBe("Vídeo de 02-10");
    const r = { id: "11111111-1111-4111-8111-111111111111", titulo: "Reel do lançamento", cenas: [] };
    expect(nomeDoVideo(arq({ nome: "IMG_9.MOV", roteiro_id: r.id }), [r])).toBe("Reel do lançamento");
  });

  it("um vídeo: renomeia com o nome do vídeo e separa em pastas (brutos, exportados, amostras)", () => {
    const bruto = arq({ nome: "Depoimento_da_Ana.mov", duracao_s: 240 });
    const render = arq({ nome: "Depoimento v1 (render 9:16)", tipo: "render", origem: { versao_id: "v1", formato: "9:16" } });
    const amostra = arq({ nome: "Depoimento v1 (amostra 9:16)", tipo: "amostra", origem: { versao_id: "v1", formato: "9:16" } });
    const p = proporOrganizacaoDaEntrada([bruto, render, amostra]);
    expect(p.leitura.modo).toBe("um_video");
    expect(p.prefixo).toBe("Depoimento da Ana");
    expect(p.pastas[bruto.id]).toBe("Depoimento da Ana / Brutos");
    expect(p.pastas[render.id]).toBe("Depoimento da Ana / Exportados");
    expect(p.pastas[amostra.id]).toBe("Depoimento da Ana / Amostras");
    expect(p.itens.find((i) => i.arquivo_id === bruto.id && i.operacao === "renomear")?.para).toBe("Depoimento da Ana.mov");
    // Nada arquivado sem pedir.
    expect(p.itens.some((i) => i.operacao === "arquivar")).toBe(false);
  });
});

describe("organizador da entrada: clipes picados por cena", () => {
  const texto1 = "oi gente hoje eu vou mostrar como limpar o sofá de veludo sem estragar o tecido";
  const texto1b = "oi gente hoje eu vou mostrar como limpar o sofá de veludo sem estragar nada";
  const texto2 = "agora o preço especial vale só até domingo então chama no direct";

  it("fala parecida é tomada da mesma cena; diferente é outra cena", () => {
    expect(semelhancaDaFala(texto1, texto1b)).toBeGreaterThanOrEqual(0.5);
    expect(semelhancaDaFala(texto1, texto2)).toBeLessThan(0.15);
  });

  it("junta por nome, por fala e pela decisão do Jev; numera pela ordem e as tomadas pela gravação", () => {
    const a = arq({ nome: "a.mp4", gravado_em: "2026-10-01T10:00:00Z" });
    const b = arq({ nome: "b.mp4", gravado_em: "2026-10-01T10:01:00Z" });
    const c = arq({ nome: "c.mp4", gravado_em: "2026-10-01T10:02:00Z" });
    const d = arq({ nome: "d.mp4", gravado_em: "2026-10-01T10:03:00Z" });
    const e = arq({ nome: "cena 5 take 2.mp4", gravado_em: "2026-10-01T10:04:00Z" });
    const f = arq({ nome: "cena5_take1.mp4", gravado_em: "2026-10-01T10:05:00Z" });
    const falas = { [a.id]: texto1, [b.id]: texto2, [c.id]: texto1b, [d.id]: "e esse aqui é outro assunto que ninguém repetiu" };
    const cenas = cenasDosClipes([a, b, c, d, e, f], { falas, decisoes: { [chaveDoPar(b.id, d.id)]: true } });
    const ids = cenas.map((x) => x.clipes.map((y) => y.id));
    expect(ids).toContainEqual([a.id, c.id]);
    expect(ids).toContainEqual([b.id, d.id]);
    // Take do nome manda na ordem das tomadas.
    expect(ids).toContainEqual([f.id, e.id]);
    expect(cenas.find((x) => x.clipes[0].id === b.id)?.por).toBe("jev");
    expect(cenas.find((x) => x.clipes[0].id === a.id)?.por).toBe("fala");
  });

  it("os pares em dúvida (nem iguais, nem diferentes) vão para o Jev", () => {
    const a = arq({ nome: "a.mp4" });
    const b = arq({ nome: "b.mp4" });
    const pares = paresEmDuvida([a, b], { [a.id]: "hoje eu vou mostrar como limpar o sofá de veludo", [b.id]: "eu vou mostrar como fazer a limpeza do tapete persa da sala" });
    expect(pares.length).toBe(1);
    expect(pares[0].semelhanca).toBeGreaterThan(0.15);
    expect(pares[0].semelhanca).toBeLessThan(0.5);
  });

  it("vários clipes: nomes roteiro_c01_t01, pastas Brutos / Cena 01 e o melhor take sugerido", () => {
    const a = arq({ nome: "a.mp4", gravado_em: "2026-10-01T10:00:00Z" });
    const b = arq({ nome: "b.mp4", gravado_em: "2026-10-01T10:01:00Z" });
    const c = arq({ nome: "c.mp4", gravado_em: "2026-10-01T10:02:00Z" });
    const p = proporOrganizacaoDaEntrada([a, b, c], { falas: { [a.id]: texto1, [b.id]: texto1b, [c.id]: texto2 }, melhores: true });
    expect(p.leitura.modo).toBe("varios_clipes");
    expect(p.cenas).toHaveLength(2);
    expect(p.pastas[a.id]).toBe("Brutos / Cena 01");
    expect(p.pastas[c.id]).toBe("Brutos / Cena 02");
    expect(p.itens.find((i) => i.arquivo_id === b.id && i.operacao === "renomear")?.para).toBe("clipe_c01_t02.mp4");
    expect(p.itens.find((i) => i.operacao === "marcar_melhor")?.arquivo_id).toBe(b.id);
    // O contrato comum aceita a proposta (apelidos, travas, Desfazer).
    const acao = acaoDaOrganizacao([a, b, c], p.itens, [], { id: "x", resumo: p.resumo });
    expect(acao && acao.itens.length).toBe(p.itens.length);
  });
});

describe("organizador da entrada: ruído e antes e depois", () => {
  it("ruído só quando pedido: amostra e still com cena pronta, render velho do mesmo formato", () => {
    const o = { motion_id: "m", cena_id: "c" };
    const amostra = arq({ nome: "A (amostra 5 s 9:16)", tipo: "amostra", origem: o, criado_em: "2026-10-01T09:00:00Z" });
    const still = arq({ nome: "A (still 9:16)", tipo: "still", origem: o, criado_em: "2026-10-01T09:01:00Z" });
    const cena = arq({ nome: "A (cena 9:16)", tipo: "cena", origem: o, criado_em: "2026-10-01T09:02:00Z" });
    const velho = arq({ nome: "R v1 (render 9:16)", tipo: "render", origem: { versao_id: "v", formato: "9:16" }, criado_em: "2026-10-01T08:00:00Z" });
    const novo = arq({ nome: "R v1 (render 9:16)", tipo: "render", origem: { versao_id: "v", formato: "9:16" }, criado_em: "2026-10-01T11:00:00Z" });
    const ruido = ruidoDaEntrada([amostra, still, cena, velho, novo]);
    expect(ruido.sort()).toEqual([amostra.id, still.id, velho.id].sort());
    expect(ruidoDaEntrada([amostra, still, cena], (id) => id === still.id)).toEqual([amostra.id]);
    const p = proporOrganizacaoDaEntrada([amostra, still, cena], { arquivarRuido: true });
    expect(p.itens.filter((i) => i.operacao === "arquivar").map((i) => i.arquivo_id).sort()).toEqual([amostra.id, still.id].sort());
  });

  it("o tratado vai para Antes e depois e acha o antes", () => {
    const antes = arq({ nome: "Ana.mov", duracao_s: 120 });
    const depois = arq({ nome: "Ana (sem legenda).mp4", tipo: "gerado", origem: { tipo: "tratamento", de_arquivo_id: antes.id } });
    const p = proporOrganizacaoDaEntrada([antes, depois]);
    expect(p.pastas[depois.id]).toBe("Ana / Antes e depois");
    expect(antesDoTratado(depois, [antes, depois])?.id).toBe(antes.id);
  });

  it("pastas na tela: Brutos antes de Exportados e Amostras, variantes juntas, Sem pasta no fim", () => {
    const lista = [
      arq({ nome: "x (amostra 9:16)", tipo: "amostra", grupo: "V / Amostras" }),
      arq({ nome: "v.mov", grupo: "V / Brutos" }),
      arq({ nome: "solto.mov" }),
      arq({ nome: "v (render 9:16)", tipo: "render", grupo: "V / Exportados", origem: { versao_id: "1" } }),
      arq({ nome: "v (render 16:9)", tipo: "render", grupo: "V / Exportados", origem: { versao_id: "1" } }),
    ];
    const t = pastasNaTela(lista);
    expect(t.map((x) => x.caminho)).toEqual(["V / Brutos", "V / Exportados", "V / Amostras", "Sem pasta"]);
    expect(t[1].grupos).toHaveLength(1);
    expect(t[1].total).toBe(2);
  });
});

describe("espelho no Workspace (sem copiar arquivo)", () => {
  it("acha a pasta de vídeos que já existe e o mesmo arquivo pelo tamanho", () => {
    const nos = [
      { id: "f1", parent_id: null, kind: "folder", name: "Videos" },
      { id: "w1", parent_id: null, kind: "file", name: "IMG_1234.MOV", mime: "video/quicktime", size_bytes: 5000 },
      { id: "w2", parent_id: "f1", kind: "file", name: "outro.mp4", mime: "video/mp4", size_bytes: 777 },
      { id: "w3", parent_id: null, kind: "file", name: "logo.png", mime: "image/png", size_bytes: 5000 },
    ];
    expect(raizDeVideos(nos)?.id).toBe("f1");
    expect(mesmoArquivo({ id: "a", nome: "Ana.mov", nome_original: "IMG_1234.MOV", grupo: "Ana / Brutos", bytes: 5000 }, nos[1])).toBe(true);
    const plano = planoDoEspelho(
      [
        { id: "a", nome: "Ana.mov", nome_original: "IMG_1234.MOV", grupo: "Ana / Brutos", bytes: 5000 },
        { id: "b", nome: "Ana (render 9:16)", nome_original: "r.mp4", grupo: "Ana / Exportados", bytes: 9999 },
      ],
      nos,
    );
    expect(plano.raiz_id).toBe("f1");
    expect(plano.grupos).toEqual([{ caminho: ["Videos", "Ana", "Brutos"], itens: [{ id: "w1", nome: "Ana.mov", ordem: 0 }] }]);
    expect(plano.so_na_mesa).toBe(1);
    expect(plano.so_no_workspace).toBe(1);
  });

  it("sem pasta de vídeos: propõe Vídeos; caminho longo cabe em 4 níveis", () => {
    const plano = planoDoEspelho([{ id: "a", nome: "c.mp4", nome_original: "c.mp4", grupo: "Reel / Brutos / Cena 02 / Extra", bytes: 1 }], [{ id: "w", parent_id: null, kind: "file", name: "c.mp4", mime: "video/mp4", size_bytes: 1 }]);
    expect(plano.raiz_id).toBeNull();
    expect(plano.grupos[0].caminho).toEqual(["Vídeos", "Reel", "Brutos", "Cena 02 - Extra"]);
  });
});

describe("organizador da entrada: Jev nos pares em dúvida", () => {
  it("uma pergunta Choice por par, com o começo da fala; só decide com confiança", () => {
    const a = arq({ nome: "a.mp4", duracao_s: 8.4 });
    const b = arq({ nome: "b.mp4" });
    const c = arq({ nome: "c.mp4" });
    const pares = [
      { a: a.id, b: b.id, semelhanca: 0.3 },
      { a: a.id, b: c.id, semelhanca: 0.2 },
    ];
    const q = perguntaDosPares(pares, [a, b, c], { [a.id]: "fala   do a", [b.id]: "fala do b" });
    expect(Object.keys(q.questions)).toEqual(["p1", "p2"]);
    expect(q.questions.p1.type).toBe("choice");
    expect(Object.keys(q.questions.p1.criteria)).toEqual(["mesma_cena", "cenas_diferentes"]);
    expect((q.state.pares as Record<string, { clipe_a: { fala: string; duracao_s: number } }>).p1.clipe_a).toMatchObject({ fala: "fala do a", duracao_s: 8 });
    const d = decisoesDoJev(pares, { p1: { choice: "mesma_cena", confidence: 0.9 }, p2: { choice: "mesma_cena", confidence: 0.4 } });
    expect(d).toEqual({ [chaveDoPar(a.id, b.id)]: true });
    expect(decisoesDoJev(pares, { p2: { choice: "cenas_diferentes", confidence: 0.8 } })).toEqual({ [chaveDoPar(a.id, c.id)]: false });
  });
});
