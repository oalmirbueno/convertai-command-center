import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminFerramentas from "@/components/membros/AdminFerramentas";
import type { AdminFerramentas as DadosFerramentas, RenovacaoLicencaCrm } from "@/lib/membros/ferramentas";
import type { DadosAdmin } from "@/lib/membros/api";

const m = vi.hoisted(() => ({
  carregar: vi.fn(),
  suspender: vi.fn(),
  reativar: vi.fn(),
  revogar: vi.fn(),
  previa: vi.fn(),
  renovar: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "administrador" } }),
}));
vi.mock("@/components/sistema", () => ({
  AjudaRecolhida: ({ rotulo }: { rotulo: string }) => (
    <button aria-label={rotulo}>?</button>
  ),
}));
vi.mock("@/components/membros/CrmDoMembro", () => ({
  QuadroCrm: () => <div>CRM em acompanhamento</div>,
}));
vi.mock("@/lib/membros/ferramentas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/membros/ferramentas")>()),
  carregarAdminFerramentas: m.carregar,
  suspenderLicencaCrm: m.suspender,
  reativarLicencaCrm: m.reativar,
  revogarLicenca: m.revogar,
  prepararRenovacaoCrm: m.previa,
  renovarLicencaCrm: m.renovar,
}));

const fimOriginal = "2037-10-21T12:00:00Z";
let ferramentas: DadosFerramentas;
function previaDaFixture(id = "licenca-original"): RenovacaoLicencaCrm {
  const licenca = ferramentas.licencas.find((l) => l.id === id)!;
  return {
    licenca_anterior_id: licenca.id,
    user_id: licenca.user_id,
    produto_id: licenca.produto_id,
    inicio: "2037-10-21T12:00:00Z",
    fim: "2038-10-21T12:00:00Z",
    fim_anterior: licenca.fim || "",
    suspenso_em: licenca.suspenso_em || null,
    ja_renovada: false,
    licenca_nova_id: null,
  };
}
const admin: DadosAdmin = {
  modulos: [], funil: [], materiais: [], acessos: [], beneficios: [],
  vinculos: [], checklist: [], historico: [], processamentos: [], planos: [],
  integracoes: [],
  pessoas: [{ id: "titular", full_name: "Titular do teste", email: "teste@example.invalid" }],
  produtos: [{
    id: "produto-crm", titulo: "CRM do teste", descricao: "", categoria: "Ferramentas",
    formato: "", capa_url: null, estado: "publicado", gratuito: false, destaque: false,
    checkout_url: null, condicoes: "", ordem: 1,
  }],
};
function montar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminFerramentas dados={admin} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  ferramentas = {
    ferramentas: [{ produto_id: "produto-crm", motor: "crm", ativo: true }],
    licencas: [{
      id: "licenca-original", produto_id: "produto-crm", user_id: "titular",
      titular: "Titular do teste", email: "teste@example.invalid", origem: "validacao_manual",
      confirmado_em: "2026-10-21T12:00:00Z", fim: fimOriginal,
      revogado_em: null, suspenso_em: null,
      referencia: "validacao-inicial", criado_em: "2026-10-21T12:00:00Z",
    }],
    contatos: [{ id: "contato-salvo", nome: "Contato salvo", empresa: "", email: "", telefone: "", notas: "", arquivado: false, versao: 1 }],
    negocios: [{ id: "negocio-salvo", titulo: "Negócio salvo", contato_id: "contato-salvo", estagio: "proposta", valor: 123.45, proxima_acao: "Retornar", proxima_data: null, notas: "", arquivado: false, versao: 1 }],
    exclusoes: [],
  };
  m.carregar.mockImplementation(async () => structuredClone(ferramentas));
  m.suspender.mockImplementation(async () => {
    ferramentas.licencas[0].suspenso_em = "2026-10-21T14:00:00Z";
  });
  m.reativar.mockImplementation(async () => {
    ferramentas.licencas[0].suspenso_em = null;
  });
  m.previa.mockImplementation(async (id: string) => previaDaFixture(id));
  m.renovar.mockImplementation(async (id: string) => {
    const previa = previaDaFixture(id);
    const anterior = ferramentas.licencas.find((l) => l.id === id)!;
    const nova = {
      ...anterior,
      id: "nova-licenca",
      confirmado_em: previa.inicio,
      fim: previa.fim,
      referencia: `renovacao-manual-crm:${id}`,
      criado_em: "2026-10-21T13:00:00Z",
    };
    ferramentas.licencas.push(nova);
    return { ...previa, licenca_nova_id: nova.id };
  });
});

describe("renovação manual da licença do CRM", () => {
  async function abrirPrevia() {
    fireEvent.click(await screen.findByRole("button", { name: "Renovar licença" }));
    await screen.findByText("Novo vencimento");
    return screen.getByRole("dialog", { name: "Renovar licença do CRM" });
  }

  it("confere o cliente e as datas do servidor sem alterar nada antes da confirmação", async () => {
    const antes = structuredClone(ferramentas);
    montar();
    const dialogo = await abrirPrevia();
    expect(within(dialogo).getByText(/Titular do teste · CRM do teste/)).toBeInTheDocument();
    expect(within(dialogo).getByText(new Date("2038-10-21T12:00:00Z").toLocaleString("pt-BR", {
      dateStyle: "short", timeStyle: "short",
    }))).toBeInTheDocument();
    expect(within(dialogo).getByText(/Nenhuma cobrança. Kiwify e Asaas continuam desligados/)).toBeInTheDocument();
    expect(m.previa).toHaveBeenCalledExactlyOnceWith("licenca-original");
    expect(m.renovar).not.toHaveBeenCalled();
    expect(m.suspender).not.toHaveBeenCalled();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ferramentas).toEqual(antes);
    expect(m.renovar).not.toHaveBeenCalled();
  });

  it("confirma exatamente a prévia e mantém o período anterior, contatos e negócios", async () => {
    const anterior = structuredClone(ferramentas);
    montar();
    const dialogo = await abrirPrevia();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar renovação" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Licença renovada por 12 meses. Contatos e negócios preservados.");
    expect(m.renovar).toHaveBeenCalledExactlyOnceWith(
      "licenca-original", "2037-10-21T12:00:00Z", fimOriginal, null,
    );
    expect(m.previa).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ferramentas.licencas).toHaveLength(2);
    expect(ferramentas.licencas[0]).toEqual(anterior.licencas[0]);
    expect(ferramentas.contatos).toEqual(anterior.contatos);
    expect(ferramentas.negocios).toEqual(anterior.negocios);
    expect(m.carregar).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Renovação manual/)).toBeInTheDocument();
    expect(screen.queryByText(/Pagamento confirmado/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Renovar licença" })).not.toBeInTheDocument();
  });

  it("não duplica a renovação nem fecha o diálogo durante a confirmação", async () => {
    let concluir: ((resposta: RenovacaoLicencaCrm) => void) | undefined;
    m.renovar.mockImplementation(() => new Promise<RenovacaoLicencaCrm>((resolve) => { concluir = resolve; }));
    montar();
    const dialogo = await abrirPrevia();
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar renovação" });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    expect(m.renovar).toHaveBeenCalledTimes(1);
    expect(within(dialogo).getByRole("button", { name: "Renovando…" })).toBeDisabled();
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    concluir?.({ ...previaDaFixture(), licenca_nova_id: "nova-licenca" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("exige outra prévia se a licença mudou e não anuncia sucesso", async () => {
    m.renovar.mockRejectedValue({ code: "40001" });
    montar();
    const dialogo = await abrirPrevia();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar renovação" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("A licença mudou enquanto esta janela estava aberta");
    expect(within(dialogo).getByRole("button", { name: "Confirmar renovação" })).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(ferramentas.licencas).toHaveLength(1);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Conferir novamente" }));
    await waitFor(() => expect(m.previa).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(dialogo).getByRole("button", { name: "Confirmar renovação" })).toBeEnabled());
    expect(m.renovar).toHaveBeenCalledTimes(1);
  });

  it("mantém o diálogo e o erro se o servidor recusar a renovação", async () => {
    m.renovar.mockRejectedValue({ code: "42501" });
    montar();
    const dialogo = await abrirPrevia();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar renovação" }));
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("Você não tem acesso a este conteúdo.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(ferramentas.licencas).toHaveLength(1);
    expect(m.carregar).toHaveBeenCalledTimes(1);
  });

  it("mantém o erro de prévia sem habilitar confirmação ou fazer mutações", async () => {
    m.previa.mockRejectedValue({ code: "42501" });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Renovar licença" }));
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("Você não tem acesso a este conteúdo.");
    expect(within(dialogo).getByRole("button", { name: "Confirmar renovação" })).toBeDisabled();
    expect(m.renovar).not.toHaveBeenCalled();
  });

  it("preserva a suspensão no novo período e informa que renovar não libera acesso", async () => {
    const suspensao = "2026-10-21T14:00:00Z";
    ferramentas.licencas[0].suspenso_em = suspensao;
    montar();
    const dialogo = await abrirPrevia();
    expect(within(dialogo).getByText(/O novo período continuará suspenso/)).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar renovação" }));
    expect(await screen.findByRole("status")).toHaveTextContent("A suspensão e os dados do CRM foram preservados");
    expect(m.renovar).toHaveBeenCalledExactlyOnceWith("licenca-original", "2037-10-21T12:00:00Z", fimOriginal, suspensao);
    expect(ferramentas.licencas.every((l) => l.suspenso_em === suspensao)).toBe(true);
    expect(m.reativar).not.toHaveBeenCalled();
  });

  it("permite conferir renovação de licença vencida sem reativar ou renovar implicitamente", async () => {
    ferramentas.licencas[0].fim = "2020-10-21T12:00:00Z";
    montar();
    const dialogo = await abrirPrevia();
    expect(within(dialogo).getByRole("button", { name: "Confirmar renovação" })).toBeEnabled();
    expect(m.renovar).not.toHaveBeenCalled();
    expect(m.reativar).not.toHaveBeenCalled();
  });

  it.each([
    { caso: "revogada", dados: { revogado_em: "2026-10-21T14:00:00Z" } },
    { caso: "futura", dados: { confirmado_em: "2036-10-21T12:00:00Z" } },
    { caso: "sem validade", dados: { fim: null } },
    { caso: "sem metadados do período", dados: { criado_em: undefined } },
  ])("não oferece renovação para licença $caso", async ({ dados: ajuste }) => {
    Object.assign(ferramentas.licencas[0], ajuste);
    montar();
    await screen.findByRole("button", { name: "Acompanhar" });
    expect(screen.queryByRole("button", { name: "Renovar licença" })).not.toBeInTheDocument();
    expect(m.previa).not.toHaveBeenCalled();
  });

  it("não oferece renovação para outro motor", async () => {
    ferramentas.ferramentas[0].motor = "proxima_resposta";
    montar();
    await screen.findByRole("button", { name: "Revogar licença" });
    expect(screen.queryByRole("button", { name: "Renovar licença" })).not.toBeInTheDocument();
  });

  it("oferece renovação somente no período mais recente do titular e produto", async () => {
    ferramentas.licencas.push({
      ...ferramentas.licencas[0], id: "licenca-recente", criado_em: "2026-10-21T13:00:00Z", referencia: "segundo-periodo",
    });
    montar();
    const renovar = await screen.findAllByRole("button", { name: "Renovar licença" });
    expect(renovar).toHaveLength(1);
    fireEvent.click(renovar[0]);
    await screen.findByText("Novo vencimento");
    expect(m.previa).toHaveBeenCalledExactlyOnceWith("licenca-recente");
  });

  it("desempata períodos criados juntos pelo id, como o servidor", async () => {
    ferramentas.licencas[0].id = "00000000-0000-0000-0000-000000000001";
    ferramentas.licencas.push({ ...ferramentas.licencas[0], id: "00000000-0000-0000-0000-000000000002", referencia: "outro-periodo" });
    montar();
    const renovar = await screen.findAllByRole("button", { name: "Renovar licença" });
    expect(renovar).toHaveLength(1);
    fireEvent.click(renovar[0]);
    await screen.findByText("Novo vencimento");
    expect(m.previa).toHaveBeenCalledExactlyOnceWith("00000000-0000-0000-0000-000000000002");
  });

  it("preserva os micros do servidor antes de desempatar pelo id", async () => {
    ferramentas.licencas[0].id = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    ferramentas.licencas[0].criado_em = "2026-10-21T12:00:00.123001Z";
    ferramentas.licencas.push({
      ...ferramentas.licencas[0],
      id: "00000000-0000-0000-0000-000000000001",
      criado_em: "2026-10-21T12:00:00.123999+00:00",
      referencia: "periodo-mais-recente",
    });
    montar();
    const renovar = await screen.findAllByRole("button", { name: "Renovar licença" });
    expect(renovar).toHaveLength(1);
    fireEvent.click(renovar[0]);
    await screen.findByText("Novo vencimento");
    expect(m.previa).toHaveBeenCalledExactlyOnceWith(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("não oferece renovar um período anterior que já tenha renovação vinculada", async () => {
    ferramentas.licencas.push({
      ...ferramentas.licencas[0], id: "licenca-futura", confirmado_em: "2037-10-21T12:00:00Z", fim: "2038-10-21T12:00:00Z",
      criado_em: "2026-10-21T13:00:00Z", referencia: "renovacao-manual-crm:licenca-original",
    });
    montar();
    await screen.findByText(/Renovação manual/);
    expect(screen.queryByRole("button", { name: "Renovar licença" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Pagamento confirmado/)).not.toBeInTheDocument();
  });

  it("reconhece uma renovação concorrente já registrada na prévia sem confirmar outra", async () => {
    m.previa.mockResolvedValue({ ...previaDaFixture(), ja_renovada: true, licenca_nova_id: "ja-existente" });
    montar();
    const dialogo = await abrirPrevia();
    expect(within(dialogo).getByRole("status")).toHaveTextContent("Esta licença já foi renovada");
    expect(within(dialogo).queryByRole("button", { name: "Confirmar renovação" })).not.toBeInTheDocument();
    expect(m.renovar).not.toHaveBeenCalled();
  });

  it("ignora a prévia que termina depois de cancelar o diálogo", async () => {
    let concluir: ((resposta: RenovacaoLicencaCrm) => void) | undefined;
    m.previa.mockImplementation(() => new Promise<RenovacaoLicencaCrm>((resolve) => { concluir = resolve; }));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Renovar licença" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await act(async () => concluir?.(previaDaFixture()));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(m.renovar).not.toHaveBeenCalled();
  });
});
afterEach(cleanup);

describe("suspensão temporária da licença do CRM na administração", () => {
  it("suspende e reativa a mesma licença, atualiza a tabela e preserva validade e dados", async () => {
    const registrosOriginais = structuredClone({ contatos: ferramentas.contatos, negocios: ferramentas.negocios });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Suspender licença" }));
    expect(await screen.findByText("Suspensa")).toBeInTheDocument();
    expect(m.suspender).toHaveBeenCalledExactlyOnceWith("licenca-original");
    expect(screen.getByRole("status")).toHaveTextContent("Licença suspensa. Os dados e a validade original foram preservados.");
    fireEvent.click(screen.getByRole("button", { name: "Reativar licença" }));
    await screen.findByRole("button", { name: "Suspender licença" });
    expect(screen.getByText("Liberado")).toBeInTheDocument();
    expect(m.reativar).toHaveBeenCalledExactlyOnceWith("licenca-original");
    expect(screen.getByRole("status")).toHaveTextContent("Licença reativada. Os dados e a validade original foram preservados.");
    expect(ferramentas.licencas).toHaveLength(1);
    expect(ferramentas.licencas[0]).toMatchObject({ fim: fimOriginal, revogado_em: null, suspenso_em: null });
    expect({ contatos: ferramentas.contatos, negocios: ferramentas.negocios }).toEqual(registrosOriginais);
    expect(screen.getByText(new Date(fimOriginal).toLocaleDateString("pt-BR"))).toBeInTheDocument();
    expect(m.revogar).not.toHaveBeenCalled();
  });

  it("bloqueia cliques repetidos enquanto a suspensão está sendo salva", async () => {
    let concluir: (() => void) | undefined;
    m.suspender.mockImplementation(() => new Promise<void>((resolve) => { concluir = resolve; }));
    montar();
    const botao = await screen.findByRole("button", { name: "Suspender licença" });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(botao).toBeDisabled();
    expect(m.suspender).toHaveBeenCalledTimes(1);
    concluir?.();
    await waitFor(() => expect(botao).toBeEnabled());
  });

  it("mantém a licença liberada e mostra o erro se a suspensão falhar", async () => {
    m.suspender.mockRejectedValue({ code: "42501" });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Suspender licença" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem acesso a este conteúdo.");
    expect(screen.getByText("Liberado")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar licença" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suspender licença" })).toBeEnabled();
  });

  it("mantém a suspensão sem falso sucesso se a reativação for recusada pelo prazo", async () => {
    ferramentas.licencas[0].suspenso_em = "2026-10-21T14:00:00Z";
    m.reativar.mockRejectedValue({ code: "22023", message: "Esta licença venceu ou ainda não começou." });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Reativar licença" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Esta licença venceu ou ainda não começou.");
    expect(screen.getByText("Suspensa")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(m.suspender).not.toHaveBeenCalled();
  });

  it.each([
    { titulo: "vencida", fim: "2020-10-21T12:00:00Z", revogado_em: null, esperado: "Vencida" },
    { titulo: "revogada", fim: fimOriginal, revogado_em: "2026-10-21T13:00:00Z", esperado: "Revogado" },
    { titulo: "sem validade", fim: null, revogado_em: null, esperado: "Vencida" },
    { titulo: "com data inválida", fim: "data inválida", revogado_em: null, esperado: "Vencida" },
  ])("não oferece reativação para licença $titulo", async ({ fim, revogado_em, esperado }) => {
    Object.assign(ferramentas.licencas[0], { fim, revogado_em, suspenso_em: "2026-10-21T14:00:00Z" });
    montar();
    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar licença" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspender licença" })).not.toBeInTheDocument();
  });

  it("não oferece suspensão ou reativação antes do início da licença", async () => {
    ferramentas.licencas[0].confirmado_em = "2036-10-21T12:00:00Z";
    montar();
    expect(await screen.findByText("Não iniciada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar licença" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspender licença" })).not.toBeInTheDocument();
  });

  it("preserva a revogação existente de outras ferramentas", async () => {
    ferramentas.ferramentas[0].motor = "proxima_resposta";
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Revogar licença" }));
    await waitFor(() => expect(m.revogar).toHaveBeenCalledExactlyOnceWith("licenca-original"));
    expect(screen.queryByRole("button", { name: "Suspender licença" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar licença" })).not.toBeInTheDocument();
    expect(m.suspender).not.toHaveBeenCalled();
    expect(m.reativar).not.toHaveBeenCalled();
  });
});
