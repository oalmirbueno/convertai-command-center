import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trabalho } from "@/components/mesa/useItensDoMes";

const estado = vi.hoisted(() => ({ chamar: vi.fn(), desenhar: vi.fn(), assinar: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "cliente-a", carteira: "cliente" }), useMarcaDaMesa: () => ({ marca: null }), useUrlDaMesa: (caminho?: string) => ({ data: caminho ? `https://arquivos.exemplo.com/${caminho}` : undefined, isError: false }) }));
vi.mock("@/components/mesa/instagram/instagramApi", () => ({ chamarInstagram: vi.fn(async () => ({ perfil: { nome: "Loja A", username: "loja.a", foto_url: null }, contas: [], conta_id: null })), normalizarPainel: (v: unknown) => v }));
vi.mock("@/components/mesa/SeletorDoAcervo", () => ({ useAcervo: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: (...args: unknown[]) => estado.chamar(...args), textoDoErro: (e: Error) => e.message }));
vi.mock("@/components/mesa/profile/renderProfile", () => ({ carregarImagemProfile: vi.fn(async () => ({ naturalWidth: 400, naturalHeight: 500 })), desenharProfile: (...args: unknown[]) => estado.desenhar(...args) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrl: (...args: unknown[]) => estado.assinar(...args), upload: vi.fn() }) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import TemplateProfileEditor from "@/components/mesa/profile/TemplateProfileEditor";

const trabalho: Trabalho = { id: "trabalho-a", task_id: null, status: "dirigido", direcao: { cards: [{ ordem: 1, texto_exato: "Conteúdo preparado", vitrine_tipo: "pagina_real", vitrine_de_logos: [{ caminho: "cliente-a/painel.png", nome: "https://exemplo.com/configuracoes" }], fontes_reais: [{ caminho: "cliente-a/logo.png", nome: "Marca oficial", fonte_url: "https://exemplo.com/marca", licenca: "Uso autorizado", autor: "Marca", tipo: "logo" }] }] }, modelo_imagem_id: null, qualidade: null, cards: [], legenda: null, file_ids: [], custo_usd: 0, conversa_id: null, atualizado_em: "2026-10-21" };
function montar(t = trabalho) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}><TemplateProfileEditor trabalho={t} card={t.direcao.cards![0]} bloqueado={false} onMudou={vi.fn()} onAbrirFotos={vi.fn()} /></QueryClientProvider>);
}
beforeEach(() => {
  sessionStorage.clear();
  estado.chamar.mockReset().mockResolvedValue({ trabalho });
  estado.assinar.mockReset().mockImplementation(async (caminho: string) => ({ data: { signedUrl: `https://arquivos.exemplo.com/${caminho}` }, error: null }));
  estado.desenhar.mockReset().mockImplementation((canvas: HTMLCanvasElement) => { canvas.width = 1080; canvas.height = 1350; return { imagem: { x: 200, y: 400, largura: 400, altura: 500 } }; });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cG5n");
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 550, bottom: 695, width: 540, height: 675, toJSON: () => ({}) });
});
async function pronto() { await waitFor(() => expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeEnabled()); }
describe("Profile com fontes e ponto manual", () => {
  it("apresenta fonte real existente e permite escolher outro arquivo, sem redesenho IA", async () => {
    montar(); await pronto();
    expect(screen.getByRole("link", { name: "Abrir fonte da imagem" })).toHaveAttribute("href", "https://exemplo.com/configuracoes");
    fireEvent.change(screen.getByLabelText("Imagem real do template"), { target: { value: "cliente-a/logo.png" } });
    await pronto();
    expect(screen.getByText("Uso autorizado", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar nova versão" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1]).toMatchObject({ acao: "salvar_template", template: { imagem_caminho: "cliente-a/logo.png" } });
    expect(estado.desenhar.mock.calls[estado.desenhar.mock.calls.length - 1][3]).toMatchObject({ imagemExata: true });
  });
  it("aceita somente clique na imagem e guarda a posição normalizada igual à prévia", async () => {
    montar(); await pronto();
    fireEvent.change(screen.getByLabelText("Rótulo do ponto na imagem"), { target: { value: "Configurações" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar ponto na imagem" }));
    fireEvent.click(screen.getByLabelText("Prévia do template Profile"), { clientX: 35, clientY: 370 });
    expect(screen.getByRole("alert")).toHaveTextContent("Clique dentro da imagem real");
    expect(screen.queryByRole("button", { name: "Remover ponto" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Prévia do template Profile"), { clientX: 160, clientY: 370 });
    await pronto();
    expect(screen.getByRole("button", { name: "Remover ponto" })).toBeInTheDocument();
    const destaque = { x: .25, y: .6, rotulo: "Configurações" };
    expect(estado.desenhar.mock.calls[estado.desenhar.mock.calls.length - 1][1]).toMatchObject({ destaque });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nova versão" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1]).toMatchObject({ template: { imagem_caminho: "cliente-a/painel.png", destaque } });
    expect(estado.desenhar.mock.calls[estado.desenhar.mock.calls.length - 1][1]).toMatchObject({ destaque });
  });
  it("trocar a imagem remove o ponto em vez de indicar outro botão", async () => {
    montar(); await pronto();
    fireEvent.change(screen.getByLabelText("Rótulo do ponto na imagem"), { target: { value: "Abrir" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar ponto na imagem" }));
    fireEvent.click(screen.getByLabelText("Prévia do template Profile"), { clientX: 160, clientY: 370 });
    await pronto();
    fireEvent.change(screen.getByLabelText("Imagem real do template"), { target: { value: "cliente-a/logo.png" } });
    await pronto();
    expect(screen.queryByRole("button", { name: "Remover ponto" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar nova versão" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1].template.destaque).toBeUndefined();
  });
  it("não replica o ponto para a imagem de outra lâmina ao montar o lote", async () => {
    montar({ ...trabalho, direcao: { cards: [...trabalho.direcao.cards!, { ordem: 2, texto_exato: "Outra tela", vitrine_de_logos: [{ caminho: "cliente-a/outra.png", nome: "Outra tela" }] }] } });
    await pronto();
    fireEvent.change(screen.getByLabelText("Rótulo do ponto na imagem"), { target: { value: "Abrir" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar ponto na imagem" }));
    fireEvent.click(screen.getByLabelText("Prévia do template Profile"), { clientX: 160, clientY: 370 });
    await pronto();
    fireEvent.click(screen.getByRole("button", { name: "Montar todas as lâminas" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledTimes(2));
    expect(estado.chamar.mock.calls[0][1].template.destaque).toMatchObject({ x: .25, y: .6 });
    expect(estado.chamar.mock.calls[1][1].template.destaque).toBeUndefined();
    expect(estado.chamar.mock.calls[1][1].template.imagem_caminho).toBe("cliente-a/outra.png");
  });
});
