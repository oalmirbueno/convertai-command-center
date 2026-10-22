import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import type { TemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";
import { fontesDoProfile, referenciaDaFonteProfile, resolverFonteProfile } from "@/components/mesa/profile/fontesDoProfile";

const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"];
const acervo = ids.map((id, indice) => ({ id, storage_bucket: "workspace", storage_path: `workspace/imagem-${indice + 1}.png`, nome: `Imagem ${indice + 1}`, pasta: null, categoria: null, tags: null, descricao: null }));
const estado = vi.hoisted(() => ({ chamar: vi.fn(), desenhar: vi.fn(), assinar: vi.fn(), acervo: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "cliente-a", carteira: "cliente" }), useMarcaDaMesa: () => ({ marca: null }), useUrlDaMesa: (caminho?: string, bucket = "mesa") => ({ data: caminho ? `https://arquivos.exemplo.com/${bucket}/${caminho}` : undefined, isError: false }) }));
vi.mock("@/components/mesa/instagram/instagramApi", () => ({ chamarInstagram: vi.fn(async () => ({ perfil: { nome: "Loja A", username: "loja.a", foto_url: null }, contas: [], conta_id: null })), normalizarPainel: (v: unknown) => v }));
vi.mock("@/components/mesa/SeletorDoAcervo", () => ({ useAcervo: () => ({ data: estado.acervo(), isPending: false, isError: false }) }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: (...args: unknown[]) => estado.chamar(...args), textoDoErro: (e: Error) => e.message, padraoPara: () => null }));
vi.mock("@/components/mesa/profile/renderProfile", () => ({ TEMPO_PADRAO: { twitter: "2h", instagram: "Há 2 horas", story: "2 h" }, carregarImagemProfile: vi.fn(async (src: string) => ({ src, naturalWidth: 400, naturalHeight: 500 })), desenharProfile: (...args: unknown[]) => estado.desenhar(...args) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: (bucket: string) => ({ createSignedUrl: (...args: unknown[]) => estado.assinar(bucket, ...args), upload: vi.fn() }) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import TemplateProfileEditor from "@/components/mesa/profile/TemplateProfileEditor";

const cfg: TemplateProfile = { versao: 1, estilo: "twitter", nome: "Loja A", username: "loja.a", texto: "Outra lâmina", verificado: false, tema: "claro", cor_fundo: "#ffffff", tamanho_texto: 36, tamanho_foto: 76, espacamento: 30, arredondamento: 16 };
const ponto = { x: .25, y: .6, rotulo: "Configurações" };
const trabalho: Trabalho = { id: "trabalho-a", task_id: null, status: "dirigido", direcao: { cards: [{ ordem: 1, texto_exato: "Conteúdo preparado", imagens_ids: ids.slice(0, 2) }, { ordem: 2, texto_exato: "Outra lâmina", imagens_ids: [ids[2]] }] }, modelo_imagem_id: null, qualidade: null, cards: [], legenda: null, file_ids: [], custo_usd: 0, conversa_id: null, atualizado_em: "2026-10-21" };
function montar(t = trabalho, ordem = 1) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}><TemplateProfileEditor trabalho={t} card={t.direcao.cards!.find((c) => c.ordem === ordem)!} bloqueado={false} onMudou={vi.fn()} onAbrirFotos={vi.fn()} /></QueryClientProvider>);
}
const pronto = () => waitFor(() => expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeEnabled());
const etapa = (nome: string) => fireEvent.click(screen.getByRole("button", { name: nome }));
beforeEach(() => {
  sessionStorage.clear(); Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 }); estado.acervo.mockReset().mockReturnValue(acervo);
  estado.chamar.mockReset().mockResolvedValue({ trabalho });
  estado.assinar.mockReset().mockImplementation(async (bucket: string, caminho: string) => ({ data: { signedUrl: `https://arquivos.exemplo.com/${bucket}/${caminho}` }, error: null }));
  estado.desenhar.mockReset().mockImplementation((canvas: HTMLCanvasElement) => { canvas.width = 1080; canvas.height = 1350; return { imagem: { x: 200, y: 400, largura: 400, altura: 500 } }; });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cG5n");
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 550, bottom: 695, width: 540, height: 675, toJSON: () => ({}) });
});
describe("Profile mantém a imagem de acervo pelo ID autorizado", () => {
  it("resolve pelo ID ligado à lâmina, sem aceitar bucket ou ID externo", () => {
    const fontes = fontesDoProfile(trabalho.direcao.cards![0], acervo, "cliente-a");
    const segunda = resolverFonteProfile(fontes, { imagem_acervo_id: ids[1] });
    expect(segunda).toMatchObject({ acervo_id: ids[1], bucket: "workspace", caminho: acervo[1].storage_path });
    expect(referenciaDaFonteProfile(segunda)).toEqual({ imagem_acervo_id: ids[1], imagem_caminho: undefined });
    expect(resolverFonteProfile(fontes, { imagem_acervo_id: ids[2] })).toBeUndefined();
    expect(resolverFonteProfile(fontes, { imagem_caminho: acervo[1].storage_path })).toBeUndefined();
  });
  it("salva a segunda imagem, reabre pelos metadados e a preserva com seu ponto no lote", async () => {
    const tela = montar(); await pronto(); etapa("Imagem");
    fireEvent.change(screen.getByLabelText("Imagem real do template"), { target: { value: `acervo:${ids[1]}` } });
    await pronto();
    fireEvent.change(screen.getByLabelText("Rótulo do ponto na imagem"), { target: { value: ponto.rotulo } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar ponto na imagem" }));
    fireEvent.click(screen.getByLabelText("Prévia do template Profile"), { clientX: 160, clientY: 370 });
    await pronto();
    fireEvent.click(screen.getByRole("button", { name: "Guardar nova versão" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    const salvo = estado.chamar.mock.calls[0][1].template as TemplateProfile;
    expect(salvo).toMatchObject({ imagem_acervo_id: ids[1], destaque: ponto });
    expect(salvo.imagem_caminho).toBeUndefined();
    expect(estado.assinar).toHaveBeenCalledWith("workspace", acervo[1].storage_path, 3600);
    tela.unmount(); sessionStorage.clear(); estado.chamar.mockClear(); estado.assinar.mockClear();
    const reaberto: Trabalho = { ...trabalho, cards: [{ ordem: 1, versao: 1, storage_path: "cliente-a/arte-1.png", template_profile: salvo }, { ordem: 2, versao: 1, storage_path: "cliente-a/arte-2.png", template_profile: { ...cfg, imagem_acervo_id: ids[2] } }] };
    const previa = montar(reaberto); await pronto(); etapa("Imagem");
    expect(screen.getByLabelText("Imagem real do template")).toHaveValue(`acervo:${ids[1]}`);
    expect(screen.getByRole("button", { name: "Remover ponto" })).toBeInTheDocument();
    expect(estado.desenhar.mock.calls[estado.desenhar.mock.calls.length - 1][3].imagem.src).toContain(acervo[1].storage_path);
    previa.unmount(); sessionStorage.clear();
    // Mesmo abrindo outra lâmina, Montar todas conserva a escolha e o ponto da primeira.
    montar(reaberto, 2); await pronto();
    fireEvent.click(screen.getByRole("button", { name: "Montar todas as lâminas" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledTimes(2));
    expect(estado.chamar.mock.calls[0][1]).toMatchObject({ ordem: 1, template: { imagem_acervo_id: ids[1], destaque: ponto } });
    expect(estado.chamar.mock.calls[1][1]).toMatchObject({ ordem: 2, template: { imagem_acervo_id: ids[2] } });
    expect(estado.chamar.mock.calls[1][1].template.destaque).toBeUndefined();
    expect(estado.assinar.mock.calls.map((c) => c.slice(0, 2))).toEqual([["workspace", acervo[1].storage_path], ["workspace", acervo[2].storage_path]]);
  });
  it("não troca silenciosamente a imagem quando o ID salvo foi removido da lâmina", async () => {
    montar({ ...trabalho, cards: [{ ordem: 1, versao: 1, storage_path: "cliente-a/arte.png", template_profile: { ...cfg, texto: "Conteúdo preparado", imagem_acervo_id: ids[2], destaque: ponto } }] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Usar imagem atual" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeDisabled();
    expect(estado.chamar).not.toHaveBeenCalled();
  });
});
