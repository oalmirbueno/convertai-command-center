// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  acoesDoCarrossel,
  ESQUEMA_DO_CARROSSEL_X,
  lerCarrosselGerado,
  midiaPorRegra,
  perguntasDaMidia,
  videoDoCommons,
  videoDoPexels,
  type DepsDoCarrossel,
} from "../../supabase/functions/estudio-arte/modulos/template-carrossel";
import type { TrabalhoDaGeracao } from "../../supabase/functions/estudio-arte/modulos/template-geracao";
import { normalizarTemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

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
