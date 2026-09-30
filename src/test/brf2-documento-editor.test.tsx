import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente BRF2: editar o documento de entrega antes do PDF. As provas mudam de
 * ordem e de legenda, o texto de uma seção entra pela peça "Preencher com IA"
 * (papel "documento", com os eventos reais como contexto), o número manual só
 * entra com fonte, e Gerar PDF salva o rascunho antes, com o custo à vista.
 */

const ler = vi.fn();
const salvar = vi.fn();
const gerar = vi.fn();
const estimar = vi.fn();
const preencherProps: Array<Record<string, unknown>> = [];

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn(), storage: { from: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/mesa/MesaContexto", () => ({ ImagemDaMesa: ({ alt }: { alt: string }) => h("span", { "data-imagem": alt }) }));
vi.mock("@/components/sistema/PreencherComIA", () => ({
  default: (p: Record<string, unknown>) => {
    preencherProps.push(p);
    const campos = p.campos as Array<{ chave: string }>;
    return h("button", { type: "button", onClick: () => (p.onAplicar as (v: Record<string, unknown>) => void)({ [campos[0].chave]: "Texto da IA com base nos eventos." }) }, `IA ${campos.map((c) => c.chave).join(",")}`);
  },
  PreencherComIA: () => null,
}));
vi.mock("@/lib/documentos/registrarEntrega", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/documentos/registrarEntrega")>();
  return {
    ...real,
    lerRascunho: (a: unknown) => ler(a),
    salvarRascunho: (id: string, r: unknown) => salvar(id, r),
    gerarDocumento: (p: unknown) => gerar(p),
    estimarDocumento: (c: string, o: unknown) => estimar(c, o),
  };
});

import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import EditorDoDocumento from "@/components/documentos/EditorDoDocumento";
import { normalizarRascunho } from "../../supabase/functions/_shared/documento-modelos";

const DOC = { id: "d1", client_id: "c1", marca_id: null, tipo: "mes_de_pautas", referencia: "2026-09", titulo: "Entrega de setembro", numero: 3, versao: 0, status: "pendente", file_id: null, avisos: [], custo_usd: 0, criado_em: "2026-10-01T10:00:00Z" };
const vista = () => ({
  documento: DOC,
  rascunho: normalizarRascunho({
    modelo: "mensal",
    titulo: "Entrega de setembro",
    resumo: "Neste documento estão 2 publicações feitas.",
    provas: [
      { evento_id: "editorial_publications:p1", incluir: true, legenda: "Feed" },
      { evento_id: "editorial_publications:p2", incluir: true, legenda: "Reels" },
    ],
    numeros: [{ rotulo: "Curtidas", valor: 1500, fonte: "Instagram", incluir: true }],
  }),
  eventos: [
    { id: "editorial_publications:p1", grupo: "Publicado", quando: "2026-09-05T12:00:00Z", titulo: "Carrossel do pernil", detalhe: null, link: null },
    { id: "editorial_publications:p2", grupo: "Publicado", quando: "2026-09-12T12:00:00Z", titulo: "Reels da ceia", detalhe: null, link: null },
  ],
  candidatos: [
    { id: "editorial_publications:p1", titulo: "Carrossel do pernil", legenda: "Feed", quando: "2026-09-05T12:00:00Z", forte: true, imagem: { bucket: "mesa", caminho: "a.jpg" } },
    { id: "editorial_publications:p2", titulo: "Reels da ceia", legenda: "Reels", quando: "2026-09-12T12:00:00Z", forte: true, imagem: { bucket: "mesa", caminho: "b.jpg" } },
  ],
  numeros: [{ rotulo: "Curtidas", valor: 1500, fonte: "Instagram" }],
  avisos: [],
  modelos: {},
});

beforeEach(() => {
  ler.mockReset();
  salvar.mockReset();
  gerar.mockReset();
  estimar.mockReset();
  preencherProps.length = 0;
  ler.mockResolvedValue(vista());
  salvar.mockImplementation(async (_id: string, r: unknown) => ({ documento: DOC, rascunho: r }));
  estimar.mockResolvedValue({ estimativa_usd: 0, modelo_id: "m1", texto_da_equipe: true });
  gerar.mockResolvedValue({ documento: { ...DOC, numero: 3 }, file_id: "f1", avisos: [], eventos: 2, provas: 2, provas_com_imagem: 2, custo_usd: 0, saldo_usd: 1 });
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(EditorDoDocumento, { aberto: true, onFechar: vi.fn(), alvo: { documentoId: "d1", clientId: "c1" } })))),
  );
}

describe("editor do documento de entrega", () => {
  it("ordem das provas, legenda, texto pela IA e número manual com fonte vão para o rascunho salvo", async () => {
    montar();
    await screen.findByText("Carrossel do pernil");
    // A peça comum recebe os eventos reais como contexto e o papel "documento".
    expect(preencherProps[0]).toMatchObject({ papel: "documento", clientId: "c1" });
    expect(String(preencherProps[0].contexto)).toContain("Carrossel do pernil");
    fireEvent.click(screen.getByRole("button", { name: "Descer Carrossel do pernil" }));
    fireEvent.change(screen.getByLabelText("Legenda de Reels da ceia"), { target: { value: "O Reels mais visto do mês" } });
    fireEvent.click(screen.getByRole("button", { name: /^IA secao\.destaques$/ }));
    expect((screen.getByLabelText("Destaques do mês", { selector: "textarea" }) as HTMLTextAreaElement).value).toBe("Texto da IA com base nos eventos.");
    // Número manual sem fonte não entra.
    fireEvent.change(screen.getByLabelText("Rótulo do número"), { target: { value: "Leads" } });
    fireEvent.change(screen.getByLabelText("Valor do número"), { target: { value: "42" } });
    const botaoNumero = screen.getByRole("button", { name: /Número/ });
    expect(botaoNumero).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Fonte do número"), { target: { value: "Gerenciador de anúncios, 30/09" } });
    fireEvent.click(botaoNumero);
    fireEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }));
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    const [id, r] = salvar.mock.calls[0];
    expect(id).toBe("d1");
    expect(r.provas.map((p: { evento_id: string }) => p.evento_id)).toEqual(["editorial_publications:p2", "editorial_publications:p1"]);
    expect(r.provas[0].legenda).toBe("O Reels mais visto do mês");
    expect(r.secoes.find((s: { id: string }) => s.id === "destaques").texto).toBe("Texto da IA com base nos eventos.");
    expect(r.numeros.find((n: { rotulo: string }) => n.rotulo === "Leads")).toMatchObject({ valor: 42, manual: true, fonte: "Gerenciador de anúncios, 30/09" });
  });

  it("Gerar PDF salva o rascunho antes, mostra o custo (sem IA com o texto da equipe) e usa o rascunho", async () => {
    montar();
    await screen.findByText("Carrossel do pernil");
    fireEvent.change(screen.getByLabelText("Resumo", { selector: "textarea" }), { target: { value: "Setembro teve duas publicações." } });
    fireEvent.click(screen.getByRole("button", { name: /Gerar PDF/ }));
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(estimar).toHaveBeenCalledWith("c1", { documentoId: "d1", usarRascunho: true }));
    const janela = await screen.findByRole("alertdialog");
    expect(within(janela).getByText(/Sem custo de IA/)).toBeInTheDocument();
    fireEvent.click(within(janela).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(gerar).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", tipo: "mes_de_pautas", referencia: "2026-09", usarRascunho: true, documentoId: "d1" })));
  });
});
