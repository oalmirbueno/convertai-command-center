/**
 * Frente VGN (30/09/2026): a coleta dos pedidos de vídeo, rodando a função de
 * verdade (geracao.ts) com o banco e a rede simulados. Nada sai para o fal nem
 * para o Supabase; nenhum crédito é gasto.
 *
 * Reproduz o caso real de 28/09: o fal aceitou o pedido, ninguém consultou de
 * novo e o prazo encerrou SEM perguntar ao provedor. Agora:
 *   1) passou do prazo, mas o provedor terminou: cobra uma vez, guarda o vídeo
 *      no acervo do cliente (Storage em partes + video_arquivos) e fica pronto;
 *   2) passou do prazo e o provedor ainda está gerando: segue com aviso até o teto
 *      de 24 h (frente MTR) e só no teto vira erro, depois da última pergunta, com "Recuperar";
 *   3) recuperar o pedido vencido pergunta de novo e guarda o que ficou pronto.
 *
 * Depois da revisão (01/10): o banco falso imita o Postgres no que importa:
 *   - criado_por é uuid (texto vazio vira 22P02, como no banco de verdade);
 *   - storage_path é único em video_arquivos (23505);
 *   - a trava (update ... or(consultado_em...)) só passa quando a condição vale.
 * E duas coletas sobre o mesmo pedido (tela + cron, ou cron sobreposto) cobram uma vez só.
 *
 *   deno test --allow-env --allow-read --allow-net=deno.land,jsr.io,registry.npmjs.org supabase/functions/mesa-videos/coleta_test.ts
 */
import { gerarColetar, gerarReconferir, gerarRecuperar, type BaseDaFuncao } from "./geracao.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.env.set("FAL_KEY", "chave-falsa-do-teste");
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-de-servico-falsa");

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const PEDIDO = "ba6b4c81-9c67-437f-b0d6-f435b0f0848b";
const STATUS = "https://queue.fal.run/bytedance/seedance-2.5/requests/req-1/status";
const RESPOSTA = "https://queue.fal.run/bytedance/seedance-2.5/requests/req-1";

type Linha = Record<string, unknown>;

function pedidoDeVideo(minutosAtras: number, estado = "enviado", erro: string | null = null): Linha {
  const enviado = new Date(Date.now() - minutosAtras * 60_000).toISOString();
  return {
    id: PEDIDO,
    client_id: CLIENTE,
    tipo: "gerar_livre",
    alvo: { motor: "seedance-2.5", modo: "texto", titulo: "Vitrine de manhã" },
    parametros: { prompt: "shop window at morning", duracao_s: 5, resolucao: "720p", quadro_inicial_path: null },
    custo_estimado: { usd: 2.365, por_variacao: 2.365, motor: "seedance-2.5" },
    executor: "seedance-2.5",
    estado,
    criado_por: "7f0c2b8e-1111-4111-8111-111111111111",
    consultado_em: null,
    resultado: { envios: [{ n: 1, request_id: "req-1", status_url: STATUS, response_url: RESPOSTA, endpoint: "bytedance/seedance-2.5/text-to-video", estado: estado === "erro" ? "erro" : "enviado", enviado_em: enviado, consultado_em: null, posicao: null, erro, arquivo_id: null, storage_path: null, uso_id: null, custo_usd: null }] },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Avalia um filtro "or" do PostgREST como a trava usa: "campo.is.null,campo.lt.<ISO>". */
function condicaoOr(linha: Linha, filtro: string): boolean {
  return filtro.split(",").some((parte) => {
    const i = parte.indexOf(".");
    const j = parte.indexOf(".", i + 1);
    const campo = parte.slice(0, i);
    const op = parte.slice(i + 1, j);
    const valor = parte.slice(j + 1);
    const atual = linha[campo];
    if (op === "is" && valor === "null") return atual === null || atual === undefined;
    if (op === "lt") return atual !== null && atual !== undefined && Date.parse(String(atual)) < Date.parse(valor);
    throw new Error(`filtro or sem suporte no teste: ${parte}`);
  });
}

/** Banco falso: guarda o pedido, registra o que foi escrito e recusa o que o Postgres recusaria. */
function bancoFalso(pedido: Linha) {
  const escritas: { tabela: string; op: string; valor: unknown }[] = [];
  const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
  const arquivos: Linha[] = [];
  const estado = { pedido: structuredClone(pedido) };
  const from = (tabela: string) => {
    const ops: { op: string; args: unknown[] }[] = [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "order", "limit", "eq", "or", "is", "neq"]) b[m] = (...args: unknown[]) => (ops.push({ op: m, args }), b);
    b.update = (v: Linha) => (ops.push({ op: "update", args: [v] }), b);
    b.insert = (v: Linha) => (ops.push({ op: "insert", args: [v] }), b);
    const resolver = (unico: boolean) => {
      const upd = ops.find((o) => o.op === "update");
      const ins = ops.find((o) => o.op === "insert");
      if (tabela === "video_motores") return { data: null, error: { message: "sem a tabela no teste" } };
      if (tabela === "video_pedidos" && upd) {
        const v = upd.args[0] as Linha;
        // A trava: update condicional que só passa se a condição vale (no banco é atômico; aqui, síncrono).
        const filtro = ops.find((o) => o.op === "or");
        if (filtro && !condicaoOr(estado.pedido, String(filtro.args[0]))) return { data: null, error: null };
        escritas.push({ tabela, op: "update", valor: structuredClone(v) });
        // Como no banco: o que é gravado e o que é lido são cópias (nada de objeto compartilhado com a função).
        estado.pedido = { ...estado.pedido, ...structuredClone(v) };
        return { data: unico ? structuredClone(estado.pedido) : [structuredClone(estado.pedido)], error: null };
      }
      if (tabela === "video_pedidos") return { data: unico ? structuredClone(estado.pedido) : [structuredClone(estado.pedido)], error: null };
      if (tabela === "video_arquivos" && ins) {
        const v = ins.args[0] as Linha;
        // criado_por é uuid no banco: "" (ou qualquer texto que não seja UUID) é recusado.
        if (v.criado_por !== null && v.criado_por !== undefined && !UUID.test(String(v.criado_por))) {
          return { data: null, error: { code: "22P02", message: `invalid input syntax for type uuid: "${String(v.criado_por)}"` } };
        }
        if (arquivos.some((a) => a.storage_bucket === v.storage_bucket && a.storage_path === v.storage_path)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        escritas.push({ tabela, op: "insert", valor: v });
        const linha = { id: `arquivo-novo-${arquivos.length + 1}`, ...v };
        arquivos.push(linha);
        return { data: linha, error: null };
      }
      if (tabela === "video_arquivos") {
        const eq = ops.filter((o) => o.op === "eq").map((o) => o.args as [string, unknown]);
        const achado = arquivos.find((a) => eq.every(([k, x]) => a[k] === x)) || null;
        return { data: unico ? achado : achado ? [achado] : [], error: null };
      }
      return { data: null, error: null };
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
      return Promise.resolve({ data: [{ uso_id: "uso-1" }], error: null });
    },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://proj.supabase.co/assinada" }, error: null }) }) },
  };
  return { db, escritas, rpcs, estado, arquivos };
}

function base(db: unknown): BaseDaFuncao {
  return {
    servico: () => db as never,
    garantirAcesso: async () => {},
    erro: (status, codigo, mensagem) => Object.assign(new Error(mensagem), { status, codigo }),
    json: (corpo, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } }),
    auditar: async () => {},
    userId: "",
    admin: true,
  };
}

/** Rede falsa: fal (status e resultado), o arquivo do provedor e o Storage em partes (TUS). */
function redeFalsa(situacao: "COMPLETED" | "IN_PROGRESS", arquivoQuebrado = false, aoBaixar?: () => Promise<void>) {
  const chamadas: string[] = [];
  let baixou = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const metodo = String((init && init.method) || "GET");
    chamadas.push(`${metodo} ${u}`);
    const h = new Headers(init && init.headers);
    if (u === STATUS) {
      assert(h.get("Authorization") === "Key chave-falsa-do-teste", "a chave vai só ao fal, no cabeçalho");
      return new Response(JSON.stringify({ status: situacao }), { status: situacao === "COMPLETED" ? 200 : 202 });
    }
    if (u === RESPOSTA) return new Response(JSON.stringify({ video: { url: "https://v3b.fal.media/files/video-pronto.mp4" } }), { status: 200 });
    if (u === "https://v3b.fal.media/files/video-pronto.mp4" && aoBaixar && !baixou) {
      // No meio do download desta rodada, outra coleta tenta o mesmo pedido.
      baixou = true;
      await aoBaixar();
    }
    if (u === "https://v3b.fal.media/files/video-pronto.mp4" && arquivoQuebrado) return new Response("", { status: 500 });
    if (u === "https://v3b.fal.media/files/video-pronto.mp4") return new Response(new Uint8Array(4096).fill(1), { status: 200, headers: { "content-length": "4096", "content-type": "video/mp4" } });
    if (u.endsWith("/storage/v1/upload/resumable")) return new Response(null, { status: 201, headers: { Location: "/storage/v1/upload/resumable/xyz" } });
    if (u.indexOf("/storage/v1/upload/resumable/") >= 0) return new Response(null, { status: 204 });
    throw new Error(`rede inesperada no teste: ${metodo} ${u}`);
  }) as typeof fetch;
  return { chamadas, restaurar: () => (globalThis.fetch = original) };
}

Deno.test("coleta: passou do prazo mas o fal terminou: cobra uma vez e guarda no acervo", async () => {
  const banco = bancoFalso(pedidoDeVideo(45));
  const rede = redeFalsa("COMPLETED");
  try {
    const r = await gerarColetar(base(banco.db), { limite: 8 });
    const corpo = await r.json();
    assert(corpo.ok === true && corpo.conferidos === 1 && corpo.prontos === 1, `resumo ${JSON.stringify(corpo)}`);
    const envio = (banco.estado.pedido.resultado as { envios: Linha[] }).envios[0];
    assert(banco.estado.pedido.estado === "pronto", `estado ${String(banco.estado.pedido.estado)} ${String(envio.erro)}`);
    assert(envio.arquivo_id === "arquivo-novo-1" && envio.storage_path === `${CLIENTE}/video/gerados/${PEDIDO}-1.mp4`, "arquivo no acervo do cliente");
    assert(banco.rpcs.length === 1 && banco.rpcs[0].nome === "ia_registrar_uso", "cobrou uma vez");
    assert(banco.rpcs[0].args._custo_usd === 2.365 && banco.rpcs[0].args._criado_por === "7f0c2b8e-1111-4111-8111-111111111111", "valor confirmado e quem pediu (o cron não tem pessoa)");
    const arq = banco.escritas.find((e) => e.tabela === "video_arquivos");
    assert(arq && (arq.valor as Linha).tipo === "gerado" && (arq.valor as Linha).client_id === CLIENTE, "registro no acervo de vídeo");
    // O achado da revisão: o cron gravava criado_por "" (uuid) e o Postgres recusava; agora vai quem pediu.
    assert((arq!.valor as Linha).criado_por === "7f0c2b8e-1111-4111-8111-111111111111", `criado_por do arquivo ${String((arq!.valor as Linha).criado_por)}`);
    assert(banco.estado.pedido.consultado_em && Date.parse(String(banco.estado.pedido.consultado_em)) <= Date.now(), "a trava foi solta no fim");
    assert(rede.chamadas.some((c) => c.indexOf("PATCH https://proj.supabase.co/storage/v1/upload/resumable/xyz") === 0), "subiu em partes");
  } finally {
    rede.restaurar();
  }
});

Deno.test("coleta: passou do prazo e o fal ainda gera: segue gerando com aviso (teto da MTR), nada cobrado", async () => {
  const banco = bancoFalso(pedidoDeVideo(45));
  const rede = redeFalsa("IN_PROGRESS");
  try {
    const corpo = await (await gerarColetar(base(banco.db), {})).json();
    assert(corpo.erros === 0, `resumo ${JSON.stringify(corpo)}`);
    const envio = (banco.estado.pedido.resultado as { envios: Linha[] }).envios[0];
    assert(banco.estado.pedido.estado === "gerando" && envio.estado === "gerando", `estado ${String(banco.estado.pedido.estado)} ${String(envio.estado)}`);
    assert(/Passou do prazo de \d+ min e ainda gerando no provedor\. Seguimos conferindo por até 24 h/.test(String(envio.erro)), `aviso ${String(envio.erro)}`);
    assert(banco.rpcs.length === 0, "nada cobrado");
    assert(rede.chamadas.filter((c) => c === `GET ${STATUS}`).length === 1, "perguntou ao provedor uma vez");
  } finally {
    rede.restaurar();
  }
});

Deno.test("coleta: passou do teto de 24 h e o fal ainda gera: só então vira erro, depois da última pergunta, com Recuperar", async () => {
  const banco = bancoFalso(pedidoDeVideo(25 * 60));
  const rede = redeFalsa("IN_PROGRESS");
  try {
    const corpo = await (await gerarColetar(base(banco.db), {})).json();
    assert(corpo.erros === 1, `resumo ${JSON.stringify(corpo)}`);
    const envio = (banco.estado.pedido.resultado as { envios: Linha[] }).envios[0];
    assert(banco.estado.pedido.estado === "erro" && /Recuperar/.test(String(envio.erro)), `erro ${String(envio.erro)}`);
    assert(/O provedor pode ter cobrado/.test(String(envio.erro)) && !/Nada foi cobrado/.test(String(envio.erro)), `texto honesto ${String(envio.erro)}`);
    assert(banco.rpcs.length === 0, "nada cobrado aqui");
    assert(rede.chamadas.filter((c) => c === `GET ${STATUS}`).length === 1, "perguntou ao provedor uma vez antes de encerrar");
  } finally {
    rede.restaurar();
  }
});

Deno.test("recuperar e reconferir são a mesma ação: o que passou do teto é buscado de novo e guardado", async () => {
  const p = pedidoDeVideo(26 * 60, "erro", "Passou de 24 h sem terminar no provedor. O provedor pode ter cobrado; confira no painel dele (pedido req-1) e use Recuperar.");
  const banco = bancoFalso(p);
  const rede = redeFalsa("COMPLETED");
  try {
    const corpo = await (await gerarReconferir(base(banco.db), { pedido_id: PEDIDO })).json();
    assert(corpo.recuperando === 1 && corpo.reabertos === 1, `resposta ${JSON.stringify(corpo)}`);
    assert(banco.estado.pedido.estado === "pronto", `estado ${String(banco.estado.pedido.estado)}`);
    assert(banco.rpcs.length === 1, "cobra só o que veio pronto");
  } finally {
    rede.restaurar();
  }
});

Deno.test("coleta: dentro do prazo e gerando: continua gerando, sem cobrar", async () => {
  const banco = bancoFalso(pedidoDeVideo(2));
  const rede = redeFalsa("IN_PROGRESS");
  try {
    await gerarColetar(base(banco.db), {});
    assert(banco.estado.pedido.estado === "gerando", `estado ${String(banco.estado.pedido.estado)}`);
    assert(banco.rpcs.length === 0, "nada cobrado");
  } finally {
    rede.restaurar();
  }
});

Deno.test("recuperar: o pedido que venceu aqui (o caso de 28/09) é buscado de novo e guardado", async () => {
  const p = pedidoDeVideo(60 * 24, "erro", "Passou do prazo de 10 min sem terminar. Nada foi cobrado.");
  const enviadoOriginal = String((p.resultado as { envios: Linha[] }).envios[0].enviado_em);
  const banco = bancoFalso(p);
  const rede = redeFalsa("COMPLETED");
  try {
    const corpo = await (await gerarRecuperar(base(banco.db), { pedido_id: PEDIDO })).json();
    assert(corpo.recuperando === 1, `resposta ${JSON.stringify(corpo)}`);
    assert(banco.estado.pedido.estado === "pronto", `estado ${String(banco.estado.pedido.estado)}`);
    assert(banco.rpcs.length === 1, "cobra só o que veio pronto");
    const envio = (banco.estado.pedido.resultado as { envios: Linha[] }).envios[0];
    assert(envio.enviado_em === enviadoOriginal, "a hora real do envio não muda (os 7 dias contam dela)");
    assert(typeof envio.recuperado_em === "string" && envio.tentativas_de_baixar === 0, "prazo novo em recuperado_em e tentativas zeradas");
  } finally {
    rede.restaurar();
  }
});

Deno.test("recuperar: erro dito pelo provedor não volta (gerar de novo é outra decisão)", async () => {
  const banco = bancoFalso(pedidoDeVideo(30, "erro", "O provedor recusou os parâmetros: prompt"));
  const rede = redeFalsa("COMPLETED");
  try {
    let erro: (Error & { codigo?: string }) | null = null;
    try {
      await gerarRecuperar(base(banco.db), { pedido_id: PEDIDO });
    } catch (e) {
      erro = e as Error & { codigo?: string };
    }
    assert(erro && erro.codigo === "nada_a_recuperar", `esperava nada_a_recuperar, veio ${erro && erro.codigo}`);
    assert(rede.chamadas.length === 0, "nenhuma chamada ao provedor");
  } finally {
    rede.restaurar();
  }
});

Deno.test("coleta: arquivo pronto que não baixa vira erro na 5ª tentativa (nada de laço sem fim), sem cobrar de novo", async () => {
  const p = pedidoDeVideo(20, "baixando");
  const envio = (p.resultado as { envios: Linha[] }).envios[0];
  envio.estado = "baixando";
  envio.uso_id = "uso-ja-cobrado";
  envio.tentativas_de_baixar = 4;
  const banco = bancoFalso(p);
  const rede = redeFalsa("COMPLETED", true);
  try {
    await gerarColetar(base(banco.db), {});
    const depois = (banco.estado.pedido.resultado as { envios: Linha[] }).envios[0];
    assert(banco.estado.pedido.estado === "erro" && depois.tentativas_de_baixar === 5, `estado ${String(banco.estado.pedido.estado)} ${String(depois.tentativas_de_baixar)}`);
    assert(/5 tentativas/.test(String(depois.erro)), `erro ${String(depois.erro)}`);
    assert(banco.rpcs.length === 0, "não cobra de novo");
  } finally {
    rede.restaurar();
  }
});

Deno.test("recuperar: download que falhou 5 vezes volta a baixar do zero, sem cobrar de novo", async () => {
  const p = pedidoDeVideo(30, "erro", null);
  const envio = (p.resultado as { envios: Linha[] }).envios[0];
  envio.estado = "erro";
  envio.uso_id = "uso-ja-cobrado";
  envio.tentativas_de_baixar = 5;
  envio.erro = "O provedor terminou, mas o arquivo não foi guardado depois de 5 tentativas (500). O uso já foi registrado: use Recuperar para baixar de novo sem cobrar outra vez.";
  const banco = bancoFalso(p);
  const rede = redeFalsa("COMPLETED");
  try {
    await gerarRecuperar(base(banco.db), { pedido_id: PEDIDO });
    const depois = (banco.estado.pedido.resultado as { envios: Linha[] }).envios[0];
    assert(banco.estado.pedido.estado === "pronto" && depois.arquivo_id === "arquivo-novo-1", `estado ${String(banco.estado.pedido.estado)} ${String(depois.erro)}`);
    assert(banco.rpcs.length === 0, "o uso já estava registrado: não cobra de novo");
  } finally {
    rede.restaurar();
  }
});

Deno.test("recuperar: com a coleta trabalhando no pedido agora, recusa (não pisa na rodada em curso)", async () => {
  const p = pedidoDeVideo(60, "erro", "Passou do prazo de 10 min sem terminar. Nada foi cobrado.");
  p.consultado_em = new Date(Date.now() + 120_000).toISOString();
  const banco = bancoFalso(p);
  const rede = redeFalsa("COMPLETED");
  try {
    let erro: (Error & { codigo?: string }) | null = null;
    try {
      await gerarRecuperar(base(banco.db), { pedido_id: PEDIDO });
    } catch (e) {
      erro = e as Error & { codigo?: string };
    }
    assert(erro && erro.codigo === "pedido_em_conferencia", `esperava pedido_em_conferencia, veio ${erro && erro.codigo}`);
    assert(rede.chamadas.length === 0 && banco.rpcs.length === 0, "nada consultado nem cobrado");
  } finally {
    rede.restaurar();
  }
});

/** Relógio adiantado só dentro de `f` (Date.now é o que a trava usa). */
async function comRelogioAdiantado<T>(ms: number, f: () => Promise<T>): Promise<T> {
  const real = Date.now;
  Date.now = () => real() + ms;
  try {
    return await f();
  } finally {
    Date.now = real;
  }
}

Deno.test("corrida: outra coleta 20 s depois, no meio do download, não entra nem cobra de novo", async () => {
  // O cenário da revisão: a tela consulta em t=0, o fal diz pronto, ela cobra e baixa (1080p/4K
  // passa de 15 s); em t=20 s o cron chega. Com a trava antiga (15 s), ele entrava com a linha
  // velha (uso_id nulo) e cobrava de novo.
  const banco = bancoFalso(pedidoDeVideo(3));
  let segunda: Record<string, unknown> | null = null;
  const rede = redeFalsa("COMPLETED", false, async () => {
    segunda = await comRelogioAdiantado(20_000, async () => (await gerarColetar(base(banco.db), {})).json());
  });
  try {
    const primeira = await (await gerarColetar(base(banco.db), {})).json();
    assert(primeira.prontos === 1, `primeira ${JSON.stringify(primeira)}`);
    assert(segunda && (segunda as { prontos: number }).prontos === 0, `segunda ${JSON.stringify(segunda)}`);
    assert(banco.rpcs.length === 1, `cobrou ${banco.rpcs.length} vezes`);
    assert(banco.arquivos.length === 1, `arquivos ${banco.arquivos.length}`);
    assert(banco.estado.pedido.estado === "pronto", `estado ${String(banco.estado.pedido.estado)}`);
  } finally {
    rede.restaurar();
  }
});

Deno.test("corrida: a rodada morreu baixando e a trava venceu: a próxima guarda o vídeo sem cobrar de novo", async () => {
  // A cobrança é gravada no pedido ANTES do download: quem entra depois vê o uso_id.
  const banco = bancoFalso(pedidoDeVideo(3));
  const rede = redeFalsa("COMPLETED", false, async () => {
    await comRelogioAdiantado(200_000, async () => (await gerarColetar(base(banco.db), {})).json());
  });
  try {
    await gerarColetar(base(banco.db), {});
    assert(banco.rpcs.length === 1, `cobrou ${banco.rpcs.length} vezes`);
    assert(banco.arquivos.length === 1, `o mesmo arquivo não é registrado duas vezes (${banco.arquivos.length})`);
    const envio = (banco.estado.pedido.resultado as { envios: Linha[] }).envios[0];
    assert(banco.estado.pedido.estado === "pronto" && envio.arquivo_id === "arquivo-novo-1" && envio.uso_id === "uso-1", `estado ${String(banco.estado.pedido.estado)} ${JSON.stringify(envio)}`);
  } finally {
    rede.restaurar();
  }
});
