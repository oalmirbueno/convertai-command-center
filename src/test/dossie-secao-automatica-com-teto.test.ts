// Seção automática do dossiê com teto (14/10/2026): 14 dias, até 12 mil caracteres de itens,
// o resto vira uma linha "(+N movimentos mais antigos...)". Mesmas permissões de antes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migracao = readFileSync("supabase/migrations/20261014200000_dossie_secao_automatica_com_teto.sql", "utf8");

describe("seção automática do dossiê com teto de tamanho", () => {
  it("redefine a mesma função, com a mesma assinatura", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.dossie_avancos_texto(_client_id uuid, _dias integer DEFAULT 14)");
    expect(migracao).toContain("SECURITY DEFINER");
  });
  it("corta pelo tamanho acumulado do mais recente para o mais antigo, sem perder o último movimento", () => {
    expect(migracao).toContain("sum(length(linha) + 1) OVER (ORDER BY quando DESC, pos ROWS UNBOUNDED PRECEDING)");
    expect(migracao).toContain("WHERE soma <= 12000 OR pos = 1");
  });
  it("avisa quantos movimentos ficaram de fora em vez de esconder", () => {
    expect(migracao).toContain("movimentos mais antigos no histórico completo.)");
  });
  it("mantém o mesmo cabeçalho que a gravação do dossiê usa como marcador", () => {
    expect(migracao).toContain("'## Avanços recentes (automático, '");
  });
  it("continua fechada para usuários comuns", () => {
    expect(migracao).toContain("REVOKE EXECUTE ON FUNCTION public.dossie_avancos_texto(uuid, integer) FROM PUBLIC, anon, authenticated;");
  });
});
