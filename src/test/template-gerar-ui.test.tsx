import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trabalho } from "@/components/mesa/useItensDoMes";

const estado = vi.hoisted(() => ({ chamar: vi.fn(), botoes: [] as Array<{ titulo: string; sempreConfirmar?: boolean; partes: unknown }> }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "cliente-a", carteira: "cliente", catalogo: [] }), useMarcaDaMesa: () => ({ marca: null }), useUrlDaMesa: (caminho?: string) => ({ data: caminho ? `https://arquivos.exemplo.com/${caminho}` : undefined, isError: false }) }));
vi.mock("@/components/mesa/instagram/instagramApi", () => ({ chamarInstagram: vi.fn(async () => ({ perfil: { nome: "Padaria", username: "padaria", foto_url: null }, contas: [], conta_id: null })), normalizarPainel: (v: unknown) => v }));
vi.mock("@/components/mesa/SeletorDoAcervo", () => ({ useAcervo: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: (...args: unknown[]) => estado.chamar(...args), textoDoErro: (e: Error) => e.message, padraoPara: () => ({ id: "diretor-padrao" }) }));
vi.mock("@/components/mesa/profile/renderProfile", () => ({ TEMPO_PADRAO: { twitter: "2h", instagram: "Há 2 horas", story: "2 h" }, carregarImagemProfile: vi.fn(async () => ({ naturalWidth: 400, naturalHeight: 500 })), desenharProfile: vi.fn(() => ({ imagem: null })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrl: vi.fn(async (c: string) => ({ data: { signedUrl: `https://arquivos.exemplo.com/${c}` }, error: null })), upload: vi.fn() }) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// O botão de custo da casa é testado à parte: aqui só conferimos o que o Template entrega a ele.
vi.mock("@/components/mesa/Custo", () => ({
  AvisoDeErro: () => null,
  BotaoComCusto: (p: { titulo: string; sempreConfirmar?: boolean; partes: () => unknown; executar: () => Promise<unknown>; disabled?: boolean }) => {
    estado.botoes.push({ titulo: p.titulo, sempreConfirmar: p.sempreConfirmar, partes: p.partes() });
    return <button type="button" disabled={p.disabled} onClick={() => void p.executar()}>{p.titulo}</button>;
  },
}));
import TemplateProfileEditor from "@/components/mesa/profile/TemplateProfileEditor";
import { fontesDoProfile } from "@/components/mesa/profile/fontesDoProfile";

const trabalho: Trabalho = {
  id: "trabalho-a", task_id: null, status: "dirigido", modelo_imagem_id: "gerador-x", qualidade: "alta", cards: [], legenda: "Legenda já escrita do post", file_ids: [], custo_usd: 0, conversa_id: null, atualizado_em: "2026-10-21",
  direcao: { cards: [{ ordem: 1, texto_exato: "Pão às 7h", composicao: "pão na bancada" }, { ordem: 2, texto_exato: "Fermentação" }] },
};
function montar(t: Trabalho = trabalho, largura = 800) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: largura });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { trabalho: t, card: t.direcao.cards![0], bloqueado: false, onMudou: vi.fn(), onAbrirFotos: vi.fn(), onEscolherLamina: vi.fn() };
  const tela = render(<QueryClientProvider client={cache}><TemplateProfileEditor {...props} /></QueryClientProvider>);
  return { ...tela, props, refazer: (novo: Trabalho) => tela.rerender(<QueryClientProvider client={cache}><TemplateProfileEditor {...props} trabalho={novo} card={novo.direcao.cards![0]} /></QueryClientProvider>) };
}
const etapa = (nome: string) => fireEvent.click(screen.getByRole("button", { name: nome }));
beforeEach(() => {
  sessionStorage.clear(); estado.chamar.mockReset(); estado.botoes = [];
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cG5n");
});

describe("Template: gerar o conteúdo com custo antes", () => {
  it("o fio do X pede um post por lâmina pelo redator do Estúdio, com confirmação e estimativa", async () => {
    estado.chamar.mockResolvedValue({ trabalho, posts: [{ ordem: 1, texto: "Pão quentinho às 7h." }, { ordem: 2, texto: "Fermentação natural." }], legenda: "Legenda nova", avisos: ["O post da lâmina 2 passou de 280 caracteres do X."], custo_usd: 0.02 });
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Gerar conteúdo com IA" }));
    fireEvent.change(screen.getByLabelText("Tema do conteúdo"), { target: { value: "pão de fermentação" } });
    const botao = estado.botoes.find((b) => b.titulo === "Gerar conteúdo do template")!;
    expect(botao.sempreConfirmar).toBe(true);
    expect(botao.partes).toEqual([{ modeloId: "diretor-padrao", tipo: "texto", tokensEntrada: 9000, tokensSaida: 3000 }]);
    fireEvent.click(screen.getByRole("button", { name: "Gerar conteúdo do template" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1]).toEqual({ acao: "template_conteudo", trabalho_id: "trabalho-a", ordem: 1, rede: "twitter", tema: "pão de fermentação", todas: true, gravar_legenda: false, confirmado: true });
    await waitFor(() => expect(screen.getByLabelText("Texto do template")).toHaveValue("Pão quentinho às 7h."));
    expect(screen.getByText("O post da lâmina 2 passou de 280 caracteres do X.")).toBeInTheDocument();
  });
  it("avisa o limite real do X no campo, acima de 280", () => {
    montar();
    fireEvent.change(screen.getByLabelText("Texto do template"), { target: { value: "a".repeat(281) } });
    expect(screen.getByText("Passou 1 do limite de 280 do X")).toBeInTheDocument();
  });
  it("no Instagram o texto vira a legenda do post (sem mexer na lâmina) e o post exige foto", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
    expect(screen.getByLabelText("Texto do template")).toHaveValue("Legenda já escrita do post");
    expect(screen.getByText("O post do Instagram precisa de uma foto: escolha na etapa Imagem.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar nova versão" })).toBeDisabled();
  });
});

describe("Template: imagem gerada, da internet ou do cliente", () => {
  it("gera a foto sem texto na proporção do post e já a escolhe para a lâmina", async () => {
    const caminho = "cliente-a/estudio/template/nova.png";
    estado.chamar.mockResolvedValue({ trabalho, imagem: { caminho }, custo_usd: 0.04 });
    const tela = montar();
    etapa("Imagem");
    const botao = estado.botoes.find((b) => b.titulo === "Gerar a foto do post")!;
    expect(botao.sempreConfirmar).toBe(true);
    expect(botao.partes).toEqual([{ modeloId: "gerador-x", tipo: "imagem", imagens: 1, qualidade: "alta", tokensEntrada: 1500, vezes: 1 }]);
    fireEvent.click(screen.getByRole("button", { name: "Gerar a foto do post" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1]).toMatchObject({ acao: "template_imagem", ordem: 1, rede: "twitter", proporcao: "16:9", descricao: "pão na bancada", confirmado: true });
    const comFoto: Trabalho = { ...trabalho, direcao: { cards: [{ ...trabalho.direcao.cards![0], imagens_do_template: [{ caminho, descricao: "pão na bancada" }] } as never, trabalho.direcao.cards![1]] } };
    tela.refazer(comFoto);
    await waitFor(() => expect(screen.getByLabelText("Imagem real do template")).toHaveValue(caminho));
    expect(document.querySelector('[data-origem-da-imagem="gerada"]')).toHaveTextContent("Gerada no Estúdio");
  });
  it("gera para as lâminas que ainda não têm imagem, uma foto por lâmina", async () => {
    estado.chamar.mockResolvedValue({ trabalho, imagem: { caminho: "cliente-a/estudio/template/x.png" }, custo_usd: 0.04 });
    montar();
    etapa("Imagem");
    const lote = estado.botoes.find((b) => b.titulo === "Gerar as fotos das lâminas")!;
    expect(lote.partes).toEqual([expect.objectContaining({ vezes: 1 })]);
    fireEvent.click(screen.getByRole("button", { name: "Gerar as fotos das lâminas" }));
    await waitFor(() => expect(estado.chamar).toHaveBeenCalledOnce());
    expect(estado.chamar.mock.calls[0][1]).toMatchObject({ acao: "template_imagem", ordem: 2 });
  });
  it("a busca da internet tem Wikimedia e Openverse, com a fonte à vista", () => {
    montar();
    etapa("Imagem");
    fireEvent.click(screen.getByRole("button", { name: "Internet" }));
    expect(screen.getByRole("group", { name: "Banco de imagens" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Openverse" }));
    expect(screen.getByRole("button", { name: "Buscar no Openverse" })).toBeInTheDocument();
  });
  it("separa as fontes por origem: gerada, internet (com banco) e cliente", () => {
    const fontes = fontesDoProfile({ ordem: 1, fotos_livres: [{ caminho: "a/loja.png", papel: "fundo" }], fontes_reais: [{ caminho: "a/w.png", nome: "Pão", fonte_url: "https://commons.wikimedia.org/wiki/File:P%C3%A3o.jpg", licenca: "CC BY-SA 4.0", autor: "Autora", tipo: "imagem" }], imagens_do_template: [{ caminho: "a/g1.png", descricao: "primeira" }, { caminho: "a/g2.png", descricao: "segunda" }] }, [], "a");
    expect(fontes.map((f) => [f.caminho, f.grupo])).toEqual([["a/loja.png", "cliente"], ["a/w.png", "internet"], ["a/g2.png", "gerada"], ["a/g1.png", "gerada"]]);
    expect(fontes[1].origem).toBe("Imagem real · Wikimedia");
  });
});

describe("Template: organização da tela", () => {
  it("tem as quatro etapas no padrão e a Aparência com os ajustes antigos e os da rede", () => {
    montar();
    expect(screen.getByRole("navigation", { name: "Etapas do template" })).toBeInTheDocument();
    for (const nome of ["Conteúdo", "Imagem", "Aparência", "Prévia e guardar"]) expect(screen.getByRole("button", { name: nome })).toBeInTheDocument();
    etapa("Aparência");
    for (const rotulo of ["Tamanho do texto", "Tamanho do perfil", "Respiro em volta", "Cantos do post", "Cor de fundo do template", "Respostas", "Reposts", "Curtidas", "Visualizações"]) expect(screen.getByLabelText(rotulo)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tema do post" })).toHaveTextContent("Dim");
  });
  it("no computador o painel abre a janela grande com a prévia ao lado", async () => {
    montar(trabalho, 1440);
    // Com a janela aberta, o painel por trás fica fora da árvore acessível (Radix): por isso o hidden.
    expect(screen.getByRole("button", { name: "Abrir o Template", hidden: true })).toBeInTheDocument();
    const janela = await screen.findByRole("dialog");
    expect(within(janela).getByRole("navigation", { name: "Etapas do template" })).toBeInTheDocument();
    expect(within(janela).getByLabelText("Prévia do template Profile")).toBeInTheDocument();
  });
  it("as setas da prévia trocam de lâmina", () => {
    const { props } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Próxima lâmina" }));
    expect(props.onEscolherLamina).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "Lâmina anterior" })).toBeDisabled();
  });
});
