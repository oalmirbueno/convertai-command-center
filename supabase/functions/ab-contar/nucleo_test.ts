/**
 * ab-contar e o gerador do script de divisão (_shared/ab-divisao.ts), sem rede
 * e sem banco.
 *
 *   deno test supabase/functions/ab-contar/nucleo_test.ts
 */
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ErroDaDivisao, gerarScriptDeConversao, gerarScriptDeDivisao, jsonNoScript } from "../_shared/ab-divisao.ts";
import { contar, lerContagem, type PortaDoAb, somarPorVariante } from "./nucleo.ts";

const ENDPOINT = "https://exemplo.supabase.co/functions/v1/ab-contar";
const VARIANTES = [
  { id: "a", url: "https://site.com.br/vendas-a", peso: 50 },
  { id: "b", url: "https://site.com.br/vendas-b?x=1#preco", peso: 50 },
];

Deno.test("contagem pública: só formato seguro", () => {
  assertEquals(lerContagem({ teste_id: "teste-ab-k3m9x2", variante: "a", tipo: "visita" }), { teste_id: "teste-ab-k3m9x2", variante: "a", tipo: "visita" });
  assertEquals(lerContagem({ teste_id: "Teste", variante: "a", tipo: "visita" }), null);
  assertEquals(lerContagem({ teste_id: "teste-ab", variante: "a';drop", tipo: "visita" }), null);
  assertEquals(lerContagem({ teste_id: "teste-ab", variante: "a", tipo: "compra" }), null);
  assertEquals(lerContagem("teste"), null);
});

Deno.test("contar: grava, limite vira 429 e banco fora vira 503", async () => {
  const chamadas: unknown[] = [];
  let resposta: { ok: boolean; codigo?: string } = { ok: true };
  let quebra = false;
  const porta: PortaDoAb = {
    registrar: (c, ip) => {
      chamadas.push([c, ip]);
      return quebra ? Promise.reject(new Error("banco")) : Promise.resolve(resposta);
    },
    falha: () => {},
  };
  const ok = { teste_id: "teste-ab-1", variante: "b", tipo: "conversao" };
  assertEquals(await contar(porta, ok, "hash"), { status: 200, corpo: { ok: true } });
  resposta = { ok: false, codigo: "limite" };
  assertEquals((await contar(porta, ok, "hash")).status, 429);
  quebra = true;
  assertEquals((await contar(porta, ok, "hash")).status, 503);
  assertEquals((await contar(porta, { teste_id: "x" }, "hash")).status, 400);
  assertEquals(chamadas.length, 3);
});

Deno.test("totais por variante com taxa", () => {
  const t = somarPorVariante([
    { variante: "b", tipo: "visita", dia: "2026-10-19", total: 50 },
    { variante: "a", tipo: "visita", dia: "2026-10-19", total: 40 },
    { variante: "a", tipo: "visita", dia: "2026-10-20", total: 60 },
    { variante: "a", tipo: "conversao", dia: "2026-10-20", total: 7 },
    { variante: "c", tipo: "conversao", dia: "2026-10-20", total: 1 },
  ]);
  assertEquals(t, [
    { variante: "a", visitas: 100, conversoes: 7, taxa: 7 },
    { variante: "b", visitas: 50, conversoes: 0, taxa: 0 },
    { variante: "c", visitas: 0, conversoes: 1, taxa: null },
  ]);
});

Deno.test("divisão: pesos precisam somar 100, 2 a 5 variantes, ids e endereços seguros", () => {
  assertThrows(() => gerarScriptDeDivisao({ testeId: "teste-ab-1", endpoint: ENDPOINT, variantes: [{ ...VARIANTES[0], peso: 60 }, VARIANTES[1]] }), ErroDaDivisao, "somar 100");
  assertThrows(() => gerarScriptDeDivisao({ testeId: "teste-ab-1", endpoint: ENDPOINT, variantes: [VARIANTES[0]] }), ErroDaDivisao);
  assertThrows(() => gerarScriptDeDivisao({ testeId: "teste-ab-1", endpoint: ENDPOINT, variantes: [VARIANTES[0], { ...VARIANTES[1], id: "a" }] }), ErroDaDivisao);
  assertThrows(() => gerarScriptDeDivisao({ testeId: "teste-ab-1", endpoint: ENDPOINT, variantes: [VARIANTES[0], { ...VARIANTES[1], url: "javascript:alert(1)" }] }), ErroDaDivisao);
  assertThrows(() => gerarScriptDeDivisao({ testeId: "<script>", endpoint: ENDPOINT, variantes: VARIANTES }), ErroDaDivisao);
  assertThrows(() => gerarScriptDeDivisao({ testeId: "teste-ab-1", endpoint: ENDPOINT, variantes: [VARIANTES[0], { ...VARIANTES[1], peso: 49.5 }, { id: "c", url: "https://s.com/c", peso: 0.5 }] }), ErroDaDivisao);
});

Deno.test("script sai em ES5 (sem crase, arrow, let/const) e sem como fechar a tag <script>", () => {
  const s = gerarScriptDeDivisao({ testeId: "teste-ab-1", endpoint: ENDPOINT, variantes: [VARIANTES[0], { ...VARIANTES[1], url: "https://s.com/b?q=</script><script>alert(1)" }] });
  assert(s.indexOf("`") < 0);
  assert(s.indexOf("=>") < 0);
  assert(!/\b(let|const|class)\s/.test(s));
  assert(s.toLowerCase().indexOf("</script") < 0);
  assertEquals(jsonNoScript("</script>"), '"\\u003c/script\\u003e"');
  const c = gerarScriptDeConversao({ testeId: "teste-ab-1", endpoint: ENDPOINT });
  assert(c.indexOf("`") < 0 && c.indexOf("=>") < 0);
});

/** Roda o script num "navegador" simulado: localStorage, sendBeacon e location. */
function rodar(script: string, o: { aleatorio: number; armazenado?: Record<string, string>; storageQuebrado?: boolean; busca?: string; beacon?: boolean }) {
  const guardado: Record<string, string> = { ...(o.armazenado || {}) };
  const enviados: string[] = [];
  let destino = "";
  const atrasos: Array<() => void> = [];
  const localStorage = {
    getItem: (k: string) => {
      if (o.storageQuebrado) throw new Error("SecurityError");
      return k in guardado ? guardado[k] : null;
    },
    setItem: (k: string, v: string) => {
      if (o.storageQuebrado) throw new Error("QuotaExceeded");
      guardado[k] = v;
    },
  };
  class Blob {
    constructor(public partes: string[]) {}
  }
  class XMLHttpRequest {
    open() {}
    setRequestHeader() {}
    send(c: string) {
      enviados.push(c);
    }
  }
  const navigator = o.beacon === false ? {} : { sendBeacon: (_u: string, b: Blob) => (enviados.push(b.partes.join("")), true) };
  const window = { localStorage, location: { search: o.busca || "", replace: (u: string) => (destino = u) } };
  const math = Object.create(Math);
  math.random = () => o.aleatorio;
  new Function("window", "navigator", "Blob", "XMLHttpRequest", "Math", "setTimeout", "JSON", script)(window, navigator, Blob, XMLHttpRequest, math, (f: () => void) => atrasos.push(f), JSON);
  atrasos.forEach((f) => f());
  return { guardado, enviados: enviados.map((e) => JSON.parse(e)), destino };
}

Deno.test("divisão no navegador: sorteia pelo peso, guarda, conta visita e redireciona com utm_content", () => {
  const s = gerarScriptDeDivisao({ testeId: "teste-ab-1", endpoint: ENDPOINT, variantes: [{ ...VARIANTES[0], peso: 30 }, { ...VARIANTES[1], peso: 70 }] });
  const r1 = rodar(s, { aleatorio: 0.2, busca: "?utm_source=meta&utm_content=velho" });
  assertEquals(r1.guardado["ab:teste-ab-1"], "a");
  assertEquals(r1.enviados, [{ teste_id: "teste-ab-1", variante: "a", tipo: "visita" }]);
  assertEquals(r1.destino, "https://site.com.br/vendas-a?utm_source=meta&utm_content=a");
  const r2 = rodar(s, { aleatorio: 0.31 });
  assertEquals(r2.destino, "https://site.com.br/vendas-b?x=1&utm_content=b#preco");
  // Visitante que volta: mesma variante, mesmo com sorteio diferente.
  const r3 = rodar(s, { aleatorio: 0.99, armazenado: { "ab:teste-ab-1": "a" } });
  assertEquals(r3.enviados[0].variante, "a");
  // Sem localStorage (aba anônima travada): não quebra, sorteia e segue.
  const r4 = rodar(s, { aleatorio: 0.5, storageQuebrado: true, beacon: false });
  assertEquals(r4.enviados[0].variante, "b");
  assert(r4.destino.indexOf("vendas-b") >= 0);
});

Deno.test("conversão: só para quem passou pelo teste, uma vez por visitante", () => {
  const s = gerarScriptDeConversao({ testeId: "teste-ab-1", endpoint: ENDPOINT });
  assertEquals(rodar(s, { aleatorio: 0 }).enviados, []);
  const r = rodar(s, { aleatorio: 0, armazenado: { "ab:teste-ab-1": "b" } });
  assertEquals(r.enviados, [{ teste_id: "teste-ab-1", variante: "b", tipo: "conversao" }]);
  assertEquals(rodar(s, { aleatorio: 0, armazenado: r.guardado }).enviados, []);
});
