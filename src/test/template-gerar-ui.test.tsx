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
  const props = { trabalho: t, card: t.direcao.cards![0], bloqueado: false, onMudou: vi.fn(), onAbrirFotos: vi.fn() };
  const tela = render(<QueryClientProvider client={cache}><TemplateProfileEditor {...props} /></QueryClientProvider>);
  return { ...tela, props, refazer: (novo: Trabalho) => tela.rerender(<QueryClientProvider client={cache}><TemplateProfileEditor {...props} trabalho={novo} card={novo.direcao.cards![0]} /></QueryClientProvider>) };
}
// Rodada 3: a ferramenta Template é uma seção só (sem abas); tudo fica à vista.
const etapa = (_nome: string) => undefined;
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
    // O texto novo entra na lâmina pelo servidor; o post do centro desenha o texto da lâmina (não há outro campo).
    expect(screen.queryByLabelText("Texto do template")).not.toBeInTheDocument();
    expect(screen.getByText("O post da lâmina 2 passou de 280 caracteres do X.")).toBeInTheDocument();
  });
  it("avisa o limite real do X na faixa da lâmina, acima de 280", async () => {
    montar({ ...trabalho, direcao: { cards: [{ ordem: 1, texto_exato: "a".repeat(281) }] } });
    expect(await screen.findByText("Passou 1 do limite de 280 do X")).toBeInTheDocument();
  });
  it("é só o post do X: sem escolha de Instagram ou Story, e o template antigo abre com aviso", async () => {
    const tela = montar();
    expect(screen.queryByRole("button", { name: "Instagram" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Story" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("[data-faixa-do-template]")).toHaveTextContent("Post do X"));
    tela.unmount(); sessionStorage.clear();
    const antigo: Trabalho = { ...trabalho, cards: [{ ordem: 1, versao: 1, storage_path: "cliente-a/arte.png", template_profile: { versao: 1, estilo: "instagram", nome: "Padaria", username: "padaria", texto: "Legenda antiga", verificado: false, tema: "claro", cor_fundo: "#ffffff", tamanho_texto: 34, tamanho_foto: 88, espacamento: 48, arredondamento: 24 } }] };
    montar(antigo);
    expect(screen.getByText(/Template antigo \(Instagram\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Passar para post do X" }));
    expect(screen.queryByText(/Template antigo/)).not.toBeInTheDocument();
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
  it("a ferramenta Template é uma seção do painel do Estúdio, sem abas próprias, com os ajustes antigos e os novos", () => {
    montar();
    expect(screen.queryByRole("navigation", { name: "Etapas do template" })).not.toBeInTheDocument();
    for (const nome of ["Aparência do post", "Imagem do post", "Perfil e conteúdo"]) expect(screen.getByRole("region", { name: nome })).toBeInTheDocument();
    for (const rotulo of ["Tamanho do texto", "Tamanho do avatar", "Tamanho da mídia", "Escala do post", "Respiro em volta", "Cantos do post", "Cor de fundo do template", "Respostas", "Reposts", "Curtidas", "Visualizações"]) expect(screen.getByLabelText(rotulo)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tema do post" })).toHaveTextContent("Dim");
  });
  it("o texto do post é o texto da lâmina: um só, sem campo próprio no Template", async () => {
    const desenhar = (await import("@/components/mesa/profile/renderProfile")).desenharProfile as unknown as { mock: { calls: unknown[][] } };
    const tela = montar();
    expect(screen.queryByLabelText("Texto do template")).not.toBeInTheDocument();
    await waitFor(() => expect(desenhar.mock.calls[desenhar.mock.calls.length - 1][1]).toMatchObject({ texto: "Pão às 7h" }));
    const novo = { ...trabalho, direcao: { ...trabalho.direcao, cards: [{ ...trabalho.direcao.cards![0], texto_exato: "Texto vindo da lâmina" }, trabalho.direcao.cards![1]] } } as Trabalho;
    tela.refazer(novo);
    await waitFor(() => expect(desenhar.mock.calls[desenhar.mock.calls.length - 1][1]).toMatchObject({ texto: "Texto vindo da lâmina" }));
  });
  it("sem pop-up: o centro é o post e o painel são os ajustes, com o mesmo rascunho ao vivo", async () => {
    const desenhar = (await import("@/components/mesa/profile/renderProfile")).desenharProfile as unknown as { mock: { calls: unknown[][] } };
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { trabalho, card: trabalho.direcao.cards![0], bloqueado: false, onMudou: vi.fn(), onAbrirFotos: vi.fn() };
    render(<QueryClientProvider client={cache}><TemplateProfileEditor {...props} parte="centro" moldura={({ faixa, conteudo }) => <div data-lamina-grande-do-estudio="">{faixa}{conteudo(400)}</div>} /><TemplateProfileEditor {...props} parte="painel" /></QueryClientProvider>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Prévia do template Profile")).toBeInTheDocument();
    // O centro entra na moldura do Estúdio (a lâmina grande): nada de barra, setas ou zoom próprios.
    expect(document.querySelector("[data-lamina-grande-do-estudio] canvas")).not.toBeNull();
    for (const nome of ["Sair do Template", "Aumentar o post", "Próxima lâmina", "Ver prévia grande", "Baixar PNG"]) expect(screen.queryByRole("button", { name: nome })).not.toBeInTheDocument();
    etapa("Aparência");
    fireEvent.click(screen.getByRole("button", { name: "Aumentar tamanho do texto" }));
    fireEvent.click(screen.getByRole("button", { name: "Fundo #15202b" }));
    await waitFor(() => expect(desenhar.mock.calls[desenhar.mock.calls.length - 1][1]).toMatchObject({ tamanho_texto: 36, cor_fundo: "#15202b" }));
    fireEvent.click(screen.getByRole("button", { name: "Aumentar escala do post" }));
    fireEvent.click(screen.getByLabelText("Mostrar números"));
    fireEvent.click(screen.getByLabelText("Mostrar tempo"));
    await waitFor(() => expect(desenhar.mock.calls[desenhar.mock.calls.length - 1][1]).toMatchObject({ escala: 102, ocultar_numeros: true, ocultar_tempo: true }));
  });
  it("a troca entre a arte e o post do X fica dentro da ferramenta Template, sem botão novo no centro", () => {
    const trocar = vi.fn();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={cache}><TemplateProfileEditor trabalho={trabalho} card={trabalho.direcao.cards![0]} bloqueado={false} onMudou={vi.fn()} onAbrirFotos={vi.fn()} parte="painel" modoTemplate onModoTemplate={trocar} /></QueryClientProvider>);
    expect(screen.getByRole("button", { name: "Post do X" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Arte da lâmina" }));
    expect(trocar).toHaveBeenCalledWith(false);
  });
});
