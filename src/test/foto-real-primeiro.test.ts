// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  camposDaDescricao,
  CORTE_DA_FOTO_REAL,
  escolhaDaFotoReal,
  escolherFotoReal,
  formatoDaTarefa,
  fotoReal,
  itemDaDescricaoDaTarefa,
  LINHA_SEM_FOTO_REAL,
  type FotoDoAcervo,
} from "../../supabase/functions/agente-calendario/modulos/midia-da-peca-regras";
import {
  ESQUEMA_DA_LEITURA_DO_ACERVO,
  fotosDaRodada,
  MAX_TENTATIVAS_DA_LEITURA,
  normalizarLeituraDoAcervo,
  patchDaFalha,
  patchDaLeitura,
  precisaDeLeitura,
  tentativasDaLeitura,
  type FotoParaLer,
} from "../../supabase/functions/acervo-ler-fotos/regras";
import { lerArquivos, type ItemParaLer } from "../../supabase/functions/workspace-organizar/leitura";
import { direcaoComFotoReal, precisaDeFotoReal } from "../components/mesa/useFotoRealDaPeca";

/**
 * 26/10/2026 (dono: "o Estúdio tem que ler as fotos e achar interessante colocar de forma inteligente imagens
 * reais quando tem"). Três partes: o robô que lê as fotos sem descrição, a mídia da peça para qualquer tarefa
 * (sem proposta do Mês) e a foto real primeiro no Estúdio (arte e vídeo), com a linha "vai gerar com IA".
 */

const ler = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// Descrição de uma peça criada pelo MCP (aceleriq_create_editorial_item), como chega na tarefa.
const DESCRICAO_DO_MCP = [
  "Tema: Diferença entre BPC e aposentadoria",
  "Formato: Vídeo rápido (Estúdio)",
  "Tipo: conteúdo principal",
  "Fase 2: educação e quebra de objeções",
  "Pilar: BPC/LOAS",
  "Gancho do momento: 'Você sabia' curto",
  "",
  "Gancho: Você sabia que o BPC não é aposentadoria?",
  "",
  "Resumo: Vídeo de 20 a 25 s com fotos reais do escritório.",
  "",
  "Caminho do vídeo: Gerar com IA",
  "Estilo de vídeo: transformacao",
  "Direção do vídeo: 4 cenas de 6 s. Cena 1: foto real da estante, push-in lento.",
  "Narração: BPC não é aposentadoria.",
  "Referências: 44444444-4444-4444-8444-444444444444, inventada",
  "",
  "Roteiro das cenas:",
  "Cena 1: estante com livros",
  "Cena 2: mesa com agenda",
  "",
  "Legenda (copy):",
  "Você sabia?",
  "Cada caso precisa de análise.",
].join("\n");

describe("item a partir da tarefa (peça sem proposta do Mês)", () => {
  it("lê os campos da descrição, inclusive os blocos de várias linhas", () => {
    const c = camposDaDescricao(DESCRICAO_DO_MCP);
    expect(c["Tema"]).toBe("Diferença entre BPC e aposentadoria");
    expect(c["Gancho"]).toBe("Você sabia que o BPC não é aposentadoria?");
    expect(c["Gancho do momento"]).toBe("'Você sabia' curto");
    expect(c["Roteiro das cenas"]).toBe("Cena 1: estante com livros\nCena 2: mesa com agenda");
    expect(c["Legenda (copy)"]).toBe("Você sabia?\nCada caso precisa de análise.");
    // "Fase 2: ..." não é rótulo conhecido e fica de fora.
    expect(Object.keys(c)).not.toContain("Fase 2");
  });

  it("monta o item de vídeo com caminho, direção, narração e só ids reais nas referências", () => {
    const item = itemDaDescricaoDaTarefa({ id: "t1", title: "Vídeo IA: BPC", description: DESCRICAO_DO_MCP, delivery_type: "video", due_date: "2026-11-03" });
    expect(item.formato).toBe("video");
    expect(item.mesa).toBe("video");
    expect(item.tema).toBe("Diferença entre BPC e aposentadoria");
    expect(item.gancho).toBe("Você sabia que o BPC não é aposentadoria?");
    expect(item.caminho_video).toBe("ia");
    expect(item.data).toBe("2026-11-03");
    expect(String(item.referencia)).toContain("fotos reais do escritório");
    expect(String(item.referencia)).toContain("Cena 2: mesa com agenda");
    const video = item.video as { estilo: string; prompt: string; narracao: string; referencias: string[] };
    expect(video.estilo).toBe("transformacao");
    expect(video.prompt).toContain("push-in lento");
    expect(video.narracao).toBe("BPC não é aposentadoria.");
    expect(video.referencias).toEqual(["44444444-4444-4444-8444-444444444444"]);
    expect(item.copy).toBe("Você sabia?\nCada caso precisa de análise.");
  });

  it("carrossel: as lâminas do roteiro viram cards; sem descrição, o título é o tema", () => {
    const item = itemDaDescricaoDaTarefa({
      id: "t2",
      title: "5 erros na cozinha",
      delivery_type: "carousel",
      description: "Tema: 5 erros ao planejar a cozinha\nRoteiro dos cards:\nCard 1 (gancho): Você comete esses erros?\n  Estilo: fundo escuro\nCard 2: Bancada baixa demais",
    });
    expect(item.formato).toBe("carrossel");
    expect(item.cards).toEqual([{ ordem: 1, funcao: "gancho", texto: "Você comete esses erros?" }, { ordem: 2, funcao: "", texto: "Bancada baixa demais" }]);
    const sem = itemDaDescricaoDaTarefa({ id: "t3", title: "Peça de foto: Bancada de quartzo", delivery_type: "carousel", description: null });
    expect(sem.tema).toBe("Bancada de quartzo");
    expect(sem.formato).toBe("foto");
    expect(sem.gancho).toBeNull();
  });

  it("formato pela entrega e pela linha Formato", () => {
    expect(formatoDaTarefa({ title: "x", delivery_type: "reel" })).toBe("video");
    expect(formatoDaTarefa({ title: "x", delivery_type: "static" }, "Vídeo rápido (Estúdio)")).toBe("video");
    expect(formatoDaTarefa({ title: "x", delivery_type: "carousel" })).toBe("carrossel");
    expect(formatoDaTarefa({ title: "x", delivery_type: "story" }, "Stories")).toBe("estatico");
    expect(formatoDaTarefa({ title: "x", delivery_type: "static" }, "Peça de foto (Mesa Foto, 4 fotos)")).toBe("foto");
  });
});

// ------------------------------------------------------------------ foto real primeiro

const foto = (id: string, extra: Partial<FotoDoAcervo> = {}): FotoDoAcervo => ({ id, nome: `foto ${id}`, descricao: "parede verde com samambaias na varanda", tags: [], categoria: "ambiente", ativa: true, gerada: false, ...extra });

describe("foto real: o que conta", () => {
  it("gerada por IA, referência da internet, arte, print e logo nunca contam", () => {
    expect(fotoReal(foto("a"))).toBe(true);
    expect(fotoReal(foto("b", { gerada: true }))).toBe(false);
    expect(fotoReal(foto("c", { tags: ["gerada"] }))).toBe(false);
    expect(fotoReal(foto("d", { tags: ["referencia_web"] }))).toBe(false);
    expect(fotoReal(foto("e", { tags: ["arte_ou_print"] }))).toBe(false);
    expect(fotoReal(foto("f", { tags: ["pessoa_sintetica"] }))).toBe(false);
    expect(fotoReal(foto("g", { categoria: "arte" }))).toBe(false);
    expect(fotoReal(foto("h", { categoria: "logo" }))).toBe(false);
    expect(fotoReal(foto("i", { ativa: false }))).toBe(false);
    // Ainda não lida (sem categoria nem etiqueta): conta, e o Jev decide se serve.
    expect(fotoReal(foto("j", { categoria: null, descricao: null, nome: "varanda jardim cliente" }))).toBe(true);
  });

  it("acima do corte vai a foto real; abaixo (ou sem nota), gera com IA e a linha diz isso", () => {
    const cands = [foto("a"), foto("b")];
    const real = escolhaDaFotoReal(cands, { m0: { score: 1.9 }, m1: { score: 2.6 } });
    expect(real.modo).toBe("real");
    expect(real.fotos).toEqual([{ id: "b", nome: "foto b", nota: 2.6 }]);
    expect(real.linha).toContain("Foto real do acervo: foto b");
    expect(real.linha).not.toMatch(/[\u2013\u2014]/);
    const ia = escolhaDaFotoReal(cands, { m0: { score: CORTE_DA_FOTO_REAL - 0.01 }, m1: {} });
    expect(ia).toEqual({ modo: "ia", fotos: [], linha: LINHA_SEM_FOTO_REAL });
    expect(LINHA_SEM_FOTO_REAL).toBe("Sem foto real que combine: vai gerar com IA");
  });

  it("escolherFotoReal só pergunta ao Jev pelas reais; sem candidata real, nem pergunta (sem custo)", async () => {
    const estados: any[] = [];
    const julgar = async (state: any) => {
      estados.push(state);
      const r: Record<string, { score: number }> = {};
      (state.candidatas as string[]).forEach((c, i) => { r[`m${i}`] = { score: /samambaias/.test(c) ? 2.4 : 0.3 }; });
      return r;
    };
    const fotos = [
      foto("gerada", { gerada: true, descricao: "samambaias geradas" }),
      foto("web", { tags: ["referencia_web"] }),
      foto("real", { nome: "projeto Ana" }),
      foto("outra", { descricao: "reunião no escritório", nome: "equipe" }),
    ];
    const r = await escolherFotoReal(fotos, "jardim vertical na varanda com samambaias", julgar, { uso: "capa", peca: { tema: "jardim" } });
    expect(estados).toHaveLength(1);
    expect(estados[0].candidatas.join(" ")).not.toContain("geradas");
    expect(r.modo).toBe("real");
    expect(r.fotos[0].id).toBe("real");
    expect(r.julgou).toBe(true);

    let chamou = false;
    const nada = await escolherFotoReal([foto("x", { gerada: true })], "jardim", async () => { chamou = true; return {}; }, { uso: "capa", peca: {} });
    expect(chamou).toBe(false);
    expect(nada).toEqual({ modo: "ia", fotos: [], linha: LINHA_SEM_FOTO_REAL, julgou: false });
  });

  it("vídeo da pauta: pergunta só sem imagem de partida; a foto real vira a referência da direção", () => {
    expect(precisaDeFotoReal({ midia: null, video: undefined })).toBe(true);
    expect(precisaDeFotoReal({ midia: { acervo: [{ id: "a", nome: "a", nota: 2 }] } as any, video: undefined })).toBe(false);
    expect(precisaDeFotoReal({ midia: null, video: { estilo: "produto", prompt: "p", referencias: ["x"], narracao: "", formato: "9:16" } })).toBe(false);
    const real = { modo: "real" as const, fotos: [{ id: "f1", nome: "jardim", nota: 2.5 }], linha: "Foto real do acervo: jardim" };
    expect(direcaoComFotoReal(undefined, real)?.referencias).toEqual(["f1"]);
    const comDirecao = direcaoComFotoReal({ estilo: "jardim", prompt: "p", referencias: [], narracao: "fala", formato: "9:16" }, real);
    expect(comDirecao).toEqual({ estilo: "jardim", prompt: "p", referencias: ["f1"], narracao: "fala", formato: "9:16" });
    const ia = { modo: "ia" as const, fotos: [], linha: LINHA_SEM_FOTO_REAL };
    expect(direcaoComFotoReal(undefined, ia)).toBeUndefined();
  });

  it("Estúdio: a foto real sugerida vai ao diretor e, sem foto em nenhuma lâmina, entra na capa", () => {
    const estudio = ler("supabase/functions/estudio-arte/index.ts");
    expect(estudio).toContain("escolherFotoReal(acervo, textoDoItem || item.tarefa.title");
    expect(estudio).toContain("foto_real_sugerida:");
    expect(estudio).toContain("cards[0] = { ...cards[0], imagens_ids: [sugerida] };");
    expect(estudio).toContain("direcao.foto_real = fotoReal ? { ...fotoReal, linha: linhaDaFoto, lamina: laminaDaFoto } : null;");
    // Fotos já escolhidas pela equipe (arte rápida, plano da campanha) e carrossel contínuo ficam como estão.
    expect(estudio).toContain("const comFotoEscolhida = semMarca || (!!rapida && rapida.fotosDoAcervo.length > 0) || plano.pecas.length > 0 || pedidoInfinito === true;");
    expect(ler("src/components/mesa/AbaEstudio.tsx")).toContain("{trabalho.direcao.foto_real.linha}");
  });
});

// ------------------------------------------------------------------ o robô que lê as fotos

const paraLer = (id: string, extra: Partial<FotoParaLer> = {}): FotoParaLer => ({
  id, client_id: "c1", nome: `IMG_${id}.jpg`, storage_bucket: "workspace", storage_path: `c1/${id}.jpg`, categoria: null, tags: [], descricao: null, ativa: true, gerada: false, ...extra,
});

describe("robô acervo-ler-fotos: quem entra na fila", () => {
  it("só ativa, sem descrição, não logo, não gerada, não da internet, imagem legível e abaixo do teto de tentativas", () => {
    expect(precisaDeLeitura(paraLer("a"))).toBe(true);
    expect(precisaDeLeitura(paraLer("b", { descricao: "já descrita" }))).toBe(false);
    expect(precisaDeLeitura(paraLer("c", { descricao: "   " }))).toBe(true);
    expect(precisaDeLeitura(paraLer("d", { categoria: "logo" }))).toBe(false);
    expect(precisaDeLeitura(paraLer("e", { gerada: true }))).toBe(false);
    expect(precisaDeLeitura(paraLer("f", { tags: ["referencia_web"] }))).toBe(false);
    expect(precisaDeLeitura(paraLer("g", { ativa: false }))).toBe(false);
    expect(precisaDeLeitura(paraLer("h", { storage_path: "c1/h.heic" }))).toBe(false);
    expect(precisaDeLeitura(paraLer("i", { storage_path: "c1/sem-extensao" }))).toBe(true);
    expect(precisaDeLeitura(paraLer("j", { tags: [`leitura_falhou:${MAX_TENTATIVAS_DA_LEITURA}`] }))).toBe(false);
    expect(precisaDeLeitura(paraLer("k", { tags: ["leitura_falhou:1"], categoria: "arte" }))).toBe(true);
  });

  it("a rodada respeita o limite e pula o cliente sem saldo", () => {
    const fotos = [paraLer("a"), paraLer("b", { client_id: "pobre" }), paraLer("c"), paraLer("d", { descricao: "x" }), paraLer("e")];
    const g = fotosDaRodada(fotos, 2, (c) => c !== "pobre");
    expect([...g.keys()]).toEqual(["c1"]);
    expect(g.get("c1")!.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("tentativas pela etiqueta; a falha soma uma e troca a etiqueta anterior", () => {
    expect(tentativasDaLeitura(["x", "leitura_falhou:2"])).toBe(2);
    expect(tentativasDaLeitura([])).toBe(0);
    expect(patchDaFalha({ tags: ["jardim", "leitura_falhou:1"] })).toEqual({ tags: ["jardim", "leitura_falhou:2"] });
  });
});

describe("robô acervo-ler-fotos: o que grava", () => {
  const bruta = { imagem: 1, real: true, categoria: "ambiente", descricao: "Varanda com jardim vertical de samambaias \u2014 luz da tarde.", assunto: "Jardim vertical", ambiente: "Varanda", objetos: ["samambaia", "vaso de barro", "banco", "rede", "quinto"], pessoas: "nenhuma", antes_depois: "depois" };

  it("normaliza a leitura (sem travessão) e arte ou logo nunca é real", () => {
    const l = normalizarLeituraDoAcervo(bruta)!;
    expect(l.descricao).toBe("Varanda com jardim vertical de samambaias, luz da tarde.");
    expect(l.objetos).toHaveLength(4);
    expect(l.real).toBe(true);
    expect(normalizarLeituraDoAcervo({ ...bruta, categoria: "arte", real: true })!.real).toBe(false);
    expect(normalizarLeituraDoAcervo({ ...bruta, categoria: "inventada" })!.categoria).toBe("outro");
    expect(normalizarLeituraDoAcervo({ ...bruta, descricao: "" })).toBeNull();
    expect(normalizarLeituraDoAcervo(null)).toBeNull();
  });

  it("grava descrição, etiquetas (sem repetir, as antigas ficam) e a categoria só quando vazia ou ?", () => {
    const l = normalizarLeituraDoAcervo(bruta)!;
    const p = patchDaLeitura({ categoria: null, tags: ["marca:abc", "Jardim Vertical", "leitura_falhou:1"] }, l);
    expect(p.descricao).toBe(l.descricao);
    expect(p.categoria).toBe("ambiente");
    expect(p.tags).toEqual(["marca:abc", "Jardim Vertical", "varanda", "samambaia", "vaso de barro", "banco", "sem_pessoa", "depois", "foto_real"]);
    expect(patchDaLeitura({ categoria: "?", tags: [] }, l).categoria).toBe("ambiente");
    expect(patchDaLeitura({ categoria: "produto", tags: [] }, l).categoria).toBeUndefined();
    const arte = normalizarLeituraDoAcervo({ ...bruta, real: false, categoria: "arte", pessoas: "varias", antes_depois: "nao" })!;
    expect(patchDaLeitura({ categoria: "pessoa", tags: [] }, arte).tags).toEqual(["jardim vertical", "varanda", "samambaia", "vaso de barro", "banco", "com_pessoa", "arte_ou_print"]);
  });

  it("esquema estrito (tudo obrigatório, sem propriedade extra)", () => {
    const item = (ESQUEMA_DA_LEITURA_DO_ACERVO.schema.properties.leituras as any).items;
    expect(item.additionalProperties).toBe(false);
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
  });

  it("usa o leitor em lotes do organizador com o esquema próprio (normalizar injetado)", async () => {
    const png = (n: number): ItemParaLer => {
      // PNG mínimo válido o bastante para defeitoDaImagem (assinatura, IHDR e IEND).
      const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
      return { id: `f${n}`, nome: `f${n}.png`, video: false, duracao: null, largura: 1, altura: 1, imagem: { bytes: b, mime: "image/png" } };
    };
    const r = await lerArquivos([png(1), png(2)], {
      normalizar: normalizarLeituraDoAcervo,
      lerLote: async (lote) => ({ leituras: lote.map((_, i) => ({ ...bruta, imagem: i + 1, descricao: i === 0 ? bruta.descricao : "" })), custo: 0.001 }),
      erroQueParaTudo: () => false,
      recusouImagem: () => false,
      descrever: (e) => String(e),
      log: () => {},
    });
    expect(r.leituras.map((l) => l.id)).toEqual(["f1"]);
    expect(r.leituras[0].leitura.categoria).toBe("ambiente");
    expect(r.falhas.map((f) => f.id)).toEqual(["f2"]);
  });

  it("função: só cron ou chave de serviço, nunca apaga, não escreve em files e não passa por cima de descrição nova", () => {
    const f = ler("supabase/functions/acervo-ler-fotos/index.ts");
    expect(f).toContain('.or("descricao.is.null,descricao.eq.")');
    expect(f).not.toMatch(/\.delete\(/);
    expect(f).not.toContain('from("files")');
    expect(f).toContain("SALDO_MINIMO_DA_LEITURA");
    expect(f).not.toContain("is_staff");
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.acervo-ler-fotos\]\s+verify_jwt = true/);
    const m = ler("supabase/migrations/20261026150000_acervo_ler_fotos_cron.sql");
    expect(m).toContain("cron.schedule('acervo-ler-fotos-30min', '23,53 * * * *'");
    expect(m).toContain("PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'acervo-ler-fotos-30min';");
    expect(m).toContain("'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')");
  });
});
