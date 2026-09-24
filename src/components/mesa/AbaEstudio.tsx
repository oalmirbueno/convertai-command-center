import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  MessageSquare,
  PenLine,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Type,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
  ErroDaMesa,
  estimarLocal,
  inicioDoMes,
  modelosAtivos,
  nomeDoModelo,
  padraoPara,
  precoDoModelo,
  somarMeses,
  TAMANHOS,
  textoDoErro,
  usd,
  type ModeloIa,
  type ParteDaEstimativa,
  type Qualidade,
} from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import CardDoEstudio, { type OpcoesDoAjuste, type PainelDaLamina } from "./CardDoEstudio";
import DiretorDoEstudio from "./DiretorDoEstudio";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import { emColunas, encaixarNaJanela, rolarAte, useAlturaDaEsteira, useFaixa } from "./EstudioAltura";
import EstudioArteDaAgenda, { InspetorDaArte } from "./EstudioArteDaAgenda";
import EstudioEntrega from "./EstudioEntrega";
import EstudioFotos from "./EstudioFotos";
import EstudioLaminaGrande from "./EstudioLaminaGrande";
import EstudioLista, { DICA_DO_ROTEIRO, formatoDoItem, SeloDoItem, type FontesDaLista } from "./EstudioLista";
import EstudioPreparar from "./EstudioPreparar";
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
import { useMesa } from "./MesaContexto";
import PranchetaDoEstudio, { AVISO_DA_ORDEM_NO_CONTINUO, estaConferindo, type AndamentoDaLamina, type EtapaDaLamina } from "./PranchetaDoEstudio";
import { chaveDoCorrigirSozinho, conferirECorrigir, type DecisaoDeAutocorrecao } from "./autocorrecaoDaLamina";
import ReferenciasDoEstudio, { type AlvoDasReferencias } from "./ReferenciasDoEstudio";
import {
  copiarTexto,
  corpoDoPreparar,
  enviarUmParaAprovacao,
  legendaParaCopiar,
  normalizarHashtags,
  NOTA_DO_FUNDO_CONTINUO,
  partesDoPanorama,
  useEstadoGuardado,
  usaFundoContinuo,
  type Area,
  type EscolhasDoPreparo,
} from "./estudioUtil";
import {
  FORMATOS_POST_UNICO,
  PROXIMOS_DIAS,
  ultimasVersoes,
  useItemAvulso,
  useItensDoMes,
  type ArteNaAgenda,
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
 */

const CODIGOS_QUE_NAO_PARAM_A_FILA = ["acao_desconhecida", "servico_indisponivel"];
const CODIGOS_QUE_PARAM_TUDO = ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave"];
const EM_PARALELO = 3;
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
}: {
  item: ItemDoMes;
  trabalho: Trabalho | null;
  arte: ArteNaAgenda | null;
  roteiro: InfoDoRoteiro | null;
  temRoteiro: boolean;
  publicacaoDe: (postId: string) => PublicacaoDoPost | null;
  /** "colunas": altura fixa e rolagem por área; "pilha": a página rola. */
  modo: "colunas" | "pilha";
}) {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const avisarErro = useAvisarErro();
  const chave = `mesa:estudio:${item.id}`;
  const colunas = modo === "colunas";
  const ehDesign = !mesa.podeRecarregar;
  const [modeloImagem, setModeloImagem] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("media");
  const [legenda, setLegenda] = useState("");
  const [hashtagsTexto, setHashtagsTexto] = useState("");
  const [salvandoLegenda, setSalvandoLegenda] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  // O andamento de cada lâmina (fila, gerando, ajustando, conferindo): a fonte do indicador único da prancheta.
  const [andamento, setAndamento] = useState<Record<number, AndamentoDaLamina>>({});
  const [emLote, setEmLote] = useState(false);
  const [pedidoAoDiretor, setPedidoAoDiretor] = useState("");
  const [salvandoContinuo, setSalvandoContinuo] = useState(false);
  const [versaoVista, setVersaoVista] = useState<number | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [refazendo, setRefazendo] = useState(false);
  // Guardados na sessão: voltar de outra aba devolve a mesma lâmina, o mesmo painel e a mesma ferramenta.
  const [selecionado, setSelecionado] = useEstadoGuardado<number | null>(`${chave}:lamina`, null);
  const [painel, setPainel] = useEstadoGuardado<PainelDaLamina>(`${chave}:painel`, "direcao");
  const [ferramentaGuardada, setFerramenta] = useEstadoGuardado<Ferramenta | "">(`${chave}:ferramenta`, "lamina");
  const [refsAlvo, setRefsAlvo] = useEstadoGuardado<AlvoDasReferencias>(`${chave}:refs-alvo`, "conjunto");
  const [refsAba, setRefsAba] = useEstadoGuardado<"cliente" | "banco">(`${chave}:refs-aba`, "cliente");
  // "Corrigir sozinho": desligado por padrão (24/09/2026: a correção automática triplicava o custo); guardado por trabalho na sessão.
  const [corrigirSozinho, setCorrigirSozinho] = useEstadoGuardado<boolean>(chaveDoCorrigirSozinho(trabalho ? trabalho.id : `item:${item.id}`), false);
  const parar = useRef(false);
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setModeloImagem(trabalho?.modelo_imagem_id || padraoPara(catalogo, "imagem")?.id || "");
    setQualidade((trabalho?.qualidade as Qualidade) || "media");
    setLegenda(trabalho?.legenda || "");
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
    mesa.atualizarCusto();
  };

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
    try {
      // Contínuo: o fundo panorâmico do trecho nasce antes, numa chamada própria
      // (cabe no tempo da função); a lâmina depois só recebe o texto por cima.
      let custoFundo = 0;
      if (infinito) {
        // Um panorama por chamada: com trecho anterior faltando, o servidor faz ele
        // primeiro e devolve pendente; a tela chama de novo (no máximo 4 vezes).
        for (let vez = 0; vez < 4; vez++) {
          const f = await chamarFuncao<any>("estudio-arte", { acao: "preparar_fundo", trabalho_id: trabalhoId, ordem });
          custoFundo += custoDaResposta(f) || 0;
          if (!f || !f.pendente) break;
        }
      }
      const g = await chamarFuncao<any>("estudio-arte", { acao: "gerar_card", trabalho_id: trabalhoId, ordem });
      atualizar();
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
  const infinito = !!trabalho?.direcao?.carrossel_infinito;
  // No contínuo, as lâminas dividem o mesmo panorama: enquanto uma gera,
  // refazer outra pediria o mesmo trecho de fundo duas vezes (cobra dobrado).
  const laminaOcupada = (ordem: number) => !!andamento[ordem] || entregando || (infinito && algoGerando);
  const progresso = cardsDaDirecao.length ? Math.round((laminasComArte / cardsDaDirecao.length) * 100) : 0;
  const entregue = !!trabalho && (trabalho.status === "entregue" || trabalho.entrega_status === "agendado");
  const estado: EstadoDoItem = cardsDaDirecao.length > 0 ? "producao" : arte && !refazendo ? "agenda" : "preparar";
  // No contínuo a ordem faz parte da cena (o panorama foi cortado nela): reordenar fica travado.
  const ordemTravada = infinito && cardsDaDirecao.length > 1;

  // Estimativa do contínuo: o panorama que falta entra no preço (mesma regra de
  // trechos do servidor; só com o editor da OpenAI e lâmina sem foto própria).
  const modeloDoFundo = catalogo.find((m) => m.id === modeloImagem);
  const comFundoContinuo = ordemTravada && !!modeloDoFundo && modeloDoFundo.provedor === "openai";
  const fundosProntos = (((trabalho?.direcao as any)?.panorama?.fundos ?? null) as Record<string, string> | null);
  const partesDoFundo = (ordens: number[], q: Qualidade = qualidade): ParteDaEstimativa[] => {
    if (!comFundoContinuo) return [];
    const comFundo = ordens.filter((o) => {
      const c = cardsDaDirecao.find((x) => x.ordem === o);
      return !!c && usaFundoContinuo(c);
    });
    return partesDoPanorama(comFundo, cardsDaDirecao.length, fundosProntos, modeloImagem, q);
  };
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
    parar.current = false;
    setEmLote(true);
    const agora = Date.now();
    setAndamento((a) => {
      const n = { ...a };
      for (const o of ordens) if (!n[o]) n[o] = { etapa: "fila", desde: agora };
      return n;
    });
    const limite = infinito ? 1 : EM_PARALELO;
    let proximo = 0;
    let total = 0;
    const falhas: unknown[] = [];
    const conferencias: Promise<number>[] = [];
    const trabalhador = async () => {
      while (proximo < ordens.length && !parar.current) {
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
    const r = await chamarFuncao<any>(
      "estudio-arte",
      corpoDoPreparar(item.id, escolhas, { postUnico, modeloImagemId: modeloImagem || undefined, qualidade }),
    );
    if (escolhas.modo === "roteiro") toast.success("Direção montada do roteiro", { description: "Sem custo de IA. Confira as lâminas na prancheta e gere." });
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
      });
      atualizar();
      custo = custoDaResposta(a) || 0;
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
    await chamarFuncao("estudio-arte", { acao: "configurar", trabalho_id: trabalho.id, ...corpo });
    atualizar();
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

  /** Entrega em Arquivos e, se pedido, já envia para aprovação (mesmo caminho da aba Entrega). */
  const entregar = async (tambemEnviar: boolean) => {
    if (!trabalho) return;
    setEntregando(true);
    setErroDoEnvio(null);
    try {
      // Legenda que não gravou: não entrega com a legenda antiga do banco.
      if (legendaMudou && !(await salvarLegenda(true))) return;
      await chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: trabalho.id });
      if (tambemEnviar) {
        try {
          await enviarUmParaAprovacao(trabalho.id);
          toast.success(ehDesign ? "Entregue e enviado para a revisão da agência" : "Entregue e enviado para aprovação");
        } catch (e) {
          setErroDoEnvio(textoDoErro(e));
          toast.error("Entregue em Arquivos, mas o envio para aprovação falhou", { description: textoDoErro(e) });
        }
      } else {
        toast.success("Entregue em Arquivos", { description: "O envio para aprovação fica aqui mesmo, na ferramenta Entrega." });
      }
      atualizar();
      void queryClient.invalidateQueries({ queryKey: ["mesa", "previsao", clientId] });
    } catch (e) {
      avisarErro(e, "Não foi possível entregar");
    } finally {
      setEntregando(false);
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

  // Ver grande: todas as lâminas com arte; a escolhida na versão que está na tela.
  const paraAmpliar: { ordem: number; imagem: ImagemAmpliavel }[] = cardsDaDirecao
    .filter((c) => ultimas.has(c.ordem))
    .map((c) => {
      const lista = (trabalho?.cards || []).filter((v) => v.ordem === c.ordem);
      const vista = c.ordem === selecionado && versaoVista !== null ? lista.find((v) => v.versao === versaoVista) || ultimas.get(c.ordem)! : ultimas.get(c.ordem)!;
      return { ordem: c.ordem, imagem: { caminho: vista.storage_path, titulo: `Lâmina ${c.ordem} · v${vista.versao}`, proporcao: 0.8 } };
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

  const seletorDeQualidade = (
    <div className="mb-1 mr-2 mt-1 grid shrink-0 grid-cols-3 gap-0.5 rounded-lg border border-border bg-background p-0.5" role="radiogroup" aria-label="Qualidade da lâmina">
      {QUALIDADES_DO_ESTUDIO.map((q) => {
        const ativa = qualidade === q.valor;
        return (
          <button
            key={q.valor}
            type="button"
            role="radio"
            aria-checked={ativa}
            disabled={emLote}
            title={`${q.rotulo}: ${q.dica}${precos[q.valor] ? `, cerca de ${precos[q.valor].slice(1)} por lâmina${filaComFundo ? ` (${NOTA_DO_FUNDO_CONTINUO.toLowerCase()})` : ""}` : ""}`}
            onClick={() => { setQualidade(q.valor); void guardarEscolha({ qualidade: q.valor }); }}
            className={`flex h-10 min-w-[72px] flex-col items-center justify-center rounded-md px-2 leading-tight transition-colors ${
              ativa ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <span className={`text-[11.5px] ${ativa ? "font-medium" : ""}`}>{q.rotulo}</span>
            <span className={`text-[10px] tabular-nums ${ativa ? "text-primary-foreground/80" : "text-muted-foreground"}`} data-preco-da-qualidade={q.valor}>
              {precos[q.valor] || "sem preço"}
            </span>
          </button>
        );
      })}
    </div>
  );

  const seletorDeGerador = (
    <div className="mb-1 mr-2 mt-1 w-[150px] min-w-0 shrink-0">
      <Select value={modeloImagem || ""} onValueChange={(id) => { setModeloImagem(id); void guardarEscolha({ modelo_imagem_id: id }); }} disabled={emLote || opcoesDeImagem.length === 0}>
        <SelectTrigger className="h-10 min-w-0 text-[12px]" aria-label="Gerador de imagem" title="Gerador de imagem">
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

  const chaveCorrigirSozinho = (
    <button
      type="button"
      role="switch"
      aria-checked={corrigirSozinho}
      onClick={() => setCorrigirSozinho((c) => !c)}
      className={`mb-1 mr-2 mt-1 inline-flex h-10 shrink-0 items-center rounded-lg border px-2.5 text-[12px] ${corrigirSozinho ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground"}`}
      title="Depois de gerar ou ajustar, se a conferência achar erro de texto, logo ou identidade, o estúdio corrige sozinho (até 2 vezes) antes de mostrar a lâmina."
    >
      <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Corrigir sozinho{corrigirSozinho ? "" : " (desligado)"}
    </button>
  );

  /** Pedido do dono (24/09): o diretor de arte à mão, para conversar sobre estilo, cenário e luz. */
  const botaoDoDiretor = (
    <Button
      type="button"
      size="sm"
      variant={ferramenta === "diretor" ? "default" : "outline"}
      className="mb-1 mr-2 mt-1 h-10 shrink-0 gap-1 px-3 text-[12.5px]"
      onClick={() => abrirFerramenta("diretor")}
      aria-pressed={ferramenta === "diretor"}
      title="Converse com o diretor de arte para mudar o estilo, o cenário, a luz ou as cores. Ele lê o conteúdo e propõe mudanças que você aplica com um clique."
    >
      <MessageSquare className="h-3.5 w-3.5" /> Conversar com o diretor
    </Button>
  );

  const acaoPrincipal = (
    <div className="mb-1 mt-1 flex shrink-0 items-center">
      {emLote ? (
        <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => { parar.current = true; }} title="Para depois das lâminas que já estão gerando">
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
                  : `Gerar as que faltam (${semImagem.length})`
                : "Refazer todas"}
            </>
          }
          titulo={`Gerar ${filaDeGeracao.length} lâmina(s)`}
          descricao={infinito
            ? comNotaDoFundo("Carrossel contínuo: uma lâmina de cada vez, porque cada uma continua a anterior. A conferência roda logo depois de cada uma.", ordensDaFila)
            : corrigirSozinho
              ? "Até 3 lâminas ao mesmo tempo. A conferência de ortografia e identidade roda logo depois de cada uma e, se achar erro, o estúdio corrige sozinho (até 2 vezes) antes de mostrar. Cada correção custa um ajuste a mais."
              : "Até 3 lâminas ao mesmo tempo. A conferência de ortografia e identidade roda logo depois de cada uma."}
          fecharAoConfirmar
          variant={semImagem.length ? "default" : "outline"}
          className="h-10 gap-1 px-3 text-[12.5px]"
          disabled={ocupado || entregue}
          partes={() => partesGerar(filaDeGeracao.length).concat(partesDoFundo(ordensDaFila))}
          executar={() => gerarVarias(filaDeGeracao.map((c) => c.ordem))}
          aoConcluir={(data) => {
            toast.success(data?.parado ? "Geração parada" : "Lâminas geradas", { description: `Custo real: ${usd(custoDaResposta(data) || 0)}.` });
          }}
        />
      )}
      {prontoParaEntregar && !emLote && (
        <Button type="button" size="sm" className="ml-2 h-10 gap-1 px-3 text-[12.5px]" onClick={() => abrirFerramenta("entrega", false)} title="Abre a ferramenta Entrega">
          <Send className="h-3.5 w-3.5" /> Entregar
        </Button>
      )}
    </div>
  );

  const barraDoItem = (
    <div className="shrink-0 border-b border-border">
      <div className="flex min-w-0 flex-wrap items-center px-3 py-1.5">
        <div className="mb-1 mr-3 mt-1 flex min-w-[200px] flex-1 items-center">
          {temRoteiro && (
            <span title={DICA_DO_ROTEIRO} className="mr-1.5 shrink-0">
              <Star className="h-4 w-4 fill-warning text-warning" aria-label={DICA_DO_ROTEIRO} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold leading-tight" title={item.title}>{item.title}</h2>
            <p className="mt-0.5 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
              <span className="truncate">{dataCurta(item.due_date)} · {formatoDoItem(item)}</span>
              <SeloDoItem tom={situacao.tom} className="ml-2 shrink-0">{situacao.rotulo}</SeloDoItem>
              {trabalho && trabalho.custo_usd > 0 && (
                <span className="ml-2 shrink-0 tabular-nums" title="Gasto de IA neste item">{usd(trabalho.custo_usd)}</span>
              )}
            </p>
          </div>
        </div>
        {estado === "producao" && (
          <>
            {seletorDeQualidade}
            {seletorDeGerador}
            {chaveCorrigirSozinho}
            {botaoDoDiretor}
            {acaoPrincipal}
          </>
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

  const avisoDeAjuste =
    trabalho?.entrega_status === "reprovado" && trabalho.status !== "entregue" ? (
      <button
        type="button"
        onClick={() => abrirFerramenta("entrega", false)}
        className="mb-3 w-full rounded-lg border border-warning/50 bg-background px-3 py-2 text-left text-[12px] leading-snug [overflow-wrap:anywhere]"
      >
        <span className="font-semibold text-warning">Pediram ajuste</span>
        {trabalho.entrega_aviso ? `: “${trabalho.entrega_aviso}”` : ". Ajuste as lâminas e entregue de novo."}
      </button>
    ) : null;

  const acoesDaPrancheta = (c: { ordem: number }, v: unknown) => (
    <BotaoComCusto
      rotulo={<><Wand2 className="h-3.5 w-3.5" /><span className="sr-only">{v ? "Refazer" : "Gerar"} a lâmina {c.ordem}</span></>}
      titulo={`${v ? "Refazer" : "Gerar"} a lâmina ${c.ordem}`}
      descricao={comNotaDoFundo(`${v ? "Refazer" : "Gerar"} a lâmina ${c.ordem}. A conferência roda logo depois.`, [c.ordem])}
      variant={v ? "outline" : "default"}
      className="h-8 w-full gap-1 px-2 text-[11px]"
      disabled={laminaOcupada(c.ordem) || entregue}
      partes={() => partesGerar(1).concat(partesDoFundo([c.ordem]))}
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
    />
  ) : null;

  const centroDaProducao = colunas ? (
    <>
      <div className="flex min-h-0 shrink-0 flex-col border-r border-border" style={{ width: LARGURA_NA_PRANCHETA + 32 }}>
        <p className="flex h-9 shrink-0 items-center px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground" title={ordemTravada ? `Lâminas: clique escolhe, duplo clique amplia. ${AVISO_DA_ORDEM_NO_CONTINUO}` : "Lâminas: clique escolhe, duplo clique amplia, arraste pela alça muda a ordem"}>
          Prancheta
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
          <p className="mb-2 text-[11px] leading-snug text-muted-foreground">{resumoDaPrancheta}</p>
          {prancheta(true)}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4">
        {avisoDeAjuste}
        {laminaGrande}
      </div>
    </>
  ) : (
    <div className="flex min-w-0 flex-col p-3">
      {avisoDeAjuste}
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
      partesGerar={() => partesGerar(1).concat(partesDoFundo([cardSelecionado.ordem]))}
      notaDoGerar={partesDoFundo([cardSelecionado.ordem]).length ? `${NOTA_DO_FUNDO_CONTINUO}.` : undefined}
      partesAjustar={partesAjustar}
      partesConferir={partesConferir}
      onGerar={() => gerarEConferir(cardSelecionado.ordem)}
      onAjustar={(instrucao, opcoes) => ajustar(cardSelecionado.ordem, instrucao, opcoes)}
      onConferir={() => conferir(trabalho.id, cardSelecionado.ordem)}
      onCorrigir={() => corrigirDeNovo(cardSelecionado.ordem)}
      partesCorrigir={() => partesAjustar().concat(partesConferir())}
      onConfigurar={(card) => configurar({ card: { ordem: cardSelecionado.ordem, ...card } })}
      onConcluido={atualizar}
    />
  ) : (
    <p className="text-[12.5px] text-muted-foreground">Escolha uma lâmina na prancheta.</p>
  );

  /** Refazer depois de aplicar: no contínuo com a cena nova, o fundo panorâmico inteiro entra no preço. */
  const partesDoRefazer = (ordens: number[], refazFundo: boolean): ParteDaEstimativa[] => {
    const fundo = refazFundo && comFundoContinuo
      ? partesDoPanorama(ordens.filter((o) => cardsDaDirecao.some((c) => c.ordem === o && usaFundoContinuo(c))), cardsDaDirecao.length, null, modeloImagem, qualidade)
      : partesDoFundo(ordens);
    return partesGerar(ordens.length).concat(fundo);
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
      className="h-full"
    />
  ) : null;

  const ferramentaFotos = cardSelecionado && trabalho ? (
    <div className="min-w-0 space-y-3">
      <p className="text-[12.5px] font-semibold">Lâmina {cardSelecionado.ordem}</p>
      <EstudioFotos
        key={cardSelecionado.ordem}
        card={cardSelecionado}
        ocupado={laminaOcupada(cardSelecionado.ordem) || entregue}
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
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
        <p className="text-[12.5px] font-medium leading-snug">As escolhidas aqui são seguidas de perto</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
          O gerador copia o layout, a composição, a hierarquia e o tratamento das referências escolhidas e aplica a identidade visual da marca, com uma
          diferenciação leve. As da lâmina valem no lugar das do conjunto.
        </p>
        <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
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

      {cardsDaDirecao.length > 1 && (
        <label className="flex cursor-pointer items-start rounded-lg border border-border bg-background px-3 py-2.5">
          <Switch checked={infinito} onCheckedChange={(v) => void alternarContinuo(v)} disabled={salvandoContinuo || algoGerando || entregue} className="mr-3 mt-0.5 shrink-0" aria-label="Carrossel contínuo" />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium">Carrossel contínuo</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">A cena atravessa as lâminas, como um panorama. Gera uma de cada vez.</span>
          </span>
        </label>
      )}
      {infinito && cardsDaDirecao.length > 1 && (
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
        {entregue && <p className="text-[11.5px] text-muted-foreground">Arte já entregue: a direção não muda mais neste trabalho.</p>}
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
          partes={() => [{ modeloId: diretor?.id, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida }]}
          executar={() => chamarFuncao("estudio-arte", { acao: "legenda", trabalho_id: trabalho.id })}
          aoConcluir={(data) => {
            if (typeof data?.legenda === "string") setLegenda(data.legenda);
            if (Array.isArray(data?.hashtags)) setHashtagsTexto(normalizarHashtags(data.hashtags).join(" "));
            atualizar();
          }}
        />
      </div>
      <Textarea
        value={legenda}
        onChange={(e) => setLegenda(e.target.value)}
        onBlur={salvarAoSair}
        rows={9}
        placeholder="A legenda do post aparece aqui. Dá para editar à mão; grava sozinha ao sair do campo."
        className="text-[13px] leading-relaxed"
        disabled={entregue}
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

  const ferramentaEntrega = trabalho ? (
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
      onEntregar={(tambemEnviar) => void entregar(tambemEnviar)}
      onEnviar={() => void enviarAgora()}
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
  const { clientId } = useMesa();
  const faixa = useFaixa();
  const colunas = emColunas(faixa);
  const altura = useAlturaDaEsteira(colunas);
  const raiz = useRef<HTMLDivElement>(null);
  const areaDoEstudio = useRef<HTMLDivElement>(null);
  // A lista abre nos próximos 60 dias; escolher um mês muda para aquele mês (e a URL acompanha).
  const [modoDaLista, setModoDaLista] = useEstadoGuardado<"proximos" | "mes">(`mesa:estudio:lista:${clientId}`, "proximos");
  const [filtroGuardado, setFiltro] = useEstadoGuardado<Filtro>(`mesa:estudio:filtro:${clientId}`, "a_fazer");
  const [recolhida, setRecolhida] = useEstadoGuardado<boolean>("mesa:estudio:pautas-recolhidas", false);
  const filtro = filtroValido(filtroGuardado);
  const janela = modoDaLista === "proximos" ? PROXIMOS_DIAS : mes;
  const dados = useItensDoMes(clientId, janela);
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
  const selecionado = naLista || itemFora;
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

  const escolher = (id: string) => {
    gravarUltimo(clientId, id);
    onTarefa(id);
    // No computador, a página desce até o estúdio ocupar a tela abaixo da barra da Mesa.
    if (colunas) encaixarNaJanela(areaDoEstudio.current);
  };

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
    />
  );

  const detalhe = selecionado ? (
    <DetalheDoItem
      key={selecionado.id}
      item={selecionado}
      trabalho={trabalhoDe(selecionado)}
      arte={arteDe(selecionado)}
      roteiro={roteiroDe(selecionado)}
      temRoteiro={temRoteiroDe(selecionado)}
      publicacaoDe={publicacaoDe}
      modo={colunas ? "colunas" : "pilha"}
    />
  ) : null;

  const carregando = dados.isLoading || (!!tarefaId && !selecionado && (avulso.isLoading || avulso.isFetching));
  const vazio = <SemPauta carregando={carregando} vazia={listaPronta && itens.length === 0} />;

  if (colunas) {
    return (
      <div ref={raiz} className="flex min-w-0 flex-col">
        {/* A faixa de pautas fica fora da conta de altura: o estúdio sozinho
            ocupa uma tela inteira abaixo da barra da Mesa e a página rola
            entre os dois (antes os dois dividiam uma tela e a lâmina cortava). */}
        <div className="shrink-0">{faixaDasPautas}</div>
        <div ref={areaDoEstudio} className="mt-3 flex min-h-0 min-w-0 flex-col" style={altura ? { height: altura } : undefined}>
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
