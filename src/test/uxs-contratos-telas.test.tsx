import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagensProntas, montarContrato, valoresComPadrao, variaveisDoContrato } from "../../supabase/functions/_shared/contrato-modelo";
import { MODELOS_V1 } from "../../supabase/functions/contratos/modulos/contrato-modelo-v1";
import { MODELOS_EXTRAS_V1 } from "../../supabase/functions/contratos/modulos/contrato-modelo-extras-v1";

/**
 * UXS (30/09): simplificações aprovadas em Contratos.
 * - CON-01: o que foi digitado em Dados não se perde ao trocar de parte nem
 *   ao sair; "Salvar e assinar" salva antes de abrir a assinatura; o que o
 *   agente muda ao lado não apaga campo tocado.
 * - CON-05: Lembrar e Preparar renovação direto do painel.
 * - CON-07: Copiar mensagem registra o envio; Copiar link não.
 * - CON-08: link público com "Tentar de novo" e o PDF inteiro pelo link.
 * - CON-09: cláusula com um Confirmar só; Voltar ao modelo pelo "...".
 * - CON-12: Histórico junta Versões e Eventos.
 */

const chamadas: Array<{ acao: string; corpo: Record<string, unknown> }> = [];
let payload: any = null;
let respostaDoSalvar: any = null;
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
      if (acao === "salvar" && respostaDoSalvar) return respostaDoSalvar;
      if (acao === "clausula_alterar" || acao === "clausula_restaurar") return { ...payload, anterior: null };
      if (acao === "diff") return { antes: { id: "a", versao: 1 }, depois: { id: "b", versao: 2 }, linhas: [], resumo: { mudaram: 0, entraram: 0, sairam: 0 } };
      if (acao === "lembrete") return { dias: 5, ultimo_lembrete: null, lembretes: [{ id: null, nome: "Maria", papel: "contratante", email: "m@x.com", link: "https://painel/contrato/tok", mensagens: mensagensProntas({ cliente: "Maria", titulo: "Site", link: "https://painel/contrato/tok", hash: "a".repeat(64), agencia: "Aceleriq" }) }] };
      if (acao === "renovar") return { ...payload, contrato: { ...payload.contrato, id: "renovacao-1", numero: "CT-2026-0010" } };
      if (acao === "marcar_enviado") return { contrato: payload ? payload.contrato : {} };
      return payload;
    }),
  };
});

import DetalheDoContrato from "@/components/contratos/DetalheDoContrato";
import PainelDosContratos from "@/components/contratos/PainelDosContratos";
import { JanelaDeEnvio } from "@/components/contratos/JanelaDeEnvio";
import ContractPublic from "@/pages/ContractPublic";

const MODELOS = MODELOS_V1.concat(MODELOS_EXTRAS_V1);
const AGENCIA = { razao_social: "Aceleriq Ltda", nome_fantasia: "", cnpj: "1", endereco: "R", cidade: "Londrina", uf: "PR", representante: "Almir", representante_cpf: "", email: "", foro: "Londrina/PR" };

function montarPayload(status: "draft" | "sent", extra: Record<string, unknown> = {}) {
  const vars = variaveisDoContrato(MODELOS, ["social"]);
  const v = valoresComPadrao(vars, { cliente_nome: "Padaria Pão Bom Ltda", cliente_representante: "Maria Silva", cliente_email: "maria@paobom.com.br" });
  const m = montarContrato({ modelos: MODELOS, servicos: ["social"], valores: v, agencia: AGENCIA, numero: "CT-2026-0009", versao: 1, data: "2026-09-30" });
  return {
    contrato: {
      id: "c-1", client_id: "cli-1", title: "Contrato de social", status, origem: "modelo", numero: "CT-2026-0009", versao: 1, versao_de: null, substituido_por: null, servicos: ["social"],
      documento_hash: status !== "draft" ? "d".repeat(64) : null, congelado_em: status !== "draft" ? "2026-09-30T12:00:00Z" : null, admin_signature_name: null, admin_signed_at: null,
      client_signature_name: null, client_signed_at: null, sent_at: null, sign_token: "tok", sign_url: status === "sent" ? "https://painel/contrato/tok" : null, arquivado_em: null, updated_at: "2026-09-30T12:00:00Z", clausulas_alteradas: [],
      tipo_documento: "contrato",
    },
    texto: m.texto,
    montado: status === "draft" ? { faltando: m.faltando, clausulas: m.clausulas } : null,
    pode_congelar: { pode: false, motivo: "Falta preencher." },
    variaveis: m.variaveis,
    valores: m.valores,
    agencia: { completa: true, faltando: [], aviso: null },
    revisao_juridica: "v1 · revisão jurídica pendente",
    eventos: [{ id: "e1", tipo: "criado", resumo: "Rascunho criado.", detalhe: {}, ip: "200.1.2.3", criado_em: "2026-09-30T12:00:00Z" }],
    versoes: [{ id: "c-1", versao: 1, status, congelado_em: status !== "draft" ? "2026-09-30T12:00:00Z" : null, documento_hash: status !== "draft" ? "d".repeat(64) : null, created_at: "2026-09-30T12:00:00Z" }],
    signatarios: [],
    ligados: { aditivos: [], renovacao: null, mae: null, renova: null },
    vigencia: { inicio: "2026-10-01", fim: "2027-09-30", recorrente: true },
    ficha: { existe: false, valores: {}, ficha: {} },
    extras_fora: [],
    ...extra,
  };
}

function comProvedores(no: JSX.Element, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const r = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{no}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...r, qc };
}

const detalhe = () => <DetalheDoContrato contratoId="c-1" aoVoltar={() => {}} aoAbrir={() => {}} nomeDoCliente="Padaria" />;

beforeEach(() => {
  chamadas.length = 0;
  respostaDoSalvar = null;
  vi.mocked(toast.error).mockClear();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

afterEach(() => vi.unstubAllGlobals());

describe("CON-01: o rascunho não se perde", () => {
  it("trocar de parte e voltar mantém a edição; sair e voltar à tela também; a barra conta e salva só o que mudou", async () => {
    payload = montarPayload("draft");
    const { unmount } = comProvedores(detalhe());
    fireEvent.click(await screen.findByRole("button", { name: /^Dados/ }));
    expect(screen.getByText("Tudo salvo")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("Maria Silva"), { target: { value: "Maria S. Souza" } });
    expect(screen.getByText("1 alteração")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cláusulas" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dados/ }));
    expect(screen.getByDisplayValue("Maria S. Souza")).toBeTruthy();
    expect(chamadas.some((c) => c.acao === "salvar")).toBe(false);
    unmount();

    comProvedores(detalhe());
    expect(await screen.findByDisplayValue("Maria S. Souza")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(chamadas.some((c) => c.acao === "salvar")).toBe(true));
    expect(chamadas.find((c) => c.acao === "salvar")!.corpo.variaveis).toEqual({ cliente_representante: "Maria S. Souza" });
  });

  it("Salvar e assinar: salva antes e só abre a assinatura quando o servidor libera, com o Documento por trás", async () => {
    payload = montarPayload("draft");
    respostaDoSalvar = { ...payload, valores: { ...payload.valores, cliente_representante: "Maria S. Souza" }, pode_congelar: { pode: true, motivo: null }, contrato: { ...payload.contrato, updated_at: "2026-09-30T13:00:00Z" } };
    comProvedores(detalhe());
    fireEvent.click(await screen.findByRole("button", { name: /^Dados/ }));
    const assinar = screen.getByRole("button", { name: "Assinar pela agência" }) as HTMLButtonElement;
    expect(assinar.disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue("Maria Silva"), { target: { value: "Maria S. Souza" } });
    const salvarEAssinar = screen.getByRole("button", { name: "Salvar e assinar pela agência" }) as HTMLButtonElement;
    expect(salvarEAssinar.disabled).toBe(false);
    fireEvent.click(salvarEAssinar);
    expect(await screen.findByRole("dialog", { name: "Assinar pela agência" })).toBeTruthy();
    expect(chamadas.map((c) => c.acao)).toContain("salvar");
    expect(chamadas.some((c) => c.acao === "congelar")).toBe(false);
    expect(document.querySelector("[data-documento-do-contrato]")).toBeTruthy();
  });

  it("Salvar e assinar: com o servidor ainda travando, não abre a janela, diz o motivo e leva para Dados", async () => {
    payload = montarPayload("draft");
    respostaDoSalvar = { ...payload, valores: { ...payload.valores, cliente_representante: "Maria S. Souza" }, pode_congelar: { pode: false, motivo: "Falta preencher: data de início." } };
    comProvedores(detalhe());
    fireEvent.click(await screen.findByRole("button", { name: /^Dados/ }));
    fireEvent.change(screen.getByDisplayValue("Maria Silva"), { target: { value: "Maria S. Souza" } });
    fireEvent.click(screen.getByRole("button", { name: "Documento" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar e assinar pela agência" }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Ainda não dá para assinar", { description: "Falta preencher: data de início." }));
    expect(screen.queryByRole("dialog", { name: "Assinar pela agência" })).toBeNull();
    expect(document.querySelector("[data-dados-do-contrato]")).toBeTruthy();
  });

  it("o agente muda o contrato ao lado: campo não tocado atualiza, campo tocado fica com o valor da pessoa e a barra avisa", async () => {
    payload = montarPayload("draft");
    const { qc } = comProvedores(detalhe());
    fireEvent.click(await screen.findByRole("button", { name: /^Dados/ }));
    fireEvent.change(screen.getByDisplayValue("Maria Silva"), { target: { value: "Maria S. Souza" } });
    act(() => {
      qc.setQueryData(["contratos", "um", "c-1"], {
        ...payload,
        valores: { ...payload.valores, cliente_representante: "João do Agente", cliente_email: "novo@paobom.com.br" },
        contrato: { ...payload.contrato, updated_at: "2026-09-30T14:00:00Z" },
      });
    });
    // O cache avisa a tela no tempo dele: espera o campo não tocado mudar.
    expect(await screen.findByDisplayValue("novo@paobom.com.br")).toBeTruthy();
    expect(screen.getByDisplayValue("Maria S. Souza")).toBeTruthy();
    expect(screen.queryByDisplayValue("João do Agente")).toBeNull();
    expect(within(document.querySelector("[data-estado-do-rascunho]") as HTMLElement).getByText(/o agente também mudou/)).toBeTruthy();
  });
});

describe("CON-09: cláusula num clique", () => {
  it("Confirmar fica desativado com o texto igual ao atual ou curto demais", async () => {
    payload = montarPayload("draft");
    comProvedores(detalhe());
    fireEvent.click(await screen.findByRole("button", { name: "Cláusulas" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Editar cláusula/ }))[0]);
    const confirmar = screen.getByRole("button", { name: /Confirmar a diferença/ }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /Texto da cláusula/ }), { target: { value: "curto" } });
    expect(confirmar.disabled).toBe(true);
    expect(chamadas.some((c) => c.acao === "clausula_alterar")).toBe(false);
  });

  it("Voltar ao modelo mora no \"...\" da cláusula alterada e chama clausula_restaurar", async () => {
    payload = montarPayload("draft");
    payload.montado.clausulas[0] = { ...payload.montado.clausulas[0], alterada: true };
    comProvedores(detalhe());
    fireEvent.click(await screen.findByRole("button", { name: "Cláusulas" }));
    expect(screen.queryByRole("button", { name: /Voltar ao modelo/ })).toBeNull();
    const numero = payload.montado.clausulas[0].numero;
    fireEvent.keyDown(screen.getByRole("button", { name: `Mais ações da cláusula ${numero}` }), { key: "Enter" });
    fireEvent.click(await screen.findByText("Voltar ao modelo"));
    await waitFor(() => expect(chamadas.some((c) => c.acao === "clausula_restaurar")).toBe(true));
  });
});

describe("CON-12: Histórico", () => {
  it("junta Versões e Eventos; a trilha mantém o IP e a versão mantém o código curto", async () => {
    payload = montarPayload("sent");
    comProvedores(detalhe());
    fireEvent.click(await screen.findByRole("button", { name: "Histórico" }));
    expect(screen.getByRole("button", { name: "Versões" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eventos" })).toBeTruthy();
    expect(screen.getByText(/IP 200\.1\.2\.3/)).toBeTruthy();
    expect(screen.getByText(/travada em 30\/09 · dddddddddddd/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Trilha" })).toBeNull();
  });

  it("quem tinha Trilha guardada abre no Histórico", async () => {
    payload = montarPayload("sent");
    window.localStorage.setItem("tela:anon:/:contratos:parte:c-1", JSON.stringify({ v: "trilha", em: Date.now() }));
    comProvedores(detalhe());
    expect(await screen.findByText(/IP 200\.1\.2\.3/)).toBeTruthy();
    expect(document.querySelector("[data-historico-do-contrato]")).toBeTruthy();
  });

  it("cabeçalho: sem o código e sem \"versão 1\"; Enviar com nome acessível", async () => {
    payload = montarPayload("sent");
    comProvedores(detalhe());
    expect(await screen.findByRole("button", { name: "Enviar" })).toBeTruthy();
    const cabecalho = document.querySelector("[data-cabecalho-de-secao]") as HTMLElement;
    expect(cabecalho.textContent).not.toContain("código");
    expect(cabecalho.textContent).not.toContain("versão 1");
    expect(cabecalho.textContent).toContain("vigência até 30/09/2027");
  });
});

describe("CON-05: atalhos do painel", () => {
  it("Lembrar abre o lembrete da linha; Preparar renovação cria o rascunho e abre", async () => {
    painel = {
      painel: {
        aVencer: [{ id: "v2", client_id: "cli-1", titulo: "Social", numero: "CT-2026-0003", fim: "2026-10-10", dias: 10, renovacao_id: null }],
        pendentes: [{ id: "p1", client_id: "cli-1", titulo: "Site", numero: "CT-2026-0002", dias: 5, lembrete_em: null }],
        assinadosNoMes: 0,
        recorrenteMensal: 0,
        ativos: 1,
      },
      janela_dias: 30,
      lembrete_dias: 3,
    };
    payload = montarPayload("sent");
    const aoAbrir = vi.fn();
    comProvedores(<PainelDosContratos clientId={null} nomeDoCliente={() => "Padaria"} aoAbrir={aoAbrir} />);
    const faixa = await screen.findByLabelText("Painel dos contratos");
    fireEvent.click(within(faixa).getByText("Esperando assinatura"));
    fireEvent.click(await screen.findByRole("button", { name: "Lembrete de assinatura de CT-2026-0002" }));
    expect(await screen.findByRole("dialog", { name: "Lembrete de assinatura" })).toBeTruthy();
    await waitFor(() => expect(chamadas.some((c) => c.acao === "lembrete" && c.corpo.contract_id === "p1")).toBe(true));
    expect(aoAbrir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    fireEvent.click(within(faixa).getByText("A vencer em 30 dias"));
    fireEvent.click(await screen.findByRole("button", { name: "Preparar renovação de CT-2026-0003" }));
    await waitFor(() => expect(aoAbrir).toHaveBeenCalledWith("renovacao-1", "cli-1"));
    expect(chamadas.find((c) => c.acao === "renovar")!.corpo).toEqual({ contract_id: "v2" });
  });
});

describe("CON-07: janela de envio", () => {
  const mensagens = mensagensProntas({ cliente: "Maria", titulo: "Contrato", link: "https://painel/contrato/tok", hash: "a".repeat(64), agencia: "Aceleriq" });
  const abrirJanela = (props: Record<string, unknown> = {}) =>
    comProvedores(
      <JanelaDeEnvio
        aberta
        aoFechar={() => {}}
        contrato={{ id: "c-1", title: "Contrato", sent_at: null, documento_hash: "a".repeat(64) }}
        mensagens={mensagens}
        link="https://painel/contrato/tok"
        aoEnviado={() => {}}
        {...props}
      />,
    );

  it("Copiar mensagem copia e registra o envio uma vez; Copiar link só copia", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const aoEnviado = vi.fn();
    abrirJanela({ aoEnviado, emailDoCliente: "maria@paobom.com.br" });
    expect(screen.getByText("O e-mail vai para maria@paobom.com.br.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copiar link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://painel/contrato/tok"));
    expect(chamadas.some((c) => c.acao === "marcar_enviado")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Copiar mensagem/ }));
    await waitFor(() => expect(chamadas.filter((c) => c.acao === "marcar_enviado")).toHaveLength(1));
    expect(chamadas.find((c) => c.acao === "marcar_enviado")!.corpo).toEqual({ contract_id: "c-1", canal: "copiado" });
    expect(writeText).toHaveBeenCalledWith(mensagens.whatsapp);
    await waitFor(() => expect(aoEnviado).toHaveBeenCalled());
    expect(await screen.findByText(/Mensagem copiada em/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Copiar mensagem/ }));
    await new Promise((r) => setTimeout(r, 20));
    expect(chamadas.filter((c) => c.acao === "marcar_enviado")).toHaveLength(1);
  });

  it("cópia que falha não registra envio; sem e-mail, o botão de e-mail fica desativado", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("negado"))) } });
    abrirJanela({ emailDoCliente: null });
    fireEvent.click(screen.getByRole("button", { name: /Copiar mensagem/ }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(chamadas.some((c) => c.acao === "marcar_enviado")).toBe(false);
    expect((screen.getByRole("button", { name: /Enviar por e-mail/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("mensagem do PDF (sem código) não fala de código", () => {
    const m = mensagensProntas({ cliente: "Maria", titulo: "Contrato", link: "https://painel/contrato/tok", hash: "", agencia: "Aceleriq" });
    expect(m.whatsapp).not.toContain("código");
    expect(m.email).not.toContain("SHA-256");
    expect(m.whatsapp).toContain("https://painel/contrato/tok");
  });
});

describe("CON-08: link público", () => {
  const contratoDeArquivo = { title: "Contrato PDF", status: "sent", origem: null, admin_signature_name: "Almir", admin_signed_at: "2026-09-30T12:00:00Z", client_signed_at: null, original_file_url: "https://x/c.pdf", original_file_name: "c.pdf" };
  const abrirPublico = () =>
    render(
      <MemoryRouter initialEntries={["/contrato/tok"]}>
        <Routes>
          <Route path="/contrato/:token" element={<ContractPublic />} />
        </Routes>
      </MemoryRouter>,
    );

  it("falha de rede vira \"Tentar de novo\" (não \"link inválido\") e a nova tentativa abre o contrato", async () => {
    let vez = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      vez += 1;
      if (vez === 1) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ contract: contratoDeArquivo, client: { full_name: "Maria" } }), { status: 200 });
    }));
    abrirPublico();
    const tentar = await screen.findByRole("button", { name: "Tentar de novo" });
    expect(screen.queryByText("Link inválido ou expirado")).toBeNull();
    fireEvent.click(tentar);
    expect(await screen.findByRole("link", { name: /Abrir o contrato completo \(PDF\)/ })).toBeTruthy();
    expect((screen.getByRole("link", { name: /Abrir o contrato completo/ }) as HTMLAnchorElement).getAttribute("href")).toBe("https://x/c.pdf");
    expect(document.querySelector("iframe")).toBeTruthy();
  });

  it("5xx é erro de novo; 404 é link inválido", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>erro</html>", { status: 502 })));
    const { unmount } = abrirPublico();
    expect(await screen.findByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })));
    abrirPublico();
    expect(await screen.findByText("Link inválido ou expirado")).toBeTruthy();
  });

  it("no celular o PDF não entra em iframe (só o link); o erro de validação fica logo acima do botão", async () => {
    const largura = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 375, configurable: true, writable: true });
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ contract: contratoDeArquivo, client: { full_name: "Maria" } }), { status: 200 })));
      abrirPublico();
      expect(await screen.findByRole("link", { name: /Abrir o contrato completo/ })).toBeTruthy();
      expect(document.querySelector("iframe")).toBeNull();
      expect(screen.getByText("Seu nome, IP, data e hora ficam registrados como prova da assinatura.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Assinar contrato/ }));
      expect(screen.getByRole("alert").textContent).toContain("marque a confirmação");
    } finally {
      Object.defineProperty(window, "innerWidth", { value: largura, configurable: true, writable: true });
    }
  });

  it("queda de rede ao assinar vira frase em português e o botão volta", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init && init.method === "POST") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ contract: contratoDeArquivo, client: { full_name: "Maria" } }), { status: 200 });
    }));
    abrirPublico();
    await screen.findByRole("link", { name: /Abrir o contrato completo/ });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Assinar contrato/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("A conexão falhou"));
    expect((screen.getByRole("button", { name: /Assinar contrato/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
