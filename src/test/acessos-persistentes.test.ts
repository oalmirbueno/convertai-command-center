import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMO_PEDIR_ACESSO, MANTER_A_SESSAO } from "../../supabase/functions/mcp-server/modulos/acesso-regras";

/**
 * 19/10/2026 (dono, com o print de "Acessos pedidos": "melhore essa parte de acesso, que fique
 * persistente e cuide para não cair, e opção de concluir para ele sair dali"). Dois pedidos de
 * código da Kiwify ficaram abertos para sempre (o de 02:20 já tinha sido substituído) porque código
 * não vencia e pedido novo não fechava o antigo.
 */

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const migration = () => ler("supabase/migrations/20261019214916_acessos_persistentes.sql");

describe("pedidos de acesso não ficam sobrando", () => {
  it("Concluir: o dono tira o pedido da lista (qualquer tipo); fica como usado, sem código guardado", () => {
    const sql = migration();
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.pedido_acesso_concluir(p_pedido uuid)");
    expect(sql).toContain("app_private.pedido_acesso_exigir_equipe()");
    expect(sql).toMatch(/status = 'usado',\s*codigo = NULL/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.pedido_acesso_concluir(uuid) FROM PUBLIC, anon");
  });

  it("pedido de código vence em 2 horas e pedido novo fecha o antigo do mesmo site", () => {
    const sql = migration();
    expect(sql).toContain("interval '2 hours'");
    expect(sql).toContain("BEFORE INSERT ON public.pedidos_de_acesso");
    expect(sql).toContain("AFTER INSERT ON public.pedidos_de_acesso");
    expect(sql).toMatch(/status = 'expirado'/);
    expect(sql).not.toMatch(/40001/);
  });

  it("a limpeza de hoje fecha os abertos repetidos e os códigos velhos", () => {
    const sql = migration();
    expect(sql).toContain("row_number() OVER");
    expect(sql).toMatch(/created_at < now\(\) - interval '2 hours'/);
  });
});

describe("o agente cuida para a sessão não cair", () => {
  it("a regra de manter a sessão vai nas instruções e junto da senha e do código", () => {
    expect(MANTER_A_SESSAO).toMatch(/perfil persistente/);
    expect(MANTER_A_SESSAO).toMatch(/não saia da conta/);
    expect(COMO_PEDIR_ACESSO).toContain(MANTER_A_SESSAO);
    const modulo = ler("supabase/functions/mcp-server/modulos/acesso.ts");
    expect(modulo).toContain("REGRAS_DA_SENHA + ' ' + MANTER_A_SESSAO");
    expect(modulo).toContain("regras: `${REGRAS_DA_SENHA} ${MANTER_A_SESSAO}`");
  });

  it("a lista e a janela usam o Concluir", () => {
    expect(ler("src/hooks/usePedidosDeAcesso.ts")).toContain('chamar("pedido_acesso_concluir"');
    expect(ler("src/components/acesso/PedidosDeAcesso.tsx")).toContain("concluirPedido(");
    expect(ler("src/components/acesso/JanelaDoPedidoDeAcesso.tsx")).toContain("concluirPedido(");
  });
});
