import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/components/mesa/ImagensReaisDoDiretor", () => ({ default: () => <p>Busca de imagens reais</p> }));
// A biblioteca do Workspace (a mesma das Mesas) devolve um arquivo do cliente.
vi.mock("@/components/laboratorio/no/EscolherDocumentos", () => ({
  default: (p: { titulo: string; onEscolher: (l: Array<{ id: string; nome: string; url: string; tipo: string; path: string }>) => void }) => (
    <div role="dialog" aria-label={p.titulo}>
      <button type="button" onClick={() => p.onEscolher([{ id: "n1", nome: "arquivo", url: "", tipo: p.titulo.indexOf("Vídeo") === 0 ? "video/mp4" : "image/jpeg", path: p.titulo.indexOf("Vídeo") === 0 ? "client/cliente-a/reels.mp4" : "client/cliente-a/foto.jpg" }])}>Usar o arquivo</button>
    </div>
  ),
}));
import TemplateProfileEditor from "@/components/mesa/profile/TemplateProfileEditor";
import { desenharProfile } from "@/components/mesa/profile/renderProfile";

const trabalho: Trabalho = {
  id: "trabalho-a", task_id: null, status: "dirigido", modelo_imagem_id: "gerador-x", qualidade: "alta", cards: [], legenda: null, file_ids: [], custo_usd: 0, conversa_id: null, atualizado_em: "2026-10-22",
  direcao: { conceito: "Meta desistiu de medir IA", cards: [{ ordem: 1, texto_exato: "A Meta **desistiu** disso →" }, { ordem: 2, texto_exato: "O motivo fala de gestão." }] } as Trabalho["direcao"],
};
function montar(t: Trabalho = trabalho) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { trabalho: t, card: t.direcao.cards![0], bloqueado: false, onMudou: vi.fn(), onAbrirFotos: vi.fn() };
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
    fireEvent.click(screen.getByLabelText("Aumentar tamanho do texto"));
    fireEvent.click(screen.getByRole("button", { name: "Escuro" }));
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
