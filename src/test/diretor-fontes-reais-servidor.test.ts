// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  acoesDasFontesReais, consultaDaFonteReal, MAX_BYTES_FONTE_REAL, MAX_FONTES_REAIS, urlDaFonteReal,
  type DepsDasFontesReais, type FonteRealDoDiretor, type TrabalhoComFontesReais,
} from "../../supabase/functions/estudio-arte/modulos/fontes-reais-do-diretor";
import { decidirPapeis, papelPelaRegra } from "../../supabase/functions/estudio-arte/anexos-do-ajuste";
import { normalizarTemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TRABALHO = "22222222-2222-4222-8222-222222222222";
const ARQUIVO = "File:Landscape.jpg";
const IMAGEM = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Landscape.jpg/1080px-Landscape.jpg";
const PAGINA = "https://commons.wikimedia.org/wiki/File%3ALandscape.jpg";
const ch = { userId: "equipe" };
const erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => Object.assign(new Error(mensagem), { status, codigo, detalhes });
const fonte = (n = 1): FonteRealDoDiretor => ({ caminho: `${CLIENTE}/estudio/fontes-reais/${n}.jpg`, nome: "Paisagem", fonte_url: `${PAGINA}${n === 1 ? "" : n}`, licenca: "CC BY-SA 4.0", autor: "Fotógrafo", tipo: "imagem" });
const info = () => ({ query: { pages: [{ title: ARQUIVO, imageinfo: [{ mime: "image/jpeg", url: IMAGEM, thumburl: IMAGEM, descriptionurl: PAGINA, width: 3000, extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "<b>Fotógrafo</b>" } } }] }] } });
const pedido = () => ({ trabalho_id: TRABALHO, ordem: 1, texto_base: "Original privado", versao_esperada: 1, arquivo: ARQUIVO });
type TrabalhoTeste = TrabalhoComFontesReais & { custo_usd: number };
function cenario() {
  let atual: TrabalhoTeste = {
    id: TRABALHO, client_id: CLIENTE, status: "pronto", tipo: "social", entrega_status: null, custo_usd: 3,
    direcao: { cards: [{ ordem: 1, texto_exato: "Original privado" }, { ordem: 2, texto_exato: "Preservado" }] },
    cards: [{ ordem: 1, versao: 1 }],
  };
  const acesso = vi.fn(async () => structuredClone(atual));
  const consulta = vi.fn(async (url: string): Promise<unknown> => new URL(url).searchParams.has("list") ? { query: { search: [{ title: ARQUIVO }, { title: ARQUIVO }, { title: "File:Video.mp4" }] } } : info());
  const baixar = vi.fn(async (url: URL, _limite: number, permitir: (u: URL) => boolean) => permitir(url) ? { url, bytes: new Uint8Array([1, 2, 3]) } : null);
  const upload = vi.fn(async () => fonte().caminho);
  const descartar = vi.fn(async () => undefined);
  const deps: DepsDasFontesReais<typeof ch, TrabalhoTeste> = {
    erro, json: (b) => new Response(JSON.stringify(b)), trabalhoComAcesso: acesso,
    mutarTrabalho: vi.fn(async (_id, mudar) => { atual = { ...atual, ...mudar(structuredClone(atual)) }; return structuredClone(atual); }),
    jsonDoCommons: consulta, buscarImagem: baixar, validarImagem: vi.fn((): "image/jpeg" => "image/jpeg"), guardarImagem: upload,
    descartarUpload: descartar, ehPostDeFotos: (t) => t.tipo === "fotos",
  };
  const acoes = acoesDasFontesReais(deps);
  return { deps, acesso, consulta, baixar, upload, descartar, ler: () => atual, mudar: (v: Partial<TrabalhoTeste>) => { atual = { ...atual, ...v }; }, aplicar: (p: Record<string, unknown> = pedido()) => acoes.imagem_real_aplicar(ch, p), buscar: (p = { trabalho_id: TRABALHO, ordem: 1, consulta: "Montanhas", tipo: "imagem" }) => acoes.imagens_reais_buscar(ch, p) };
}

describe("Fontes reais: busca pública explícita", () => {
  it("exige autorização, consulta editável e devolve origem/autoria/licença do Commons, sem custo", async () => {
    const c = cenario();
    const r = await (await c.buscar()).json();
    expect(c.acesso).toHaveBeenCalledWith(ch, TRABALHO);
    expect(new URL(c.consulta.mock.calls[0][0]).searchParams.get("srsearch")).toBe("Montanhas");
    expect(c.consulta.mock.calls[0][0]).not.toContain("Original");
    expect(r).toMatchObject({ consulta: "Montanhas", custo_usd: 0, resultados: [{ arquivo: ARQUIVO, nome: "Landscape", fonte_url: PAGINA, autor: "Fotógrafo", licenca: "CC BY-SA 4.0" }] });
    expect(r.resultados).toHaveLength(1);
    expect(c.upload).not.toHaveBeenCalled();
  });
  it("pesquisa logo só quando escolhido e não inventa imagem sem resultado", async () => {
    const c = cenario();
    c.consulta.mockResolvedValueOnce({ query: { search: [] } });
    expect(await (await c.buscar({ trabalho_id: TRABALHO, ordem: 1, consulta: "Marca", tipo: "logo" })).json()).toMatchObject({ resultados: [], custo_usd: 0 });
    expect(new URL(c.consulta.mock.calls[0][0]).searchParams.get("srsearch")).toBe("Marca logo");
  });
  it("falha de busca não finge sucesso; falha parcial preserva resultados disponíveis", async () => {
    const c = cenario();
    c.consulta.mockRejectedValueOnce(new Error("rede"));
    await expect(c.buscar()).rejects.toMatchObject({ status: 502 });
    c.consulta.mockResolvedValueOnce({ query: { search: [{ title: ARQUIVO }, { title: "File:Other.png" }] } }).mockResolvedValueOnce(info()).mockRejectedValueOnce(new Error("rede"));
    const r = await (await c.buscar()).json();
    expect(r.resultados).toHaveLength(1);
    expect(r.avisos.join(" ")).toContain("Algumas fontes não responderam");
  });
  it.each([undefined, "a", "a".repeat(201), "email@cliente.com", "https://cliente.com/dados", "privado\u0000"])('recusa consulta inválida sem usar a copy como fallback: %s', (v) => {
    expect(() => consultaDaFonteReal(v, erro)).toThrow();
  });
});

describe("Fontes reais: URL de imagem, sem sessão autenticada", () => {
  it.each([
    "http://exemplo.com/foto.png", "https://127.0.0.1/x.png", "https://10.1.2.3/x.png", "https://169.254.169.254/x.png", "https://[::1]/x.png", "https://[fc00::1]/x.png", "https://[fe80::1]/x.png", "https://[::ffff:127.0.0.1]/x.png", "https://[ff02::1]/x.png", "https://exemplo.internal/x.png", "https://user:senha@exemplo.com/x.png", "https://exemplo.com:8443/x.png", "https://mypostflow.com/dashboard", "https://exemplo.com/%64ashboard/x.png", "https://exemplo.com/login", "https://exemplo.com/x.png?token=segredo", "https://exemplo.com/x.png?X-Amz-Signature=abc",
  ])("recusa endereço interno, acesso privado ou painel: %s", async (url) => {
    const c = cenario();
    expect(urlDaFonteReal(url)).toBeNull();
    await expect(c.aplicar({ ...pedido(), arquivo: undefined, url })).rejects.toMatchObject({ status: 422, codigo: "imagem_real_precisa_print", detalhes: { precisa_print: true } });
    expect(c.baixar).not.toHaveBeenCalled(); expect(c.upload).not.toHaveBeenCalled();
  });
  it("remove fragmento e permite imagem pública HTTPS com parâmetros de dimensão", () => {
    expect(urlDaFonteReal("https://imagens.exemplo.com/foto.png?w=1080#trecho")?.href).toBe("https://imagens.exemplo.com/foto.png?w=1080");
    expect(urlDaFonteReal("https://[2606:4700::1111]/x.png")).not.toBeNull();
  });
  it("exige imagem de verdade: HTML e captura indisponível pedem print, sem upload", async () => {
    const c = cenario();
    vi.mocked(c.deps.validarImagem).mockReturnValue(null);
    await expect(c.aplicar({ ...pedido(), arquivo: undefined, url: "https://exemplo.com/publico" })).rejects.toMatchObject({ status: 422, detalhes: { precisa_print: true } });
    expect(c.upload).not.toHaveBeenCalled();
  });
  it("passa o bloqueio a cada redirecionamento; não segue painel ou IP interno", async () => {
    const c = cenario();
    c.baixar.mockImplementationOnce(async (_url, _limite, permitir) => {
      expect(permitir(new URL("https://127.0.0.1/imagem.png"))).toBe(false);
      expect(permitir(new URL("https://exemplo.com/dashboard"))).toBe(false);
      return null;
    });
    await expect(c.aplicar()).rejects.toMatchObject({ status: 422 });
    expect(c.upload).not.toHaveBeenCalled();
  });
  it("a ligação real mantém DNS/HTTPS em cada salto e upload imutável sem colagem global", () => {
    const index = readFileSync("supabase/functions/estudio-arte/index.ts", "utf8");
    expect(index).toContain('buscarLinkSeguro(url, limite, "image/png,image/jpeg,image/webp", false, permitir)');
    expect(index).toContain("if (permitir && !permitir(url)) return null;");
    expect(index).toContain("if (!(await hostResolvePublico(url.hostname))) return null;");
    expect(index).toContain('redirect: "manual"');
    expect(index).toContain("const COLAR_FOTO_EXATA_NO_AJUSTE = false");
    expect(index).toContain("${crypto.randomUUID()}.${ext}");
    expect(index).toContain("contentType: mime, upsert: false");
  });
});

describe("Fontes reais: anexar preservando estado e concorrência", () => {
  it("reconfere metadados e anexa fonte sem substituir fotos/vitrine/copy/versões/custo", async () => {
    const c = cenario();
    const direcao = { ...c.ler().direcao, cards: c.ler().direcao.cards.map((v) => ({ ...v, fotos_livres: [{ caminho: "preservado" }], imagens_ids: ["acervo"], vitrine_de_logos: [{ caminho: "logo" }] })) };
    c.mudar({ direcao });
    const antes = structuredClone(c.ler());
    const r = await (await c.aplicar({ ...pedido(), tipo: "logo", nome: "Fake", licenca: "Fake" })).json();
    expect(r).toMatchObject({ custo_usd: 0, fonte: { caminho: fonte().caminho, autor: "Fotógrafo", licenca: "CC BY-SA 4.0", tipo: "logo" } });
    expect(c.consulta).toHaveBeenCalledTimes(1);
    expect(c.baixar.mock.calls[0][1]).toBe(MAX_BYTES_FONTE_REAL);
    expect(c.ler().direcao.cards[0]).toMatchObject({ ...antes.direcao.cards[0], fontes_reais: [r.fonte] });
    expect(c.ler().direcao.cards[1]).toEqual(antes.direcao.cards[1]);
    expect(c.ler().cards).toEqual(antes.cards); expect(c.ler().custo_usd).toBe(3); expect(c.ler().status).toBe("pronto");
  });
  it("link direto guarda origem final e não inventa licença/autoria", async () => {
    const c = cenario();
    c.baixar.mockResolvedValueOnce({ url: new URL("https://cdn.exemplo.com/arquivo.png"), bytes: new Uint8Array([1]) });
    const r = await (await c.aplicar({ ...pedido(), arquivo: undefined, url: "https://exemplo.com/foto.png" })).json();
    expect(r.fonte).toMatchObject({ fonte_url: "https://cdn.exemplo.com/arquivo.png", autor: null, licenca: "licença não informada; confira a autorização de uso" });
  });
  it.each(["entregue", "aprovado", "agendado", "aguardando_agencia", "aguardando_cliente", "arquivado"])("congela trabalho em %s antes de buscar ou importar", async (status) => {
    const c = cenario(); c.mudar({ status });
    await expect(c.aplicar()).rejects.toMatchObject({ status: 409 });
    await expect(c.buscar()).rejects.toMatchObject({ status: 409 });
    expect(c.consulta).not.toHaveBeenCalled(); expect(c.upload).not.toHaveBeenCalled();
  });
  it("entrega em aprovação, fotos/Ads, lâmina ausente e permissão negada impedem importação", async () => {
    for (const mudanca of [{ entrega_status: "aguardando_cliente" }, { tipo: "fotos" }, { tipo: "ads" }]) {
      const c = cenario(); c.mudar(mudanca); await expect(c.aplicar()).rejects.toMatchObject({ status: 409 }); expect(c.consulta).not.toHaveBeenCalled();
    }
    const c = cenario(); await expect(c.aplicar({ ...pedido(), ordem: 5 })).rejects.toMatchObject({ status: 404 });
    c.acesso.mockRejectedValueOnce(erro(403, "sem_acesso", "Sem acesso"));
    await expect(c.aplicar()).rejects.toMatchObject({ status: 403 }); expect(c.consulta).not.toHaveBeenCalled();
  });
  it.each(["versao", "texto", "cliente", "aprovacao"])("revalida %s dentro do CAS e remove apenas upload desta tentativa recusada", async (mudanca) => {
    const c = cenario();
    c.upload.mockImplementationOnce(async () => {
      if (mudanca === "versao") c.mudar({ cards: [{ ordem: 1, versao: 2 }] });
      if (mudanca === "texto") c.mudar({ direcao: { cards: [{ ordem: 1, texto_exato: "Outro assunto" }] } });
      if (mudanca === "cliente") c.mudar({ client_id: "33333333-3333-4333-8333-333333333333" });
      if (mudanca === "aprovacao") c.mudar({ entrega_status: "aprovado" });
      return fonte().caminho;
    });
    await expect(c.aplicar()).rejects.toMatchObject({ status: 409 });
    expect(c.descartar).toHaveBeenCalledWith(fonte().caminho);
    expect(c.ler().direcao.cards[0].fontes_reais).toBeUndefined();
  });
  it("deduplica repetição e importações concorrentes da mesma origem", async () => {
    const c = cenario();
    await c.aplicar();
    expect(await (await c.aplicar()).json()).toMatchObject({ ja_guardada: true });
    expect(c.upload).toHaveBeenCalledTimes(1);
    const d = cenario();
    d.upload.mockImplementationOnce(async () => { d.mudar({ direcao: { cards: [{ ordem: 1, texto_exato: "Original privado", fontes_reais: [fonte()] }] } }); return `${CLIENTE}/exclusivo.jpg`; });
    expect(await (await d.aplicar()).json()).toMatchObject({ ja_guardada: true, fonte: fonte() });
    expect(d.descartar).toHaveBeenCalledWith(`${CLIENTE}/exclusivo.jpg`);
    expect(d.ler().direcao.cards[0].fontes_reais).toHaveLength(1);
  });
  it("mantém novas fontes de outra chamada e recusa ultrapassar o limite inclusive no CAS", async () => {
    const c = cenario();
    c.upload.mockImplementationOnce(async () => { c.mudar({ direcao: { cards: [{ ordem: 1, texto_exato: "Original privado", fontes_reais: [fonte(2)] }] } }); return fonte().caminho; });
    await c.aplicar(); expect(c.ler().direcao.cards[0].fontes_reais).toHaveLength(2);
    const d = cenario();
    d.upload.mockImplementationOnce(async () => { d.mudar({ direcao: { cards: [{ ordem: 1, texto_exato: "Original privado", fontes_reais: Array.from({ length: MAX_FONTES_REAIS }, (_, n) => fonte(n + 2)) }] } }); return fonte().caminho; });
    await expect(d.aplicar()).rejects.toMatchObject({ codigo: "limite_fontes_reais" }); expect(d.descartar).toHaveBeenCalledTimes(1);
  });
  it("não apaga upload quando o resultado da escrita é ambíguo", async () => {
    const c = cenario(); vi.mocked(c.deps.mutarTrabalho).mockRejectedValueOnce(new Error("conexão perdida após update"));
    await expect(c.aplicar()).rejects.toThrow("conexão perdida"); expect(c.descartar).not.toHaveBeenCalled();
  });
});

describe("Print como conteúdo e anotação manual", () => {
  it.each(["use este print exatamente", "coloca essa captura como está", "use exatamente esta tela, sem redesenhar"])("preserva intenção de conteúdo: %s", (pedido) => {
    expect(papelPelaRegra(pedido)).toBe("exata");
    expect(decidirPapeis([{ papel: "auto", caminho: "cliente/print.png" }], { papel_1: { choice: "erro", confidence: .99 } }, pedido)[0]).toMatchObject({ papel: "exata", papel_por: "regra" });
  });
  it.each(["olha esse print do erro", "este print mostra o problema", "use este print para corrigir exatamente o erro", "não use esse print exatamente"])("mantém print de diagnóstico: %s", (pedido) => { expect(papelPelaRegra(pedido)).toBe("erro"); });
  it("a escolha explícita do papel pela equipe tem precedência", () => {
    expect(decidirPapeis([{ papel: "erro", caminho: "c/print.png" }], null, "use este print exatamente")[0]).toMatchObject({ papel: "erro", papel_por: "equipe" });
  });
  const template = { versao: 1, estilo: "instagram", nome: "Cliente", username: "cliente", texto: "Texto", cor_fundo: "#ffffff", imagem_caminho: fonte().caminho };
  it("guarda coordenadas da imagem original, rótulo curto e caminhos reais autorizados", () => {
    expect(normalizarTemplateProfile({ ...template, destaque: { x: 0, y: 1, rotulo: "  Toque aqui  ", token: "ignorado" } }, CLIENTE, erro)).toMatchObject({ imagem_caminho: fonte().caminho, destaque: { x: 0, y: 1, rotulo: "Toque aqui" } });
    expect(normalizarTemplateProfile({ ...template, destaque: null }, CLIENTE, erro)).not.toHaveProperty("destaque");
  });
  it.each([{ x: -0.1, y: .2, rotulo: "x" }, { x: .2, y: 1.1, rotulo: "x" }, { x: NaN, y: .2, rotulo: "x" }, { x: .2, y: Infinity, rotulo: "x" }, { x: "0.2", y: .2, rotulo: "x" }, { x: .2, y: .2, rotulo: "" }, { x: .2, y: .2, rotulo: "x".repeat(61) }, { x: .2, y: .2, rotulo: "<script>" }, { x: .2, y: .2, rotulo: "duas\nlinhas" }])("recusa anotação inválida %j", (destaque) => { expect(() => normalizarTemplateProfile({ ...template, destaque }, CLIENTE, erro)).toThrow(); });
});
