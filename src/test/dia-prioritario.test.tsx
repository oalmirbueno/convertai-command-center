import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cargasDaSemana,
  coincideComODia,
  dataEmSP,
  diaDaSemanaDaData,
  diaDaSemanaEmSP,
  diaNaOperacao,
  diaVisivelAoCliente,
  ehCaptacao,
  ehHoje,
  ehRecorrenteParaODia,
  proximaData,
  sugerirDia,
  textoDaCaptacao,
  type CargaDoDia,
} from "@/lib/diaPrioritario";
import { COMO_USAR_O_DIA_PRIORITARIO } from "@/lib/diaPrioritario";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";

/**
 * Dia Prioritário do Cliente (12/10/2026, aprovado pelo CEO): um dia útil fixo de atenção estratégica
 * por cliente recorrente. Regras, a distribuição aprovada na migration, permissões, o cartão do
 * cliente, o vídeo (sem conteúdo fictício) e a leitura pelo Hermes.
 */

const ler = (caminho: string) => readFileSync(resolve(__dirname, "../..", caminho), "utf8");
const migration = ler("supabase/migrations/20261012060000_dia_prioritario.sql");

// 12/10/2026 é segunda-feira. 14/10 02:00 UTC ainda é terça (23h) em São Paulo.
const SEGUNDA_MEIO_DIA = new Date("2026-10-12T15:00:00Z");
const TERCA_23H_SP = new Date("2026-10-14T02:00:00Z");
const SABADO = new Date("2026-10-17T15:00:00Z");

describe("datas em São Paulo", () => {
  it("dia da semana e hoje no fuso, sem deslocar pela hora UTC", () => {
    expect(diaDaSemanaEmSP(SEGUNDA_MEIO_DIA)).toBe(1);
    expect(diaDaSemanaEmSP(TERCA_23H_SP)).toBe(2);
    expect(dataEmSP(TERCA_23H_SP)).toBe("2026-10-13");
    expect(ehHoje(2, TERCA_23H_SP)).toBe(true);
    expect(ehHoje(3, TERCA_23H_SP)).toBe(false);
    expect(diaDaSemanaDaData("2026-10-16")).toBe(5);
  });

  it("próxima data do dia: hoje conta; no fim de semana, a semana seguinte", () => {
    expect(proximaData(1, SEGUNDA_MEIO_DIA)).toBe("2026-10-12");
    expect(proximaData(2, SEGUNDA_MEIO_DIA)).toBe("2026-10-13");
    expect(proximaData(1, SABADO)).toBe("2026-10-19");
  });
});

describe("quem vê e quem tem direito", () => {
  it("o cliente vê só o confirmado; a operação usa confirmado e provisório", () => {
    expect(diaVisivelAoCliente({ dia: 2, situacao: "confirmado" })).toBe(2);
    expect(diaVisivelAoCliente({ dia: 2, situacao: "provisorio" })).toBeNull();
    expect(diaVisivelAoCliente({ dia: null, situacao: "nao_aplicavel" })).toBeNull();
    expect(diaNaOperacao({ dia: 2, situacao: "provisorio" })).toBe(2);
    expect(diaNaOperacao({ dia: 2, situacao: "sugerido" })).toBeNull();
  });

  it("recorrente: ativo ou em andamento, não avulso, não interno, não apagado", () => {
    expect(ehRecorrenteParaODia({ id: "a", plan_status: "active", client_type: "recurring" })).toBe(true);
    expect(ehRecorrenteParaODia({ id: "a", plan_status: "onboarding", client_type: "hybrid" })).toBe(true);
    expect(ehRecorrenteParaODia({ id: "a", plan_status: "standby", client_type: "hybrid" })).toBe(false); // Para Si sem renovação
    expect(ehRecorrenteParaODia({ id: "a", plan_status: "active", client_type: "one_off" })).toBe(false);
    expect(ehRecorrenteParaODia({ id: "a", plan_status: "active", client_type: "recurring", services_config: { internal_company: true } })).toBe(false);
    expect(ehRecorrenteParaODia({ id: "a", plan_status: "active", client_type: "recurring", deleted_at: "2026-01-01" })).toBe(false);
  });
});

describe("sugestão automática", () => {
  const carga = (dia: 1 | 2 | 3 | 4 | 5, o: Partial<CargaDoDia> = {}): CargaDoDia => ({ dia, clientes: 2, servicos: 8, entregas: 10, compromissos: 0, ...o });

  it("escolhe o dia mais leve, com os motivos, e respeita a indisponibilidade", () => {
    const cargas = [carga(1), carga(2), carga(3, { clientes: 3 }), carga(4, { clientes: 1, servicos: 3 }), carga(5)];
    const s = sugerirDia(cargas);
    expect(s?.dia).toBe(4);
    expect(s?.motivos[0]).toContain("quinta-feira");
    expect(sugerirDia(cargas, [4])?.dia).toBe(1); // empate: menos clientes, depois o mais cedo
    expect(sugerirDia(cargas, [1, 2, 3, 4, 5])).toBeNull();
  });

  it("captação marcada pesa no dia", () => {
    const cargas = [carga(1, { compromissos: 3 }), carga(2)];
    expect(sugerirDia(cargas)?.dia).toBe(2);
  });

  it("monta a carga da semana sem contar o próprio cliente, com provisório e sem sugerido", () => {
    const cargas = cargasDaSemana({
      dias: [
        { client_id: "a", dia: 1, situacao: "confirmado" },
        { client_id: "b", dia: 1, situacao: "provisorio" },
        { client_id: "c", dia: 2, situacao: "sugerido" },
        { client_id: "eu", dia: 3, situacao: "confirmado" },
      ],
      clientes: [{ id: "a", services_config: { social: true, trafego: true, internal_company: true } }, { id: "b", services_config: { design: true } }],
      tarefasAbertasPorCliente: { a: 4, b: 2 },
      captacoes: ["2026-10-13", "2026-10-20"],
      ignorar: "eu",
    });
    expect(cargas[0]).toEqual({ dia: 1, clientes: 2, servicos: 3, entregas: 6, compromissos: 0 });
    expect(cargas[1].clientes).toBe(0);
    expect(cargas[1].compromissos).toBe(2);
    expect(cargas[2].clientes).toBe(0);
  });
});

describe("captações", () => {
  it("reconhece gravação e captação pelo título e diz se cai no dia (preferência, nunca trava)", () => {
    expect(ehCaptacao({ title: "Gravação na loja com o time" })).toBe(true);
    expect(ehCaptacao({ title: "Captação de B-rolls" })).toBe(true);
    expect(ehCaptacao({ title: "Sessão de fotos dos produtos" })).toBe(true);
    expect(ehCaptacao({ title: "Carrossel de outubro" })).toBe(false);
    expect(coincideComODia("2026-10-13", 2)).toBe(true);
    expect(coincideComODia("2026-10-14", 2)).toBe(false);
    expect(coincideComODia("2026-10-14", null)).toBeNull();
    expect(textoDaCaptacao("2026-10-14", 2)).toBe("Fora do Dia Prioritário (terça-feira)");
  });
});

describe("a distribuição aprovada na migration", () => {
  const valores = migration.slice(migration.indexOf("WITH aprovada"), migration.indexOf("inseridos AS"));
  const linhas = [...valores.matchAll(/\('([0-9a-f-]{36})'::uuid, (\d|NULL)::smallint, '(\w+)'/g)].map((m) => ({ id: m[1], dia: m[2], situacao: m[3] }));

  it("11 clientes com dia, Stop provisório e Para Si fora da recorrência", () => {
    const comDia = linhas.filter((l) => l.dia !== "NULL");
    expect(comDia).toHaveLength(11);
    expect(comDia.filter((l) => l.dia === "1")).toHaveLength(2);
    expect(comDia.filter((l) => l.dia === "2")).toHaveLength(2);
    expect(comDia.filter((l) => l.dia === "3")).toHaveLength(2);
    expect(comDia.filter((l) => l.dia === "4")).toHaveLength(3);
    expect(comDia.filter((l) => l.dia === "5")).toHaveLength(2);
    expect(linhas.find((l) => l.id === "6a847578-ba39-44cd-be61-08e34e18e4c9")).toMatchObject({ dia: "2", situacao: "provisorio" }); // Stop
    expect(linhas.find((l) => l.id === "20c96cea-6ada-4db5-a408-25a3b0c978ba")).toMatchObject({ dia: "NULL", situacao: "nao_aplicavel" }); // Para Si
    expect(new Set(linhas.map((l) => l.id)).size).toBe(linhas.length); // Acerbi e CME: um cadastro só
    // Só IDs reais que existirem; nada é sobrescrito numa segunda vez.
    expect(migration).toContain("WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = a.client_id AND p.deleted_at IS NULL)");
    expect(migration).toContain("ON CONFLICT (client_id) DO NOTHING");
  });

  it("permissões: cliente lê só o próprio confirmado, escrita só pela RPC de admin, manual preservado", () => {
    expect(migration).toContain("USING (client_id = (select auth.uid()) AND situacao = 'confirmado')");
    expect(migration).toContain("REVOKE ALL ON TABLE public.cliente_dia_prioritario FROM anon, authenticated;");
    expect(migration).toContain("GRANT SELECT ON TABLE public.cliente_dia_prioritario TO authenticated;");
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*cliente_dia_prioritario[^;]*TO authenticated/);
    const definir = migration.slice(migration.indexOf("FUNCTION public.dia_prioritario_definir"), migration.indexOf("FUNCTION public.dia_prioritario_registrar"));
    expect(definir).toContain("PERFORM app_private.require_rpc_admin();");
    expect(definir).toContain("DIA_PRIORITARIO_MANUAL_PRESERVADO");
    expect(definir).toContain("INSERT INTO public.cliente_dia_prioritario_historico");
    const registrar = migration.slice(migration.indexOf("FUNCTION public.dia_prioritario_registrar"));
    expect(registrar).toContain("PERFORM app_private.require_rpc_client_staff(_client_id);");
    expect(registrar).toContain("'client_visible', false");
    expect(registrar).toContain("public.dossie_enfileirar(_client_id, 'dia_prioritario')");
    // Nada de cron, mensagem ou agenda criada pela migration.
    expect(migration).not.toMatch(/cron\.schedule|net\.http_post/);
  });

  it("vídeo: invisível ao cliente até publicar, e o banco recusa publicar sem vídeo", () => {
    expect(migration).toContain("USING (publicado OR COALESCE(public.is_staff((select auth.uid())), false))");
    expect(migration).toContain("NOT publicado OR (fonte = 'arquivo' AND video_path IS NOT NULL) OR (fonte = 'link' AND video_url IS NOT NULL)");
    expect(migration).toContain("publicado boolean NOT NULL DEFAULT false");
  });
});

describe("Hermes lê pela fonte oficial", () => {
  const tools = ler("supabase/functions/_shared/mcp-tools.ts");
  const servico = ler("supabase/functions/mcp-server/modulos/dia-prioritario.ts");

  it("duas ferramentas registradas com escopo granular e MCP 2.9.0", () => {
    expect(MCP_VERSION).toBe("2.9.0");
    expect(tools).toContain("aceleriq_dia_prioritario: 'clients:read'");
    expect(tools).toContain("aceleriq_dia_prioritario_registrar: 'clients:write'");
    expect(tools).toContain("  diaPrioritarioTool,\n  diaPrioritarioRegistrarTool,");
    expect(servico).toContain(".from('cliente_dia_prioritario')");
    expect(servico).toContain("canAccessClient(ctx, String(l.client_id))");
    expect(servico).toContain("_origem: 'hermes'");
  });

  it("o como usar separa antes, durante e depois e proíbe agir fora", () => {
    expect(COMO_USAR_O_DIA_PRIORITARIO).toMatch(/ANTES/);
    expect(COMO_USAR_O_DIA_PRIORITARIO).toMatch(/DURANTE/);
    expect(COMO_USAR_O_DIA_PRIORITARIO).toMatch(/DEPOIS/);
    expect(COMO_USAR_O_DIA_PRIORITARIO).toMatch(/Nunca envie mensagem/);
    expect(COMO_USAR_O_DIA_PRIORITARIO).not.toMatch(/[–—]/);
  });
});

// ------------------------------------------------------------------ o cartão do cliente

const estado = vi.hoisted(() => ({ dia: null as Record<string, unknown> | null, video: null as Record<string, unknown> | null }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const resposta = () => ({ data: tabela === "cliente_dia_prioritario" ? estado.dia : estado.video, error: null });
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => resposta();
    return q;
  };
  return {
    supabase: {
      from: (t: string) => consulta(t),
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://x/capa.jpg" }, error: null }) }) },
    },
  };
});

import CartaoDoDiaPrioritario from "@/components/dia-prioritario/CartaoDoDiaPrioritario";

function montar(props: { recorrente: boolean; agora?: Date }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CartaoDoDiaPrioritario clientId="c-1" recorrente={props.recorrente} agora={props.agora} />
    </QueryClientProvider>,
  );
}

describe("o cartão 'Seu Dia Prioritário'", () => {
  it("mostra o dia confirmado, a explicação e o acompanhamento da semana; sem vídeo, nada de player", async () => {
    estado.dia = { client_id: "c-1", dia: 2, situacao: "confirmado", origem: "manual", observacao: null, dias_indisponiveis: [], definido_por: null, atualizado_em: "x" };
    estado.video = { titulo: "Como funciona", fonte: null, video_path: null, video_url: null, capa_path: null, publicado: false, atualizado_em: "x" };
    montar({ recorrente: true, agora: SEGUNDA_MEIO_DIA });
    await screen.findByText(/Seu Dia Prioritário é toda/);
    expect(screen.getByText("terça-feira")).toBeTruthy();
    expect(screen.getByText(/segue acompanhado durante toda a semana/)).toBeTruthy();
    expect(screen.getByText(/Traga suas dúvidas/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entenda como funciona" })).toBeTruthy();
    expect(screen.queryByText("Hoje é seu Dia Prioritário!")).toBeNull();
    expect(screen.queryByText("Assistir ao vídeo")).toBeNull();
  });

  it("no próprio dia, o destaque discreto", async () => {
    estado.dia = { client_id: "c-1", dia: 2, situacao: "confirmado", origem: "manual", observacao: null, dias_indisponiveis: [], definido_por: null, atualizado_em: "y" };
    montar({ recorrente: true, agora: TERCA_23H_SP });
    await screen.findByText("Hoje é seu Dia Prioritário!");
  });

  it("provisório não aparece como dia para o cliente (estado neutro, sem dia inventado)", async () => {
    estado.dia = { client_id: "c-1", dia: 2, situacao: "provisorio", origem: "manual", observacao: null, dias_indisponiveis: [], definido_por: null, atualizado_em: "z" };
    const { container } = montar({ recorrente: true, agora: SEGUNDA_MEIO_DIA });
    await screen.findByText(/Estamos organizando o seu Dia Prioritário/);
    expect(container.textContent).not.toMatch(/terça-feira/);
  });

  it("avulso ou sem renovação, sem dia: o cartão não aparece", async () => {
    estado.dia = null;
    const { container } = montar({ recorrente: false });
    await waitFor(() => expect(container.querySelector("[data-dia-prioritario]")).toBeNull());
  });

  it("vídeo publicado aparece como miniatura com 'Assistir', sem tocar sozinho", async () => {
    estado.dia = { client_id: "c-1", dia: 4, situacao: "confirmado", origem: "manual", observacao: null, dias_indisponiveis: [], definido_por: null, atualizado_em: "w" };
    estado.video = { titulo: "Como funciona o seu Dia Prioritário", fonte: "link", video_path: null, video_url: "https://youtu.be/abc123", capa_path: null, publicado: true, atualizado_em: "v" };
    montar({ recorrente: true, agora: SEGUNDA_MEIO_DIA });
    await screen.findByText("Assistir ao vídeo");
    expect(document.querySelector("iframe")).toBeNull();
  });
});
