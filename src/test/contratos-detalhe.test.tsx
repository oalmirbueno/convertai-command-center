import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { montarContrato, valoresComPadrao, variaveisDoContrato } from "../../supabase/functions/_shared/contrato-modelo";
import { MODELOS_V1 } from "../../supabase/functions/contratos/modulos/contrato-modelo-v1";

/**
 * Frente CON (30/09): o contrato aberto na tela. Rascunho com campo faltando
 * não congela; a cláusula só muda depois de ver a diferença e confirmar; o
 * congelado oferece versão nova (o link anterior deixa de valer).
 */

const chamadas: Array<{ acao: string; corpo: Record<string, unknown> }> = [];
let payload: any = null;

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin", full_name: "Almir" }, user: { id: "u-1" } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/contratos/api", async () => {
  const real = await vi.importActual<any>("@/lib/contratos/api");
  return {
    ...real,
    chamarContratos: vi.fn(async (acao: string, corpo: Record<string, unknown> = {}) => {
      chamadas.push({ acao, corpo });
      if (acao === "clausula_alterar") return { ...payload, anterior: null };
      if (acao === "diff") return { antes: { id: "a", versao: 1 }, depois: { id: "b", versao: 2 }, linhas: [], resumo: { mudaram: 0, entraram: 0, sairam: 0 } };
      return payload;
    }),
  };
});

import DetalheDoContrato from "@/components/contratos/DetalheDoContrato";

const AGENCIA = { razao_social: "Aceleriq Ltda", nome_fantasia: "", cnpj: "1", endereco: "R", cidade: "Londrina", uf: "PR", representante: "Almir", representante_cpf: "", email: "", foro: "Londrina/PR" };

function montarPayload(status: "draft" | "sent", valores: Record<string, string> = {}) {
  const vars = variaveisDoContrato(MODELOS_V1, ["design"]);
  const v = valoresComPadrao(vars, valores);
  const m = montarContrato({ modelos: MODELOS_V1, servicos: ["design"], valores: v, agencia: AGENCIA, numero: "CT-2026-0009", versao: 1, data: "2026-09-30" });
  return {
    contrato: {
      id: "c-1", client_id: "cli-1", title: "Contrato de design", status, origem: "modelo", numero: "CT-2026-0009", versao: 1, versao_de: null, substituido_por: null, servicos: ["design"],
      documento_hash: status === "sent" ? "d".repeat(64) : null, congelado_em: status === "sent" ? "2026-09-30T12:00:00Z" : null, admin_signature_name: null, admin_signed_at: null,
      client_signature_name: null, client_signed_at: null, sent_at: null, sign_token: "tok", sign_url: status === "sent" ? "https://painel/contrato/tok" : null, arquivado_em: null, updated_at: "2026-09-30T12:00:00Z", clausulas_alteradas: [],
    },
    texto: m.texto,
    montado: status === "draft" ? { faltando: m.faltando, clausulas: m.clausulas } : null,
    pode_congelar: status === "draft" ? { pode: m.faltando.length === 0, motivo: m.faltando.length ? "Falta preencher: data de início." : null } : { pode: false, motivo: "Já congelado." },
    variaveis: m.variaveis,
    valores: m.valores,
    agencia: { completa: true, faltando: [], aviso: null },
    revisao_juridica: "v1 · revisão jurídica pendente",
    eventos: [{ id: "e1", tipo: "criado", resumo: "Rascunho criado.", detalhe: {}, ip: null, criado_em: "2026-09-30T12:00:00Z" }],
    versoes: [{ id: "c-1", versao: 1, status, congelado_em: null, documento_hash: null, created_at: "2026-09-30T12:00:00Z" }],
  };
}

function abrir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DetalheDoContrato contratoId="c-1" aoVoltar={() => {}} aoAbrir={() => {}} nomeDoCliente="Padaria" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  chamadas.length = 0;
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("contratos: a tela do contrato", () => {
  it("rascunho com campo faltando: o botão de congelar fica bloqueado e diz o motivo", async () => {
    payload = montarPayload("draft");
    abrir();
    const botao = await screen.findByRole("button", { name: /Congelar e assinar/ });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect(botao.getAttribute("title")).toContain("Falta preencher");
    expect(document.querySelector("[data-documento-do-contrato]")).toBeTruthy();
  });

  it("cláusula: edita, vê a diferença e só grava ao confirmar", async () => {
    payload = montarPayload("draft");
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Cláusulas" }));
    const editar = await screen.findAllByRole("button", { name: "Editar" });
    fireEvent.click(editar[0]);
    const campo = screen.getByRole("textbox", { name: /Texto da cláusula/ }) as HTMLTextAreaElement;
    fireEvent.change(campo, { target: { value: `${campo.value} Texto acrescentado pela equipe.` } });
    expect(document.querySelector("[data-diff-da-clausula] [data-entrou]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver e confirmar" }));
    expect(chamadas.some((c) => c.acao === "clausula_alterar")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Confirmar a diferença/ }));
    await waitFor(() => expect(chamadas.some((c) => c.acao === "clausula_alterar")).toBe(true));
    const chamada = chamadas.find((c) => c.acao === "clausula_alterar")!;
    expect(String(chamada.corpo.texto)).toContain("Texto acrescentado pela equipe.");
  });

  it("congelado: mostra o código, oferece enviar e versão nova", async () => {
    payload = montarPayload("sent");
    abrir();
    expect(await screen.findByRole("button", { name: /Enviar/ })).toBeTruthy();
    expect(screen.getByTitle(`SHA-256 ${"d".repeat(64)}`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Congelar e assinar/ })).toBeNull();
  });
});
