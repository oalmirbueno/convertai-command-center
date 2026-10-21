// @vitest-environment node
import { webcrypto } from "node:crypto";
import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  acoesDoTemplateProfile,
  lerPngDoTemplate,
  MAX_BYTES_PNG_TEMPLATE,
  normalizarTemplateProfile,
  type DepsDoTemplate,
  type TrabalhoDoTemplate,
} from "../../supabase/functions/estudio-arte/modulos/template-profile";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TRABALHO = "22222222-2222-4222-8222-222222222222";
const PEDIDO = "33333333-3333-4333-8333-333333333333";
const ch = { userId: "equipe" };
const erro = (status: number, codigo: string, mensagem: string) => Object.assign(new Error(mensagem), { status, codigo });
const template = () => ({ versao: 1, estilo: "twitter", nome: "Cliente", username: "@cliente", texto: "Conteúdo real\nSegunda linha", tamanho_texto: 36, cor_fundo: "#FFFFFF" });

/** PNG verdadeiro e pequeno (compressão de linhas transparentes), sem imagem externa. */
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
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0); cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8; cabecalho[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", cabecalho),
    chunk("IDAT", deflateSync(Buffer.alloc(altura * (largura * 4 + 1)))), chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
const PNG = png();
const pedido = () => ({ trabalho_id: TRABALHO, pedido_id: PEDIDO, ordem: 1, versao_esperada: 0, texto_base: "Original", template: template(), png_base64: PNG });

type TrabalhoTeste = TrabalhoDoTemplate & { custo_usd: number };
function cenario() {
  let atual: TrabalhoTeste = {
    id: TRABALHO, client_id: CLIENTE, status: "dirigido", tipo: "social", entrega_status: null,
    direcao: { formato: "feed_4x5", cards: [{ ordem: 1, texto_exato: "Original" }, { ordem: 2, texto_exato: "Preservado" }] },
    cards: [], custo_usd: 7,
  };
  const upload = vi.fn(async (_t: TrabalhoTeste, _o: number, v: number, _p: Uint8Array) => ({ caminho: `${CLIENTE}/estudio/${TRABALHO}/card-1-v${v}.png`, versao: v }));
  const acesso = vi.fn(async () => structuredClone(atual));
  const descartar = vi.fn(async () => undefined);
  const deps: DepsDoTemplate<typeof ch, TrabalhoTeste> = {
    erro, json: (b) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } }),
    trabalhoComAcesso: acesso,
    mutarTrabalho: vi.fn(async (_id, mudar) => { atual = { ...atual, ...mudar(structuredClone(atual)) }; return structuredClone(atual); }),
    salvarImagem: upload, descartarUpload: descartar,
    quadro: (t) => ({ formato: String(t.direcao.formato), largura: 1080, altura: t.direcao.formato === "quadrado_1x1" ? 1080 : 1350 }),
    ehPostDeFotos: (t) => t.tipo === "fotos",
    statusDepoisDeGerar: () => "gerando",
    atualizarTexto: (t, ordem, texto) => ({ ...t.direcao, cards: t.direcao.cards.map((c) => c.ordem === ordem ? { ...c, texto_exato: texto } : c) }),
  };
  return { deps, upload, acesso, descartar, ler: () => atual, mudar: (v: Partial<TrabalhoTeste>) => { atual = { ...atual, ...v }; }, salvar: (body = pedido()) => acoesDoTemplateProfile(deps).salvar_template(ch, body) };
}

beforeAll(() => { vi.stubGlobal("crypto", webcrypto); });

describe("contrato Profile", () => {
  it("normaliza o perfil e guarda apenas ajustes conhecidos, sem inferir verificação", () => {
    const t = normalizarTemplateProfile({ ...template(), token: "ignorado" }, CLIENTE, erro);
    expect(t.username).toBe("cliente");
    expect(t.verificado).toBe(false);
    expect(t.tema).toBe("claro");
    expect(t).not.toHaveProperty("token");
    expect(normalizarTemplateProfile({ ...template(), verificado: true }, CLIENTE, erro).verificado).toBe(true);
  });
  it.each(["outro/foto.png", `${CLIENTE}/../outro.png`, `${CLIENTE}/%2e%2e/foto.png`, `${CLIENTE}/foto\\segredo.png`, `${CLIENTE}/foto.png?token=abc`])("recusa caminho fora do cliente ou ambíguo: %s", (imagem_caminho) => {
    expect(() => normalizarTemplateProfile({ ...template(), imagem_caminho }, CLIENTE, erro)).toThrow();
  });
  it("recusa campos inválidos, limites e nome de perfil não reconhecido", () => {
    for (const extra of [{ tamanho_texto: 200 }, { cor_fundo: "url(x)" }, { username: "https://instagram.com/cliente" }, { verificado: "true" }, { texto: "" }, { texto: "mal\u0000formado" }, { texto: "mal\u001fformado" }, { nome: "x".repeat(121) }]) {
      expect(() => normalizarTemplateProfile({ ...template(), ...extra }, CLIENTE, erro)).toThrow();
    }
  });
});

describe("PNG do Profile", () => {
  it("aceita PNG final verdadeiro e recusa outro formato, truncamento e dados anexos", () => {
    expect(lerPngDoTemplate(PNG, 1080, 1350, erro).length).toBeGreaterThan(57);
    expect(() => lerPngDoTemplate(PNG, 1080, 1080, erro)).toThrow(/1080 × 1080/);
    expect(() => lerPngDoTemplate(`data:image/png;base64,${PNG}`, 1080, 1350, erro)).toThrow();
    expect(() => lerPngDoTemplate(Buffer.from("não é PNG").toString("base64"), 1080, 1350, erro)).toThrow();
    const bytes = Buffer.from(PNG, "base64");
    expect(() => lerPngDoTemplate(bytes.subarray(0, bytes.length - 12).toString("base64"), 1080, 1350, erro)).toThrow();
    expect(() => lerPngDoTemplate(Buffer.concat([bytes, Buffer.from("anexo")]).toString("base64"), 1080, 1350, erro)).toThrow();
    const corrompido = Buffer.from(bytes); corrompido[45] ^= 1;
    expect(() => lerPngDoTemplate(corrompido.toString("base64"), 1080, 1350, erro)).toThrow(/corrompido/);
  });
  it("aplica teto antes da decodificação", () => {
    expect(() => lerPngDoTemplate("A".repeat(Math.ceil(MAX_BYTES_PNG_TEMPLATE / 3) * 4 + 4), 1080, 1350, erro)).toThrow(/8 MB/);
  });
});

describe("salvar_template: acesso, versões e aprovação", () => {
  it("acrescenta uma versão sem modelo de imagem ou custo, mantendo outras lâminas", async () => {
    const c = cenario();
    const r = await (await c.salvar()).json();
    expect(r.custo_usd).toBe(0);
    expect(r.trabalho.custo_usd).toBe(7);
    expect(r.trabalho.cards[0]).toMatchObject({ ordem: 1, versao: 1, modo: "template_profile", verificacao: { pendente: true }, uso_ids: [], custo_usd: 0 });
    expect(r.trabalho.direcao.cards).toEqual([{ ordem: 1, texto_exato: template().texto }, { ordem: 2, texto_exato: "Preservado" }]);
    expect(c.acesso).toHaveBeenCalledWith(ch, TRABALHO);
    expect(c.upload).toHaveBeenCalledOnce();
    expect(c.ler().status).toBe("gerando");
  });
  it.each(["entregue", "aprovado", "agendado", "arquivado"])("não modifica trabalho %s", async (status) => {
    const c = cenario(); c.mudar({ status });
    await expect(c.salvar()).rejects.toMatchObject({ codigo: "trabalho_entregue" });
    expect(c.upload).not.toHaveBeenCalled();
  });
  it.each(["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"])("preserva o gate %s", async (entrega_status) => {
    const c = cenario(); c.mudar({ entrega_status });
    await expect(c.salvar()).rejects.toMatchObject({ codigo: "trabalho_entregue" });
    expect(c.ler().cards).toEqual([]);
  });
  it.each(["ads", "fotos"])("não converte trabalho %s", async (tipo) => {
    const c = cenario(); c.mudar({ tipo });
    await expect(c.salvar()).rejects.toMatchObject({ codigo: "template_indisponivel" });
    expect(c.upload).not.toHaveBeenCalled();
  });
  it("nega acesso e ordem inexistente antes do upload", async () => {
    const c = cenario(); c.acesso.mockRejectedValueOnce(erro(403, "sem_acesso", "Sem acesso"));
    await expect(c.salvar()).rejects.toMatchObject({ status: 403 });
    await expect(c.salvar({ ...pedido(), ordem: 9 })).rejects.toMatchObject({ codigo: "card_inexistente" });
    expect(c.upload).not.toHaveBeenCalled();
  });
  it("recusa versão ultrapassada antes de armazenar", async () => {
    const c = cenario(); c.mudar({ cards: [{ ordem: 1, versao: 2, storage_path: "anterior" }] });
    await expect(c.salvar()).rejects.toMatchObject({ codigo: "template_concorrente" });
    expect(c.upload).not.toHaveBeenCalled();
    expect(c.ler().cards[0].storage_path).toBe("anterior");
  });
  it.each(["versao", "aprovacao", "cliente", "formato", "copy"])("revalida mudança concorrente de %s dentro do CAS", async (mudanca) => {
    const c = cenario();
    c.upload.mockImplementationOnce(async (_t, _o, v) => {
      if (mudanca === "versao") c.mudar({ cards: [{ ordem: 1, versao: 1, storage_path: "concorrente" }] });
      if (mudanca === "aprovacao") c.mudar({ entrega_status: "aprovado" });
      if (mudanca === "cliente") c.mudar({ client_id: "outro" });
      if (mudanca === "formato") c.mudar({ direcao: { ...c.ler().direcao, formato: "quadrado_1x1" } });
      if (mudanca === "copy") c.mudar({ direcao: { ...c.ler().direcao, cards: [{ ordem: 1, texto_exato: "Texto atualizado por outra pessoa" }] } });
      return { caminho: "upload-exclusivo", versao: v };
    });
    await expect(c.salvar()).rejects.toMatchObject({ status: 409 });
    expect(c.ler().cards).not.toContainEqual(expect.objectContaining({ storage_path: "upload-exclusivo" }));
    expect(c.ler().direcao.cards[0].texto_exato).toBe(mudanca === "copy" ? "Texto atualizado por outra pessoa" : "Original");
    expect(c.descartar).toHaveBeenCalledExactlyOnceWith("upload-exclusivo");
  });
  it("recusa base de copy ultrapassada antes do upload, mesmo sem nova versão de imagem", async () => {
    const c = cenario();
    await expect(c.salvar({ ...pedido(), texto_base: "Texto antigo" })).rejects.toMatchObject({ codigo: "texto_template_alterado" });
    expect(c.upload).not.toHaveBeenCalled();
  });
  it("não apaga o upload quando uma falha de rede deixa o resultado do UPDATE incerto", async () => {
    const c = cenario();
    c.deps.mutarTrabalho = vi.fn(async () => { throw erro(503, "gravacao_falhou", "Resultado incerto"); });
    await expect(c.salvar()).rejects.toMatchObject({ status: 503 });
    expect(c.descartar).not.toHaveBeenCalled();
  });
  it("replay devolve a versão anterior sem nova escrita, mesmo depois de entregar", async () => {
    const c = cenario();
    const primeiro = await (await c.salvar()).json();
    c.mudar({ status: "entregue" });
    const segundo = await (await c.salvar()).json();
    expect(segundo).toMatchObject({ ja_guardado: true, versao: primeiro.versao, storage_path: primeiro.storage_path });
    expect(c.ler().cards).toHaveLength(1);
    expect(c.upload).toHaveBeenCalledOnce();
    expect(c.deps.mutarTrabalho).toHaveBeenCalledOnce();
  });
  it("replay do mesmo pedido não depende do formato atual do trabalho", async () => {
    const c = cenario();
    const primeiro = await (await c.salvar()).json();
    c.mudar({ direcao: { ...c.ler().direcao, formato: "quadrado_1x1" } });
    const segundo = await (await c.salvar()).json();
    expect(segundo).toMatchObject({ ja_guardado: true, storage_path: primeiro.storage_path });
    expect(c.upload).toHaveBeenCalledOnce();
    expect(c.ler().direcao.formato).toBe("quadrado_1x1");
  });
  it("um pedido_id não pode ser reutilizado com outro conteúdo", async () => {
    const c = cenario(); await c.salvar();
    await expect(c.salvar({ ...pedido(), template: { ...template(), texto: "Outro conteúdo" } })).rejects.toMatchObject({ codigo: "pedido_template_reutilizado" });
    expect(c.upload).toHaveBeenCalledOnce();
  });
  it("duas requisições iguais simultâneas gravam uma versão e descartam só seu upload perdido", async () => {
    const c = cenario();
    let liberar!: () => void;
    const barreira = new Promise<void>((resolve) => { liberar = resolve; });
    let chamadas = 0;
    c.upload.mockImplementation(async () => {
      const versao = ++chamadas;
      if (chamadas === 2) liberar();
      await barreira;
      return { caminho: `upload-${versao}`, versao };
    });
    const respostas = await Promise.all([c.salvar(), c.salvar()]);
    const resultados = await Promise.all(respostas.map((r) => r.json()));
    expect(resultados[0].storage_path).toBe(resultados[1].storage_path);
    expect(c.ler().cards).toHaveLength(1);
    expect(c.descartar).toHaveBeenCalledOnce();
    expect(c.descartar).not.toHaveBeenCalledWith(c.ler().cards[0].storage_path);
  });
});
