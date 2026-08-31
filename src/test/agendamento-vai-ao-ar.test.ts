import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A falha de 31/08 as 11:28, e as quatro pontas que a permitiram.
 *
 * Um post da aJenda com arte APROVADA PELO CLIENTE em 27/08, conta
 * conectada e horario marcado nao saiu — e ninguem foi avisado.
 *
 * A cadeia, apurada no banco:
 *   1. As tarefas do Kanban foram de `review` para `doing` as 12:46, duas
 *      horas antes do post.
 *   2. O sync arrastou os posts de `ready` para `production`.
 *   3. Post em `production` nao passa no guard "requires ready content",
 *      entao a publicacao nunca virava `scheduled`.
 *   4. O publicador so olha `scheduled` (attempt_count zero: nunca tentou).
 *   5. E o alarme filtrava `status = 'scheduled'`: `planned` era invisivel.
 *
 * Cada teste aqui pina uma dessas pontas.
 */

const raiz = resolve(__dirname, "../..");
const migracao = readFileSync(
  resolve(raiz, "supabase/migrations/20260831020000_agendado_aprovado_vai_ao_ar.sql"),
  "utf8",
);

describe("aprovado com hora marcada vira agendado sozinho", () => {
  it("a aprovacao e uma linha so: a arte estar liberada", () => {
    // Nao existe terceiro passo. Admin subiu = aprovou; cliente aprovou =
    // conta. `editorial_file_is_publishable` ja responde as duas coisas.
    expect(migracao).toContain("editorial_promover_planejados");
    expect(migracao).toContain("coalesce(public.editorial_file_is_publishable(");
  });

  it("usa a transicao oficial, e nao um update de status na mao", () => {
    // Escrever o status direto pularia guards, evento e versao.
    expect(migracao).toContain("transition_editorial_publication_unlocked");
    expect(migracao).not.toMatch(/update public\.editorial_publications\s+set status/i);
  });

  it("cria o snapshot de entrega que faltava", () => {
    // Sem ele um save posterior volta a abortar com
    // "delivery snapshot is unresolved" e a publicacao trava de novo.
    expect(migracao).toContain("editorial_publication_delivery_requests");
    expect(migracao).toContain("on conflict (publication_id) do nothing");
  });

  it("assume o admin porque o cron nao tem JWT", () => {
    expect(migracao).toContain("set_config('request.jwt.claims'");
    expect(migracao).toContain("nenhum admin cadastrado");
  });

  it("atrasado demais NAO publica sozinho", () => {
    // Um post de cinco dias vira ruido no perfil do cliente. Passou da
    // janela, o painel avisa em vez de publicar.
    expect(migracao).toContain("_janela_de_atraso interval default interval '6 hours'");
    expect(migracao).toContain("p.scheduled_at >= now() - _janela_de_atraso");
  });

  it("uma falha nao derruba as outras, e vai nomeada", () => {
    expect(migracao).toContain("_falhas := _falhas || jsonb_build_object");
    expect(migracao).toContain("'erro', sqlerrm");
  });
});

describe("o Kanban nao desaprova o que ja foi aprovado", () => {
  it("a trava cobre a publicacao `planned` aprovada e com data", () => {
    // O guard antigo so protegia de `scheduled` em diante; `planned` era
    // tratado como "nada comprometido ainda". Era essa a brecha.
    expect(migracao).toContain("IF _to_status <> 'ready' AND EXISTS (");
    expect(migracao).toContain("AND publication.status = 'planned'");
    expect(migracao).toContain("AND publication.scheduled_at IS NOT NULL");
  });

  it("so bloqueia quem REBAIXA; avancar continua livre", () => {
    expect(migracao).toContain("_to_status <> 'ready'");
  });

  it("a recusa explica o que fazer", () => {
    expect(migracao).toContain("cancele ou reagende a publicação na Agenda primeiro");
  });
});

describe("o alarme deixa de ter ponto cego", () => {
  it("enxerga `planned` alem de `scheduled`", () => {
    expect(migracao).toContain("p.status in ('scheduled', 'planned')");
  });

  it("nomeia o card que andou para tras", () => {
    expect(migracao).toContain("o card andou para tras no Kanban");
  });

  it("distingue os motivos de `planned`", () => {
    for (const m of ["nao ha arte anexada", "falta conectar a conta", "ainda nao esta aprovada"]) {
      expect(migracao).toContain(m);
    }
  });
});

describe("promover acontece antes de publicar, no mesmo minuto", () => {
  it("funcao propria, nao um SELECT com duas chamadas", () => {
    // A ordem de avaliacao dos itens de um SELECT nao e garantida:
    // publicar antes de promover perderia o minuto marcado.
    expect(migracao).toContain("editorial_ciclo_publicacao");
    expect(migracao).toMatch(/_promocao := public\.editorial_promover_planejados\(\);[\s\S]{0,80}_tick := public\.editorial_autopublish_tick\(\);/);
  });

  it("o cron de cada minuto passa a chamar o ciclo", () => {
    expect(migracao).toContain("'SELECT public.editorial_ciclo_publicacao();'");
    expect(migracao).toContain("'* * * * *'");
  });
});

describe("recuperar um atrasado exige horario novo", () => {
  it("a transicao recusa passado, entao a janela precisa de um horario presente", () => {
    // Sem isto a janela de 6 horas seria decorativa: o horario de um post
    // atrasado so envelhece, e ele ficaria preso para sempre.
    expect(migracao).toContain("_quando := greatest(_pub.scheduled_at, now() + interval '1 minute')");
    expect(migracao).toContain("'scheduled_at', _quando,");
    expect(migracao).toContain("_pub.version, _quando, _pub.tz");
  });
});
