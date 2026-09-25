/**
 * Frente R (25/09): Central lenta, "bagunça" na Stop Informática e contexto
 * que não se atualizava. Trava o que foi corrigido.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ rpcFalha: false }));

vi.mock("@/integrations/supabase/client", () => {
  // Cadeia mínima do PostgREST: todo filtro devolve a própria cadeia e o await entrega as linhas.
  const cadeia = (linhas: unknown[]) => {
    const c: any = {};
    for (const m of ["select", "eq", "in", "is", "contains", "order", "limit", "gte"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok);
    return c;
  };
  return {
    supabase: {
      from: (tabela: string) =>
        tabela === "client_dossiers"
          ? cadeia([{ id: "d1", client_id: "c1", project_id: null, dossier_type: "contexto", version: 3, summary: null, content: "Loja de informática em Curitiba.", updated_at: "2026-09-25T10:00:00Z", effective_at: null, prior_version_id: null, change_reason: null }])
          : cadeia([{ metadata: { foco: "Campanha do mês", feito: [], proximos: [] }, created_at: "2026-09-22T10:00:00Z" }]),
      rpc: () =>
        estado.rpcFalha
          ? Promise.resolve({ data: null, error: { message: "function app_private.movimentos_do_cliente_bruto does not exist" } })
          : Promise.resolve({ data: [{ quando: "2026-09-25T13:00:00Z", tipo: "item_removido", titulo: 'Removido da agenda/execução: "Mouse em Giro"', titulo_cliente: "", detalhe: null, visivel_ao_cliente: false, origem: "tasks", ref_id: null, link: null }], error: null }),
    },
  };
});

import { contextoComoTexto, ehEntregue, lerContextoDoCliente } from "@/lib/contextoDaCentral";

const ler = (p: string) => readFileSync(resolve(__dirname, "..", "..", p), "utf8");
const central = ler("src/pages/AdminExperience.tsx");
const radar = ler("supabase/functions/radar-ideas/index.ts");

describe("entregue não é o mesmo que enviado para aprovação", () => {
  it("só conta compartilhado ou aprovado", () => {
    expect(ehEntregue({ visibility: "client_shared", approval_status: "none" })).toBe(true);
    expect(ehEntregue({ visibility: "approval", approval_status: "approved" })).toBe(true);
    expect(ehEntregue({ visibility: "approval", approval_status: "pending" })).toBe(false);
    expect(ehEntregue({ visibility: "approval", approval_status: "rejected" })).toBe(false);
    expect(ehEntregue({ visibility: "internal", approval_status: "none" })).toBe(false);
  });

  it("a mensagem e os fatos da Central leem a lista de entregues", () => {
    expect(central).toContain("const releasedWeek = entreguesFiles.filter(");
    expect(central).toContain("const releasedSinceMonday = entreguesFiles.filter(");
    expect(central).toContain("const liberadas = entreguesFiles.filter(");
    expect(central).toContain("const entregas = entreguesFiles.filter(");
  });
});

describe("a Central abre leve", () => {
  it("o que só serve para escrever mensagem espera a tela que usa", () => {
    const sobDemanda = central.match(/enabled: precisaContexto\b/g) || [];
    expect(sobDemanda.length).toBeGreaterThanOrEqual(9);
    expect(central).toContain("enabled: precisaHistorico");
    expect(central).toContain("enabled: precisaContexto && idsDosClientes.length > 0");
  });

  it("gerar e copiar esperam o contexto chegar", () => {
    expect(central).toContain("disabled={!contextoPronto}");
    expect((central.match(/if \(!contextoPronto\) \{ avisarContextoCarregando\(\); return; \}/g) || []).length).toBe(3);
  });

  it("material liberado tem janela e a memória só traz o que a mensagem usa", () => {
    expect(central).toContain(".gte(\"created_at\", desde)");
    expect(central).toContain("JANELA_DE_ENTREGAS_DIAS = 60");
    expect(central).toContain(".in(\"kind\", KINDS_DA_MEMORIA_DA_CENTRAL)");
  });

  it("trocar de cliente no Perfil não carrega estado do anterior", () => {
    expect(central).toContain("key={`dossie-${client.id}`}");
    expect(central).toContain("key={`diario-${client.id}`}");
  });
});

describe("Radar de ideias com o contexto certo", () => {
  it("materiais entregues são só os que chegaram ao cliente, e o briefing é lido", () => {
    expect(radar).toContain('.or("visibility.eq.client_shared,approval_status.eq.approved")');
    expect(radar).toContain('.select("responses, created_at")');
    expect(radar).not.toContain('.select("answers, created_at")');
    expect(radar).toContain("resumoDoCerebro(");
  });
});

describe("contexto do cliente diz o que não conseguiu ler", () => {
  beforeEach(() => { estado.rpcFalha = false; });

  it("lê dossiê, movimentos e plano juntos", async () => {
    const ctx = await lerContextoDoCliente("c1", { agora: new Date("2026-09-25T12:00:00Z") });
    expect(ctx.falhas).toEqual([]);
    expect(ctx.dossie?.geral?.version).toBe(3);
    expect(ctx.plano?.foco).toBe("Campanha do mês");
    expect(contextoComoTexto(ctx)).toContain("Mouse em Giro");
  });

  it("movimentos quebrados no banco viram aviso, não silêncio", async () => {
    estado.rpcFalha = true;
    const ctx = await lerContextoDoCliente("c1");
    expect(ctx.falhas).toEqual(["movimentos"]);
    expect(ctx.dossie?.geral).not.toBeNull();
    expect(contextoComoTexto(ctx)).toContain("não foi possível ler movimentos");
  });
});
