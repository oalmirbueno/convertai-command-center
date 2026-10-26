import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import type { TemplateProfile } from "../../supabase/functions/estudio-arte/modulos/template-profile";

/**
 * Carrossel estilo post do X na tela do Template (22/10/2026): gerar com funções falsas, trocar o tipo
 * de mídia, ajustes refletindo na prévia, escolher do Workspace e enviar do computador trocando a mídia
 * do bloco, a lâmina de vídeo marcada e o MP4 pedido depois de guardar. Sem contador 1/N.
 */
const estado = vi.hoisted(() => ({ chamar: vi.fn(), botoes: [] as Array<{ titulo: string; partes: unknown }>, subirFoto: vi.fn(), subirVideos: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "cliente-a", carteira: "cliente", catalogo: [], atualizarCusto: vi.fn() }), useMarcaDaMesa: () => ({ marca: null }), useUrlDaMesa: (caminho?: string) => ({ data: caminho ? `https://arquivos.exemplo.com/${caminho}` : undefined, isError: false }) }));
vi.mock("@/components/mesa/instagram/instagramApi", () => ({ chamarInstagram: vi.fn(async () => ({ perfil: { nome: "Padaria", username: "padaria", foto_url: null }, contas: [], conta_id: null })), normalizarPainel: (v: unknown) => v }));
vi.mock("@/components/mesa/SeletorDoAcervo", () => ({ useAcervo: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("@/lib/mesa/api", () => {
  class ErroDaMesa extends Error { codigo = ""; detalhes: Record<string, unknown> = {}; }
  return { ErroDaMesa, chamarFuncao: (...args: unknown[]) => estado.chamar(...args), textoDoErro: (e: Error) => e.message, padraoPara: () => ({ id: "diretor-padrao" }), usd: (v: number) => `US$ ${v}` };
});
vi.mock("@/components/mesa/profile/renderProfile", () => ({
  TEMPO_PADRAO: { twitter: "2h", instagram: "Há 2 horas", story: "2 h", carrossel: "2h" },
  carregarImagemProfile: vi.fn(async () => ({ naturalWidth: 400, naturalHeight: 500 })),
  desenharProfile: vi.fn((_c: unknown, t: TemplateProfile) => ({ imagem: null, carrossel: t.estilo === "carrossel" ? { bloco: t.bloco?.midia ? { x: 80, y: 600, largura: 920, altura: 520, raio: 18 } : null, area: null, fundoDoBloco: "#f2f4f5" } : undefined })),
}));
vi.mock("@/components/mesa/profile/blocoDaLamina", async (original) => ({ ...(await original<object>()), carregarMidiaDoBloco: vi.fn(async () => ({ fonte: {}, largura: 1920, altura: 1080 })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrl: vi.fn(async (c: string) => ({ data: { signedUrl: `https://arquivos.exemplo.com/${c}` }, error: null })), upload: vi.fn() }) } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/mesa/Custo", () => ({
  AvisoDeErro: () => null,
  BotaoComCusto: (p: { titulo: string; partes: () => unknown; executar: () => Promise<unknown>; disabled?: boolean }) => {
    estado.botoes.push({ titulo: p.titulo, partes: p.partes() });
    return <button type="button" disabled={p.disabled} onClick={() => void p.executar()}>{p.titulo}</button>;
  },
}));
vi.mock("@/components/mesa/EstudioFotos", () => ({ subirFoto: (...a: unknown[]) => estado.subirFoto(...a) }));
vi.mock("@/components/mesa-videos/videosApi", () => ({ subirVideos: (...a: unknown[]) => estado.subirVideos(...a), useArquivosDeVideo: () => ({ data: { arquivos: [] } }), chamarMesaVideos: vi.fn() }));
vi.mock("@/components/mesa/hypeETrending", () => ({ buscarTrending: vi.fn(async () => ({ itens: [] })) }));
// A busca de imagens reais devolve uma foto de matéria (23/10): veículo no crédito e crédito escrito na lâmina.
vi.mock("@/components/mesa/ImagensReaisDoDiretor", () => ({
  default: (p: { consultaInicial?: string; onAplicada?: (f: Record<string, unknown>) => void }) => (
    <button type="button" data-consulta={p.consultaInicial || ""} onClick={() => p.onAplicada?.({ nome: "Carro bate recorde", caminho: "cliente-a/estudio/fontes-reais/n.jpg", fonte_url: "https://forbes.com.br/x", licenca: "Imagem da matéria (direitos do veículo)", autor: "Forbes Brasil", banco: "noticias" })}>Usar a foto da matéria</button>
  ),
}));
// A biblioteca do Workspace (a mesma das Mesas) devolve um arquivo do cliente.
vi.mock("@/components/laboratorio/no/EscolherDocumentos", () => ({
  default: (p: { titulo: string; onEscolher: (l: Array<{ id: string; nome: string; url: string; tipo: string; path: string }>) => void }) => (
    <div role="dialog" aria-label={p.titulo}>
      <button type="button" onClick={() => p.onEscolher([{ id: "n1", nome: "arquivo", url: "", tipo: p.titulo.indexOf("Vídeo") === 0 ? "video/mp4" : "image/jpeg", path: p.titulo.indexOf("Vídeo") === 0 ? "client/cliente-a/reels.mp4" : "client/cliente-a/foto.jpg" }])}>Usar o arquivo</button>
    </div>
  ),
}));
import TemplateProfileEditor, { modeloDoTrabalho } from "@/components/mesa/profile/TemplateProfileEditor";
import { desenharProfile } from "@/components/mesa/profile/renderProfile";
import { chaveDoRascunho, gravarRascunho } from "@/components/mesa/profile/rascunhoDoTemplate";

const trabalho: Trabalho = {
  id: "trabalho-a", task_id: null, status: "dirigido", modelo_imagem_id: "gerador-x", qualidade: "alta", cards: [], legenda: null, file_ids: [], custo_usd: 0, conversa_id: null, atualizado_em: "2026-10-22",
  direcao: { conceito: "Meta desistiu de medir IA", cards: [{ ordem: 1, texto_exato: "A Meta **desistiu** disso →" }, { ordem: 2, texto_exato: "O motivo fala de gestão." }] } as Trabalho["direcao"],
};
function montar(t: Trabalho = trabalho, indice = 0) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { trabalho: t, card: t.direcao.cards![indice], bloqueado: false, onMudou: vi.fn(), onAbrirFotos: vi.fn() };
  return render(<QueryClientProvider client={cache}><TemplateProfileEditor {...props} /></QueryClientProvider>);
}
const desenho = vi.mocked(desenharProfile);
const ultimoTemplate = () => desenho.mock.calls[desenho.mock.calls.length - 1][1] as TemplateProfile;
const chamadas = (acao: string) => estado.chamar.mock.calls.filter((c) => (c[1] as { acao: string }).acao === acao).map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  sessionStorage.clear(); estado.chamar.mockReset(); estado.botoes = []; desenho.mockClear(); estado.subirFoto.mockReset(); estado.subirVideos.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cG5n");
});

async function abrirCarrossel() {
  montar();
  fireEvent.click(screen.getByRole("button", { name: "Carrossel X" }));
  await waitFor(() => expect(ultimoTemplate().estilo).toBe("carrossel"));
}

describe("Carrossel X: modelo novo ao lado do post do X", () => {
  it("troca o modelo e desenha a lâmina inteira, sem contador 1/N no painel", async () => {
    await abrirCarrossel();
    expect(document.querySelector("[data-modelo-carrossel]")).toBeInTheDocument();
    expect(ultimoTemplate()).toMatchObject({ estilo: "carrossel", texto: "A Meta **desistiu** disso →", seta: true, bloco: { tipo: "nenhum" } });
    expect(screen.queryByText(/contador/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/contador/i)).not.toBeInTheDocument();
  });

  it("trocar o tipo de mídia e os ajustes refletem na prévia", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Gráfico" }));
    await waitFor(() => expect(ultimoTemplate().bloco?.tipo).toBe("grafico"));
    fireEvent.change(screen.getByLabelText("Valor 1"), { target: { value: "45" } });
    await waitFor(() => expect(ultimoTemplate().bloco?.grafico?.dados[0].valor).toBe(45));
    fireEvent.click(screen.getByRole("button", { name: "Acima do texto" }));
    fireEvent.click(screen.getByLabelText("Sangrar até a borda"));
    fireEvent.click(screen.getByLabelText("Aumentar altura do bloco"));
    await waitFor(() => expect(ultimoTemplate().bloco).toMatchObject({ posicao: "acima", sangrar: true }));
    fireEvent.click(screen.getByRole("button", { name: "Manchete" }));
    fireEvent.change(screen.getByLabelText("Veículo da manchete"), { target: { value: "g1" } });
    fireEvent.change(screen.getByLabelText("Título da manchete"), { target: { value: "Carros elétricos crescem" } });
    await waitFor(() => expect(ultimoTemplate().bloco).toMatchObject({ tipo: "manchete", manchete: { veiculo: "g1", titulo: "Carros elétricos crescem" } }));
    // Texto e Fundo ficam nas partes da lâmina (23/10).
    fireEvent.click(screen.getByRole("button", { name: "Texto" }));
    fireEvent.click(screen.getByLabelText("Aumentar tamanho do texto"));
    fireEvent.click(screen.getByRole("button", { name: "Fundo" }));
    fireEvent.click(screen.getByRole("button", { name: "Fundo Preto" }));
    await waitFor(() => expect(ultimoTemplate()).toMatchObject({ tema: "escuro", cor_fundo: "#000000", tamanho_texto: 36 }));
  });

  it("escolher do Workspace e enviar do computador trocam a mídia do bloco", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Imagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Escolher do Workspace" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Imagem do Workspace" })).getByRole("button", { name: "Usar o arquivo" }));
    await waitFor(() => expect(ultimoTemplate().bloco?.midia).toEqual({ bucket: "workspace", caminho: "client/cliente-a/foto.jpg", origem: "workspace" }));
    estado.subirFoto.mockResolvedValue("cliente-a/estudio/fotos/nova.png");
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    fireEvent.change(screen.getByLabelText("Arquivo de imagem do bloco"), { target: { files: [new File(["x"], "foto.png", { type: "image/png" })] } });
    await waitFor(() => expect(ultimoTemplate().bloco?.midia).toEqual({ bucket: "mesa", caminho: "cliente-a/estudio/fotos/nova.png", origem: "enviada" }));
    // Vídeo enviado: o envio da Mesa Vídeos, e a lâmina vira lâmina de vídeo.
    estado.subirVideos.mockResolvedValue({ registrados: [{ storage_path: "cliente-a/video/brutos/v.mp4", duracao_s: 7 }], recusados: [], aviso: null });
    fireEvent.click(screen.getByRole("button", { name: "Vídeo" }));
    fireEvent.change(screen.getByLabelText("Arquivo de vídeo do bloco"), { target: { files: [new File(["x"], "v.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(ultimoTemplate().bloco).toMatchObject({ tipo: "video", midia: { bucket: "mesa", caminho: "cliente-a/video/brutos/v.mp4", origem: "enviada", duracao_s: 7 } }));
  });

  it("lâmina de vídeo do Workspace fica marcada, toca no bloco e pede o MP4 depois de guardar", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Vídeo" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Escolher do Workspace" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Vídeo do Workspace" })).getByRole("button", { name: "Usar o arquivo" }));
    await waitFor(() => expect(document.querySelector("[data-lamina-de-video]")).toBeInTheDocument());
    expect(document.querySelector("[data-video-do-bloco]")).toHaveAttribute("src", "https://arquivos.exemplo.com/client/cliente-a/reels.mp4");
    expect(screen.getByText(/lâmina de vídeo/)).toBeInTheDocument();
    estado.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => {
      if (corpo.acao === "salvar_template") return { trabalho, versao: 1 };
      if (corpo.acao === "template_video_pedir") return { pedido: { estado: "fila" } };
      return {};
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar nova versão" }));
    await waitFor(() => expect(chamadas("template_video_pedir")).toHaveLength(1));
    expect(chamadas("salvar_template")[0].template).toMatchObject({ estilo: "carrossel", bloco: { tipo: "video", midia: { bucket: "workspace" } } });
    expect(chamadas("template_video_pedir")[0]).toMatchObject({ ordem: 1, versao: 1, retangulo: { x: 80, y: 600, largura: 920, altura: 520, raio: 18 }, cor_do_bloco: "#f2f4f5" });
    await waitFor(() => expect(document.querySelector("[data-mp4-da-lamina='fila']")).toBeInTheDocument());
  });

  it("gera o carrossel com funções falsas: copy, mídia do Jev, vídeo real e foto real, com o custo antes", async () => {
    await abrirCarrossel();
    const gerado = {
      ...trabalho,
      direcao: { cards: [
        { ordem: 1, texto_exato: "A Meta **desistiu** →", carrossel: { midia: "video_real", busca: "escritório", confianca: 0.8, por: "jev" } },
        { ordem: 2, texto_exato: "Comenta **IA**.", carrossel: { midia: "foto_real", busca: "reunião de equipe", confianca: 0.7, por: "jev" } },
      ] },
    };
    estado.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => {
      if (corpo.acao === "template_carrossel") return { trabalho: gerado, laminas: gerado.direcao.cards.map((c) => ({ ordem: c.ordem, texto: c.texto_exato, sugestao: c.carrossel })), avisos: [], custo_usd: 0.03 };
      if (corpo.acao === "template_videos_buscar") return { resultados: [{ banco: "pexels", id: "123" }] };
      if (corpo.acao === "template_video_aplicar") return { trabalho: gerado };
      if (corpo.acao === "imagens_reais_buscar") return { resultados: [{ arquivo: "File:Reuniao.jpg" }] };
      if (corpo.acao === "imagem_real_aplicar") return { trabalho: gerado };
      return {};
    });
    fireEvent.change(screen.getByLabelText("Assunto do carrossel"), { target: { value: "A Meta desistiu de medir IA por funcionário" } });
    const botao = estado.botoes.filter((b) => b.titulo === "Gerar o carrossel inteiro").pop()!;
    // Custo antes: o texto e, no teto, uma imagem por IA por lâmina sem real boa.
    expect(botao.partes).toEqual([
      { modeloId: "diretor-padrao", tipo: "texto", tokensEntrada: 9000, tokensSaida: 3000 },
      { modeloId: "gerador-x", tipo: "imagem", imagens: 1, qualidade: "alta", tokensEntrada: 1500, vezes: 2 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Gerar o carrossel inteiro" }));
    await waitFor(() => expect(chamadas("imagem_real_aplicar")).toHaveLength(1));
    expect(chamadas("template_carrossel")[0]).toMatchObject({ trabalho_id: "trabalho-a", assunto: "A Meta desistiu de medir IA por funcionário", confirmado: true });
    expect(chamadas("template_videos_buscar")[0]).toMatchObject({ ordem: 1, consulta: "escritório" });
    expect(chamadas("template_video_aplicar")[0]).toMatchObject({ ordem: 1, banco: "pexels", id: "123" });
    expect(chamadas("imagens_reais_buscar")[0]).toMatchObject({ ordem: 2, consulta: "reunião de equipe", tipo: "imagem" });
    expect(chamadas("imagem_real_aplicar")[0]).toMatchObject({ ordem: 2, arquivo: "File:Reuniao.jpg", texto_base: "Comenta **IA**." });
    // Achou mídia real: nada de imagem por IA.
    expect(chamadas("template_imagem")).toHaveLength(0);
    await waitFor(() => expect(ultimoTemplate().bloco?.tipo).toBe("video"));
  });
});

describe("Carrossel X: fundo, busca de notícias e ajustes por parte (23/10)", () => {
  it("a lâmina abre em Mídia, Fundo e Texto; o fundo pronto ou livre muda a cor e o tema acompanha o contraste", async () => {
    await abrirCarrossel();
    expect(screen.getByText("Lâmina 1 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mídia" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Fundo" }));
    fireEvent.click(screen.getByRole("button", { name: "Fundo Dim do X" }));
    await waitFor(() => expect(ultimoTemplate()).toMatchObject({ cor_fundo: "#15202b", tema: "dim" }));
    fireEvent.change(screen.getByLabelText("Cor de fundo da lâmina"), { target: { value: "#7a1f3d" } });
    await waitFor(() => expect(ultimoTemplate()).toMatchObject({ cor_fundo: "#7a1f3d", tema: "escuro" }));
    expect(document.querySelector("[data-contraste-do-texto]")).toHaveTextContent("Texto claro");
    fireEvent.click(screen.getByRole("button", { name: "Fundo Papel" }));
    await waitFor(() => expect(ultimoTemplate()).toMatchObject({ cor_fundo: "#f5f1e8", tema: "claro" }));
    // Tamanho pronto do bloco e cantos em pílulas, com o ajuste fino recolhido.
    fireEvent.click(screen.getByRole("button", { name: "Mídia" }));
    fireEvent.click(screen.getByRole("button", { name: "Imagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Médio" }));
    fireEvent.click(screen.getByRole("button", { name: "Redondos" }));
    await waitFor(() => expect(ultimoTemplate().bloco).toMatchObject({ altura: 75, cantos: 36 }));
  });
  it("foto de matéria entra no bloco com o veículo no crédito e o crédito escrito na lâmina", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Imagem" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar a foto da matéria" }));
    await waitFor(() => expect(ultimoTemplate().bloco).toMatchObject({
      tipo: "imagem", credito_visivel: true,
      midia: { bucket: "mesa", caminho: "cliente-a/estudio/fontes-reais/n.jpg", origem: "internet", credito: { fonte: "Notícia · Forbes Brasil", autor: null, url: "https://forbes.com.br/x" } },
    }));
    expect(document.querySelector("[data-credito-na-lamina]")).toHaveTextContent("Foto: Forbes Brasil");
    fireEvent.click(screen.getByLabelText("Crédito embaixo do bloco"));
    await waitFor(() => expect(ultimoTemplate().bloco?.credito_visivel).toBeUndefined());
  });
  it("o gerador pede as buscas com o Jev escolhendo a melhor mídia (Tudo, ordenado)", async () => {
    await abrirCarrossel();
    const gerado = { ...trabalho, direcao: { cards: [{ ordem: 1, texto_exato: "Capa", carrossel: { midia: "foto_real", busca: "carro elétrico", confianca: 0.8, por: "jev" } }, { ordem: 2, texto_exato: "Fim", carrossel: { midia: "so_texto", busca: "", confianca: 0.9, por: "jev" } }] } };
    estado.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => {
      if (corpo.acao === "template_carrossel") return { trabalho: gerado, laminas: gerado.direcao.cards.map((c) => ({ ordem: c.ordem, texto: c.texto_exato, sugestao: c.carrossel })), avisos: [], custo_usd: 0.03 };
      if (corpo.acao === "imagens_reais_buscar") return { resultados: [{ arquivo: "noticia:x|ONUT.a1b2" }], custo_usd: 0.001 };
      if (corpo.acao === "imagem_real_aplicar") return { trabalho: gerado };
      return {};
    });
    fireEvent.change(screen.getByLabelText("Assunto do carrossel"), { target: { value: "Carro elétrico bate recorde" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar o carrossel inteiro" }));
    await waitFor(() => expect(chamadas("imagem_real_aplicar")).toHaveLength(1));
    expect(chamadas("imagens_reais_buscar")[0]).toMatchObject({ ordem: 1, consulta: "carro elétrico", banco: "todos", ordenar: "jev" });
    expect(chamadas("imagem_real_aplicar")[0]).toMatchObject({ arquivo: "noticia:x|ONUT.a1b2" });
  });
});

describe("Carrossel X: texto com quebra e negrito, aplicar a todas, selo, perfil e IA (23/10)", () => {
  const rascunhoDa = (ordem: number) => JSON.parse(sessionStorage.getItem(chaveDoRascunho("cliente-a", null, "trabalho-a", ordem)) || "null") as Record<string, unknown> | null;
  it("o texto da lâmina aceita Enter e o B/Ctrl+B no trecho; salvar grava o texto da lâmina com as quebras", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Texto" }));
    const campo = screen.getByLabelText("Texto da lâmina no template") as HTMLTextAreaElement;
    expect(campo.value).toBe("A Meta **desistiu** disso →");
    fireEvent.change(campo, { target: { value: "A Meta desistiu disso\n\nE agora →" } });
    campo.setSelectionRange(2, 6);
    fireEvent.keyDown(campo, { key: "b", ctrlKey: true });
    await waitFor(() => expect(campo.value).toBe("A **Meta** desistiu disso\n\nE agora →"));
    expect(document.querySelector("[data-destaques-do-texto='1']")).toHaveTextContent("Meta");
    estado.chamar.mockResolvedValue({ trabalho });
    fireEvent.click(screen.getByRole("button", { name: "Salvar texto" }));
    await waitFor(() => expect(chamadas("configurar")).toHaveLength(1));
    expect(chamadas("configurar")[0]).toMatchObject({ trabalho_id: "trabalho-a", card: { ordem: 1, texto_exato: "A **Meta** desistiu disso\n\nE agora →" } });
  });
  it("Destacar as melhores palavras: custo antes e o Jev pelo servidor", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Texto" }));
    const { ErroDaMesa } = await import("@/lib/mesa/api");
    estado.chamar.mockImplementation(async (_f: string, corpo: { acao: string; confirmado?: boolean }) => {
      if (corpo.acao === "template_destaques" && !corpo.confirmado) throw Object.assign(new ErroDaMesa("custo", ""), { codigo: "confirmar_custo", detalhes: { custo_estimado_usd: 0.004 } });
      if (corpo.acao === "template_destaques") return { trabalho, laminas: [{ ordem: 1, destaques: ["desistiu"] }], custo_usd: 0.003 };
      return {};
    });
    fireEvent.click(screen.getByRole("button", { name: "Destacar as melhores palavras" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar US$ 0.004" }));
    await waitFor(() => expect(chamadas("template_destaques").filter((c) => c.confirmado)).toHaveLength(1));
    expect(chamadas("template_destaques")[1]).toMatchObject({ ordem: 1, todas: false, confirmado: true });
  });
  it("Aplicar a todas leva o fundo e o tamanho para o rascunho das outras lâminas; o selo vale para todas", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Fundo" }));
    fireEvent.click(screen.getByRole("button", { name: "Fundo Preto" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar o fundo a todas as lâminas" }));
    await waitFor(() => expect(rascunhoDa(2)).toMatchObject({ cor_fundo: "#000000", tema: "escuro", estilo: "carrossel" }));
    fireEvent.click(screen.getByRole("button", { name: "Texto" }));
    fireEvent.click(screen.getByLabelText("Aumentar tamanho do texto"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar o tamanho e o estilo do texto a todas as lâminas" }));
    await waitFor(() => expect(rascunhoDa(2)).toMatchObject({ tamanho_texto: 36, cor_fundo: "#000000" }));
    fireEvent.click(screen.getByLabelText("Exibir selo em todas as lâminas"));
    await waitFor(() => expect(rascunhoDa(2)).toMatchObject({ verificado: true }));
    expect(ultimoTemplate().verificado).toBe(true);
  });
  it("Montar todas usa a aparência do rascunho de cada lâmina", async () => {
    await abrirCarrossel();
    act(() => gravarRascunho(chaveDoRascunho("cliente-a", null, "trabalho-a", 2), { ...(rascunhoDa(2) || {}), estilo: "carrossel", cor_fundo: "#7a1f3d", tema: "escuro", tamanho_texto: 40, texto_base: "O motivo fala de gestão.", bloco: { tipo: "nenhum", posicao: "abaixo", altura: 100, largura: 100, sangrar: false, cantos: 18, borda: false, sombra: false, enquadramento: "inteira", foco_x: 0.5, foco_y: 0.5 } }));
    estado.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => (corpo.acao === "salvar_template" ? { trabalho, versao: 1 } : {}));
    fireEvent.click(screen.getByRole("button", { name: "Montar todas as lâminas" }));
    await waitFor(() => expect(chamadas("salvar_template")).toHaveLength(2));
    expect(chamadas("salvar_template")[0].template).toMatchObject({ cor_fundo: "#ffffff" });
    expect(chamadas("salvar_template")[1].template).toMatchObject({ cor_fundo: "#7a1f3d", tamanho_texto: 40, texto: "O motivo fala de gestão." });
  });
  it("último card: um clique põe o print do perfil com os dados de Redes, editável", async () => {
    montar(trabalho, 1);
    fireEvent.click(screen.getByRole("button", { name: "Carrossel X" }));
    await waitFor(() => expect(ultimoTemplate().estilo).toBe("carrossel"));
    expect(document.querySelector("[data-chamada-siga]")).toHaveTextContent("Pronto com os dados de Redes");
    fireEvent.click(screen.getByRole("button", { name: "Pôr o perfil com o Seguir" }));
    await waitFor(() => expect(ultimoTemplate().bloco).toMatchObject({ tipo: "perfil", perfil: { estilo: "instagram", nome: "Padaria", username: "padaria" } }));
    fireEvent.change(screen.getByLabelText("Bio no perfil"), { target: { value: "Pão quentinho às 7h" } });
    fireEvent.click(screen.getByRole("button", { name: "X" }));
    await waitFor(() => expect(ultimoTemplate().bloco?.perfil).toMatchObject({ estilo: "x", bio: "Pão quentinho às 7h" }));
  });
  it("a primeira lâmina não oferece a chamada Siga", async () => {
    await abrirCarrossel();
    expect(document.querySelector("[data-chamada-siga]")).toBeNull();
  });
  it("gráfico pela IA preenche com dado real; sem dado real, avisa e deixa o modelo", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Gráfico" }));
    const { ErroDaMesa } = await import("@/lib/mesa/api");
    estado.chamar.mockImplementationOnce(async () => ({ grafico: { tipo: "barras", titulo: "Pedidos", unidade: "%", fonte: "Folha", dados: [{ rotulo: "Negados", valor: 40 }, { rotulo: "Revistos", valor: 25 }] }, fonte: { nome: "Folha" }, custo_usd: 0.02 }));
    fireEvent.click(screen.getByRole("button", { name: "Gráfico pela IA" }));
    await waitFor(() => expect(ultimoTemplate().bloco?.grafico).toMatchObject({ fonte: "Folha", dados: [{ valor: 40 }, { valor: 25 }] }));
    expect(chamadas("template_bloco_ia")[0]).toMatchObject({ tipo: "grafico", ordem: 1, confirmado: true });
    expect(document.querySelector("[data-aviso-da-ia]")).toHaveTextContent("fonte: Folha");
    estado.chamar.mockImplementationOnce(async () => { throw Object.assign(new ErroDaMesa("Não achei números reais para este gráfico.", ""), { codigo: "sem_dado_real", detalhes: { custo_usd: 0.01 } }); });
    fireEvent.click(screen.getByRole("button", { name: "Gráfico pela IA" }));
    await waitFor(() => expect(document.querySelector("[data-aviso-da-ia]")).toHaveTextContent("Não achei números reais"));
    expect(ultimoTemplate().bloco?.grafico).toMatchObject({ fonte: "Folha" });
  });
  it("manchete pela IA e preencher a lâmina inteira com IA", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Manchete" }));
    estado.chamar.mockImplementationOnce(async () => ({ manchete: { veiculo: "Folha", titulo: "INSS nega 40%", url: "https://folha.uol.com.br/x", data: "22/10/2026" }, fonte: { veiculo: "Folha" }, custo_usd: 0.002 }));
    fireEvent.click(screen.getByRole("button", { name: "Manchete pela IA" }));
    await waitFor(() => expect(ultimoTemplate().bloco).toMatchObject({ tipo: "manchete", manchete: { veiculo: "Folha", titulo: "INSS nega 40%", data: "22/10/2026" } }));
    estado.chamar.mockImplementation(async (_f: string, corpo: { acao: string }) => (corpo.acao === "template_carrossel" ? { trabalho, laminas: [{ ordem: 1, texto: "Novo", sugestao: { midia: "so_texto", busca: "", confianca: 0.9, por: "jev" } }], avisos: [], custo_usd: 0.02 } : {}));
    fireEvent.click(screen.getByRole("button", { name: "Preencher a lâmina com IA" }));
    await waitFor(() => expect(chamadas("template_carrossel")).toHaveLength(1));
    expect(chamadas("template_carrossel")[0]).toMatchObject({ so_esta: true, gravar_legenda: false, ordem: 1 });
  });
});

describe("correções de 24/10: um modelo para o carrossel, texto ao vivo e cor do perfil", () => {
  const rascunhoDa = (ordem: number) => JSON.parse(sessionStorage.getItem(chaveDoRascunho("cliente-a", null, "trabalho-a", ordem)) || "null") as Record<string, unknown> | null;
  it("escolher o Carrossel X vale para todas as lâminas: a lâmina 2 abre no mesmo modelo, mesmo com rascunho antigo", async () => {
    // A lâmina 2 foi aberta antes, no Post do X (rascunho antigo).
    const antes = montar(trabalho, 1);
    await waitFor(() => expect(ultimoTemplate().estilo).toBe("twitter"));
    antes.unmount();
    const um = montar(trabalho, 0);
    fireEvent.click(screen.getByRole("button", { name: "Carrossel X" }));
    await waitFor(() => expect(ultimoTemplate().estilo).toBe("carrossel"));
    expect(rascunhoDa(2)).toMatchObject({ estilo: "carrossel" });
    um.unmount();
    montar(trabalho, 1);
    await waitFor(() => expect(ultimoTemplate()).toMatchObject({ estilo: "carrossel", texto: "O motivo fala de gestão." }));
    expect(screen.getByRole("button", { name: "Carrossel X" })).toHaveAttribute("aria-pressed", "true");
  });
  it("sem escolha na sessão, vale o modelo da versão mais nova entre todas as lâminas", async () => {
    const tp = (estilo: "twitter" | "carrossel") => ({ versao: 1, estilo, nome: "Padaria", username: "padaria", verificado: false, texto: "x", tamanho_texto: 34, cor_fundo: "#ffffff", tema: "claro", tamanho_foto: 88, espacamento: 48, arredondamento: 24 });
    const comVersoes = { ...trabalho, cards: [
      { ordem: 1, versao: 2, storage_path: "a.png", criado_em: "2026-10-23T10:00:00Z", template_profile: tp("carrossel") },
      { ordem: 2, versao: 1, storage_path: "b.png", criado_em: "2026-10-22T10:00:00Z", template_profile: tp("twitter") },
    ] } as unknown as Trabalho;
    expect(modeloDoTrabalho(comVersoes)).toBe("carrossel");
    montar(comVersoes, 1);
    await waitFor(() => expect(ultimoTemplate().estilo).toBe("carrossel"));
  });
  it("Post do X: o texto da lâmina muda a prévia a cada tecla, Enter incluído, sem guardar; Desfazer volta", async () => {
    montar();
    await waitFor(() => expect(ultimoTemplate().estilo).toBe("twitter"));
    const campo = screen.getByLabelText("Texto da lâmina no template");
    fireEvent.change(campo, { target: { value: "A Meta **desistiu** disso\nNova linha" } });
    await waitFor(() => expect(ultimoTemplate().texto).toBe("A Meta **desistiu** disso\nNova linha"));
    expect(chamadas("configurar")).toHaveLength(0);
    expect(rascunhoDa(1)).toMatchObject({ texto_editado: "A Meta **desistiu** disso\nNova linha" });
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(ultimoTemplate().texto).toBe("A Meta **desistiu** disso →"));
    expect(rascunhoDa(1)?.texto_editado).toBeUndefined();
  });
  it("Carrossel X: sem o campo solto de Texto do Story; o texto da lâmina vale ao vivo e salvar limpa a edição", async () => {
    await abrirCarrossel();
    expect(screen.queryByLabelText("Texto do template")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Texto" }));
    fireEvent.change(screen.getByLabelText("Texto da lâmina no template"), { target: { value: "Primeira\n\nSegunda" } });
    await waitFor(() => expect(ultimoTemplate().texto).toBe("Primeira\n\nSegunda"));
    estado.chamar.mockResolvedValue({ trabalho: { ...trabalho, direcao: { ...trabalho.direcao, cards: [{ ordem: 1, texto_exato: "Primeira\n\nSegunda" }, trabalho.direcao.cards![1]] } } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar texto" }));
    await waitFor(() => expect(chamadas("configurar")[0]).toMatchObject({ card: { ordem: 1, texto_exato: "Primeira\n\nSegunda" } }));
    await waitFor(() => expect(rascunhoDa(1)?.texto_editado).toBeUndefined());
  });
  it("salvar junta negritos vizinhos e tira o ** que sobra", async () => {
    await abrirCarrossel();
    fireEvent.click(screen.getByRole("button", { name: "Texto" }));
    fireEvent.change(screen.getByLabelText("Texto da lâmina no template"), { target: { value: "**Separe** **atestados** e laudos **" } });
    estado.chamar.mockResolvedValue({ trabalho });
    fireEvent.click(screen.getByRole("button", { name: "Salvar texto" }));
    await waitFor(() => expect(chamadas("configurar")[0]).toMatchObject({ card: { texto_exato: "**Separe atestados** e laudos" } }));
  });
  it("o card do perfil ganha a cor do card e a do Seguir (com o padrão de volta)", async () => {
    montar(trabalho, 1);
    fireEvent.click(screen.getByRole("button", { name: "Carrossel X" }));
    await waitFor(() => expect(ultimoTemplate().estilo).toBe("carrossel"));
    fireEvent.click(screen.getByRole("button", { name: "Pôr o perfil com o Seguir" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cor do card #000000" }));
    await waitFor(() => expect(ultimoTemplate().bloco?.perfil).toMatchObject({ cor_fundo: "#000000" }));
    fireEvent.change(screen.getByLabelText("Cor do botão Seguir livre"), { target: { value: "#7A1F3D" } });
    await waitFor(() => expect(ultimoTemplate().bloco?.perfil).toMatchObject({ cor_botao: "#7a1f3d" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Cor do card" })).getByRole("button", { name: "Padrão" }));
    await waitFor(() => expect(ultimoTemplate().bloco?.perfil?.cor_fundo).toBeUndefined());
  });
});
