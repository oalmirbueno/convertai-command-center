import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { blocoDaBase, CABECALHO_DA_BASE, encherAteOTeto, type FichaDaBase, ordemPorPalavras, textoDaFicha } from "./base-do-agente.ts";
import { limparFichas, sistemaDoLeitor, tituloNormalizado } from "../base-dos-agentes/index.ts";
import { AGENTES_COM_BASE } from "./agentes-com-base.ts";

const ficha = (id: string, titulo: string, tecnica: string, client_id: string | null = null): FichaDaBase => ({
  id, titulo, tecnica, quando_usar: "", exemplo: "", client_id,
});

Deno.test("sem ficha, o bloco é vazio (o prompt sai igual)", () => {
  assertEquals(blocoDaBase([]), "");
});

Deno.test("o bloco leva o cabeçalho e marca a ficha só do cliente", () => {
  const b = blocoDaBase([ficha("1", "Gancho de contraste", "Abra com o antes e o depois na mesma lâmina.", "c1")]);
  assert(b.startsWith(CABECALHO_DA_BASE));
  assert(b.includes("- Gancho de contraste (só deste cliente): Abra com o antes"));
});

Deno.test("enche até o teto sem cortar ficha no meio", () => {
  const longa = ficha("1", "Longa", "x".repeat(900));
  const curta = ficha("2", "Curta", "Uma frase curta e útil.");
  const escolhidas = encherAteOTeto([longa, curta], CABECALHO_DA_BASE.length + textoDaFicha(curta).length + 2);
  assertEquals(escolhidas.map((f) => f.id), ["2"]);
});

Deno.test("sem o Jev, a ordem cai nas palavras do pedido (e a do cliente desempata)", () => {
  const fichas = [ficha("a", "Carrossel educativo", "Ensine em passos."), ficha("b", "Anúncio de oferta", "Preço e prazo na capa do anúncio."), ficha("c", "Oferta relâmpago", "Prazo curto visível.", "c1")];
  assertEquals(ordemPorPalavras(fichas, "anúncio com oferta e prazo").map((f) => f.id), ["b", "c", "a"]);
});

Deno.test("o leitor limpa, corta e não repete o que o agente já tem", () => {
  const bruto = { fichas: [
    { titulo: "Gancho de contraste", tecnica: "Abra com o antes e o depois.", quando_usar: "Transformação", exemplo: "", fonte_url: "javascript:alert(1)" },
    { titulo: "gancho de CONTRASTE!", tecnica: "Repetida com outro jeito de escrever.", quando_usar: "", exemplo: "", fonte_url: "" },
    { titulo: "Já existe", tecnica: "Esta o agente já sabe.", quando_usar: "", exemplo: "", fonte_url: "https://exemplo.com" },
    { titulo: "ok", tecnica: "curta", quando_usar: "", exemplo: "", fonte_url: "" },
  ] };
  const fichas = limparFichas(bruto, 12, new Set([tituloNormalizado("Já existe")]));
  assertEquals(fichas.map((f) => f.titulo), ["Gancho de contraste"]);
  assertEquals(fichas[0].fonte_url, "");
});

Deno.test("o leitor sabe de qual agente é e o que ele já tem", () => {
  const a = AGENTES_COM_BASE[0];
  const s = sistemaDoLeitor(a, ["Técnica antiga"], false);
  assert(s.includes(a.papel) && s.includes(a.tema) && s.includes("- Técnica antiga"));
  assert(sistemaDoLeitor(a, [], true).includes("PESQUISE na internet"));
});

Deno.test("as chaves do catálogo passam no CHECK do banco", () => {
  for (const a of AGENTES_COM_BASE) assert(/^[a-z]+\.[a-z_]+$/.test(a.chave), a.chave);
  assertEquals(new Set(AGENTES_COM_BASE.map((a) => a.chave)).size, AGENTES_COM_BASE.length);
});
