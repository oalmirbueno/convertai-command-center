import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mesa, 23/09: agente do mês (pedido livre com anexos), hypes da semana e
 * campanhas. Conferência pelo código da função e da migration.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const calendario = ler("supabase/functions/agente-calendario/index.ts");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const migration = ler("supabase/migrations/20260923171454_mesa_campanhas_e_hypes.sql");
const corpoDe = (fonte: string, nome: string) => {
  const i = fonte.indexOf(`async function ${nome}(`);
  const j = fonte.indexOf("\nasync function ", i + 10);
  return fonte.slice(i, j > 0 ? j : undefined);
};

describe("agente do mês: pedido livre", () => {
  const p = corpoDe(calendario, "pedidoLivre");
  it("aceita só anexos do próprio cliente e lê as imagens com o modelo", () => {
    const anexos = corpoDe(calendario, "baixarAnexos");
    expect(anexos).toContain("c.startsWith(`${clientId}/`)");
    expect(anexos).toContain('c.indexOf("..") < 0');
    expect(p).toContain("imagens: anexos.imagens.length ? anexos.imagens : undefined");
  });
  it("depoimento vira texto transcrito sem inventar", () => {
    expect(p).toContain("transcrito exatamente como está");
  });
  it("devolve uma proposta pronta (gravar e conversar continuam iguais) e guarda a conversa", () => {
    expect(p).toContain('status: "pronta"');
    expect(p).toContain('origem: "pedido_livre"');
    expect(p).toContain("registrarMensagens(servico, conversaId");
  });
});

describe("hypes da semana", () => {
  const h = corpoDe(calendario, "buscarHypes");
  it("uma busca por cliente e semana: sem forcar, devolve a guardada sem custo", () => {
    expect(h).toContain('if (corpo.forcar !== true)');
    expect(h).toContain("cache: true, custo_usd: 0");
    expect(migration).toContain("CONSTRAINT mesa_hypes_cliente_semana_unica UNIQUE (client_id, semana)");
  });
  it("pesquisa na web e ordena pela relevância do Jev, cobrada do cliente", () => {
    expect(h).toContain("pesquisaWeb: true");
    expect(h).toContain("await jevPerguntar(");
    expect(h).toContain("await cobrarJev(");
    expect(h).toContain("Nunca invente evento nem data.");
  });
});

describe("campanhas", () => {
  it("equipe lê e muda só nome, estado e referências; o resto vem da função", () => {
    expect(migration).toContain("GRANT UPDATE (nome, status, referencias_ids) ON public.mesa_campanhas TO authenticated;");
    expect(migration).toContain("public.can_access_client(client_id)");
  });
  it("campanha cria proposta pronta com os itens ligados à campanha e o gravar marca gravada", () => {
    const c = corpoDe(calendario, "campanhaCriar");
    expect(c).toContain('origem: "campanha"');
    expect(c).toContain(").campanha_id = campanhaId;");
    expect(calendario).toContain('update({ status: "gravada" }).eq("id", p.parametros.campanha_id)');
  });
  it("ajuste na conversa não perde o vínculo com a campanha", () => {
    expect(corpoDe(calendario, "conversar")).toContain("item.campanha_id = p.parametros.campanha_id");
  });
  it("o Estúdio segue a identidade da campanha e anexa o selo na capa e no fechamento", () => {
    expect(estudio).toContain("direcao.campanha_id = campanha.id;");
    expect(corpoDe(estudio, "gerarCard")).toContain("campanha?.selo_path && levaLogo(t, ordem)");
    expect(corpoDe(estudio, "gerarCard")).toContain("baseComCampanha");
  });
});
