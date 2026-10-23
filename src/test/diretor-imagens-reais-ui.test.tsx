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
    await screen.findByRole("button", { name: /Usar na lâmina/ });
    expect(api).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /Conferir fonte e licença/ })).toHaveAttribute("href", fonte.fonte_url);
    fireEvent.click(screen.getByRole("button", { name: /Usar na lâmina/ }));
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

describe("busca de imagens reais em grade, com notícias e Tudo (23/10)", () => {
  it("no Template abre em Tudo; os achados mostram banco, veículo e data, e a imagem usada volta com a origem", async () => {
    const noticia = { arquivo: "noticia:https%3A%2F%2Fforbes.com.br%2Fx|ONUT.a1b2", nome: "Carro bate recorde", url: "https://www.bing.com/th?id=ONUT.a1b2", miniatura_url: "https://www.bing.com/th?id=ONUT.a1b2&w=480", fonte_url: "https://forbes.com.br/x", licenca: "Imagem da matéria", autor: "Forbes Brasil", banco: "noticias", data: "2026-10-23" };
    const usada = { nome: "Carro bate recorde", caminho: "cliente/estudio/fontes-reais/n.jpg", fonte_url: "https://forbes.com.br/x", licenca: "Imagem da matéria", autor: "Forbes Brasil", banco: "noticias" };
    api.mockResolvedValueOnce({ resultados: [noticia, { ...fonte, banco: "wikimedia" }], melhor: { indice: 0 }, avisos: ["Fotos de matérias são do veículo: use com o crédito."] }).mockResolvedValueOnce({ fonte: usada });
    const aplicada = vi.fn();
    render(<ImagensReaisDoDiretor embutido trabalho={trabalho} ordem={1} bloqueado={false} onAtualizar={vi.fn()} onAplicada={aplicada} consultaInicial="carro elétrico" />);
    expect(screen.getByRole("button", { name: "Tudo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Notícias" })).toBeInTheDocument();
    expect(screen.getByLabelText("Assunto das imagens reais")).toHaveValue("carro elétrico");
    fireEvent.click(screen.getByRole("button", { name: "Buscar em todos" }));
    await screen.findByRole("list", { name: "Imagens encontradas" });
    expect(api.mock.calls[0][1]).toMatchObject({ acao: "imagens_reais_buscar", banco: "todos", consulta: "carro elétrico" });
    expect(screen.getByText("Notícia · Forbes Brasil · 23/10")).toBeInTheDocument();
    expect(screen.getByText("Melhor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usar na lâmina: Carro bate recorde" }));
    await waitFor(() => expect(aplicada).toHaveBeenCalledWith(usada));
    expect(api.mock.calls[1][1]).toMatchObject({ acao: "imagem_real_aplicar", arquivo: noticia.arquivo });
  });
  it("logo não oferece notícias nem Pexels", () => {
    render(<ImagensReaisDoDiretor embutido trabalho={trabalho} ordem={1} bloqueado={false} onAtualizar={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Tipo de imagem real"), { target: { value: "logo" } });
    expect(screen.queryByRole("button", { name: "Notícias" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pexels" })).not.toBeInTheDocument();
  });
});
