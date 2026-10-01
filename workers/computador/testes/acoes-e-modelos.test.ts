/**
 * Frente CUS (01/10/2026): o navegador do agente com qualquer modelo de computer use (Anthropic ou OpenAI) e
 * as ações novas (conferir o site publicado, capturar referência, perfil público e concorrentes visuais),
 * num Chromium de verdade contra um servidor local. Os modelos são falsos (fetch falso para a OpenAI): a
 * prova real com a OpenAI fica atrás de `npm run prova-real -- --provedor openai`.
 *
 *   node --test testes/acoes-e-modelos.test.ts
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { abrirNavegador } from "../navegador.ts";
import { type Ambiente, casosDoWorker, motivoParaNaoRodar, pegarERodar, provedoresDoWorker, umaTarefa } from "../trabalho.ts";
import {
  acaoDaOpenAI,
  type ClienteDoModelo,
  clienteAnthropic,
  clienteOpenAI,
  corpoDaOpenAI,
  custoDoTurnoOpenAI,
  MODELOS_DO_COMPUTADOR,
  modeloConhecido,
  modeloDoCatalogo,
  type RespostaDaOpenAI,
  type RespostaDoModelo,
  semSegredo,
  sistemaDoCaso,
} from "../modelo.ts";
import type { Fila, ProvaDoPasso, RespostaDoPasso, TarefaDoNavegador, UsoDoModelo } from "../fila.ts";
import { argumentosDaProva } from "../prova-real.ts";

let servidor: http.Server;
let porta = 0;
const recebidos: Array<{ host: string; metodo: string; caminho: string }> = [];

const SITE = `<!doctype html><html><head><title>Cliente Publicado</title><meta name="theme-color" content="#0a7f5a"></head>
<body style="margin:0;background:#f4efe6;color:#1b1b1b;font-family:Georgia, serif">
  <header style="background:#0a7f5a;height:90px"><img alt="Logo do cliente" src="/logo.png" style="width:120px;height:40px;margin:20px"></header>
  <h1>Bem-vindo</h1>
  <p>Texto institucional com bastante conteúdo para ser lido como o corpo do site do cliente.</p>
  <a href="/sobre">Sobre</a> <a href="/quebrado">Página que sumiu</a> <a href="/sobre#time">Time</a>
  <a href="mailto:oi@cliente.com.br">E-mail</a> <a href="https://externo.com.br/">Parceiro</a>
  <button style="background:#d9480f;color:#ffffff;border-radius:12px">Pedir orçamento</button>
  <div style="height:1800px"></div>
</body></html>`;

const PERFIL_COM_LOGIN = `<!doctype html><html><head><title>@concorrente • Instagram</title>
<meta property="og:title" content="Concorrente (@concorrente)"><meta property="og:description" content="12 mil seguidores, 340 posts - Doces artesanais em Curitiba">
</head><body><h2>Entre para ver mais</h2><input type="password" name="senha"></body></html>`;

const PERFIL_ABERTO = `<!doctype html><html><head><title>Concorrente</title>
<meta property="og:title" content="Concorrente Doces"><meta property="og:description" content="Doces artesanais"></head>
<body><h1>Concorrente Doces</h1><p>Bio pública com o que a marca faz.</p></body></html>`;

const CONCORRENTE = `<!doctype html><html><head><title>Rival Doces</title></head>
<body style="margin:0;background:#ffffff;color:#3b0a45;font-family:Arial, sans-serif">
  <header style="background:#3b0a45;height:80px"><img class="logo" alt="Rival" src="/logo.png" style="width:100px;height:30px;margin:25px"></header>
  <h1>Rival Doces</h1><p>Doces finos com entrega em toda a cidade e um texto longo o bastante.</p></body></html>`;

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

before(async () => {
  servidor = http.createServer((req, res) => {
    const host = String(req.headers.host || "").split(":")[0];
    const caminho = String(req.url).split("?")[0];
    recebidos.push({ host, metodo: String(req.method), caminho });
    const html = (corpo: string, status = 200) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : corpo);
    };
    if (caminho === "/logo.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG_1X1);
      return;
    }
    if (host === "concorrente.com.br") return html(CONCORRENTE);
    if (caminho === "/") return html(SITE);
    if (caminho === "/sobre") return html("<html><body>Sobre</body></html>");
    if (caminho === "/perfil-fechado") return html(PERFIL_COM_LOGIN);
    if (caminho === "/perfil") return html(PERFIL_ABERTO);
    return html("<html><body>não achei</body></html>", 404);
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", () => ok()));
  porta = (servidor.address() as AddressInfo).port;
});

after(() => new Promise<void>((ok) => servidor.close(() => ok())));

function chromeDoTeste(): string | null {
  if (process.env.COMPUTADOR_CHROME) return process.env.COMPUTADOR_CHROME;
  const base = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : path.join(process.env.HOME || "", ".cache", "ms-playwright");
  if (!existsSync(base)) return null;
  const pastas = readdirSync(base).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const p of pastas) {
    for (const sub of ["chrome-headless-shell-win64", "chrome-headless-shell-linux64", "chrome-headless-shell-mac-arm64"]) {
      const exe = path.join(base, p, sub, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}
const CHROME = chromeDoTeste();
const regras = () => `MAP cliente.com.br 127.0.0.1:${porta},MAP concorrente.com.br 127.0.0.1:${porta},MAP externo.com.br 127.0.0.1:${porta}`;
const DNS: Record<string, string[]> = { "cliente.com.br": ["200.160.2.3"], "concorrente.com.br": ["200.160.2.6"], "externo.com.br": ["200.160.2.7"] };
const resolver = async (host: string) => DNS[host] || [];

function tarefa(m: Partial<TarefaDoNavegador> = {}): TarefaDoNavegador {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    client_id: "11111111-1111-4111-8111-111111111111",
    caso: "conferir_site",
    estado: "aprovada",
    url_inicial: "http://cliente.com.br/",
    dominios: ["cliente.com.br"],
    objetivo: null,
    origem: "mesa_site",
    teto_passos: 6,
    teto_custo_usd: 0,
    aprovado_por: "99999999-9999-4999-8999-999999999999",
    aprovado_em: new Date().toISOString(),
    criado_por: null,
    modelo_id: null,
    urls: [],
    ...m,
  };
}

/** Linhas do catálogo como a migration 20260930325000 deixa (preço do catálogo, recursos.computer_use). */
const CATALOGO: Record<string, Record<string, unknown>> = {
  "openai:gpt-6.1-sol": { id: "openai:gpt-6.1-sol", provedor: "openai", modelo_api: "gpt-6.1-sol", tipo: "texto", preco_entrada_1m: "2.00", preco_saida_1m: "10.00", preco_cache_1m: "0.10", disponivel: true, recursos: { computer_use: true } },
  "anthropic:claude-sonnet-5-5": { id: "anthropic:claude-sonnet-5-5", provedor: "anthropic", modelo_api: "claude-sonnet-5-5", tipo: "texto", preco_entrada_1m: "2.00", preco_saida_1m: "10.00", preco_cache_1m: "0.20", disponivel: true, recursos: { computer_use: true, cache_escrita_1m: 2.5 } },
  "openai:gpt-6-luna": { id: "openai:gpt-6-luna", provedor: "openai", modelo_api: "gpt-6-luna", tipo: "texto", preco_entrada_1m: "0.10", preco_saida_1m: "0.50", disponivel: true, recursos: { ferramentas: true } },
};

function filaFalsa(respostas: RespostaDoPasso[] = []) {
  const passos: Array<{ prova: ProvaDoPasso | null; custo: number }> = [];
  const conclusoes: Array<{ estado: string; resultado: Record<string, unknown>; motivo: string | null }> = [];
  const usos: UsoDoModelo[] = [];
  const pegadas: Array<{ casos: string[]; provedores?: string[] }> = [];
  const fila: Fila = {
    pegar: async (_t, _e, casos, _v, provedores) => (pegadas.push({ casos, provedores }), null),
    async passo(_id, _token, prova, custo) {
      passos.push({ prova, custo });
      return respostas[passos.length - 1] || "seguir";
    },
    async concluir(_id, _token, estado, resultado, motivo) {
      conclusoes.push({ estado, resultado, motivo });
      return true;
    },
    async registrarUso(u) {
      usos.push(u);
    },
    lerModelo: async (id) => (CATALOGO[id] as never) || null,
  };
  return { fila, passos, conclusoes, usos, pegadas };
}

function ambiente(fila: Fila, extra: Partial<Ambiente> = {}): Ambiente {
  return {
    fila,
    armazem: { guardar: async (c) => c },
    abrir: (op) => abrirNavegador({ ...op, regrasDeHost: regras(), executavel: CHROME, resolver }),
    comModelo: false,
    modelo: null,
    openai: null,
    executor: "teste",
    versao: "teste",
    ...extra,
  };
}

/** fetch falso da OpenAI: guarda cada corpo e devolve as respostas na ordem. */
function openaiFalsa(respostas: RespostaDaOpenAI[]) {
  const corpos: Array<Record<string, unknown>> = [];
  const cabecalhos: Array<Record<string, string>> = [];
  const buscar = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    cabecalhos.push(init.headers);
    corpos.push(JSON.parse(init.body));
    const r = respostas[corpos.length - 1];
    return new Response(JSON.stringify(r || { error: { message: "sem resposta" } }), { status: r ? 200 : 500, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { cliente: clienteOpenAI("sk-teste-0123456789abcdefghij", buscar), corpos, cabecalhos };
}

const TETO = { timeout: 120_000 };

describe("modelos do computer use (puros)", () => {
  it("OpenAI: o lote da Responses API vira as ações do toolset e passa pelas mesmas travas", () => {
    assert.deepEqual(acaoDaOpenAI({ type: "click", button: "left", x: 10, y: 20 }), { nome: "left_click", entrada: { coordinate: [10, 20] } });
    assert.deepEqual(acaoDaOpenAI({ type: "click", button: "right", x: 1, y: 2 }).nome, "right_click");
    assert.equal(acaoDaOpenAI({ type: "click", button: "left", x: 1, y: 2, keys: ["CTRL"] }).entrada.text, "CTRL", "clique com tecla presa: recusado pelo executor");
    assert.equal(acaoDaOpenAI({ type: "click", button: "back", x: 1, y: 2 }).nome, "click_back");
    assert.deepEqual(acaoDaOpenAI({ type: "keypress", keys: ["CTRL", "A"] }), { nome: "key", entrada: { text: "CTRL+A" } });
    assert.deepEqual(acaoDaOpenAI({ type: "keypress", keys: ["PAGEDOWN"] }), { nome: "key", entrada: { text: "PAGEDOWN" } });
    assert.deepEqual(acaoDaOpenAI({ type: "scroll", x: 600, y: 400, scroll_x: 0, scroll_y: 700 }), { nome: "scroll", entrada: { coordinate: [600, 400], scroll_x: 0, scroll_y: 700 } });
    assert.equal(acaoDaOpenAI({ type: "drag", path: [{ x: 1, y: 1 }, { x: 5, y: 5 }] }).nome, "left_click_drag");
    assert.equal(acaoDaOpenAI({ type: "type", text: "doces" }).entrada.text, "doces");
    assert.equal(acaoDaOpenAI({ type: "wait" }).nome, "wait");
  });

  it("corpo da OpenAI: ferramenta computer, esforço médio, truncation auto e o histórico pelo previous_response_id", () => {
    const m = MODELOS_DO_COMPUTADOR["gpt-6.1-sol"];
    const c = corpoDaOpenAI(m, "regras", [{ role: "user", content: [] }], null);
    assert.deepEqual(c.tools, [{ type: "computer" }]);
    assert.equal(c.model, "gpt-6.1-sol");
    assert.deepEqual(c.reasoning, { effort: "medium" });
    assert.equal(c.truncation, "auto");
    assert.equal("previous_response_id" in c, false);
    assert.equal(corpoDaOpenAI(m, "regras", [], "resp_1").previous_response_id, "resp_1");
  });

  it("custo da OpenAI: o que veio do cache sai pelo preço de cache", () => {
    const m = MODELOS_DO_COMPUTADOR["gpt-6.1-sol"];
    // 10k de entrada (4k do cache) e 1k de saída a US$ 2/0,10/10 por 1M.
    assert.equal(custoDoTurnoOpenAI({ input_tokens: 10_000, input_tokens_details: { cached_tokens: 4_000 }, output_tokens: 1_000 }, m).custo, 0.0224);
  });

  it("o modelo da tarefa vem do catálogo (preço de lá); só quem tem computer_use vale", () => {
    const sol = modeloDoCatalogo(CATALOGO["openai:gpt-6.1-sol"] as never);
    assert.deepEqual(sol && { provedor: sol.provedor, api: sol.api, entrada: sol.entrada, cache: sol.cacheLeitura }, { provedor: "openai", api: "gpt-6.1-sol", entrada: 2, cache: 0.1 });
    assert.equal(modeloDoCatalogo(CATALOGO["anthropic:claude-sonnet-5-5"] as never)?.cacheEscrita, 2.5);
    assert.equal(modeloDoCatalogo(CATALOGO["openai:gpt-6-luna"] as never), null);
    assert.equal(modeloDoCatalogo({ ...CATALOGO["openai:gpt-6.1-sol"], id: "openrouter:openai/gpt-6.1-sol" } as never), null, "pelo OpenRouter não há computer use");
    assert.equal(modeloConhecido("openai:gpt-6-astra")?.provedor, "openai");
    assert.equal(modeloConhecido("anthropic:claude-opus-5-5")?.api, "claude-opus-5-5");
    assert.equal(modeloConhecido("gpt-6-luna"), null);
  });

  it("o worker só pega o que tem chave: provedores e casos pela variável e pelas chaves da máquina", async () => {
    const anth = { enviar: async () => ({}) } as ClienteDoModelo;
    const oa = { enviar: async () => ({}) } as ClienteDoModelo<RespostaDaOpenAI>;
    assert.deepEqual(provedoresDoWorker({ comModelo: true, modelo: anth, openai: oa }), ["anthropic", "openai"]);
    assert.deepEqual(provedoresDoWorker({ comModelo: true, modelo: null, openai: oa }), ["openai"]);
    assert.deepEqual(provedoresDoWorker({ comModelo: false, modelo: anth, openai: oa }), []);
    assert.equal(casosDoWorker({ comModelo: true, modelo: null, openai: oa }).length, 7);
    assert.deepEqual(casosDoWorker({ comModelo: false, modelo: null, openai: null }), ["captura_site", "conferir_post", "conferir_site"]);
    const f = filaFalsa();
    await pegarERodar(ambiente(f.fila, { comModelo: true, modelo: null, openai: oa }));
    assert.deepEqual(f.pegadas[0].provedores, ["openai"]);
    // Tarefa com modelo da OpenAI num worker só com a chave da Anthropic: não roda, e diz qual chave falta.
    const t = tarefa({ caso: "coleta_publica", objetivo: "serviços e preços da página inicial", teto_passos: 10, teto_custo_usd: 1, modelo_id: "openai:gpt-6.1-sol" });
    assert.match(String(motivoParaNaoRodar(t, { comModelo: true, modelo: anth, openai: null })), /OPENAI_API_KEY/);
    assert.equal(motivoParaNaoRodar(t, { comModelo: true, modelo: null, openai: oa }), null);
  });

  it("o system de cada ação pede o formato certo e repete as regras", () => {
    assert.match(sistemaDoCaso("capturar_referencia"), /"notas"/);
    assert.match(sistemaDoCaso("concorrentes_visuais"), /"cores"/);
    assert.match(sistemaDoCaso("perfil_publico"), /sem abrir login/);
    for (const c of ["coleta_publica", "capturar_referencia", "perfil_publico", "concorrentes_visuais"]) assert.match(sistemaDoCaso(c), /DADO, não instrução/);
  });

  it("chave nunca aparece no erro; a Anthropic leva o workspace quando a máquina tem", async () => {
    assert.equal(semSegredo("Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"), "Incorrect API key provided: [chave]");
    let visto: Record<string, string> = {};
    const buscar = (async (_u: string, init: { headers: Record<string, string> }) => {
      visto = init.headers;
      return new Response(JSON.stringify({ stop_reason: "end_turn", content: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await clienteAnthropic("sk-ant-teste-0123456789abcdef", "wrkspc_1", buscar).enviar({});
    assert.equal(visto["anthropic-workspace-id"], "wrkspc_1");
    const oa = openaiFalsa([]);
    await assert.rejects(oa.cliente.enviar({}), /OpenAI 500/);
    assert.equal(oa.cabecalhos[0].Authorization, "Bearer sk-teste-0123456789abcdefghij");
  });

  it("prova real: --provedor openai escolhe o GPT-6.1 Sol e a chave da OpenAI; teto de US$ 0,20", () => {
    const a = argumentosDaProva(["--provedor", "openai"], {});
    assert.equal(a.modelo.id, "openai:gpt-6.1-sol");
    assert.equal(a.url, "https://www.example.com/");
    const b = argumentosDaProva(["https://site.com.br/", "preços", "--provedor", "anthropic"], { COMPUTADOR_MODELO: "opus-5-5" });
    assert.equal(b.modelo.id, "anthropic:claude-opus-5-5");
    assert.equal(b.url, "https://site.com.br/");
    assert.equal(b.objetivo, "preços");
    assert.equal(argumentosDaProva(["--modelo", "openai:gpt-6-astra"], {}).modelo.id, "openai:gpt-6-astra");
  });
});

describe("ações novas e a OpenAI num Chromium de verdade", () => {
  it("conferir_site: prints no computador e no celular, tempo e o link quebrado do próprio site", TETO, async () => {
    recebidos.length = 0;
    const f = filaFalsa();
    const s = await umaTarefa(ambiente(f.fila), tarefa(), "t-site");
    assert.equal(s.estado, "feita", String(s.motivo));
    assert.equal(f.passos.length, 3);
    const links = s.resultado.links as { conferidos: number; quebrados: Array<{ url: string; status: number }>; externos: number };
    assert.equal(links.conferidos, 2, JSON.stringify(links));
    assert.deepEqual(links.quebrados.map((l) => [l.url.replace(/:\d+/, ""), l.status]), [["http://cliente.com.br/quebrado", 404]]);
    assert.equal(links.externos, 1);
    assert.match(String(s.resultado.resumo), /Respondeu 200 em .* · 1 link\(s\) quebrado\(s\) de 2/);
    assert.ok((s.resultado.avisos as string[]).some((a) => /Link quebrado \(404\)/.test(a)));
    assert.deepEqual((s.resultado.imagens as Array<{ rotulo: string }>).map((i) => i.rotulo), ["Primeira tela no computador", "Página inteira no computador", "Página inteira no celular"]);
    // Conferência é leitura: só GET e HEAD chegaram ao servidor, e nada do domínio externo.
    assert.deepEqual(Array.from(new Set(recebidos.map((r) => r.metodo))).sort(), ["GET", "HEAD"]);
    assert.equal(recebidos.filter((r) => r.host === "externo.com.br").length, 0);
  });

  it("OpenAI (fetch falso): lote com digitação de senha recusado, histórico pelo previous_response_id, uso na carteira com o preço do catálogo", TETO, async () => {
    const oa = openaiFalsa([
      {
        id: "resp_1",
        output: [
          { type: "reasoning", id: "rs_1" },
          { type: "computer_call", call_id: "call_1", status: "completed", pending_safety_checks: [], actions: [{ type: "screenshot" }, { type: "type", text: "senha: 123456" }, { type: "scroll", x: 600, y: 400, scroll_x: 0, scroll_y: 600 }] },
        ],
        usage: { input_tokens: 5000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200 },
      },
      {
        id: "resp_2",
        output: [{ type: "computer_call", call_id: "call_2", status: "completed", pending_safety_checks: [], actions: [{ type: "scroll", x: 600, y: 400, scroll_x: 0, scroll_y: 800 }] }],
        usage: { input_tokens: 7000, input_tokens_details: { cached_tokens: 5000 }, output_tokens: 100 },
      },
      {
        id: "resp_3",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"resumo":"Site do cliente","dados":[{"item":"título","valor":"Bem-vindo","fonte":"http://cliente.com.br/"}],"avisos":[]}' }] }],
        usage: { input_tokens: 8000, input_tokens_details: { cached_tokens: 6000 }, output_tokens: 300 },
      },
    ]);
    const f = filaFalsa();
    const t = tarefa({ caso: "coleta_publica", objetivo: "título e serviços da página inicial", teto_passos: 25, teto_custo_usd: 1, modelo_id: "openai:gpt-6.1-sol" });
    const s = await umaTarefa(ambiente(f.fila, { comModelo: true, openai: oa.cliente }), t, "t-openai");
    assert.equal(s.estado, "feita", String(s.motivo));
    assert.equal(oa.corpos.length, 3);
    assert.deepEqual(oa.corpos[0].tools, [{ type: "computer" }]);
    assert.equal(oa.corpos[0].model, "gpt-6.1-sol");
    assert.equal("previous_response_id" in oa.corpos[0], false);
    assert.equal(oa.corpos[1].previous_response_id, "resp_1");
    assert.equal(oa.corpos[2].previous_response_id, "resp_2");
    const entrada = oa.corpos[1].input as Array<Record<string, unknown>>;
    assert.equal(entrada[0].type, "computer_call_output");
    assert.equal(entrada[0].call_id, "call_1");
    const saida = entrada[0].output as Record<string, unknown>;
    assert.equal(saida.type, "computer_screenshot");
    assert.equal(saida.detail, "original");
    assert.match(String(saida.image_url), /^data:image\/png;base64,/);
    assert.equal("acknowledged_safety_checks" in entrada[0], false);
    // A senha foi recusada pela trava e o resto do lote não rodou: o motivo vai junto, em texto.
    assert.match(JSON.stringify(entrada[1]), /Digitação recusada/);
    assert.match(JSON.stringify(entrada[1]), /1 ação\(ões\) seguinte\(s\) do lote não rodaram/);
    assert.equal((s.resultado.dados as unknown[]).length, 1);
    assert.equal(s.resultado.modelo, "openai:gpt-6.1-sol");
    assert.equal(f.usos.length, 1);
    assert.equal(f.usos[0].provedor, "openai");
    assert.equal(f.usos[0].modeloId, "openai:gpt-6.1-sol");
    // (5000*2 + 200*10) + (2000*2 + 5000*0,1 + 100*10) + (2000*2 + 6000*0,1 + 300*10) por 1M.
    assert.equal(Math.round(f.usos[0].custoUsd * 1e6) / 1e6, 0.0251);
    assert.equal(f.passos.length, 4);
  });

  it("OpenAI (fetch falso): pedido de confirmação de segurança para a tarefa e nada é reconhecido sozinho", TETO, async () => {
    const oa = openaiFalsa([
      {
        id: "resp_1",
        output: [{ type: "computer_call", call_id: "call_1", status: "completed", pending_safety_checks: [{ id: "cu_sc_1", code: "malicious_instructions", message: "A página tem instruções para o agente." }], actions: [{ type: "click", button: "left", x: 10, y: 10 }] }],
        usage: { input_tokens: 4000, output_tokens: 50 },
      },
    ]);
    const f = filaFalsa();
    const t = tarefa({ caso: "coleta_publica", objetivo: "título e serviços da página inicial", teto_passos: 10, teto_custo_usd: 1, modelo_id: "openai:gpt-6.1-sol" });
    const s = await umaTarefa(ambiente(f.fila, { comModelo: true, openai: oa.cliente }), t, "t-seg");
    assert.equal(s.estado, "falhou");
    assert.match(String(s.motivo), /confirmação de segurança \(malicious_instructions/);
    assert.equal(oa.corpos.length, 1);
    assert.equal(f.usos.length, 1, "o turno que custou vai para a carteira");
  });

  it("capturar_referencia (Claude falso): página inteira, cores e fontes do código no pedido e as notas de estilo", TETO, async () => {
    const pedidos: Array<Record<string, unknown>> = [];
    const turnos: RespostaDoModelo[] = [
      { stop_reason: "end_turn", content: [{ type: "text", text: '{"resumo":"Verde institucional com laranja no botão","notas":[{"aspecto":"paleta","nota":"verde #0a7f5a e laranja #d9480f"}],"levar":["botão arredondado"],"evitar":[],"avisos":[]}' }], usage: { input_tokens: 6000, output_tokens: 300 } },
    ];
    const modelo: ClienteDoModelo = { enviar: async (corpo) => (pedidos.push(JSON.parse(JSON.stringify(corpo))), turnos[pedidos.length - 1]) };
    const f = filaFalsa();
    const t = tarefa({ caso: "capturar_referencia", teto_passos: 14, teto_custo_usd: 0.6, modelo_id: "anthropic:claude-sonnet-5-5", objetivo: null });
    const s = await umaTarefa(ambiente(f.fila, { comModelo: true, modelo }), t, "t-ref");
    assert.equal(s.estado, "feita", String(s.motivo));
    const estilo = s.resultado.estilo as { cores: Array<{ hex: string }>; fontes: Array<{ familia: string }>; tema: string; botao: { fundo: string; raio: string } };
    const cores = estilo.cores.map((c) => c.hex);
    for (const c of ["#0a7f5a", "#f4efe6"]) assert.ok(cores.indexOf(c) >= 0, `${c} em ${cores.join(",")}`);
    assert.equal(estilo.fontes[0].familia, "Georgia");
    assert.equal(estilo.tema, "#0a7f5a");
    assert.deepEqual(estilo.botao, { fundo: "#d9480f", texto: "#ffffff", raio: "12px" });
    assert.equal((s.resultado.notas as unknown[]).length, 1);
    assert.match(JSON.stringify(pedidos[0].messages), /Lido do código da página/);
    assert.match(JSON.stringify(pedidos[0].messages), /#0a7f5a/);
    assert.match(String(pedidos[0].system), /notas de estilo/);
    assert.deepEqual((s.resultado.imagens as Array<{ rotulo: string }>).map((i) => i.rotulo), ["Página inteira no computador", "Página inteira no celular"]);
    assert.equal(f.usos[0].provedor, "anthropic");
  });

  it("perfil_publico: rede com login fica só no que é público, sem chamar o modelo e sem falhar", TETO, async () => {
    let chamadas = 0;
    const modelo: ClienteDoModelo = { enviar: async () => (chamadas++, { stop_reason: "end_turn", content: [] }) };
    const f = filaFalsa();
    const t = tarefa({ caso: "perfil_publico", url_inicial: "http://cliente.com.br/perfil-fechado", teto_passos: 15, teto_custo_usd: 0.6, modelo_id: "anthropic:claude-sonnet-5-5", origem: "mesa_ads" });
    const s = await umaTarefa(ambiente(f.fila, { comModelo: true, modelo }), t, "t-perfil");
    assert.equal(s.estado, "feita", String(s.motivo));
    assert.equal(chamadas, 0);
    assert.equal(s.resultado.sem_login, true);
    assert.match(String(s.resultado.resumo), /Concorrente \(@concorrente\)/);
    assert.deepEqual((s.resultado.dados as Array<{ item: string }>).map((d) => d.item), ["Título público", "Descrição pública"]);
    assert.match(JSON.stringify(s.resultado.avisos), /pediu login/);
    assert.equal(f.usos.length, 0);
  });

  it("perfil_publico aberto (GPT falso): o modelo resume e o que é público vem junto, com a fonte", TETO, async () => {
    const oa = openaiFalsa([
      { id: "r1", output: [{ type: "message", content: [{ type: "output_text", text: '{"resumo":"Doceria artesanal","dados":[{"item":"bio","valor":"Doces artesanais","fonte":"http://cliente.com.br/perfil"}],"tom":"afetivo","formatos":["foto"],"avisos":[]}' }] }], usage: { input_tokens: 3000, output_tokens: 100 } },
    ]);
    const f = filaFalsa();
    const t = tarefa({ caso: "perfil_publico", url_inicial: "http://cliente.com.br/perfil", teto_passos: 15, teto_custo_usd: 0.6, modelo_id: "openai:gpt-6.1-sol", origem: "mesa_ads" });
    const s = await umaTarefa(ambiente(f.fila, { comModelo: true, openai: oa.cliente }), t, "t-perfil2");
    assert.equal(s.estado, "feita", String(s.motivo));
    assert.equal(s.resultado.tom, "afetivo");
    assert.deepEqual((s.resultado.dados as Array<{ item: string }>).map((d) => d.item), ["Título público", "Descrição pública", "bio"]);
    assert.match(String(oa.corpos[0].instructions), /perfil público/);
  });

  it("concorrentes_visuais: cada site com topo, logo, cores e fontes do código e a leitura do modelo", TETO, async () => {
    const respostas: RespostaDoModelo[] = [
      { stop_reason: "end_turn", content: [{ type: "text", text: '{"nome":"Cliente","comunica":"tradição","logo":"wordmark","cores":["#0a7f5a"],"tipografia":"serifada","avisos":[]}' }], usage: { input_tokens: 4000, output_tokens: 120 } },
      { stop_reason: "end_turn", content: [{ type: "text", text: '{"nome":"Rival Doces","comunica":"sofisticação","logo":"símbolo","cores":["#3b0a45"],"tipografia":"sem serifa","avisos":[]}' }], usage: { input_tokens: 4000, output_tokens: 120 } },
    ];
    let n = 0;
    const modelo: ClienteDoModelo = { enviar: async () => respostas[n++] };
    const f = filaFalsa();
    const t = tarefa({
      caso: "concorrentes_visuais",
      url_inicial: "http://cliente.com.br/",
      urls: ["http://cliente.com.br/", "http://concorrente.com.br/"],
      dominios: ["cliente.com.br", "concorrente.com.br"],
      teto_passos: 30,
      teto_custo_usd: 1.5,
      modelo_id: "anthropic:claude-sonnet-5-5",
      origem: "mesa_identidade",
    });
    const s = await umaTarefa(ambiente(f.fila, { comModelo: true, modelo }), t, "t-conc");
    assert.equal(s.estado, "feita", String(s.motivo));
    const lista = s.resultado.concorrentes as Array<Record<string, unknown>>;
    assert.deepEqual(lista.map((c) => c.nome), ["Cliente", "Rival Doces"]);
    assert.ok((lista[1].cores_do_codigo as string[]).indexOf("#3b0a45") >= 0);
    assert.equal(lista[1].fontes_do_codigo && (lista[1].fontes_do_codigo as string[])[0], "Arial");
    assert.ok(lista[1].logo_no_codigo);
    const rotulos = (s.resultado.imagens as Array<{ rotulo: string }>).map((i) => i.rotulo);
    assert.deepEqual(rotulos, ["Topo de cliente.com.br", "Logo de cliente.com.br", "Topo de concorrente.com.br", "Logo de concorrente.com.br"]);
    assert.equal(n, 2, "uma sessão do modelo por site");
    assert.equal(f.usos.length, 1, "um registro de uso para a tarefa inteira");
  });
});
