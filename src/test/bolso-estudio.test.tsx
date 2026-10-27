import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aceleriq de Bolso (26/10/2026). Regras da tela, o fluxo do estúdio com o banco simulado (a regra de verdade
 * mora nas funções bolso_* e é provada em supabase/testes/bolso_cenarios.sql) e o contrato da migration.
 */

const mock = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), assinar: vi.fn(), respostas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mock.rpc,
    functions: { invoke: mock.invoke },
    storage: { from: () => ({ createSignedUrl: mock.assinar }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-a" }, profile: { role: "client" } }) }));

import { motivoParaNaoPedir, nomeDoArquivo, situacaoDoEstudio, faltasDoBriefing, avisoDeCondicoes, BRIEFING_VAZIO, type EstadoDoEstudio } from "@/lib/bolso/modelo";
import { erroDoBolso } from "@/lib/bolso/api";
import EstudioBolso from "@/components/membros/bolso/EstudioBolso";
import CreditosBolso from "@/components/membros/bolso/CreditosBolso";

const SIMULADO: EstadoDoEstudio = {
  exposto: true, admin: false, modo: "simulado", carteira: "teste",
  direito: { tipo: "teste", origem: "teste", inicio: "2026-10-26T12:00:00Z", fim: "2027-10-26T12:00:00Z" },
  saldo: { disponivel: 5, reservado: 0 },
  politica: { versao: 1, teste: true, tarifa_texto: 1, tarifa_imagem: 2, formatos: ["feed_1x1", "feed_4x5"] },
  limites_configurados: true, destino_agencia: null,
};

const CAMPANHA = {
  id: "c-1", titulo: "Bolo de pote", versao: 1, versao_escolhida: 1, atualizado_em: "2026-10-26T12:00:00Z",
  briefing: { ...BRIEFING_VAZIO, produto: "Bolo de pote", cta: "Peça no direct" },
  versoes: [{ numero: 1, origem: "simulada", criado_em: "2026-10-26T12:00:00Z", conteudo: { mensagem: "[DEMONSTRAÇÃO] m", texto: "[DEMONSTRAÇÃO] Bolo de pote", cta: "Peça no direct", aplicacao: "", direcao_visual: "" } }],
  jobs: [],
  artes: [{ id: "a-1", caminho: "u-a/c-1/j-1.png", formato: "feed_1x1", mime: "image/png", bytes: 51252, versao_campanha: 1, simulado: true, escolhido: false, criado_em: "2026-10-26T12:00:00Z" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mock.respostas = {
    bolso_estado: SIMULADO,
    bolso_marca_ler: { id: "m-1", nome: "Doceria A", descricao: "", publico: "", regiao: "", tom: "", cores: [], direitos_confirmados: true, versao: 1 },
    bolso_campanhas_listar: [{ id: "c-1", titulo: "Bolo de pote", tipo: "venda", versao_escolhida: 1, atualizado_em: "2026-10-26T12:00:00Z", versoes: 1, artes: 1, em_andamento: 0 }],
    bolso_campanha_ler: CAMPANHA,
    bolso_pedir: { job_id: "j-2", estado: "na_fila", repetido: false, tarifa: 2, provedor: "simulado" },
    bolso_extrato: [
      { id: 2, carteira: "teste", tipo: "captura", quantidade: 1, delta_disponivel: 0, delta_reservado: -1, descricao: "Usado: texto da campanha", criado_em: "2026-10-26T12:05:00Z", job_id: "j-1" },
      { id: 1, carteira: "teste", tipo: "concessao", quantidade: 5, delta_disponivel: 5, delta_reservado: 0, descricao: "TESTE: créditos de demonstração", criado_em: "2026-10-26T12:00:00Z", job_id: null },
    ],
  };
  mock.rpc.mockImplementation(async (nome: string) => ({ data: mock.respostas[nome] ?? null, error: null }));
  mock.invoke.mockResolvedValue({ data: { estado: "concluido" }, error: null });
  mock.assinar.mockResolvedValue({ data: { signedUrl: "https://arquivos.test/arte.png" }, error: null });
});

const montar = (filho: unknown) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(QueryClientProvider, { client: qc }, filho as never));
};

describe("regras da tela", () => {
  it("modo simulado é demonstração e pode pedir; pausado e sem acesso explicam o porquê", () => {
    expect(situacaoDoEstudio(SIMULADO)).toMatchObject({ podeGerar: true, demonstracao: true });
    expect(situacaoDoEstudio({ ...SIMULADO, modo: "pausado", motivo: null }).podeGerar).toBe(false);
    expect(situacaoDoEstudio({ exposto: false }).podeGerar).toBe(false);
  });

  it("botão de pedir: saldo insuficiente, sem texto e limites ausentes dizem o próximo passo", () => {
    expect(motivoParaNaoPedir({ ...SIMULADO, saldo: { disponivel: 1, reservado: 0 } }, 2, true, "imagem")).toMatch(/usa 2 créditos e você tem 1/);
    expect(motivoParaNaoPedir(SIMULADO, 2, false, "imagem")).toMatch(/texto da campanha antes/);
    expect(motivoParaNaoPedir({ ...SIMULADO, limites_configurados: false }, 1, true, "texto")).toMatch(/limites/);
    expect(motivoParaNaoPedir(SIMULADO, 1, true, "texto")).toBeNull();
  });

  it("briefing: aponta o que falta e avisa que preço não é inventado", () => {
    expect(faltasDoBriefing(BRIEFING_VAZIO)).toHaveLength(3);
    expect(avisoDeCondicoes(BRIEFING_VAZIO)).toMatch(/Nada é inventado/);
    expect(avisoDeCondicoes({ ...BRIEFING_VAZIO, condicoes: "R$ 12" })).toBeNull();
  });

  it("nome do arquivo seguro e erro do banco repassado só quando é do estúdio", () => {
    expect(nomeDoArquivo("Bolo de Pote / Promoção!", "feed_4x5", 2, "image/png")).toBe("bolo-de-pote-promocao-feed_4x5-v2.png");
    expect(erroDoBolso({ code: "53400", message: "Saldo insuficiente: este pedido usa 2 crédito(s) e você tem 1." })).toMatch(/Saldo insuficiente/);
    expect(erroDoBolso({ code: "XX000", message: "detalhe interno do servidor" })).not.toMatch(/interno/);
  });
});

describe("estúdio com o banco simulado", () => {
  it("modo demonstração: faixa fixa, limites do produto e saldo de teste", async () => {
    montar(h(EstudioBolso));
    expect(await screen.findByText("DEMONSTRAÇÃO / PROVEDOR SIMULADO")).toBeTruthy();
    expect(screen.getByText(/Não é agência humana, não faz gestão de anúncios e não garante vendas/)).toBeTruthy();
    expect(screen.getByLabelText("Seu saldo de créditos").textContent).toMatch(/5 créditos de teste/);
    expect(await screen.findByText("Bolo de pote")).toBeTruthy();
  });

  it("pedir arte: confirma o consumo antes, reserva com a chave e processa; prévia e download por URL assinada", async () => {
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Arte e download/ }));
    const pedirArte = await screen.findByRole("button", { name: /Pedir a arte/ });
    expect(pedirArte.textContent).toMatch(/2 créditos/);
    fireEvent.click(pedirArte);
    const confirmar = within(screen.getByRole("group", { name: "Confirmar consumo de créditos" }));
    expect(confirmar.getByText(/reserva/).textContent).toMatch(/2 crédito.*de 5.*de teste/);
    expect(mock.rpc).not.toHaveBeenCalledWith("bolso_pedir", expect.anything());
    fireEvent.click(confirmar.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith("bolso", { body: { acao: "processar", job_id: "j-2" } }));
    const pedido = mock.rpc.mock.calls.find((c) => c[0] === "bolso_pedir")![1];
    expect(pedido).toEqual(expect.objectContaining({ _campanha: "c-1", _tipo: "imagem", _formato: "feed_1x1", _tarifa_vista: 2 }));
    expect(String(pedido._chave)).toMatch(/^bolso-/);
    // A arte existente: prévia por URL assinada curta e download com nome de arquivo.
    expect(mock.assinar).toHaveBeenCalledWith("u-a/c-1/j-1.png", 60, undefined);
    expect(screen.getByText("Demonstração")).toBeTruthy();
  });

  it("sem saldo: botão desligado com o motivo, consulta e download continuam", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, saldo: { disponivel: 0, reservado: 0 } };
    montar(h(EstudioBolso));
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Arte e download/ }));
    expect((await screen.findByRole("button", { name: /Pedir a arte/ })).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/você tem 0. Consultar e baixar o que já fez continua livre/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Baixar/ }).hasAttribute("disabled")).toBe(false);
  });

  it("estúdio pausado: aviso e nenhuma ação de pedido ativa", async () => {
    mock.respostas.bolso_estado = { ...SIMULADO, modo: "pausado", motivo: "O estúdio está pausado pela administração. Suas campanhas e arquivos continuam disponíveis." };
    montar(h(EstudioBolso));
    expect(await screen.findByText(/Estúdio pausado/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Bolo de pote/ }));
    expect((await screen.findByRole("button", { name: /Criar outra versão/ })).hasAttribute("disabled")).toBe(true);
  });

  it("módulo fechado: não mostra o estúdio", async () => {
    mock.respostas.bolso_estado = { exposto: false };
    montar(h(EstudioBolso));
    expect(await screen.findByText(/ainda não está disponível/)).toBeTruthy();
    expect(screen.queryByText("Minhas campanhas")).toBeNull();
  });

  it("serviços da agência sem destino autorizado: botão desligado com explicação", async () => {
    montar(h(EstudioBolso));
    const botao = await screen.findByRole("button", { name: "Conhecer serviços da agência" });
    expect(botao.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/contato da agência ainda não foi publicado/)).toBeTruthy();
  });

  it("créditos e acesso: saldo, validade e extrato vindos do banco", async () => {
    montar(h(CreditosBolso));
    expect(await screen.findByText("Teste (demonstração)")).toBeTruthy();
    expect(screen.getByText(/até 26\/10\/2027/)).toBeTruthy();
    expect(await screen.findByText("Créditos recebidos")).toBeTruthy();
    expect(screen.getByText("1 usado")).toBeTruthy();
  });
});

describe("contrato da migration", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261027120000_aceleriq_de_bolso.sql"), "utf8");

  it("chaves nascem desligadas e sem limites", () => {
    for (const k of ["modulo_exposto", "geracao_real", "pagamentos", "modo_simulado", "kill_switch"]) expect(sql).toContain(`${k} boolean NOT NULL DEFAULT false`);
    expect(sql).toMatch(/limites jsonb CHECK/);
    expect(sql).toContain("Os limites do estúdio ainda não foram configurados");
  });

  it("tabelas fechadas, trabalhador e eventos só com a chave de serviço", () => {
    expect(sql).toContain("EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t)");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.%s TO service_role");
    expect(sql).toMatch(/'bolso_trabalho_pegar\(uuid,integer\)'.*'bolso_evento_pagamento\(jsonb\)'/s);
    expect(sql).not.toMatch(/GRANT[^;]*TO anon/);
  });

  it("extrato só de inclusão, captura e liberação uma vez por job", () => {
    expect(sql).toContain("CREATE TRIGGER bolso_creditos_imutavel BEFORE UPDATE OR DELETE ON public.bolso_creditos");
    expect(sql).toContain("CREATE UNIQUE INDEX bolso_creditos_fecha_uma_vez ON public.bolso_creditos (job_id) WHERE tipo IN ('captura', 'liberacao')");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('bolso:' || u::text, 7))");
  });

  it("bucket privado com barreira e leitura só da própria pasta", () => {
    expect(sql).toContain("VALUES ('bolso', 'bolso', false, 10485760");
    expect(sql).toContain("CREATE POLICY bolso_storage_barreira ON storage.objects AS RESTRICTIVE");
    expect(sql).toContain("(storage.foldername(name))[1] = auth.uid()::text");
  });

  it("acesso real só com política aprovada; teste nunca na carteira real", () => {
    expect(sql).toContain("Acesso real só com política comercial aprovada");
    expect(sql).toContain("Crédito de teste só com política de teste");
    expect(sql).toContain("CHECK ((tipo = 'teste') = (carteira = 'teste'))");
  });
});
