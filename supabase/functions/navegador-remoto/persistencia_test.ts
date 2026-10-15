/**
 * Contrato real do motor com banco, CDP e HTTP falsos. Não abre sessão externa.
 * deno test supabase/functions/navegador-remoto/persistencia_test.ts
 */
import { Cdp, ErroDoNavegador, usarNavegador, type PedidoAoNavegador } from "../_shared/navegador-operacional.ts";
import { provedorBrowserbase, type Provedor } from "./provedor.ts";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SESSAO = "11111111-1111-4111-8111-111111111111";
const linha = () => ({ id: SESSAO, client_id: CLIENTE, contexto_id: "ctx", sessao_externa: "browser-1", estado: "aberta", comandada_por: null, trava_ate: null });
type Linha = ReturnType<typeof linha>;
type Escrita = { tabela: string; operacao: string; valor: Record<string, unknown> };

function igual(atual: unknown, esperado: unknown, mensagem = "valor diferente") {
  if (JSON.stringify(atual) !== JSON.stringify(esperado)) throw new Error(`${mensagem}: ${JSON.stringify(atual)} != ${JSON.stringify(esperado)}`);
}

async function erro(p: Promise<unknown>, codigo: string) {
  try { await p; } catch (e) {
    if (e instanceof ErroDoNavegador && e.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Esperava erro ${codigo}`);
}

function bancoFalso(sessao: Linha | null = linha()) {
  const escritas: Escrita[] = [];
  const from = (tabela: string) => {
    let operacao = "select";
    let valor: Record<string, unknown> = {};
    const filtros = new Map<string, unknown>();
    const executar = () => {
      if (operacao !== "select") escritas.push({ tabela, operacao, valor });
      if (operacao === "insert") {
        if (tabela === "navegador_acoes") return { data: { id: "acao-1" }, error: null };
        if (tabela === "navegador_sessoes") return { data: { ...linha(), ...valor }, error: null };
      }
      if (operacao === "update") return { data: [{ id: SESSAO }], error: null };
      if (tabela === "navegador_sessoes") {
        const condiz = sessao && [...filtros].every(([k, v]) => (sessao as Record<string, unknown>)[k] === v);
        return { data: condiz ? sessao : null, error: null };
      }
      if (tabela === "profiles") return { data: { id: CLIENTE }, error: null };
      if (tabela === "navegador_contextos") return { data: { id: "ctx", contexto_externo: "profile-1" }, error: null };
      throw new Error(`Consulta inesperada a ${tabela}`);
    };
    const q = {
      select: (..._args: unknown[]) => q,
      eq: (k: string, v: unknown) => { filtros.set(k, v); return q; },
      order: (..._args: unknown[]) => q,
      limit: (..._args: unknown[]) => q,
      or: (..._args: unknown[]) => q,
      update: (v: Record<string, unknown>) => { operacao = "update"; valor = v; return q; },
      insert: (v: Record<string, unknown>) => { operacao = "insert"; valor = v; return q; },
      maybeSingle: async () => executar(),
      single: async () => executar(),
      then: (resolve: (v: ReturnType<typeof executar>) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(executar()).then(resolve, reject),
    };
    return q;
  };
  return { db: { from } as never, escritas };
}

function provedorFalso(ver: Provedor["verSessao"] = async () => ({ rodando: true, ao_vivo: "https://view", paginas: [] })) {
  const chamadas: string[] = [];
  const p: Provedor = {
    verSessao: ver,
    criarContexto: async () => { chamadas.push("criarContexto"); return "profile-1"; },
    criarSessao: async () => { chamadas.push("criarSessao"); return "browser-1"; },
    conectar: async () => { chamadas.push("conectar"); return "wss://falso"; },
    encerrar: async () => { chamadas.push("encerrar"); },
    conta: async () => ({ projetos: [] }),
  };
  return { p, chamadas };
}

type Target = { targetId: string; type: string; title: string; url: string };
const target = (id: string, url = "https://mesmo.site/"): Target => ({ targetId: id, type: "page", title: id, url });

async function comCdp<T>(targets: Target[], fazer: (comandos: Array<{ metodo: string; parametros: Record<string, unknown> }>) => Promise<T>): Promise<T> {
  const abrirOriginal = Cdp.abrir;
  const comandos: Array<{ metodo: string; parametros: Record<string, unknown> }> = [];
  Cdp.abrir = async () => ({
    enviar: async (metodo: string, parametros: Record<string, unknown> = {}) => {
      comandos.push({ metodo, parametros });
      if (metodo === "Target.getTargets") return { targetInfos: targets };
      if (metodo === "Target.createTarget") {
        targets.unshift(target("criada", String(parametros.url)));
        return { targetId: "criada" };
      }
      if (metodo === "Target.attachToTarget") return { sessionId: "cdp-1" };
      if (metodo === "Runtime.evaluate") return { result: { value: { url: "https://novo.site/", titulo: "Nova", texto: "Página", links: [] } } };
      return {};
    },
    fechar() { comandos.push({ metodo: "fechar", parametros: {} }); },
  } as unknown as Cdp);
  try { return await fazer(comandos); } finally { Cdp.abrir = abrirOriginal; }
}

const pedido = (outros: Partial<PedidoAoNavegador> = {}): PedidoAoNavegador => ({ clientId: CLIENTE, agente: "equipe", acao: "ativar_aba", sessaoId: SESSAO, abaId: "alvo", ...outros });

Deno.test("Browserbase preserva ID das páginas quando URL, ordem e token de visualização mudam", async () => {
  let consulta = 0;
  const p = provedorBrowserbase("falsa", null, (async (url: string | URL | Request) => {
    if (!String(url).endsWith("/debug")) return Response.json({ status: "RUNNING" });
    consulta++;
    const pages = [
      { id: "primeira", title: "A", url: `https://site/a${consulta}`, debuggerFullscreenUrl: `https://view/a${consulta}` },
      { id: "segunda", title: "B", url: "https://site/b", debuggerFullscreenUrl: `https://view/b${consulta}` },
    ];
    return Response.json({ debuggerFullscreenUrl: "https://view", pages: consulta === 1 ? pages : pages.reverse() });
  }) as typeof fetch);
  const antes = await p.verSessao("browser-1");
  const depois = await p.verSessao("browser-1");
  igual(antes.paginas.map((x) => x.id), ["primeira", "segunda"]);
  igual(depois.paginas.map((x) => x.id), ["segunda", "primeira"]);
  igual(depois.paginas[1].url, "https://site/a2");
});

Deno.test("ativar por ID ignora índice desatualizado e distingue abas com URL repetida", async () => {
  const { db } = bancoFalso();
  const { p, chamadas } = provedorFalso();
  await comCdp([target("outra"), target("alvo")], async (comandos) => {
    const r = await usarNavegador(db, p, pedido({ aba: 0 }));
    igual(comandos.find((x) => x.metodo === "Target.activateTarget")?.parametros, { targetId: "alvo" });
    igual([r.sessao_id, r.aba_id], [SESSAO, "alvo"]);
    igual(r.abas?.map((x) => x.id), ["outra", "alvo"]);
    igual(chamadas, ["conectar"]);
  });
});

Deno.test("aba fechada é rejeitada sem ativar outra nem criar aba substituta", async () => {
  const { db, escritas } = bancoFalso();
  const { p } = provedorFalso();
  await comCdp([target("outra")], async (comandos) => {
    await erro(usarNavegador(db, p, pedido()), "aba_inexistente");
    igual(comandos.map((x) => x.metodo), ["Target.getTargets", "fechar"]);
    igual(escritas.some((x) => x.tabela === "navegador_acoes" && x.valor.ok === false), true);
  });
});

Deno.test("ativação sem identidade completa é recusada antes de abrir sessão", async () => {
  const { db, escritas } = bancoFalso(null);
  const { p, chamadas } = provedorFalso();
  await erro(usarNavegador(db, p, pedido({ sessaoId: null })), "aba_invalida");
  await erro(usarNavegador(db, p, pedido({ abaId: null })), "aba_invalida");
  await erro(usarNavegador(db, p, pedido({ acao: "ler", sessaoId: null })), "sessao_invalida");
  igual(chamadas, []);
  igual(escritas, []);
});

Deno.test("sessão ausente, substituída ou de outro cliente não abre navegador na nova aba", async () => {
  for (const sessao of [null, { ...linha(), id: "33333333-3333-4333-8333-333333333333" }, { ...linha(), client_id: "outro-cliente" }]) {
    const { db, escritas } = bancoFalso(sessao);
    const { p, chamadas } = provedorFalso();
    await erro(usarNavegador(db, p, pedido({ acao: "nova_aba", url: "https://novo.site/", abaId: null })), "sessao_mudou");
    igual(chamadas, []);
    igual(escritas, []);
  }
});

Deno.test("sessão expirada é marcada encerrada e exige reabertura explícita", async () => {
  const { db, escritas } = bancoFalso();
  const { p, chamadas } = provedorFalso(async () => ({ rodando: false, ao_vivo: null, paginas: [] }));
  await erro(usarNavegador(db, p, pedido({ acao: "nova_aba", url: "https://novo.site/", abaId: null })), "sessao_encerrada");
  igual(chamadas, []);
  igual(escritas.length, 1);
  igual(escritas[0].valor.estado, "encerrada");
});

Deno.test("falha transitória do provedor não encerra nem substitui a sessão", async () => {
  const { db, escritas } = bancoFalso();
  const falha = new Error("timeout falso");
  const { p, chamadas } = provedorFalso(async () => { throw falha; });
  const resultado = await usarNavegador(db, p, pedido()).catch((e) => e);
  igual(resultado === falha, true);
  igual(chamadas, []);
  igual(escritas, []);
});

Deno.test("nova aba devolve o target criado no mesmo navegador, independente da ordem", async () => {
  const { db } = bancoFalso();
  const { p, chamadas } = provedorFalso();
  await comCdp([target("antiga")], async (comandos) => {
    const r = await usarNavegador(db, p, pedido({ acao: "nova_aba", url: "https://novo.site/", abaId: null }));
    igual([r.sessao_id, r.aba_id], [SESSAO, "criada"]);
    igual(comandos.find((x) => x.metodo === "Target.attachToTarget")?.parametros.targetId, "criada");
    igual(chamadas, ["conectar"]);
  });
});

Deno.test("caller antigo continua escolhendo por índice e abrindo a primeira sessão", async () => {
  const { db } = bancoFalso(null);
  const { p, chamadas } = provedorFalso();
  await comCdp([target("primeira"), target("segunda")], async () => {
    const r = await usarNavegador(db, p, pedido({ acao: "abas", sessaoId: null, abaId: null, aba: 1 }));
    igual([r.sessao_id, r.aba_id], [SESSAO, "segunda"]);
    igual(chamadas, ["criarSessao", "conectar"]);
  });
});
