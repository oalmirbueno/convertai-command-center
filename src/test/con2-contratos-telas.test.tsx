import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { montarContrato, valoresComPadrao, variaveisDoContrato } from "../../supabase/functions/_shared/contrato-modelo";
import { MODELOS_V1 } from "../../supabase/functions/_shared/contrato-modelo-v1";
import { MODELOS_EXTRAS_V1 } from "../../supabase/functions/_shared/contrato-modelo-extras-v1";

/**
 * Frente CON2 (30/09): as telas novas dos contratos. Quem assina (mais de uma
 * pessoa e testemunhas), o painel (a vencer, pendentes, assinados no mês,
 * recorrente), os dados com "Preencher com IA" e a ficha fiscal, e o menu do
 * contrato assinado (aditivo e renovação).
 */

const chamadas: Array<{ acao: string; corpo: Record<string, unknown> }> = [];
let payload: any = null;
let painel: any = null;

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin", full_name: "Almir" }, user: { id: "u-1" } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/contratos/api", async () => {
  const real = await vi.importActual<any>("@/lib/contratos/api");
  return {
    ...real,
    chamarContratos: vi.fn(async (acao: string, corpo: Record<string, unknown> = {}) => {
      chamadas.push({ acao, corpo });
      if (acao === "painel") return painel;
      if (acao === "diff") return { antes: { id: "a", versao: 1 }, depois: { id: "b", versao: 2 }, linhas: [], resumo: { mudaram: 0, entraram: 0, sairam: 0 } };
      if (acao === "concluir_assinaturas") return { resultado: { ok: true } };
      return payload;
    }),
  };
});

import DetalheDoContrato from "@/components/contratos/DetalheDoContrato";
import PainelDosContratos from "@/components/contratos/PainelDosContratos";

const MODELOS = MODELOS_V1.concat(MODELOS_EXTRAS_V1);
const AGENCIA = { razao_social: "Aceleriq Ltda", nome_fantasia: "", cnpj: "1", endereco: "R", cidade: "Londrina", uf: "PR", representante: "Almir", representante_cpf: "", email: "", foro: "Londrina/PR" };

function montarPayload(status: "draft" | "sent" | "completed", extra: Record<string, unknown> = {}) {
  const vars = variaveisDoContrato(MODELOS, ["social"]);
  const v = valoresComPadrao(vars, { cliente_nome: "Padaria Pão Bom Ltda", cliente_representante: "Maria Silva", cliente_email: "maria@paobom.com.br" });
  const m = montarContrato({ modelos: MODELOS, servicos: ["social"], valores: v, agencia: AGENCIA, numero: "CT-2026-0009", versao: 1, data: "2026-09-30" });
  return {
    contrato: {
      id: "c-1", client_id: "cli-1", title: "Contrato de social", status, origem: "modelo", numero: "CT-2026-0009", versao: 1, versao_de: null, substituido_por: null, servicos: ["social"],
      documento_hash: status !== "draft" ? "d".repeat(64) : null, congelado_em: status !== "draft" ? "2026-09-30T12:00:00Z" : null, admin_signature_name: null, admin_signed_at: null,
      client_signature_name: null, client_signed_at: status === "completed" ? "2026-09-30T13:00:00Z" : null, sent_at: null, sign_token: "tok", sign_url: status === "sent" ? "https://painel/contrato/tok" : null, arquivado_em: null, updated_at: "2026-09-30T12:00:00Z", clausulas_alteradas: [],
      tipo_documento: "contrato",
    },
    texto: m.texto,
    montado: status === "draft" ? { faltando: m.faltando, clausulas: m.clausulas } : null,
    pode_congelar: { pode: false, motivo: "Falta preencher." },
    variaveis: m.variaveis,
    valores: m.valores,
    agencia: { completa: true, faltando: [], aviso: null },
    revisao_juridica: "v1 · revisão jurídica pendente",
    eventos: [],
    versoes: [],
    signatarios: [],
    ligados: { aditivos: [], renovacao: null, mae: null, renova: null },
    vigencia: { inicio: "2026-10-01", fim: "2027-09-30", recorrente: true },
    ficha: { existe: true, valores: { cliente_nome: "Padaria Pão Bom Ltda", cliente_documento: "11.222.333/0001-81" }, ficha: {} },
    extras_fora: ["extra_exclusividade"],
    ...extra,
  };
}

function comProvedores(no: JSX.Element) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{no}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const abrir = () => comProvedores(<DetalheDoContrato contratoId="c-1" aoVoltar={() => {}} aoAbrir={() => {}} nomeDoCliente="Padaria" />);

beforeEach(() => {
  chamadas.length = 0;
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("CON2: quem assina", () => {
  it("rascunho: inclui pessoa do contratante (nasce com o representante) e testemunha; testemunha sem CPF não salva", async () => {
    payload = montarPayload("draft");
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Assinantes" }));
    fireEvent.click(screen.getByRole("button", { name: /Pessoa do contratante/ }));
    expect((screen.getAllByRole("textbox", { name: "Nome completo" })[0] as HTMLInputElement).value).toBe("Maria Silva");
    expect((screen.getAllByRole("textbox", { name: "E-mail" })[0] as HTMLInputElement).value).toBe("maria@paobom.com.br");
    fireEvent.click(screen.getByRole("button", { name: /Testemunha/ }));
    fireEvent.change(screen.getAllByRole("textbox", { name: "Nome completo" })[1], { target: { value: "Ana Testemunha" } });
    fireEvent.change(screen.getAllByRole("textbox", { name: "E-mail" })[1], { target: { value: "ana@x.com" } });
    const salvar = screen.getByRole("button", { name: /Salvar quem assina/ }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    expect(screen.getByText(/testemunha precisa do CPF/)).toBeTruthy();
    fireEvent.change(screen.getAllByRole("textbox", { name: "CPF" })[1], { target: { value: "529.982.247-25" } });
    expect(salvar.disabled).toBe(false);
    fireEvent.click(salvar);
    await waitFor(() => expect(chamadas.some((c) => c.acao === "signatarios_salvar")).toBe(true));
    const lista = chamadas.find((c) => c.acao === "signatarios_salvar")!.corpo.signatarios as Array<Record<string, unknown>>;
    expect(lista.map((x) => [x.papel, x.nome, x.documento])).toEqual([["contratante", "Maria Silva", ""], ["testemunha", "Ana Testemunha", "52998224725"]]);
  });

  it("enviado: mostra quem já assinou e, com todos, oferece fechar o contrato", async () => {
    payload = montarPayload("sent", {
      signatarios: [
        { id: "s1", papel: "contratante", principal: true, ordem: 1, nome: "Maria Silva", email: "m@x.com", documento: null, obrigatorio: true, assinado_em: "2026-09-30T13:00:00Z", link: "https://painel/contrato/tok" },
        { id: "s2", papel: "testemunha", principal: false, ordem: 2, nome: "Ana", email: "a@x.com", documento: "52998224725", obrigatorio: true, assinado_em: "2026-09-30T14:00:00Z", link: "https://painel/contrato/tok2" },
      ],
    });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Assinantes" }));
    expect(screen.getByText(/Contratante \(principal\) · assinou em/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fechar o contrato/ }));
    await waitFor(() => expect(chamadas.some((c) => c.acao === "concluir_assinaturas")).toBe(true));
    expect(screen.getByRole("button", { name: /Lembrete de assinatura/ })).toBeTruthy();
  });
});

describe("CON2: dados com IA e ficha", () => {
  it("rascunho: Preencher com IA por seção, extras sem IA e sem a que o dono tirou, e Puxar da ficha", async () => {
    payload = montarPayload("draft");
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /^Dados/ }));
    expect(screen.getByRole("button", { name: /Preencher tudo/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Preencher Quadro-resumo com IA/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Preencher Cláusulas extras com IA/ })).toBeNull();
    expect(screen.getByText("Prazo de resposta (SLA)")).toBeTruthy();
    expect(screen.queryByText("Exclusividade no segmento")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Puxar da ficha/ }));
    await waitFor(() => expect((screen.getByDisplayValue("11.222.333/0001-81") as HTMLInputElement).value).toBe("11.222.333/0001-81"));
  });

  it("assinado: o menu oferece aditivo e renovação", async () => {
    payload = montarPayload("completed");
    abrir();
    fireEvent.keyDown(await screen.findByRole("button", { name: "Mais ações" }), { key: "Enter" });
    expect(await screen.findByText("Criar aditivo")).toBeTruthy();
    expect(screen.getByText("Preparar renovação")).toBeTruthy();
  });
});

describe("CON2: painel dos contratos", () => {
  it("números e listas: a vencer leva à renovação pronta; pendentes mostram há quantos dias", async () => {
    painel = {
      painel: {
        aVencer: [{ id: "v1", client_id: "cli-1", titulo: "Social", numero: "CT-2026-0001", fim: "2026-10-10", dias: 10, renovacao_id: "r1" }],
        pendentes: [{ id: "p1", client_id: "cli-1", titulo: "Site", numero: "CT-2026-0002", dias: 5, lembrete_em: null }],
        assinadosNoMes: 2,
        recorrenteMensal: 6000,
        ativos: 3,
      },
      janela_dias: 30,
      lembrete_dias: 3,
    };
    const aoAbrir = vi.fn();
    comProvedores(<PainelDosContratos clientId={null} nomeDoCliente={() => "Padaria"} aoAbrir={aoAbrir} />);
    const faixa = await screen.findByLabelText("Painel dos contratos");
    expect(within(faixa).getByText("R$ 6.000,00")).toBeTruthy();
    expect(within(faixa).getByText("3 contratos ativos")).toBeTruthy();
    fireEvent.click(within(faixa).getByText("A vencer em 30 dias"));
    fireEvent.click(await screen.findByText(/vence em 10 dias · renovação pronta/));
    expect(aoAbrir).toHaveBeenCalledWith("r1", "cli-1");
    fireEvent.click(within(faixa).getByText("Esperando assinatura"));
    expect(await screen.findByText(/há 5 dias/)).toBeTruthy();
  });
});
