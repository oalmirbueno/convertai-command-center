import { beforeEach, describe, expect, it, vi } from "vitest";
import { levarAoMotor, rotasDaPrevia, type ContextoDaPrevia } from "../../supabase/functions/mesa-site/previa";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";

/**
 * Frente SPV (30/09): as rotas da prévia editável na função mesa-site, com
 * banco falso. Conteúdo grava, registra o antes e o depois e leva ao motor
 * (juntando no pedido que ainda espera); código devolve o custo e só com
 * Confirmar vira trabalho; o Desfazer volta o ponto ou para o trabalho; foto
 * de outra marca não entra; fonte fora do catálogo é recusada.
 */

type Linha = Record<string, any>;

/** Banco falso com o pedaço do PostgREST que as rotas usam. */
function criarBanco(tabelas: Record<string, Linha[]>) {
  const escritas: Array<{ tabela: string; op: string; valor: unknown }> = [];
  /** Coluna ou caminho do PostgREST ("pedido->>pacote_de"). */
  const campo = (l: Linha, c: string) => {
    const [col, chave] = c.split("->>");
    return chave === undefined ? l[col] : l[col] && typeof l[col] === "object" ? l[col][chave] : undefined;
  };
  const de = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let valor: any = null;
    let limite = Infinity;
    let ordem: { c: string; asc: boolean } | null = null;
    const q: any = {
      select: () => q,
      insert: (v: any) => ((op = "insert"), (valor = v), q),
      update: (v: any) => ((op = "update"), (valor = v), q),
      eq: (c: string, v: unknown) => (filtros.push((l) => campo(l, c) === v), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => campo(l, c) !== v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (campo(l, c) ?? null) === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.indexOf(l[c]) >= 0), q),
      contains: (c: string, v: unknown[]) => (filtros.push((l) => Array.isArray(l[c]) && v.every((x) => l[c].indexOf(x) >= 0)), q),
      order: (c: string, o?: { ascending?: boolean }) => ((ordem = { c, asc: !o || o.ascending !== false }), q),
      limit: (n: number) => ((limite = n), q),
      rodar: () => {
        const t = (tabelas[tabela] = tabelas[tabela] || []);
        if (op === "insert") {
          const nova = { id: `id-${t.length + 1}-${tabela}`, criado_em: "2026-09-30T18:00:00Z", desfeita_em: null, ...valor };
          t.push(nova);
          escritas.push({ tabela, op, valor });
          return [nova];
        }
        const achadas = t.filter((l) => filtros.every((f) => f(l)));
        if (ordem) {
          const { c, asc } = ordem;
          achadas.sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
        }
        if (op === "update") {
          achadas.forEach((l) => Object.assign(l, valor));
          escritas.push({ tabela, op, valor });
        }
        return achadas.slice(0, limite);
      },
      single: async () => ({ data: q.rodar()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: q.rodar()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: q.rodar(), error: null }).then(ok, erro),
    };
    return q;
  };
  return { db: { from: de } as any, escritas, tabelas };
}

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const FOTO = "44444444-4444-4444-8444-444444444444";

const copy = { conceito: "c", headline: "Antes", subtitulo: "Sub", cta: "Pedir", secoes: [{ id: "bento", titulo: "Bento", texto: "T", itens: ["A: a", "B: b"] }], faq: [], seo: { titulo: "", descricao: "", palavras: [] } };

function montar(extra: { trabalhos?: Linha[]; fotos?: Linha[]; marca?: unknown; pacote?: (s: Linha) => Linha; naFila?: boolean; pacoteMudouEm?: string } = {}) {
  const site: Linha = { id: SITE, client_id: CLIENTE, marca_id: null, nome: "Landing", projeto: "landing-33333333", conteudo: { opcoes: [copy], escolhida: 0 }, estilo: {}, mapa: mapaPadrao("landing"), tipo: "landing", direcao: {}, imagens: [], arquivado_em: null, modelo: null, pacote_mudou_em: extra.pacoteMudouEm || null };
  const banco = criarBanco({
    motor_trabalhos: extra.trabalhos || [],
    cliente_imagens: extra.fotos || [],
    site_edicoes: [],
    ia_carteiras: [{ client_id: CLIENTE, saldo_usd: 5 }],
    ia_modelos: [{ id: "m-1", provedor: "openrouter", modelo_api: "x/y", tipo: "texto", ativo: true, preco_entrada_1m: 1, preco_saida_1m: 4, preco_cache_1m: 0.1, contexto_tokens: 200000, padrao_para: ["site"] }],
  });
  const pedidos: Linha[] = [];
  const pacotesDosPedidos: unknown[] = [];
  const ctx: ContextoDaPrevia = {
    servico: () => banco.db,
    lerSite: async () => JSON.parse(JSON.stringify(site)),
    atualizarSite: async (_id, campos) => {
      Object.assign(site, JSON.parse(JSON.stringify(campos)));
      return JSON.parse(JSON.stringify(site));
    },
    marcaDoSite: async () => (extra.marca === undefined ? null : (extra.marca as never)),
    erro: (status, codigo, mensagem) => Object.assign(new Error(mensagem), { status, codigo }),
    json: (body) => new Response(JSON.stringify(body)),
    gerarImagem: vi.fn(),
    construirSecao: vi.fn(),
    pararTrabalhoDoSite: vi.fn(async () => undefined),
    pedirTrabalho: vi.fn(async (_ch, s, pedido, pacote) => {
      pedidos.push(pedido);
      pacotesDosPedidos.push(pacote);
      const id = `t-${pedidos.length}`;
      // Com `naFila`, o pedido entra na fila de verdade (como o criarTrabalho faz), depois de tudo o que já estava lá.
      if (extra.naFila) banco.tabelas.motor_trabalhos.push({ id, client_id: CLIENTE, referencia_id: SITE, tipo: pedido.tipo, estado: "na_fila", commit: null, criado_em: `2026-09-30T23:5${pedidos.length}:00Z`, pedido: { pacote, pacote_de: s.pacote_mudou_em || null } });
      return { id, tipo: pedido.tipo, estado: "na_fila" } as never;
    }),
    pacoteDoMotor: vi.fn(async (s: Linha) => (extra.pacote ? extra.pacote(s) : { cliente: "Landing", versao: pedidos.length })),
  };
  const rotas = rotasDaPrevia(ctx);
  const chamar = async (acao: string, corpo: Linha) => JSON.parse(await (await rotas[acao]({ userId: "u-1" }, { site_id: SITE, ...corpo })).text());
  return { site, banco, ctx, pedidos, pacotesDosPedidos, chamar };
}

let espera: Promise<unknown>[] = [];
beforeEach(() => {
  espera = [];
  // O levar ao motor roda em segundo plano (EdgeRuntime.waitUntil): o teste espera por ele.
  (globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => espera.push(p) };
});
const esperarFundo = () => Promise.all(espera);

describe("previa_editar (conteúdo)", () => {
  it("grava, registra o antes e o depois e, sem projeto no worker, não pede trabalho", async () => {
    const t = montar();
    const r = await t.chamar("previa_editar", { edicao: { tipo: "texto", campo: "headline", valor: "Depois" } });
    await esperarFundo();
    expect(r).toMatchObject({ modo: "direto", resumo: 'Título principal: "Depois"' });
    expect(t.site.conteudo.opcoes[0].headline).toBe("Depois");
    const registro = t.banco.tabelas.site_edicoes[0];
    expect(registro).toMatchObject({ site_id: SITE, client_id: CLIENTE, tipo: "texto", modo: "direto", criado_por: "u-1" });
    expect(registro.alvos).toEqual([{ coluna: "conteudo", caminho: ["opcoes", 0, "headline"], antes: "Antes", depois: "Depois" }]);
    expect(t.pedidos).toEqual([]);
  });

  it("com projeto no worker leva ao motor; o pedido 'conteudo' que ainda espera ganha o pacote novo em vez de outro", async () => {
    const t = montar({ trabalhos: [{ id: "c1", client_id: CLIENTE, referencia_id: SITE, tipo: "construir", estado: "feito", commit: "abc1234" }] });
    await t.chamar("previa_editar", { edicao: { tipo: "cor", papel: "destaque", hex: "#ff5500" } });
    await esperarFundo();
    expect(t.pedidos).toEqual([{ tipo: "conteudo", instrucao: "Edição pela prévia" }]);
    // Agora há um "conteudo" na fila: a próxima edição junta nele.
    t.banco.tabelas.motor_trabalhos.push({ id: "k1", client_id: CLIENTE, referencia_id: SITE, tipo: "conteudo", estado: "na_fila", commit: null, pedido: { secoes: [], pacote: { velho: true } } });
    const r = await levarAoMotor(t.ctx, { userId: "u-1" }, SITE);
    expect(r).toEqual({ trabalho_id: "k1", juntou: true });
    expect(t.banco.tabelas.motor_trabalhos.find((x) => x.id === "k1")!.pedido.pacote).toEqual({ cliente: "Landing", versao: 1, arquivos: [] });
    expect(t.pedidos.length).toBe(1);
    // O "conteudo" novo levou o pacote já montado (não monta duas vezes).
    expect(t.pacotesDosPedidos[0]).toEqual({ cliente: "Landing", versao: 0 });
  });

  it("construir na fila sem nenhum commit (enquanto constrói): a edição entra no pacote do construir, com as seções que ele pediu", async () => {
    const t = montar({
      trabalhos: [{ id: "b1", client_id: CLIENTE, referencia_id: SITE, tipo: "construir", estado: "na_fila", commit: null, criado_em: "2026-09-30T16:34:00Z", pedido: { secoes: ["hero", "faq"], pacote: { cliente: "Landing", headline: "Antes", secoes: ["hero", "faq"], arquivos: [{ bucket: "mesa", path: "a/ref.png", destino: "referencias/anexo-1-ref.png" }] } } }],
      pacote: (s) => ({ cliente: "Landing", headline: s.conteudo.opcoes[0].headline, secoes: ["topo", "hero", "problema", "faq"], arquivos: [{ bucket: "mesa", path: "logo.png", destino: "public/marca/logo.png" }] }),
    });
    await t.chamar("previa_editar", { edicao: { tipo: "texto", campo: "headline", valor: "Depois" } });
    await esperarFundo();
    const b1 = t.banco.tabelas.motor_trabalhos.find((x) => x.id === "b1")!;
    expect(b1.pedido.pacote.headline).toBe("Depois");
    expect(b1.pedido.pacote.secoes).toEqual(["hero", "faq"]);
    expect(b1.pedido.pacote.arquivos.map((a: Linha) => a.destino)).toEqual(["public/marca/logo.png", "referencias/anexo-1-ref.png"]);
    expect(b1.pedido.secoes).toEqual(["hero", "faq"]);
    expect(b1.pedido.pacote_de).toBe(t.site.pacote_mudou_em);
    expect(t.pedidos).toEqual([]);
  });

  it("construir já rodando sem commit: a edição vira um 'conteudo' no fim da fila (roda depois dele)", async () => {
    const t = montar({ trabalhos: [{ id: "b1", client_id: CLIENTE, referencia_id: SITE, tipo: "construir", estado: "executando", commit: null, criado_em: "2026-09-30T16:34:00Z", pedido: { secoes: ["hero"], pacote: {} } }] });
    await t.chamar("previa_editar", { edicao: { tipo: "texto", campo: "headline", valor: "Depois" } });
    await esperarFundo();
    expect(t.pedidos).toEqual([{ tipo: "conteudo", instrucao: "Edição pela prévia" }]);
    expect(t.banco.tabelas.motor_trabalhos.find((x) => x.id === "b1")!.pedido.pacote).toEqual({});
  });

  it("envio atrasado não troca um pacote mais novo; o mais velho é trocado", async () => {
    const fila = (pacoteDe: string) => [{ id: "k1", client_id: CLIENTE, referencia_id: SITE, tipo: "conteudo", estado: "na_fila", commit: null, criado_em: "2026-09-30T19:00:00Z", pedido: { pacote: { novo: true }, pacote_de: pacoteDe } }];
    const t = montar({ trabalhos: fila("2026-09-30T20:00:00.000Z"), pacoteMudouEm: "2026-09-30T19:30:00.000Z" });
    expect(await levarAoMotor(t.ctx, { userId: "u-1" }, SITE)).toEqual({ trabalho_id: "k1", juntou: true });
    expect(t.banco.tabelas.motor_trabalhos[0].pedido).toEqual({ pacote: { novo: true }, pacote_de: "2026-09-30T20:00:00.000Z" });
    const u = montar({ trabalhos: fila("2026-09-30T19:00:00.000Z"), pacoteMudouEm: "2026-09-30T19:30:00.000Z" });
    await levarAoMotor(u.ctx, { userId: "u-1" }, SITE);
    expect(u.banco.tabelas.motor_trabalhos[0].pedido).toEqual({ pacote: { cliente: "Landing", versao: 0, arquivos: [] }, pacote_de: "2026-09-30T19:30:00.000Z" });
    expect(u.pedidos).toEqual([]);
  });

  it("publicar na fila sai com o que foi confirmado; a edição vai num 'conteudo' depois dele, e o 'conteudo' repetido é cancelado", async () => {
    const t = montar({
      naFila: true,
      pacoteMudouEm: "2026-09-30T21:00:00.000Z",
      trabalhos: [
        { id: "c1", client_id: CLIENTE, referencia_id: SITE, tipo: "construir", estado: "feito", commit: "abc1234", criado_em: "2026-09-30T10:00:00Z", pedido: {} },
        { id: "k0", client_id: CLIENTE, referencia_id: SITE, tipo: "conteudo", estado: "na_fila", commit: null, criado_em: "2026-09-30T11:00:00Z", pedido: { pacote: { velho: true } } },
        { id: "p1", client_id: CLIENTE, referencia_id: SITE, tipo: "publicar", estado: "na_fila", commit: null, criado_em: "2026-09-30T12:00:00Z", pedido: { pacote: { aprovado: true } } },
      ],
    });
    const r = await levarAoMotor(t.ctx, { userId: "u-1" }, SITE);
    const linha = (id: string) => t.banco.tabelas.motor_trabalhos.find((x) => x.id === id)!;
    expect(r).toEqual({ trabalho_id: "t-1", juntou: false });
    expect(linha("p1").pedido.pacote).toEqual({ aprovado: true });
    expect(linha("k0").estado).toBe("cancelado");
    expect(linha("k0").parar_pedido_por).toBe("u-1");
    expect(linha("t-1")).toMatchObject({ tipo: "conteudo", estado: "na_fila", pedido: { pacote_de: "2026-09-30T21:00:00.000Z" } });
  });

  it("sem projeto e sem nada aberto, nada vai ao motor (o próximo construir nasce do site editado)", async () => {
    const t = montar({ trabalhos: [{ id: "x", client_id: CLIENTE, referencia_id: SITE, tipo: "construir", estado: "cancelado", commit: null, criado_em: "2026-09-30T10:00:00Z", pedido: {} }] });
    expect(await levarAoMotor(t.ctx, { userId: "u-1" }, SITE)).toEqual({ trabalho_id: null, juntou: false });
    expect(t.ctx.pacoteDoMotor).not.toHaveBeenCalled();
  });

  it("Desfazer: volta o ponto e marca desfeita; uma segunda vez é recusada", async () => {
    const t = montar();
    await t.chamar("previa_editar", { edicao: { tipo: "texto", campo: "cta", valor: "Falar agora" } });
    const registro = t.banco.tabelas.site_edicoes[0];
    registro.id = "66666666-6666-4666-8666-666666666666";
    const d = await t.chamar("previa_desfazer", { edicao_id: registro.id });
    expect(d.resumo).toBe('Desfeito: Botão: "Falar agora"');
    expect(t.site.conteudo.opcoes[0].cta).toBe("Pedir");
    expect(registro.desfeita_em).toBeTruthy();
    await expect(t.chamar("previa_desfazer", { edicao_id: registro.id })).rejects.toMatchObject({ codigo: "ja_desfeita" });
  });

  it("fonte fora do catálogo e foto de outro cliente são recusadas", async () => {
    const t = montar();
    await expect(t.chamar("previa_editar", { edicao: { tipo: "fonte", papel: "titulo", nome: "Fonte Inventada" } })).rejects.toMatchObject({ codigo: "fonte_fora_do_catalogo" });
    const outra = montar({ fotos: [{ id: FOTO, client_id: "99999999-9999-4999-8999-999999999999", storage_bucket: "cliente", storage_path: "c/x.jpg", nome: "Loja", descricao: null, tags: [], ativa: true }] });
    await expect(outra.chamar("previa_editar", { edicao: { tipo: "imagem", secao: "hero", slot: "hero", cliente_imagem_id: FOTO } })).rejects.toMatchObject({ codigo: "foto_inexistente" });
    expect(outra.site.imagens).toEqual([]);
  });
});

describe("a outra marca nunca herda", () => {
  it("site da marca secundária não usa foto sem etiqueta dela (a sem etiqueta é da principal)", async () => {
    const semEtiqueta = { id: FOTO, client_id: CLIENTE, storage_bucket: "cliente", storage_path: "c/x.jpg", nome: "Loja", descricao: "Fachada", tags: [], ativa: true };
    const secundaria = montar({ fotos: [semEtiqueta], marca: { id: "m2", nome: "CME", principal: false } });
    await expect(secundaria.chamar("previa_editar", { edicao: { tipo: "imagem", secao: "hero", slot: "hero", cliente_imagem_id: FOTO } })).rejects.toMatchObject({ codigo: "foto_inexistente" });
    const principal = montar({ fotos: [semEtiqueta], marca: { id: "m1", nome: "Acerbi", principal: true } });
    const r = await principal.chamar("previa_editar", { edicao: { tipo: "imagem", secao: "hero", slot: "hero", cliente_imagem_id: FOTO } });
    expect(r.modo).toBe("direto");
    expect(principal.site.imagens).toEqual([expect.objectContaining({ origem: "real", bucket: "cliente", path: "c/x.jpg", alt: "Fachada", secao: "hero", slot: "hero", escolhida: true })]);
  });
});

describe("previa_editar (código)", () => {
  it("sem Confirmar devolve o custo e não grava nada; com Confirmar vira 'ajustar' com o teto e fica no histórico", async () => {
    const t = montar();
    const orcado = await t.chamar("previa_editar", { edicao: { tipo: "texto_livre", secao: "bento", antes: "Veja", valor: "Conheça" } });
    expect(orcado).toMatchObject({ modo: "ajuste", precisa_confirmar: true, secao: "bento" });
    expect(orcado.estimativa_usd).toBeGreaterThan(0);
    expect(orcado.teto_sugerido_usd).toBeGreaterThanOrEqual(orcado.estimativa_usd);
    expect(t.pedidos).toEqual([]);
    expect(t.banco.tabelas.site_edicoes).toEqual([]);
    const feito = await t.chamar("previa_editar", { edicao: { tipo: "texto_livre", secao: "bento", antes: "Veja", valor: "Conheça" }, confirmar: true, teto_usd: 0.8, instrucao: "Na seção bento, troque Veja por Conheça." });
    expect(feito).toMatchObject({ modo: "ajuste", trabalho: { id: "t-1", tipo: "ajustar" } });
    expect(t.pedidos[0]).toEqual({ tipo: "ajustar", secao: "bento", instrucao: "Na seção bento, troque Veja por Conheça.", teto_usd: 0.8 });
    expect(t.banco.tabelas.site_edicoes[0]).toMatchObject({ modo: "ajuste", trabalho_id: "t-1", alvos: [] });
  });

  it("o Desfazer de um ajuste na fila para o trabalho", async () => {
    const t = montar({ trabalhos: [{ id: "77777777-7777-4777-8777-777777777777", client_id: CLIENTE, referencia_id: SITE, tipo: "ajustar", estado: "na_fila", projeto: "landing-33333333", custo_usd: 0, teto_usd: 0.5, resultado: {} }] });
    t.banco.tabelas.site_edicoes.push({ id: "88888888-8888-4888-8888-888888888888", site_id: SITE, client_id: CLIENTE, tipo: "pedido", modo: "ajuste", resumo: "Pedido", alvos: [], trabalho_id: "77777777-7777-4777-8777-777777777777", desfeita_em: null });
    const r = await t.chamar("previa_desfazer", { edicao_id: "88888888-8888-4888-8888-888888888888" });
    expect(r.resumo).toBe("Ajuste cancelado antes de começar");
    expect(t.ctx.pararTrabalhoDoSite).toHaveBeenCalled();
  });
});

describe("previa_edicoes", () => {
  it("lista sem os alvos (o antes e o depois ficam no servidor)", async () => {
    const t = montar();
    await t.chamar("previa_editar", { edicao: { tipo: "texto", campo: "headline", valor: "Outro" } });
    const r = await t.chamar("previa_edicoes", {});
    expect(r.edicoes.length).toBe(1);
    expect(r.edicoes[0].alvos).toBeUndefined();
    expect(r.edicoes[0].resumo).toMatch(/Outro/);
  });
});
