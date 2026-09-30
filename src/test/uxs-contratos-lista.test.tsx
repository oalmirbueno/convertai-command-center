import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * UXS (30/09): a lista de /contratos (e Contratos dentro de Arquivos do cliente).
 * - CON-03: o PDF segue subir, assinar e enviar; Enviar abre a janela (nada de
 *   e-mail num clique); a assinatura começa sempre sem o aceite marcado.
 * - CON-04: "Em andamento" é o padrão; a busca não esconde encerrados.
 * - CON-11: sem cliente, a lateral do agente oferece escolher ali mesmo.
 * - CON-13: só as colunas da lista (sem o texto congelado); esqueleto do painel.
 * - CON-14: a linha inteira abre o contrato, sem recarregar a página.
 */

const estado = vi.hoisted(() => ({
  contratos: [] as any[],
  clientes: [] as any[],
  selects: [] as Array<{ tabela: string; colunas: string }>,
  invoke: null as any,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin", full_name: "Almir" }, user: { id: "u-1" } }) }));
vi.mock("@/hooks/useSupabaseData", () => ({ useClients: () => ({ data: estado.clientes }) }));
vi.mock("@/integrations/supabase/client", () => {
  const cadeia = (tabela: string) => {
    const c: any = {};
    c.select = (colunas: string) => {
      estado.selects.push({ tabela, colunas });
      return c;
    };
    c.order = () => c;
    c.eq = () => c;
    c.maybeSingle = () => Promise.resolve({ data: { sign_token: "tok-pdf" }, error: null });
    c.then = (ok: any, erro: any) => Promise.resolve({ data: estado.contratos, error: null }).then(ok, erro);
    return c;
  };
  estado.invoke = vi.fn(() => new Promise(() => {}));
  return { supabase: { from: (t: string) => cadeia(t), functions: { invoke: (...a: unknown[]) => estado.invoke(...a) }, storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) } } };
});
vi.mock("@/lib/fileUrls", async () => {
  const real = await vi.importActual<any>("@/lib/fileUrls");
  return { ...real, useResolvedFileUrl: () => ({ url: "https://x/c.pdf", loading: false, error: null }), resolveFileUrl: vi.fn(async () => "https://x/c.pdf") };
});
vi.mock("@/components/contratos/AgenteDeContratos", () => ({ default: ({ clientId }: { clientId: string }) => <div data-agente-do-cliente={clientId}>agente</div> }));

import AdminContracts from "@/pages/AdminContracts";

const base = { description: null, client_id: "cli-1", original_file_url: "", original_file_name: "", admin_signed_at: null, client_signed_at: null, sent_at: null, created_at: "2026-09-30T12:00:00Z", arquivado_em: null, substituido_por: null, numero: null, versao: 1 };
const CONTRATOS = [
  { ...base, id: "a", title: "Contrato Alfa", status: "draft", origem: "modelo", numero: "CT-2026-0001", versao: 1 },
  { ...base, id: "b", title: "Contrato Beta", status: "sent", origem: "modelo", numero: "CT-2026-0002", versao: 3 },
  { ...base, id: "c", title: "PDF sem assinatura", status: "draft", origem: "arquivo", original_file_url: "files://contracts/cli-1/1.pdf", original_file_name: "c.pdf" },
  { ...base, id: "d", title: "PDF assinado", status: "sent", origem: "arquivo", original_file_url: "files://contracts/cli-1/2.pdf", original_file_name: "d.pdf", admin_signed_at: "2026-09-30T12:00:00Z" },
  { ...base, id: "e", title: "Contrato cancelado", status: "cancelled", origem: "modelo", numero: "CT-2026-0005" },
  { ...base, id: "f", title: "Contrato guardado", status: "completed", origem: "modelo", numero: "CT-2026-0006", arquivado_em: "2026-09-30T12:00:00Z", client_signed_at: "2026-09-30T12:00:00Z" },
  { ...base, id: "g", title: "Contrato antigo", status: "substituido", origem: "modelo", numero: "CT-2026-0007", substituido_por: "b" },
];

function Local() {
  const l = useLocation();
  return <p data-local="">{`${l.pathname}${l.search}`}</p>;
}

function abrir(clientId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/arquivos"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <AdminContracts clientId={clientId} />
                <Local />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const linhas = () => Array.from(document.querySelectorAll("[data-linha-do-contrato]")).map((b) => b.textContent || "");

beforeEach(() => {
  estado.contratos = CONTRATOS;
  estado.clientes = [{ id: "cli-1", full_name: "Maria", company_name: "Padaria", email: "maria@paobom.com.br" }];
  estado.selects.length = 0;
  estado.invoke = vi.fn(() => new Promise(() => {}));
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("CON-04 e CON-13: a lista como fila de trabalho", () => {
  it("abre em Em andamento, conta os encerrados e pede só as colunas da lista", async () => {
    abrir("cli-1");
    await waitFor(() => expect(linhas().length).toBe(4));
    expect(linhas().join(" | ")).not.toMatch(/cancelado|guardado|antigo/);
    expect(screen.getByText("4 em andamento · 3 encerrados · 2 em rascunho")).toBeTruthy();
    // v3 só quando a versão passa de 1.
    expect(linhas().find((t) => t.indexOf("Beta") >= 0)).toContain("CT-2026-0002 v3");
    expect(linhas().find((t) => t.indexOf("Alfa") >= 0)).not.toContain(" v1");
    const lista = estado.selects.find((s) => s.tabela === "contracts")!;
    expect(lista.colunas).not.toContain("*");
    expect(lista.colunas).not.toContain("documento_texto");
    expect(lista.colunas).toContain("substituido_por");
  });

  it("a busca não esconde contrato: sem nada em andamento oferece os encerrados; com as duas coisas, avisa embaixo", async () => {
    abrir("cli-1");
    await waitFor(() => expect(linhas().length).toBe(4));
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar contrato" }), { target: { value: "cancelado" } });
    expect(await screen.findByText("Nenhum contrato em andamento com esse termo.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver encerrados (1)" }));
    await waitFor(() => expect(linhas()).toHaveLength(1));
    expect(linhas()[0]).toContain("Contrato cancelado");

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar contrato" }), { target: { value: "" } });
    fireEvent.click(await screen.findByRole("button", { name: /Status do contrato/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Em andamento/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar contrato" }), { target: { value: "Contrato" } });
    const aviso = await screen.findByText(/3 encerrados com esse termo/);
    fireEvent.click(within(aviso.parentElement as HTMLElement).getByRole("button", { name: "Ver" }));
    await waitFor(() => expect(linhas()).toHaveLength(5));
    // Assinado e arquivado aparece como "Arquivado".
    expect(linhas().find((t) => t.indexOf("guardado") >= 0)).toContain("Arquivado");
  });
});

describe("CON-14: abrir pela linha", () => {
  it("a linha inteira abre o contrato de modelo, sem recarregar (Voltar do navegador volta aos Arquivos)", async () => {
    abrir("cli-1");
    await waitFor(() => expect(linhas().length).toBe(4));
    const linha = Array.from(document.querySelectorAll("[data-linha-do-contrato]")).find((b) => (b.textContent || "").indexOf("Alfa") >= 0) as HTMLElement;
    expect(linha.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(linha);
    await waitFor(() => expect(document.querySelector("[data-local]")!.textContent).toBe("/contratos?client=cli-1&contrato=a"));
    expect(screen.getByRole("button", { name: "Abrir Contrato Alfa" })).toBeTruthy();
  });
});

describe("CON-03: PDF pronto", () => {
  it("Enviar abre a janela de envio (nada de e-mail num clique), com o link, a mensagem sem código e o e-mail de destino", async () => {
    abrir("cli-1");
    await waitFor(() => expect(linhas().length).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: /Enviar PDF assinado/ }));
    // A janela é carregada só ao abrir (lazy): dá tempo ao pedaço chegar.
    expect(await screen.findByRole("dialog", { name: "Enviar para o cliente" }, { timeout: 15000 })).toBeTruthy();
    expect(estado.invoke).not.toHaveBeenCalled();
    expect(await screen.findByDisplayValue(/\/contrato\/tok-pdf$/)).toBeTruthy();
    expect(screen.getByText("O e-mail vai para maria@paobom.com.br.")).toBeTruthy();
    const mensagem = (screen.getByRole("textbox", { name: "Mensagem para o WhatsApp" }) as HTMLTextAreaElement).value;
    expect(mensagem).toContain("/contrato/tok-pdf");
    expect(mensagem).not.toContain("código");
  });

  it("assinar pela agência: o aceite começa desmarcado a cada abertura e o botão só libera com nome e aceite", async () => {
    abrir("cli-1");
    await waitFor(() => expect(linhas().length).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: /Assinar PDF sem assinatura/ }));
    const janela = await screen.findByRole("dialog", { name: "Assinar contrato" });
    const assinar = within(janela).getByRole("button", { name: /Assinar contrato/ }) as HTMLButtonElement;
    expect(assinar.disabled).toBe(true);
    expect(within(janela).getByRole("link", { name: /Abrir o contrato completo/ })).toBeTruthy();
    fireEvent.click(within(janela).getByRole("checkbox"));
    expect(assinar.disabled).toBe(false);
    fireEvent.click(within(janela).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assinar contrato" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Assinar PDF sem assinatura/ }));
    const denovo = await screen.findByRole("dialog", { name: "Assinar contrato" });
    expect(within(denovo).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    expect((within(denovo).getByRole("button", { name: /Assinar contrato/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("subir PDF: título próprio, o nome do arquivo sugere o título e Criar só libera com arquivo, título e cliente", async () => {
    abrir("cli-1");
    await waitFor(() => expect(linhas().length).toBe(4));
    fireEvent.keyDown(screen.getByRole("button", { name: "Mais ações" }), { key: "Enter" });
    fireEvent.click(await screen.findByText("Subir PDF pronto"));
    const janela = await screen.findByRole("dialog", { name: "Subir contrato em PDF" });
    const criar = within(janela).getByRole("button", { name: "Criar contrato" }) as HTMLButtonElement;
    expect(criar.disabled).toBe(true);
    const arquivo = janela.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(arquivo, { target: { files: [new File(["%PDF"], "Contrato Padaria 2026.pdf", { type: "application/pdf" })] } });
    expect(within(janela).getByDisplayValue("Contrato Padaria 2026")).toBeTruthy();
    expect(criar.disabled).toBe(false);
  });
});

describe("CON-11 e CON-13: lateral e painel", () => {
  it("sem cliente, a lateral oferece escolher o cliente ali mesmo; o painel ocupa o lugar enquanto carrega", async () => {
    // Cliente de verdade tem id UUID (o ?client só vale com UUID).
    const id = "11111111-2222-4333-8444-555555555555";
    estado.clientes = [{ id, full_name: "Maria", company_name: "Padaria", email: "maria@paobom.com.br" }];
    estado.contratos = CONTRATOS.map((c) => ({ ...c, client_id: id }));
    abrir();
    await waitFor(() => expect(linhas().length).toBe(4));
    expect(screen.getAllByLabelText("Carregando o painel").length).toBeGreaterThan(0);
    const lateral = screen.getByRole("complementary", { name: "Agente de contratos" });
    expect(within(lateral).getByText("Escolha um cliente")).toBeTruthy();
    fireEvent.click(within(lateral).getByRole("button", { name: /Escolher cliente/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Padaria/ }));
    await waitFor(() => expect(document.querySelector("[data-local]")!.textContent).toContain(`client=${id}`));
    expect(await screen.findByText("agente", undefined, { timeout: 15000 })).toBeTruthy();
  });
});
