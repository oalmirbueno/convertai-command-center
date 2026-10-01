/**
 * Frente TCN (01/10/2026): a troca de cenário andando de verdade (cenario.ts)
 * com o banco, o Storage e a rede SIMULADOS. Nada sai para o fal, a Runway ou
 * o Supabase; nenhum crédito é gasto (a FAL_KEY desta máquina não existe: é a
 * "prova com fetch falso" do pedido).
 *
 *   1) Rápido: o worker preparou o trecho -> envia o recorte ao fal (fila) ->
 *      o fal termina -> cobra UMA vez, guarda o recorte em partes (TUS) ->
 *      pede a composição ao worker -> o worker registra a final -> pronto.
 *   2) Cinema: o Kling O3 Edit recebe o trecho e a amostra escolhida como @Image1.
 *   3) O fal recusa o envio: a troca vira erro com o motivo e nada é cobrado.
 *   4) O worker não preparou o trecho: erro, sem nada no provedor.
 *
 *   deno test --allow-env --allow-read --allow-net=deno.land,jsr.io,registry.npmjs.org supabase/functions/mesa-videos/cenario_test.ts
 */
import { cenariosColetar } from "./cenario.ts";
import type { BaseDaFuncao } from "./geracao.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.env.set("FAL_KEY", "chave-falsa-do-teste");
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-de-servico-falsa");

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const TROCA = "5c1f0a52-7d3e-4c1a-9b2e-0f4d8e6a1b23";
const QUEM = "7f0c2b8e-1111-4111-8111-111111111111";
type Linha = Record<string, unknown>;

function troca(qualidade: string, layout = "cheio"): Linha {
  return {
    id: TROCA,
    client_id: CLIENTE,
    versao_id: null,
    fonte_path: `${CLIENTE}/video/brutos/fala.mp4`,
    clipe_ref: "clipe-1",
    entrada_s: 2,
    saida_s: 10,
    cenario: "loja reformada com luz quente",
    galeria: "loja",
    qualidade,
    layout,
    formato: "9:16",
    estado: "preparando",
    amostras: [
      { n: 1, path: `${CLIENTE}/video/cenarios/${TROCA}/amostra-1.png`, custo_usd: 0.015, uso_id: "u-a1" },
      { n: 2, path: `${CLIENTE}/video/cenarios/${TROCA}/amostra-2.png`, custo_usd: 0.015, uso_id: "u-a2" },
    ],
    escolha: 2,
    passos: { chave_final: "final:clique1", preparo: { render_id: "render-preparo" }, envios: [], placa: qualidade === "rapido" ? { path: `${CLIENTE}/video/cenarios/${TROCA}/placa.png`, custo_usd: 0.045, uso_id: "u-p" } : null },
    custo_usd: 0.075,
    resultado_arquivo_id: null,
    erro: null,
    consultado_em: null,
    criado_por: QUEM,
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  };
}

function condicaoOr(linha: Linha, filtro: string): boolean {
  return filtro.split(",").some((parte) => {
    const [campo, op, ...resto] = parte.split(".");
    const valor = resto.join(".");
    const atual = linha[campo];
    if (op === "is" && valor === "null") return atual === null || atual === undefined;
    if (op === "lt") return atual !== null && atual !== undefined && Date.parse(String(atual)) < Date.parse(valor);
    throw new Error(`or sem suporte: ${parte}`);
  });
}

/** Banco falso com as tabelas que a troca toca. */
function bancoFalso(t: Linha, renders: Record<string, Linha>) {
  const tabelas: Record<string, Linha[]> = { video_cenarios: [structuredClone(t)], render_pedidos: Object.keys(renders).map((id) => ({ id, ...renders[id] })) };
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  const from = (tabela: string) => {
    const ops: { op: string; args: unknown[] }[] = [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "or", "order", "limit"]) b[m] = (...args: unknown[]) => (ops.push({ op: m, args }), b);
    b.update = (v: Linha) => (ops.push({ op: "update", args: [v] }), b);
    b.insert = (v: Linha) => (ops.push({ op: "insert", args: [v] }), b);
    const casa = (l: Linha) =>
      ops.every((o) => {
        if (o.op === "eq") return l[o.args[0] as string] === o.args[1];
        if (o.op === "neq") return l[o.args[0] as string] !== o.args[1];
        if (o.op === "in") return (o.args[1] as unknown[]).indexOf(l[o.args[0] as string]) >= 0;
        if (o.op === "is") return (l[o.args[0] as string] ?? null) === o.args[1];
        if (o.op === "or") return condicaoOr(l, String(o.args[0]));
        return true;
      });
    const resolver = (unico: boolean) => {
      const lista = tabelas[tabela] || (tabelas[tabela] = []);
      const ins = ops.find((o) => o.op === "insert");
      if (ins) {
        const v = { id: `${tabela}-novo-${lista.length + 1}`, estado: "fila", ...structuredClone(ins.args[0] as Linha) };
        lista.push(v);
        return { data: structuredClone(v), error: null };
      }
      const achados = lista.filter(casa);
      const upd = ops.find((o) => o.op === "update");
      if (upd) achados.forEach((l) => Object.assign(l, structuredClone(upd.args[0] as Linha)));
      const saida = structuredClone(achados);
      return { data: unico ? saida[0] || null : saida, error: null };
    };
    b.maybeSingle = () => Promise.resolve(resolver(true));
    b.single = () => Promise.resolve(resolver(true));
    b.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(resolver(false)).then(ok, falha);
    return b;
  };
  const db = {
    from,
    rpc: (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      return Promise.resolve({ data: [{ uso_id: `uso-${rpcs.length}` }], error: null });
    },
    storage: { from: () => ({ createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://proj.supabase.co/assinada/${p}` })), error: null }) }) },
  };
  return { db, tabelas, rpcs, troca: () => tabelas.video_cenarios[0] };
}

function base(db: unknown): BaseDaFuncao {
  return {
    servico: () => db as never,
    garantirAcesso: async () => {},
    erro: (status, codigo, mensagem) => Object.assign(new Error(mensagem), { status, codigo }),
    json: (corpo, status = 200) => new Response(JSON.stringify(corpo), { status }),
    auditar: async () => {},
    userId: "",
    admin: true,
  };
}

/** Rede falsa: fila do fal (enviar, status, resultado), o arquivo pronto e o Storage em partes. */
function redeFalsa(o: { recusar?: boolean } = {}) {
  const chamadas: { metodo: string; url: string; corpo: Record<string, unknown> | null; chave: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const metodo = String((init && init.method) || "GET");
    const h = new Headers(init && init.headers);
    let corpo: Record<string, unknown> | null = null;
    if (init && typeof init.body === "string") corpo = JSON.parse(init.body);
    chamadas.push({ metodo, url: u, corpo, chave: h.get("Authorization") });
    if (metodo === "POST" && u.indexOf("https://queue.fal.run/") === 0) {
      if (o.recusar) return new Response(JSON.stringify({ detail: [{ loc: ["body", "video_url"], msg: "video too short" }] }), { status: 422 });
      const ep = u.slice("https://queue.fal.run/".length);
      return new Response(JSON.stringify({ request_id: "req-1", status_url: `https://queue.fal.run/${ep}/requests/req-1/status`, response_url: `https://queue.fal.run/${ep}/requests/req-1` }), { status: 200 });
    }
    if (u.endsWith("/requests/req-1/status")) return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
    if (u.endsWith("/requests/req-1")) return new Response(JSON.stringify({ video: { url: "https://v3b.fal.media/files/pronto.webm" } }), { status: 200 });
    if (u === "https://v3b.fal.media/files/pronto.webm") return new Response(new Uint8Array(2048).fill(7), { status: 200, headers: { "content-length": "2048", "content-type": "video/webm" } });
    if (u.endsWith("/storage/v1/upload/resumable")) return new Response(null, { status: 201, headers: { Location: "/storage/v1/upload/resumable/xyz" } });
    if (u.indexOf("/storage/v1/upload/resumable/") >= 0) return new Response(null, { status: 204 });
    throw new Error(`rede inesperada no teste: ${metodo} ${u}`);
  }) as typeof fetch;
  return { chamadas, restaurar: () => (globalThis.fetch = original) };
}

const PREPARO_PRONTO = { estado: "pronto", erro_mensagem: null, saida_path: `${CLIENTE}/video/cenarios/${TROCA}/trecho.mp4`, arquivo_id: null, resultado: { duracao_s: 8, largura: 720, altura: 1280 } };
/** A próxima rodada pode consultar (o intervalo mínimo entre consultas é de 15 s). */
const envelhecer = (banco: ReturnType<typeof bancoFalso>) => {
  const t = banco.troca();
  t.consultado_em = new Date(Date.now() - 60_000).toISOString();
  ((t.passos as Linha).envios as Linha[] || []).forEach((e) => (e.consultado_em = new Date(Date.now() - 60_000).toISOString()));
};

Deno.test("Rápido: preparo pronto -> recorte no fal -> cobra uma vez e guarda -> composição -> pronto", async () => {
  const banco = bancoFalso(troca("rapido"), { "render-preparo": PREPARO_PRONTO });
  const rede = redeFalsa();
  try {
    let r = await cenariosColetar(base(banco.db));
    let t = banco.troca();
    assert(r.conferidas === 1 && t.estado === "gerando", `rodada 1: ${JSON.stringify(r)} ${String(t.estado)} ${String(t.erro)}`);
    const envio = rede.chamadas.find((c) => c.metodo === "POST" && c.url.indexOf("queue.fal.run") >= 0)!;
    assert(envio.url === "https://queue.fal.run/bria/video/background-removal/v3", `endpoint ${envio.url}`);
    assert(envio.chave === "Key chave-falsa-do-teste", "a chave vai só ao fal, no cabeçalho");
    assert(envio.corpo!.background_color === "Transparent" && envio.corpo!.output_container_and_codec === "webm_vp9", "recorte com alfa");
    assert(String(envio.corpo!.video_url).indexOf(`/assinada/${CLIENTE}/video/cenarios/${TROCA}/trecho.mp4`) > 0, "o fal recebe o trecho preparado, por link assinado");
    assert(banco.rpcs.length === 0, "nada cobrado antes de ficar pronto");

    envelhecer(banco);
    r = await cenariosColetar(base(banco.db));
    t = banco.troca();
    const envios = (t.passos as Linha).envios as Linha[];
    assert(t.estado === "compondo", `rodada 2: ${String(t.estado)} ${String(t.erro)}`);
    assert(envios[0].estado === "pronto" && envios[0].storage_path === `${CLIENTE}/video/cenarios/${TROCA}/recorte.webm`, "recorte guardado na pasta da troca");
    assert(banco.rpcs.length === 1 && banco.rpcs[0].args._custo_usd === 0.4 && banco.rpcs[0].args._modelo_id === "video:bria-vrmbg-3", `cobrança ${JSON.stringify(banco.rpcs.map((x) => x.args._custo_usd))}`);
    assert(banco.rpcs[0].args._criado_por === QUEM && banco.rpcs[0].args._referencia_tipo === "video_cenario", "quem pediu e a referência da troca");
    assert(rede.chamadas.some((c) => c.metodo === "PATCH" && c.url.indexOf("/storage/v1/upload/resumable/xyz") > 0), "subiu em partes");
    const compor = banco.tabelas.render_pedidos.find((x) => ((x.entrada as Linha | undefined) || {}).fase === "compor")!;
    const e = compor.entrada as Linha;
    assert(compor.tipo === "cenario" && compor.cenario_id === TROCA, "pedido de composição ligado à troca");
    assert(e.recorte === envios[0].storage_path && e.placa === `${CLIENTE}/video/cenarios/${TROCA}/placa.png` && e.ia === null && e.original === PREPARO_PRONTO.saida_path, `entrada ${JSON.stringify(e)}`);
    assert(e.largura === 1080 && e.altura === 1920, "formato do projeto");

    // O worker terminou a composição e registrou a final.
    Object.assign(compor, { estado: "pronto", arquivo_id: "arquivo-final-1", saida_path: e.destino });
    envelhecer(banco);
    await cenariosColetar(base(banco.db));
    t = banco.troca();
    assert(t.estado === "pronto" && t.resultado_arquivo_id === "arquivo-final-1", `rodada 3: ${String(t.estado)} ${String(t.erro)}`);
    assert(Number(t.custo_usd) === 0.475, `custo registrado ${String(t.custo_usd)} (2 amostras + fundo + recorte)`);
    assert(/Troca de cenário \(Rápido/.test(String((t.passos as Linha).resumo)), "resumo para o documento de entrega");
    assert(banco.rpcs.length === 1, "não cobrou de novo");
  } finally {
    rede.restaurar();
  }
});

Deno.test("Cinema: o Kling O3 Edit recebe o trecho e a amostra escolhida como @Image1, mantendo o áudio", async () => {
  const banco = bancoFalso(troca("cinema", "duas_faixas"), { "render-preparo": PREPARO_PRONTO });
  const rede = redeFalsa();
  try {
    await cenariosColetar(base(banco.db));
    const envio = rede.chamadas.find((c) => c.metodo === "POST" && c.url.indexOf("queue.fal.run") >= 0)!;
    assert(envio.url === "https://queue.fal.run/fal-ai/kling-video/o3/standard/video-to-video/edit", `endpoint ${envio.url}`);
    const imgs = envio.corpo!.image_urls as string[];
    assert(imgs.length === 1 && imgs[0].indexOf("amostra-2.png") > 0, "a amostra escolhida (2) vai como referência");
    assert(/@Video1/.test(String(envio.corpo!.prompt)) && /@Image1/.test(String(envio.corpo!.prompt)) && envio.corpo!.keep_audio === true, "molde de troca estrita");
    envelhecer(banco);
    await cenariosColetar(base(banco.db));
    const t = banco.troca();
    assert(t.estado === "compondo", `${String(t.estado)} ${String(t.erro)}`);
    assert(banco.rpcs[0].args._custo_usd === 1.008, `Kling 0,126 x 8 s: ${String(banco.rpcs[0].args._custo_usd)}`);
    const e = banco.tabelas.render_pedidos.find((x) => ((x.entrada as Linha | undefined) || {}).fase === "compor")!.entrada as Linha;
    assert(e.ia === `${CLIENTE}/video/cenarios/${TROCA}/ia.mp4` && e.recorte === null && e.layout === "duas_faixas", `entrada ${JSON.stringify(e)}`);
  } finally {
    rede.restaurar();
  }
});

Deno.test("o fal recusa o envio: erro com o motivo, nada cobrado, nada refeito", async () => {
  const banco = bancoFalso(troca("rapido"), { "render-preparo": PREPARO_PRONTO });
  const rede = redeFalsa({ recusar: true });
  try {
    await cenariosColetar(base(banco.db));
    const t = banco.troca();
    assert(t.estado === "erro" && /não aceitou o pedido/.test(String(t.erro)) && /Nada foi cobrado/.test(String(t.erro)), `erro ${String(t.erro)}`);
    assert(banco.rpcs.length === 0, "nada cobrado");
    envelhecer(banco);
    await cenariosColetar(base(banco.db));
    assert(rede.chamadas.filter((c) => c.metodo === "POST").length === 1, "não tentou de novo sozinho");
  } finally {
    rede.restaurar();
  }
});

Deno.test("o worker não preparou o trecho: erro, nada no provedor", async () => {
  const banco = bancoFalso(troca("aleph"), { "render-preparo": { estado: "cancelado", erro_mensagem: "O pedido ficou na fila mais de um dia (máquina desligada?). Peça de novo.", saida_path: null, arquivo_id: null, resultado: null } });
  const rede = redeFalsa();
  try {
    await cenariosColetar(base(banco.db));
    const t = banco.troca();
    assert(t.estado === "erro" && /máquina de render não preparou/.test(String(t.erro)) && /máquina desligada/.test(String(t.erro)), `erro ${String(t.erro)}`);
    assert(rede.chamadas.length === 0 && banco.rpcs.length === 0, "nada foi ao provedor nem cobrado");
  } finally {
    rede.restaurar();
  }
});
