import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { blocoDaBase, CABECALHO_DA_BASE, encherAteOTeto, type FichaDaBase, ordemPorPalavras, textoDaFicha } from "../functions/_shared/base-do-agente.ts";
import { limparFichas, sistemaDoLeitor, tituloNormalizado } from "../functions/base-dos-agentes/index.ts";
import { AGENTES_COM_BASE } from "../functions/_shared/agentes-com-base.ts";

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

// ---------------------------------------------------------------- 23/10: Biblioteca da casa
import { baseDoAgente, MAX_DA_CASA, PARTE_DA_CASA } from "../functions/_shared/base-do-agente.ts";
import { BIBLIOTECA_DA_CASA, urlDoDocumento } from "../functions/base-dos-agentes/biblioteca-da-casa.ts";
import { ARQUIVO_DA_MIGRATION, sqlDaBiblioteca } from "../functions/base-dos-agentes/gerar-seed-da-biblioteca.ts";
import { ligarBibliotecaDaCasa } from "../functions/base-dos-agentes/index.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Sem chave do Jev nos testes: a seleção cai na ordem por palavras (e nada sai para a rede).
for (const n of ["TYPESAFE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  try { Deno.env.delete(n); } catch { /* sem permissão de ambiente: já não lê */ }
}

type Linha = Record<string, unknown>;
/** Banco de mentira só com o que a base usa: select/update com eq, is, like, in, or, order, limit; rpc no-op. */
function bancoFalso(linhas: Linha[]) {
  class Consulta {
    filtros: Array<(l: Linha) => boolean> = [];
    mudar: Linha | null = null;
    eq(c: string, v: unknown) { this.filtros.push((l) => l[c] === v); return this; }
    is(c: string, v: unknown) { this.filtros.push((l) => (l[c] ?? null) === v); return this; }
    like(c: string, p: string) { const pre = p.replace(/%$/, ""); this.filtros.push((l) => typeof l[c] === "string" && (l[c] as string).startsWith(pre)); return this; }
    in(c: string, vs: unknown[]) { this.filtros.push((l) => vs.includes(l[c])); return this; }
    or(_: string) { return this; }
    order() { return this; }
    limit() { return this; }
    select() { return this; }
    update(p: Linha) { this.mudar = p; return this; }
    then<T>(ok: (r: { data: Linha[]; error: null }) => T) {
      const achadas = linhas.filter((l) => this.filtros.every((f) => f(l)));
      if (this.mudar) achadas.forEach((l) => Object.assign(l, this.mudar));
      return Promise.resolve({ data: achadas.map((l) => ({ ...l })), error: null }).then(ok);
    }
  }
  return {
    from: () => new Consulta(),
    rpc: () => Promise.resolve({ error: null }),
  } as unknown as SupabaseClient;
}

const linhasDaCasa = (agente: string): Linha[] =>
  BIBLIOTECA_DA_CASA[agente].map((d, i) => ({
    id: `${agente}-${i}`, agente, client_id: null, titulo: d.titulo, tecnica: d.tecnica, quando_usar: d.quando_usar, exemplo: d.exemplo,
    fonte_url: urlDoDocumento(agente, d.slug), ativa: true, arquivada_por: null,
  }));

Deno.test("biblioteca da casa: de 5 a 15 documentos para cada agente do catálogo, dentro dos limites do banco", () => {
  assertEquals(Object.keys(BIBLIOTECA_DA_CASA).sort(), AGENTES_COM_BASE.map((a) => a.chave).sort());
  for (const [agente, docs] of Object.entries(BIBLIOTECA_DA_CASA)) {
    assert(docs.length >= 5 && docs.length <= 15, `${agente}: ${docs.length}`);
    assertEquals(new Set(docs.map((d) => d.slug)).size, docs.length, `${agente}: slug repetido`);
    for (const d of docs) {
      assert(d.titulo.length >= 3 && d.titulo.length <= 160, d.titulo);
      assert(d.tecnica.length >= 10 && d.tecnica.length <= 2400, d.titulo);
      assert(d.quando_usar.length <= 400 && d.exemplo.length <= 600, d.titulo);
      // Curto o bastante para 3 caberem na metade do teto padrão.
      assert(textoDaFicha({ id: "x", client_id: null, ...d }).length <= 1000, `${agente}/${d.slug} longo demais`);
    }
  }
});

Deno.test("biblioteca da casa: a migration é a que o gerador escreve (seed com todos os documentos)", async () => {
  const sql = await Deno.readTextFile(new URL(`../../${ARQUIVO_DA_MIGRATION}`, import.meta.url));
  assertEquals(sql.replace(/\r\n/g, "\n"), sqlDaBiblioteca());
  for (const [agente, docs] of Object.entries(BIBLIOTECA_DA_CASA)) {
    for (const d of docs) assert(sql.includes(`'${urlDoDocumento(agente, d.slug)}'`), d.slug);
  }
  assert(sql.includes("'casa_desligada'"));
});

Deno.test("biblioteca da casa: no máximo 3 por pedido e nunca mais da metade do teto", () => {
  const casa = linhasDaCasa("mes.estrategista") as unknown as FichaDaBase[];
  const dono = [ficha("d1", "Do dono", "Uma técnica que o dono ensinou e que precisa entrar."), ficha("d2", "Outra do dono", "Mais uma técnica do dono.")];
  for (const teto of [6_000, 5_000, 3_000, 2_500]) {
    const escolhidas = encherAteOTeto([...casa, ...dono], teto);
    const daCasa = escolhidas.filter((f) => f.fonte_url);
    assert(daCasa.length <= MAX_DA_CASA, `teto ${teto}`);
    assert(daCasa.reduce((s, f) => s + textoDaFicha(f).length + 1, 0) <= teto * PARTE_DA_CASA, `teto ${teto}`);
    assert(blocoDaBase(escolhidas).length <= teto, `teto ${teto}`);
    // As do dono continuam cabendo.
    assert(escolhidas.some((f) => f.id === "d1") && escolhidas.some((f) => f.id === "d2"), `teto ${teto}`);
  }
});

Deno.test("biblioteca da casa: cada agente recebe os documentos que servem ao pedido, dentro do teto", async () => {
  const casos: Array<[string, string, string]> = [
    ["mes.estrategista", "Planeje o mês de uma clínica de odontologia", "nicho-odontologia"],
    ["mes.estrategista", "Campanha de Black Friday da loja de moda com fases", "campanha-por-fase"],
    ["ads.estatico", "Anúncio com a política da Meta revisada para estética", "politica-da-meta"],
    ["roteiros.roteirista", "Roteiro com gancho forte para Reel", "formulas-de-gancho"],
    ["site.agente", "Copy da seção de dúvidas frequentes do site", "faq-de-objecao"],
  ];
  for (const [agente, pedido, slug] of casos) {
    const r = await baseDoAgente(bancoFalso(linhasDaCasa(agente)), { agente, clientId: null, pedido, tarefa: "calendario" });
    const teto = 6_000;
    assert(r.bloco.length > 0 && r.bloco.length <= teto, agente);
    assert(r.ids.length >= 1 && r.ids.length <= MAX_DA_CASA, `${agente}: ${r.ids.length}`);
    const doc = BIBLIOTECA_DA_CASA[agente].find((d) => d.slug === slug)!;
    assert(r.bloco.includes(doc.titulo), `${agente}: esperava "${doc.titulo}" para "${pedido}"`);
  }
  // Teto apertado (vídeo de Ads): ainda cabe e não estoura.
  const v = await baseDoAgente(bancoFalso(linhasDaCasa("ads.video")), { agente: "ads.video", clientId: null, pedido: "gancho dos 3 primeiros segundos", teto: 2_500, tarefa: "calendario" });
  assert(v.bloco.length > 0 && v.bloco.length <= 2_500);
});

Deno.test("biblioteca da casa: desligar tira da geração e religar só volta o que a chave desligou", async () => {
  const agente = "videos.diretor";
  const linhas = linhasDaCasa(agente);
  linhas[0].ativa = false; // o dono desligou esta sozinho
  linhas.push({ id: "dono", agente, client_id: null, titulo: "Ficha do dono", tecnica: "Técnica ensinada pelo dono.", quando_usar: "", exemplo: "", fonte_url: null, ativa: true, arquivada_por: null });
  const db = bancoFalso(linhas);
  const pedido = "Reel com gancho e chamada final";
  assert((await baseDoAgente(db, { agente, clientId: null, pedido, tarefa: "conversa" })).ids.some((id) => id !== "dono"));

  const desligadas = await ligarBibliotecaDaCasa(db, agente, false);
  assertEquals(desligadas, linhas.length - 2);
  const sem = await baseDoAgente(db, { agente, clientId: null, pedido, tarefa: "conversa" });
  assertEquals(sem.ids, ["dono"]);
  assert(linhas.filter((l) => l.fonte_url && l.id !== linhas[0].id).every((l) => l.arquivada_por === "casa_desligada"));

  const religadas = await ligarBibliotecaDaCasa(db, agente, true);
  assertEquals(religadas, linhas.length - 2);
  assertEquals(linhas[0].ativa, false);
  assert((await baseDoAgente(db, { agente, clientId: null, pedido, tarefa: "conversa" })).ids.some((id) => id !== "dono"));
});
