/**
 * Seletor do clique no roteiro do Ego: o callback real de page.evaluate roda (vm) sobre um DOM sintético.
 * CSS nativo precisa casar um único alvo; seletor opaco só segue com a marca de autorização do passo.
 *
 *   node --test testes/ego-seletor.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { rodar, rotuloDoSeletor } from "../ego-roteiro.mjs";
import { REGRAS_DO_EGO } from "../ego.ts";

const elemento = (texto, attrs = {}) => ({
  innerText: texto,
  getAttribute: (nome) => attrs[nome] ?? null,
  getClientRects: () => [{ width: 48, height: 18 }],
});

// DOM sintético: seletores conhecidos casam a lista; `>>` fora da lista é sintaxe que o CSS nativo recusa.
const DOM = {
  "#campanhas": [elemento("Campanhas")],
  "#sem-rotulo": [elemento("")],
  "#publicar": [elemento("Publicar")],
  "[role=menuitem]:first-of-type": [elemento("Editar"), elemento("Duplicar")],
  'button[aria-label="a >> nth=0"]': [elemento("Filtros", { "aria-label": "a >> nth=0" })],
};
const documento = {
  querySelector: () => null,
  querySelectorAll(sel) {
    if (sel === "#inspecao-falhou") throw new Error("falha de leitura");
    if (DOM[sel]) return DOM[sel];
    if (sel.indexOf(">>") >= 0) throw new SyntaxError(`'${sel}' is not a valid selector`);
    return [];
  },
};
const contexto = vm.createContext({ document: documento });

function paginaFalsa() {
  const cliques = [];
  let url = "about:blank";
  const page = {
    goto: async (u) => void (url = u),
    waitForLoadState: async () => undefined,
    url: async () => url,
    title: async () => "Gerenciador",
    evaluate: async (fn, arg) => vm.runInContext(`(${fn.toString()})`, contexto)(arg),
    snapshot: async () => 'root\n  button [ref=1]\n    text "Campanhas"\n',
    screenshot: async () => "x.png",
    click: async (alvo) => {
      cliques.push(alvo);
      return {};
    },
  };
  return { page, cliques, taskSpace: async () => ({ page: () => page, finish: async () => undefined }) };
}

async function clicar(passo) {
  const f = paginaFalsa();
  const r = await rodar(
    { taskSpace: f.taskSpace, dirSaida: "/tmp", nomeDoEspaco: "teste" },
    {
      passos: [{ acao: "navegar", url: "https://exemplo.test/" }, { acao: "clicar", ...passo }],
      regras: { ...REGRAS_DO_EGO, dominios: ["exemplo.test"] },
    },
  );
  return { r, cliques: f.cliques };
}

describe("seletor do clique (DOM sintético)", () => {
  it("CSS único e neutro clica", async () => {
    const { r, cliques } = await clicar({ seletor: "#campanhas" });
    assert.equal(r.parou, null);
    assert.equal(r.erro, null);
    assert.deepEqual(cliques, ["#campanhas"]);
    assert.equal(r.passos[1].rotulo, "Campanhas");
  });
  it("CSS com dois alvos visíveis conta 2 e não clica, mesmo autorizado", async () => {
    const seletor = "[role=menuitem]:first-of-type";
    assert.ok(DOM[seletor].every(alvo => alvo.getClientRects().length > 0));
    const { r, cliques } = await clicar({ seletor, autorizado: true });
    assert.equal(r.parou && r.parou.codigo, "alvo_ambiguo");
    assert.match(r.parou.motivo, /encontrou 2 elementos/);
    assert.ok(!r.parou.motivo.includes(seletor));
    assert.deepEqual(cliques, []);
  });
  it("opaco (nth e loc=) sem autorização para sem sugerir aprovação", async () => {
    for (const seletor of ["[role=menuitem] >> nth=0", "loc=role:menuitem"]) {
      const { r, cliques } = await clicar({ seletor });
      assert.equal(r.parou && r.parou.codigo, "seletor_nao_verificavel", seletor);
      assert.doesNotMatch(r.parou.motivo, /aprova/i);
      assert.ok(!r.parou.motivo.includes(seletor));
      assert.deepEqual(cliques, []);
    }
  });
  it("falha ao inspecionar CSS válido relata alvo não confirmado", async () => {
    const { r, cliques } = await clicar({ seletor: "#inspecao-falhou" });
    assert.equal(r.parou && r.parou.codigo, "seletor_nao_verificavel");
    assert.match(r.parou.motivo, /não conseguiu confirmar o alvo/);
    assert.deepEqual(cliques, []);
  });
  it("opaco com autorização já presente no passo mantém o comportamento anterior", async () => {
    const { r, cliques } = await clicar({ seletor: "[role=menuitem] >> nth=0", autorizado: true });
    assert.equal(r.parou, null);
    assert.deepEqual(cliques, ["[role=menuitem] >> nth=0"]);
  });
  it("CSS único sensível continua recusado sem autorização", async () => {
    const { r, cliques } = await clicar({ seletor: "#publicar" });
    assert.equal(r.parou && r.parou.codigo, "precisa_aprovacao");
    assert.deepEqual(cliques, []);
  });
  it("caminho por texto continua", async () => {
    const { r, cliques } = await clicar({ texto: "Campanhas" });
    assert.equal(r.parou, null);
    assert.deepEqual(cliques, ["text=Campanhas"]);
  });
  it("seletor sem alvo e sem autorização não clica", async () => {
    const { r, cliques } = await clicar({ seletor: "#nao-existe" });
    assert.equal(r.parou && r.parou.codigo, "alvo_nao_encontrado");
    assert.deepEqual(cliques, []);
  });
  it("seletor sem alvo naquele instante mantém a chamada ao Ego quando já autorizado", async () => {
    const { r, cliques } = await clicar({ seletor: "#nao-existe", autorizado: true });
    assert.equal(r.parou, null);
    assert.deepEqual(cliques, ["#nao-existe"]);
  });
  it("CSS com um alvo sem rótulo preserva o comportamento anterior", async () => {
    const { r, cliques } = await clicar({ seletor: "#sem-rotulo" });
    assert.equal(r.parou, null);
    assert.deepEqual(cliques, ["#sem-rotulo"]);
  });
  it("CSS válido com `>> nth=` dentro do atributo não é bloqueado", async () => {
    const { r, cliques } = await clicar({ seletor: 'button[aria-label="a >> nth=0"]' });
    assert.equal(r.parou, null);
    assert.deepEqual(cliques, ['button[aria-label="a >> nth=0"]']);
  });
  it("rotuloDoSeletor: string para alvo único, null para ambíguo, opaco ou ausente", async () => {
    const { page } = paginaFalsa();
    assert.equal(await rotuloDoSeletor(page, "#campanhas"), "Campanhas");
    assert.equal(await rotuloDoSeletor(page, "[role=menuitem]:first-of-type"), null);
    assert.equal(await rotuloDoSeletor(page, "[role=menuitem] >> nth=0"), null);
    assert.equal(await rotuloDoSeletor(page, "#nao-existe"), null);
  });
});
