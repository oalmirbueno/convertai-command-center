/**
 * Travas do navegador do agente (frente MOD), num Chromium de verdade contra
 * um servidor local. Os nomes permitido.com.br e proibido.com.br apontam para
 * 127.0.0.1 pela regra de DNS do Chromium (só no teste).
 *
 *   node --test testes/travas.test.ts
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { abrirNavegador, regraDoPedido } from "../navegador.ts";
import { type Ambiente, casosDoWorker, motivoParaNaoRodar, umaTarefa } from "../trabalho.ts";
import { aparaImagens, type ClienteDoModelo, custoDoTurno, executarAcao, type RespostaDoModelo, teclaPermitida } from "../modelo.ts";
import type { Fila, ProvaDoPasso, RespostaDoPasso, TarefaDoNavegador, UsoDoModelo } from "../fila.ts";

let servidor: http.Server;
let porta = 0;
const recebidos: Array<{ host: string; metodo: string; caminho: string }> = [];

const PAGINAS: Record<string, string> = {
  "/": `<!doctype html><html><head><title>Estúdio Referência</title></head><body style="margin:0">
    <h1>Estúdio Referência</h1>
    <a id="fora" href="http://proibido.com.br/" style="display:block;height:40px">Link para fora</a>
    <form id="f" method="post" action="/enviar"><input name="q" value="x"><button id="b">Enviar</button></form>
    <div style="height:2600px;background:linear-gradient(#fff,#8c8)">conteúdo longo</div>
    <footer>fim da página</footer>
    <script>setTimeout(function(){ document.getElementById('f').submit(); }, 50);</script>
  </body></html>`,
  "/area": `<!doctype html><html><head><title>Área</title></head><body><h1>Entre</h1><input type="password" name="p"></body></html>`,
  "/post": `<!doctype html><html><head><title>Post</title><meta property="og:title" content="Post da marca"><meta property="og:image" content="/x.png"></head><body><p>Legenda do post publicado ontem, com texto suficiente.</p></body></html>`,
  "/removido": `<!doctype html><html><head><title>Instagram</title></head><body><h2>Esta página não está disponível.</h2></body></html>`,
};

before(async () => {
  servidor = http.createServer((req, res) => {
    recebidos.push({ host: String(req.headers.host || ""), metodo: String(req.method), caminho: String(req.url) });
    const pagina = PAGINAS[String(req.url).split("?")[0]];
    if (req.method !== "GET" || !pagina) {
      res.writeHead(req.method === "GET" ? 404 : 200, { "Content-Type": "text/html" });
      res.end("<html><body>outro</body></html>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pagina);
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", () => ok()));
  porta = (servidor.address() as AddressInfo).port;
});

after(() => new Promise<void>((ok) => servidor.close(() => ok())));

/** Chrome do teste: COMPUTADOR_CHROME ou o headless shell mais novo já baixado pelo Playwright (sem baixar nada). */
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

const regras = () => `MAP permitido.com.br 127.0.0.1:${porta},MAP proibido.com.br 127.0.0.1:${porta}`;

function tarefa(m: Partial<TarefaDoNavegador> = {}): TarefaDoNavegador {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    client_id: "11111111-1111-4111-8111-111111111111",
    caso: "captura_site",
    estado: "executando",
    url_inicial: "http://permitido.com.br/",
    dominios: ["permitido.com.br"],
    objetivo: null,
    origem: "mesa_site",
    teto_passos: 6,
    teto_custo_usd: 0,
    aprovado_por: "99999999-9999-4999-8999-999999999999",
    aprovado_em: new Date().toISOString(),
    criado_por: null,
    ...m,
    // podeExecutar exige "aprovada" (é o que o worker recebe antes de a RPC virar "executando").
  } as TarefaDoNavegador;
}

function filaFalsa(respostas: RespostaDoPasso[] = []) {
  const passos: Array<{ prova: ProvaDoPasso | null; custo: number }> = [];
  const conclusoes: Array<{ estado: string; resultado: Record<string, unknown>; motivo: string | null }> = [];
  const usos: UsoDoModelo[] = [];
  const fila: Fila = {
    pegar: async () => null,
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
  };
  return { fila, passos, conclusoes, usos };
}

function ambiente(fila: Fila, extra: Partial<Ambiente> = {}): Ambiente {
  const guardados: string[] = [];
  return {
    fila,
    armazem: { guardar: async (c) => (guardados.push(c), c) },
    abrir: (op) => abrirNavegador({ ...op, regrasDeHost: regras(), executavel: CHROME }),
    comModelo: false,
    modelo: null,
    executor: "teste",
    versao: "teste",
    ...extra,
  };
}

describe("regras puras do navegador", () => {
  it("só leitura: POST, PUT e DELETE são bloqueados; GET de outro domínio como recurso passa, como navegação não", () => {
    const d = ["permitido.com.br"];
    assert.equal(regraDoPedido({ url: "https://permitido.com.br/", metodo: "GET", navegacaoPrincipal: true }, d), null);
    assert.equal(regraDoPedido({ url: "https://permitido.com.br/enviar", metodo: "POST", navegacaoPrincipal: true }, d)?.motivo, "so_leitura");
    assert.equal(regraDoPedido({ url: "https://cdn.outro.com/a.png", metodo: "GET", navegacaoPrincipal: false }, d), null);
    assert.equal(regraDoPedido({ url: "https://outro.com/", metodo: "GET", navegacaoPrincipal: true }, d)?.motivo, "dominio_fora_da_lista");
    assert.equal(regraDoPedido({ url: "file:///C:/Windows/win.ini", metodo: "GET", navegacaoPrincipal: true }, d)?.motivo, "protocolo");
  });

  it("teclas: só navegação; atalhos com Ctrl ou Alt são recusados", () => {
    assert.equal(teclaPermitida("Return"), "Enter");
    assert.equal(teclaPermitida("Page_Down"), "PageDown");
    assert.equal(teclaPermitida("ctrl+a"), null);
    assert.equal(teclaPermitida("alt+F4"), null);
    assert.equal(teclaPermitida("F12"), null);
  });

  it("sem o Confirmar do dono a tarefa não roda; caso com modelo exige a variável e a chave", () => {
    const semDono = tarefa({ estado: "aprovada", aprovado_por: null });
    assert.match(String(motivoParaNaoRodar(semDono, { comModelo: false, modelo: null })), /Confirmar do dono/);
    assert.match(String(motivoParaNaoRodar(tarefa({ estado: "aguardando_dono" }), { comModelo: false, modelo: null })), /Confirmar do dono/);
    assert.equal(motivoParaNaoRodar(tarefa({ estado: "aprovada" }), { comModelo: false, modelo: null }), null);
    const coleta = tarefa({ estado: "aprovada", caso: "coleta_publica", objetivo: "preços e serviços da página inicial" });
    assert.match(String(motivoParaNaoRodar(coleta, { comModelo: false, modelo: null })), /desligado/i);
    assert.match(String(motivoParaNaoRodar(coleta, { comModelo: true, modelo: null })), /desligado/i);
    assert.deepEqual(casosDoWorker({ comModelo: false, modelo: null }), ["captura_site", "conferir_post"]);
  });

  it("domínio fora da lista e URL de login são recusados antes de abrir", () => {
    assert.match(String(motivoParaNaoRodar(tarefa({ estado: "aprovada", url_inicial: "http://proibido.com.br/", dominios: ["permitido.com.br"] }), { comModelo: false, modelo: null })), /lista de domínios/);
    assert.match(String(motivoParaNaoRodar(tarefa({ estado: "aprovada", url_inicial: "http://permitido.com.br/login" }), { comModelo: false, modelo: null })), /login/);
    assert.match(String(motivoParaNaoRodar(tarefa({ estado: "aprovada", url_inicial: "http://permitido.com.br/minha-conta/senha" }), { comModelo: false, modelo: null })), /login/);
  });

  it("histórico do modelo guarda só as últimas 3 capturas", () => {
    const img = () => ({ type: "image", source: { type: "base64", media_type: "image/png", data: "x" } });
    const msgs = [1, 2, 3, 4, 5].map(() => ({ role: "user", content: [{ type: "tool_result", content: [img()] }] }));
    aparaImagens(msgs);
    const imagens = msgs.filter((m) => ((m.content[0] as { content: Array<{ type: string }> }).content[0].type === "image")).length;
    assert.equal(imagens, 3);
  });

  it("custo do turno pelo preço do Sonnet 5.5", () => {
    assert.equal(custoDoTurno({ input_tokens: 10_000, output_tokens: 1_000 }).custo, 0.03);
  });
});

describe("navegador de verdade (Chromium isolado)", { timeout: 120_000 }, () => {
  it("captura_site: um print por passo, página inteira no computador e no celular, POST e link de fora bloqueados", async () => {
    recebidos.length = 0;
    const f = filaFalsa();
    const s = await umaTarefa(ambiente(f.fila), tarefa({ estado: "aprovada" }), "token");
    assert.equal(s.estado, "feita", String(s.motivo));
    assert.equal(f.passos.length, 3);
    assert.deepEqual(f.passos.map((p) => p.prova && p.prova.passo), [1, 2, 3]);
    assert.match(String(f.passos[1].prova?.storage_path), /11111111-1111-4111-8111-111111111111\/computador\/aaaaaaaa-.*\/passo-02-inteira\.png$/);
    const capturas = s.resultado.capturas as Array<{ tela: string; altura: number }>;
    assert.deepEqual(capturas.map((c) => c.tela), ["computador", "celular"]);
    assert.ok(capturas[0].altura > 2000, `altura ${capturas[0].altura}`);
    // O formulário tentou enviar sozinho: o POST nunca chegou ao servidor.
    assert.equal(recebidos.filter((r) => r.metodo === "POST").length, 0);
    const bloqueios = s.resultado.bloqueios as Array<{ motivo: string }>;
    assert.ok(bloqueios.some((b) => b.motivo === "so_leitura"), JSON.stringify(bloqueios));
    assert.equal(f.conclusoes[0].estado, "feita");
  });

  it("navegação para domínio fora da lista é bloqueada (clique no link)", async () => {
    recebidos.length = 0;
    const nav = await abrirNavegador({ dominios: ["permitido.com.br"], regrasDeHost: regras(), executavel: CHROME });
    try {
      await nav.ir("http://permitido.com.br/");
      const caixa = await nav.pagina.locator("#fora").boundingBox();
      assert.ok(caixa);
      const r = await executarAcao(nav, "left_click", { coordinate: [Math.round(caixa.x + 5), Math.round(caixa.y + 5)] });
      assert.equal(r.ok, true);
      assert.match(nav.pagina.url(), /permitido\.com\.br/);
      assert.equal(recebidos.filter((x) => /proibido/.test(x.host)).length, 0);
      assert.ok(nav.bloqueios.some((b) => b.motivo === "dominio_fora_da_lista"));
      assert.equal(await nav.ir("http://proibido.com.br/"), null);
    } finally {
      await nav.fechar();
    }
  });

  it("página com campo de senha: para, deixa o print de onde parou e fecha como falhou", async () => {
    const f = filaFalsa();
    // /area não tem "login" no endereço: quem pega é o campo de senha visível.
    const s = await umaTarefa(ambiente(f.fila), tarefa({ estado: "aprovada", url_inicial: "http://permitido.com.br/area" }), "token");
    assert.equal(s.estado, "falhou");
    assert.match(String(s.motivo), /senha/);
    assert.equal(f.passos.length, 1);
    assert.equal(f.passos[0].prova?.legenda, "Onde parei");
    assert.equal(f.conclusoes[0].estado, "falhou");
  });

  it("Parar: a fila responde 'parar' no passo 2 e o worker não grava 'feita'", async () => {
    const f = filaFalsa(["seguir", "parar"]);
    const s = await umaTarefa(ambiente(f.fila), tarefa({ estado: "aprovada" }), "token");
    assert.equal(s.estado, "parada");
    assert.equal(f.passos.length, 2);
    assert.equal(f.conclusoes.length, 0);
  });

  it("teto: a fila responde 'teto' e a tarefa fecha com o que já tinha, marcada parcial", async () => {
    const f = filaFalsa(["teto"]);
    const s = await umaTarefa(ambiente(f.fila), tarefa({ estado: "aprovada" }), "token");
    assert.equal(s.estado, "feita");
    assert.equal(f.passos.length, 1);
    assert.equal(s.resultado.parcial, true);
    assert.match(String(f.conclusoes[0].motivo), /teto/);
  });

  it("conferir_post: no ar com og:title; fora do ar com o aviso da rede", async () => {
    const f = filaFalsa();
    const noAr = await umaTarefa(ambiente(f.fila), tarefa({ estado: "aprovada", caso: "conferir_post", url_inicial: "http://permitido.com.br/post", teto_passos: 4 }), "t1");
    assert.equal(noAr.resultado.no_ar, true);
    const fora = await umaTarefa(ambiente(f.fila), tarefa({ estado: "aprovada", caso: "conferir_post", url_inicial: "http://permitido.com.br/removido", teto_passos: 4 }), "t2");
    assert.equal(fora.resultado.no_ar, false);
  });

  it("computer use (modelo falso): senha e atalho recusados, lote para na primeira falha, uso vai para a carteira", async () => {
    const turnos: RespostaDoModelo[] = [
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "u1", name: "type", toolset_name: "computer", input: { text: "senha: 123456" } },
          { type: "tool_use", id: "u2", name: "screenshot", toolset_name: "computer", input: {} },
        ],
        usage: { input_tokens: 5000, output_tokens: 200 },
      },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "u3", name: "key", toolset_name: "computer", input: { text: "ctrl+a" } }], usage: { input_tokens: 6000, output_tokens: 100 } },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "u4", name: "scroll", toolset_name: "computer", input: { scroll_direction: "down", scroll_amount: 5, coordinate: [600, 400] } }], usage: { input_tokens: 7000, output_tokens: 100 } },
      { stop_reason: "end_turn", content: [{ type: "text", text: '{"resumo":"Estúdio com página longa","dados":[{"item":"título","valor":"Estúdio Referência","fonte":"http://permitido.com.br/"}],"avisos":[]}' }], usage: { input_tokens: 8000, output_tokens: 300 } },
    ];
    const pedidos: Array<Record<string, unknown>> = [];
    const modelo: ClienteDoModelo = { enviar: async (corpo) => (pedidos.push(JSON.parse(JSON.stringify(corpo))), turnos[pedidos.length - 1]) };
    const f = filaFalsa();
    const t = tarefa({ estado: "aprovada", caso: "coleta_publica", objetivo: "título e serviços da página inicial", teto_passos: 25, teto_custo_usd: 1 });
    const s = await umaTarefa(ambiente(f.fila, { comModelo: true, modelo }), t, "token");
    assert.equal(s.estado, "feita", String(s.motivo));
    assert.equal((s.resultado.dados as unknown[]).length, 1);
    // Toolset atual, sem cabeçalho beta, com o esforço no output_config.
    assert.equal((pedidos[0].tools as Array<{ type: string }>)[0].type, "computer_toolset_20260801");
    const segundo = pedidos[1].messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const resultados = segundo[segundo.length - 1].content;
    assert.equal(resultados[0].is_error, true);
    assert.match(JSON.stringify(resultados[0].content), /Digitação recusada/);
    assert.equal(resultados[1].is_error, true);
    assert.match(JSON.stringify(resultados[1].content), /Not executed/);
    assert.equal(resultados[0].toolset_name, "computer");
    const terceiro = pedidos[2].messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    assert.match(JSON.stringify(terceiro[terceiro.length - 1].content), /Tecla recusada/);
    // 1 print da abertura + 3 turnos com ação + a resposta final.
    assert.equal(f.passos.length, 5);
    assert.ok(f.passos.some((p) => p.custo > 0));
    assert.equal(f.usos.length, 1);
    assert.equal(f.usos[0].modeloId, "anthropic:claude-sonnet-5-5");
    assert.ok(f.usos[0].custoUsd > 0);
  });
});
