// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  acoesDaGeracaoDoTemplate,
  instrucoesDoConteudo,
  lerConteudoGerado,
  promptDaFotoDoPost,
  TAMANHO_DA_FOTO,
  type DepsDaGeracao,
  type TrabalhoDaGeracao,
} from "../../supabase/functions/estudio-arte/modulos/template-geracao";
import { acoesDasFontesReais, resultadoDoOpenverse, rotuloDaLicencaDoOpenverse, type DepsDasFontesReais, type TrabalhoComFontesReais } from "../../supabase/functions/estudio-arte/modulos/fontes-reais-do-diretor";
import { normalizarTemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TRABALHO = "22222222-2222-4222-8222-222222222222";
const ch = { userId: "equipe" };
const erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Object.assign(new Error(mensagem), { status, codigo, detalhes });
type T = TrabalhoDaGeracao & { custo_usd: number };

function cenario(respostaDoRedator: unknown = { gancho: "Pão às 7h", posts: [{ ordem: 1, texto: "Pão às 7h." }, { ordem: 2, texto: "Fermentação natural." }, { ordem: 3, texto: "Chegue cedo." }], legenda: "Pão às 7h.\n\n#padaria" }) {
  let atual: T = {
    id: TRABALHO, client_id: CLIENTE, status: "dirigido", tipo: "social", entrega_status: null, legenda: null, custo_usd: 2, modelo_imagem_id: "gpt-image",
    direcao: { formato: "feed_4x5", cards: [{ ordem: 1, texto_exato: "Capa" }, { ordem: 2, texto_exato: "Meio" }, { ordem: 3, texto_exato: "Fim" }] },
    cards: [],
  };
  const escrever = vi.fn(async () => ({ json: respostaDoRedator, custoUsd: 0.03, saldoUsd: 9 }));
  const gerar = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png", custoUsd: 0.04, saldoUsd: 8 }));
  const guardar = vi.fn(async () => `${CLIENTE}/estudio/template/foto.png`);
  const descartar = vi.fn(async () => undefined);
  const deps: DepsDaGeracao<typeof ch, T> = {
    erro, json: (b) => new Response(JSON.stringify(b)),
    trabalhoComAcesso: vi.fn(async () => structuredClone(atual)),
    mutarTrabalho: vi.fn(async (_id, mudar) => { atual = { ...atual, ...mudar(structuredClone(atual)) } as T; return structuredClone(atual); }),
    ehPostDeFotos: () => false,
    atualizarTexto: (t, ordem, texto) => ({ ...t.direcao, cards: t.direcao.cards.map((c) => (c.ordem === ordem ? { ...c, texto_exato: texto } : c)) }),
    estimarTexto: vi.fn(async () => 0.031),
    estimarImagem: vi.fn(async () => 0.042),
    escreverTexto: escrever, gerarFoto: gerar, guardarFoto: guardar, descartarUpload: descartar,
  };
  const acoes = acoesDaGeracaoDoTemplate(deps);
  return { deps, acoes, escrever, gerar, guardar, descartar, ler: () => atual, mudar: (v: Partial<T>) => { atual = { ...atual, ...v } as T; } };
}
const json = async (r: Response) => JSON.parse(await r.text());

describe("template_conteudo: texto do post com custo antes", () => {
  it("sem confirmação responde 409 com a estimativa e não chama o redator", async () => {
    const c = cenario();
    await expect(c.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "twitter" })).rejects.toMatchObject({ status: 409, codigo: "confirmar_custo", detalhes: { precisa_confirmar: true, custo_estimado_usd: 0.031 } });
    expect(c.escrever).not.toHaveBeenCalled();
    expect(c.ler().custo_usd).toBe(2);
  });
  it("fio do X escreve um post por lâmina, grava a legenda pedida e soma o custo", async () => {
    const c = cenario();
    const r = await json(await c.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "twitter", todas: true, gravar_legenda: true, tema: "pão", confirmado: true }));
    expect(r.posts.map((p: { ordem: number }) => p.ordem)).toEqual([1, 2, 3]);
    expect(c.ler().direcao.cards.map((x) => x.texto_exato)).toEqual(["Pão às 7h.", "Fermentação natural.", "Chegue cedo."]);
    expect(c.ler().legenda).toBe("Pão às 7h.\n\n#padaria");
    expect(c.ler().custo_usd).toBeCloseTo(2.03);
    const pedido = (c.escrever.mock.calls[0] as unknown as Array<Record<string, any>>)[2];
    expect(pedido.rede).toBe("twitter");
    expect(pedido.pedido).toMatchObject({ tema: "pão", ordens_pedidas: [1, 2, 3], quantidade: 3 });
    expect(pedido.sistema).toContain("FIO de 3 posts");
  });
  it("post único do X mexe só na lâmina aberta; Instagram só na legenda", async () => {
    const x = cenario();
    await x.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 2, rede: "twitter", confirmado: true });
    expect(x.ler().direcao.cards.map((c) => c.texto_exato)).toEqual(["Capa", "Fermentação natural.", "Fim"]);
    expect(x.ler().legenda).toBeNull();
    const ig = cenario();
    const r = await json(await ig.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "instagram", gravar_legenda: true, confirmado: true }));
    expect(r.posts).toEqual([]);
    expect(ig.ler().direcao.cards.map((c) => c.texto_exato)).toEqual(["Capa", "Meio", "Fim"]);
    expect(ig.ler().legenda).toBe("Pão às 7h.\n\n#padaria");
  });
  it("texto acima de 280 volta com aviso, sem ser cortado", async () => {
    const longo = "a".repeat(300);
    const c = cenario({ gancho: "a", posts: [{ ordem: 1, texto: longo }], legenda: "" });
    const r = await json(await c.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "twitter", confirmado: true }));
    expect(r.posts[0].texto).toBe(longo);
    expect(r.avisos.join(" ")).toContain("280");
  });
  it("resposta vazia cobra o que a IA gastou e recusa sem apagar o texto", async () => {
    const c = cenario({ gancho: "", posts: [], legenda: "" });
    await expect(c.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "story", todas: true, confirmado: true })).rejects.toMatchObject({ status: 502, codigo: "conteudo_template_vazio" });
    expect(c.ler().custo_usd).toBeCloseTo(2.03);
    expect(c.ler().direcao.cards[0].texto_exato).toBe("Capa");
  });
  it("trabalho em aprovação, rede desconhecida e anúncio são recusados antes de gastar", async () => {
    const c = cenario();
    c.mudar({ entrega_status: "aguardando_cliente" });
    await expect(c.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "twitter", confirmado: true })).rejects.toMatchObject({ status: 409, codigo: "trabalho_entregue" });
    await expect(c.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "tiktok", confirmado: true })).rejects.toMatchObject({ status: 400 });
    c.mudar({ entrega_status: null, tipo: "ads" });
    await expect(c.acoes.template_conteudo(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "twitter", confirmado: true })).rejects.toMatchObject({ codigo: "template_indisponivel" });
    expect(c.escrever).not.toHaveBeenCalled();
  });
  it("instruções trazem os limites reais e a leitura respeita as ordens pedidas", () => {
    expect(instrucoesDoConteudo("twitter", 1)).toContain("280");
    expect(instrucoesDoConteudo("instagram", 4)).toContain("125");
    expect(instrucoesDoConteudo("story", 3)).toContain("3 telas");
    const lido = lerConteudoGerado({ posts: [{ ordem: 9, texto: "intruso" }, { ordem: 1, texto: "ok" }] }, "twitter", [1, 2]);
    expect(lido.posts).toEqual([{ ordem: 1, texto: "ok" }]);
    expect(lido.avisos.join(" ")).toContain("lâmina 2");
  });
});

describe("template_imagem: foto do post pelo gerador, sem texto", () => {
  it("sem confirmação responde 409 com a estimativa; nada é gerado", async () => {
    const c = cenario();
    await expect(c.acoes.template_imagem(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "instagram", proporcao: "4:5" })).rejects.toMatchObject({ status: 409, codigo: "confirmar_custo", detalhes: { custo_estimado_usd: 0.042 } });
    expect(c.gerar).not.toHaveBeenCalled();
  });
  it("gera no tamanho da proporção, guarda na pasta do cliente e acrescenta à lâmina com o custo", async () => {
    const c = cenario();
    const r = await json(await c.acoes.template_imagem(ch, { trabalho_id: TRABALHO, ordem: 2, rede: "twitter", proporcao: "16:9", descricao: "pão na bancada", confirmado: true }));
    const chamadaGerar = (c.gerar.mock.calls[0] as unknown as Array<Record<string, any>>)[2];
    expect(chamadaGerar).toMatchObject({ tamanho: TAMANHO_DA_FOTO["16:9"] });
    const prompt = chamadaGerar.prompt as string;
    expect(prompt).toContain("pão na bancada");
    expect(prompt).toContain("SEM TEXTO NA IMAGEM");
    expect(r.imagem).toMatchObject({ caminho: `${CLIENTE}/estudio/template/foto.png`, origem: "gerador", proporcao: "16:9" });
    const card = c.ler().direcao.cards[1] as { imagens_do_template?: unknown[] };
    expect(card.imagens_do_template).toHaveLength(1);
    expect(c.ler().custo_usd).toBeCloseTo(2.04);
  });
  it("sem modelo de imagem ou com proporção inválida recusa antes de gastar", async () => {
    const c = cenario();
    c.mudar({ modelo_imagem_id: null });
    await expect(c.acoes.template_imagem(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "twitter", proporcao: "16:9", confirmado: true })).rejects.toMatchObject({ codigo: "sem_modelo_de_imagem" });
    await expect(c.acoes.template_imagem(ch, { trabalho_id: TRABALHO, ordem: 1, rede: "twitter", proporcao: "3:1", confirmado: true })).rejects.toMatchObject({ status: 400 });
    expect(c.gerar).not.toHaveBeenCalled();
  });
  it("lâmina que some no meio descarta o arquivo, mas registra o custo pago", async () => {
    const c = cenario();
    c.gerar.mockImplementationOnce(async () => { c.mudar({ direcao: { ...c.ler().direcao, cards: [{ ordem: 1, texto_exato: "Capa" }] } }); return { bytes: new Uint8Array([1]), mime: "image/png", custoUsd: 0.04, saldoUsd: 8 }; });
    await expect(c.acoes.template_imagem(ch, { trabalho_id: TRABALHO, ordem: 2, rede: "twitter", proporcao: "16:9", confirmado: true })).rejects.toMatchObject({ codigo: "lamina_template_alterada" });
    expect(c.descartar).toHaveBeenCalledWith(`${CLIENTE}/estudio/template/foto.png`);
    expect(c.ler().custo_usd).toBeCloseTo(2.04);
  });
  it("o prompt nunca pede interface, logo ou letras", () => {
    const p = promptDaFotoDoPost({ descricao: "", lamina: "Café da manhã", conceito: "", proporcao: "9:16", rede: "story" });
    expect(p).toContain("Story");
    expect(p).toMatch(/nenhuma letra/);
    expect(p).toMatch(/interface de aplicativo/);
  });
});

describe("contrato do template com a simulação real", () => {
  const base = { versao: 1, estilo: "story", nome: "Loja", username: "loja", texto: "Oi", tamanho_texto: 36, cor_fundo: "#ffffff", tema: "dim" };
  it("aceita Story, tema dim, tempo, local, números e legenda de 2.200", () => {
    const t = normalizarTemplateProfile({ ...base, tempo: "2h", local: "Curitiba", curtido_por: "@maria", numeros: { curtidas: 10, comentarios: 0 }, proporcao: "4:5", fio: true, texto: "a".repeat(2200) }, CLIENTE, erro);
    expect(t).toMatchObject({ estilo: "story", tema: "dim", tempo: "2h", local: "Curitiba", curtido_por: "maria", numeros: { curtidas: 10, comentarios: 0 }, proporcao: "4:5", fio: true });
  });
  it("recusa números negativos, proporção desconhecida e quebra de linha no tempo", () => {
    expect(() => normalizarTemplateProfile({ ...base, numeros: { curtidas: -1 } }, CLIENTE, erro)).toThrow();
    expect(() => normalizarTemplateProfile({ ...base, proporcao: "2:1" }, CLIENTE, erro)).toThrow();
    expect(() => normalizarTemplateProfile({ ...base, tempo: "2h\nontem" }, CLIENTE, erro)).toThrow();
  });
});

describe("Openverse nas imagens reais", () => {
  const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const item = { id: ID, title: "Pão <b>caseiro</b>", url: "https://live.staticflickr.com/1/pao.jpg", thumbnail: "https://api.openverse.org/v1/images/x/thumb/", foreign_landing_url: "https://www.flickr.com/photos/1", license: "by-sa", license_version: "2.0", creator: "Fotógrafa" };
  it("lê o item com licença legível e sem HTML", () => {
    expect(resultadoDoOpenverse(item)).toMatchObject({ arquivo: `openverse:${ID}`, nome: "Pão caseiro", licenca: "CC BY-SA 2.0", autor: "Fotógrafa", fonte_url: "https://www.flickr.com/photos/1" });
    expect(rotuloDaLicencaDoOpenverse("cc0", "1.0")).toBe("CC0 1.0");
    expect(resultadoDoOpenverse({ ...item, url: "javascript:alert(1)" })).toBeNull();
  });
  it("busca no Openverse e, ao usar, relê licença e arquivo na API", async () => {
    let atual: TrabalhoComFontesReais = { id: TRABALHO, client_id: CLIENTE, status: "dirigido", tipo: "social", entrega_status: null, direcao: { cards: [{ ordem: 1, texto_exato: "Pão" }] }, cards: [] };
    const openverse = vi.fn(async (url: string) => (url.includes(`/${ID}/`) ? item : { results: [item] }));
    const deps: DepsDasFontesReais<typeof ch, TrabalhoComFontesReais> = {
      erro, json: (b) => new Response(JSON.stringify(b)), trabalhoComAcesso: vi.fn(async () => structuredClone(atual)),
      mutarTrabalho: vi.fn(async (_id, mudar) => { atual = { ...atual, ...mudar(structuredClone(atual)) } as TrabalhoComFontesReais; return structuredClone(atual); }),
      jsonDoCommons: vi.fn(async () => ({})), jsonDoOpenverse: openverse,
      buscarImagem: vi.fn(async (url: URL) => ({ url, bytes: new Uint8Array([1]) })), validarImagem: () => "image/jpeg",
      guardarImagem: vi.fn(async () => `${CLIENTE}/estudio/fontes-reais/pao.jpg`), descartarUpload: vi.fn(async () => undefined), ehPostDeFotos: () => false,
    };
    const acoes = acoesDasFontesReais(deps);
    const busca = await json(await acoes.imagens_reais_buscar(ch, { trabalho_id: TRABALHO, ordem: 1, consulta: "pão caseiro", banco: "openverse" }));
    expect(openverse.mock.calls[0][0]).toContain("license_type=commercial");
    expect(busca.resultados[0].arquivo).toBe(`openverse:${ID}`);
    const r = await json(await acoes.imagem_real_aplicar(ch, { trabalho_id: TRABALHO, ordem: 1, versao_esperada: 0, texto_base: "Pão", arquivo: `openverse:${ID}` }));
    expect(openverse.mock.calls[1][0]).toBe(`https://api.openverse.org/v1/images/${ID}/`);
    expect(r.fonte).toMatchObject({ caminho: `${CLIENTE}/estudio/fontes-reais/pao.jpg`, licenca: "CC BY-SA 2.0", autor: "Fotógrafa", fonte_url: "https://www.flickr.com/photos/1" });
  });
});

describe("template_lamina: os posts do fio na prancheta, sem custo", () => {
  function comLaminas() {
    const c = cenario();
    const operar = vi.fn((t: T, operacao: "adicionar" | "duplicar" | "tirar", ordem: number, texto: string) => {
      const cards = operacao === "tirar" ? t.direcao.cards.filter((x) => x.ordem !== ordem).map((x, i) => ({ ...x, ordem: i + 1 })) : [...t.direcao.cards.slice(0, ordem), { ordem: ordem + 1, texto_exato: operacao === "duplicar" ? t.direcao.cards[ordem - 1].texto_exato : texto }, ...t.direcao.cards.slice(ordem).map((x) => ({ ...x, ordem: x.ordem + 1 }))];
      return { direcao: { ...t.direcao, cards } };
    });
    const acoes = acoesDaGeracaoDoTemplate({ ...c.deps, operarLamina: operar });
    return { ...c, acoes, operar };
  }
  it("adiciona depois, duplica e tira, devolvendo a ordem para abrir", async () => {
    const c = comLaminas();
    const r1 = await json(await c.acoes.template_lamina(ch, { trabalho_id: TRABALHO, ordem: 1, operacao: "adicionar" }));
    expect(r1).toMatchObject({ operacao: "adicionar", ordem: 2, custo_usd: 0 });
    expect(c.ler().direcao.cards.map((x) => x.texto_exato)).toEqual(["Capa", "Novo post do fio", "Meio", "Fim"]);
    await c.acoes.template_lamina(ch, { trabalho_id: TRABALHO, ordem: 3, operacao: "duplicar" });
    expect(c.ler().direcao.cards).toHaveLength(5);
    const r3 = await json(await c.acoes.template_lamina(ch, { trabalho_id: TRABALHO, ordem: 5, operacao: "tirar" }));
    expect(r3.ordem).toBe(4);
    expect(c.escrever).not.toHaveBeenCalled();
    expect(c.gerar).not.toHaveBeenCalled();
  });
  it("recusa o último post, a operação desconhecida e o trabalho em aprovação", async () => {
    const c = comLaminas();
    c.mudar({ direcao: { ...c.ler().direcao, cards: [{ ordem: 1, texto_exato: "Só" }] } });
    await expect(c.acoes.template_lamina(ch, { trabalho_id: TRABALHO, ordem: 1, operacao: "tirar" })).rejects.toMatchObject({ codigo: "ultima_lamina" });
    await expect(c.acoes.template_lamina(ch, { trabalho_id: TRABALHO, ordem: 1, operacao: "mover" })).rejects.toMatchObject({ status: 400 });
    c.mudar({ entrega_status: "aguardando_agencia" });
    await expect(c.acoes.template_lamina(ch, { trabalho_id: TRABALHO, ordem: 1, operacao: "duplicar" })).rejects.toMatchObject({ codigo: "trabalho_entregue" });
    expect(c.operar).not.toHaveBeenCalled();
  });
});

describe("contrato da edição à mão", () => {
  it("guarda escala, mídia e o que esconder, dentro das faixas", () => {
    const base = { versao: 1, estilo: "twitter", nome: "Loja", username: "loja", texto: "Oi", tamanho_texto: 36, cor_fundo: "#123456" };
    expect(normalizarTemplateProfile({ ...base, escala: 120, midia: 70, ocultar_numeros: true, ocultar_tempo: true }, CLIENTE, erro)).toMatchObject({ escala: 120, midia: 70, ocultar_numeros: true, ocultar_tempo: true, cor_fundo: "#123456" });
    expect(() => normalizarTemplateProfile({ ...base, escala: 300 }, CLIENTE, erro)).toThrow();
    expect(() => normalizarTemplateProfile({ ...base, midia: 10 }, CLIENTE, erro)).toThrow();
  });
});
