import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gancho do Registro da entrega (Frente DOC, 29/09/2026): qualquer mesa
 * registra a entrega concluída sem custo e sem mandar nada ao cliente; gerar
 * o PDF pede Confirmar com o custo antes; mandar ao cliente é outro Confirmar.
 * Ligado em 2 pontos reais: a entrega do mês (Mesa, aba Entrega) e o projeto
 * concluído (ProjectDrawer).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn(),
    from: vi.fn(),
    storage: { from: vi.fn(() => ({ createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.pdf" }, error: null })) })) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import { registrarEntregaNoBanco } from "../../supabase/functions/_shared/registro-de-entrega";
import BotaoDocumentoDaEntrega from "@/components/documentos/BotaoDocumentoDaEntrega";
import {
  ehRegistroDeEntrega,
  referenciaDoMes,
  registrarEntrega,
  registrarEntregaSemTravar,
  tituloDoRegistro,
} from "@/lib/documentos/registrarEntrega";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const fonte = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

beforeEach(() => {
  mock.invoke.mockReset();
});

describe("registrarEntrega: o gancho não custa nem envia", () => {
  it("chama a função documentos com registrar_entrega, o mês e as provas", async () => {
    mock.invoke.mockResolvedValue({ data: { documento: { id: "d1", status: "pendente" }, custo_usd: 0 }, error: null });
    const doc = await registrarEntrega({ clientId: CLIENTE, marcaId: null, tipo: "mes_de_pautas", referencia: referenciaDoMes("2026-09-01"), provas: ["f1", "f2"] });
    expect(doc).toMatchObject({ id: "d1", status: "pendente" });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    const [funcao, { body }] = mock.invoke.mock.calls[0];
    expect(funcao).toBe("documentos");
    expect(body).toEqual({ acao: "registrar_entrega", client_id: CLIENTE, marca_id: null, tipo: "mes_de_pautas", referencia: "2026-09", provas: ["f1", "f2"] });
    expect(body.confirmado).toBeUndefined();
  });

  it("sem travar quem chamou: a falha volta como texto e vai para o log", async () => {
    mock.invoke.mockResolvedValue({ data: { error: "banco_sem_documentos", mensagem: "O banco ainda não tem a tabela." }, error: null });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await registrarEntregaSemTravar({ clientId: CLIENTE, tipo: "projeto", referencia: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(r.documento).toBeNull();
    expect(r.erro).toBeTruthy();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("o portal reconhece o registro sem as etiquetas (a leitura do cliente não traz tags)", () => {
    expect(ehRegistroDeEntrega({ tags: ["documento_entrega"] })).toBe(true);
    expect(ehRegistroDeEntrega({ folder: "entregas", file_name: "registro-da-entrega-acerbi-0007-v1.pdf" })).toBe(true);
    expect(ehRegistroDeEntrega({ folder: "estrategicos", file_name: "registro-da-entrega-acerbi-0007-v1.pdf" })).toBe(false);
    expect(ehRegistroDeEntrega({ folder: "entregas", file_name: "arte.pdf" })).toBe(false);
    expect(tituloDoRegistro({ description: "Entrega de setembro de 2026. Registro da entrega nº 7, versão 1, código abc.", file_name: "x.pdf" })).toBe("Entrega de setembro de 2026 (nº 0007)");
    expect(tituloDoRegistro({ description: null, file_name: "x.pdf" })).toBe("x.pdf");
  });
});

function montarBotao() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(BotaoDocumentoDaEntrega, { pedido: { clientId: CLIENTE, tipo: "mes_de_pautas", referencia: "2026-09" } })))),
  );
}

describe("BotaoDocumentoDaEntrega: custo à vista e Confirmar antes de gerar", () => {
  it("mostra o custo; cancelar não gera", async () => {
    mock.invoke.mockResolvedValueOnce({ data: { estimativa_usd: 0.0123, modelo_id: "m" }, error: null });
    montarBotao();
    fireEvent.click(screen.getByRole("button", { name: /Documento da entrega/ }));
    await screen.findByText("Gerar o documento da entrega?");
    expect(screen.getByText(/Custo estimado/)).toBeTruthy();
    expect(screen.getByText(/nada vai ao cliente agora/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/ }));
    await waitFor(() => expect(screen.queryByText("Gerar o documento da entrega?")).toBeNull());
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke.mock.calls[0][1].body.acao).toBe("estimar");
  });

  it("Confirmar gera com confirmado: true", async () => {
    mock.invoke
      .mockResolvedValueOnce({ data: { estimativa_usd: 0.01, modelo_id: "m" }, error: null })
      .mockResolvedValueOnce({ data: { documento: { id: "d1", numero: 3, status: "gerado" }, file_id: "f", avisos: [], eventos: 5, provas: 2, provas_com_imagem: 2, custo_usd: 0.01, saldo_usd: 3 }, error: null });
    montarBotao();
    fireEvent.click(screen.getByRole("button", { name: /Documento da entrega/ }));
    await screen.findByText("Gerar o documento da entrega?");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(2));
    const corpo = mock.invoke.mock.calls[1][1].body;
    expect(corpo).toMatchObject({ acao: "gerar_registro", confirmado: true, client_id: CLIENTE, tipo: "mes_de_pautas", referencia: "2026-09" });
  });
});

/** Tabela falsa de documentos_entrega com a chave única (cliente, tipo, referência). */
function tabelaFalsa() {
  const linhas: Array<Record<string, any>> = [];
  const db = {
    from: () => {
      const filtros: Array<[string, unknown]> = [];
      let novo: Record<string, any> | null = null;
      let mudar: Record<string, any> | null = null;
      const achar = () => linhas.filter((l) => filtros.every(([c, v]) => l[c] === v));
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => (filtros.push([c, v]), b),
        maybeSingle: async () => ({ data: achar()[0] || null, error: null }),
        insert: (l: Record<string, any>) => ((novo = l), b),
        update: (l: Record<string, any>) => ((mudar = l), b),
        single: async () => {
          if (novo) {
            if (linhas.some((x) => x.client_id === novo!.client_id && x.tipo === novo!.tipo && x.referencia === novo!.referencia)) return { data: null, error: { code: "23505", message: "duplicada" } };
            const l = { id: `d${linhas.length + 1}`, status: "pendente", ...novo };
            linhas.push(l);
            return { data: l, error: null };
          }
          const alvo = achar()[0];
          Object.assign(alvo, mudar);
          return { data: alvo, error: null };
        },
      };
      return b;
    },
  };
  return { db, linhas };
}

describe("registrarEntregaNoBanco: o gancho no servidor", () => {
  it("cria a linha pendente uma vez; o mesmo pedido soma as provas; nunca lança", async () => {
    const { db, linhas } = tabelaFalsa();
    const pedido = { client_id: CLIENTE, marca_id: null, tipo: "mes_de_pautas" as const, referencia: "2026-09", titulo: null, resumo: "Mês entregue", provas: ["f1"] };
    const a = await registrarEntregaNoBanco(db, pedido, "u1");
    expect(a.erro).toBeNull();
    expect(a.linha).toMatchObject({ status: "pendente", pedido_por: "u1", gancho: { resumo: "Mês entregue", provas: ["f1"] } });
    const b = await registrarEntregaNoBanco(db, { ...pedido, provas: ["f1", "f2"] }, "u2");
    expect(linhas.length).toBe(1);
    expect((b.linha as any).gancho.provas).toEqual(["f1", "f2"]);
    const quebrado = await registrarEntregaNoBanco({ from: () => { throw new Error("sem banco"); } }, pedido, null);
    expect(quebrado).toEqual({ linha: null, erro: { message: "sem banco" } });
  });
});

describe("ligado em 2 pontos reais e seguro no servidor", () => {
  it("Mesa, aba Entrega: registra o mês depois de enviar e mostra o botão", () => {
    const aba = fonte("src/components/mesa/AbaEntrega.tsx");
    expect(aba).toContain("registrarEntregaSemTravar({ ...pedidoDoDocumento, provas })");
    expect(aba).toMatch(/tipo: "mes_de_pautas", referencia: referenciaDoMes\(mes\)/);
    expect(aba).toContain("<BotaoDocumentoDaEntrega pedido={pedidoDoDocumento}");
    // Só depois do envio dar certo.
    expect(aba.indexOf("registrarEntregaSemTravar({")).toBeGreaterThan(aba.indexOf("const enviados = resultados.filter"));
  });

  it("projeto concluído: registra ao virar done (só se o status gravou) e oferece o documento", () => {
    const drawer = fonte("src/components/admin/ProjectDrawer.tsx");
    expect(drawer).toContain('if (newStatus === "done" && anterior !== "done" && project.client_id)');
    expect(drawer).toContain('registrarEntregaSemTravar({ clientId: project.client_id, tipo: "projeto", referencia: project.id, titulo: project.name })');
    expect(drawer.indexOf("if (erroDoStatus)")).toBeLessThan(drawer.indexOf("registrarEntregaSemTravar({"));
    expect(drawer).toContain('currentStatus === "done" && project.client_id && (');
  });

  it("função documentos: Confirmar para gerar e para mandar ao cliente, imagem leve, Jev nas provas, sem enfraquecer o acesso", () => {
    const f = fonte("supabase/functions/documentos/index.ts");
    expect(f).toContain('if (corpo.confirmado !== true) throw new ErroHttp(400, "confirmacao_obrigatoria"');
    expect(f.match(/confirmacao_obrigatoria/g)!.length).toBe(2);
    expect(f).toContain("reduzidaSemTransformacao(");
    expect(f).not.toMatch(/storage\.from\([^)]*\)\.download\(/);
    expect(f).toContain('type: "score"');
    expect(f).toContain("can_access_client");
    expect(f).toContain('rpc("admin_release_file_now"');
    expect(f).toContain('folder: "entregas"');
    expect(f).toContain("respostaComFolego");
    // Frente BASE: papel "documento" e dados da agência conferidos antes de gastar IA.
    expect(f).toContain('modeloDoPapel("documento"');
    expect(f).toContain('const TAREFA = "documento" as const;');
    expect(f).toContain('exigirDadosDaAgencia(servico(), "documento")');
    expect(f.indexOf("const agencia = await dadosDaAgencia();")).toBeGreaterThan(0);
    expect(f.indexOf("const agencia = await dadosDaAgencia();")).toBeLessThan(f.indexOf("const saida = await chamarTexto({"));
    expect(f).toContain("lerLogoDaAgencia(servico(), dados)");
    expect(f).not.toMatch(/[–—]/);
    expect(f.split("\n").length).toBeLessThan(700);
    const conf = fonte("supabase/config.toml");
    expect(conf).toMatch(/\[functions\.documentos\]\s+verify_jwt = true/);
    const sql = fonte("supabase/migrations/20260930040000_documentos_entrega.sql");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.can_access_client(client_id)");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.documentos_entrega FROM authenticated");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM/i);
    expect(fonte("src/lib/mesa/marcas.ts")).toMatch(/FUNCOES_COM_MARCA[\s\S]*\n\s+"documentos",/);
  });
});
