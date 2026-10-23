import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, Film, FolderOpen, Image as IconeDeImagem, Loader2, Minus, Newspaper, PaintBucket, Plus, Search, Sparkles, Type, Upload, UserRound, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { chamarFuncao, ErroDaMesa, padraoPara, textoDoErro, usd } from "@/lib/mesa/api";
import EscolherDocumentos from "@/components/laboratorio/no/EscolherDocumentos";
import { useMesa } from "../MesaContexto";
import { BotaoComCusto } from "../Custo";
import ImagensReaisDoDiretor, { type FonteAplicada } from "../ImagensReaisDoDiretor";
import { subirFoto } from "../EstudioFotos";
import { chamarMesaVideos, subirVideos, useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import { buscarTrending, type Noticia } from "../hypeETrending";
import { gravarTrabalhoNoCache, type TrabalhoGravado } from "../estudioUtil";
import type { CardDaDirecao, Trabalho } from "../useItensDoMes";
import { Segmentado } from "./controlesDoTemplate";
import { partesDaFotoDoTemplate, partesDoTextoDoTemplate } from "./partesDoTemplate";
import { chaveDaFonteProfile, ROTULO_DO_GRUPO, type FonteProfile } from "./fontesDoProfile";
import { ehImagem, ehVideo, midiaDaFonte, midiaDaFonteAplicada, midiaDoVideoReal, ROTULO_DO_TIPO, type CardDoCarrossel } from "./blocoDaLamina";
import { FUNDOS_PRONTOS, fundoEscuro, textoDoCredito } from "./renderCarrossel";
import EditorDoTextoDaLamina from "./EditorDoTextoDaLamina";
import type { CampoDaAparencia } from "./TemplateProfileEditor";
import type { BlocoDaLamina, GraficoDoBloco, MancheteDoBloco, MidiaDoBloco, PerfilDoBloco, TemplateProfile } from "../../../../supabase/functions/estudio-arte/modulos/template-profile";
import type { SugestaoDoCarrossel, VideoGuardado, VideoReal } from "../../../../supabase/functions/estudio-arte/modulos/template-carrossel";

/**
 * Painel do carrossel estilo post do X (22/10/2026), no lugar da Aparência e da Imagem quando o modelo
 * é "Carrossel X". Em cima, o gerador do carrossel inteiro; embaixo, a lâmina aberta em três partes
 * (23/10, dono: "configurações e ajustes mais intuitivos"): Mídia (o bloco, de onde vem e o tamanho),
 * Fundo (a cor da lâmina; o texto ajusta o contraste sozinho) e Texto. A mídia entra INTEIRA no bloco;
 * o desenho é sempre o da prévia.
 */

type Ajustes = Pick<TemplateProfile, "tema" | "cor_fundo" | "tamanho_texto" | "peso_texto" | "seta" | "rodape_cinza">;
const TIPOS: Array<BlocoDaLamina["tipo"]> = ["imagem", "video", "grafico", "manchete", "perfil", "nenhum"];
const ICONE_DO_TIPO: Record<BlocoDaLamina["tipo"], ReactNode> = {
  imagem: <IconeDeImagem className="h-3.5 w-3.5" />, video: <Film className="h-3.5 w-3.5" />, grafico: <BarChart3 className="h-3.5 w-3.5" />,
  manchete: <Newspaper className="h-3.5 w-3.5" />, perfil: <UserRound className="h-3.5 w-3.5" />, nenhum: <Type className="h-3.5 w-3.5" />,
};
type Parte = "midia" | "fundo" | "texto";
/** O tema que acompanha o fundo: o "dim" do X fica dim; o resto, claro ou escuro pelo contraste. */
export const temaDoFundo = (cor: string): TemplateProfile["tema"] => (cor.toLowerCase() === "#15202b" ? "dim" : fundoEscuro(cor) ? "escuro" : "claro");
const BANCO_DO_VIDEO: Record<VideoReal["banco"], string> = { pexels: "Pexels", wikimedia: "Wikimedia", arquivo: "Internet Archive" };
/** Tamanhos prontos do bloco (altura em % do espaço livre). */
const TAMANHOS_DO_BLOCO = [{ valor: "50", rotulo: "Pequeno" }, { valor: "75", rotulo: "Médio" }, { valor: "100", rotulo: "Grande" }];
/** O perfil lido em Redes (painel do Instagram do cliente), para o "print" do perfil na última lâmina. */
export interface PerfilDeRedes { nome: string; username: string; bio?: string; site?: string; seguidores?: number | null; seguindo?: number | null; posts?: number | null }
/** O bloco do perfil montado com os dados reais de Redes (o texto continua editável no painel). */
export function perfilDoBlocoDeRedes(p: PerfilDeRedes, estilo: PerfilDoBloco["estilo"], verificado: boolean): PerfilDoBloco {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
  const bloco: PerfilDoBloco = { estilo, nome: p.nome.slice(0, 80), username: p.username.replace(/^@/, "").slice(0, 30) };
  if (p.bio && p.bio.trim()) bloco.bio = p.bio.replace(/[<>\t]/g, "").trim().slice(0, 300);
  if (p.site && p.site.trim()) bloco.site = p.site.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 80);
  if (n(p.posts) !== undefined) bloco.posts = n(p.posts);
  if (n(p.seguidores) !== undefined) bloco.seguidores = n(p.seguidores);
  if (n(p.seguindo) !== undefined) bloco.seguindo = n(p.seguindo);
  if (verificado) bloco.verificado = true;
  return bloco;
}
const CANTOS_DO_BLOCO = [{ valor: "0", rotulo: "Retos" }, { valor: "18", rotulo: "Suaves" }, { valor: "36", rotulo: "Redondos" }];
type Fonte = "internet" | "gerar" | "enviar" | "workspace";
const ROTULO_DA_FONTE: Record<Fonte, string> = { internet: "Internet", gerar: "Gerar com IA", enviar: "Enviar", workspace: "Workspace" };

function Regua({ rotulo, valor, min, max, passo = 2, sufixo = "", desativado, onMudar }: { rotulo: string; valor: number; min: number; max: number; passo?: number; sufixo?: string; desativado: boolean; onMudar: (v: number) => void }) {
  const ir = (d: number) => onMudar(Math.max(min, Math.min(max, valor + d)));
  return (
    <div className="min-w-0">
      <div className="flex items-center">
        <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>{rotulo} · {valor}{sufixo}</span>
        <button type="button" className={botao.icone} aria-label={`Diminuir ${rotulo.toLowerCase()}`} title={`Diminuir ${rotulo.toLowerCase()}`} disabled={desativado || valor <= min} onClick={() => ir(-passo)}><Minus className="h-3.5 w-3.5" aria-hidden="true" /></button>
        <button type="button" className={botao.icone} aria-label={`Aumentar ${rotulo.toLowerCase()}`} title={`Aumentar ${rotulo.toLowerCase()}`} disabled={desativado || valor >= max} onClick={() => ir(passo)}><Plus className="h-3.5 w-3.5" aria-hidden="true" /></button>
      </div>
      <input aria-label={rotulo} type="range" min={min} max={max} value={valor} disabled={desativado} onChange={(e) => onMudar(Number(e.target.value))} className="mt-1 w-full accent-primary" />
    </div>
  );
}

function Marca({ rotulo, marcado, desativado, onMudar }: { rotulo: string; marcado: boolean; desativado: boolean; onMudar: (v: boolean) => void }) {
  return <label className="mb-1 mr-4 inline-flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={marcado} disabled={desativado} onChange={(e) => onMudar(e.target.checked)} />{rotulo}</label>;
}

const secao = (titulo: string, corpo: ReactNode, ajuda?: ReactNode) => (
  <section className="min-w-0 space-y-3 border-t border-border pt-4" aria-label={titulo}>
    <div className="flex items-center"><p className={juntar(texto.corpo, "font-semibold")}>{titulo}</p>{ajuda}</div>
    {corpo}
  </section>
);

export default function PainelDoCarrossel({ trabalho, card, cards, fontes, bloco, ajustes, travado, onBloco, onAjuste, onMudou, onGerado, onAbrirFotos, modeloSeletor, coresDaMarca = [], onAplicarATodas, perfilDeRedes = null, verificado = false, editorDeTexto }: {
  trabalho: Trabalho;
  card: CardDaDirecao;
  cards: CardDaDirecao[];
  fontes: FonteProfile[];
  bloco: BlocoDaLamina;
  ajustes: Ajustes;
  travado: boolean;
  onBloco: (patch: Partial<BlocoDaLamina>) => void;
  onAjuste: <K extends keyof Ajustes>(k: K, v: Ajustes[K]) => void;
  onMudou: () => void;
  /** Depois do gerador: o trabalho novo (texto e sugestão de mídia em cada lâmina); `soEsta`: só a lâmina aberta. */
  onGerado: (t: TrabalhoGravado, soEsta?: boolean) => void;
  onAbrirFotos: () => void;
  modeloSeletor: ReactNode;
  /** Paleta da marca do cliente (23/10): vira fundo da lâmina com um toque. */
  coresDaMarca?: string[];
  /** 23/10: copia os campos da aparência desta lâmina para todas (só com mais de uma lâmina). */
  onAplicarATodas?: (campos: CampoDaAparencia[]) => void;
  /** 23/10: o perfil lido em Redes (null: sem dados, preenchimento à mão) e se o selo está ligado. */
  perfilDeRedes?: PerfilDeRedes | null;
  verificado?: boolean;
  /** 24/10: o editor do texto da lâmina ligado ao rascunho (a prévia muda a cada tecla). */
  editorDeTexto?: ReactNode;
}) {
  const mesa = useMesa(), cache = useQueryClient();
  const [fonte, setFonte] = useState<Fonte>("internet");
  const [parte, setParte] = useState<Parte>("midia");
  const [workspaceAberto, setWorkspaceAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const ehVideoNoBloco = bloco.tipo === "video";
  const cardC = card as CardDoCarrossel;
  const sugestao = cardC.carrossel as SugestaoDoCarrossel | undefined;

  const usarMidia = (midia: MidiaDoBloco, tipo: "imagem" | "video", extra: Partial<BlocoDaLamina> = {}) => { setErro(""); onBloco({ tipo, midia, ...extra }); };
  /** A imagem da busca entra com o crédito; foto de matéria já sai com o crédito escrito na lâmina. */
  const usarImagemDaBusca = (f: FonteAplicada) => {
    const m = midiaDaFonteAplicada(f);
    if (m) usarMidia(m.midia, "imagem", m.creditoNaLamina ? { credito_visivel: true } : {});
  };

  // ---------------------------------------------------------------- enviar do computador (o upload das Mesas)
  const enviar = async (arquivo: File) => {
    setErro("");
    const video = arquivo.type.indexOf("video/") === 0;
    if (!video && !["image/png", "image/jpeg", "image/webp"].includes(arquivo.type)) { setErro("Use PNG, JPG, WebP, MP4, MOV ou WebM."); return; }
    setEnviando(true);
    try {
      if (video) {
        // O mesmo envio da Mesa Vídeos: pasta de brutos do cliente e o registro no acervo de vídeos.
        const r = await subirVideos(mesa.clientId, [arquivo], () => undefined);
        const a = r.registrados[0];
        if (!a) throw new Error(r.recusados[0]?.motivo || r.aviso || "O vídeo não subiu.");
        usarMidia({ bucket: "mesa", caminho: a.storage_path, origem: "enviada", ...(a.duracao_s ? { duracao_s: a.duracao_s } : {}) }, "video");
      } else {
        // O mesmo envio das Fotos do Estúdio (bucket mesa, pasta do cliente).
        const ext = arquivo.type === "image/png" ? "png" : arquivo.type === "image/webp" ? "webp" : "jpg";
        const caminho = await subirFoto(mesa.clientId, arquivo, ext);
        usarMidia({ bucket: "mesa", caminho, origem: "enviada" }, "imagem");
      }
    } catch (e) { setErro(textoDoErro(e)); } finally { setEnviando(false); }
  };

  // ---------------------------------------------------------------- vídeos reais (Pexels e Wikimedia)
  const [consultaDoVideo, setConsultaDoVideo] = useState(sugestao?.busca || "");
  const [videos, setVideos] = useState<VideoReal[]>([]);
  const [melhorVideo, setMelhorVideo] = useState<number | null>(null);
  const [avisosDoVideo, setAvisosDoVideo] = useState<string[]>([]);
  const [buscandoVideo, setBuscandoVideo] = useState(false);
  const buscarVideos = async () => {
    setBuscandoVideo(true); setErro("");
    try {
      const r = await chamarFuncao<{ resultados: VideoReal[]; avisos?: string[]; melhor?: { indice: number } | null }>("estudio-arte", { acao: "template_videos_buscar", trabalho_id: trabalho.id, ordem: card.ordem, consulta: consultaDoVideo.trim() });
      setVideos(r.resultados); setAvisosDoVideo(r.avisos || []); setMelhorVideo(r.melhor ? r.melhor.indice : null);
    } catch (e) { setErro(textoDoErro(e)); } finally { setBuscandoVideo(false); }
  };
  const aplicarVideo = async (v: VideoReal) => {
    setBuscandoVideo(true); setErro("");
    try {
      const r = await chamarFuncao<{ trabalho: TrabalhoGravado; video: VideoGuardado }>("estudio-arte", { acao: "template_video_aplicar", trabalho_id: trabalho.id, ordem: card.ordem, banco: v.banco, id: v.id });
      gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
      usarMidia(midiaDoVideoReal(r.video), "video");
      onMudou();
    } catch (e) { setErro(textoDoErro(e)); } finally { setBuscandoVideo(false); }
  };

  // ---------------------------------------------------------------- vídeo por IA (Mesa Vídeos, custo antes)
  const [custoDoVideo, setCustoDoVideo] = useState<{ corpo: Record<string, unknown>; usd: number } | null>(null);
  const [descricaoDoVideo, setDescricaoDoVideo] = useState(() => (sugestao?.busca || card.texto_exato || "").replace(/\*\*/g, "").slice(0, 400));
  const corpoDoVideo = () => ({ acao: "gerar_video", tipo: "gerar_livre", client_id: mesa.clientId, motor: "seedance-2.0-mini", modo: "texto", prompt: `${descricaoDoVideo.trim()}. Vídeo realista, sem texto, sem letras e sem logos na imagem.`, duracao_s: 5, formato: "16:9", audio: false, variacoes: 1, titulo: `Carrossel · lâmina ${card.ordem}`.slice(0, 100) });
  const pedirCustoDoVideo = async () => {
    setErro("");
    try {
      await chamarMesaVideos(corpoDoVideo());
      setErro("O servidor não pediu a confirmação do custo.");
    } catch (e) {
      if (e instanceof ErroDaMesa && e.codigo === "confirmar_custo") {
        const c = (e.detalhes || {}).custo_estimado as { usd?: unknown } | undefined;
        setCustoDoVideo({ corpo: corpoDoVideo(), usd: Number(c && c.usd) || 0 });
      } else setErro(textoDoErro(e));
    }
  };
  const confirmarVideo = async () => {
    if (!custoDoVideo) return;
    try {
      await chamarMesaVideos({ ...custoDoVideo.corpo, custo_confirmado_usd: custoDoVideo.usd });
      toast.success("Vídeo pedido à Mesa Vídeos", { description: "Quando ficar pronto, ele aparece em Vídeos do cliente para usar no bloco." });
      setCustoDoVideo(null);
      mesa.atualizarCusto?.();
    } catch (e) { setErro(textoDoErro(e)); }
  };
  const videosDoCliente = useArquivosDeVideo(ehVideoNoBloco ? mesa.clientId : "");

  // ---------------------------------------------------------------- imagem gerada (gerador do Estúdio, custo antes)
  const [descricaoDaFoto, setDescricaoDaFoto] = useState(() => (sugestao?.busca || card.texto_exato || "").replace(/\*\*/g, "").slice(0, 600));
  const gerarFoto = async () => {
    const r = await chamarFuncao<{ trabalho: TrabalhoGravado; imagem: { caminho: string }; custo_usd: number }>("estudio-arte", {
      acao: "template_imagem", trabalho_id: trabalho.id, ordem: card.ordem, rede: "twitter", proporcao: "16:9", descricao: descricaoDaFoto.trim() || undefined, confirmado: true,
    });
    gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
    usarMidia({ bucket: "mesa", caminho: r.imagem.caminho, origem: "gerada" }, "imagem");
    onMudou();
    return r;
  };

  // ---------------------------------------------------------------- manchete (notícia real do Google Notícias)
  const [assuntoDaNoticia, setAssuntoDaNoticia] = useState("");
  const [noticias, setNoticias] = useState<Noticia[]>([]);
  const [buscandoNoticia, setBuscandoNoticia] = useState(false);
  const buscarNoticias = async () => {
    setBuscandoNoticia(true); setErro("");
    try { setNoticias((await buscarTrending(mesa.clientId, assuntoDaNoticia, "7d")).itens.slice(0, 8)); } catch (e) { setErro(textoDoErro(e)); } finally { setBuscandoNoticia(false); }
  };
  const manchete = bloco.manchete || { veiculo: "", titulo: "" };
  const mudarManchete = (patch: Partial<NonNullable<BlocoDaLamina["manchete"]>>) => onBloco({ manchete: { ...manchete, ...patch } });

  // ---------------------------------------------------------------- gráfico (números editáveis)
  const grafico: GraficoDoBloco = bloco.grafico || { tipo: "barras", dados: [{ rotulo: "A", valor: 10 }, { rotulo: "B", valor: 20 }] };
  const mudarGrafico = (patch: Partial<GraficoDoBloco>) => onBloco({ grafico: { ...grafico, ...patch } });

  // ---------------------------------------------------------------- gerador completo
  const [assunto, setAssunto] = useState(() => (trabalho.direcao as { conceito?: string }).conceito || "");
  const [noticiaDaBase, setNoticiaDaBase] = useState<Noticia | null>(null);
  const [permitirIA, setPermitirIA] = useState(true);
  const [andamento, setAndamento] = useState("");
  const [avisosDoGerador, setAvisosDoGerador] = useState<string[]>([]);
  const diretor = padraoPara(mesa.catalogo || [], "diretor_arte");
  const comFoto = permitirIA && !!trabalho.modelo_imagem_id;
  const gerarCarrossel = async (soEsta = false) => {
    const avisos: string[] = [];
    setAndamento(soEsta ? `Escrevendo a lâmina ${card.ordem} e escolhendo a mídia` : "Escrevendo as lâminas e escolhendo as mídias");
    try {
      const r = await chamarFuncao<{ trabalho: TrabalhoGravado; laminas: Array<{ ordem: number; texto: string; sugestao: SugestaoDoCarrossel }>; avisos?: string[]; custo_usd: number }>("estudio-arte", {
        acao: "template_carrossel", trabalho_id: trabalho.id, ordem: card.ordem, assunto: assunto.trim() || undefined, gravar_legenda: !soEsta && !trabalho.legenda, confirmado: true, ...(soEsta ? { so_esta: true } : {}),
        ...(noticiaDaBase ? { noticia: { titulo: noticiaDaBase.titulo, fonte: noticiaDaBase.fonte, link: noticiaDaBase.link, data: noticiaDaBase.data } } : {}),
      });
      avisos.push(...(r.avisos || []));
      let atual = r.trabalho;
      gravarTrabalhoNoCache(cache, mesa.clientId, atual);
      let custo = Number(r.custo_usd) || 0;
      // Mídia real primeiro; a imagem por IA só quando não achou real boa (e se a equipe deixou).
      for (const l of r.laminas) {
        const s = l.sugestao;
        if (!s.busca && (s.midia === "foto_real" || s.midia === "video_real")) continue;
        setAndamento(`Lâmina ${l.ordem}: ${s.midia === "video_real" ? "buscando o vídeo" : s.midia === "imagem_ia" ? "gerando a imagem" : s.midia === "foto_real" ? "buscando a foto" : "pronta"}`);
        try {
          let achou = false;
          if (s.midia === "video_real") {
            // O Jev põe primeiro o vídeo que mais combina com a lâmina (custo já no teto do gerador).
            const b = await chamarFuncao<{ resultados: VideoReal[]; custo_usd?: number }>("estudio-arte", { acao: "template_videos_buscar", trabalho_id: trabalho.id, ordem: l.ordem, consulta: s.busca, ordenar: "jev" });
            custo += Number(b.custo_usd) || 0;
            if (b.resultados[0]) {
              const a = await chamarFuncao<{ trabalho: TrabalhoGravado }>("estudio-arte", { acao: "template_video_aplicar", trabalho_id: trabalho.id, ordem: l.ordem, banco: b.resultados[0].banco, id: b.resultados[0].id });
              atual = a.trabalho; achou = true;
            }
          }
          if (s.midia === "foto_real" || (s.midia === "video_real" && !achou)) {
            // Notícias, Pexels, Wikimedia e Openverse juntos; o Jev escolhe a melhor para a lâmina.
            const b = await chamarFuncao<{ resultados: Array<{ arquivo: string }>; custo_usd?: number }>("estudio-arte", { acao: "imagens_reais_buscar", trabalho_id: trabalho.id, ordem: l.ordem, consulta: s.busca, tipo: "imagem", banco: "todos", ordenar: "jev" }).catch(() => ({ resultados: [] as Array<{ arquivo: string }>, custo_usd: 0 }));
            custo += Number(b.custo_usd) || 0;
            if (b.resultados[0]) {
              const lido = atual as unknown as Trabalho;
              const versao = Math.max(0, ...(lido.cards || []).filter((v) => v.ordem === l.ordem).map((v) => v.versao));
              const textoBase = lido.direcao?.cards?.find((c) => c.ordem === l.ordem)?.texto_exato || "";
              const a = await chamarFuncao<{ trabalho?: TrabalhoGravado }>("estudio-arte", { acao: "imagem_real_aplicar", trabalho_id: trabalho.id, ordem: l.ordem, texto_base: textoBase, versao_esperada: versao, tipo: "imagem", arquivo: b.resultados[0].arquivo });
              if (a.trabalho) atual = a.trabalho;
              achou = true;
            }
          }
          if (!achou && (s.midia === "imagem_ia" || s.midia === "foto_real" || s.midia === "video_real")) {
            if (comFoto) {
              const g = await chamarFuncao<{ trabalho: TrabalhoGravado; custo_usd: number }>("estudio-arte", { acao: "template_imagem", trabalho_id: trabalho.id, ordem: l.ordem, rede: "twitter", proporcao: "16:9", descricao: s.busca || l.texto.replace(/\*\*/g, "").slice(0, 300), confirmado: true });
              atual = g.trabalho; custo += Number(g.custo_usd) || 0;
            } else avisos.push(`Lâmina ${l.ordem}: nenhuma mídia real boa; escolha outra no bloco.`);
          }
          gravarTrabalhoNoCache(cache, mesa.clientId, atual);
        } catch (e) { avisos.push(`Lâmina ${l.ordem}: ${textoDoErro(e)}`); }
      }
      onGerado(atual, soEsta);
      setAvisosDoGerador(avisos);
      toast.success(soEsta ? `Lâmina ${card.ordem} preenchida` : `Carrossel gerado (${r.laminas.length} lâminas)`, { description: `Custo ${usd(custo)}. Confira ${soEsta ? "a lâmina" : "cada lâmina e use Montar todas as lâminas"}.` });
      return { custo_usd: custo };
    } finally { setAndamento(""); onMudou(); }
  };

  // ---------------------------------------------------------------- partes da tela
  const fontesDeImagem = fontes.filter((f) => f.bucket === "mesa" && ehImagem(f.caminho));
  const midiaAtual = bloco.midia;
  const credito = midiaAtual?.credito;
  const videosReaisDaLamina = cardC.videos_reais || [];

  const origens = (
    <div className="space-y-3">
      <Segmentado<Fonte> rotulo="De onde vem" opcoes={(Object.keys(ROTULO_DA_FONTE) as Fonte[]).map((v) => ({ valor: v, rotulo: ROTULO_DA_FONTE[v] }))} valor={fonte} onEscolher={setFonte} desativado={travado} />
      {fonte === "internet" && !ehVideoNoBloco && (
        <ImagensReaisDoDiretor embutido trabalho={trabalho} ordem={card.ordem} bloqueado={travado} onAtualizar={onMudou} consultaInicial={sugestao?.busca} onAplicada={usarImagemDaBusca} />
      )}
      {fonte === "internet" && ehVideoNoBloco && (
        <div className="space-y-2" data-busca-de-video="">
          <div className="flex min-w-0 items-center">
            <Input aria-label="Assunto do vídeo" value={consultaDoVideo} maxLength={120} disabled={travado} onChange={(e) => setConsultaDoVideo(e.target.value)} placeholder="Ex.: carro elétrico carregando" className="min-w-0 flex-1" />
            <Button size="sm" variant="outline" className="ml-2 shrink-0" disabled={travado || buscandoVideo || consultaDoVideo.trim().length < 2} onClick={() => void buscarVideos()}>{buscandoVideo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}Buscar vídeo</Button>
          </div>
          {avisosDoVideo.map((a) => <p key={a} className={texto.auxiliar}>{a}</p>)}
          {videos.length > 0 && <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Vídeos encontrados">
            {videos.map((v, i) => <li key={`${v.banco}:${v.id}`} className="min-w-0" data-banco-do-video={v.banco}>
              <button type="button" className="group block w-full min-w-0 text-left" disabled={travado || buscandoVideo} onClick={() => void aplicarVideo(v)} title={`Usar ${v.nome}`} aria-label={`Usar o vídeo ${v.nome}`}>
                <span className="relative block w-full overflow-hidden rounded-md border border-border bg-secondary transition-colors group-hover:border-primary" style={{ paddingBottom: "56.25%" }}>
                  {v.poster_url && <img src={v.poster_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />}
                  <span className="absolute bottom-1 right-1 inline-flex items-center rounded-full bg-foreground/70 px-1.5 py-0.5 text-[11px] text-background"><Film className="mr-1 h-3 w-3" aria-hidden="true" />{v.duracao_s ? `${Math.round(v.duracao_s)} s` : "vídeo"}</span>
                  {melhorVideo === i && <span className="absolute left-1 top-1 inline-flex items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground"><Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />Melhor</span>}
                </span>
                <span className="mt-1 block truncate text-[12px]">{v.nome}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{BANCO_DO_VIDEO[v.banco] || "Internet"}{v.autor ? ` · ${v.autor}` : ""}</span>
              </button>
            </li>)}
          </ul>}
          {videosReaisDaLamina.length > 0 && <label className={juntar("block", texto.rotulo)}>Vídeos já trazidos para esta lâmina
            <select aria-label="Vídeos reais da lâmina" className={juntar(campo, "mt-1")} disabled={travado} value={videosReaisDaLamina.find((v) => v.caminho === midiaAtual?.caminho)?.caminho || ""} onChange={(e) => { const v = videosReaisDaLamina.find((x) => x.caminho === e.target.value); if (v) usarMidia(midiaDoVideoReal(v), "video"); }}>
              <option value="">Escolha</option>
              {videosReaisDaLamina.map((v) => <option key={v.caminho} value={v.caminho}>{v.nome} · {BANCO_DO_VIDEO[v.banco] || "Internet"}</option>)}
            </select>
          </label>}
        </div>
      )}
      {fonte === "gerar" && !ehVideoNoBloco && (
        <div className="space-y-2">
          <label className={juntar("block", texto.rotulo)}>O que a imagem mostra<Textarea aria-label="Descrição da imagem do bloco" value={descricaoDaFoto} maxLength={600} rows={3} disabled={travado} onChange={(e) => setDescricaoDaFoto(e.target.value)} className="mt-1" /></label>
          {!trabalho.modelo_imagem_id ? <p role="status" className={texto.auxiliar}>Escolha o modelo de imagem na barra do Estúdio para gerar.</p> : (
            <BotaoComCusto rotulo={<><IconeDeImagem className="mr-1.5 h-3.5 w-3.5" />Gerar imagem</>} titulo="Gerar a imagem do bloco" descricao="Uma imagem sem texto, inteira no bloco (só quando não há foto real boa)." partes={() => partesDaFotoDoTemplate(trabalho.modelo_imagem_id, trabalho.qualidade)} executar={gerarFoto} sempreConfirmar disabled={travado || !descricaoDaFoto.trim()} />
          )}
        </div>
      )}
      {fonte === "gerar" && ehVideoNoBloco && (
        <div className="space-y-2">
          <label className={juntar("block", texto.rotulo)}>O que o vídeo mostra<Textarea aria-label="Descrição do vídeo do bloco" value={descricaoDoVideo} maxLength={400} rows={3} disabled={travado} onChange={(e) => setDescricaoDoVideo(e.target.value)} className="mt-1" /></label>
          {custoDoVideo ? <div className="flex flex-wrap items-center"><Button size="sm" className="mb-1 mr-2" disabled={travado} onClick={() => void confirmarVideo()}>Confirmar {usd(custoDoVideo.usd)}</Button><Button size="sm" variant="ghost" className="mb-1" onClick={() => setCustoDoVideo(null)}>Cancelar</Button></div>
            : <Button size="sm" variant="outline" disabled={travado || !descricaoDoVideo.trim()} onClick={() => void pedirCustoDoVideo()}><Film className="mr-1.5 h-3.5 w-3.5" />Gerar vídeo com IA</Button>}
          <p className={texto.auxiliar}>Vídeo de 5 s pela Mesa Vídeos. Pronto, ele aparece em Workspace › Vídeos do cliente.</p>
        </div>
      )}
      {fonte === "enviar" && (
        <div className="space-y-2">
          <label className={juntar(botao.discreto, "-ml-3.5 cursor-pointer", (travado || enviando) && "pointer-events-none opacity-50")}>
            {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}{ehVideoNoBloco ? "Enviar vídeo do computador" : "Enviar imagem do computador"}
            <input type="file" className="hidden" aria-label={ehVideoNoBloco ? "Arquivo de vídeo do bloco" : "Arquivo de imagem do bloco"} accept={ehVideoNoBloco ? "video/mp4,video/quicktime,video/webm" : "image/png,image/jpeg,image/webp"} disabled={travado || enviando} onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviar(f); e.target.value = ""; }} />
          </label>
          <p className={texto.auxiliar}>{ehVideoNoBloco ? "Vai para os vídeos do cliente (Mesa Vídeos)." : "Vai para as fotos do cliente no Estúdio."}</p>
        </div>
      )}
      {fonte === "workspace" && (
        <div className="space-y-2">
          <Button size="sm" variant="outline" disabled={travado} onClick={() => setWorkspaceAberto(true)}><FolderOpen className="mr-1.5 h-3.5 w-3.5" />Escolher do Workspace</Button>
          {!ehVideoNoBloco && fontesDeImagem.length > 0 && <label className={juntar("block", texto.rotulo)}>Imagens desta lâmina
            <select aria-label="Imagens da lâmina para o bloco" className={juntar(campo, "mt-1")} disabled={travado} value={fontesDeImagem.find((f) => f.caminho === midiaAtual?.caminho) ? chaveDaFonteProfile(fontesDeImagem.find((f) => f.caminho === midiaAtual?.caminho)!) : ""} onChange={(e) => { const f = fontesDeImagem.find((x) => chaveDaFonteProfile(x) === e.target.value); const m = f ? midiaDaFonte(f) : null; if (m) usarMidia(m, "imagem"); }}>
              <option value="">Escolha</option>
              {fontesDeImagem.map((f) => <option key={chaveDaFonteProfile(f)} value={chaveDaFonteProfile(f)}>{ROTULO_DO_GRUPO[f.grupo]} · {f.nome}</option>)}
            </select>
          </label>}
          {!ehVideoNoBloco && <Button size="sm" variant="ghost" disabled={travado} onClick={onAbrirFotos}>Abrir Fotos e acervo</Button>}
          {ehVideoNoBloco && (videosDoCliente.data?.arquivos.length || 0) > 0 && <label className={juntar("block", texto.rotulo)}>Vídeos do cliente
            <select aria-label="Vídeos do cliente para o bloco" className={juntar(campo, "mt-1")} disabled={travado} value={videosDoCliente.data?.arquivos.find((a) => a.storage_path === midiaAtual?.caminho)?.id || ""} onChange={(e) => { const a = videosDoCliente.data?.arquivos.find((x) => x.id === e.target.value); if (a && ehVideo(a.storage_path)) usarMidia({ bucket: "mesa", caminho: a.storage_path, origem: "workspace", ...(a.duracao_s ? { duracao_s: a.duracao_s } : {}) }, "video"); }}>
              <option value="">Escolha</option>
              {videosDoCliente.data?.arquivos.filter((a) => ehVideo(a.storage_path)).slice(0, 200).map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </select>
          </label>}
          {workspaceAberto && <EscolherDocumentos aberta umSo soDoCliente clienteId={mesa.clientId} jaEscolhidos={[]} titulo={ehVideoNoBloco ? "Vídeo do Workspace" : "Imagem do Workspace"}
            aceitar={(n) => (ehVideoNoBloco ? ehVideo(n.storage_path || "") || (n.mime || "").indexOf("video/") === 0 : ehImagem(n.storage_path || "") || ["image/png", "image/jpeg", "image/webp"].indexOf(n.mime || "") >= 0)}
            onFechar={() => setWorkspaceAberto(false)}
            onEscolher={(lista) => { setWorkspaceAberto(false); const a = lista[0]; if (a?.path) usarMidia({ bucket: "workspace", caminho: a.path, origem: "workspace" }, ehVideoNoBloco ? "video" : "imagem"); }} />}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------- gráfico e manchete pela IA (23/10, só dado real)
  const [avisoDaIa, setAvisoDaIa] = useState("");
  const blocoPorIa = async (tipo: "grafico" | "manchete") => {
    setAvisoDaIa(""); setErro("");
    try {
      const r = await chamarFuncao<{ grafico?: GraficoDoBloco; manchete?: MancheteDoBloco; fonte?: { nome?: string; veiculo?: string; url?: string | null }; custo_usd: number }>("estudio-arte", { acao: "template_bloco_ia", trabalho_id: trabalho.id, ordem: card.ordem, tipo, ...(sugestao?.busca ? { assunto: sugestao.busca } : {}), confirmado: true });
      if (tipo === "grafico" && r.grafico) onBloco({ tipo: "grafico", grafico: r.grafico });
      if (tipo === "manchete" && r.manchete) onBloco({ tipo: "manchete", manchete: { ...r.manchete, cor: manchete.cor }, borda: true });
      const f = r.fonte ? r.fonte.nome || r.fonte.veiculo : "";
      setAvisoDaIa(f ? `Preenchido com dado real · fonte: ${f}` : "Preenchido com dado real");
      mesa.atualizarCusto?.();
      return { custo_usd: Number(r.custo_usd) || 0 };
    } catch (e) {
      // Sem dado real: o aviso fica na tela e o modelo segue para preencher à mão (nada inventado).
      if (e instanceof ErroDaMesa && e.codigo === "sem_dado_real") { setAvisoDaIa(textoDoErro(e)); return { custo_usd: Number((e.detalhes || {}).custo_usd) || 0 }; }
      throw e;
    }
  };
  const botaoDaIa = (tipo: "grafico" | "manchete") => (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center">
        <BotaoComCusto rotulo={<><Wand2 className="mr-1.5 h-3.5 w-3.5" />Gerar com IA</>} titulo={tipo === "grafico" ? "Gráfico pela IA" : "Manchete pela IA"}
          descricao={tipo === "grafico" ? "Números reais do assunto, das lâminas e das notícias, conferidos um a um, com a fonte." : "A notícia real do assunto que fala desta lâmina, escolhida pelo Jev."}
          partes={() => (tipo === "grafico" ? partesDoTextoDoTemplate(diretor?.id) : [{ modeloId: diretor?.id || null, tipo: "texto", tokensEntrada: 1_500, tokensSaida: 100 }])}
          executar={() => blocoPorIa(tipo)} sempreConfirmar variant="outline" disabled={travado} />
        <AjudaRecolhida className="ml-1.5" rotulo="De onde vêm os dados">Só dado real: notícias do assunto, o assunto do carrossel e o texto das lâminas. Sem dado real, nada é inventado e o modelo fica para você preencher.</AjudaRecolhida>
      </div>
      {avisoDaIa && <p role="status" className={texto.auxiliar} data-aviso-da-ia="">{avisoDaIa}</p>}
    </div>
  );

  // ---------------------------------------------------------------- perfil (a chamada "Siga" na última lâmina)
  const perfilAtual: PerfilDoBloco = bloco.perfil || (perfilDeRedes ? perfilDoBlocoDeRedes(perfilDeRedes, "instagram", verificado) : { estilo: "instagram", nome: "", username: "" });
  const mudarPerfil = (patch: Partial<PerfilDoBloco>) => onBloco({ tipo: "perfil", perfil: { ...perfilAtual, ...patch } });
  const usarPerfilDeRedes = (estilo: PerfilDoBloco["estilo"] = perfilAtual.estilo) => { if (perfilDeRedes) onBloco({ tipo: "perfil", perfil: perfilDoBlocoDeRedes(perfilDeRedes, estilo, verificado), cantos: 24, borda: true }); };
  const ehUltima = cards.length > 1 && cards[cards.length - 1]?.ordem === card.ordem;
  const numeroOuVazio = (v: string) => { const n = Math.floor(Number(v.replace(/\D/g, ""))); return v.trim() && Number.isFinite(n) ? n : undefined; };
  /** 24/10 (dono: "opção de mudar a cor"): a cor do card e a do Seguir, com as da marca, uma livre e o padrão. */
  const coresDoPerfil = (campo: "cor_fundo" | "cor_botao", rotulo: string) => {
    const atual = (perfilAtual[campo] || "").toLowerCase();
    const opcoes = Array.from(new Set([...coresDaMarca.map((c) => c.toLowerCase()), ...(campo === "cor_fundo" ? ["#ffffff", "#000000", "#15202b", "#f5f1e8"] : ["#0095f6", "#1d9bf0", "#000000"])])).filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 10);
    return (
      <div className="min-w-0" data-cores-do-perfil={campo}>
        <p className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</p>
        <div role="group" aria-label={rotulo} className="flex flex-wrap items-center">
          <button type="button" aria-pressed={!atual} disabled={travado} onClick={() => mudarPerfil({ [campo]: undefined })} className={juntar("toque-compacto mb-1.5 mr-1.5 h-8 rounded-full border px-3 text-[12px]", !atual ? "border-primary text-primary" : "border-border text-muted-foreground")}>Padrão</button>
          {opcoes.map((c) => <button key={c} type="button" aria-label={`${rotulo} ${c}`} title={c} aria-pressed={atual === c} disabled={travado} onClick={() => mudarPerfil({ [campo]: c })}
            className={juntar("toque-compacto mb-1.5 mr-1.5 h-8 w-8 rounded-full border transition-shadow", atual === c ? "border-primary ring-2 ring-primary" : "border-border")} style={{ backgroundColor: c }} />)}
          <label className="mb-1.5 inline-flex items-center text-[12px] text-muted-foreground">Livre<input aria-label={`${rotulo} livre`} type="color" className="ml-1.5 h-8 w-10 cursor-pointer rounded-md border border-border bg-transparent" value={atual || (campo === "cor_fundo" ? "#ffffff" : "#0095f6")} disabled={travado} onChange={(e) => mudarPerfil({ [campo]: e.target.value.toLowerCase() })} /></label>
        </div>
      </div>
    );
  };
  const editorDoPerfil = (
    <div className="space-y-3" data-editor-do-perfil="">
      <Segmentado<PerfilDoBloco["estilo"]> rotulo="Jeito do perfil" opcoes={[{ valor: "instagram", rotulo: "Instagram" }, { valor: "x", rotulo: "X" }]} valor={perfilAtual.estilo} onEscolher={(v) => mudarPerfil({ estilo: v })} desativado={travado} />
      {perfilDeRedes ? <Button size="sm" variant="outline" disabled={travado} onClick={() => usarPerfilDeRedes()}><UserRound className="mr-1.5 h-3.5 w-3.5" />Puxar de Redes (@{perfilDeRedes.username})</Button>
        : <p role="status" className={juntar(texto.auxiliar, "text-warning")} data-perfil-sem-redes="">Sem os dados de Redes deste cliente: preencha à mão.</p>}
      <div className="grid min-w-0 gap-3">
        <label className={juntar("block min-w-0", texto.rotulo)}>Nome<Input aria-label="Nome no perfil" value={perfilAtual.nome} maxLength={80} disabled={travado} onChange={(e) => mudarPerfil({ nome: e.target.value })} className="mt-1" /></label>
        <label className={juntar("block min-w-0", texto.rotulo)}>@<Input aria-label="@ no perfil" value={perfilAtual.username} maxLength={31} disabled={travado} onChange={(e) => mudarPerfil({ username: e.target.value.replace(/^@/, "") })} className="mt-1" /></label>
        <label className={juntar("block min-w-0", texto.rotulo)}>Bio<Textarea aria-label="Bio no perfil" value={perfilAtual.bio || ""} maxLength={300} rows={3} disabled={travado} onChange={(e) => mudarPerfil({ bio: e.target.value || undefined })} className="mt-1" /></label>
        <label className={juntar("block min-w-0", texto.rotulo)}>Link<Input aria-label="Link no perfil" value={perfilAtual.site || ""} maxLength={80} disabled={travado} onChange={(e) => mudarPerfil({ site: e.target.value || undefined })} className="mt-1" /></label>
      </div>
      {coresDoPerfil("cor_fundo", "Cor do card")}
      {coresDoPerfil("cor_botao", "Cor do botão Seguir")}
      <div className="grid min-w-0 grid-cols-3 gap-2">
        {(["posts", "seguidores", "seguindo"] as const).map((k) => <label key={k} className={juntar("block min-w-0", texto.rotulo)}>{k === "posts" ? "Posts" : k === "seguidores" ? "Seguidores" : "Seguindo"}<Input aria-label={`${k} no perfil`} inputMode="numeric" value={typeof perfilAtual[k] === "number" ? String(perfilAtual[k]) : ""} disabled={travado} onChange={(e) => mudarPerfil({ [k]: numeroOuVazio(e.target.value) })} className="mt-1" /></label>)}
      </div>
    </div>
  );

  const editorDoGrafico = (
    <div className="space-y-3" data-editor-do-grafico="">
      {botaoDaIa("grafico")}
      <Segmentado<GraficoDoBloco["tipo"]> rotulo="Tipo de gráfico" opcoes={[{ valor: "barras", rotulo: "Barras" }, { valor: "linha", rotulo: "Linha" }, { valor: "pizza", rotulo: "Pizza" }, { valor: "numero", rotulo: "Número grande" }, { valor: "tabela", rotulo: "Tabela" }]} valor={grafico.tipo} onEscolher={(t) => mudarGrafico(t === "tabela" ? { tipo: t, colunas: grafico.colunas || ["Item", "Valor"], linhas: grafico.linhas || grafico.dados.map((d) => [d.rotulo, String(d.valor)]) } : { tipo: t })} desativado={travado} />
      <div className="grid min-w-0 gap-3">
        <label className={juntar("block min-w-0", texto.rotulo)}>Título do gráfico<Input aria-label="Título do gráfico" value={grafico.titulo || ""} maxLength={90} disabled={travado} onChange={(e) => mudarGrafico({ titulo: e.target.value || undefined })} className="mt-1" /></label>
        <label className={juntar("block min-w-0", texto.rotulo)}>Fonte dos números<Input aria-label="Fonte dos números" value={grafico.fonte || ""} maxLength={160} disabled={travado} placeholder="De onde vieram (obrigatório para publicar)" onChange={(e) => mudarGrafico({ fonte: e.target.value || undefined })} className="mt-1" /></label>
      </div>
      {grafico.tipo !== "tabela" ? <>
        <label className={juntar("block min-w-0", texto.rotulo)}>Unidade<Input aria-label="Unidade do gráfico" value={grafico.unidade || ""} maxLength={12} disabled={travado} placeholder="%, R$, mil" onChange={(e) => mudarGrafico({ unidade: e.target.value || undefined })} className="mt-1" /></label>
        <ul className="space-y-1.5" aria-label="Números do gráfico">
          {grafico.dados.map((d, i) => <li key={i} className="flex min-w-0 items-center">
            <Input aria-label={`Rótulo ${i + 1}`} value={d.rotulo} maxLength={40} disabled={travado} onChange={(e) => mudarGrafico({ dados: grafico.dados.map((x, j) => (j === i ? { ...x, rotulo: e.target.value } : x)) })} className="min-w-0 flex-1" />
            <Input aria-label={`Valor ${i + 1}`} type="number" value={Number.isFinite(d.valor) ? d.valor : 0} disabled={travado} onChange={(e) => mudarGrafico({ dados: grafico.dados.map((x, j) => (j === i ? { ...x, valor: Number(e.target.value) || 0 } : x)) })} className="ml-2 w-24 shrink-0" />
            <button type="button" className={botao.icone} aria-label={`Tirar ${d.rotulo || `valor ${i + 1}`}`} title="Tirar" disabled={travado || grafico.dados.length <= 2} onClick={() => mudarGrafico({ dados: grafico.dados.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" /></button>
          </li>)}
        </ul>
        <Button size="sm" variant="ghost" disabled={travado || grafico.dados.length >= 12} onClick={() => mudarGrafico({ dados: [...grafico.dados, { rotulo: `Item ${grafico.dados.length + 1}`, valor: 0 }] })}><Plus className="mr-1 h-3.5 w-3.5" />Número</Button>
      </> : (
        <label className={juntar("block", texto.rotulo)}>Tabela (uma linha por linha, colunas separadas por ;)
          <Textarea aria-label="Tabela do gráfico" rows={5} disabled={travado} value={[(grafico.colunas || []).join(" ; "), ...(grafico.linhas || []).map((l) => l.join(" ; "))].join("\n")} onChange={(e) => {
            const linhas = e.target.value.split("\n").map((l) => l.split(";").map((c) => c.trim())).filter((l) => l.some(Boolean));
            const colunas = (linhas[0] || []).slice(0, 5);
            mudarGrafico({ colunas, linhas: linhas.slice(1, 9).map((l) => colunas.map((_, k) => l[k] || "")) });
          }} className="mt-1" />
        </label>
      )}
    </div>
  );

  const editorDaManchete = (
    <div className="space-y-3" data-editor-da-manchete="">
      {botaoDaIa("manchete")}
      <div className="flex min-w-0 items-center">
        <Input aria-label="Assunto da notícia" value={assuntoDaNoticia} maxLength={120} disabled={travado} onChange={(e) => setAssuntoDaNoticia(e.target.value)} placeholder="Assunto (vazio: o nicho do cliente)" className="min-w-0 flex-1" />
        <Button size="sm" variant="outline" className="ml-2 shrink-0" disabled={travado || buscandoNoticia} onClick={() => void buscarNoticias()}>{buscandoNoticia ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Newspaper className="mr-1 h-3.5 w-3.5" />}Buscar notícia</Button>
      </div>
      {noticias.length > 0 && <ul className="space-y-1" aria-label="Notícias reais">
        {noticias.map((n) => <li key={n.link}><button type="button" className={juntar("w-full min-w-0 rounded-md px-2 py-1.5 text-left hover:bg-muted", texto.corpo)} disabled={travado} onClick={() => onBloco({ manchete: { veiculo: n.fonte.slice(0, 40), titulo: n.titulo.slice(0, 220), url: n.link, data: new Date(n.data).toLocaleDateString("pt-BR") } })}><span className="block truncate">{n.titulo}</span><span className={texto.auxiliar}>{n.fonte}</span></button></li>)}
      </ul>}
      <div className="grid min-w-0 gap-3">
        <label className={juntar("block min-w-0", texto.rotulo)}>Veículo<Input aria-label="Veículo da manchete" value={manchete.veiculo} maxLength={40} disabled={travado} onChange={(e) => mudarManchete({ veiculo: e.target.value })} className="mt-1" /></label>
        <label className={juntar("block min-w-0", texto.rotulo)}>Título<Textarea aria-label="Título da manchete" value={manchete.titulo} maxLength={220} rows={2} disabled={travado} onChange={(e) => mudarManchete({ titulo: e.target.value })} className="mt-1" /></label>
        <label className={juntar("block min-w-0", texto.rotulo)}>Linha fina<Input aria-label="Linha fina da manchete" value={manchete.linha_fina || ""} maxLength={320} disabled={travado} onChange={(e) => mudarManchete({ linha_fina: e.target.value || undefined })} className="mt-1" /></label>
        <label className={juntar("block min-w-0", texto.rotulo)}>Data<Input aria-label="Data da manchete" value={manchete.data || ""} maxLength={40} disabled={travado} onChange={(e) => mudarManchete({ data: e.target.value || undefined })} className="mt-1" /></label>
        <label className={juntar("block min-w-0", texto.rotulo)}>Cor do veículo<input aria-label="Cor do veículo" type="color" className="mt-1 block h-8 w-12 cursor-pointer rounded-md border border-border bg-transparent" value={manchete.cor || "#c4170c"} disabled={travado} onChange={(e) => mudarManchete({ cor: e.target.value })} /></label>
      </div>
      {manchete.url && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>Fonte guardada: <a href={manchete.url} target="_blank" rel="noopener noreferrer" className="underline">{manchete.url}</a></p>}
    </div>
  );

  const tamanhoPronto = TAMANHOS_DO_BLOCO.find((t) => Number(t.valor) === bloco.altura)?.valor || "";
  const cantoPronto = CANTOS_DO_BLOCO.find((t) => Number(t.valor) === bloco.cantos)?.valor || "";
  const temCredito = !!midiaAtual?.credito && (bloco.tipo === "imagem" || bloco.tipo === "video");
  const ajustesDoBloco = bloco.tipo === "nenhum" ? <p className={texto.auxiliar}>Lâmina só de texto: ajuste o tamanho em Texto.</p> : (
    <div className="space-y-4" data-ajustes-do-bloco="">
      <Segmentado<BlocoDaLamina["posicao"]> rotulo="Lugar do bloco" opcoes={[{ valor: "acima", rotulo: "Acima do texto" }, { valor: "meio", rotulo: "No meio" }, { valor: "abaixo", rotulo: "Abaixo" }]} valor={bloco.posicao} onEscolher={(v) => onBloco({ posicao: v })} desativado={travado} />
      <Segmentado<string> rotulo="Tamanho do bloco" opcoes={TAMANHOS_DO_BLOCO} valor={tamanhoPronto} onEscolher={(v) => onBloco({ altura: Number(v), largura: 100 })} desativado={travado} />
      <Segmentado<string> rotulo="Cantos" opcoes={CANTOS_DO_BLOCO} valor={cantoPronto} onEscolher={(v) => onBloco({ cantos: Number(v) })} desativado={travado || bloco.sangrar} />
      <div className="flex flex-wrap">
        <Marca rotulo="Sangrar até a borda" marcado={bloco.sangrar} desativado={travado} onMudar={(v) => onBloco({ sangrar: v })} />
        <Marca rotulo="Borda fina" marcado={bloco.borda} desativado={travado} onMudar={(v) => onBloco({ borda: v })} />
        <Marca rotulo="Sombra leve" marcado={bloco.sombra} desativado={travado} onMudar={(v) => onBloco({ sombra: v })} />
        {temCredito && <Marca rotulo="Crédito embaixo do bloco" marcado={!!bloco.credito_visivel} desativado={travado} onMudar={(v) => onBloco({ credito_visivel: v || undefined })} />}
        {ehVideoNoBloco && <Marca rotulo="Ícone de som na peça" marcado={!!bloco.som_na_peca} desativado={travado} onMudar={(v) => onBloco({ som_na_peca: v || undefined })} />}
      </div>
      {temCredito && bloco.credito_visivel && <p className={texto.auxiliar} data-credito-na-lamina="">Na lâmina: {textoDoCredito(bloco)}</p>}
      <details className="min-w-0" open={!tamanhoPronto || !cantoPronto || bloco.largura !== 100}>
        <summary className="cursor-pointer text-[12px] text-muted-foreground">Ajuste fino do bloco</summary>
        <div className="mt-2 grid min-w-0 gap-3">
          <Regua rotulo="Altura do bloco" valor={bloco.altura} min={20} max={100} sufixo="%" desativado={travado} onMudar={(v) => onBloco({ altura: v })} />
          <Regua rotulo="Largura do bloco" valor={bloco.largura} min={40} max={100} sufixo="%" desativado={travado || bloco.sangrar} onMudar={(v) => onBloco({ largura: v })} />
          <Regua rotulo="Cantos do bloco" valor={bloco.cantos} min={0} max={48} desativado={travado || bloco.sangrar} onMudar={(v) => onBloco({ cantos: v })} />
        </div>
      </details>
      {(bloco.tipo === "imagem" || bloco.tipo === "video") && <>
        <Segmentado<BlocoDaLamina["enquadramento"]> rotulo="Enquadramento" opcoes={[{ valor: "inteira", rotulo: "Mídia inteira" }, { valor: "preencher", rotulo: "Preencher o bloco" }]} valor={bloco.enquadramento} onEscolher={(v) => onBloco({ enquadramento: v })} desativado={travado} />
        {bloco.enquadramento === "preencher" && <div className="grid min-w-0 gap-3">
          <Regua rotulo="Ponto focal na horizontal" valor={Math.round(bloco.foco_x * 100)} min={0} max={100} passo={5} sufixo="%" desativado={travado} onMudar={(v) => onBloco({ foco_x: v / 100 })} />
          <Regua rotulo="Ponto focal na vertical" valor={Math.round(bloco.foco_y * 100)} min={0} max={100} passo={5} sufixo="%" desativado={travado} onMudar={(v) => onBloco({ foco_y: v / 100 })} />
        </div>}
      </>}
    </div>
  );

  const aplicarATodas = (campos: CampoDaAparencia[], rotulo: string) => onAplicarATodas && (
    <Button size="sm" variant="outline" disabled={travado} onClick={() => onAplicarATodas(campos)} aria-label={`Aplicar ${rotulo} a todas as lâminas`} title={`Aplicar ${rotulo} a todas as lâminas`}>Aplicar a todas as lâminas</Button>
  );
  const textoDaLamina = (
    <div className="space-y-4">
      {editorDeTexto || <EditorDoTextoDaLamina trabalho={trabalho} card={card} total={cards.length} travado={travado} onMudou={onMudou} />}
      <div className="grid min-w-0 gap-3 border-t border-border pt-4">
        <Regua rotulo="Tamanho do texto" valor={ajustes.tamanho_texto} min={24} max={56} desativado={travado} onMudar={(v) => onAjuste("tamanho_texto", v)} />
      </div>
      <Segmentado<"regular" | "medio"> rotulo="Peso do texto" opcoes={[{ valor: "regular", rotulo: "Regular" }, { valor: "medio", rotulo: "Médio" }]} valor={ajustes.peso_texto || "regular"} onEscolher={(v) => onAjuste("peso_texto", v)} desativado={travado} />
      <div className="flex flex-wrap">
        <Marca rotulo="Seta de próxima" marcado={ajustes.seta !== false} desativado={travado} onMudar={(v) => onAjuste("seta", v)} />
      </div>
      {aplicarATodas(["tamanho_texto", "peso_texto", "seta"], "o tamanho e o estilo do texto")}
    </div>
  );

  // ---------------------------------------------------------------- fundo da lâmina (23/10)
  const corAtual = (ajustes.cor_fundo || "#ffffff").toLowerCase();
  const marcaSemRepetir = coresDaMarca.map((c) => c.toLowerCase()).filter((c, i, l) => /^#[0-9a-f]{6}$/.test(c) && l.indexOf(c) === i && !FUNDOS_PRONTOS.some((f) => f.cor === c)).slice(0, 8);
  const usarFundo = (cor: string) => { onAjuste("cor_fundo", cor.toLowerCase()); onAjuste("tema", temaDoFundo(cor)); };
  const amostra = (cor: string, rotulo: string) => (
    <button key={cor} type="button" aria-label={`Fundo ${rotulo}`} title={`${rotulo} ${cor}`} aria-pressed={corAtual === cor} disabled={travado} onClick={() => usarFundo(cor)}
      className={juntar("toque-compacto relative mb-1.5 mr-1.5 inline-flex h-9 w-9 items-center justify-center rounded-full border transition-shadow", corAtual === cor ? "border-primary ring-2 ring-primary" : "border-border")} style={{ backgroundColor: cor }}>
      {corAtual === cor && <Check className="h-4 w-4" style={{ color: fundoEscuro(cor) ? "#ffffff" : "#0f1419" }} aria-hidden="true" />}
    </button>
  );
  const fundoDaLamina = (
    <div className="space-y-4" data-fundo-da-lamina="">
      <div className="min-w-0">
        <p className={juntar(texto.rotulo, "mb-1.5")}>Fundos prontos</p>
        <div role="group" aria-label="Fundos prontos" className="flex flex-wrap">{FUNDOS_PRONTOS.map((f) => amostra(f.cor, f.rotulo))}</div>
      </div>
      <div className="min-w-0">
        <p className={juntar(texto.rotulo, "mb-1.5")}>Cores da marca</p>
        {marcaSemRepetir.length ? <div role="group" aria-label="Cores da marca" className="flex flex-wrap">{marcaSemRepetir.map((c) => amostra(c, "da marca"))}</div>
          : <p className={texto.auxiliar}>Sem paleta da marca: use a cor livre.</p>}
      </div>
      <label className="inline-flex items-center text-[12px] text-muted-foreground">Cor livre<input aria-label="Cor de fundo da lâmina" type="color" className="ml-2 h-8 w-10 cursor-pointer rounded-md border border-border bg-transparent" value={corAtual} disabled={travado} onChange={(e) => usarFundo(e.target.value)} /></label>
      <p className={texto.auxiliar} data-contraste-do-texto="">Texto {fundoEscuro(corAtual) ? "claro" : "escuro"}, pelo contraste com o fundo</p>
      <div className="flex flex-wrap">
        <Marca rotulo="Rodapé levemente sombreado" marcado={!!ajustes.rodape_cinza} desativado={travado} onMudar={(v) => onAjuste("rodape_cinza", v || undefined)} />
      </div>
      {aplicarATodas(["cor_fundo", "tema", "rodape_cinza"], "o fundo")}
    </div>
  );

  const gerador = (
    <div className="space-y-3" data-gerador-do-carrossel="">
      <label className={juntar("block", texto.rotulo)}>Assunto do carrossel<Textarea aria-label="Assunto do carrossel" value={assunto} maxLength={1200} rows={3} disabled={travado || !!andamento} onChange={(e) => setAssunto(e.target.value)} placeholder="Do que o carrossel fala (com os números reais que você tiver)" className="mt-1" /></label>
      {noticiaDaBase ? <p className={texto.auxiliar}>Notícia base: {noticiaDaBase.titulo} · {noticiaDaBase.fonte} <button type="button" className="underline" onClick={() => setNoticiaDaBase(null)}>tirar</button></p>
        : noticias.length > 0 && <label className={juntar("block", texto.rotulo)}>Notícia base (opcional)<select aria-label="Notícia base do carrossel" className={juntar(campo, "mt-1")} value="" disabled={travado} onChange={(e) => setNoticiaDaBase(noticias.find((n) => n.link === e.target.value) || null)}><option value="">Sem notícia</option>{noticias.map((n) => <option key={n.link} value={n.link}>{n.titulo.slice(0, 90)}</option>)}</select></label>}
      <label className="flex items-center text-[12px]"><input type="checkbox" className="mr-1.5" checked={permitirIA} disabled={travado || !!andamento} onChange={(e) => setPermitirIA(e.target.checked)} />Gerar imagem por IA quando não houver mídia real boa</label>
      <div className="flex flex-wrap items-center">
        <BotaoComCusto
          rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />Gerar o carrossel ({cards.length})</>}
          titulo="Gerar o carrossel inteiro"
          descricao={`Texto de todas as lâminas, a mídia escolhida pelo Jev, a busca da mídia real${comFoto ? " e, no máximo, uma imagem por IA por lâmina sem real boa" : ""}. O custo é o teto.`}
          partes={() => [...partesDoTextoDoTemplate(diretor?.id), ...(comFoto ? partesDaFotoDoTemplate(trabalho.modelo_imagem_id, trabalho.qualidade, cards.length) : [])]}
          executar={() => gerarCarrossel(false)}
          sempreConfirmar
          disabled={travado || !!andamento || (!assunto.trim() && !noticiaDaBase)}
        />
        <AjudaRecolhida className="ml-1.5" rotulo="Como o gerador funciona">O redator escreve cada lâmina (gancho, número real, frase curta e CTA na última). O Jev escolhe a mídia de cada uma: foto real, vídeo real, gráfico com os números, manchete da notícia, imagem por IA ou só texto. A mídia real vem da Wikimedia, do Openverse e do Pexels, só com licença comercial e com o crédito guardado.</AjudaRecolhida>
      </div>
      {andamento && <p role="status" className={texto.auxiliar}><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{andamento}</p>}
      {avisosDoGerador.map((a) => <p key={a} role="status" className={juntar(texto.auxiliar, "text-warning")}>{a}</p>)}
    </div>
  );

  const posicaoDaLamina = Math.max(1, cards.findIndex((c) => c.ordem === card.ordem) + 1);
  return (
    <div className="min-w-0 space-y-4" data-painel-do-carrossel="">
      <section className="min-w-0 space-y-3" aria-label="Carrossel X">
        <p className={juntar(texto.corpo, "font-semibold")}>Carrossel X</p>
        {modeloSeletor}
        {gerador}
      </section>
      <section className="min-w-0 space-y-4 border-t border-border pt-4" aria-label={`Lâmina ${posicaoDaLamina}`} data-ajustes-da-lamina={parte}>
        <p className={juntar(texto.corpo, "font-semibold")}>Lâmina {posicaoDaLamina} de {cards.length}</p>
        <Segmentado<Parte> rotulo="Ajustar a lâmina" mostrarRotulo={false} opcoes={[
          { valor: "midia", rotulo: "Mídia", icone: <IconeDeImagem className="h-3.5 w-3.5" /> },
          { valor: "fundo", rotulo: "Fundo", icone: <PaintBucket className="h-3.5 w-3.5" /> },
          { valor: "texto", rotulo: "Texto", icone: <Type className="h-3.5 w-3.5" /> },
        ]} valor={parte} onEscolher={setParte} />
        {parte === "fundo" && fundoDaLamina}
        {parte === "texto" && textoDaLamina}
      </section>
      {parte === "midia" && secao("Bloco de mídia", <div className="space-y-3">
        <Segmentado<BlocoDaLamina["tipo"]> rotulo="Tipo de mídia" opcoes={TIPOS.map((t) => ({ valor: t, rotulo: ROTULO_DO_TIPO[t], icone: ICONE_DO_TIPO[t] }))} valor={bloco.tipo} onEscolher={(t) => onBloco({ tipo: t, ...(t === "imagem" && midiaAtual && !ehImagem(midiaAtual.caminho) ? { midia: undefined } : {}), ...(t === "video" && midiaAtual && !ehVideo(midiaAtual.caminho) ? { midia: undefined } : {}), ...(t === "grafico" && !bloco.grafico ? { grafico } : {}), ...(t === "manchete" && !bloco.manchete ? { manchete: { veiculo: "", titulo: "" }, borda: true } : {}), ...(t === "perfil" && !bloco.perfil ? { perfil: perfilAtual, cantos: 24, borda: true } : {}) })} desativado={travado} />
        {ehUltima && bloco.tipo !== "perfil" && <div className="flex flex-wrap items-center" data-chamada-siga="">
          <Button size="sm" variant="outline" className="mb-1 mr-2" disabled={travado} onClick={() => (perfilDeRedes ? usarPerfilDeRedes("instagram") : onBloco({ tipo: "perfil", perfil: perfilAtual, cantos: 24, borda: true }))}><UserRound className="mr-1.5 h-3.5 w-3.5" />Pôr o perfil com o Seguir</Button>
          <span className={juntar(texto.auxiliar, "mb-1")}>{perfilDeRedes ? "Pronto com os dados de Redes" : "Sem dados de Redes: preencha à mão"}</span>
        </div>}
        {sugestao && <p className={texto.auxiliar} data-sugestao-da-midia="">Sugestão {sugestao.por === "jev" ? "do Jev" : "do gerador"}: {sugestao.midia.replace("_", " ")}{sugestao.busca ? ` (${sugestao.busca})` : ""}</p>}
        {(bloco.tipo === "imagem" || bloco.tipo === "video") && origens}
        {bloco.tipo === "grafico" && editorDoGrafico}
        {bloco.tipo === "manchete" && editorDaManchete}
        {bloco.tipo === "perfil" && editorDoPerfil}
        <div className="flex flex-wrap items-center border-t border-border pt-3">
          <BotaoComCusto rotulo={<><Sparkles className="mr-1.5 h-3.5 w-3.5" />Preencher esta lâmina com IA</>} titulo="Preencher a lâmina com IA" descricao="Reescreve o texto desta lâmina e escolhe a mídia (real primeiro), com as outras como contexto."
            partes={() => [...partesDoTextoDoTemplate(diretor?.id), ...(comFoto ? partesDaFotoDoTemplate(trabalho.modelo_imagem_id, trabalho.qualidade, 1) : [])]}
            executar={() => gerarCarrossel(true)} sempreConfirmar variant="ghost" disabled={travado || !!andamento} />
        </div>
        {midiaAtual && (bloco.tipo === "imagem" || bloco.tipo === "video") && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")} data-midia-do-bloco={midiaAtual.origem}>
          No bloco: {bloco.tipo === "video" ? "vídeo" : "imagem"} {midiaAtual.origem === "enviada" ? "enviada" : midiaAtual.origem === "workspace" ? "do Workspace" : midiaAtual.origem === "gerada" ? "gerada" : midiaAtual.origem === "internet" ? "da internet" : "do cliente"}
          {credito && <> · {credito.fonte}{credito.autor ? ` · ${credito.autor}` : ""} · {credito.licenca} · <a href={credito.url} target="_blank" rel="noopener noreferrer" className="underline">fonte</a></>}
          <button type="button" className="ml-2 underline" disabled={travado} onClick={() => onBloco({ midia: undefined })}>trocar</button>
        </p>}
        {erro && <p role="alert" className="text-[12px] text-destructive">{erro}</p>}
      </div>)}
      {parte === "midia" && secao("Tamanho e estilo do bloco", ajustesDoBloco)}
    </div>
  );
}
