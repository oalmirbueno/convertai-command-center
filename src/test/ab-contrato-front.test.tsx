import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Anti-bug 26/09 (frente AB): contrato front -> Edge Functions.
 * - manage-team recusava a senha provisória do "Novo Cliente" em quase metade das vezes;
 * - o "Processar agora" do conteúdo extraído entrava em laço de pedidos com 401;
 * - o pulso do cliente ia com um tipo que o notify-admin não aceita (400 calado);
 * - pasta com mais de 200 arquivos não apagava (o schema aceita até 200 por vez);
 * - o primeiro acesso mostrava a frase em inglês do SDK no lugar da do servidor.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke }, from: mock.from } }));

import { generatePassword } from "@/components/admin/CreateClientModal";
import ExtractedFramesPreview from "@/components/shared/ExtractedFramesPreview";
import { corpoComMarca, definirMarcaAtual, limparMarcaAtual } from "@/lib/mesa/marcas";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// Mesma régua do servidor (supabase/functions/manage-team/index.ts, validPassword).
const passaNoServidor = (s: string) => s.length >= 12 && s.length <= 128 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s);

describe("senha provisória do Novo Cliente", () => {
  it("sempre passa na régua do manage-team (2.000 sorteios)", () => {
    for (let i = 0; i < 2000; i++) {
      const s = generatePassword();
      expect(passaNoServidor(s), s).toBe(true);
      expect(s).toHaveLength(16);
    }
  });
  it("a régua do servidor continua a mesma que o teste confere", () => {
    const servidor = ler("supabase/functions/manage-team/index.ts");
    expect(servidor).toContain("password.length >= 12");
    expect(servidor).toContain("/[^A-Za-z0-9]/.test(password)");
  });
});

describe("Processar agora do conteúdo extraído", () => {
  const cadeia = (resultado: unknown) => {
    const c: any = {};
    c.select = () => c;
    c.eq = () => c;
    c.order = () => c;
    c.limit = () => Promise.resolve(resultado);
    c.maybeSingle = () => Promise.resolve(resultado);
    return c;
  };
  beforeEach(() => {
    mock.invoke.mockReset();
    mock.from.mockReset();
    mock.from.mockImplementation((tabela: string) =>
      tabela === "staff_files_secure" ? cadeia({ data: { extraction_status: "failed" } }) : cadeia({ data: [] }),
    );
  });

  it("com o worker recusando (401), pede uma vez só e avisa em português", async () => {
    mock.invoke.mockResolvedValue({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code" } });
    render(<ExtractedFramesPreview fileId="f-1" kind="pdf" />);
    await screen.findByText(/A fila de extração roda sozinha/);
    await new Promise((r) => setTimeout(r, 300));
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });

  it("sem erro, recarrega as páginas depois do pedido", async () => {
    mock.invoke.mockResolvedValue({ data: { processed: 1 }, error: null });
    render(<ExtractedFramesPreview fileId="f-2" kind="pdf" />);
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/A fila de extração roda sozinha/)).toBeNull();
  });
});

describe("outros contratos", () => {
  it("o pulso do cliente vai com um tipo que o notify-admin aceita", () => {
    const tela = ler("src/components/client/ClientJourneyDashboard.tsx");
    const servidor = ler("supabase/functions/notify-admin/index.ts");
    const i = tela.indexOf("Pulso respondido:");
    const chamada = tela.slice(i, tela.indexOf('"/central"', i));
    const tipo = /\n\s*"([a-z]+)",\s*$/.exec(chamada);
    expect(tipo && tipo[1]).toBe("update");
    expect(servidor).toContain('"update"');
    expect(chamada).not.toContain('"pulse"');
  });

  it("mesa-publicidade recebe a marca escolhida (campanha_criar lê marca_id)", () => {
    const dono = {};
    definirMarcaAtual("cliente-1", { id: "marca-cme", principal: false }, dono);
    expect(corpoComMarca("mesa-publicidade", { acao: "campanha_criar", client_id: "cliente-1" }).marca_id).toBe("marca-cme");
    limparMarcaAtual(dono);
    expect(ler("supabase/functions/mesa-publicidade/index.ts")).toContain("const marcaId = ehUuid(corpo.marca_id)");
  });

  it("mensagem ao cliente conta publicações só da janela da semana (não 60 linhas quaisquer)", () => {
    const hook = ler("src/hooks/useClientGroupMessage.ts");
    const i = hook.indexOf('supabase.from("editorial_publications")');
    const consulta = hook.slice(i, hook.indexOf("supabase.from(\"projects\")", i));
    expect(consulta).toContain("published_at.gte.${desdeSemana.toISOString()}");
    expect(consulta).toContain("scheduled_at.lt.${proximaSegunda.toISOString()}");
    expect(consulta).not.toContain(".limit(60)");
  });

  it("apagar pasta virtual manda no máximo 200 arquivos por chamada", () => {
    const tela = ler("src/pages/Workspace.tsx");
    expect(tela).toContain("for (let i = 0; i < parentIds.length; i += 200)");
    expect(tela).toContain("fileIds: parentIds.slice(i, i + 200)");
    expect(ler("supabase/functions/delete-file-assets/index.ts")).toContain(".min(1).max(200)");
  });

  it("primeiro acesso lê a frase do corpo do erro antes de cair na mensagem do SDK", () => {
    const tela = ler("src/pages/FirstAccess.tsx");
    const i = tela.indexOf('body: { action: "set_password", token, password }');
    const trecho = tela.slice(i, i + 1400);
    expect(trecho).toContain("corpo.message");
    expect(trecho.indexOf("corpo.message")).toBeLessThan(trecho.indexOf("if (!frase) throw error;"));
  });
});
