import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trabalho } from "@/components/mesa/useItensDoMes";

const estado = vi.hoisted(() => ({ clientId: "cliente-a", carteira: "cliente", perfil: vi.fn(), chamar: vi.fn(), acervoAtivo: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: estado.clientId, carteira: estado.carteira }), useMarcaDaMesa: () => ({ marca: null }), useUrlDaMesa: () => ({ data: undefined, isError: false }) }));
vi.mock("@/components/mesa/instagram/instagramApi", () => ({ chamarInstagram: (...args: unknown[]) => estado.perfil(...args), normalizarPainel: (v: unknown) => v }));
vi.mock("@/components/mesa/SeletorDoAcervo", () => ({ useAcervo: (ativo: boolean) => { estado.acervoAtivo(ativo); return { data: [], isPending: false, isError: false }; } }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: (...args: unknown[]) => estado.chamar(...args), textoDoErro: (e: Error) => e.message }));
vi.mock("@/components/mesa/profile/renderProfile", () => ({ carregarImagemProfile: vi.fn(async () => ({})), desenharProfile: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrl: vi.fn(), upload: vi.fn() }) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import TemplateProfileEditor from "@/components/mesa/profile/TemplateProfileEditor";
import { fonteDoProfile } from "@/components/mesa/profile/fontesDoProfile";

const trabalho: Trabalho = { id: "trabalho-a", task_id: null, status: "dirigido", direcao: { cards: [{ ordem: 1, texto_exato: "Conteúdo preparado" }] }, modelo_imagem_id: null, qualidade: null, cards: [], legenda: null, file_ids: [], custo_usd: 0, conversa_id: null, atualizado_em: "2026-10-21" };
const painel = (nome: string, username: string) => ({ perfil: { nome, username, foto_url: null, lido_em: null }, contas: [], conta_id: null });
function montar(t = trabalho) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}><TemplateProfileEditor key={estado.clientId} trabalho={t} card={t.direcao.cards![0]} bloqueado={false} onMudou={vi.fn()} onAbrirFotos={vi.fn()} /></QueryClientProvider>);
}
beforeEach(() => {
  sessionStorage.clear(); estado.clientId = "cliente-a"; estado.carteira = "cliente";
  estado.perfil.mockReset().mockResolvedValue(painel("Loja A", "loja.a")); estado.chamar.mockReset().mockResolvedValue({ trabalho: { ...trabalho } }); estado.acervoAtivo.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cG5n");
});
describe("Template Profile no Estúdio compartilhado", () => {
  it("preenche o perfil real sem inferir selo e salva nova versão sem pedir imagem IA", async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText("Nome de exibição do template")).toHaveValue("Loja A"));
    expect(screen.getByLabelText("Exibir selo no layout")).not.toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Guardar nova versão" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1]).toMatchObject({ acao: "salvar_template", trabalho_id: "trabalho-a", ordem: 1, versao_esperada: 0, texto_base: "Conteúdo preparado", template: { nome: "Loja A", username: "loja.a", verificado: false } });
  });
  it("no Livre não busca nem herda o perfil interno e continua resolvendo fotos anexadas", async () => {
    estado.carteira = "laboratorio";
    montar({ ...trabalho, direcao: { cards: [{ ordem: 1, texto_exato: "Livre", imagens_ids: ["foto-escolhida"] }] } });
    expect(estado.perfil).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome de exibição do template")).toHaveValue("");
    expect(estado.acervoAtivo).toHaveBeenCalledWith(true);
    expect(screen.queryByText("Carregando fotos…")).not.toBeInTheDocument();
  });
  it("rascunho antigo não sobrescreve copy atual sem uma escolha explícita", async () => {
    const tela = montar(); await waitFor(() => expect(screen.getByLabelText("Nome de exibição do template")).toHaveValue("Loja A"));
    fireEvent.change(screen.getByLabelText("Texto do template"), { target: { value: "Minha edição antiga" } }); tela.unmount();
    montar({ ...trabalho, direcao: { cards: [{ ordem: 1, texto_exato: "Novo texto do diretor" }] } });
    expect(screen.getByText("O texto da lâmina mudou desde que você abriu este rascunho.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Usar texto atual da lâmina" }));
    expect(screen.getByLabelText("Texto do template")).toHaveValue("Novo texto do diretor");
    expect(estado.chamar).not.toHaveBeenCalled();
  });
  it("prioriza a foto de fundo real sobre uma referência de rosto", () => {
    expect(fonteDoProfile({ ordem: 1, fotos_livres: [{ caminho: "a/rosto.png", papel: "elemento", uso: "rosto" }, { caminho: "a/produto.png", papel: "fundo" }] }, [])).toEqual({ caminho: "a/produto.png", bucket: "mesa" });
  });
  it("trocar de cliente não mostra o perfil anterior enquanto a nova leitura está pendente", async () => {
    const tela = montar(); await waitFor(() => expect(screen.getByLabelText("Nome de exibição do template")).toHaveValue("Loja A"));
    tela.unmount(); estado.clientId = "cliente-b";
    estado.perfil.mockImplementation(() => new Promise(() => {}));
    montar({ ...trabalho, id: "trabalho-b" });
    expect(screen.getByLabelText("Nome de exibição do template")).toHaveValue("");
    expect(screen.getByLabelText("Perfil do Instagram do template")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeDisabled();
  });
  it("recupera a conta secundária pelo @ salvo sem usar o avatar da principal", async () => {
    const dados = { ...painel("Marca Principal", "principal"), contas: [{ id: "conta-1", username: "principal" }, { id: "conta-2", username: "secundaria" }], conta_id: "conta-1" };
    estado.perfil.mockImplementation((_acao: string, _cliente: string, extra: { conta_id?: string }) => Promise.resolve(extra?.conta_id === "conta-2" ? { ...dados, ...painel("Marca Secundária", "secundaria"), contas: dados.contas, conta_id: "conta-2" } : dados));
    montar({ ...trabalho, cards: [{ ordem: 1, versao: 1, storage_path: "cliente-a/arte.png", template_profile: { versao: 1, estilo: "twitter", nome: "Marca Secundária", username: "secundaria", texto: "Conteúdo preparado", verificado: false, tema: "claro", cor_fundo: "#ffffff", tamanho_texto: 36, tamanho_foto: 76, espacamento: 30, arredondamento: 16 } }] });
    await waitFor(() => expect(estado.perfil).toHaveBeenCalledWith("painel", "cliente-a", { conta_id: "conta-2" }));
    expect(screen.getByLabelText("Nome de exibição do template")).toHaveValue("Marca Secundária");
  });
  it("bloqueia a montagem enquanto a peça está em aprovação", async () => {
    montar({ ...trabalho, entrega_status: "aguardando_cliente" });
    await waitFor(() => expect(screen.getByLabelText("Nome de exibição do template")).toHaveValue("Loja A"));
    expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeDisabled();
    expect(screen.getByLabelText("Estilo do template")).toBeDisabled();
  });
});
