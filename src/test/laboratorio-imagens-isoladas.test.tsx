import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExecucaoDoLab, ImagemDoLab } from "@/lib/laboratorio/api";
import type { NoDoLab } from "@/lib/laboratorio/nos";
import { ContextoDoQuadro, type AcoesDoQuadro } from "@/components/laboratorio/no/contexto";

const m = vi.hoisted(() => ({ ajustar: vi.fn(), variar: vi.fn(), novaExecucao: vi.fn(), antes: vi.fn(async () => {}) }));
vi.mock("@/lib/laboratorio/api", () => ({ ajustarImagem: m.ajustar, variarImagem: m.variar, custoDoPreencher: () => null, noMotorDaCasa: (_tipo: string, ex: ExecucaoDoLab) => ex.status === "aguardando", salvarNosArquivos: vi.fn(), enderecoDaAprovacao: () => "" }));
vi.mock("@/lib/laboratorio/arquivos", () => ({ enderecoParaBaixar: vi.fn(), enderecosAssinados: async () => ({}), lerHtmlSalvo: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/sistema", async (original) => ({ ...(await original<typeof import("@/components/sistema")>()), JanelaCentral: ({ aberta, children }: { aberta: boolean; children: React.ReactNode }) => aberta ? <div role="dialog">{children}</div> : null }));
import ImagensDoResultado from "@/components/laboratorio/no/ImagensDoResultado";

const imagens: ImagemDoLab[] = [1, 2, 3].map((i) => ({ path: `p/peca-${i}.png`, url: `https://imagens.example/peca-${i}.png` }));
const no: NoDoLab = { id: "carrossel", tipo: "carrossel", x: 0, y: 0, dados: {} };
const ex = (status: ExecucaoDoLab["status"], recebidas: ImagemDoLab[] = imagens): ExecucaoDoLab => ({ id: status, no_id: no.id, tipo: no.tipo, status, custo_usd: 0.1, erro: "", rodada_id: null, created_at: "2026-10-21T12:00:00Z", saida: { texto: "Carrossel com três peças", imagens: recebidas, html_path: "", html_url: "", tarefa_id: "", tarefa_url: "", escolha: null, aviso_jev: "", avisos: [], json: null, fontes: [], storyboards: [], storyboard_escolhido: null, etapa_filme: "", render_progresso: null, video_url: "", video_path: "", estado_no_ar: null, aprovacao_id: "", link_aprovacao: "", operador: "", prova: "", link_no_ar: "", rascunho_sem_fonte: [] } });
const acoes: AcoesDoQuadro = { projetoId: "p1", clienteId: "c1", clientes: [], antesDeChamar: m.antes, travado: false, mudarDados: vi.fn(), rodar: vi.fn(), duplicar: vi.fn(), sincronizar: null, abrirDetalhes: null, apagar: vi.fn(), alternarExpandido: vi.fn(), abrirMenu: vi.fn(), escolherStoryboard: vi.fn(), desligar: vi.fn(), mudarGatilho: vi.fn(), novaExecucao: m.novaExecucao, ligarNovo: vi.fn(), usarComoReferencia: vi.fn() };
const tela = (execucao: ExecucaoDoLab) => <ContextoDoQuadro.Provider value={acoes}><ImagensDoResultado no={no} execucao={execucao} /></ContextoDoQuadro.Provider>;

describe("peças independentes e leitura do carrossel", () => {
  it("muda grade, linha e coluna sem executar geração ou perder as peças", () => {
    const { container } = render(tela(ex("pronto")));
    fireEvent.click(screen.getByRole("button", { name: "Imagens lado a lado" }));
    expect(container.querySelector('[data-disposicao="linha"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Imagens em coluna" }));
    expect(container.querySelector('[data-disposicao="coluna"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Imagens em grade" }));
    expect(container.querySelectorAll("[data-imagem-gerada]")).toHaveLength(3);
    expect(m.ajustar).not.toHaveBeenCalled();
    expect(m.variar).not.toHaveBeenCalled();
    expect(container.querySelector('[data-imagem-gerada="1"] img')?.className).toContain("object-contain");
  });

  it("envia só o índice escolhido e preserva as outras peças durante e depois do ajuste", async () => {
    m.ajustar.mockResolvedValueOnce(ex("na_fila", []));
    const { container, rerender } = render(tela(ex("pronto")));
    fireEvent.click(screen.getByRole("button", { name: "Imagem 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Ajustar" }));
    expect(screen.getByText("Só a peça 2 será ajustada. As demais permanecem.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("O que mudar na imagem 2"), { target: { value: "Corrija apenas o título" } });
    fireEvent.click(container.querySelector('[data-pedir-imagem=""]')!);
    await waitFor(() => expect(m.novaExecucao).toHaveBeenCalled());
    expect(m.ajustar).toHaveBeenCalledWith({ projetoId: "p1", noId: "carrossel", indice: 1, pedido: "Corrija apenas o título", confirmado: false });
    rerender(tela(ex("na_fila", [])));
    expect(container.querySelectorAll("[data-imagem-gerada]")).toHaveLength(3);
    expect(container.querySelector('[data-imagem-gerada="0"] img')?.getAttribute("src")).toBe(imagens[0].url);
    expect(container.querySelector('[data-imagem-gerada="2"] img')?.getAttribute("src")).toBe(imagens[2].url);
    expect(screen.getByText("Peça 2 em ajuste. As outras continuam no lugar.")).toBeTruthy();
    const corrigidas = imagens.map((imagem, i) => i === 1 ? { path: "p/peca-2-revisada.png", url: "https://imagens.example/peca-2-revisada.png" } : imagem);
    rerender(tela(ex("pronto", corrigidas)));
    expect(container.querySelector('[data-imagem-gerada="1"] img')?.getAttribute("src")).toContain("revisada");
    expect(container.querySelector('[data-imagem-gerada="0"] img')?.getAttribute("src")).toBe(imagens[0].url);
    expect(container.querySelector('[data-imagem-gerada="2"] img')?.getAttribute("src")).toBe(imagens[2].url);
    expect(screen.queryByText("Peça 2 em ajuste. As outras continuam no lugar.")).toBeNull();
  });

  it("mantém a prévia anterior se o novo ajuste falhar", () => {
    const { container, rerender } = render(tela(ex("pronto")));
    rerender(tela(ex("rodando", [])));
    expect(container.querySelectorAll("[data-imagem-gerada]")).toHaveLength(3);
    rerender(tela(ex("erro", [])));
    expect(container.querySelectorAll("[data-imagem-gerada]")).toHaveLength(3);
    expect(screen.getByText("A prévia anterior foi preservada. O ajuste não terminou.")).toBeTruthy();
  });

  it("identifica a peça em ajuste pelos metadados mesmo depois de reabrir o canvas", () => {
    const emCurso = ex("aguardando");
    Object.assign(emCurso.saida, { origem: { execucao_id: "anterior", indice: 2, modo: "ajustar" } });
    render(tela(emCurso));
    expect(screen.getByText("Peça 3 em ajuste. As outras continuam no lugar.")).toBeTruthy();
  });
});
