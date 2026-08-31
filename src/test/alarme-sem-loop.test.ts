import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O alarme que gritava em loop — e a culpa era da minha própria correção.
 *
 * Ao ampliar o alarme para enxergar `planned` (o ponto cego que deixou os
 * posts da aJenda passarem), esqueci da limpeza: ela apagava alertas de
 * publicação com `status <> 'scheduled'`, o que inclui `planned`.
 *
 *   alarme cria → limpeza apaga → dedup não acha → alarme cria de novo
 *
 * Três rascunhos × três admins, renascendo a cada quinze minutos. Alarme
 * em loop treina quem lê a ignorar alarme — o oposto do que eu quis.
 */

const raiz = resolve(__dirname, "../..");
const migracao = readFileSync(
  resolve(raiz, "supabase/migrations/20260901020000_o_alarme_para_de_gritar_em_loop.sql"), "utf8");

describe("a limpeza só apaga o que foi resolvido", () => {
  it("resolvido é publicado ou cancelado, não 'planned'", () => {
    expect(migracao).toContain("and p.status in ('published', 'cancelled')");
    // A condição antiga é justamente a que criava o ciclo.
    expect(migracao).not.toContain("and p.status <> 'scheduled'\n       )");
  });

  it("o ciclo está descrito no arquivo, para não voltar por esquecimento", () => {
    expect(migracao).toContain("alarme cria");
    expect(migracao).toContain("APAGA");
  });
});

describe("rascunho abandonado para de cobrar", () => {
  it("sem arte e velho não alarma; com arte alarma sempre", () => {
    // Uma publicação sem arte de cinco semanas atrás não é um post que
    // faltou: é rascunho abandonado. Com arte houve intenção de publicar.
    expect(migracao).toContain("coalesce(p.file_id, po.primary_file_id) is not null");
    expect(migracao).toContain("or p.scheduled_at >= now() - interval '7 days'");
  });

  it("o patch aborta se o filtro do alarme mudou de forma", () => {
    expect(migracao).toContain("patch_ancora_nao_encontrada");
    expect(migracao).toContain("pg_get_functiondef(_oid)");
  });

  it("limpa o rastro do loop, mas só dos rascunhos sem arte", () => {
    // Aviso de publicação COM arte é real e permanece.
    const limpeza = migracao.slice(migracao.indexOf("delete from public.notifications n"));
    expect(limpeza).toContain("and coalesce(p.file_id, po.primary_file_id) is null");
  });
});

describe("as listas longas ganham rolagem", () => {
  const pagina = readFileSync(resolve(raiz, "src/pages/AdminExecucao.tsx"), "utf8");

  it("concluídas e revisão não empurram a página", () => {
    expect(pagina).toContain('max-h-[60vh] space-y-2 overflow-y-auto');
  });

  it("a fila por operador também", () => {
    expect(pagina).toContain('max-h-[46vh] space-y-2 overflow-y-auto');
  });
});

describe("o Escritório recolhe o que está parado", () => {
  const esc = readFileSync(resolve(raiz, "src/components/execucao/Escritorio.tsx"), "utf8");

  it("área sem trabalho nasce recolhida", () => {
    // Nove áreas abertas, a maioria sem nada acontecendo, é o que fazia a
    // tela parecer cheia sem informar.
    expect(esc).toContain("abertasPelaPessoa.has(area) || urgencia < 90");
  });

  it("guarda as ABERTAS, para área nova não nascer escondida", () => {
    expect(esc).toContain("const [abertasPelaPessoa, setAbertasPelaPessoa]");
  });

  it("recolhido continua contando os agentes", () => {
    // Some o cartão, não o fato.
    expect(esc).toContain('"agente" : "agentes"');
    expect(esc).toContain("sem trabalho agora");
  });
});
