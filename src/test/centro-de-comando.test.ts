import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  categoriaDaTarefa,
  origemDaExecucao,
  passaNoFiltro,
} from "@/lib/execucaoBadges";

/**
 * O centro de comando: participação, aprovação explicada, proposta de
 * responsável, pausa honesta e filtros.
 *
 * Cada teste aqui pina uma REGRA, não uma linha de código: o que não pode
 * voltar é o comportamento antigo (selo genérico, pausado erra como
 * inexistente, assigned_to escrito por inferência).
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const migracao = ler("supabase/migrations/20260829010000_participacao_aprovacao_e_propostas.sql");
const servicos = ler("supabase/functions/_shared/aceleriq-operators-services.ts");
const tools = ler("supabase/functions/_shared/mcp-tools.ts");
const pagina = ler("src/pages/AdminExecucao.tsx");

describe("a migracao do centro de comando", () => {
  it("cria as tres entidades", () => {
    for (const t of ["operator_participations", "operator_approvals", "assignment_proposals"]) {
      expect(migracao).toContain(`create table if not exists public.${t}`);
    }
  });

  it("assigned_to so muda dentro da decisao humana", () => {
    // A UNICA escrita em tasks nesta migracao e a do RPC de decisao — que
    // exige admin. Uma segunda escrita seria o agente entrando pela janela.
    const escritas = migracao.match(/update public\.tasks/g) ?? [];
    expect(escritas).toHaveLength(1);
    const posDecidir = migracao.indexOf("assignment_proposal_decidir");
    expect(migracao.indexOf("update public.tasks")).toBeGreaterThan(posDecidir);
    expect(migracao).toContain("if not public.has_role(auth.uid(), 'admin'::public.app_role) then");
  });

  it("o patch de pausa aborta se a ancora sumir", () => {
    // Patch textual sobre definicao viva: sem a ancora exata, a migration
    // ERRA ALTO em vez de fingir que corrigiu.
    expect(migracao).toContain("patch_ancora_nao_encontrada");
    expect(migracao).toContain("pg_get_functiondef");
    expect(migracao).toContain("operator_paused:");
  });

  it("reconcilia o catalogo de status do operador", () => {
    // operator_update ja aceitava paused/retired; o CHECK da tabela nao.
    // Dois catalogos para o mesmo campo, um deles mentindo.
    expect(migracao).toContain("check (status in ('active', 'paused', 'retired', 'inactive'))");
  });

  it("o payload aprovavel e imutavel por trigger", () => {
    expect(migracao).toContain("operator_approval_payload_imutavel");
    expect(migracao).toContain("new.payload is distinct from old.payload");
  });

  it("aprovacao sem explicacao nao entra na fila", () => {
    expect(migracao).toContain("explicacao_obrigatoria");
  });

  it("uma proposta pendente por tarefa", () => {
    expect(migracao).toContain("assignment_proposals_uma_pendente");
    expect(migracao).toContain("where status = 'pendente'");
  });

  it("diario nao vira spam: so pedido de insumo e revisao notificam", () => {
    expect(migracao).toContain("if _entry_type in ('pedido_insumo', 'pedido_revisao') then");
  });
});

describe("o mcp expoe a participacao", () => {
  it("os tres servicos existem e estao registrados", () => {
    for (const fn of ["operatorDiary", "operatorRequestApproval", "operatorProposeAssignee"]) {
      expect(servicos).toContain(`export async function ${fn}(`);
      expect(tools).toContain(fn);
    }
    for (const nome of [
      "aceleriq_operator_diary",
      "aceleriq_operator_request_approval",
      "aceleriq_operator_propose_assignee",
    ]) {
      expect(tools).toContain(`name: '${nome}'`);
    }
  });

  it("o board carrega aprovacoes e propostas pendentes", () => {
    expect(servicos).toContain("aprovacoes_pendentes:");
    expect(servicos).toContain("propostas_de_responsavel_pendentes:");
    // Falha de leitura vira { falha }, nunca lista vazia calada.
    expect(servicos).toContain("? { falha: aprovacoes.error.message }");
  });

  it("a versao subiu junto nos dois arquivos", () => {
    expect(tools).toContain("version: '1.40.0'");
    expect(ler("supabase/functions/mcp-oauth-metadata/index.ts")).toContain("const MCP_VERSION = '1.40.0';");
  });

  it("nome ambiguo de pessoa e recusado listando candidatos", () => {
    expect(servicos).toContain("nome ambiguo; use suggested_profile_id");
  });
});

describe("os badges do cartao", () => {
  it("origem: aprovacao pendente e externo bloqueado", () => {
    expect(origemDaExecucao({ status: "in_progress", approval_required: true })).toBe("externo_bloqueado");
    expect(origemDaExecucao({ status: "awaiting_input" })).toBe("aguardando_almir");
    expect(origemDaExecucao({ status: "in_progress" })).toBe("interno");
    // Concluida nao fica "bloqueada" por um selo que sobrou.
    expect(origemDaExecucao({ status: "done", approval_required: true })).toBe("interno");
  });

  it("categoria: QA vence conteudo quando o titulo tem os dois", () => {
    expect(categoriaDaTarefa("QA do carrossel de agosto")).toBe("qa");
    expect(categoriaDaTarefa("Carrossel dia dos pais")).toBe("conteudo");
    expect(categoriaDaTarefa("Meta Ads: campanha Bacacheri")).toBe("midia");
    expect(categoriaDaTarefa("Runbook de deploy")).toBe("documentacao");
    expect(categoriaDaTarefa("Alinhar contrato")).toBe("geral");
  });
});

describe("o filtro do quadro", () => {
  const base = { busca: "", cliente: "", prazo: "todas" as const, hoje: "2026-08-29" };

  it("busca acha por cliente e por operador", () => {
    expect(passaNoFiltro({ ...base, busca: "preserva", nomeCliente: "Preserva Eco", titulo: "x" })).toBe(true);
    expect(passaNoFiltro({ ...base, busca: "atlas", nomeOperador: "Atlas", titulo: "x" })).toBe(true);
    expect(passaNoFiltro({ ...base, busca: "nada-disso", titulo: "outra coisa" })).toBe(false);
  });

  it("vencidas exclui as concluidas", () => {
    // Cobrar prazo de tarefa entregue e ruido, nao vigilancia.
    expect(passaNoFiltro({ ...base, prazo: "vencidas", dueDate: "2026-07-18", statusFinal: false })).toBe(true);
    expect(passaNoFiltro({ ...base, prazo: "vencidas", dueDate: "2026-07-18", statusFinal: true })).toBe(false);
    expect(passaNoFiltro({ ...base, prazo: "vencidas", dueDate: "2026-09-10", statusFinal: false })).toBe(false);
  });

  it("semana corta em sete dias", () => {
    expect(passaNoFiltro({ ...base, prazo: "semana", dueDate: "2026-09-03" })).toBe(true);
    expect(passaNoFiltro({ ...base, prazo: "semana", dueDate: "2026-09-20" })).toBe(false);
  });
});

describe("a tela participa", () => {
  it("os tres paineis novos estao montados", () => {
    for (const c of ["AprovacoesExplicadas", "PropostasDeResponsavel", "DiarioDaExecucao"]) {
      expect(pagina).toContain(`<${c}`);
    }
  });

  it("a evidencia aparece inteira, sem truncar", () => {
    // O trecho da evidencia usa break-all; truncate ali escondia
    // exatamente a parte que prova a entrega.
    const trecho = pagina.slice(pagina.indexOf("{v.last_evidence && ("));
    const linha = trecho.slice(0, trecho.indexOf("evidência:"));
    expect(linha).toContain("break-all");
    expect(linha).not.toContain("truncate");
  });

  it("os deep-links de aprovacao, proposta e diario sao lidos", () => {
    expect(pagina).toContain('searchParams.get("aprovacao")');
    expect(pagina).toContain('searchParams.get("proposta")');
    expect(pagina).toContain('abaAlvo === "diario"');
  });

  it("a pausa por operador existe no perfil", () => {
    const perfil = ler("src/components/execucao/PerfilDoAgente.tsx");
    expect(perfil).toContain('rpc("operator_pausar"');
    expect(perfil).toContain("pausar operador");
  });
});
