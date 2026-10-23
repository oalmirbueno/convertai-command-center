// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  acoesDoCarrossel,
  ESQUEMA_DO_CARROSSEL_X,
  itensDaBuscaNoArquivo,
  licencaDoArquivo,
  videoDoArquivo,
  lerCarrosselGerado,
  midiaPorRegra,
  perguntasDaMidia,
  videoDoCommons,
  videoDoPexels,
  type DepsDoCarrossel,
} from "../../supabase/functions/estudio-arte/modulos/template-carrossel";
import type { TrabalhoDaGeracao } from "../../supabase/functions/estudio-arte/modulos/template-geracao";
import { normalizarTemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";
import {
  acoesDasFontesReais, LICENCA_DA_NOTICIA, lerArquivoDaNoticia, metasDaMateria, noticiasDoRss, resultadoDoPexels, type DepsDasFontesReais,
} from "../../supabase/functions/estudio-arte/modulos/fontes-reais-do-diretor";

/** Carrossel estilo post do X (22/10): regras puras do servidor (gerador, Jev, vídeos reais, MP4 da lâmina). */
const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TRABALHO = "22222222-2222-4222-8222-222222222222";
const ch = { userId: "equipe" };
const erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Object.assign(new Error(mensagem), { status, codigo, detalhes });
type T = TrabalhoDaGeracao & { custo_usd: number };

const REDATOR = {
  laminas: [
    { ordem: 1, texto: "A Meta **desistiu** disso →", busca: "escritório meta", dados: [], tipo_de_grafico: "", unidade: "", fonte_dos_dados: "" },
    { ordem: 2, texto: "A IA já faz **3 dias** em 1.", busca: "", dados: [{ rotulo: "Humano", valor: 1 }, { rotulo: "Agente", valor: 3.14 }], tipo_de_grafico: "barras", unidade: "x", fonte_dos_dados: "OpenAI" },
    { ordem: 3, texto: "Comenta **IA** que eu te mando.", busca: "", dados: [], tipo_de_grafico: "", unidade: "", fonte_dos_dados: "" },
  ],
  legenda: "A Meta desistiu.\n\n#ia #gestao #marketing",
};

function cenario(o: { jevFalha?: boolean; respostas?: Record<string, { choice: string; confidence: number }> } = {}) {
  let atual: T = {
    id: TRABALHO, client_id: CLIENTE, status: "dirigido", tipo: "social", entrega_status: null, legenda: null, custo_usd: 1, modelo_imagem_id: "gpt-image",
    direcao: { formato: "feed_4x5", cards: [{ ordem: 1, texto_exato: "Capa" }, { ordem: 2, texto_exato: "Meio" }, { ordem: 3, texto_exato: "Fim" }] },
    cards: [],
  };
  const escrever = vi.fn(async (..._a: unknown[]) => ({ json: REDATOR, custoUsd: 0.03 }));
  const jev = vi.fn(async () => {
    if (o.jevFalha) throw new Error("jev fora");
    return { answers: o.respostas || { midia_1: { choice: "video_real", confidence: 0.8 }, midia_2: { choice: "grafico", confidence: 0.9 }, midia_3: { choice: "so_texto", confidence: 0.7 } }, custoUsd: 0.001 };
  });
  const pedir = vi.fn(async (_t: T, linha: { uid: string; entrada: Record<string, unknown> }) => ({ pedido: { id: "p1", estado: "fila", etapa: null, progresso: 0, saida_path: null, erro_mensagem: null, entrada: linha.entrada, criado_em: "x" }, ja_existia: false }));
  const pedidos = vi.fn(async () => [] as Awaited<ReturnType<DepsDoCarrossel<typeof ch, T>["pedidosDaLamina"]>>);
  const guardarVideo = vi.fn(async () => `${CLIENTE}/estudio/template/videos/fontes/v.mp4`);
  const deps: DepsDoCarrossel<typeof ch, T> = {
    erro, json: (b) => new Response(JSON.stringify(b)),
    trabalhoComAcesso: vi.fn(async () => structuredClone(atual)),
    mutarTrabalho: vi.fn(async (_id, mudar) => { atual = { ...atual, ...mudar(structuredClone(atual)) } as T; return structuredClone(atual); }),
    ehPostDeFotos: () => false,
    atualizarTexto: (t, ordem, texto) => ({ ...t.direcao, cards: t.direcao.cards.map((c) => (c.ordem === ordem ? { ...c, texto_exato: texto } : c)) }),
    estimarTexto: vi.fn(async () => 0.031),
    escreverTexto: escrever,
    perguntarJev: jev,
    jsonDoCommons: vi.fn(async () => ({ query: { pages: { 1: { title: "File:Carro.webm", videoinfo: [{ mime: "video/webm", url: "https://upload.wikimedia.org/c.webm", descriptionurl: "https://commons.wikimedia.org/wiki/File:Carro.webm", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "<a>Fulano</a>" } }, derivatives: [] }] } } } })),
    jsonDoPexels: vi.fn(async (url: string) => url.includes("/search") ? { videos: [PEXELS] } : PEXELS),
    baixarVideo: vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), mime: "video/mp4" })),
    guardarVideo,
    pedirRender: pedir,
    pedidosDaLamina: pedidos,
    linkAssinado: vi.fn(async () => "https://assinado"),
  };
  return { acoes: acoesDoCarrossel(deps), deps, escrever, jev, pedir, pedidos, guardarVideo, ler: () => atual, mudar: (v: Partial<T>) => { atual = { ...atual, ...v } as T; } };
}
const PEXELS = { id: 123, url: "https://www.pexels.com/video/123/", image: "https://images.pexels.com/p.jpg", duration: 9, user: { name: "Ana" }, video_files: [{ file_type: "video/mp4", width: 3840, height: 2160, link: "https://videos.pexels.com/4k.mp4" }, { file_type: "video/mp4", width: 1280, height: 720, link: "https://videos.pexels.com/720.mp4" }] };
const json = async (r: Response) => JSON.parse(await r.text());

describe("template_carrossel: copy de todas as lâminas + mídia escolhida pelo Jev", () => {
  it("sem confirmação responde 409 com o custo e não chama o redator nem o Jev", async () => {
    const c = cenario();
    await expect(c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 1, assunto: "Meta desistiu de medir IA" })).rejects.toMatchObject({ status: 409, codigo: "confirmar_custo" });
    expect(c.escrever).not.toHaveBeenCalled();
    expect(c.jev).not.toHaveBeenCalled();
  });
  it("grava o texto de cada lâmina e a sugestão de mídia do Jev (Choice, um pedido só)", async () => {
    const c = cenario();
    const r = await json(await c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 1, assunto: "Meta desistiu", confirmado: true, gravar_legenda: true }));
    expect(c.ler().direcao.cards.map((x) => x.texto_exato)).toEqual(REDATOR.laminas.map((l) => l.texto));
    expect(r.laminas.map((l: { sugestao: { midia: string } }) => l.sugestao.midia)).toEqual(["video_real", "grafico", "so_texto"]);
    expect((c.ler().direcao.cards[1] as { carrossel?: { grafico?: unknown; por: string } }).carrossel).toMatchObject({ por: "jev", grafico: { tipo: "barras", dados: [{ rotulo: "Humano", valor: 1 }, { rotulo: "Agente", valor: 3.14 }] } });
    expect(c.jev).toHaveBeenCalledTimes(1);
    expect(c.ler().legenda).toBe(REDATOR.legenda);
    expect(c.ler().custo_usd).toBeCloseTo(1.031);
    // O redator recebe o esquema do carrossel e a rede do X (motor de copy de lâmina).
    expect(c.escrever.mock.calls[0][2]).toMatchObject({ esquema: ESQUEMA_DO_CARROSSEL_X, rede: "twitter" });
  });
  it("Jev fora do ar: regra explícita, com aviso (sem gráfico sem números e CTA só texto)", async () => {
    const c = cenario({ jevFalha: true });
    const r = await json(await c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 1, assunto: "Meta", confirmado: true }));
    expect(r.laminas.map((l: { sugestao: { midia: string; por: string } }) => [l.sugestao.midia, l.sugestao.por])).toEqual([["video_real", "regra"], ["grafico", "regra"], ["so_texto", "regra"]]);
    expect(r.avisos.join(" ")).toContain("Jev");
  });
  it("escolha do Jev fora das opções da lâmina (gráfico sem números) cai na regra", async () => {
    const c = cenario({ respostas: { midia_1: { choice: "grafico", confidence: 0.6 }, midia_2: { choice: "manchete", confidence: 0.5 }, midia_3: { choice: "so_texto", confidence: 0.9 } } });
    const r = await json(await c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 1, assunto: "Meta", confirmado: true }));
    expect(r.laminas[0].sugestao).toMatchObject({ midia: "video_real", por: "regra" });
    expect(r.laminas[1].sugestao).toMatchObject({ midia: "grafico", por: "regra" });
  });
  it("as perguntas só oferecem gráfico com números reais e manchete com notícia", () => {
    const lido = lerCarrosselGerado(REDATOR, [1, 2, 3]);
    const sem = perguntasDaMidia(lido.laminas, false);
    expect(Object.keys(sem.midia_1.criteria)).not.toContain("grafico");
    expect(Object.keys(sem.midia_1.criteria)).not.toContain("manchete");
    expect(Object.keys(sem.midia_2.criteria)).toContain("grafico");
    expect(Object.keys(perguntasDaMidia(lido.laminas, true).midia_1.criteria)).toContain("manchete");
    expect(midiaPorRegra(lido.laminas[0], 0, 3, true)).toBe("manchete");
  });
  it("notícia vira o card de manchete com o link guardado como fonte", async () => {
    const c = cenario({ respostas: { midia_1: { choice: "manchete", confidence: 0.9 }, midia_2: { choice: "grafico", confidence: 0.9 }, midia_3: { choice: "so_texto", confidence: 0.9 } } });
    const r = await json(await c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 1, noticia: { titulo: "Meta muda regra", fonte: "Exame", link: "https://exame.com/x", data: "2026-10-21" }, confirmado: true }));
    expect(r.laminas[0].sugestao.manchete).toEqual({ veiculo: "Exame", titulo: "Meta muda regra", url: "https://exame.com/x", data: "2026-10-21" });
    await expect(c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 1, noticia: { titulo: "x", fonte: "y", link: "javascript:alert(1)" }, confirmado: true })).rejects.toMatchObject({ codigo: "noticia_invalida" });
  });
});

describe("vídeos reais: só licença comercial, relidos na fonte", () => {
  it("Pexels: escolhe o MP4 até 1920 px, com autor e página", () => {
    expect(videoDoPexels(PEXELS)).toMatchObject({ banco: "pexels", url: "https://videos.pexels.com/720.mp4", autor: "Ana", licenca: expect.stringContaining("Pexels") });
  });
  it("Commons: recusa licença não comercial", () => {
    const pagina = (licenca: string) => ({ title: "File:A.webm", videoinfo: [{ mime: "video/webm", url: "https://upload.wikimedia.org/a.webm", extmetadata: { LicenseShortName: { value: licenca } } }] });
    expect(videoDoCommons(pagina("CC BY 4.0"))).toMatchObject({ licenca: "CC BY 4.0" });
    expect(videoDoCommons(pagina("CC BY-NC 2.0"))).toBeNull();
  });
  it("buscar junta Pexels e Wikimedia; aplicar relê o item, baixa e guarda com o crédito", async () => {
    const c = cenario();
    const busca = await json(await c.acoes.template_videos_buscar(ch, { trabalho_id: TRABALHO, ordem: 1, consulta: "carro elétrico" }));
    expect(busca.resultados.map((v: { banco: string }) => v.banco)).toEqual(["pexels", "wikimedia"]);
    const r = await json(await c.acoes.template_video_aplicar(ch, { trabalho_id: TRABALHO, ordem: 1, banco: "pexels", id: "123", url: "https://malicioso.example/x.mp4" }));
    expect(c.deps.baixarVideo).toHaveBeenCalledWith("https://videos.pexels.com/720.mp4", expect.any(Number));
    expect(r.video).toMatchObject({ caminho: `${CLIENTE}/estudio/template/videos/fontes/v.mp4`, autor: "Ana", pagina_url: "https://www.pexels.com/video/123/" });
    expect((c.ler().direcao.cards[0] as { videos_reais?: unknown[] }).videos_reais).toHaveLength(1);
  });
  it("sem chave do Pexels, avisa e segue só com a Wikimedia", async () => {
    const c = cenario();
    const semPexels = acoesDoCarrossel({ ...c.deps, jsonDoPexels: null });
    const busca = await json(await semPexels.template_videos_buscar(ch, { trabalho_id: TRABALHO, ordem: 1, consulta: "carro" }));
    expect(busca.resultados.every((v: { banco: string }) => v.banco === "wikimedia")).toBe(true);
    expect(busca.avisos.join(" ")).toContain("PEXELS_API_KEY");
  });
});

describe("lâmina de vídeo em MP4 pela fila de render", () => {
  const template = normalizarTemplateProfile({
    versao: 1, estilo: "carrossel", nome: "Cliente", username: "cliente", texto: "Olha isso →", cor_fundo: "#ffffff",
    bloco: { tipo: "video", enquadramento: "preencher", midia: { bucket: "workspace", caminho: `client/${CLIENTE}/v.mp4`, origem: "workspace" } },
  }, CLIENTE, erro);
  it("pede com a versão guardada, o PNG dela e o vídeo do bloco; o retângulo vem conferido", async () => {
    const c = cenario();
    c.mudar({ cards: [{ ordem: 2, versao: 1, storage_path: `${CLIENTE}/estudio/cards/l2.png`, template_profile: template, tamanho: "1080x1350" }] });
    const r = await json(await c.acoes.template_video_pedir(ch, { trabalho_id: TRABALHO, ordem: 2, uid: "uid-12345678", retangulo: { x: 80, y: 600, largura: 920, altura: 520, raio: 18 }, cor_do_bloco: "#f2f4f5" }));
    expect(r.pedido.id).toBe("p1");
    const entrada = c.pedir.mock.calls[0][1].entrada;
    expect(entrada).toMatchObject({ fundo: { caminho: `${CLIENTE}/estudio/cards/l2.png` }, video: { bucket: "workspace" }, enquadramento: "preencher", versao: 1 });
    expect(String(entrada.saida)).toMatch(new RegExp(`^${CLIENTE}/estudio/template/videos/`));
    await expect(c.acoes.template_video_pedir(ch, { trabalho_id: TRABALHO, ordem: 2, uid: "uid-12345678", retangulo: { x: 900, y: 0, largura: 600, altura: 300, raio: 0 } })).rejects.toMatchObject({ codigo: "lamina_video_invalida" });
  });
  it("lâmina sem vídeo no bloco não vai para a fila", async () => {
    const c = cenario();
    await expect(c.acoes.template_video_pedir(ch, { trabalho_id: TRABALHO, ordem: 1, uid: "uid-12345678", retangulo: { x: 0, y: 0, largura: 100, altura: 100, raio: 0 } })).rejects.toMatchObject({ codigo: "lamina_sem_video" });
    expect(c.pedir).not.toHaveBeenCalled();
  });
  it("pronto: o MP4 entra na versão da lâmina uma vez só", async () => {
    const c = cenario();
    c.mudar({ cards: [{ ordem: 2, versao: 1, storage_path: `${CLIENTE}/estudio/cards/l2.png`, template_profile: template, tamanho: "1080x1350" }] });
    c.pedidos.mockResolvedValue([{ id: "p1", estado: "pronto", etapa: null, progresso: 1, saida_path: `${CLIENTE}/estudio/template/videos/a.mp4`, erro_mensagem: null, entrada: { ordem: 2, versao: 1 }, criado_em: "x" }]);
    const r = await json(await c.acoes.template_video_estado(ch, { trabalho_id: TRABALHO, ordem: 2 }));
    expect(r.url).toBe("https://assinado");
    expect((c.ler().cards[0] as { video_path?: string }).video_path).toBe(`${CLIENTE}/estudio/template/videos/a.mp4`);
    await c.acoes.template_video_estado(ch, { trabalho_id: TRABALHO, ordem: 2 });
    expect(c.deps.mutarTrabalho).toHaveBeenCalledTimes(1);
  });
});

describe("normalizador do carrossel no salvar_template", () => {
  it("aceita mídia do cliente (mesa ou Workspace) e recusa a de outro cliente", () => {
    expect(template_ok().bloco?.midia?.bucket).toBe("mesa");
    expect(() => normalizarTemplateProfile({ ...base(), bloco: { tipo: "imagem", midia: { bucket: "workspace", caminho: "client/outro/a.png", origem: "workspace" } } }, CLIENTE, erro)).toThrow("deste cliente");
    expect(() => normalizarTemplateProfile({ ...base(), bloco: { tipo: "video", midia: { bucket: "mesa", caminho: `${CLIENTE}/a.png`, origem: "enviada" } } }, CLIENTE, erro)).toThrow("vídeo");
  });
  it("gráfico com números editáveis válidos e tabela completa; seta ligada por padrão; sem contador", () => {
    const t = normalizarTemplateProfile({ ...base(), bloco: { tipo: "grafico", grafico: { tipo: "pizza", dados: [{ rotulo: "A", valor: 45.4 }, { rotulo: "B", valor: 21 }] } } }, CLIENTE, erro);
    expect(t.bloco?.grafico?.dados).toHaveLength(2);
    expect(t.seta).toBe(true);
    expect(JSON.stringify(t)).not.toContain("contador");
    expect(() => normalizarTemplateProfile({ ...base(), bloco: { tipo: "grafico", grafico: { tipo: "tabela", dados: [], colunas: ["a", "b"], linhas: [["1"]] } } }, CLIENTE, erro)).toThrow("tabela");
  });
});

function base() { return { versao: 1, estilo: "carrossel", nome: "Cliente", username: "cliente", texto: "Texto", cor_fundo: "#ffffff" }; }
function template_ok() { return normalizarTemplateProfile({ ...base(), bloco: { tipo: "imagem", midia: { bucket: "mesa", caminho: `${CLIENTE}/estudio/a.jpg`, origem: "internet", credito: { fonte: "Wikimedia", autor: "X", licenca: "CC BY 4.0", url: "https://commons.wikimedia.org/a" } } } }, CLIENTE, erro); }

// ------------------------------------------------------------------ 23/10: notícias, Pexels, Internet Archive e o Jev

const RSS = `<?xml version="1.0"?><rss><channel><title>x</title>
<item><title>Carro el&#233;trico bate recorde</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fforbes.com.br%2fmotors%2fcarro%2f&amp;c=1</link><pubDate>Fri, 23 Oct 2026 01:00:00 GMT</pubDate><News:Source>Forbes Brasil</News:Source><News:Image>http://www.bing.com/th?id=ONUT.abc123&amp;pid=News</News:Image></item>
<item><title>Sem imagem</title><link>https://g1.globo.com/a</link><News:Source>g1</News:Source></item>
<item><title>Link interno</title><link>http://www.bing.com/news/apiclick.aspx?url=http%3a%2f%2f127.0.0.1%2fx</link><News:Image>http://www.bing.com/th?id=OVP.zzz9&amp;pid=News</News:Image></item>
</channel></rss>`;
const MATERIA = `<html><head><meta content="https://forbes.com.br/wp/carro-1200.jpg" property="og:image"><meta property="og:site_name" content="Forbes Brasil"><meta property="og:title" content="Carro elétrico bate recorde &amp; vende"></head></html>`;
const FOTO_PEXELS = { id: 77, url: "https://www.pexels.com/photo/77/", photographer: "Bia", alt: "Carro carregando", src: { large2x: "https://images.pexels.com/77-l.jpg", medium: "https://images.pexels.com/77-m.jpg" } };
const TEXTO_DA_LAMINA = "Carro **elétrico** bate recorde no Brasil";

type TrabalhoDaBusca = { id: string; client_id: string; status: string; tipo: string; entrega_status: null; direcao: { cards: Array<{ ordem: number; texto_exato: string }> }; cards: Array<{ ordem: number; versao: number }> };
function fontesReais(o: { semTexto?: boolean; semPexels?: boolean; jev?: string; ogFalha?: boolean } = {}) {
  let atual: TrabalhoDaBusca = { id: TRABALHO, client_id: CLIENTE, status: "dirigido", tipo: "social", entrega_status: null, direcao: { cards: [{ ordem: 1, texto_exato: TEXTO_DA_LAMINA }] }, cards: [] };
  const textoDaWeb = vi.fn(async (url: URL) => (url.hostname === "www.bing.com" ? { url, texto: RSS } : { url, texto: MATERIA }));
  const jsonDoPexels = vi.fn(async (url: string) => (url.includes("/search") ? { photos: [FOTO_PEXELS] } : FOTO_PEXELS));
  const perguntarJev = vi.fn(async (..._a: unknown[]) => ({ answers: { melhor: { choice: o.jev || "r2", confidence: 0.83 } }, custoUsd: 0.0012 }));
  const baixar = vi.fn(async (url: URL, _limite: number, _permitir: (u: URL) => boolean) => (o.ogFalha && url.hostname === "forbes.com.br" ? null : { url, bytes: new Uint8Array([1]) }));
  const deps: DepsDasFontesReais<typeof ch, TrabalhoDaBusca> = {
    erro, json: (b) => new Response(JSON.stringify(b)), trabalhoComAcesso: vi.fn(async () => structuredClone(atual)),
    mutarTrabalho: vi.fn(async (_id, mudar) => { atual = { ...atual, ...mudar(structuredClone(atual)) } as TrabalhoDaBusca; return structuredClone(atual); }),
    jsonDoCommons: vi.fn(async () => ({ query: { search: [] } })), jsonDoOpenverse: vi.fn(async () => ({ results: [] })),
    ...(o.semTexto ? {} : { textoDaWeb }), ...(o.semPexels ? {} : { jsonDoPexels }), perguntarJev,
    buscarImagem: baixar, validarImagem: () => "image/jpeg", guardarImagem: vi.fn(async () => `${CLIENTE}/estudio/fontes-reais/n.jpg`),
    descartarUpload: vi.fn(async () => undefined), ehPostDeFotos: () => false,
  };
  return { acoes: acoesDasFontesReais(deps), textoDaWeb, jsonDoPexels, perguntarJev, baixar, ler: () => atual };
}
const usar = (arquivo: string) => ({ trabalho_id: TRABALHO, ordem: 1, texto_base: TEXTO_DA_LAMINA, versao_esperada: 0, arquivo });

describe("imagens de notícias (Bing Notícias e a og:image da matéria)", () => {
  it("lê o RSS: matéria fora do embrulho do Bing, veículo, data e miniatura; recusa sem imagem e endereço interno", () => {
    const r = noticiasDoRss(RSS);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ nome: "Carro elétrico bate recorde", autor: "Forbes Brasil", data: "2026-10-23", banco: "noticias", fonte_url: "https://forbes.com.br/motors/carro/", licenca: LICENCA_DA_NOTICIA });
    expect(r[0].url).toContain("id=ONUT.abc123");
    expect(lerArquivoDaNoticia(r[0].arquivo)).toMatchObject({ imagemId: "ONUT.abc123" });
    expect(lerArquivoDaNoticia("noticia:http%3A%2F%2F10.0.0.1%2Fx|ONUT.a1b2")).toBeNull();
  });
  it("as metas da matéria valem em qualquer ordem de atributos e com entidades", () => {
    const m = metasDaMateria(MATERIA, new URL("https://forbes.com.br/motors/carro/"));
    expect(m).toEqual({ imagem: new URL("https://forbes.com.br/wp/carro-1200.jpg"), veiculo: "Forbes Brasil", titulo: "Carro elétrico bate recorde & vende" });
  });
  it("usar a notícia relê a matéria: a og:image entra com o veículo no crédito; se falhar, a miniatura do Bing", async () => {
    const c = fontesReais();
    const arquivo = noticiasDoRss(RSS)[0].arquivo;
    const r = await json(await c.acoes.imagem_real_aplicar(ch, usar(arquivo)));
    expect(c.baixar.mock.calls[0][0].href).toBe("https://forbes.com.br/wp/carro-1200.jpg");
    expect(r.fonte).toMatchObject({ banco: "noticias", autor: "Forbes Brasil", nome: "Carro elétrico bate recorde & vende", fonte_url: "https://forbes.com.br/motors/carro/", licenca: LICENCA_DA_NOTICIA });
    const f = fontesReais({ ogFalha: true });
    await f.acoes.imagem_real_aplicar(ch, usar(arquivo));
    expect(f.baixar.mock.calls.map((x) => x[0].hostname)).toEqual(["forbes.com.br", "www.bing.com"]);
  });
  it("busca só de notícias avisa do uso editorial; sem o leitor da web, 501", async () => {
    const r = await json(await fontesReais().acoes.imagens_reais_buscar(ch, { trabalho_id: TRABALHO, ordem: 1, consulta: "carro elétrico", banco: "noticias" }));
    expect(r.resultados).toHaveLength(1);
    expect(r.avisos.join(" ")).toContain("crédito");
    await expect(fontesReais({ semTexto: true }).acoes.imagens_reais_buscar(ch, { trabalho_id: TRABALHO, ordem: 1, consulta: "carro", banco: "noticias" })).rejects.toMatchObject({ status: 501 });
  });
});

describe("Tudo: notícias, Pexels, Wikimedia e Openverse juntos; o Jev escolhe a melhor (cobrado)", () => {
  it("intercala os bancos e, com ordenar jev, põe a escolhida primeiro e devolve o custo", async () => {
    const c = fontesReais({ jev: "r2" });
    const r = await json(await c.acoes.imagens_reais_buscar(ch, { trabalho_id: TRABALHO, ordem: 1, consulta: "carro elétrico", banco: "todos", ordenar: "jev" }));
    expect(c.perguntarJev).toHaveBeenCalledTimes(1);
    const [, estado, perguntas] = c.perguntarJev.mock.calls[0] as unknown as [unknown, { lamina: { texto: string } }, { melhor: { type: string; criteria: Record<string, string> } }];
    expect(estado.lamina.texto).toBe("Carro elétrico bate recorde no Brasil");
    expect(perguntas.melhor.type).toBe("choice");
    expect(Object.keys(perguntas.melhor.criteria)).toEqual(["r1", "r2"]);
    expect(r.resultados.map((x: { banco: string }) => x.banco)).toEqual(["pexels", "noticias"]);
    expect(r).toMatchObject({ melhor: { indice: 0, confianca: 0.83, por: "jev" }, custo_usd: 0.0012 });
  });
  it("sem ordenar, nada de Jev nem custo; sem chave do Pexels, avisa e segue", async () => {
    const c = fontesReais({ semPexels: true });
    const r = await json(await c.acoes.imagens_reais_buscar(ch, { trabalho_id: TRABALHO, ordem: 1, consulta: "carro elétrico", banco: "todos" }));
    expect(c.perguntarJev).not.toHaveBeenCalled();
    expect(r.custo_usd).toBe(0);
    expect(r.resultados.map((x: { banco: string }) => x.banco)).toEqual(["noticias"]);
    expect(r.avisos.join(" ")).toContain("Pexels");
  });
  it("Pexels Fotos: relido na API ao usar, com o fotógrafo no crédito", async () => {
    expect(resultadoDoPexels(FOTO_PEXELS)).toMatchObject({ arquivo: "pexels:77", autor: "Bia", url: "https://images.pexels.com/77-l.jpg", banco: "pexels" });
    const c = fontesReais();
    const r = await json(await c.acoes.imagem_real_aplicar(ch, usar("pexels:77")));
    expect(c.jsonDoPexels).toHaveBeenCalledWith("https://api.pexels.com/v1/photos/77");
    expect(r.fonte).toMatchObject({ banco: "pexels", autor: "Bia", fonte_url: "https://www.pexels.com/photo/77/" });
  });
});

describe("vídeos do Internet Archive e o Jev na busca de vídeo", () => {
  const busca = { response: { docs: [{ identifier: "carro-eletrico", title: "Carro elétrico", creator: "TV Cultura", licenseurl: "https://creativecommons.org/licenses/by/4.0/" }, { identifier: "nc", title: "NC", licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/" }] } };
  const item = { metadata: { mediatype: "movies", title: "Carro elétrico", creator: "TV Cultura", licenseurl: "https://creativecommons.org/licenses/by/4.0/" }, files: [
    { name: "carro.mp4", format: "h.264", size: "90000000", height: "1080" },
    { name: "carro_512kb.mp4", format: "512Kb MPEG4", size: "20000000", height: "480", length: "41.5" },
    { name: "carro_64kb.mp4", size: "5000000", height: "120" },
  ] };
  it("licença: domínio público e CC sem NC; o MP4 até 60 MB e 720 px", () => {
    expect(licencaDoArquivo("http://creativecommons.org/licenses/publicdomain/")).toBe("Domínio público");
    expect(licencaDoArquivo("https://creativecommons.org/licenses/by-nc-sa/4.0/")).toBeNull();
    expect(itensDaBuscaNoArquivo(busca).map((i) => i.id)).toEqual(["carro-eletrico"]);
    expect(videoDoArquivo("carro-eletrico", item)).toMatchObject({ banco: "arquivo", url: "https://archive.org/download/carro-eletrico/carro_512kb.mp4", licenca: "CC BY 4.0", autor: "TV Cultura", duracao_s: 41.5, altura: 480 });
  });
  it("sem chave do Pexels a busca segue no Commons e no Archive; o Jev escolhe e o aplicar relê o item", async () => {
    const c = cenario();
    const jsonDoArquivo = vi.fn(async (url: string) => (url.includes("advancedsearch") ? busca : item));
    c.jev.mockResolvedValueOnce({ answers: { melhor: { choice: "v2", confidence: 0.9 } } as never, custoUsd: 0.001 });
    const acoes = acoesDoCarrossel({ ...c.deps, jsonDoPexels: null, jsonDoArquivo });
    const r = await json(await acoes.template_videos_buscar(ch, { trabalho_id: TRABALHO, ordem: 1, consulta: "carro elétrico", ordenar: "jev" }));
    expect(r.resultados.map((v: { banco: string }) => v.banco)).toEqual(["arquivo", "wikimedia"]);
    expect(r).toMatchObject({ melhor: { indice: 0, por: "jev" }, custo_usd: 0.001 });
    await acoes.template_video_aplicar(ch, { trabalho_id: TRABALHO, ordem: 1, banco: "arquivo", id: "carro-eletrico" });
    expect(c.deps.baixarVideo).toHaveBeenCalledWith("https://archive.org/download/carro-eletrico/carro_512kb.mp4", expect.any(Number));
    await expect(acoes.template_video_aplicar(ch, { trabalho_id: TRABALHO, ordem: 1, banco: "arquivo", id: "../x" })).rejects.toMatchObject({ codigo: "video_real_indisponivel" });
  });
  it("o custo do gerador conta um Jev por lâmina para escolher a mídia achada", async () => {
    const c = cenario();
    await expect(c.acoes.template_carrossel(ch, { trabalho_id: TRABALHO, ordem: 1, assunto: "Meta" })).rejects.toMatchObject({ detalhes: { custo_estimado_usd: 0.036 } });
  });
});

describe("cor de fundo da lâmina e crédito", () => {
  it("o crédito escrito na lâmina passa pelo normalizador", () => {
    const t = normalizarTemplateProfile({ ...base(), cor_fundo: "#7a1f3d", bloco: { tipo: "imagem", credito_visivel: true, midia: { bucket: "mesa", caminho: `${CLIENTE}/estudio/a.jpg`, origem: "internet", credito: { fonte: "Notícia · Forbes Brasil", autor: null, licenca: LICENCA_DA_NOTICIA, url: "https://forbes.com.br/x" } } } }, CLIENTE, erro);
    expect(t).toMatchObject({ cor_fundo: "#7a1f3d", bloco: { credito_visivel: true } });
  });
});
