/**
 * Navegador do PC (26/10/2026): o motor "ego" (Ego Lite do dono) no worker do navegador.
 * Confere a escolha do motor, a busca do CLI, as regras do pedido, o roteiro que roda dentro do Ego
 * (com página falsa: trava de clique sensível, login caído, campo de senha, site fora da lista) e a
 * tarefa inteira com fila e Ego falsos (PC sem Ego = indisponível; passo sensível sem aprovação = recusa).
 *
 *   node --test testes/ego.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CASO_DO_PC,
  MENSAGEM_PC_INDISPONIVEL,
  normalizarPedidoDoPc,
  pcDisponivel,
  PC_ONLINE_S,
} from "../../../supabase/functions/computador-do-agente/modulos/navegador-do-pc.ts";
import { acharEgo, lerSaidaDoEgo, MARCA_DO_RESULTADO, modoDoEgo, type MotorDoEgo, motorDoPedido, REGRAS_DO_EGO, type SaidaDoEgo, scriptDoPedido } from "../ego.ts";
// @ts-ignore: módulo JavaScript puro (roda dentro do Ego).
import { rodar, rotulosDoTexto, urlPermitida } from "../ego-roteiro.mjs";
import type { Fila, TarefaDoNavegador } from "../fila.ts";
import { type Ambiente, casosDoWorker, umaTarefa } from "../trabalho.ts";

describe("escolha do motor", () => {
  it("pedido do PC vai para o Ego; sem Ego fica indisponível (null)", () => {
    assert.equal(motorDoPedido({ caso: CASO_DO_PC, url_inicial: "https://business.facebook.com/" }, "logado"), "ego");
    assert.equal(motorDoPedido({ caso: CASO_DO_PC, url_inicial: "https://business.facebook.com/" }, "so_pc"), "ego");
    assert.equal(motorDoPedido({ caso: CASO_DO_PC, url_inicial: "https://business.facebook.com/" }, "desligado"), null);
    assert.equal(motorDoPedido({ caso: CASO_DO_PC, url_inicial: "https://business.facebook.com/" }, null), null);
  });
  it("conferir post em rede logada vai para o Ego no modo logado; site comum e outros casos ficam no Chromium", () => {
    assert.equal(motorDoPedido({ caso: "conferir_post", url_inicial: "https://www.instagram.com/p/abc/" }, "logado"), "ego");
    assert.equal(motorDoPedido({ caso: "conferir_post", url_inicial: "https://www.instagram.com/p/abc/" }, "so_pc"), "chromium");
    assert.equal(motorDoPedido({ caso: "conferir_post", url_inicial: "https://aceleriq.com/blog/x" }, "logado"), "chromium");
    assert.equal(motorDoPedido({ caso: "captura_site", url_inicial: "https://www.instagram.com/" }, "logado"), "chromium");
    assert.equal(motorDoPedido({ caso: "conferir_post", url_inicial: "https://www.instagram.com/p/abc/" }, null), "chromium");
  });
  it("modo pela variável: padrão logado, so_pc e desligado", () => {
    assert.equal(modoDoEgo({}), "logado");
    assert.equal(modoDoEgo({ COMPUTADOR_EGO: "so_pc" }), "so_pc");
    assert.equal(modoDoEgo({ COMPUTADOR_EGO: "desligado" }), "desligado");
  });
  it("o worker só anuncia o caso do PC com o Ego ligado", () => {
    const base = { comModelo: false, modelo: null, openai: null };
    assert.equal(casosDoWorker({ ...base, ego: null }).indexOf(CASO_DO_PC), -1);
    assert.ok(casosDoWorker({ ...base, ego: egoFalso(() => saidaVazia()) }).indexOf(CASO_DO_PC) >= 0);
  });
});

describe("CLI do Ego", () => {
  it("acha a versão instalada mais nova (não o atalho antigo) e o ego.exe ao lado", () => {
    const base = "C:\\Program Files\\Citro Labs\\ego lite\\Application";
    const existe = new Set([`${base}\\0.6.0.16\\ego-browser.exe`, `${base}\\0.6.1.11\\ego-browser.exe`, `${base}\\ego.exe`]);
    const r = acharEgo({ ProgramFiles: "C:\\Program Files" }, (p) => existe.has(p), () => ["0.6.0.16", "0.6.1.11", "SetupMetrics"]);
    assert.ok(r);
    assert.equal(r.versao, "0.6.1.11");
    assert.equal(r.cli, `${base}\\0.6.1.11\\ego-browser.exe`);
    assert.equal(r.app, `${base}\\ego.exe`);
  });
  it("sem Ego instalado devolve null; EGO_BROWSER_BIN inexistente também", () => {
    assert.equal(acharEgo({ ProgramFiles: "C:\\X" }, () => false, () => []), null);
    assert.equal(acharEgo({ EGO_BROWSER_BIN: "C:\\nao\\existe.exe" }, () => false, () => []), null);
  });
  it("o script do pedido não leva aspas duplas na linha de comando e o resultado sai da linha marcada", () => {
    const s = scriptDoPedido("file:///C:/x/ego-roteiro.mjs", "C:\\tmp\\p", { nomeDoEspaco: "aceleriq-1", passos: [{ acao: "navegar", url: "https://www.facebook.com/" }] });
    assert.match(s, /taskSpace/);
    assert.match(s, /C:\/tmp\/p/);
    const saida = lerSaidaDoEgo(`log qualquer\n${MARCA_DO_RESULTADO}{"passos":[],"prints":[],"parou":null,"erro":null,"url_final":"u","titulo":"t","texto_final":null}\n`);
    assert.equal(saida && saida.url_final, "u");
    assert.equal(lerSaidaDoEgo("sem marca"), null);
  });
});

describe("regras do pedido do PC", () => {
  it("aceita ler o gerenciador de anúncios e marca a lista de domínios", () => {
    const n = normalizarPedidoDoPc({ url: "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123", passos: [{ acao: "ler" }] });
    assert.equal(n.ok, true);
    if (n.ok) {
      assert.deepEqual(n.pedido.dominios, ["facebook.com"]);
      assert.equal(n.pedido.passos[0].acao, "navegar");
      assert.deepEqual(n.pedido.sensiveis, []);
    }
  });
  it("recusa e-mail, conta, cobrança, site fora da lista, http e token na URL", () => {
    for (const url of ["https://mail.google.com/mail/u/0", "https://accounts.google.com/", "https://business.facebook.com/billing_hub/payment_settings", "https://www.meubanco.com.br/", "http://www.facebook.com/", "https://www.facebook.com/?access_token=abc", "https://www.facebook.com/login/"]) {
      assert.equal(normalizarPedidoDoPc({ url }).ok, false, url);
    }
  });
  it("senha, código e e-mail nunca são digitados", () => {
    assert.equal(normalizarPedidoDoPc({ url: "https://www.facebook.com/", passos: [{ acao: "digitar", campo: "Senha", valor: "x" }] }).ok, false);
    assert.equal(normalizarPedidoDoPc({ url: "https://www.facebook.com/", passos: [{ acao: "digitar", campo: "Pesquisar", valor: "a@b.com" }] }).ok, false);
  });
  it("clique que publica e digitação fora de busca são sensíveis; busca e navegação não", () => {
    const n = normalizarPedidoDoPc({
      url: "https://adsmanager.facebook.com/",
      passos: [{ acao: "clicar", texto: "Campanhas" }, { acao: "digitar", campo: "Pesquisar", valor: "black friday" }, { acao: "digitar", campo: "Orçamento", valor: "50" }, { acao: "clicar", texto: "Publicar" }],
    });
    assert.equal(n.ok, true);
    if (n.ok) assert.deepEqual(n.pedido.sensiveis, [3, 4]);
  });
  it("PC disponível: sinal recente do executor com o caso do PC, ou tarefa rodando agora", () => {
    const agora = Date.parse("2026-10-26T12:00:00Z");
    const recente = new Date(agora - 30_000).toISOString();
    const velho = new Date(agora - (PC_ONLINE_S + 60) * 1000).toISOString();
    assert.equal(pcDisponivel([{ nome: "pc", visto_em: recente, casos: ["captura_site", CASO_DO_PC] }], agora).disponivel, true);
    assert.equal(pcDisponivel([{ nome: "pc", visto_em: velho, casos: [CASO_DO_PC] }], agora).disponivel, false);
    assert.equal(pcDisponivel([{ nome: "outro", visto_em: recente, casos: ["captura_site"] }], agora).disponivel, false);
    assert.equal(pcDisponivel([], agora, true).disponivel, true);
  });
});

// ------------------------------------------------------------------ roteiro dentro do Ego (página falsa)

interface PaginaFalsa {
  url: string;
  senha: boolean;
  cliques: string[];
  digitados: string[];
  snapshot: string;
}

function egoFalsoDePagina(pag: PaginaFalsa, aoIr: (url: string) => void = (u) => (pag.url = u)) {
  const page = {
    goto: async (u: string) => aoIr(u),
    waitForLoadState: async () => undefined,
    url: async () => pag.url,
    title: async () => "Gerenciador de Anúncios",
    evaluate: async (fn: (a?: unknown) => unknown, arg?: unknown) => {
      const src = String(fn);
      if (src.indexOf("password") >= 0 && src.indexOf("querySelector") >= 0) return pag.senha;
      if (src.indexOf("activeElement") >= 0) return pag.senha ? "password" : "text";
      if (src.indexOf("querySelector") >= 0) return arg === "#publicar" ? "Publicar" : null;
      return null;
    },
    snapshot: async () => pag.snapshot,
    screenshot: async () => "x.png",
    click: async (alvo: string) => {
      pag.cliques.push(alvo);
      return {};
    },
    focus: async () => undefined,
    fill: async (_a: string, v: string) => {
      pag.digitados.push(v);
    },
    press: async () => undefined,
    info: async () => ({ w: 1280, h: 720 }),
    mouse: { move: async () => undefined, wheel: async () => undefined },
    waitForTimeout: async () => undefined,
  };
  let finalizado = false;
  const taskSpace = async () => ({ page: () => page, finish: async () => void (finalizado = true) });
  return { taskSpace, finalizado: () => finalizado };
}

const pagina = (extra: Partial<PaginaFalsa> = {}): PaginaFalsa => ({
  url: "about:blank",
  senha: false,
  cliques: [],
  digitados: [],
  snapshot: 'root\n  button [ref=1]\n    text "Campanhas"\n  button [ref=2]\n    text "Publicar"\n',
  ...extra,
});

const rodarRoteiro = (taskSpace: unknown, passos: unknown[]) => rodar({ taskSpace, dirSaida: "C:/tmp", nomeDoEspaco: "aceleriq-teste" }, { passos, regras: REGRAS_DO_EGO });

describe("roteiro dentro do Ego (página falsa)", () => {
  it("lê o gerenciador e fecha o espaço no fim", async () => {
    const pag = pagina();
    const f = egoFalsoDePagina(pag);
    const r = await rodarRoteiro(f.taskSpace, [{ acao: "navegar", url: "https://adsmanager.facebook.com/" }, { acao: "ler" }]);
    assert.equal(r.parou, null);
    assert.equal(r.erro, null);
    assert.match(r.passos[1].texto, /Campanhas/);
    assert.ok(f.finalizado());
  });
  it("clique em Publicar sem autorização para sem clicar; com autorização clica", async () => {
    const pag = pagina();
    const f = egoFalsoDePagina(pag);
    const r = await rodarRoteiro(f.taskSpace, [{ acao: "navegar", url: "https://adsmanager.facebook.com/" }, { acao: "clicar", texto: "Publicar" }]);
    assert.equal(r.parou && r.parou.codigo, "precisa_aprovacao");
    assert.deepEqual(pag.cliques, []);
    const r2 = await rodarRoteiro(egoFalsoDePagina(pag).taskSpace, [{ acao: "navegar", url: "https://adsmanager.facebook.com/" }, { acao: "clicar", texto: "Publicar", autorizado: true }]);
    assert.equal(r2.parou, null);
    assert.deepEqual(pag.cliques, ["text=Publicar"]);
  });
  it("seletor que aponta para Publicar também trava (o alvo real é lido na página)", async () => {
    const pag = pagina();
    const r = await rodarRoteiro(egoFalsoDePagina(pag).taskSpace, [{ acao: "navegar", url: "https://adsmanager.facebook.com/" }, { acao: "clicar", seletor: "#publicar" }]);
    assert.equal(r.parou && r.parou.codigo, "precisa_aprovacao");
    assert.deepEqual(pag.cliques, []);
  });
  it("texto inocente que também aparece num botão sensível é tratado como sensível", () => {
    assert.deepEqual(rotulosDoTexto('  text "Publicar alterações"\n  text "Campanhas"', "publicar"), ["publicar", "Publicar alterações"]);
  });
  it("página de login no meio = sessão expirada, nada digitado", async () => {
    const pag = pagina({ senha: true });
    const r = await rodarRoteiro(egoFalsoDePagina(pag).taskSpace, [{ acao: "navegar", url: "https://adsmanager.facebook.com/" }, { acao: "digitar", campo: "Pesquisar", valor: "x" }]);
    assert.equal(r.parou && r.parou.codigo, "sessao_expirada");
    assert.deepEqual(pag.digitados, []);
  });
  it("redirecionamento para fora da lista para", async () => {
    const pag = pagina();
    const r = await rodarRoteiro(egoFalsoDePagina(pag, () => (pag.url = "https://www.meubanco.com.br/")).taskSpace, [{ acao: "navegar", url: "https://www.facebook.com/" }]);
    assert.equal(r.parou && r.parou.codigo, "fora_da_lista");
  });
  it("URL permitida: lista, https e sem caminho proibido", () => {
    assert.equal(urlPermitida("https://business.facebook.com/latest/home", REGRAS_DO_EGO), true);
    assert.equal(urlPermitida("https://business.facebook.com/billing_hub/x", REGRAS_DO_EGO), false);
    assert.equal(urlPermitida("https://mail.google.com/", REGRAS_DO_EGO), false);
  });
});

// ------------------------------------------------------------------ tarefa inteira (fila e Ego falsos)

const saidaVazia = (): SaidaDoEgo => ({ passos: [], prints: [], parou: null, erro: null, url_final: null, titulo: null, texto_final: null });

function egoFalso(rodarFn: () => SaidaDoEgo, chamadas: unknown[] = []): MotorDoEgo {
  return {
    modo: "logado",
    versao: "0.6.1.11",
    async rodar(e) {
      chamadas.push(e);
      return rodarFn();
    },
    lerPrint: () => new Uint8Array([137, 80, 78, 71]),
    limpar: () => undefined,
  };
}

function filaFalsa() {
  const conclusoes: Array<{ estado: string; resultado: Record<string, unknown>; motivo: string | null }> = [];
  const provas: string[] = [];
  const fila: Fila = {
    pegar: async () => null,
    passo: async (_id, _t, prova) => {
      if (prova) provas.push(prova.storage_path);
      return "seguir";
    },
    concluir: async (_id, _t, estado, resultado, motivo) => {
      conclusoes.push({ estado, resultado, motivo });
      return true;
    },
    registrarUso: async () => undefined,
  };
  return { fila, conclusoes, provas };
}

const tarefaDoPc = (passos: unknown[]): TarefaDoNavegador => ({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  client_id: null,
  caso: CASO_DO_PC,
  estado: "executando",
  url_inicial: "https://adsmanager.facebook.com/",
  dominios: ["facebook.com"],
  objetivo: "ler o nome da conta",
  origem: "mcp",
  teto_passos: 10,
  teto_custo_usd: 0,
  aprovado_por: "99999999-9999-4999-8999-999999999999",
  aprovado_em: new Date().toISOString(),
  criado_por: null,
  passos,
});

function ambiente(ego: MotorDoEgo | null, fila: Fila): Ambiente {
  return {
    fila,
    armazem: { guardar: async (c) => c },
    abrir: async () => {
      throw new Error("o Chromium não deveria abrir num pedido do PC");
    },
    comModelo: false,
    modelo: null,
    executor: "teste-ego",
    versao: "cus-1.3",
    ego,
  };
}

describe("tarefa do PC inteira", () => {
  it("roda no Ego, sobe os prints e fecha feita com o texto lido", async () => {
    const { fila, conclusoes, provas } = filaFalsa();
    const chamadas: unknown[] = [];
    const ego = egoFalso(() => ({ ...saidaVazia(), passos: [{ passo: 1, acao: "navegar", ok: true }, { passo: 2, acao: "ler", ok: true, texto: "Conta: Aceleriq" }], prints: [{ caminho: "C:/tmp/p1.png", legenda: "Abri" }], url_final: "https://adsmanager.facebook.com/", titulo: "Gerenciador", texto_final: null }), chamadas);
    const s = await umaTarefa(ambiente(ego, fila), tarefaDoPc([{ acao: "navegar", url: "https://adsmanager.facebook.com/" }, { acao: "ler" }]), "tok");
    assert.equal(s.estado, "feita");
    assert.equal(chamadas.length, 1);
    assert.equal(provas.length, 1);
    assert.match(provas[0], /computador\/aaaaaaaa-.*ego\.png$/);
    assert.equal(conclusoes[0].resultado.motor, "ego");
  });
  it("PC sem Ego: fecha como indisponível, sem abrir navegador", async () => {
    const { fila, conclusoes } = filaFalsa();
    const s = await umaTarefa(ambiente(null, fila), tarefaDoPc([{ acao: "navegar", url: "https://adsmanager.facebook.com/" }]), "tok");
    assert.equal(s.estado, "falhou");
    assert.equal(conclusoes[0].motivo, MENSAGEM_PC_INDISPONIVEL);
  });
  it("passo sensível sem a marca de autorização do servidor é recusado antes do Ego", async () => {
    const { fila, conclusoes } = filaFalsa();
    const chamadas: unknown[] = [];
    const s = await umaTarefa(ambiente(egoFalso(saidaVazia, chamadas), fila), tarefaDoPc([{ acao: "navegar", url: "https://adsmanager.facebook.com/" }, { acao: "clicar", texto: "Publicar" }]), "tok");
    assert.equal(s.estado, "falhou");
    assert.equal(chamadas.length, 0);
    assert.match(String(conclusoes[0].motivo), /aprovação/);
  });
  it("parada do roteiro (sessão expirada) vira falhou com o motivo, com o print de onde parou", async () => {
    const { fila, conclusoes } = filaFalsa();
    const ego = egoFalso(() => ({ ...saidaVazia(), parou: { codigo: "sessao_expirada", motivo: "O site pediu login." }, prints: [{ caminho: "C:/tmp/p.png", legenda: "Onde parei" }] }));
    const s = await umaTarefa(ambiente(ego, fila), tarefaDoPc([{ acao: "navegar", url: "https://adsmanager.facebook.com/" }]), "tok");
    assert.equal(s.estado, "falhou");
    assert.equal(conclusoes[0].motivo, "O site pediu login.");
    assert.equal((conclusoes[0].resultado.parou as { codigo: string }).codigo, "sessao_expirada");
  });
});
