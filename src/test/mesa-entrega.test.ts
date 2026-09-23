import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mesa do cliente, etapa 3 (Entrega): contrato do banco, da função do
 * estúdio, da cobrança do Jev e da tela. Validado ponta a ponta no banco em
 * transação desfeita (envio, aprovação, reprovação e agendamento).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const migration = ler("supabase/migrations/20260922130000_mesa_entrega.sql");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const motor = ler("supabase/functions/_shared/ia-motor.ts");
const calendario = ler("supabase/functions/agente-calendario/index.ts");
const aba = ler("src/components/mesa/AbaEntrega.tsx");
const api = ler("src/lib/mesa/api.ts");
const agenda = ler("src/pages/EditorialCalendar.tsx");

describe("banco da Entrega", () => {
  it("usa os caminhos que já existem para enviar e agendar", () => {
    expect(migration).toContain("public.admin_release_file_now(_root.id, 'approval')");
    expect(migration).toContain("public.request_file_agency_review(_root.id)");
    expect(migration).toContain("public.save_editorial_post(_payload, NULL)");
  });

  it("o gatilho da aprovação nunca derruba a decisão do cliente", () => {
    const gatilho = migration.slice(
      migration.indexOf("CREATE FUNCTION public.mesa_entrega_acompanha_aprovacao()"),
      migration.indexOf("CREATE TRIGGER mesa_entrega_acompanha_aprovacao_trg"),
    );
    expect(gatilho).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(gatilho).toContain("RAISE WARNING");
    // Gatilho só anota e enfileira: o post nasce no cron.
    expect(gatilho).not.toContain("save_editorial_post");
    expect(gatilho).toContain("INSERT INTO public.mesa_agendamento_fila");
  });

  it("agenda só depois da aprovação, pelo cron de um minuto", () => {
    expect(migration).toContain("AFTER INSERT ON public.file_approval_events");
    expect(migration).toContain("cron.schedule('mesa-agendar-aprovados', '* * * * *'");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("chaves de idempotência têm forma de UUID versão 4 (a captura da Agenda exige)", () => {
    expect(migration).toContain("CREATE FUNCTION public.mesa_uuid_estavel(_semente text)");
    expect(migration).not.toMatch(/md5\('mesa-[a-z]+:'[^)]*\)::uuid/);
    expect(migration).toContain("'-4'");
  });

  it("segunda a sexta, no horário do cliente, nunca no passado", () => {
    expect(migration).toContain("extract(isodow FROM _d) < 6");
    expect(migration).toContain("_agora + interval '15 minutes'");
    expect(migration).toContain("hora_publicacao time NOT NULL DEFAULT '09:00'");
  });

  it("automático só com conexão ligada, até 10 lâminas e sha256 de todas", () => {
    expect(migration).toContain("cardinality(_t.file_ids) BETWEEN 1 AND 10");
    expect(migration).toContain("fr.sha256 IS NULL");
  });

  it("reprovação volta para o Estúdio e vira memória do diretor de arte", () => {
    expect(migration).toContain("entrega_rodada = entrega_rodada + 1");
    expect(migration).toContain("status = 'pronto'");
    expect(migration).toContain("INSERT INTO public.agente_memoria");
  });

  it("avisa a equipe no agendamento e quando precisa de atenção, com link que a Mesa entende", () => {
    expect(migration).toContain("public.avisar_equipe(");
    expect(migration).toContain("'/mesa?client='");
    expect(migration).not.toContain("'/mesa?cliente='");
  });

  it("ajustes e previsão só para quem pode", () => {
    expect(migration).toMatch(/mesa_config_salvar[\s\S]*has_role\(_uid, 'admin'::public\.app_role\) OR public\.has_role\(_uid, 'manager'::public\.app_role\)/);
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.mesa_agendar_aprovados() TO service_role;");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.mesa_agendar_aprovados() FROM PUBLIC, anon, authenticated;");
  });
});

describe("função do estúdio", () => {
  it("nova rodada de entrega vira arquivo novo, e a rodada 1 mantém a chave antiga", () => {
    expect(estudio).toContain("`estudio-arte:${t.id}:r${rodada}:${i}`");
    expect(estudio).toContain("`estudio-arte:${t.id}:${i}`");
  });

  it("cada lâmina entregue leva sha256", () => {
    expect(estudio).toContain("sha256: await sha256Hex(lamina.bytes)");
  });
});

describe("custo do Jev na carteira", () => {
  it("o motor cobra pelo preço público (US$ 0,042 por milhão de tokens de entrada)", () => {
    expect(motor).toContain("export const JEV_PRECO_ENTRADA_1M = 0.042;");
    expect(motor).toContain("export async function cobrarJev(");
    expect(motor).toContain('_agente: "jev"');
  });

  it("toda pergunta ao Jev da Mesa é cobrada do cliente", () => {
    // Temas (aderência e potencial) e hypes da semana (relevância para o cliente).
    expect((calendario.match(/await cobrarJev\(/g) || []).length).toBe(2);
    // Referências, identidade e hashtags da legenda: cada pergunta tem a sua cobrança.
    expect((estudio.match(/await cobrarJev\(/g) || []).length).toBe(3);
    expect((calendario.match(/await jevPerguntar\(/g) || []).length).toBe(2);
    expect((estudio.match(/await jevPerguntar\(/g) || []).length).toBe(3);
  });
});

describe("tela", () => {
  it("a Entrega envia de verdade e não está mais em breve", () => {
    expect(aba).toContain("enviarParaAprovacao(ids)");
    expect(aba).not.toContain("em breve");
    expect(api).toContain('rpc("mesa_enviar_para_aprovacao"');
    expect(api).toContain('rpc("mesa_previsao_cliente"');
  });

  it("a Agenda avisa quando a arte do item está na Mesa", () => {
    expect(agenda).toContain('from("estudio_trabalhos")');
    expect(agenda).toContain("Abrir na Mesa");
  });

  it("sem regex moderna nos arquivos novos da tela", () => {
    for (const texto of [aba, api]) {
      expect(texto).not.toContain("(?<=");
      expect(texto).not.toContain("(?<!");
      expect(texto).not.toMatch(/\\p\{/);
    }
  });
});
