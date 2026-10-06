import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ControlesDaPauta } from "./ControlesDaPauta";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bookmark,
  CalendarCheck,
  Check,
  Copy,
  Hash,
  ImagePlus,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  Maximize2,
  MessageSquare,
  Minimize2,
  PenLine,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Type,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { textoDoMioloEnxuto } from "../../../supabase/functions/estudio-arte/modulos/limite-do-miolo";
import { precisaEnxugarNaGeracao, TAMANHO_DO_ENXUGAR, textoDaSugestaoDeDividir, type LaminaDoTexto } from "../../../supabase/functions/estudio-arte/texto-da-lamina";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  chamarFuncao,
  custoDaResposta,
  dataCurta,
  dataEHora,
  ErroDaMesa,
  estimarLocal,
  inicioDoMes,
  modelosAtivos,
  nomeDoModelo,
  padraoPara,
  parteDaConferenciaDoJev,
  precoDoModelo,
  somarMeses,
  TAMANHOS,
  textoDoErro,
  usd,
  type ModeloIa,
  type ParteDaEstimativa,
  type Qualidade,
} from "@/lib/mesa/api";
// Frente MF (27/09): post de fotos da Mesa Foto no mesmo trabalho do Estúdio (não gera arte aqui).
import { ehPostDeFotos, linkDoPostNaMesaFoto } from "../../../supabase/functions/_shared/post-de-fotos";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import CardDoEstudio, { type OpcoesDoAjuste, type PainelDaLamina } from "./CardDoEstudio";
import DiretorDoEstudio from "./DiretorDoEstudio";
import { desfazerVersaoDaLamina } from "./diretorDoEstudioApi";
import type { ExecutorDoPasso } from "./PlanoDoDiretor";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { emColunas, encaixarNaJanela, rolarAte, useFaixa } from "./EstudioAltura";
import { useAlturaQueCabe } from "@/components/sistema/AreaDeTrabalho";
import EstudioArteDaAgenda, { InspetorDaArte } from "./EstudioArteDaAgenda";
import EstudioBaseDaLamina from "./EstudioBaseDaLamina";
import EstudioAvisoDoRosto, { EstudioAvisosDaGeracao } from "./EstudioAvisoDoRosto";
import EstudioEntrega from "./EstudioEntrega";
// Frente AE (28/09): arte rápida, fora do plano do mês, no mesmo Estúdio.
import EstudioArteRapida, { type ModoRapidoDoDetalhe } from "./EstudioArteRapida";
import { ModoDoEstudio, SeletorDeFormatoCompacto, SeletorDeQualidadeCompacto } from "./EstudioControles";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { NOVA_ARTE_RAPIDA, PARAMETRO_DA_ARTE_RAPIDA, tituloDoAviso } from "../../../supabase/functions/estudio-arte/modulos/arte-rapida";
import EstudioFotos from "./EstudioFotos";
import EstudioLaminaGrande from "./EstudioLaminaGrande";
import EstudioLista, { DICA_DO_ROTEIRO, formatoDoItem, SeloDoItem, type FontesDaLista } from "./EstudioLista";
import EstudioPreparar, { SeletorDeFormato } from "./EstudioPreparar";
import {
  ETAPAS_DA_ESTEIRA,
  etapaDoItem,
  faltaEnviar,
  filtroValido,
  linkDaAgenda,
  passaNoFiltro,
  situacaoDoItem,
  type FiltroDoEstudio,
} from "./EstudioSituacao";
import { useFiltroDaMarca, useMarcaDaMesa, useMesa } from "./MesaContexto";
import { itemDaMarca } from "@/lib/mesa/marcas";
import { arquivarDaFaixa, pautasParecidas, restaurarDaFaixa, tirarDaFila, type ArquivadaDaFaixa, type RecusadaDaFaixa } from "./arquivarDaFaixa";
import ArquivadosDaFaixa, { chaveDosArquivados } from "./ArquivadosDaFaixa";
import AprovadasSemData, { chaveDasAprovadasSemData, JanelaDaAprovada, type AprovadaSemData } from "./AprovadasSemData";
import AgendarDoEstudio from "./AgendarDoEstudio";
import { entregarComModo, entregarVarias, prontaParaEntregar, resumoDoLote, type ModoDeEntrega, type ResultadoDaEntrega } from "@/lib/mesa/entregaComOpcoes";
import PedidoDoCliente from "./PedidoDoCliente";
import { erroDoItem, useFilaDoTrabalho } from "@/lib/mesa/filaDeGeracao";
// Frente T2: sem tipografia no kit da marca aberta, a geração fica bloqueada (não inventa).
import EstudioSemTipografia, { TEXTO_SEM_TIPOGRAFIA } from "./EstudioSemTipografia";
import { useSemTipografia } from "@/lib/mesa/tipografiaDoCliente";
import EstudioLogoDaLamina from "./EstudioLogoDaLamina";
import EstudioFidelidadeDaReferencia from "./EstudioFidelidadeDaReferencia";
import EstudioReferenciaNaHora from "./EstudioReferenciaNaHora";
import EstudioRefinarTexto from "./EstudioRefinarTexto";
import OpcoesDaCopy, { NotaDaCopy, opcoesDaResposta, type OpcaoDaCopy } from "@/components/sistema/OpcoesDaCopy";
import EstudioTextoDaLamina from "./EstudioTextoDaLamina";
import { useModoFoco } from "@/lib/modoFoco";
import { temJanelaAberta } from "./TelaCheiaDaMesa";
import PranchetaDoEstudio, { AVISO_DA_ORDEM_NO_CONTINUO, estaConferindo, type AndamentoDaLamina, type EtapaDaLamina } from "./PranchetaDoEstudio";
import { chaveDoCorrigirSozinho, conferirECorrigir, type DecisaoDeAutocorrecao } from "./autocorrecaoDaLamina";
import ReferenciasDoEstudio, { type AlvoDasReferencias } from "./ReferenciasDoEstudio";
import BotaoDoEstilo from "@/components/estilo/BotaoDoEstilo";
import { laminaCitada, pedidoDeAjustePendente } from "../../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import {
  AVISO_CONTINUO_FORA_DO_4X5,
  copiarTexto,
  corpoDoPreparar,
  corpoDoReabrir,
  formatoDoTrabalho,
  proporcaoDoFormato,
  versaoForaDoFormato,
  type FormatoDoPost,
  enviarUmParaAprovacao,
  AVISO_CONTINUO_SEM_MODELO,
  gravarTrabalhoNoCache,
  legendaParaCopiar,
  limiteDePreparos,
  modeloFazContinuo,
  normalizarHashtags,
  NOTA_DO_FUNDO_CONTINUO,
  partesDoPanorama,
  useEstadoGuardado,
  qualidadeNaGeracao,
  usaFundoContinuo,
  versaoForaDoFundo,
  laminaLevaLogo,
  type EscolhaDaLogo,
  type Area,
  type EscolhasDoPreparo,
  type TrabalhoGravado,
} from "./estudioUtil";
import {
  FORMATOS_POST_UNICO,
  PROXIMOS_DIAS,
  ultimasVersoes,
  useItemAvulso,
  useItensDoMes,
  type ArteNaAgenda,
  type CardDaDirecao,
  type InfoDoRoteiro,
  type ItemDoMes,
  type PublicacaoDoPost,
  type Trabalho,
} from "./useItensDoMes";

/**
 * Aba Estúdio (pedido do dono em 23/09: "o estúdio ficou muito pequeno para
 * editar e trabalhar"; "quando entra no Estúdio não tem a arte
 * selecionada").
 *
 * EM CIMA, a faixa das pautas (EstudioLista): período, filtros e os posts um
 * ao lado do outro por semana, numa tira com rolagem própria, recolhível.
 * EMBAIXO, o estúdio ocupando a largura: a barra do item (título, estado,
 * qualidade com o preço de cada uma, gerador e a ação principal), a
 * prancheta das lâminas e a lâmina escolhida GRANDE. Na borda direita, uma
 * barra de ferramentas fina com ícones (Lâmina, Fotos, Referências,
 * Conjunto, Legenda, Entrega): o clique abre o painel deslizante da
 * ferramenta, sem cartões empilhados. No celular tudo vira uma coluna e o
 * painel abre embaixo da lâmina.
 *
 * O Estúdio sempre abre com um item: o último aberto neste cliente ou,
 * senão, o primeiro de "A fazer" (sem mexer no endereço; o clique na faixa
 * é que grava o item na URL).
 *
 * Nenhuma ação de IA abre janela: o BotaoComCusto mostra o preço ao lado e
 * executa no clique. O andamento de cada lâmina é UM indicador só, na
 * prancheta (etapa e cronômetro que não recomeça). "Gerar as que faltam"
 * roda até 3 lâminas ao mesmo tempo; no carrossel contínuo, uma de cada vez,
 * porque cada lâmina continua a anterior. A conferência roda logo depois de
 * cada lâmina. A tela nunca desenha texto por cima da arte.
 *
 * Pedidos do dono de 26/09: "Tela cheia" (modo foco, como o Canvas da Mesa
 * Foto: a barra do painel e os botões flutuantes somem pelo
 * src/lib/modoFoco.ts, a faixa de pautas sai e o estúdio ocupa a janela;
 * volta pelo botão ou pelo Esc); a logo do kit escolhida na faixa da lâmina e
 * no conjunto; referência na hora (arrastar, arquivo, colar imagem ou link);
 * e "Refinar texto" no texto exato e na legenda.
 */

const EstudioDaPauta = lazy(() => import("./EstudioDaPauta"));

const CODIGOS_QUE_NAO_PARAM_A_FILA = ["acao_desconhecida", "servico_indisponivel"];
const CODIGOS_QUE_PARAM_TUDO = ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave"];
const EM_PARALELO = 3;
/** Outra geração fazendo o mesmo trecho do fundo contínuo: espera até ~6 min (18 x 20 s), sem pagar de novo. */
const ESPERAS_DO_FUNDO = 18;
const INTERVALO_DA_ESPERA_MS = 20_000;
const esperar = (ms: number) => new Promise<void>((pronto) => window.setTimeout(pronto, ms));
/** Largura das lâminas na prancheta (px); a altura é 1,25 vez. */
const LARGURA_NA_PRANCHETA = 112;
const LARGURA_NA_PRANCHETA_PILHA = 104;
/** Largura do painel deslizante das ferramentas (px). */
const LARGURA_DO_PAINEL = 360;

export const QUALIDADES_DO_ESTUDIO: { valor: Qualidade; rotulo: string; dica: string }[] = [
  { valor: "baixa", rotulo: "Rascunho", dica: "para testar ideia e layout" },
  { valor: "media", rotulo: "Padrão", dica: "texto nítido, o normal para postar" },
  { valor: "alta", rotulo: "Final", dica: "máximo detalhe, mais caro e mais lento" },
];

/** Partes da estimativa de uma lâmina (imagem + leitura da conferência). */
export function partesDaLamina(modeloImagem: string, leitorId: string | undefined, q: Qualidade, vezes = 1): ParteDaEstimativa[] {
  return [
    { modeloId: modeloImagem, tipo: "imagem", imagens: 1, qualidade: q, tokensEntrada: TAMANHOS.imagemAnexos.entrada, vezes },
    { modeloId: leitorId, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida, vezes },
  ];
}

/**
 * Preço de uma lâmina em cada qualidade, pela estimativa local (vazio quando
 * não dá para estimar). Com `fundo` (carrossel contínuo), soma o panorama que
 * falta para as `laminas` a gerar e divide por elas: o preço médio por lâmina.
 */
export function precosPorQualidade(
  modeloImagem: string,
  leitorId: string | undefined,
  catalogo: ModeloIa[],
  fundo?: { laminas: number; partes: (q: Qualidade) => ParteDaEstimativa[] },
): Record<Qualidade, string> {
  const saida: Record<Qualidade, string> = { baixa: "", media: "", alta: "" };
  if (!modeloImagem) return saida;
  for (const q of QUALIDADES_DO_ESTUDIO) {
    const laminas = fundo && fundo.laminas > 0 ? fundo.laminas : 1;
    const partes = partesDaLamina(modeloImagem, leitorId, q.valor, laminas).concat(fundo ? fundo.partes(q.valor) : []);
    const v = estimarLocal(partes, catalogo);
    saida[q.valor] = v === null ? "" : `~${usd(v / laminas)}`;
  }
  return saida;
}

type Filtro = FiltroDoEstudio;
type Ferramenta = "lamina" | "diretor" | "fotos" | "referencias" | "conjunto" | "legenda" | "entrega" | "post" | "pauta";
type EstadoDoItem = "producao" | "agenda" | "preparar";

const FERRAMENTAS: Record<Ferramenta, { rotulo: string; dica: string; icone: typeof PenLine }> = {
  lamina: { rotulo: "Lâmina", dica: "Texto, conferência, ajustes e versões da lâmina escolhida", icone: PenLine },
  diretor: { rotulo: "Diretor", dica: "Conversar com o diretor de arte: estilo, cenário, luz e cores, com mudanças que você aplica com um clique", icone: MessageSquare },
  fotos: { rotulo: "Fotos", dica: "Fotos reais para compor: fundo, pessoa ou objeto (cole com Ctrl+V)", icone: ImagePlus },
  referencias: { rotulo: "Referências", dica: "Referências que o gerador segue de perto, com a identidade da marca", icone: Bookmark },
  conjunto: { rotulo: "Conjunto", dica: "Conceito, fio visual, carrossel contínuo e pedido ao diretor", icone: Layers },
  legenda: { rotulo: "Legenda", dica: "Legenda e hashtags do post", icone: Type },
  entrega: { rotulo: "Entrega", dica: "Entregar em Arquivos e enviar para aprovação", icone: Send },
  post: { rotulo: "Post", dica: "O post na Agenda, a data e a legenda", icone: CalendarCheck },
  pauta: { rotulo: "Pauta", dica: "A pauta e as etapas da esteira", icone: ListChecks },
};

export const FERRAMENTAS_DO_ESTADO: Record<EstadoDoItem, Ferramenta[]> = {
  producao: ["lamina", "diretor", "fotos", "referencias", "conjunto", "legenda", "entrega"],
  agenda: ["post"],
  preparar: ["pauta"],
};

const semOrdem = <T,>(g: Record<number, T>, ordem: number) => {
  const n = { ...g };
  delete n[ordem];
  return n;
};

/**
 * Item que abre sozinho quando a URL não traz nenhum: o último aberto (se
 * ainda está na faixa), senão o primeiro de "A fazer", senão o primeiro.
 */
export function itemInicial(itens: ItemDoMes[], ultimo: string | null, aFazer: (i: ItemDoMes) => boolean): string | null {
  if (!itens.length) return null;
  if (ultimo && itens.some((i) => i.id === ultimo)) return ultimo;
  const primeiro = itens.find(aFazer);
  return (primeiro || itens[0]).id;
}

const chaveDoUltimo = (clientId: string) => `mesa:estudio:ultimo:${clientId}`;
function lerUltimo(clientId: string): string | null {
  try {
    return window.localStorage.getItem(chaveDoUltimo(clientId));
  } catch {
    return null;
  }
}
function gravarUltimo(clientId: string, id: string) {
  try {
    window.localStorage.setItem(chaveDoUltimo(clientId), id);
  } catch {
    /* sem localStorage: abre pelo primeiro de "A fazer" */
  }
}

function Rotulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-h-7 items-center">
      <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>
      {acao}
    </div>
  );
}

/** As cinco etapas da esteira, com a etapa do item em destaque. */
function EtapasDaEsteira({ atual }: { atual: number }) {
  return (
    <ol className="space-y-2.5" aria-label="Etapas da esteira">
      {ETAPAS_DA_ESTEIRA.map((e, i) => (
        <li key={e.chave} className="flex items-start">
          <span
            className={`mr-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
              i < atual ? "border-success bg-success/10 text-success" : i === atual ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
            }`}
          >
            {i < atual ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className={`block text-[12.5px] font-medium leading-tight ${i === atual ? "text-foreground" : "text-muted-foreground"}`}>{e.rotulo}</span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{e.dica}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Barra de ferramentas: ícones finos (com dica) que abrem o painel deslizante. */
function BarraDeFerramentas({
  ferramentas,
  ativa,
  onAbrir,
  marca,
  vertical,
}: {
  ferramentas: Ferramenta[];
  ativa: Ferramenta | null;
  onAbrir: (f: Ferramenta) => void;
  marca: (f: Ferramenta) => boolean;
  vertical: boolean;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <nav
        aria-label="Ferramentas"
        className={vertical ? "flex w-12 shrink-0 flex-col items-center border-l border-border py-2" : "flex min-w-0 overflow-x-auto border-t border-border px-2 py-1.5"}
      >
        {ferramentas.map((f) => {
          const def = FERRAMENTAS[f];
          const Icone = def.icone;
          const aberta = ativa === f;
          return (
            <Tooltip key={f}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onAbrir(f)}
                  aria-label={def.rotulo}
                  aria-pressed={aberta}
                  className={`relative flex shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    vertical ? "mb-1 h-10 w-10" : "mr-1 h-10 min-w-[64px] flex-col px-2"
                  } ${aberta ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                >
                  <Icone className="h-[18px] w-[18px]" />
                  {!vertical && <span className="mt-0.5 text-[10px] leading-none">{def.rotulo}</span>}
                  {marca(f) && <span className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${aberta ? "bg-primary-foreground" : "bg-primary"}`} aria-label="pede atenção" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side={vertical ? "left" : "top"} className="max-w-[240px]">
                <p className="text-[12px] font-medium">{def.rotulo}</p>
                <p className="text-[11.5px] text-muted-foreground">{def.dica}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

function DetalheDoItem({
  item,
  trabalho,
  arte,
  roteiro,
  temRoteiro,
  publicacaoDe,
  modo,
  foco = false,
  onFoco,
  rapida = null,
}: {
  item: ItemDoMes;
  trabalho: Trabalho | null;
  arte: ArteNaAgenda | null;
  roteiro: InfoDoRoteiro | null;
  temRoteiro: boolean;
  publicacaoDe: (postId: string) => PublicacaoDoPost | null;
  /** "colunas": altura fixa e rolagem por área; "pilha": a página rola. */
  modo: "colunas" | "pilha";
  /** Tela cheia (modo foco): o estúdio ocupa a janela. */
  foco?: boolean;
  onFoco?: (ligado: boolean) => void;
  /** Frente AE: arte rápida (sem item da Agenda): a barra mostra o pedido e a Entrega vira "Levar para a Agenda". */
  rapida?: ModoRapidoDoDetalhe | null;
}) {
  const controlesDaPauta = useContext(ControlesDaPauta);
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  // 02/10: na arte rápida, todo aviso diz de qual cliente é a arte.
  const avisoDaPeca = (t: string) => (rapida ? tituloDoAviso(t, mesa.clientName) : t);
  const { marca: marcaDaMesa } = useMarcaDaMesa();
  const semTipografia = useSemTipografia(clientId, marcaDaMesa);
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const avisarErro = useAvisarErro();
  const chave = `mesa:estudio:${item.id}`;
  const colunas = modo === "colunas";
  const ehDesign = !mesa.podeRecarregar;
  const [modeloImagem, setModeloImagem] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [legenda, setLegenda] = useState("");
  // Frente CPY: as variações da legenda escritas junto (o motor de copy já pôs a melhor no campo).
  const [opcoesDaLegenda, setOpcoesDaLegenda] = useState<OpcaoDaCopy[]>([]);
  const [hashtagsTexto, setHashtagsTexto] = useState("");
  const [salvandoLegenda, setSalvandoLegenda] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Frente EN: aprovado pelo cliente (pelo admin) sem data que sirva: a janela do "Agendar" abre preenchida.
  const [pedirData, setPedirData] = useState<AprovadaSemData | null>(null);
  const [aprovandoPeloCliente, setAprovandoPeloCliente] = useState(false);
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  // O andamento de cada lâmina (fila, gerando, ajustando, conferindo): a fonte do indicador único da prancheta.
  // Andamento do caminho antigo (sem a fila do servidor) e das ações diretas (ajustar, conferir).
  const [andamentoLocal, setAndamento] = useState<Record<number, AndamentoDaLamina>>({});
  const [emLote, setEmLote] = useState(false);
  const [pedidoAoDiretor, setPedidoAoDiretor] = useState("");
  const [salvandoContinuo, setSalvandoContinuo] = useState(false);
  const [versaoVista, setVersaoVista] = useState<number | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [refazendo, setRefazendo] = useState(false);
  const [reabrindo, setReabrindo] = useState(false);
  const [salvandoFormato, setSalvandoFormato] = useState(false);
  // Guardados na sessão: voltar de outra aba devolve a mesma lâmina, o mesmo painel e a mesma ferramenta.
  const [selecionado, setSelecionado] = useEstadoGuardado<number | null>(`${chave}:lamina`, null);
  const [painel, setPainel] = useEstadoGuardado<PainelDaLamina>(`${chave}:painel`, "direcao");
  const [ferramentaGuardada, setFerramenta] = useEstadoGuardado<Ferramenta | "">(`${chave}:ferramenta`, "lamina");
  const [refsAlvo, setRefsAlvo] = useEstadoGuardado<AlvoDasReferencias>(`${chave}:refs-alvo`, "lamina");
  const [refsAba, setRefsAba] = useEstadoGuardado<"cliente" | "banco">(`${chave}:refs-aba`, "cliente");
  // "Corrigir sozinho": desligado por padrão (24/09/2026: a correção automática triplicava o custo); guardado por trabalho na sessão.
  const [corrigirSozinho, setCorrigirSozinho] = useEstadoGuardado<boolean>(chaveDoCorrigirSozinho(trabalho ? trabalho.id : `item:${item.id}`), false);
  const parar = useRef(false);
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setModeloImagem(trabalho?.modelo_imagem_id || padraoPara(catalogo, "imagem")?.id || "");
    setQualidade((trabalho?.qualidade as Qualidade) || "media");
    setLegenda(trabalho?.legenda || "");
    setOpcoesDaLegenda([]);
    setHashtagsTexto(normalizarHashtags(trabalho?.hashtags || []).join(" "));
  }, [trabalho?.id, catalogo.length]);

  useEffect(() => { setLegenda(trabalho?.legenda || ""); }, [trabalho?.legenda]);
  useEffect(() => { setHashtagsTexto(normalizarHashtags(trabalho?.hashtags || []).join(" ")); }, [(trabalho?.hashtags || []).join(" ")]);

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "ajustes"] });
    // A aba Mês lê os mesmos trabalhos (agenda e artes do mês): sem isto ela
    // mostrava o estado de antes por até 2 minutos.
    void queryClient.invalidateQueries({ queryKey: ["mesa", "agenda-do-mes", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "artes-do-mes", clientId] });
    // Frente AE: o histórico da arte rápida lê os mesmos trabalhos.
    void queryClient.invalidateQueries({ queryKey: ["mesa", "arte-rapida", clientId] });
    mesa.atualizarCusto();
  };

  /**
   * Fila de geração no servidor (frente G, 26/09): o andamento vem do banco,
   * então tela cheia, outro card ou outro cliente não param nada; voltar
   * mostra o que andou. Sem a fila no ar, fica vazia e vale o caminho antigo.
   */
  const fila = useFilaDoTrabalho(trabalho?.id, {
    aoMudar: atualizar,
    aoFalhar: (i) => avisarErro(erroDoItem(i), `Lâmina ${i.ordem} não foi gerada`),
  });
  const andamento: Record<number, AndamentoDaLamina> = { ...fila.andamento, ...andamentoLocal };

  const diretor = padraoPara(catalogo, "diretor_arte");
  const leitor = padraoPara(catalogo, "leitura");
  const postUnico = FORMATOS_POST_UNICO.indexOf(item.delivery_type) >= 0;

  const guardarEscolha = async (campos: { modelo_imagem_id?: string; qualidade?: string }) => {
    if (!trabalho) return;
    const { error } = await (supabase as any).from("estudio_trabalhos").update(campos).eq("id", trabalho.id);
    if (error) toast.error("Escolha não salva", { description: textoDoErro(error) });
    else atualizar();
  };

  const partesConferir = (): ParteDaEstimativa[] => [
    { modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: TAMANHOS.leituraDoCard.saida },
  ];
  const partesGerar = (vezes = 1, q: Qualidade = qualidade): ParteDaEstimativa[] => partesDaLamina(modeloImagem, leitor?.id, q, vezes);
  const partesAjustar = (): ParteDaEstimativa[] => [
    { modeloId: leitor?.id, tipo: "texto", tokensEntrada: TAMANHOS.ajuste.entrada, tokensSaida: TAMANHOS.ajuste.saida },
    ...partesGerar(1),
  ];
  const partesDiretor = (): ParteDaEstimativa[] => [
    { modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida },
  ];
  /** Uma chamada do redator (modelo do diretor), do tamanho da legenda (enxugar o miolo usa só ela). */
  const partesRefinar = (): ParteDaEstimativa[] => [
    { modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida },
  ];
  /** Refinar texto: o redator e a conferência do motor de copy pelo Jev (frente CPY), que também é cobrada. */
  const partesDoRefinoConferido = (): ParteDaEstimativa[] => [...partesRefinar(), parteDaConferenciaDoJev()];

  /** Etapa nova da lâmina. O cronômetro só começa ao sair da fila e não recomeça entre etapas. */
  const marcar = (ordem: number, etapa: EtapaDaLamina, detalhe?: string) =>
    setAndamento((a) => {
      const antes = a[ordem];
      const desde = antes && antes.etapa !== "fila" && etapa !== "fila" ? antes.desde : Date.now();
      return { ...a, [ordem]: { etapa, desde, detalhe } };
    });
  const soltar = (ordem: number) => setAndamento((a) => semOrdem(a, ordem));

  /** Conferência de uma lâmina; é a última etapa: no fim a lâmina fica livre. */
  const conferir = async (trabalhoId: string, ordem: number) => {
    marcar(ordem, "conferindo");
    try {
      return await chamarFuncao<any>("estudio-arte", { acao: "conferir_card", trabalho_id: trabalhoId, ordem });
    } finally {
      soltar(ordem);
      atualizar();
    }
  };

  /**
   * Conferência depois de gerar ou ajustar, com a autocorreção antes de
   * mostrar (docs/mesa-ads/v2/CONTRATO-V2.md): confere; se a conferência achar
   * erro e "Corrigir sozinho" estiver ligado, corrige (corrigir_card) e confere
   * de novo, até 2 vezes. A lâmina fica velada até o fim e só então é
   * liberada. Soma o custo de todas as chamadas. Se a conferência não estiver
   * no ar, a versão fica "sem conferência".
   */
  const conferirDepois = async (trabalhoId: string, ordem: number, comecarCorrigindo: DecisaoDeAutocorrecao | null = null): Promise<number> => {
    const r = await conferirECorrigir({
      conferir: () => chamarFuncao<any>("estudio-arte", { acao: "conferir_card", trabalho_id: trabalhoId, ordem }),
      corrigir: (pedidoDaEquipe) =>
        chamarFuncao<any>("estudio-arte", { acao: "corrigir_card", trabalho_id: trabalhoId, ordem, pedido_da_equipe: pedidoDaEquipe || undefined }),
      corrigirSozinho,
      comecarCorrigindo,
      aoMudarEtapa: (etapa, detalhe) => {
        marcar(ordem, etapa, detalhe);
        if (etapa === "reconferindo") atualizar();
      },
    });
    soltar(ordem);
    atualizar();
    const e = r.falha;
    if (e && !(e instanceof ErroDaMesa && CODIGOS_QUE_NAO_PARAM_A_FILA.indexOf(e.codigo) >= 0)) {
      // O custo do que já rodou (conferência e correções) não se perde.
      avisarErro(e, r.rodadas ? `Lâmina ${ordem} corrigida, mas a conferência não terminou` : `Lâmina ${ordem} pronta, mas a conferência falhou`);
    } else if (!e && r.autocorrecao && r.autocorrecao.precisa) {
      toast.warning(
        r.rodadas ? `Lâmina ${ordem}: corrigida ${r.rodadas === 1 ? "1 vez" : `${r.rodadas} vezes`}, mas ainda com erro` : `Lâmina ${ordem}: a conferência achou erro`,
        { description: r.autocorrecao.motivos.join(" · ") },
      );
    }
    return r.custo_usd;
  };

  /** "Corrigir de novo": a equipe pede a correção com os motivos da última conferência. */
  const corrigirDeNovo = async (ordem: number) => {
    if (!trabalho) return { custo_usd: 0 };
    const ultima = ultimasVersoes(trabalho.cards || []).get(ordem);
    const v = ultima && ultima.verificacao;
    const decisao = v && !v.pendente && v.autocorrecao && v.autocorrecao.precisa ? v.autocorrecao : null;
    marcar(ordem, decisao ? "corrigindo" : "conferindo");
    return { custo_usd: await conferirDepois(trabalho.id, ordem, decisao) };
  };

  /** Gera uma lâmina. Com erro a lâmina fica livre; com sucesso segue para a conferência. */
  const gerarUma = async (trabalhoId: string, ordem: number): Promise<number> => {
    marcar(ordem, "gerando");
    let custoFundo = 0;
    /**
     * Contínuo: o fundo panorâmico nasce antes, numa chamada própria por
     * trecho (gerar_card nunca faz o trecho). Com trecho anterior faltando, o
     * servidor faz ele primeiro e devolve pendente: a tela repete até não
     * haver pendência, com limite pelo número de trechos. Outra geração
     * fazendo o mesmo trecho (409 fundo_em_andamento): espera, sem pagar de novo.
     */
    const prepararOFundo = async () => {
      const limite = limiteDePreparos(cardsDaDirecao.length);
      let esperas = 0;
      for (let vez = 0; vez < limite;) {
        marcar(ordem, "gerando", vez ? "Fundo contínuo: próximo trecho" : "Fundo contínuo");
        try {
          const f = await chamarFuncao<any>("estudio-arte", { acao: "preparar_fundo", trabalho_id: trabalhoId, ordem });
          custoFundo += custoDaResposta(f) || 0;
          vez++;
          if (!f || !f.pendente) {
            if (f && f.fundo) atualizar();
            return;
          }
          atualizar();
        } catch (e) {
          if (e instanceof ErroDaMesa && e.codigo === "fundo_em_andamento" && esperas < ESPERAS_DO_FUNDO) {
            esperas++;
            marcar(ordem, "gerando", "Esperando o fundo contínuo que outra geração está fazendo");
            await esperar(INTERVALO_DA_ESPERA_MS);
            continue;
          }
          throw e;
        }
      }
      throw new ErroDaMesa("fundo_pendente", "O fundo contínuo ainda não ficou pronto depois de várias tentativas. Gere a lâmina de novo.");
    };
    try {
      if (infinito) await prepararOFundo();
      marcar(ordem, "gerando");
      let g: any;
      try {
        g = await chamarFuncao<any>("estudio-arte", { acao: "gerar_card", trabalho_id: trabalhoId, ordem });
      } catch (e) {
        // O fundo foi refeito entre o preparo e a geração: prepara de novo, uma vez só.
        if (!(infinito && e instanceof ErroDaMesa && e.codigo === "fundo_pendente")) throw e;
        await prepararOFundo();
        marcar(ordem, "gerando");
        g = await chamarFuncao<any>("estudio-arte", { acao: "gerar_card", trabalho_id: trabalhoId, ordem });
      }
      atualizar();
      // Frente FS: a lâmina saiu, mas algo no caminho falhou e mudou a arte (fica também na lâmina).
      if (g && typeof g.aviso_da_acao === "string" && g.aviso_da_acao) toast.warning(avisoDaPeca(`Lâmina ${ordem} gerada com aviso`), { description: g.aviso_da_acao, duration: 12000 });
      return (custoDaResposta(g) || 0) + custoFundo;
    } catch (e) {
      soltar(ordem);
      throw e;
    }
  };

  /**
   * Conferência depois de a lâmina já estar gerada (e cobrada): se ela falha,
   * avisa sem derrubar a ação, que deu certo. Antes a geração inteira
   * aparecia como falha e a pessoa tendia a pagar de novo.
   */
  const conferirSemDerrubar = async (trabalhoId: string, ordem: number): Promise<number> => {
    try {
      return await conferirDepois(trabalhoId, ordem);
    } catch (e) {
      soltar(ordem);
      avisarErro(e, `Lâmina ${ordem} pronta, mas a conferência falhou`);
      return 0;
    }
  };

  /** Uma lâmina só (ferramenta Lâmina ou barrinha da prancheta): gera e confere em seguida. */
  const gerarEConferir = async (ordem: number) => {
    if (!trabalho) return { custo_usd: 0 };
    if (semTipografia) throw new ErroDaMesa("sem_tipografia", `${TEXTO_SEM_TIPOGRAFIA} antes de gerar.`);
    // Fila do servidor: segue mesmo trocando de tela ou de cliente. Sem ela, o caminho antigo.
    const naFila = await fila.enfileirar([ordem], corrigirSozinho);
    if (naFila) return { na_fila: naFila.itens.length };
    const custo = await gerarUma(trabalho.id, ordem);
    const custoConferencia = await conferirSemDerrubar(trabalho.id, ordem);
    return { custo_usd: custo + custoConferencia };
  };

  const cardsDaDirecao = (trabalho?.direcao?.cards || []).slice().sort((a, b) => a.ordem - b.ordem);
  const ultimas = ultimasVersoes(trabalho?.cards || []);
  const semImagem = cardsDaDirecao.filter((c) => !ultimas.has(c.ordem));
  // Lâminas da direção ATUAL com arte. ultimas.size contava também versões de
  // ordens que saíram (nova direção com menos lâminas): "7 de 5 com arte".
  const laminasComArte = cardsDaDirecao.length - semImagem.length;
  const filaDeGeracao = semImagem.length ? semImagem : cardsDaDirecao;
  const todosComImagem = cardsDaDirecao.length > 0 && semImagem.length === 0;
  const algoGerando = emLote || Object.keys(andamento).length > 0;
  const ocupado = algoGerando || entregando;
  // Formato do post (4:5, 3:4, 1:1 ou 9:16); o contínuo (panorama) só existe no 4:5.
  const formato: FormatoDoPost = formatoDoTrabalho(trabalho?.direcao as { formato?: unknown } | undefined);
  const proporcao = proporcaoDoFormato(formato);
  const continuoLigado = !!trabalho?.direcao?.carrossel_infinito;
  const infinito = continuoLigado && formato === "feed_4x5";
  // No contínuo, as lâminas dividem o mesmo panorama: enquanto uma gera,
  // refazer outra pediria o mesmo trecho de fundo duas vezes (cobra dobrado).
  const laminaOcupada = (ordem: number) => !!andamento[ordem] || entregando || (infinito && algoGerando);
  const progresso = cardsDaDirecao.length ? Math.round((laminasComArte / cardsDaDirecao.length) * 100) : 0;
  // Lâminas cuja versão atual nasceu em outro formato (a entrega recusa: gere de novo).
  const foraDoFormato = cardsDaDirecao.filter((c) => versaoForaDoFormato(ultimas.get(c.ordem) as { formato_post?: unknown } | undefined, formato)).map((c) => c.ordem);
  const entregue = !!trabalho && (trabalho.status === "entregue" || trabalho.entrega_status === "agendado");
  const estado: EstadoDoItem = cardsDaDirecao.length > 0 ? "producao" : arte && !refazendo ? "agenda" : "preparar";
  // No contínuo a ordem faz parte da cena (o panorama foi cortado nela): reordenar fica travado.
  const ordemTravada = infinito && cardsDaDirecao.length > 1;

  // Estimativa do contínuo: o panorama que falta entra no preço (mesma regra de
  // trechos do servidor; só com modelo que faz o panorama, GPT Image direto ou
  // pelo OpenRouter, e lâmina sem foto própria). Até 25/09 exigia provedor
  // openai e o padrão pelo OpenRouter desligava o contínuo sem aviso.
  const modeloDoFundo = catalogo.find((m) => m.id === modeloImagem);
  const comFundoContinuo = ordemTravada && modeloFazContinuo(modeloDoFundo);
  // Contínuo ligado com um modelo que não faz o panorama: a tela avisa (as lâminas saem uma a uma).
  const continuoSemModelo = ordemTravada && !!modeloDoFundo && !comFundoContinuo;
  const fundosProntos = (((trabalho?.direcao as any)?.panorama?.fundos ?? null) as Record<string, string> | null);
  const partesDoFundo = (ordens: number[], q: Qualidade = qualidade): ParteDaEstimativa[] => {
    if (!comFundoContinuo) return [];
    const comFundo = ordens.filter((o) => {
      const c = cardsDaDirecao.find((x) => x.ordem === o);
      return !!c && usaFundoContinuo(c);
    });
    return partesDoPanorama(comFundo, cardsDaDirecao.length, fundosProntos, modeloImagem, q);
  };
  /** Preço de gerar estas lâminas, cada uma na qualidade em que sai de fato (replicar referência sai em alta). */
  const partesGerarDas = (ordens: number[]): ParteDaEstimativa[] =>
    ordens.reduce((todas: ParteDaEstimativa[], o) => {
      const c = cardsDaDirecao.find((x) => x.ordem === o);
      const q = qualidadeNaGeracao(c, trabalho?.direcao?.referencias_ids, comFundoContinuo && !!c && usaFundoContinuo(c), qualidade);
      // Frente R5: lâmina acima do limite do papel ganha a chamada curta do redator ao gerar (mesma regra do servidor).
      const enxuga = !!c && precisaEnxugarNaGeracao({ card: c as unknown as LaminaDoTexto, total: cardsDaDirecao.length, capaComVersao: ultimas.has(1) });
      const redator: ParteDaEstimativa[] = enxuga ? [{ modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHO_DO_ENXUGAR.entrada, tokensSaida: TAMANHO_DO_ENXUGAR.saida }] : [];
      return todas.concat(partesGerar(1, q)).concat(redator);
    }, []);
  const ordensDaFila = filaDeGeracao.map((c) => c.ordem);
  const filaComFundo = partesDoFundo(ordensDaFila).length > 0;
  const precos = precosPorQualidade(
    modeloImagem,
    leitor?.id,
    catalogo,
    filaComFundo ? { laminas: ordensDaFila.length, partes: (q) => partesDoFundo(ordensDaFila, q) } : undefined,
  );
  /** Descrição do botão com a nota do fundo contínuo quando o preço inclui o panorama. */
  const comNotaDoFundo = (descricao: string, ordens: number[]) =>
    partesDoFundo(ordens).length ? `${descricao} ${NOTA_DO_FUNDO_CONTINUO}.` : descricao;

  // Lâmina escolhida: a guardada na sessão, se ainda existir; senão a primeira.
  useEffect(() => {
    if (!cardsDaDirecao.length) return;
    if (selecionado === null || !cardsDaDirecao.some((c) => c.ordem === selecionado)) setSelecionado(cardsDaDirecao[0].ordem);
  }, [trabalho?.id, cardsDaDirecao.length]);

  const cardSelecionado = cardsDaDirecao.find((c) => c.ordem === selecionado) || null;
  const ultimaDaEscolhida = cardSelecionado ? ultimas.get(cardSelecionado.ordem) : undefined;
  // Outra lâmina ou versão nova: a lâmina grande volta para a mais recente e as áreas somem.
  useEffect(() => { setVersaoVista(null); setAreas([]); }, [selecionado]);
  useEffect(() => { setVersaoVista(null); }, [ultimaDaEscolhida?.versao]);

  /**
   * Gerar várias: até 3 ao mesmo tempo (uma de cada vez no carrossel
   * contínuo). A conferência de cada lâmina roda em seguida, sem segurar a
   * próxima geração. Saldo, cota ou chave param tudo.
   */
  const gerarVarias = async (ordens: number[]) => {
    if (!trabalho) return { custo_usd: 0 };
    if (semTipografia) throw new ErroDaMesa("sem_tipografia", `${TEXTO_SEM_TIPOGRAFIA} antes de gerar.`);
    // Fila do servidor (frente G): o pedido vira trabalho no banco e a função
    // gera em segundo plano (até 2 por trabalho, 1 no contínuo; custo e
    // carteira por lâmina, como antes). Sem a fila no ar, o laço antigo abaixo.
    const naFila = await fila.enfileirar(ordens, corrigirSozinho);
    if (naFila) return { na_fila: naFila.itens.length };
    parar.current = false;
    setEmLote(true);
    const agora = Date.now();
    setAndamento((a) => {
      const n = { ...a };
      for (const o of ordens) if (!n[o]) n[o] = { etapa: "fila", desde: agora };
      return n;
    });
    const limite = infinito ? 1 : EM_PARALELO;
    // Frente T2: sem capa ainda, ela vai sozinha primeiro (a âncora tipográfica da série); depois as outras.
    const capaPrimeiro = ordens.length > 1 && ordens.indexOf(1) >= 0 && !ultimas.has(1);
    if (capaPrimeiro) ordens = [1].concat(ordens.filter((o) => o !== 1));
    // Com a capa primeiro, o primeiro trabalhador para depois dela; depois o teto é a lista inteira.
    let teto = capaPrimeiro ? 1 : ordens.length;
    let proximo = 0;
    let total = 0;
    const falhas: unknown[] = [];
    const conferencias: Promise<number>[] = [];
    const trabalhador = async () => {
      while (proximo < ordens.length && !parar.current) {
        if (proximo >= teto) break;
        const ordem = ordens[proximo++];
        try {
          // Soma só depois do await: somar com o await na mesma linha lia o valor de
          // antes e os trabalhadores em paralelo apagavam o custo um do outro.
          const custo = await gerarUma(trabalho.id, ordem);
          total += custo;
          conferencias.push(conferirSemDerrubar(trabalho.id, ordem));
        } catch (e) {
          falhas.push(e);
          if (e instanceof ErroDaMesa && CODIGOS_QUE_PARAM_TUDO.indexOf(e.codigo) >= 0) parar.current = true;
        }
      }
    };
    try {
      if (capaPrimeiro) {
        await trabalhador();
        teto = ordens.length;
      }
      await Promise.all(Array.from({ length: Math.min(limite, ordens.length) }, trabalhador));
      const custosConferencia = await Promise.all(conferencias);
      total += custosConferencia.reduce((s, v) => s + v, 0);
    } finally {
      setEmLote(false);
      // Parou no meio: quem ficou na fila sai dela.
      setAndamento((a) => {
        const n: Record<number, AndamentoDaLamina> = {};
        for (const k of Object.keys(a)) if (a[Number(k)].etapa !== "fila") n[Number(k)] = a[Number(k)];
        return n;
      });
      atualizar();
    }
    if (falhas.length) {
      avisarErro(falhas[0], falhas.length === 1 ? "Uma lâmina não foi gerada" : `${falhas.length} lâminas não foram geradas`);
    }
    return { custo_usd: total, parado: parar.current };
  };

  /** Primeiro posto: a direção com as escolhas feitas antes (modo, quantidade, contínuo e pedido). */
  const preparar = async (escolhas: EscolhasDoPreparo) => {
    const corpoDoPedido = corpoDoPreparar(item.id, escolhas, { postUnico, modeloImagemId: modeloImagem || undefined, qualidade });
    // Arte rápida: o trabalho vai junto (a função refaz a direção pelo pedido guardado, sem item da Agenda).
    if (rapida && trabalho) corpoDoPedido.trabalho_id = trabalho.id;
    const r = await chamarFuncao<any>("estudio-arte", corpoDoPedido);
    // Frente R3: lâminas longas chegam enxutas (uma chamada curta); a tela diz quantas.
    const enxuto = textoDoMioloEnxuto(r);
    // Frente R5: a lâmina que ainda passa do limite e tem mais de uma ideia pode ser dividida em 2 (ferramenta Lâmina).
    const aviso = [enxuto, textoDaSugestaoDeDividir(r && r.dividir_em_duas)].filter(Boolean).join(" ") || null;
    if (escolhas.modo === "roteiro") {
      toast.success("Direção montada do roteiro", { description: aviso ? `${aviso} Confira na prancheta e gere.` : "Sem custo de IA. Confira as lâminas na prancheta e gere." });
    } else if (aviso) {
      toast.info(aviso);
    }
    return r;
  };
  const aoPreparar = () => {
    setRefazendo(false);
    setFerramenta("lamina");
    setPainel("direcao");
    atualizar();
  };

  /** Ajuste da lâmina: livre, por áreas (frações 0 a 1) ou só o fundo. */
  const ajustar = async (ordem: number, instrucao: string, opcoes: OpcoesDoAjuste = {}) => {
    if (!trabalho) return { custo_usd: 0 };
    marcar(ordem, "ajustando");
    let custo = 0;
    try {
      const a = await chamarFuncao<any>("estudio-arte", {
        acao: "ajustar_card",
        trabalho_id: trabalho.id,
        ordem,
        instrucao,
        areas: opcoes.areas && opcoes.areas.length ? opcoes.areas : undefined,
        tipo: opcoes.tipo,
        imagem_id: opcoes.imagem_id,
        // Frente RO, fase 2: imagens anexadas com o papel e a proposta aplicada (pedido vago).
        ...(opcoes.anexos && opcoes.anexos.length ? { anexos: opcoes.anexos } : {}),
        ...(opcoes.confirmado ? { confirmado: true } : {}),
      });
      atualizar();
      custo = custoDaResposta(a) || 0;
      // Frente FS: ajuste feito, mas algo no caminho falhou e mudou a arte (fica também na lâmina).
      if (a && typeof a.aviso_da_acao === "string" && a.aviso_da_acao) toast.warning(`Lâmina ${ordem} ajustada com aviso`, { description: a.aviso_da_acao, duration: 12000 });
    } catch (e) {
      soltar(ordem);
      throw e;
    }
    const custoConferencia = await conferirSemDerrubar(trabalho.id, ordem);
    return { custo_usd: custo + custoConferencia };
  };

  /** Grava escolhas sem custo no trabalho (referências, fotos, texto, contínuo). */
  const configurar = async (corpo: Record<string, unknown>) => {
    if (!trabalho) return;
    const r = await chamarFuncao<{ trabalho?: TrabalhoGravado }>("estudio-arte", { acao: "configurar", trabalho_id: trabalho.id, ...corpo });
    // A escolha aparece na lâmina na hora; a releitura da lista vem depois, só para confirmar.
    gravarTrabalhoNoCache(queryClient, clientId, r && r.trabalho);
    atualizar();
  };

  /**
   * "Reabrir para corrigir" (pedido do dono em 25/09): o trabalho entregue volta
   * para edição com as mesmas lâminas e versões; a próxima entrega é arquivo novo.
   */
  const reabrir = async () => {
    if (!trabalho) return;
    setReabrindo(true);
    try {
      const r = await chamarFuncao<{ trabalho?: TrabalhoGravado; aviso?: string | null }>("estudio-arte", corpoDoReabrir(trabalho.id));
      gravarTrabalhoNoCache(queryClient, clientId, r && r.trabalho);
      toast.success("Trabalho reaberto para corrigir", {
        description: (r && r.aviso) || "Ajuste as lâminas, fotos e referências e entregue de novo: vira arquivo novo.",
      });
      setFerramenta("lamina");
      atualizar();
    } catch (e) {
      avisarErro(e, "Não foi possível reabrir");
    } finally {
      setReabrindo(false);
    }
  };

  /** Formato do post para o conjunto inteiro; as versões antigas ficam, a entrega pede gerar de novo as de outro formato. */
  const mudarFormato = async (f: FormatoDoPost) => {
    if (!trabalho || f === formato) return;
    setSalvandoFormato(true);
    try {
      await configurar({ conjunto: { formato: f } });
      toast.success("Formato do post mudou", {
        description: [
          laminasComArte ? "Gere as lâminas de novo para sair no formato novo." : "",
          continuoLigado && f !== "feed_4x5" ? AVISO_CONTINUO_FORA_DO_4X5 : "",
        ].filter(Boolean).join(" ") || undefined,
      });
    } catch (e) {
      avisarErro(e, "Formato não salvo");
    } finally {
      setSalvandoFormato(false);
    }
  };

  /** Tira da lâmina uma foto trazida ou uma referência própria, direto da faixa em cima da lâmina grande. */
  const tirarDaLamina = async (ordem: number, corpo: Record<string, unknown>, rotulo: string) => {
    try {
      await configurar({ card: { ordem, ...corpo } });
      toast.success(rotulo);
    } catch (e) {
      avisarErro(e, "Não foi possível tirar");
    }
  };

  // Frente RO: "Foto exata" ou "Usar o rosto" por foto da lâmina (vale na próxima geração; as versões ficam).
  // Frente RO, fase 2: a janela do Agendar aberta por um passo do plano do diretor.
  const [agendarDoPlano, setAgendarDoPlano] = useState<{ fim: (feito: boolean) => void } | null>(null);

  const trocarUsoDaFoto = async (card: CardDaDirecao, alvo: { acervo: true } | { caminho: string }, uso: "exata" | "rosto") => {
    try {
      if ("acervo" in alvo) await configurar({ card: { ordem: card.ordem, uso_do_acervo: uso } });
      else {
        const fotos = (card.fotos_livres || []).map((f) => (f.caminho === alvo.caminho ? { ...f, uso, uso_por: "equipe" as const } : f));
        await configurar({ card: { ordem: card.ordem, fotos_livres: fotos } });
      }
      toast.success(uso === "rosto" ? "Usar o rosto" : "Foto exata", {
        description: uso === "rosto" ? "Na próxima geração, uma cena nova com a mesma pessoa." : "Na próxima geração, a foto entra como está.",
      });
    } catch (e) {
      avisarErro(e, "Não foi possível trocar o uso da foto");
    }
  };

  const refazerFundo = async () => {
    setSalvandoContinuo(true);
    try {
      await configurar({ conjunto: { refazer_fundo: true } });
      toast.success("Fundo contínuo apagado", { description: "Gere as lâminas de novo, em ordem: o panorama nasce outra vez." });
    } catch (e) {
      avisarErro(e, "Não foi possível refazer o fundo");
    } finally {
      setSalvandoContinuo(false);
    }
  };

  const alternarContinuo = async (valor: boolean) => {
    setSalvandoContinuo(true);
    try {
      await configurar({ conjunto: { carrossel_infinito: valor } });
      toast.success(valor ? "Carrossel contínuo ligado" : "Carrossel contínuo desligado", {
        description: ultimas.size ? "Gere as lâminas de novo para a arte seguir a nova forma." : undefined,
      });
    } catch (e) {
      avisarErro(e, "Não foi possível mudar");
    } finally {
      setSalvandoContinuo(false);
    }
  };

  /** Nova ordem das lâminas: renumera a direção e as versões já geradas juntas. */
  const reordenar = async (novas: number[]) => {
    if (!trabalho) return;
    if (ordemTravada) {
      toast.error("Ordem travada", { description: AVISO_DA_ORDEM_NO_CONTINUO });
      return;
    }
    const ok = await confirmar({
      title: "Mudar a ordem das lâminas?",
      description: "A primeira vira capa e a última vira o fechamento. As artes já geradas acompanham a lâmina.",
      confirmLabel: "Mudar ordem",
    });
    if (!ok) return;
    const mapa: Record<number, number> = {};
    novas.forEach((antiga, i) => { mapa[antiga] = i + 1; });
    const total = novas.length;
    const cards = cardsDaDirecao
      .map((c) => {
        const ordem = mapa[c.ordem];
        const funcao = ordem === 1 ? "capa" : ordem === total && total > 1 ? "cta" : "conteudo";
        return { ...c, ordem, funcao };
      })
      .sort((a, b) => a.ordem - b.ordem);
    const versoes = (trabalho.cards || []).map((v) => ({ ...v, ordem: mapa[v.ordem] || v.ordem }));
    const { data: gravadas, error } = await (supabase as any)
      .from("estudio_trabalhos")
      .update({ direcao: { ...trabalho.direcao, cards }, cards: versoes })
      .eq("id", trabalho.id)
      .eq("atualizado_em", trabalho.atualizado_em)
      .select("id");
    if (error) toast.error("Ordem não salva", { description: textoDoErro(error) });
    else if (!Array.isArray(gravadas) || gravadas.length === 0) {
      // O trabalho mudou desde que a tela leu (outra ação, outra aba): nada foi gravado.
      toast.error("Ordem não salva", { description: "O trabalho mudou enquanto isso. A tela foi relida; mude a ordem de novo." });
      atualizar();
    } else {
      if (selecionado !== null && mapa[selecionado]) setSelecionado(mapa[selecionado]);
      atualizar();
    }
  };

  const hashtags = normalizarHashtags(hashtagsTexto.replace(/[,\n]/g, " ").split(" "));
  const hashtagsSalvas = normalizarHashtags(trabalho?.hashtags || []);
  const legendaMudou = legenda !== (trabalho?.legenda || "") || hashtags.join(" ") !== hashtagsSalvas.join(" ");

  /** Grava legenda e hashtags. Ao sair do campo grava sozinha, sem aviso. Devolve se gravou. */
  const salvarLegenda = async (silencioso = false): Promise<boolean> => {
    if (!trabalho) return false;
    setSalvandoLegenda(true);
    const { error } = await (supabase as any)
      .from("estudio_trabalhos")
      .update({ legenda: legenda.trim() || null, hashtags })
      .eq("id", trabalho.id);
    setSalvandoLegenda(false);
    if (error) {
      toast.error("Legenda não salva", { description: textoDoErro(error) });
      return false;
    }
    if (!silencioso) toast.success("Legenda salva");
    atualizar();
    return true;
  };
  const salvarAoSair = () => {
    if (legendaMudou && !salvandoLegenda && !entregue) void salvarLegenda(true);
  };

  const copiar = async (texto: string, rotulo: string) => {
    if (!texto.trim()) {
      toast.error("Nada para copiar ainda");
      return;
    }
    const ok = await copiarTexto(texto);
    if (ok) toast.success(rotulo);
    else toast.error("Não foi possível copiar", { description: "Selecione o texto e copie à mão." });
  };

  /** A janela do "Agendar" para esta peça, com a data proposta (frente EN). */
  const janelaDeData = (r: ResultadoDaEntrega): AprovadaSemData | null =>
    trabalho
      ? {
          id: trabalho.id,
          task_id: item.id,
          // Logo depois de entregar, o trabalho da tela ainda não tem os arquivos: a janela só usa a quantidade (post ou carrossel).
          file_ids:
            trabalho.file_ids && trabalho.file_ids.length
              ? trabalho.file_ids
              : Array.from({ length: Math.max(1, (trabalho.direcao?.cards || []).length) }, (_, i) => `lamina-${i + 1}`),
          post_id: trabalho.post_id || null,
          aprovado_em: new Date().toISOString(),
          publicar_em: r.publicarEm || trabalho.publicar_em || null,
          entrega_aviso: r.motivo || null,
          titulo: item.title,
          dia: item.due_date || null,
          project_id: item.project_id || null,
        }
      : null;

  /** Depois da entrega com opção: aviso certo e, sem data, a pergunta da data. */
  const depoisDaEntrega = (r: ResultadoDaEntrega) => {
    if (!r.ok) {
      setErroDoEnvio(r.erro || null);
      toast.error("A entrega não terminou", { description: r.erro });
      return;
    }
    if (r.modo === "aprovacao") {
      toast.success(ehDesign ? "Entregue e enviado para a revisão da agência" : "Entregue e enviado para aprovação");
    } else if (r.modo === "arquivos") {
      toast.success("Entregue em Arquivos", { description: r.mostradoAoCliente ? "O cliente já vê em Arquivos. Não vai para a Agenda." : "Sem aprovação e sem post na Agenda." });
    } else if (r.agendadoPara) {
      toast.success("Aprovado pelo cliente e agendado", { description: `Vai ao ar ${dataEHora(r.agendadoPara)}.` });
    } else {
      toast.success("Aprovado pelo cliente", { description: r.motivo || "Escolha a data para agendar." });
      setPedirData(janelaDeData(r));
    }
    void queryClient.invalidateQueries({ queryKey: chaveDasAprovadasSemData(clientId) });
    void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
  };

  /**
   * Entrega em Arquivos no modo escolhido (frente EN): pronto para agendar
   * (aprova pelo cliente e agenda), enviar para aprovação (o de sempre) ou só
   * Arquivos (sem post, e o cliente vê se marcado).
   */
  const entregar = async (modo: ModoDeEntrega, mostrarAoCliente = false) => {
    if (!trabalho) return;
    setEntregando(true);
    setErroDoEnvio(null);
    try {
      // Legenda que não gravou: não entrega com a legenda antiga do banco.
      if (legendaMudou && !(await salvarLegenda(true))) return;
      // AB2: carrossel grande entrega em partes (limite de CPU); a tela continua sozinha.
      const r = await entregarComModo(trabalho.id, modo, { mostrarAoCliente });
      depoisDaEntrega(r);
      atualizar();
      void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    } catch (e) {
      avisarErro(e, "Não foi possível entregar");
    } finally {
      setEntregando(false);
    }
  };

  /** Já entregue e esperando: o admin aprova pelo cliente e agenda (a mesma opção 1, sem entregar de novo). */
  const aprovarPeloClienteAgora = async () => {
    if (!trabalho) return;
    const ok = await confirmar({
      title: "Aprovar pelo cliente?",
      description: `O cliente deu o aval para "${item.title}". Fica no histórico dele como aprovado por você, em nome dele, e já agenda na data do conteúdo.`,
      confirmLabel: "Aprovar e agendar",
    });
    if (!ok) return;
    setAprovandoPeloCliente(true);
    setErroDoEnvio(null);
    try {
      depoisDaEntrega(await entregarComModo(trabalho.id, "pronto"));
      atualizar();
    } finally {
      setAprovandoPeloCliente(false);
    }
  };

  /** Depois de entregar: o envio para aprovação, no mesmo lugar. */
  const enviarAgora = async () => {
    if (!trabalho) return;
    setEnviando(true);
    setErroDoEnvio(null);
    try {
      await enviarUmParaAprovacao(trabalho.id);
      toast.success(ehDesign ? "Revisão da agência pedida" : "Enviado para aprovação");
      atualizar();
      void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    } catch (e) {
      setErroDoEnvio(textoDoErro(e));
      toast.error("Não foi possível enviar", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  // Ferramentas do estado do item; a guardada vale se existir neste estado, senão abre a primeira dele. Fechada ("") fica fechada.
  const ferramentas = FERRAMENTAS_DO_ESTADO[estado];
  const ferramenta: Ferramenta | null = !ferramentaGuardada
    ? null
    : ferramentas.indexOf(ferramentaGuardada as Ferramenta) >= 0
      ? (ferramentaGuardada as Ferramenta)
      : ferramentas[0];

  /** Abre a ferramenta (o mesmo ícone fecha). No celular, o painel fica embaixo e a tela desce até ele. */
  const abrirFerramenta = (f: Ferramenta, alternar = true) => {
    const fechar = alternar && ferramenta === f;
    setFerramenta(fechar ? "" : f);
    if (!colunas && !fechar) window.setTimeout(() => rolarAte(painelRef.current, "start"), 60);
  };

  // Veio da Mesa Foto ("Usar na Mesa": &fotos=<ids>): abre a ferramenta Fotos, onde elas aparecem.
  // Antes abria na ferramenta Lâmina e as fotos ficavam escondidas (dono, 25/09: "não tem aqui").
  const [parametros] = useSearchParams();
  const fotosNaUrl = (parametros.get("fotos") || "").trim();
  useEffect(() => {
    if (fotosNaUrl && estado === "producao") abrirFerramenta("fotos", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fotosNaUrl, estado]);

  const abrirPainel = (ordem: number, p: PainelDaLamina) => {
    setSelecionado(ordem);
    setPainel(p);
    abrirFerramenta("lamina", false);
  };

  /**
   * Clique simples na prancheta: só escolhe a lâmina. O ajuste livre e as
   * versões voltam ao topo da ferramenta (sem rolar sozinho a cada clique);
   * a marcação de área e a troca de fundo continuam, para seguir lâmina a lâmina.
   */
  const escolherLamina = (ordem: number) => {
    setSelecionado(ordem);
    if (painel === "livre" || painel === "versoes") setPainel("direcao");
  };

  // Frente EA: pedido de ajuste do cliente (portal) no MESMO trabalho. Abrir
  // pela Agenda, pelo aviso ou pela Entrega leva à lâmina citada, com o pedido
  // já no campo do ajuste livre (ou no pedido ao diretor, sem lâmina): o dono
  // só confere e aperta Ajustar. Nada é gerado sozinho.
  const pedidoDoCliente =
    trabalho && trabalho.entrega_status === "reprovado" && trabalho.status !== "entregue"
      ? pedidoDeAjustePendente(trabalho.ajustes_do_cliente) ||
        (trabalho.entrega_aviso ? { texto: trabalho.entrega_aviso, lamina: laminaCitada(trabalho.entrega_aviso) } : null)
      : null;
  const laminaDoPedido = (() => {
    const daUrl = parametros.get("ajuste") === "cliente" ? Number(parametros.get("lamina") || "") : 0;
    const n = daUrl > 0 ? daUrl : pedidoDoCliente?.lamina || 0;
    return n > 0 && cardsDaDirecao.some((c) => c.ordem === n) ? n : null;
  })();
  const [instrucaoDoCliente, setInstrucaoDoCliente] = useState<{ ordem: number; texto: string } | null>(null);
  const pedidoAplicado = useRef("");
  const aplicarPedidoDoCliente = () => {
    if (!pedidoDoCliente?.texto) return;
    const texto = `Pedido do cliente: ${pedidoDoCliente.texto}`;
    if (laminaDoPedido) {
      setInstrucaoDoCliente({ ordem: laminaDoPedido, texto });
      abrirPainel(laminaDoPedido, "livre");
    } else {
      setPedidoAoDiretor(texto);
    }
  };
  useEffect(() => {
    const chaveDoPedido = pedidoDoCliente?.texto && trabalho ? `${trabalho.id}:${pedidoDoCliente.texto}` : "";
    if (!chaveDoPedido || pedidoAplicado.current === chaveDoPedido || !cardsDaDirecao.length) return;
    pedidoAplicado.current = chaveDoPedido;
    aplicarPedidoDoCliente();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trabalho?.id, pedidoDoCliente?.texto, cardsDaDirecao.length]);

  // Ver grande: todas as lâminas com arte; a escolhida na versão que está na tela.
  const paraAmpliar: { ordem: number; imagem: ImagemAmpliavel }[] = cardsDaDirecao
    .filter((c) => ultimas.has(c.ordem))
    .map((c) => {
      const lista = (trabalho?.cards || []).filter((v) => v.ordem === c.ordem);
      const vista = c.ordem === selecionado && versaoVista !== null ? lista.find((v) => v.versao === versaoVista) || ultimas.get(c.ordem)! : ultimas.get(c.ordem)!;
      return { ordem: c.ordem, imagem: { caminho: vista.storage_path, titulo: `Lâmina ${c.ordem} · v${vista.versao}`, proporcao } };
    });
  const ampliarLamina = (ordem: number) => {
    const i = paraAmpliar.findIndex((a) => a.ordem === ordem);
    if (i >= 0) setAmpliada(i);
  };

  const situacao = situacaoDoItem(trabalho, arte, temRoteiro);
  const publicacao = trabalho?.post_id ? publicacaoDe(trabalho.post_id) : arte && arte.post_id ? publicacaoDe(arte.post_id) : null;
  const linkAgendaDoItem = trabalho?.post_id
    ? linkDaAgenda(clientId, trabalho.post_id, publicacao?.scheduled_at || trabalho.agendado_para)
    : arte && arte.post_id
      ? linkDaAgenda(clientId, arte.post_id, publicacao?.scheduled_at)
      : null;
  const desenhandoAreas = estado === "producao" && ferramenta === "lamina" && painel === "areas" && !!ultimaDaEscolhida;
  const prontoParaEntregar = todosComImagem && !entregue;
  const opcoesDeImagem = modelosAtivos(catalogo, "imagem");

  const marcaNaFerramenta = (f: Ferramenta) =>
    (f === "entrega" && (prontoParaEntregar || faltaEnviar(trabalho))) || (f === "legenda" && todosComImagem && !legenda.trim() && !entregue);

  // ---------------------------------------------------------------- barra do item

  // Frente AE-2 (dono, 28/09: "menos poluição"): a qualidade num seletor compacto, com o preço de cada uma.
  const seletorDeQualidade = (
    <div className="shrink-0" title={filaComFundo ? NOTA_DO_FUNDO_CONTINUO : undefined}>
      <SeletorDeQualidadeCompacto
        valor={qualidade}
        precos={precos}
        nota={filaComFundo ? NOTA_DO_FUNDO_CONTINUO.toLowerCase() : undefined}
        disabled={emLote}
        onMudar={(q) => { setQualidade(q); void guardarEscolha({ qualidade: q }); }}
      />
    </div>
  );

  const seletorDeGerador = (
    <div className="w-[128px] min-w-0 shrink-0">
      <Select value={modeloImagem || ""} onValueChange={(id) => { setModeloImagem(id); void guardarEscolha({ modelo_imagem_id: id }); }} disabled={emLote || opcoesDeImagem.length === 0}>
        <SelectTrigger className="h-8 min-w-0 text-[12px]" aria-label="Gerador de imagem" title="Gerador de imagem">
          <SelectValue placeholder={opcoesDeImagem.length ? "Gerador" : "Sem gerador"} />
        </SelectTrigger>
        <SelectContent>
          {opcoesDeImagem.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {nomeDoModelo(m)} <span className="text-muted-foreground">· {precoDoModelo(m, qualidade)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  // Frente AE-3 (dono, 28/09): "Corrigir sozinho" vira uma chave pequena com ícone; a explicação vai para o "?".
  const chaveCorrigirSozinho = (
    <div className="inline-flex h-8 shrink-0 items-center" data-corrigir-sozinho={corrigirSozinho ? "ligado" : "desligado"}>
      <ShieldCheck className={`mr-1.5 h-3.5 w-3.5 shrink-0 ${corrigirSozinho ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true" />
      <Switch
        id={`corrigir-sozinho-${item.id}`}
        checked={corrigirSozinho}
        onCheckedChange={(v) => setCorrigirSozinho(v === true)}
        aria-label="Corrigir sozinho"
        data-compacto=""
      />
      <label htmlFor={`corrigir-sozinho-${item.id}`} className="ml-1.5 cursor-pointer whitespace-nowrap text-[12px] text-muted-foreground">
        Corrigir sozinho
      </label>
      <AjudaRecolhida className="ml-0.5" rotulo="O que faz o Corrigir sozinho">
        Depois de gerar ou ajustar, se a conferência achar erro de texto, logo ou identidade, o estúdio corrige sozinho (até 2 vezes) antes de mostrar a lâmina. Cada correção custa um ajuste a mais. Desligado é o padrão.
      </AjudaRecolhida>
    </div>
  );

  /** Pedido do dono (24/09): o diretor de arte à mão, para conversar sobre estilo, cenário e luz. */
  const botaoDoDiretor = (
    <Button
      type="button"
      size="sm"
      variant={ferramenta === "diretor" ? "secondary" : "ghost"}
      className="h-8 shrink-0 gap-1 px-2 text-[12px]"
      onClick={() => abrirFerramenta("diretor")}
      aria-pressed={ferramenta === "diretor"}
      aria-label="Conversar com o diretor"
      title="Converse com o diretor de arte para mudar o estilo, o cenário, a luz ou as cores. Ele lê o conteúdo e propõe mudanças que você aplica com um clique."
    >
      <MessageSquare className="h-3.5 w-3.5" /> Diretor
    </Button>
  );

  const acaoPrincipal = (
    <div className="flex shrink-0 items-center">
      {emLote || fila.ativos.length > 0 ? (
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => { parar.current = true; if (fila.ativos.length) void fila.cancelar().catch((e) => avisarErro(e, "Não foi possível parar")); }} title="Para depois das lâminas que já estão gerando">
          <Square className="mr-1 h-3.5 w-3.5" /> Parar
        </Button>
      ) : (
        <BotaoComCusto
          rotulo={
            <>
              {semImagem.length ? <Wand2 className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {semImagem.length
                ? semImagem.length === cardsDaDirecao.length
                  ? `Gerar todas (${semImagem.length})`
                  : `Gerar ${semImagem.length}`
                : "Refazer todas"}
            </>
          }
          titulo={semImagem.length && semImagem.length < cardsDaDirecao.length ? `Gerar as ${semImagem.length} lâmina(s) que faltam` : `Gerar ${filaDeGeracao.length} lâmina(s)`}
          descricao={infinito
            ? comNotaDoFundo("Carrossel contínuo: uma lâmina de cada vez, porque cada uma continua a anterior. A conferência roda logo depois de cada uma.", ordensDaFila)
            : corrigirSozinho
              ? "Até 3 lâminas ao mesmo tempo. A conferência de ortografia e identidade roda logo depois de cada uma e, se achar erro, o estúdio corrige sozinho (até 2 vezes) antes de mostrar. Cada correção custa um ajuste a mais."
              : "Até 3 lâminas ao mesmo tempo. A conferência de ortografia e identidade roda logo depois de cada uma."}
          fecharAoConfirmar
          variant={semImagem.length ? "default" : "outline"}
          className="h-8 gap-1 px-3 text-[12.5px]"
          disabled={ocupado || entregue || semTipografia}
          partes={() => partesGerarDas(ordensDaFila).concat(partesDoFundo(ordensDaFila))}
          executar={() => gerarVarias(filaDeGeracao.map((c) => c.ordem))}
          aoConcluir={(data) => {
            if (data && typeof data.na_fila === "number") {
              toast.info(avisoDaPeca(data.na_fila ? "Gerando no servidor" : "Essas lâminas já estavam na fila"), {
                description: "Pode trocar de tela ou de cliente: a geração continua. O custo sai por lâmina, na carteira do cliente.",
              });
              return;
            }
            toast.success(avisoDaPeca(data?.parado ? "Geração parada" : "Lâminas geradas"), { description: `Custo real: ${usd(custoDaResposta(data) || 0)}.` });
          }}
        />
      )}
      {prontoParaEntregar && !emLote && (
        <Button type="button" size="sm" className="ml-2 h-8 gap-1 px-3 text-[12.5px]" onClick={() => abrirFerramenta("entrega", false)} title="Abre a ferramenta Entrega">
          <Send className="h-3.5 w-3.5" /> Entregar
        </Button>
      )}
    </div>
  );

  // Frente AE-3 (dono, 28/09: "uma linha no computador, duas no máximo em telas menores, sem cartão em volta"):
  // o item, os ajustes da geração, a ação principal e a tela cheia (só o ícone) numa faixa só, que quebra
  // em duas quando não cabe. Nenhuma função saiu: a explicação de cada chave está no "?" ou na dica.
  const barraDoItem = (
    <div className="shrink-0 border-b border-primary">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 py-1.5" data-barra-do-item="">
        <div className="flex min-w-[140px] flex-1 basis-[150px] items-center">
          {temRoteiro && (
            <span title={DICA_DO_ROTEIRO} className="mr-1.5 shrink-0">
              <Star className="h-4 w-4 fill-warning text-warning" aria-label={DICA_DO_ROTEIRO} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-semibold leading-tight" title={item.title}>{item.title}</h2>
            <p className="mt-0.5 flex min-w-0 items-center text-[11px] text-muted-foreground">
              <span className="truncate">{rapida ? rapida.subtitulo : <>{dataCurta(item.due_date)} · {formatoDoItem(item)}</>}</span>
              <SeloDoItem tom={situacao.tom} className="ml-2 shrink-0">{situacao.rotulo}</SeloDoItem>
              {trabalho && trabalho.custo_usd > 0 && (
                <span className="ml-2 shrink-0 tabular-nums" title="Gasto de IA neste item">{usd(trabalho.custo_usd)}</span>
              )}
            </p>
          </div>
        </div>
        {/* Os ajustes da geração, do mesmo tamanho (h-8), lado a lado. */}
        {estado === "producao" && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" data-ajustes-da-geracao="">
            <div className="shrink-0" title="Formato do post (vale para todas as lâminas)">
              <SeletorDeFormatoCompacto valor={formato} onMudar={(f) => void mudarFormato(f)} disabled={salvandoFormato || algoGerando || entregue} />
            </div>
            {seletorDeQualidade}
            {seletorDeGerador}
            {botaoDoDiretor}
            <Popover>
              <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Ajustes da geração" title="Correção automática e estilo do cliente"><SlidersHorizontal className="h-4 w-4" /></Button></PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3">
                <p className="text-[13px] font-semibold">Ajustes da geração</p>
                {chaveCorrigirSozinho}
                {trabalho && <BotaoDoEstilo compacto trabalhoIds={[trabalho.id]} modeloImagemId={modeloImagem || null} className="shrink-0" />}
              </PopoverContent>
            </Popover>
          </div>
        )}
        {controlesDaPauta}
        {estado === "producao" && acaoPrincipal}
        {/* Frente AP: arte entregue → Agendar (data do conteúdo, perfil e se vai postar), só admin e gestor. */}
        {trabalho && <AgendarDoEstudio trabalho={trabalho} item={item} className="shrink-0 px-2.5" />}
        {trabalho && agendarDoPlano && (
          <JanelaDaAprovada
            peca={{
              id: trabalho.id,
              task_id: item.id,
              file_ids: trabalho.file_ids || [],
              post_id: trabalho.post_id || null,
              aprovado_em: trabalho.aprovado_em || null,
              publicar_em: trabalho.publicar_em || null,
              entrega_aviso: trabalho.entrega_aviso || null,
              titulo: item.title,
              dia: item.due_date || null,
              project_id: item.project_id || null,
            }}
            posicao={1}
            total={1}
            titulo="Agendar"
            onFechar={() => {
              agendarDoPlano.fim(false);
              setAgendarDoPlano(null);
            }}
            onFeita={() => {
              agendarDoPlano.fim(true);
              setAgendarDoPlano(null);
              atualizar();
            }}
          />
        )}
        {pedirData && (
          <JanelaDaAprovada peca={pedirData} posicao={1} total={1} titulo="Agendar" onFechar={() => setPedirData(null)} onFeita={() => { setPedirData(null); atualizar(); }} />
        )}
        {colunas && onFoco && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0"
            aria-pressed={foco}
            aria-label={foco ? "Voltar (Esc)" : "Tela cheia"}
            data-tela-cheia-do-estudio=""
            onClick={() => onFoco(!foco)}
            title={foco ? "Voltar ao painel (Esc)" : "Tela cheia: esconde o topo do painel, as pautas e os botões flutuantes; volta pelo botão ou Esc"}
          >
            {foco ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span className="sr-only">{foco ? "Voltar (Esc)" : "Tela cheia"}</span>
          </Button>
        )}
      </div>
      {estado === "producao" && (
        <div className="h-0.5 w-full bg-secondary" aria-hidden="true">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progresso}%` }} />
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------- centro

  // Frente AP: o pedido do cliente entendido (Jev), com Aplicar e Pedir ao diretor; nada gera sozinho.
  const avisoDeAjuste = trabalho ? (
    <PedidoDoCliente
      trabalho={trabalho}
      lamina={laminaDoPedido}
      formatoAtual={formato}
      ocupado={ocupado || salvandoFormato}
      onAplicarNaLamina={aplicarPedidoDoCliente}
      onPedirAoDiretor={(texto) => setPedidoAoDiretor(texto)}
      onMudarFormato={(f) => void mudarFormato(f)}
      onAbrirEntrega={() => abrirFerramenta("entrega", false)}
    />
  ) : null;

  // Frente MF: o item é um post de fotos (feito na Mesa Foto): aqui nada é gerado; fotos, legenda e envio moram lá.
  const avisoDePostDeFotos = trabalho && ehPostDeFotos(trabalho.direcao) ? (
    <div className="mb-3 flex min-w-0 flex-wrap items-center rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-[12px] leading-snug" role="status" data-aviso="post-de-fotos">
      <span className="mr-2 min-w-0 flex-1">Este item é um post de fotos da Mesa Foto: as fotos vão como estão, sem arte. Troque as fotos, a legenda e envie ao cliente por lá.</span>
      <Link to={linkDoPostNaMesaFoto(clientId, { taskId: item.id, trabalhoId: trabalho.id })} className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground">
        Abrir na Mesa Foto
      </Link>
    </div>
  ) : null;

  const avisoDeEntregue = entregue && trabalho ? (
    <div className="mb-2 flex min-w-0 flex-wrap items-center rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-[12px] leading-snug" role="status" data-aviso="trabalho-entregue">
      <Lock className="mr-2 h-3.5 w-3.5 shrink-0 text-warning" />
      <span className="mr-2 min-w-0 flex-1">
        {trabalho.entrega_status === "reprovado" ? "Pediram ajuste nesta arte. " : "Entregue em Arquivos. "}
        Para corrigir, reabra: as lâminas voltam para edição e a entrega de agora fica no histórico.
      </span>
      <Button type="button" size="sm" className="h-8 shrink-0 gap-1 px-2.5 text-[12px]" onClick={() => void reabrir()} disabled={reabrindo || algoGerando}>
        {reabrindo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reabrir para corrigir
      </Button>
    </div>
  ) : foraDoFormato.length && !algoGerando ? (
    <p className="mb-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11.5px] leading-snug text-warning" data-aviso="fora-do-formato">
      {foraDoFormato.length === 1 ? `A lâmina ${foraDoFormato[0]} foi gerada` : `As lâminas ${foraDoFormato.join(", ")} foram geradas`} em outro formato. Gere de novo para entregar em {formato === "feed_4x5" ? "4:5" : formato === "retrato_3x4" ? "3:4" : formato === "quadrado_1x1" ? "1:1" : "9:16"}.
    </p>
  ) : null;

  const acoesDaPrancheta = (c: { ordem: number }, v: unknown) => (
    <BotaoComCusto
      rotulo={<><Wand2 className="h-3.5 w-3.5" /><span className="sr-only">{v ? "Refazer" : "Gerar"} a lâmina {c.ordem}</span></>}
      titulo={`${v ? "Refazer" : "Gerar"} a lâmina ${c.ordem}`}
      descricao={comNotaDoFundo(`${v ? "Refazer" : "Gerar"} a lâmina ${c.ordem}. A conferência roda logo depois.`, [c.ordem])}
      variant={v ? "outline" : "default"}
      className="h-8 w-full gap-1 px-2 text-[11px]"
      disabled={laminaOcupada(c.ordem) || entregue || semTipografia}
      partes={() => partesGerarDas([c.ordem]).concat(partesDoFundo([c.ordem]))}
      executar={() => gerarEConferir(c.ordem)}
    />
  );

  const prancheta = (vertical: boolean) => (
    <PranchetaDoEstudio
      cards={cardsDaDirecao}
      ultimas={ultimas}
      selecionado={selecionado}
      onSelecionar={escolherLamina}
      onAmpliar={ampliarLamina}
      andamento={andamento}
      infinito={infinito}
      largura={vertical ? LARGURA_NA_PRANCHETA : LARGURA_NA_PRANCHETA_PILHA}
      proporcao={proporcao}
      orientacao={vertical ? "vertical" : "horizontal"}
      podeReordenar={!ocupado && cardsDaDirecao.length > 1 && !entregue && !ordemTravada}
      avisoDaOrdem={ordemTravada ? AVISO_DA_ORDEM_NO_CONTINUO : undefined}
      onReordenar={(ordens) => void reordenar(ordens)}
      onVersoes={(ordem) => abrirPainel(ordem, "versoes")}
      onAjustar={(ordem) => abrirPainel(ordem, "livre")}
      acoes={acoesDaPrancheta}
    />
  );

  const resumoDaPrancheta = (
    <span className="min-w-0 truncate">
      {trabalho?.direcao?.origem === "roteiro" ? "do roteiro" : "do diretor"} · {laminasComArte} de {cardsDaDirecao.length} com arte
      {infinito ? " · contínuo" : ""}
    </span>
  );

  // Versão que a lâmina grande mostra (a vista ou a última): o aviso da foto recomposta olha para ela.
  const versoesDaEscolhida = cardSelecionado ? (trabalho?.cards || []).filter((v) => v.ordem === cardSelecionado.ordem) : [];
  const versaoNaTela = (versaoVista !== null ? versoesDaEscolhida.find((v) => v.versao === versaoVista) : undefined) || ultimaDaEscolhida || null;

  const laminaGrande = cardSelecionado ? (
    <EstudioLaminaGrande
      card={cardSelecionado}
      total={cardsDaDirecao.length}
      versoes={(trabalho?.cards || []).filter((v) => v.ordem === cardSelecionado.ordem)}
      versaoVista={versaoVista}
      onVersaoVista={setVersaoVista}
      desenhandoAreas={desenhandoAreas}
      areas={areas}
      onAreas={setAreas}
      ocupado={laminaOcupada(cardSelecionado.ordem)}
      andamento={andamento[cardSelecionado.ordem]}
      onAmpliar={() => ampliarLamina(cardSelecionado.ordem)}
      soPelaLargura={!colunas}
      proporcao={proporcao}
      aviso={avisoDeEntregue}
      faixa={
        estado === "producao" && trabalho ? (
          <EstudioBaseDaLamina
            card={cardSelecionado}
            refsDoConjunto={trabalho.direcao?.referencias_ids}
            continuo={comFundoContinuo}
            continuoSemModelo={continuoSemModelo}
            foraDoFundo={versaoForaDoFundo(versaoNaTela as any, (trabalho.direcao as any)?.panorama)}
            acaoDoFundo={
              <BotaoComCusto
                rotulo="Gerar de novo"
                titulo={`Gerar a lâmina ${cardSelecionado.ordem} de novo`}
                descricao={comNotaDoFundo("A lâmina é refeita sobre o fundo contínuo atual e passa pela conferência.", [cardSelecionado.ordem])}
                variant="outline"
                className="h-7 shrink-0 px-2.5 text-[12px]"
                disabled={laminaOcupada(cardSelecionado.ordem) || entregue || semTipografia}
                partes={() => partesGerarDas([cardSelecionado.ordem]).concat(partesDoFundo([cardSelecionado.ordem]))}
                executar={() => gerarEConferir(cardSelecionado.ordem)}
              />
            }
            versao={versaoNaTela}
            avisoDoRosto={
              <>
                <EstudioAvisoDoRosto trabalhoId={trabalho.id} versao={versaoNaTela as any} />
                <EstudioAvisosDaGeracao versao={versaoNaTela as any} />
              </>
            }
            onAbrirFotos={() => abrirFerramenta("fotos", false)}
            onAbrirReferencias={() => {
              setRefsAlvo("lamina");
              abrirFerramenta("referencias", false);
            }}
            bloqueado={entregue || laminaOcupada(cardSelecionado.ordem)}
            onTirarFoto={(caminho) =>
              void tirarDaLamina(
                cardSelecionado.ordem,
                { fotos_livres: (cardSelecionado.fotos_livres || []).filter((f) => f.caminho !== caminho) },
                "Foto tirada da lâmina",
              )}
            onTirarFotoDoAcervo={() => void tirarDaLamina(cardSelecionado.ordem, { imagens_ids: [] }, "Foto tirada da lâmina")}
            onTrocarUso={(alvo, uso) => void trocarUsoDaFoto(cardSelecionado, alvo, uso)}
            onTirarReferencia={(id) =>
              void tirarDaLamina(
                cardSelecionado.ordem,
                { referencias_ids: (cardSelecionado.referencias_ids || []).filter((r) => r !== id) },
                "Referência tirada da lâmina",
              )}
            referenciaNaHora={
              <EstudioReferenciaNaHora
                compacto
                escolhidas={cardSelecionado.referencias_ids || []}
                onGravar={(ids) => configurar({ card: { ordem: cardSelecionado.ordem, referencias_ids: ids } })}
                alvoRotulo={`lâmina ${cardSelecionado.ordem}`}
                bloqueado={entregue || laminaOcupada(cardSelecionado.ordem)}
                motivoDoBloqueio={entregue ? "Trabalho entregue: reabra para corrigir." : "Espere a lâmina terminar."}
              />
            }
            total={cardsDaDirecao.length}
            fidelidade={
              <EstudioFidelidadeDaReferencia
                compacto
                alvo="lamina"
                ordem={cardSelecionado.ordem}
                escolha={cardSelecionado.fidelidade_referencia}
                doTrabalho={trabalho.direcao?.fidelidade_referencia}
                bloqueado={entregue || laminaOcupada(cardSelecionado.ordem)}
                onSalvar={configurar}
              />
            }
            logo={
              laminaLevaLogo(cardSelecionado.ordem, cardsDaDirecao.length) ? (
                <EstudioLogoDaLamina
                  compacto
                  trabalhoId={trabalho.id}
                  alvo="lamina"
                  ordem={cardSelecionado.ordem}
                  escolha={((cardSelecionado as { logo?: EscolhaDaLogo }).logo) || null}
                  doConjunto={(trabalho.direcao as { logo_escolhida?: EscolhaDaLogo | null }).logo_escolhida || null}
                  bloqueado={entregue || laminaOcupada(cardSelecionado.ordem)}
                  onSalvar={configurar}
                />
              ) : undefined
            }
          />
        ) : undefined
      }
    />
  ) : null;

  const centroDaProducao = colunas ? (
    <>
      <div className="flex min-h-0 shrink-0 flex-col border-r border-border" style={{ width: LARGURA_NA_PRANCHETA + 32 }}>
        <p className="flex h-9 shrink-0 items-center px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground" title={`${trabalho?.direcao?.origem === "roteiro" ? "Direção do roteiro" : "Direção do diretor"}${infinito ? ", carrossel contínuo" : ""}. ${ordemTravada ? `Lâminas: clique escolhe, duplo clique amplia. ${AVISO_DA_ORDEM_NO_CONTINUO}` : "Lâminas: clique escolhe, duplo clique amplia, arraste pela alça muda a ordem"}`}>
          <span className="min-w-0 flex-1 truncate">Prancheta</span>
          <span className="ml-1 shrink-0 normal-case tracking-normal tabular-nums" data-resumo-da-prancheta="">{laminasComArte}/{cardsDaDirecao.length}</span>
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
          {prancheta(true)}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4">
        {avisoDePostDeFotos}
        {avisoDeAjuste}
        <EstudioSemTipografia clientId={clientId} />
        {laminaGrande}
      </div>
    </>
  ) : (
    <div className="flex min-w-0 flex-col p-3">
      {avisoDePostDeFotos}
      {avisoDeAjuste}
      <EstudioSemTipografia clientId={clientId} />
      <p className="mb-2 flex min-w-0 items-center text-[11px] text-muted-foreground">
        <span className="mr-2 shrink-0 font-medium uppercase tracking-wider">Prancheta</span>
        {resumoDaPrancheta}
      </p>
      {prancheta(false)}
      <div className="mt-3 flex min-w-0 flex-col">{laminaGrande}</div>
    </div>
  );

  const centro =
    estado === "producao" ? (
      centroDaProducao
    ) : estado === "agenda" && arte ? (
      <div className={colunas ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4" : "flex flex-col p-3"}>
        <EstudioArteDaAgenda arte={arte} linkAgenda={linkAgendaDoItem || `/calendario?client=${clientId}`} onRefazer={() => setRefazendo(true)} soPelaLargura={!colunas} />
      </div>
    ) : (
      <div className={colunas ? "min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6" : "p-3"}>
        <EstudioPreparar
          roteiro={roteiro}
          postUnico={postUnico}
          partesDiretor={partesDiretor}
          partesEnxugar={partesRefinar}
          onPreparar={preparar}
          onConcluido={aoPreparar}
          aviso={
            refazendo && arte ? (
              <p className="text-[12px] leading-snug text-muted-foreground">
                Refazendo: a arte atual continua na Agenda até a nova ser entregue.{" "}
                <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setRefazendo(false)}>
                  Voltar para a arte atual
                </button>
              </p>
            ) : trabalho && trabalho.status === "erro" ? (
              <p className="text-[12px] text-destructive">A última tentativa terminou com erro. Prepare de novo.</p>
            ) : null
          }
        />
      </div>
    );

  // ---------------------------------------------------------------- ferramentas

  const ferramentaLamina = cardSelecionado && trabalho ? (
    <CardDoEstudio
      key={cardSelecionado.ordem}
      conversaId={trabalho.conversa_id}
      direcao={cardSelecionado}
      versoes={(trabalho.cards || []).filter((v) => v.ordem === cardSelecionado.ordem)}
      ocupado={laminaOcupada(cardSelecionado.ordem) || entregue}
      conferindo={estaConferindo(andamento[cardSelecionado.ordem])}
      painel={painel}
      onPainel={setPainel}
      versaoVista={versaoVista}
      onVersaoVista={setVersaoVista}
      areas={areas}
      onAreas={setAreas}
      partesGerar={() => partesGerarDas([cardSelecionado.ordem]).concat(partesDoFundo([cardSelecionado.ordem]))}
      notaDoGerar={partesDoFundo([cardSelecionado.ordem]).length ? `${NOTA_DO_FUNDO_CONTINUO}.` : undefined}
      partesAjustar={partesAjustar}
      partesConferir={partesConferir}
      onGerar={() => gerarEConferir(cardSelecionado.ordem)}
      onAjustar={(instrucao, opcoes) => ajustar(cardSelecionado.ordem, instrucao, opcoes)}
      onDesfazerVersao={async (versao) => {
        await desfazerVersaoDaLamina(trabalho.id, cardSelecionado.ordem, versao);
        atualizar();
      }}
      onConferir={() => conferir(trabalho.id, cardSelecionado.ordem)}
      onCorrigir={() => corrigirDeNovo(cardSelecionado.ordem)}
      partesCorrigir={() => partesAjustar().concat(partesConferir())}
      onConfigurar={(card) => configurar({ card: { ordem: cardSelecionado.ordem, ...card } })}
      onConcluido={atualizar}
      semTrocaDeFundo={comFundoContinuo && usaFundoContinuo(cardSelecionado)}
      instrucaoInicial={instrucaoDoCliente && instrucaoDoCliente.ordem === cardSelecionado.ordem ? instrucaoDoCliente.texto : null}
      refinarTexto={
        <div className="space-y-2">
          {/* Frente R5: texto enxugado ao gerar (voltar ao original), aviso de que vai enxugar e dividir em 2 lâminas. */}
          <EstudioTextoDaLamina
            key={`texto-${cardSelecionado.ordem}`}
            trabalhoId={trabalho.id}
            card={cardSelecionado as any}
            total={cardsDaDirecao.length}
            capaComVersao={ultimas.has(1)}
            continuo={continuoLigado}
            bloqueado={entregue || algoGerando}
            onMudou={atualizar}
          />
          <EstudioRefinarTexto
            key={`refino-${cardSelecionado.ordem}`}
            trabalhoId={trabalho.id}
            alvo="lamina"
            ordem={cardSelecionado.ordem}
            texto={cardSelecionado.texto_exato || ""}
            partes={partesDoRefinoConferido}
            bloqueado={entregue || laminaOcupada(cardSelecionado.ordem)}
            onAplicar={async (novo) => {
              await configurar({ card: { ordem: cardSelecionado.ordem, texto_exato: novo } });
              toast.success("Texto aplicado na lâmina", { description: ultimaDaEscolhida ? "Gere de novo para a arte mostrar o texto novo." : undefined });
            }}
            onConcluido={() => mesa.atualizarCusto()}
          />
        </div>
      }
    />
  ) : (
    <p className="text-[12.5px] text-muted-foreground">Escolha uma lâmina na prancheta.</p>
  );

  /** Refazer depois de aplicar: no contínuo com a cena nova, o fundo panorâmico inteiro entra no preço. */
  /**
   * Frente RO, fase 2: cada passo do plano do diretor pelo caminho de sempre desta tela: ajustar o texto
   * (e conferir), gerar e conferir (refazer e variações, uma de cada vez), entregar (enviar para aprovação,
   * como o botão da Entrega) e agendar (a janela do Agendar do Estúdio; fechar sem agendar vira "falhou").
   */
  const executarPassoDoPlano: ExecutorDoPasso = async (p) => {
    if (!trabalho) throw new Error("Abra o trabalho antes.");
    if (p.operacao === "ajustar_texto" && p.ordem) {
      const r = await chamarFuncao<any>("estudio-arte", { acao: "ajustar_texto", trabalho_id: trabalho.id, ordem: p.ordem });
      atualizar();
      const c = await conferirSemDerrubar(trabalho.id, p.ordem);
      atualizar();
      return { custo_usd: (custoDaResposta(r) || 0) + c };
    }
    if ((p.operacao === "refazer" || p.operacao === "variacoes") && p.ordem) {
      const vezes = p.operacao === "variacoes" ? Math.max(1, Math.min(3, p.n || 2)) : 1;
      let custo = 0;
      for (let i = 0; i < vezes; i++) {
        custo += await gerarUma(trabalho.id, p.ordem);
        custo += await conferirSemDerrubar(trabalho.id, p.ordem);
        atualizar();
      }
      return { custo_usd: custo };
    }
    if (p.operacao === "entregar") {
      const r = await entregarComModo(trabalho.id, "aprovacao");
      depoisDaEntrega(r);
      atualizar();
      if (!r.ok) throw new Error(r.erro || "A entrega não terminou.");
      return { custo_usd: 0 };
    }
    if (p.operacao === "agendar") {
      if (trabalho.status !== "entregue") throw new Error("Entregue o trabalho antes de agendar.");
      return await new Promise((ok, erro) =>
        setAgendarDoPlano({ fim: (feito) => (feito ? ok({ custo_usd: 0 }) : erro(new Error("O agendamento foi fechado sem agendar."))) }),
      );
    }
    throw new Error("Este passo não existe nesta tela.");
  };

  const partesDoRefazer = (ordens: number[], refazFundo: boolean): ParteDaEstimativa[] => {
    const fundo = refazFundo && comFundoContinuo
      ? partesDoPanorama(ordens.filter((o) => cardsDaDirecao.some((c) => c.ordem === o && usaFundoContinuo(c))), cardsDaDirecao.length, null, modeloImagem, qualidade)
      : partesDoFundo(ordens);
    return partesGerarDas(ordens).concat(fundo);
  };

  const ferramentaDiretor = trabalho ? (
    <DiretorDoEstudio
      key={trabalho.id}
      trabalho={trabalho}
      ordemEmFoco={cardSelecionado ? cardSelecionado.ordem : null}
      ocupado={algoGerando || entregando}
      bloqueado={entregue}
      continuo={ordemTravada}
      partesRefazer={partesDoRefazer}
      onRefazer={(ordens) => gerarVarias(ordens)}
      onAtualizar={atualizar}
      executarPasso={executarPassoDoPlano}
      className="h-full"
    />
  ) : null;

  const ferramentaFotos = cardSelecionado && trabalho ? (
    <div className="min-w-0 space-y-3">
      <p className="text-[12.5px] font-semibold">Lâmina {cardSelecionado.ordem}</p>
      <EstudioFotos
        key={cardSelecionado.ordem}
        card={cardSelecionado}
        ocupado={laminaOcupada(cardSelecionado.ordem)}
        entregue={entregue}
        onReabrir={() => void reabrir()}
        temArte={!!ultimaDaEscolhida}
        onSalvar={(corpo) => configurar(corpo)}
        onTirarFotoAntiga={() => configurar({ card: { ordem: cardSelecionado.ordem, imagens_ids: [] } })}
      />
    </div>
  ) : (
    <p className="text-[12.5px] text-muted-foreground">Escolha uma lâmina na prancheta.</p>
  );

  const referenciasDoConjunto = (trabalho?.direcao?.referencias_ids || []).length;
  const referenciasDaLamina = (cardSelecionado?.referencias_ids || []).length;
  const ferramentaReferencias = trabalho ? (
    <div className="min-w-0 space-y-3">
      {/* Frente AE-2 (padrão do painel): a explicação fica no "?", à vista só o título e a contagem. */}
      <div className="min-w-0">
        <p className="flex min-w-0 items-center text-[12.5px] font-medium leading-snug">
          <span className="min-w-0">Escolha 1 ou 2: o gerador replica o layout delas</span>
          <AjudaRecolhida className="ml-1.5" rotulo="Como a referência entra na lâmina">
            Estrutura, posição dos blocos, escala do texto, recorte e tratamento da imagem saem da referência; as cores, as fontes e a logo são da marca, o
            texto é o da lâmina e a foto da lâmina vira o assunto. As da lâmina valem no lugar das do conjunto.
            {comFundoContinuo ? " No carrossel contínuo o panorama manda na cena e a referência não é replicada." : ""}
          </AjudaRecolhida>
        </p>
        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
          Conjunto: {referenciasDoConjunto} escolhida{referenciasDoConjunto === 1 ? "" : "s"}
          {cardSelecionado ? ` · Lâmina ${cardSelecionado.ordem}: ${referenciasDaLamina} escolhida${referenciasDaLamina === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      <ReferenciasDoEstudio
        trabalho={trabalho}
        cardSelecionado={cardSelecionado}
        alvo={refsAlvo}
        onAlvo={setRefsAlvo}
        aba={refsAba}
        onAba={setRefsAba}
        onAtualizar={atualizar}
        entregue={entregue}
        onReabrir={() => void reabrir()}
        referenciaNaHora
        extrasDoEstudio
      />
    </div>
  ) : null;

  const ferramentaConjunto = trabalho ? (
    <div className="space-y-4">
      <section>
        <Rotulo>Conceito</Rotulo>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">
          {trabalho.direcao?.conceito || <span className="text-muted-foreground">Sem conceito escrito nesta direção.</span>}
        </p>
      </section>
      {trabalho.direcao?.fio_visual && (
        <section>
          <Rotulo>Fio visual</Rotulo>
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]" title="O que se repete em todas as lâminas">
            {trabalho.direcao.fio_visual}
          </p>
        </section>
      )}
      {(trabalho.direcao as { estilo_pedido?: string | null } | undefined)?.estilo_pedido && (
        <section>
          <Rotulo>Estilo pedido</Rotulo>
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]" title="Pedido na conversa com o diretor; vale em todas as lâminas">
            {(trabalho.direcao as { estilo_pedido?: string | null }).estilo_pedido}
          </p>
        </section>
      )}
      <p className="text-[11.5px] text-muted-foreground">
        {trabalho.direcao?.origem === "roteiro" ? "Direção montada do roteiro" : "Direção do diretor de arte"} · {cardsDaDirecao.length} lâmina{cardsDaDirecao.length === 1 ? "" : "s"}
      </p>

      <section>
        <Rotulo>Formato do post</Rotulo>
        <SeletorDeFormatoCompacto valor={formato} onMudar={(f) => void mudarFormato(f)} disabled={salvandoFormato || algoGerando || entregue} />
      </section>

      <section>
        <Rotulo
          acao={
            <AjudaRecolhida rotulo="Onde a logo do conjunto vale">
              Vale na capa e no fechamento. O gerador desenha a logo junto com a arte, num tamanho que se lê de longe; a lâmina pode ter a própria (na base da lâmina, em cima dela).
            </AjudaRecolhida>
          }
        >
          Logo do kit
        </Rotulo>
        <EstudioLogoDaLamina
          trabalhoId={trabalho.id}
          alvo="conjunto"
          escolha={(trabalho.direcao as { logo_escolhida?: EscolhaDaLogo | null }).logo_escolhida || null}
          bloqueado={entregue || algoGerando}
          onSalvar={configurar}
        />
      </section>

      {cardsDaDirecao.length > 1 && (
        <label className="flex cursor-pointer items-start rounded-lg border border-border bg-background px-3 py-2.5">
          <Switch checked={infinito} onCheckedChange={(v) => void alternarContinuo(v)} disabled={salvandoContinuo || algoGerando || entregue || formato !== "feed_4x5"} className="mr-3 mt-0.5 shrink-0" aria-label="Carrossel contínuo" />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium">Carrossel contínuo</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">
              {formato === "feed_4x5"
                ? "A cena atravessa as lâminas, como um panorama. Gera uma de cada vez. Desligado, as lâminas seguem a capa como série (mesmo grid, linhas, tipografia e paleta)."
                : AVISO_CONTINUO_FORA_DO_4X5}
            </span>
          </span>
        </label>
      )}
      {continuoSemModelo && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11.5px] leading-snug text-warning" data-aviso="continuo-sem-modelo">
          {AVISO_CONTINUO_SEM_MODELO}
        </p>
      )}
      {comFundoContinuo && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2">
          <span className="min-w-0 text-[11.5px] leading-snug text-muted-foreground">
            {Object.keys((trabalho.direcao as any)?.panorama?.fundos ?? {}).length
              ? "O fundo panorâmico está pronto: refazer uma lâmina troca só o texto, a emenda continua."
              : "O fundo panorâmico nasce ao gerar a primeira lâmina."}
          </span>
          {Object.keys((trabalho.direcao as any)?.panorama?.fundos ?? {}).length > 0 && (
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => void refazerFundo()} disabled={salvandoContinuo || algoGerando || entregue}>
              Refazer o fundo
            </Button>
          )}
        </div>
      )}

      <section className="space-y-2">
        <Rotulo>Pedir ao diretor</Rotulo>
        <Textarea
          value={pedidoAoDiretor}
          onChange={(e) => setPedidoAoDiretor(e.target.value)}
          rows={3}
          placeholder="Ex.: mais leve, com fotos reais do ambiente e menos texto por lâmina"
          className="text-[13px]"
          disabled={entregue}
          title="O diretor refaz a direção pelo pedido; as artes já geradas ficam nas versões"
        />
        <div className="flex justify-end">
          <BotaoComCusto
            rotulo={<><MessageSquare className="mr-1 h-3.5 w-3.5" /> {pedidoAoDiretor.trim() ? "Pedir ao diretor" : "Refazer a direção"}</>}
            titulo="Pedir ao diretor"
            descricao="O diretor relê a marca, as referências e o seu pedido e escreve a direção de novo, no mesmo trabalho."
            variant={pedidoAoDiretor.trim() ? "default" : "outline"}
            disabled={ocupado || entregue}
            partes={partesDiretor}
            executar={() =>
              chamarFuncao("estudio-arte", {
                acao: "preparar",
                task_id: item.id,
                modo: "diretor",
                instrucao: pedidoAoDiretor.trim() || undefined,
                trabalho_id: trabalho.id,
                modelo_imagem_id: modeloImagem || undefined,
                qualidade,
                // Mantém o contínuo como está no trabalho: sem o campo, o
                // servidor caía na sugestão do estrategista e religava.
                carrossel_infinito: postUnico ? undefined : infinito,
              })
            }
            aoConcluir={() => {
              setPedidoAoDiretor("");
              atualizar();
            }}
          />
        </div>
        {entregue && <p className="text-[11.5px] text-muted-foreground">Arte já entregue: reabra para corrigir (o aviso fica em cima da lâmina).</p>}
      </section>
    </div>
  ) : null;

  const ferramentaLegenda = trabalho ? (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center">
        <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Legenda</p>
        <BotaoComCusto
          rotulo={<><Sparkles className="mr-1 h-3.5 w-3.5" /> {legenda ? "Reescrever" : "Escrever"}</>}
          titulo="Escrever a legenda"
          descricao="A legenda final sai do item da agenda e da arte pronta, com 4 ou 5 hashtags escolhidas entre as candidatas."
          variant="outline"
          className="h-8 gap-1 px-2.5 text-[12px]"
          disabled={entregue}
          partes={() => [{ modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida }, parteDaConferenciaDoJev()]}
          executar={() => chamarFuncao("estudio-arte", { acao: "legenda", trabalho_id: trabalho.id })}
          aoConcluir={(data) => {
            if (typeof data?.legenda === "string") setLegenda(data.legenda);
            if (Array.isArray(data?.hashtags)) setHashtagsTexto(normalizarHashtags(data.hashtags).join(" "));
            setOpcoesDaLegenda(opcoesDaResposta(data));
            atualizar();
          }}
        />
      </div>
      {opcoesDaLegenda.length > 0 && opcoesDaLegenda[0].texto === legenda && <NotaDaCopy nota={opcoesDaLegenda[0].nota} alerta={opcoesDaLegenda[0].alerta} avisos={opcoesDaLegenda[0].avisos} framework={opcoesDaLegenda[0].framework} />}
      <Textarea
        value={legenda}
        onChange={(e) => setLegenda(e.target.value)}
        onBlur={salvarAoSair}
        rows={9}
        placeholder="A legenda do post aparece aqui. Dá para editar à mão; grava sozinha ao sair do campo."
        className="text-[13px] leading-relaxed"
        disabled={entregue}
      />
      <OpcoesDaCopy
        opcoes={opcoesDaLegenda}
        atual={legenda}
        bloqueado={entregue}
        onUsar={(novo) => {
          setLegenda(novo);
          toast.success("Legenda trocada", { description: "Confira e salve (grava sozinha ao sair do campo)." });
        }}
      />
      <EstudioRefinarTexto
        trabalhoId={trabalho.id}
        alvo="legenda"
        texto={legenda}
        partes={partesDoRefinoConferido}
        bloqueado={entregue}
        onAplicar={(novo) => {
          setLegenda(novo);
          toast.success("Legenda aplicada", { description: "Confira e salve (grava sozinha ao sair do campo)." });
        }}
        onConcluido={() => mesa.atualizarCusto()}
      />
      <div className="space-y-2">
        <p className="flex items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><Hash className="mr-1 h-3.5 w-3.5" /> Hashtags</p>
        <Input value={hashtagsTexto} onChange={(e) => setHashtagsTexto(e.target.value)} onBlur={salvarAoSair} placeholder="#exemplo #outra" className="h-9 text-[12.5px]" disabled={entregue} />
        {hashtags.length > 0 && (
          <div className="flex flex-wrap">
            {hashtags.map((h) => (
              <span key={h} className="mb-1 mr-1.5 max-w-full truncate rounded-full bg-primary/10 px-2.5 py-0.5 text-[11.5px] text-primary">{h}</span>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" variant="outline" className="h-9 min-w-0" onClick={() => void copiar(legendaParaCopiar(legenda, hashtags), "Legenda copiada com as hashtags")}>
          <Copy className="mr-1.5 h-3.5 w-3.5" /> <span className="truncate">Copiar legenda</span>
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-9 min-w-0" onClick={() => void copiar(hashtags.join(" "), "Hashtags copiadas")}>
          <Hash className="mr-1.5 h-3.5 w-3.5" /> <span className="truncate">Copiar hashtags</span>
        </Button>
      </div>
      <div className="flex min-h-9 items-center justify-end">
        {salvandoLegenda ? (
          <span className="inline-flex items-center text-[11.5px] text-muted-foreground"><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> salvando</span>
        ) : legendaMudou ? (
          <Button type="button" size="sm" onClick={() => void salvarLegenda()} disabled={entregue}>Salvar legenda</Button>
        ) : (
          <span className="inline-flex items-center text-[11.5px] text-muted-foreground"><Check className="mr-1 h-3.5 w-3.5 text-success" /> salva</span>
        )}
      </div>
    </div>
  ) : null;

  const ferramentaEntrega = rapida ? rapida.entrega : trabalho ? (
    <EstudioEntrega
      trabalho={trabalho}
      laminasFeitas={laminasComArte}
      laminasTotal={cardsDaDirecao.length}
      legendaEscrita={!!legenda.trim()}
      ehDesign={ehDesign}
      entregando={entregando}
      enviando={enviando}
      ocupado={algoGerando}
      erroDoEnvio={erroDoEnvio}
      linkArquivos={`/arquivos?client=${clientId}`}
      linkAgenda={linkAgendaDoItem}
      onEntregar={(modo, mostrar) => void entregar(modo, mostrar)}
      onEnviar={() => void enviarAgora()}
      onAprovarPeloCliente={mesa.podeRecarregar ? () => void aprovarPeloClienteAgora() : undefined}
      aprovando={aprovandoPeloCliente}
      onReabrir={entregue ? () => void reabrir() : undefined}
      reabrindo={reabrindo}
    />
  ) : null;

  const ferramentaPauta = (
    <div className="space-y-5">
      <div>
        <Rotulo>Pauta</Rotulo>
        <p className="text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">{item.title}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">{dataCurta(item.due_date)} · {formatoDoItem(item)}</p>
        {temRoteiro && roteiro && (
          <p className="mt-2 flex items-start text-[12px] leading-snug text-muted-foreground">
            <Star className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 fill-warning text-warning" />
            <span>Roteiro do estrategista com {roteiro.laminas} lâmina{roteiro.laminas === 1 ? "" : "s"}: a direção sai dele, sem custo de IA.</span>
          </p>
        )}
      </div>
      <div>
        <Rotulo>Esteira</Rotulo>
        <EtapasDaEsteira atual={etapaDoItem(trabalho, refazendo ? null : arte)} />
      </div>
    </div>
  );

  const ferramentaPost = arte ? (
    <InspetorDaArte arte={arte} publicacao={publicacao} linkAgenda={linkAgendaDoItem || `/calendario?client=${clientId}`} />
  ) : null;

  const conteudoDaFerramenta = (f: Ferramenta): ReactNode => {
    switch (f) {
      case "lamina":
        return ferramentaLamina;
      case "diretor":
        return ferramentaDiretor;
      case "fotos":
        return ferramentaFotos;
      case "referencias":
        return ferramentaReferencias;
      case "conjunto":
        return ferramentaConjunto;
      case "legenda":
        return ferramentaLegenda;
      case "entrega":
        return ferramentaEntrega;
      case "post":
        return ferramentaPost;
      default:
        return ferramentaPauta;
    }
  };

  const cabecalhoDoPainel = ferramenta ? (
    <div className="flex h-11 shrink-0 items-center border-b border-border px-4">
      <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{FERRAMENTAS[ferramenta].rotulo}</p>
      <button
        type="button"
        onClick={() => setFerramenta("")}
        aria-label="Fechar a ferramenta"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  const barraDeFerramentas = (
    <BarraDeFerramentas ferramentas={ferramentas} ativa={ferramenta} onAbrir={(f) => abrirFerramenta(f)} marca={marcaNaFerramenta} vertical={colunas} />
  );

  const ampliar = <Ampliar imagens={paraAmpliar.map((a) => a.imagem)} indice={ampliada} onFechar={() => setAmpliada(null)} />;

  if (colunas) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="Estúdio">
        {barraDoItem}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1">{centro}</div>
          {/* Painel deslizante da ferramenta: abre ao lado da barra, com rolagem própria. */}
          <div
            className="min-h-0 shrink-0 overflow-hidden border-border transition-[width] duration-200 ease-out"
            style={{ width: ferramenta ? LARGURA_DO_PAINEL : 0, borderLeftWidth: ferramenta ? 1 : 0 }}
          >
            {ferramenta && (
              <div ref={painelRef} className="flex h-full min-h-0 flex-col" style={{ width: LARGURA_DO_PAINEL }} role="region" aria-label={FERRAMENTAS[ferramenta].rotulo}>
                {cabecalhoDoPainel}
                {ferramenta === "diretor" ? (
                  // A conversa tem rolagem própria e o campo fica fixo embaixo.
                  <div className="flex min-h-0 flex-1 flex-col">{conteudoDaFerramenta(ferramenta)}</div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-16">{conteudoDaFerramenta(ferramenta)}</div>
                )}
              </div>
            )}
          </div>
          {barraDeFerramentas}
        </div>
        {ampliar}
      </section>
    );
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card" aria-label="Estúdio">
      {barraDoItem}
      {centro}
      {barraDeFerramentas}
      {ferramenta && (
        <div ref={painelRef} className="border-t border-border" role="region" aria-label={FERRAMENTAS[ferramenta].rotulo}>
          {cabecalhoDoPainel}
          {ferramenta === "diretor" ? (
            <div className="flex h-[560px] flex-col">{conteudoDaFerramenta(ferramenta)}</div>
          ) : (
            <div className="p-4">{conteudoDaFerramenta(ferramenta)}</div>
          )}
        </div>
      )}
      {ampliar}
    </section>
  );
}

/** Meses para o seletor da faixa: 6 para trás e 6 para frente do atual. */
function mesesDoSeletor(mesAtual: string): string[] {
  const base = inicioDoMes();
  const lista: string[] = [];
  for (let i = -6; i <= 6; i++) lista.push(somarMeses(base, i));
  if (lista.indexOf(mesAtual) < 0) lista.push(mesAtual);
  return lista.sort();
}

/** O estúdio antes de haver pauta para abrir (lista vazia ou ainda lendo). */
function SemPauta({ carregando, vazia }: { carregando: boolean; vazia: boolean }) {
  return (
    <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center rounded-xl border border-border bg-card p-8 text-center">
      {carregando ? (
        <p className="inline-flex items-center text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Abrindo a pauta…</p>
      ) : (
        <>
          <ListChecks className="h-6 w-6 text-primary" />
          <p className="mt-3 text-[15px] font-semibold">{vazia ? "Nenhuma pauta de arte neste período" : "Escolha uma pauta na faixa acima"}</p>
          <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">
            {vazia ? "Troque o período na faixa ou complete a agenda pela aba Mês." : "O estúdio abre com a pauta escolhida."}
          </p>
        </>
      )}
    </div>
  );
}

export default function AbaEstudio({
  mes,
  onMes,
  tarefaId,
  onTarefa,
}: {
  mes: string;
  onMes: (mes: string) => void;
  tarefaId: string | null;
  onTarefa: (id: string | null) => void;
}) {
  const { clientId, podeRecarregar } = useMesa();
  // Frente AE: &rapida=nova (pedido novo) ou &rapida=<trabalho> abre a arte rápida no lugar das pautas.
  const [parametrosDoModo, setParametrosDoModo] = useSearchParams();
  const alvoRapido = (parametrosDoModo.get(PARAMETRO_DA_ARTE_RAPIDA) || "").trim() || null;
  const irParaRapida = (alvo: string | null, limpar: string[] = []) => {
    const p = new URLSearchParams(parametrosDoModo.toString());
    if (alvo) p.set(PARAMETRO_DA_ARTE_RAPIDA, alvo);
    else p.delete(PARAMETRO_DA_ARTE_RAPIDA);
    limpar.forEach((k) => p.delete(k));
    setParametrosDoModo(p);
  };
  const faixa = useFaixa();
  const colunas = emColunas(faixa);
  // Tela cheia do Estúdio (dono, 26/09): só no computador (colunas).
  const [foco, setFoco] = useState(false);
  const focoLigado = foco && colunas;
  // Frente AE-3 (dono, 28/09: "nenhum espaço sobrando no fim e nada cortado"): a altura é a que cabe na
  // janela a partir de onde o Estúdio começa (a mesma medida da AreaDeTrabalho), não mais uma conta com o
  // cabeçalho; a página não rola junto. Na tela cheia quem manda é a janela (fixed inset-0).
  const cabe = useAlturaQueCabe(colunas && !focoLigado);
  const altura = cabe.altura;
  // Trocar entre Pautas e Arte rápida troca o elemento medido: mede de novo.
  const medirDeNovo = cabe.medir;
  useEffect(() => {
    medirDeNovo();
  }, [medirDeNovo, alvoRapido]);
  useModoFoco("estudio", focoLigado);
  const alturaDaJanela = useAlturaDaJanela(focoLigado);
  useEffect(() => {
    if (!focoLigado) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      // Esc de uma janela aberta (ampliar, confirmar) fecha só ela.
      if (e.defaultPrevented || temJanelaAberta()) return;
      setFoco(false);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [focoLigado]);
  const raiz = useRef<HTMLDivElement>(null);
  const areaDoEstudio = useRef<HTMLDivElement>(null);
  // A lista abre nos próximos 60 dias; escolher um mês muda para aquele mês (e a URL acompanha).
  const [modoDaLista, setModoDaLista] = useEstadoGuardado<"proximos" | "mes">(`mesa:estudio:lista:${clientId}`, "proximos");
  const [filtroGuardado, setFiltro] = useEstadoGuardado<Filtro>(`mesa:estudio:filtro:${clientId}`, "a_fazer");
  // Mesmo padrão em todos os clientes e alturas: esteira aberta. Recolher é escolha explícita da pessoa.
  const [recolhida, setRecolhida] = useEstadoGuardado<boolean>("mesa:estudio:pautas-recolhidas:v2", false);
  const filtro = filtroValido(filtroGuardado);
  const janela = modoDaLista === "proximos" ? PROXIMOS_DIAS : mes;
  const dados = useItensDoMes(clientId, janela, true);
  const itens = dados.data?.itens || [];
  const listaPronta = !!dados.data && !dados.isPlaceholderData;

  const fontes: FontesDaLista = {
    trabalhoDe: (i) => dados.data?.trabalhos.get(i.id) || null,
    arteDe: (i) => dados.data?.artes.get(i.id) || null,
    temRoteiro: (i) => !!dados.data?.roteiros.has(i.id),
  };

  // Sem item na URL, o Estúdio abre sozinho no último aberto (ou no primeiro de "A fazer"), sem mexer no endereço.
  // Trocando o período, a escolha segue na lista anterior até a nova chegar (sem o estúdio sumir no meio).
  const temLista = !!dados.data;
  const automatico = useMemo(
    () => (tarefaId || !temLista ? null : itemInicial(itens, lerUltimo(clientId), (i) => passaNoFiltro("a_fazer", fontes.trabalhoDe(i), fontes.arteDe(i)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tarefaId, temLista, itens, clientId],
  );
  const aberto = tarefaId || automatico;
  const naLista = aberto ? itens.find((i) => i.id === aberto) || null : null;
  // Item aberto fora da janela: consulta pequena à parte, só depois que a lista certa chegou.
  const avulso = useItemAvulso(clientId, tarefaId, !!tarefaId && listaPronta && !naLista);
  const itemFora = !naLista && tarefaId && avulso.data ? avulso.data.itens.find((i) => i.id === tarefaId) || null : null;
  // Frente AE (dono, 28/09: "na Acerbi está misturando tudo"): o item de outra marca aberto pelo endereço não abre aqui.
  const filtroDaMarca = useFiltroDaMarca();
  const { marca: marcaAberta } = useMarcaDaMesa();
  const itemDeOutraMarca = !!itemFora && !itemDaMarca(itemFora.project_id, filtroDaMarca);
  const selecionado = naLista || (itemDeOutraMarca ? null : itemFora);
  const meses = useMemo(() => mesesDoSeletor(mes), [mes]);

  useEffect(() => {
    if (tarefaId) gravarUltimo(clientId, tarefaId);
  }, [clientId, tarefaId]);

  const trabalhoDe = (i: ItemDoMes) => fontes.trabalhoDe(i) || avulso.data?.trabalhos.get(i.id) || null;
  const arteDe = (i: ItemDoMes) => fontes.arteDe(i) || avulso.data?.artes.get(i.id) || null;
  const temRoteiroDe = (i: ItemDoMes) => fontes.temRoteiro(i) || !!avulso.data?.roteiros.has(i.id);
  const fontesDaFaixa: FontesDaLista = { trabalhoDe, arteDe, temRoteiro: temRoteiroDe };
  const roteiroDe = (i: ItemDoMes) => dados.data?.infoDoRoteiro.get(i.id) || avulso.data?.infoDoRoteiro.get(i.id) || null;
  const publicacaoDe = (postId: string) => dados.data?.publicacoes.get(postId) || avulso.data?.publicacoes.get(postId) || null;

  const escolherJanela = (v: string) => {
    if (v === PROXIMOS_DIAS) {
      setModoDaLista("proximos");
      return;
    }
    setModoDaLista("mes");
    if (v !== mes) onMes(v);
  };

  // Frente AE (dono, 28/09: "apagar os conteúdos que não quero mais por aqui também"): arquivar pela faixa.
  const queryClientDaFaixa = useQueryClient();
  const confirmarDaFaixa = useConfirm();
  const avisarDaFaixa = useAvisarErro();
  const parecidas = useMemo(() => pautasParecidas(itens), [itens]);
  const relerDepoisDeArquivar = () => {
    void queryClientDaFaixa.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
    void queryClientDaFaixa.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
    void queryClientDaFaixa.invalidateQueries({ queryKey: ["mesa", "agenda-do-mes", clientId] });
    void queryClientDaFaixa.invalidateQueries({ queryKey: ["mesa", "artes-do-mes", clientId] });
    void queryClientDaFaixa.invalidateQueries({ queryKey: ["editorial-calendar"] });
  };
  /**
   * Arquivar é otimista (dono, 28/09: "demora para responder; tem que ser
   * instantâneo"): o cartão sai do cache na hora, o servidor confirma em
   * segundo plano e, se recusar, o cartão volta com o motivo. O "Desfazer"
   * devolve o cartão na hora e restaura quando o arquivar terminar.
   */
  const tirarDoCache = (ids: string[]) => {
    const tira = (d: any) => (d && Array.isArray(d.itens) ? { ...d, itens: d.itens.filter((i: ItemDoMes) => ids.indexOf(i.id) < 0) } : d);
    queryClientDaFaixa.setQueriesData({ queryKey: ["mesa", "itens-do-mes", clientId] }, tira);
    queryClientDaFaixa.setQueriesData({ queryKey: ["mesa", "item-avulso", clientId] }, tira);
  };
  const devolverAoCache = (volta: ItemDoMes[]) => {
    const junta = (d: any) => {
      if (!d || !Array.isArray(d.itens)) return d;
      const faltam = volta.filter((v) => !d.itens.some((i: ItemDoMes) => i.id === v.id));
      if (!faltam.length) return d;
      return { ...d, itens: d.itens.concat(faltam).sort((x: ItemDoMes, y: ItemDoMes) => String(x.due_date || "").localeCompare(String(y.due_date || ""))) };
    };
    queryClientDaFaixa.setQueriesData({ queryKey: ["mesa", "itens-do-mes", clientId] }, junta);
  };
  const arquivarPautas = async (ids: string[]) => {
    const alvos = ids.map((id) => itens.filter((i) => i.id === id)[0] || (itemFora && itemFora.id === id ? itemFora : null)).filter(Boolean) as ItemDoMes[];
    if (!alvos.length) return;
    if (alvos.some((i) => i.planejamento)) { toast.info("Abra a pauta planejada antes de arquivá-la. Ela será vinculada à agenda automaticamente."); return; }
    const comArte = alvos.filter((i) => !!fontes.trabalhoDe(i)).length;
    const ok = await confirmarDaFaixa({
      title: alvos.length === 1 ? `Arquivar "${alvos[0].title}"?` : `Arquivar ${alvos.length} pautas?`,
      description: `Sai da faixa, do mês e da fila de geração. ${comArte ? "A arte feita fica guardada no Estúdio. " : ""}O post da Agenda só planejado sai junto; agendado ou publicado não sai. Dá para desfazer e fica em Arquivados.`,
      confirmLabel: "Arquivar",
      destructive: true,
    });
    if (!ok) return;
    const trabalhosDosAlvos = alvos.map((i) => fontes.trabalhoDe(i)).filter(Boolean) as Trabalho[];
    // Na hora: o cartão sai (sem esperar o servidor nem reler a lista).
    void queryClientDaFaixa.cancelQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
    tirarDoCache(alvos.map((i) => i.id));
    if (tarefaId && alvos.some((i) => i.id === tarefaId)) onTarefa(null);
    // No fundo: o servidor arquiva uma a uma (as travas de sempre); o que ele recusa volta com o motivo.
    const feitas: ArquivadaDaFaixa[] = [];
    const recusadas: RecusadaDaFaixa[] = [];
    const noServidor = (async () => {
      await Promise.all(
        alvos.map(async (i) => {
          try {
            const r = await arquivarDaFaixa(clientId, i.id);
            feitas.push({ taskId: i.id, titulo: i.title, memoriaId: (r && r.memoria_id) || null, postId: (r && r.post_arquivado) || null });
          } catch (e) {
            recusadas.push({ taskId: i.id, titulo: i.title, motivo: textoDoErro(e) });
          }
        }),
      );
      for (const t of trabalhosDosAlvos) if (feitas.some((f) => f.taskId === t.task_id)) void tirarDaFila(t.id).catch(() => null);
      if (recusadas.length) {
        devolverAoCache(alvos.filter((i) => recusadas.some((r) => r.taskId === i.id)));
        toast.warning(recusadas.length === 1 ? `"${recusadas[0].titulo}" voltou para a faixa` : `${recusadas.length} pautas voltaram para a faixa`, {
          description: recusadas.map((r) => r.motivo).filter((m, k, l) => l.indexOf(m) === k).join(" ").slice(0, 400),
          duration: 12000,
        });
      }
      relerDepoisDeArquivar();
      void queryClientDaFaixa.invalidateQueries({ queryKey: chaveDosArquivados(clientId) });
    })();
    toast.success(alvos.length === 1 ? `Arquivada: ${alvos[0].title}` : `${alvos.length} pautas arquivadas`, {
      description: "Saíram da faixa, do mês e da fila. Ficam em Arquivados.",
      duration: 10000,
      action: {
        label: "Desfazer",
        onClick: () => {
          devolverAoCache(alvos);
          void (async () => {
            await noServidor;
            const avisos: string[] = [];
            for (const f of feitas) {
              try {
                const r = await restaurarDaFaixa(clientId, f);
                if (r && r.aviso) avisos.push(r.aviso);
              } catch (e) {
                avisarDaFaixa(e, `"${f.titulo}" não voltou`);
              }
            }
            relerDepoisDeArquivar();
            void queryClientDaFaixa.invalidateQueries({ queryKey: chaveDosArquivados(clientId) });
            if (avisos.length) toast.info("Pautas de volta", { description: avisos.join(" ") });
          })();
        },
      },
    });
  };

  /**
   * Frente EN: entregar as pautas marcadas na faixa, no modo escolhido, uma de
   * cada vez (a entrega abre lâminas e tem limite de CPU por chamada). As que
   * não têm todas as lâminas com arte ficam de fora; as aprovadas sem data
   * ficam no "sem data" da faixa.
   */
  const [entregandoLote, setEntregandoLote] = useState(false);
  const trabalhoDoItem = (id: string) => {
    const i = itens.filter((x) => x.id === id)[0] || (itemFora && itemFora.id === id ? itemFora : null);
    return i ? trabalhoDe(i) : null;
  };
  const prontasDaFaixa = (ids: string[]) => ids.filter((id) => prontaParaEntregar(trabalhoDoItem(id))).length;
  const entregarPautas = async (ids: string[], modo: ModoDeEntrega, mostrarAoCliente: boolean) => {
    const trabalhos = ids.map(trabalhoDoItem).filter((t): t is Trabalho => prontaParaEntregar(t));
    if (!trabalhos.length) {
      toast.info("Nenhuma das marcadas está pronta", { description: "Gere todas as lâminas antes de entregar." });
      return;
    }
    const titulo = modo === "pronto" ? "Aprovar pelo cliente e agendar" : modo === "aprovacao" ? "Entregar e enviar para aprovação" : "Só entregar em Arquivos";
    const ok = await confirmarDaFaixa({
      title: `${titulo}: ${trabalhos.length} ${trabalhos.length === 1 ? "peça" : "peças"}?`,
      description:
        modo === "pronto"
          ? "O cliente deu o aval: cada peça vai para Arquivos, fica aprovada em nome dele (no histórico dele, aprovado por você) e entra na Agenda na data do conteúdo. As que não tiverem data ficam em \"sem data\"."
          : modo === "aprovacao"
            ? "Cada peça vai para Arquivos e segue para a aprovação de sempre."
            : mostrarAoCliente
              ? "Cada peça vai para Arquivos, visível ao cliente, sem aprovação e sem post na Agenda."
              : "Cada peça vai para Arquivos, sem aprovação e sem post na Agenda.",
      confirmLabel: "Entregar",
    });
    if (!ok) return;
    setEntregandoLote(true);
    const aviso = toast.loading(`Entregando 0 de ${trabalhos.length}…`);
    try {
      const r = await entregarVarias(
        trabalhos.map((t) => t.id),
        modo,
        { mostrarAoCliente },
        {},
        (feitas, total) => toast.loading(`Entregando ${feitas} de ${total}…`, { id: aviso }),
      );
      const resumo = resumoDoLote(r);
      if (resumo.tudoCerto) toast.success(resumo.titulo, { id: aviso, description: resumo.detalhe || undefined, duration: 10000 });
      else toast.warning(resumo.titulo, { id: aviso, description: resumo.detalhe || undefined, duration: 15000 });
    } finally {
      setEntregandoLote(false);
      relerDepoisDeArquivar();
      void queryClientDaFaixa.invalidateQueries({ queryKey: chaveDasAprovadasSemData(clientId) });
      void queryClientDaFaixa.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    }
  };

  const escolher = (id: string) => {
    gravarUltimo(clientId, id);
    onTarefa(id);
    // No computador, a página desce até o estúdio ocupar a tela abaixo da barra da Mesa.
    if (colunas) encaixarNaJanela(areaDoEstudio.current);
  };

  // Frente AE-2 (dono: "sem linha nova"): Pautas | Arte rápida entra na barra da faixa e na do histórico.
  const modoDoEstudio = <ModoDoEstudio modo={alvoRapido ? "rapida" : "pautas"} onModo={(m) => irParaRapida(m === "rapida" ? NOVA_ARTE_RAPIDA : null, ["fotos"])} className="mb-1 mr-2 mt-1" />;

  const faixaDasPautas = (
    <EstudioLista
      janela={janela}
      meses={meses}
      onJanela={escolherJanela}
      filtro={filtro}
      onFiltro={setFiltro}
      itens={itens}
      itemFora={itemFora}
      fontes={fontesDaFaixa}
      carregando={dados.isLoading}
      atualizando={dados.isPlaceholderData}
      erro={dados.isError ? dados.error : null}
      tarefaId={selecionado ? selecionado.id : aberto}
      onEscolher={escolher}
      recolhida={recolhida}
      onRecolher={setRecolhida}
      arquivar={{ onArquivar: (ids) => void arquivarPautas(ids), parecidas }}
      entregar={{ podeLiberar: podeRecarregar, prontas: prontasDaFaixa, onEntregar: (ids, modo, mostrar) => void entregarPautas(ids, modo, mostrar), ocupado: entregandoLote }}
      inicio={modoDoEstudio}
      extra={<><AprovadasSemData /><ArquivadosDaFaixa onMudou={relerDepoisDeArquivar} /></>}
    />
  );

  const detalhe = selecionado ? (
    <Suspense fallback={<p role="status">Abrindo o estúdio…</p>}>
    <EstudioDaPauta onPautaPronta={(id) => { onTarefa(id); void dados.refetch(); }} key={selecionado.id} item={selecionado} trabalho={trabalhoDe(selecionado)} roteiro={roteiroDe(selecionado)} arte={arteDe(selecionado)} foco={focoLigado} onFoco={setFoco}>
    <DetalheDoItem
      key={selecionado.id}
      item={selecionado}
      trabalho={trabalhoDe(selecionado)}
      arte={arteDe(selecionado)}
      roteiro={roteiroDe(selecionado)}
      temRoteiro={temRoteiroDe(selecionado)}
      publicacaoDe={publicacaoDe}
      modo={colunas ? "colunas" : "pilha"}
      foco={focoLigado}
      onFoco={setFoco}
    />
    </EstudioDaPauta>
    </Suspense>
  ) : null;

  const carregando = dados.isLoading || (!!tarefaId && !selecionado && (avulso.isLoading || avulso.isFetching));
  const vazio = itemDeOutraMarca ? (
    <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center rounded-xl border border-warning/50 bg-warning/5 p-6 text-center" role="status" data-item-de-outra-marca="">
      <p className="text-[14px] font-semibold">Este item é de outra marca</p>
      <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">Troque a marca no topo da Mesa para abrir. O Estúdio mostra e gera só a marca {marcaAberta ? marcaAberta.nome : "aberta"}, com o kit dela.</p>
    </div>
  ) : (
    <SemPauta carregando={carregando} vazia={listaPronta && itens.length === 0} />
  );


  if (alvoRapido) {
    return (
      <EstudioArteRapida
        alvo={alvoRapido}
        onAlvo={(alvo, limpar) => irParaRapida(alvo, limpar)}
        colunas={colunas}
        altura={altura}
        refDaAltura={cabe.ref}
        foco={focoLigado}
        alturaDaJanela={alturaDaJanela}
        topo={modoDoEstudio}
        onAbrirItem={(taskId) => {
          const p = new URLSearchParams(parametrosDoModo.toString());
          p.delete(PARAMETRO_DA_ARTE_RAPIDA);
          p.delete("fotos");
          p.set("task", taskId);
          setParametrosDoModo(p);
        }}
        renderPeca={(peca) => (
          <DetalheDoItem
            key={peca.item.id}
            item={peca.item}
            trabalho={peca.trabalho}
            arte={null}
            roteiro={null}
            temRoteiro={false}
            publicacaoDe={() => null}
            modo={colunas ? "colunas" : "pilha"}
            foco={focoLigado}
            onFoco={setFoco}
            rapida={peca.rapida}
          />
        )}
      />
    );
  }

  // Tela cheia: a faixa de pautas e o topo saem; o estúdio ocupa a janela, estático, até o Voltar ou o Esc.
  if (focoLigado && detalhe) {
    return (
      <div ref={raiz} className="fixed inset-0 z-40 flex flex-col bg-background p-2" role="region" aria-label="Estúdio em tela cheia" data-estudio-foco="">
        <div className="flex min-h-0 min-w-0 flex-col" style={{ height: Math.max(480, alturaDaJanela - 16) }}>
          {detalhe}
        </div>
      </div>
    );
  }

  if (colunas) {
    return (
      // Frente AE-2 (dono, 28/09: "rolagem certinha, sem quebrar"): no computador o Estúdio inteiro
      // (faixa + estúdio) ocupa a altura da tela abaixo da barra da Mesa e a página não rola; cada
      // região rola por dentro (a tira da faixa para o lado, a prancheta, a lâmina e o painel).
      <div ref={cabe.ref} className="flex min-h-0 min-w-0 flex-col" style={altura ? { height: altura } : undefined} data-estudio-tela="colunas">
        <div className="shrink-0">{faixaDasPautas}</div>
        <div ref={areaDoEstudio} className="mt-1.5 flex min-h-0 min-w-0 flex-1 flex-col">
          {detalhe || vazio}
        </div>
      </div>
    );
  }

  // Celular e tablet em pé: uma coluna; a faixa em cima e o estúdio embaixo, a página rola.
  return (
    <div ref={raiz} className="min-w-0 space-y-3">
      {faixaDasPautas}
      {detalhe || vazio}
    </div>
  );
}

/** Altura da janela (px), atualizada no resize enquanto `ativo`. */
function useAlturaDaJanela(ativo: boolean): number {
  const [altura, setAltura] = useState<number>(() => (typeof window !== "undefined" ? window.innerHeight || 800 : 800));
  useEffect(() => {
    if (!ativo) return;
    const medir = () => setAltura(window.innerHeight || 800);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [ativo]);
  return altura;
}

