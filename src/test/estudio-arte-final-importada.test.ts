// @vitest-environment node
import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  gravacaoNaoOcorreuNoMutar,
  acoesDaArteImportada,
  lerArteImportada,
  MODO_DA_ARTE_IMPORTADA,
  type DepsDaArteImportada,
  type TrabalhoDaArteImportada,
} from "../../supabase/functions/estudio-arte/modulos/arte-final-importada";

/**
 * Arte final pronta (12/11/2026): a peça feita fora entra na lâmina pelo mesmo
 * caminho de gravação do Gerar (salvarNaMesa + mutarTrabalho), sem IA; lâmina
 * travada (entregue, agendada, em aprovação) recusa e nunca sobrescreve.
 */

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TRABALHO = "22222222-2222-4222-8222-222222222222";
const PEDIDO = "33333333-3333-4333-8333-333333333333";
const ch = { userId: "equipe" };
const erro = (status: number, codigo: string, mensagem: string) => Object.assign(new Error(mensagem), { status, codigo });

function png(largura = 1080, altura = 1350): string {
  const crc = (bytes: Buffer) => {
    let r = 0xffffffff;
    for (const b of bytes) {
      r ^= b;
      for (let i = 0; i < 8; i++) r = (r >>> 1) ^ ((r & 1) ? 0xedb88320 : 0);
    }
    return (r ^ 0xffffffff) >>> 0;
  };
  const chunk = (nome: string, body: Buffer) => {
    const n = Buffer.alloc(4); n.writeUInt32BE(body.length);
    const tipo = Buffer.from(nome);
    const soma = Buffer.alloc(4); soma.writeUInt32BE(crc(Buffer.concat([tipo, body])));
    return Buffer.concat([n, tipo, body, soma]);
  };
  const cab = Buffer.alloc(13);
  cab.writeUInt32BE(largura, 0); cab.writeUInt32BE(altura, 4); cab[8] = 8; cab[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", cab),
    chunk("IDAT", deflateSync(Buffer.alloc(altura * (largura * 4 + 1)))), chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

/** JPEG mínimo: SOI, SOF0 com o tamanho, EOI (o servidor só lê cabeçalho e fim). */
function jpeg(largura = 1080, altura = 1350): string {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 255, largura >> 8, largura & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, ...sof, ...new Array(40).fill(0), 0xff, 0xd9]).toString("base64");
}

const PNG = png();
const pedido = (extra: Record<string, unknown> = {}) => ({ trabalho_id: TRABALHO, pedido_id: PEDIDO, ordem: 1, versao_esperada: 0, imagem_base64: PNG, ...extra });

function cenario(inicial: Partial<TrabalhoDaArteImportada> = {}) {
  let atual: TrabalhoDaArteImportada = {
    id: TRABALHO, client_id: CLIENTE, status: "dirigido", tipo: "social", entrega_status: null,
    direcao: { formato: "feed_4x5", cards: [{ ordem: 1 }, { ordem: 2 }] },
    cards: [],
    ...inicial,
  };
  const upload = vi.fn(async (_t: TrabalhoDaArteImportada, o: number, v: number, _b: Uint8Array, _m: string) => ({ caminho: `${CLIENTE}/estudio/${TRABALHO}/card-${o}-v${v}.png`, versao: v }));
  const mutar = vi.fn(async (_id: string, mudar: (t: TrabalhoDaArteImportada) => Record<string, unknown>) => {
    atual = { ...atual, ...mudar(structuredClone(atual)) } as TrabalhoDaArteImportada;
    return structuredClone(atual);
  });
  const descartar = vi.fn(async () => undefined);
  const deps: DepsDaArteImportada<typeof ch, TrabalhoDaArteImportada> = {
    erro,
    json: (b) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } }),
    trabalhoComAcesso: vi.fn(async () => structuredClone(atual)),
    mutarTrabalho: mutar,
    salvarImagem: upload,
    descartarUpload: descartar,
    quadro: () => ({ formato: "feed_4x5", largura: 1080, altura: 1350 }),
    ehPostDeFotos: (t) => t.tipo === "fotos",
    statusDepoisDeGerar: () => "gerando",
  };
  const acoes = acoesDaArteImportada(deps);
  return { deps, upload, mutar, descartar, ler: () => atual, importar: (b: Record<string, unknown> = pedido()) => acoes.importar_arte_final(ch, b) };
}

describe("importar_arte_final: arte pronta entra na lâmina sem IA", () => {
  it("grava pelo salvarNaMesa e acrescenta a versão em cards, sem custo", async () => {
    const c = cenario();
    const r = await c.importar();
    const corpo = await r.json();
    expect(c.upload).toHaveBeenCalledOnce();
    expect(c.upload.mock.calls[0][1]).toBe(1);
    expect(c.upload.mock.calls[0][2]).toBe(1);
    expect(c.upload.mock.calls[0][4]).toBe("image/png");
    expect(Buffer.from(c.upload.mock.calls[0][3]).toString("base64")).toBe(PNG);
    expect(corpo).toMatchObject({ versao: 1, ordem: 1, custo_usd: 0, aviso: null });
    const v = c.ler().cards[0];
    expect(v).toMatchObject({ ordem: 1, versao: 1, modo: MODO_DA_ARTE_IMPORTADA, origem: "gerar", custo_usd: 0, uso_ids: [], verificacao: { pendente: true }, tamanho: "1080x1350", formato_post: "feed_4x5", criado_por: "equipe" });
    expect(c.ler().status).toBe("gerando");
  });

  it("substitui sem apagar: a versão nova entra depois da anterior", async () => {
    const c = cenario({ cards: [{ ordem: 1, versao: 2, storage_path: "x/card-1-v2.png" }] });
    await c.importar(pedido({ versao_esperada: 2 }));
    expect(c.ler().cards.map((v) => v.versao)).toEqual([2, 3]);
    expect(c.ler().cards[0].storage_path).toBe("x/card-1-v2.png");
  });

  it("avisa quando a proporção é diferente do post", async () => {
    const c = cenario();
    const corpo = await (await c.importar(pedido({ imagem_base64: png(1080, 1080) }))).json();
    expect(c.upload.mock.calls[0][4]).toBe("image/png");
    expect(corpo.storage_path).toMatch(/card-1-v1\.png$/);
    expect(corpo.aviso).toMatch(/cortada pelo centro/);
  });

  it("recusa JPEG antes de gravar: o caminho do Gerar é sempre .png", async () => {
    const c = cenario();
    await expect(c.importar(pedido({ imagem_base64: jpeg() }))).rejects.toMatchObject({ codigo: "arte_formato", message: "Use uma imagem PNG." });
    expect(c.upload).not.toHaveBeenCalled();
    expect(c.mutar).not.toHaveBeenCalled();
    expect(() => lerArteImportada(jpeg(), erro)).toThrow(expect.objectContaining({ codigo: "arte_formato", message: "Use uma imagem PNG." }));
  });

  it.each([
    ["entregue", { status: "entregue" }],
    ["agendado", { status: "pronto", entrega_status: "agendado" }],
    ["aguardando o cliente", { status: "pronto", entrega_status: "aguardando_cliente" }],
    ["aprovado", { status: "pronto", entrega_status: "aprovado" }],
  ])("lâmina travada (%s) recusa com 409 e não sobe nada", async (_n, trava) => {
    const c = cenario(trava as Partial<TrabalhoDaArteImportada>);
    await expect(c.importar()).rejects.toMatchObject({ status: 409, codigo: "trabalho_entregue", message: expect.stringMatching(/Reabrir para corrigir/) });
    expect(c.upload).not.toHaveBeenCalled();
    expect(c.mutar).not.toHaveBeenCalled();
  });

  it("travou entre o upload e a gravação: recusa e descarta o arquivo novo", async () => {
    const c = cenario();
    c.mutar.mockImplementationOnce(async (_id, mudar) => mudar({ ...c.ler(), status: "entregue" }) as never);
    await expect(c.importar()).rejects.toMatchObject({ status: 409, codigo: "trabalho_entregue" });
    expect(c.descartar).toHaveBeenCalledOnce();
    expect(c.ler().cards).toEqual([]);
  });

  it("versão esperada diferente (outra pessoa trocou antes) recusa", async () => {
    const c = cenario({ cards: [{ ordem: 1, versao: 1, storage_path: "a" }] });
    await expect(c.importar(pedido({ versao_esperada: 0 }))).rejects.toMatchObject({ status: 409, codigo: "arte_concorrente" });
  });

  it("post de fotos e criativo de anúncio ficam de fora", async () => {
    await expect(cenario({ tipo: "fotos" }).importar()).rejects.toMatchObject({ codigo: "post_de_fotos" });
    await expect(cenario({ tipo: "ads" }).importar()).rejects.toMatchObject({ codigo: "arte_importada_indisponivel" });
  });

  it("reenvio do mesmo pedido não duplica a versão", async () => {
    const c = cenario();
    await c.importar();
    const corpo = await (await c.importar()).json();
    expect(corpo.ja_guardado).toBe(true);
    expect(c.ler().cards).toHaveLength(1);
    expect(c.upload).toHaveBeenCalledOnce();
  });

  it("recusa GIF, arquivo quebrado e imagem pequena demais", () => {
    expect(() => lerArteImportada(Buffer.from("GIF89a" + "x".repeat(60)).toString("base64"), erro)).toThrow("Use uma imagem PNG.");
    expect(() => lerArteImportada(PNG.slice(0, 200), erro)).toThrow();
    expect(() => lerArteImportada(png(100, 100), erro)).toThrow(/pequena demais/);
  });

  it("recusa WEBP", () => {
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8X"), Buffer.alloc(60)]).toString("base64");
    expect(() => lerArteImportada(webp, erro)).toThrow(expect.objectContaining({ codigo: "arte_formato", message: "Use uma imagem PNG." }));
  });

  it("conflito de gravação após as tentativas (nada gravado): descarta o arquivo e repassa o erro", async () => {
    const c = cenario();
    const conflito = Object.assign(new Error("O trabalho mudou várias vezes ao mesmo tempo."), { status: 409, codigo: "conflito_de_gravacao" });
    c.mutar.mockImplementationOnce(async (_id, mudar) => { mudar(c.ler()); throw conflito; });
    const acoes = acoesDaArteImportada({ ...c.deps, gravacaoNaoOcorreu: gravacaoNaoOcorreuNoMutar });
    await expect(acoes.importar_arte_final(ch, pedido())).rejects.toBe(conflito);
    expect(c.descartar).toHaveBeenCalledOnce();
    expect(c.descartar).toHaveBeenCalledWith(`${CLIENTE}/estudio/${TRABALHO}/card-1-v1.png`);
  });

  it("erro antes de qualquer UPDATE (leitura falhou): descarta o arquivo", async () => {
    const c = cenario();
    const falha = new Error("leitura falhou");
    c.mutar.mockImplementationOnce(async () => { throw falha; });
    await expect(c.importar()).rejects.toBe(falha);
    expect(c.descartar).toHaveBeenCalledOnce();
  });

  it("UPDATE sem linha e a leitura da nova tentativa falha (nada gravado): descarta o arquivo", async () => {
    const c = cenario();
    const leitura = Object.assign(new Error("Não foi possível ler o trabalho do estúdio."), { status: 503, codigo: "trabalho_indisponivel" });
    // 1ª volta: mudar + UPDATE sem linha (trava otimista); 2ª volta: lerTrabalho cai antes do mudar.
    c.mutar.mockImplementationOnce(async (_id, mudar) => { mudar(structuredClone(c.ler())); throw leitura; });
    const acoes = acoesDaArteImportada({ ...c.deps, gravacaoNaoOcorreu: gravacaoNaoOcorreuNoMutar });
    await expect(acoes.importar_arte_final(ch, pedido())).rejects.toBe(leitura);
    expect(c.descartar).toHaveBeenCalledWith(`${CLIENTE}/estudio/${TRABALHO}/card-1-v1.png`);
  });

  it("só os erros do mutar que provam ausência de gravação descartam", () => {
    for (const codigo of ["conflito_de_gravacao", "trabalho_indisponivel", "trabalho_inexistente", "trabalho_invalido"]) {
      expect(gravacaoNaoOcorreuNoMutar(Object.assign(new Error(codigo), { codigo }))).toBe(true);
    }
    expect(gravacaoNaoOcorreuNoMutar(Object.assign(new Error("x"), { codigo: "gravacao_falhou" }))).toBe(false);
    expect(gravacaoNaoOcorreuNoMutar(new TypeError("fetch failed"))).toBe(false);
    expect(gravacaoNaoOcorreuNoMutar(null)).toBe(false);
  });

  it("UPDATE sem confirmação (rede caiu depois de mandar): não apaga, o commit pode ter ocorrido", async () => {
    const c = cenario();
    const rede = Object.assign(new Error("Não foi possível gravar o trabalho do estúdio."), { status: 503, codigo: "gravacao_falhou" });
    c.mutar.mockImplementationOnce(async (_id, mudar) => { mudar(c.ler()); throw rede; });
    const acoes = acoesDaArteImportada({ ...c.deps, gravacaoNaoOcorreu: gravacaoNaoOcorreuNoMutar });
    await expect(acoes.importar_arte_final(ch, pedido())).rejects.toBe(rede);
    expect(c.descartar).not.toHaveBeenCalled();
  });
});
