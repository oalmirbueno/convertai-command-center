import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: (...args: unknown[]) => api(...args) }));
vi.mock("@/components/mesa/Custo", () => ({ AvisoDeErro: ({ erro }: { erro: Error }) => <div role="alert">{erro.message}</div> }));
import ImagensReaisDoDiretor from "@/components/mesa/ImagensReaisDoDiretor";
const trabalho: Trabalho = { id: "trabalho", task_id: null, status: "dirigido", direcao: { cards: [{ ordem: 1, texto_exato: "Google Analytics" }] }, modelo_imagem_id: null, qualidade: null, cards: [{ ordem: 1, versao: 3, storage_path: "cliente/arte.png" }], legenda: null, file_ids: [], custo_usd: 0, conversa_id: null, atualizado_em: "2026-10-21" };
const fonte = { arquivo: "File:Analytics.svg", nome: "Analytics", fonte_url: "https://commons.wikimedia.org/wiki/File:Analytics.svg", url: "https://upload.wikimedia.org/a.png", licenca: "CC BY 4.0", autor: "Autoria" };
beforeEach(() => { api.mockReset(); });
describe("fontes reais no Diretor", () => {
  it("busca só no clique e exige escolha antes de aplicar com a versão atual", async () => {
    api.mockResolvedValueOnce({ resultados: [fonte] }).mockResolvedValueOnce({ fonte: { nome: "Analytics" } });
    const atualizar = vi.fn();
    render(<ImagensReaisDoDiretor trabalho={trabalho} ordem={1} bloqueado={false} onAtualizar={atualizar} />);
    fireEvent.click(screen.getByText(/Imagens reais · lâmina/));
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Buscar na Wikimedia" }));
    await screen.findByRole("button", { name: "Usar na lâmina" });
    expect(api).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Conferir fonte e licença" })).toHaveAttribute("href", fonte.fonte_url);
    fireEvent.click(screen.getByRole("button", { name: "Usar na lâmina" }));
    await waitFor(() => expect(atualizar).toHaveBeenCalledOnce());
    expect(api.mock.calls[1][1]).toMatchObject({ acao: "imagem_real_aplicar", trabalho_id: "trabalho", ordem: 1, arquivo: fonte.arquivo, versao_esperada: 3, texto_base: "Google Analytics" });
    expect(screen.getByRole("status")).toHaveTextContent("Selecione a imagem no Template");
  });
  it("painel com login pede captura sem anunciar sucesso ou mudar o trabalho", async () => {
    api.mockRejectedValue(new Error("Envie o print autenticado."));
    const atualizar = vi.fn();
    render(<ImagensReaisDoDiretor trabalho={trabalho} ordem={1} bloqueado={false} onAtualizar={atualizar} />);
    fireEvent.click(screen.getByText(/Imagens reais · lâmina/));
    fireEvent.click(screen.getByText("Usar link de uma imagem pública"));
    fireEvent.change(screen.getByLabelText("Link da imagem real"), { target: { value: "https://exemplo.com/painel" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar imagem do link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Envie o print autenticado."));
    expect(atualizar).not.toHaveBeenCalled();
  });
  it("não altera trabalho em aprovação nem deixa abrir fontes inseguras", async () => {
    render(<ImagensReaisDoDiretor trabalho={{ ...trabalho, entrega_status: "aguardando_cliente" }} ordem={1} bloqueado={false} onAtualizar={vi.fn()} />);
    fireEvent.click(screen.getByText(/Imagens reais · lâmina/));
    expect(screen.getByRole("button", { name: "Buscar na Wikimedia" })).toBeDisabled();
    expect(screen.getByLabelText("Link da imagem real")).toBeDisabled();
    expect(api).not.toHaveBeenCalled();
  });
});
