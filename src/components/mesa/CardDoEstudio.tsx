import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  CircleDashed,
  Crop,
  Eraser,
  FileText,
  Fingerprint,
  History,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  MessagesSquare,
  Paintbrush,
  Pencil,
  PenTool,
  RotateCw,
  ScanSearch,
  ShieldAlert,
  SpellCheck,
  Stamp,
  TextCursorInput,
  TriangleAlert,
  Undo2,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { botao, Etapas, juntar } from "@/components/sistema";
import { dataEHora, ErroDaMesa, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { BotaoComCusto } from "./Custo";
import { rolarAte } from "./EstudioAltura";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { useAnexos, ZonaDeAnexos } from "./AnexosDoPedido";
import AnexosComPapel, { anexosComPapel, corpoDosAnexos, usePapeisDosAnexos } from "./AnexosComPapel";
import { esquecerRegraDoEstudio } from "./diretorDoEstudioApi";
import type { AnexoPedido } from "../../../supabase/functions/estudio-arte/anexos-do-ajuste";
import Moldura45 from "./Moldura45";
import { funcaoDaLamina } from "./PranchetaDoEstudio";
import SeletorDoAcervo, { FotoDoAcervo, useAcervo } from "./SeletorDoAcervo";
import type { Area } from "./estudioUtil";
import { rotuloDaVersao } from "./fidelidadeDaReferencia";
import type { CardDaDirecao, CardGerado, Verificacao } from "./useItensDoMes";

/**
 * Ferramenta "Lâmina" do Estúdio (painel deslizante da barra de
 * ferramentas). A imagem grande fica no centro da tela
 * (EstudioLaminaGrande); aqui ficam, numa coluna só e nesta ordem: gerar ou
 * refazer, a conferência numa linha de selos, o texto exato (editável), os
 * três ajustes (pedido livre, uma área marcada na lâmina grande, só o fundo)
 * e as versões em miniatura. As fotos reais para compor têm ferramenta
 * própria (EstudioFotos).
 *
 * O texto exato fica AO LADO da arte, como conferência, nunca desenhado por
 * cima dela. Tudo que gasta passa pelo BotaoComCusto, com o preço ao lado.
 * Com a lâmina em andamento, os botões ficam só desabilitados, sem girar:
 * o indicador da lâmina é um só, na prancheta.
 */

export type PainelDaLamina = "direcao" | "livre" | "areas" | "fundo" | "versoes";

export interface OpcoesDoAjuste {
  areas?: Area[];
  tipo?: "livre" | "fundo";
  imagem_id?: string;
  /** Frente RO, fase 2: imagens anexadas com o papel (estilo, elemento, foto exata, rosto, logo, print do erro). */
  anexos?: AnexoPedido[];
  /** Frente RO, fase 2: aplicar a proposta que o diretor fez para um pedido vago (sem perguntar de novo). */
  confirmado?: boolean;
}

// O estúdio grava a identidade como { nota, escala_max } (Score do Jev de 0 a escala_max).
const pct = (v: unknown): number | null => {
  if (typeof v !== "object" || v === null) return null;
  const nota = Number((v as any).nota ?? (v as any).score);
  const max = Number((v as any).escala_max);
  if (!Number.isFinite(nota) || !Number.isFinite(max) || max <= 0) return null;
  return Math.round(Math.max(0, Math.min(1, nota / max)) * 100);
};

/**
 * Selo da conferência (16/10/2026, dono: "menos texto, só o ícone"): o ícone
 * na cor do resultado, sem fundo nem borda; o nome mora no title e no leitor
 * de tela. Número (identidade) continua à vista ao lado do ícone.
 */
function Selo({ tom, icone, valor, titulo }: { tom: "ok" | "alerta" | "erro" | "neutro"; icone: ReactNode; valor?: string; titulo: string }) {
  const cor = tom === "ok" ? "text-success" : tom === "alerta" ? "text-warning" : tom === "erro" ? "text-destructive" : "text-muted-foreground";
  return (
    <span role="img" aria-label={titulo} title={titulo} className={`mr-2 inline-flex h-5 shrink-0 items-center whitespace-nowrap text-[11px] font-medium ${cor}`}>
      <span className="inline-flex shrink-0" aria-hidden="true">{icone}</span>
      {valor && <span className="ml-0.5 tabular-nums" aria-hidden="true">{valor}</span>}
    </span>
  );
}

const ICONE_DO_SELO = "h-3.5 w-3.5";

function SelosDaConferencia({ v }: { v: Verificacao }) {
  const identidade = pct(v.identidade);
  const regras = Array.isArray((v as { regras_evitar?: unknown }).regras_evitar) ? (v as { regras_evitar: { violada?: boolean; texto?: string }[] }).regras_evitar : [];
  const violadas = regras.filter((r) => r && r.violada);
  return (
    <>
      {v.ortografia_ok === true && <Selo tom="ok" icone={<SpellCheck className={ICONE_DO_SELO} />} titulo="Texto ok: o texto lido na arte bate com o texto exato" />}
      {v.ortografia_ok === false && <Selo tom="erro" icone={<SpellCheck className={ICONE_DO_SELO} />} titulo="Erro de texto: o texto lido na arte difere do texto exato" />}
      {identidade !== null && (
        <Selo tom={identidade >= 70 ? "ok" : identidade >= 50 ? "alerta" : "erro"} icone={<Fingerprint className={ICONE_DO_SELO} />} valor={`${identidade}%`} titulo={`Identidade da marca (Jev): ${identidade}%`} />
      )}
      {v.logo_ok === true && <Selo tom="ok" icone={<Stamp className={ICONE_DO_SELO} />} titulo="Logo ok" />}
      {v.logo_ok === false && <Selo tom="alerta" icone={<Stamp className={ICONE_DO_SELO} />} titulo={v.logo_presente ? "Logo sobrando" : "Logo faltando"} />}
      {v.erro && <Selo tom="alerta" icone={<CircleDashed className={ICONE_DO_SELO} />} titulo={`Conferência incompleta: ${v.erro}`} />}
      {/* Frente RO, fase 2: a arte pode ter feito o que a equipe mandou evitar (Jev, só aviso). */}
      {violadas.length > 0 && (
        <Selo tom="alerta" icone={<ShieldAlert className={ICONE_DO_SELO} />} titulo={`Regra evitada? Pode ter feito o que a equipe pediu para evitar: ${violadas.map((r) => r.texto).join("; ")}`} />
      )}
    </>
  );
}

/**
 * A autocorreção não resolveu (ou a chave "Corrigir sozinho" está desligada):
 * os motivos ficam à vista, com o botão "Corrigir de novo". 16/10/2026 (dono:
 * "a parte de erros parece poluída"): sem a faixa vermelha; uma linha com o
 * ícone e o primeiro motivo, os outros recolhidos.
 */
function AindaComErro({ motivos, acaoCorrigir }: { motivos: string[]; acaoCorrigir: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const primeiro = motivos[0] || "A conferência achou erro.";
  const resto = motivos.slice(1);
  return (
    <div className="mt-1 min-w-0" data-ainda-com-erro="">
      <div className="flex min-h-7 min-w-0 items-center">
        <TriangleAlert className="mr-1.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
        <p className="mr-1 min-w-0 flex-1 truncate text-[12px] text-foreground" title={motivos.join("\n")}>
          <span className="sr-only">Ainda com erro: </span>
          {primeiro}
        </p>
        {resto.length > 0 && (
          <button
            type="button"
            onClick={() => setAberto((a) => !a)}
            aria-expanded={aberto}
            aria-label={aberto ? "Esconder os outros motivos" : `Ver mais ${resto.length} ${resto.length === 1 ? "motivo" : "motivos"}`}
            className={juntar(botao.icone, "h-7 w-auto px-1.5 text-[11px] tabular-nums")}
          >
            +{resto.length}
          </button>
        )}
        {acaoCorrigir}
      </div>
      {aberto && resto.length > 0 && (
        <ul className="mb-1 ml-5 space-y-0.5 text-[11.5px] leading-snug text-muted-foreground">
          {resto.map((m, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Conferência compacta: uma linha de selos; texto lido e diferenças só aberta. */
function Conferencia({
  versao,
  conferindo,
  acaoConferir,
  acaoCorrigir = null,
}: {
  versao: CardGerado;
  conferindo: boolean;
  acaoConferir: ReactNode;
  /** Botão "Corrigir de novo" (só na versão mais recente). */
  acaoCorrigir?: ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  const v = versao.verificacao || null;
  const pendente = !v || v.pendente;
  const decisao = v && !v.pendente && v.autocorrecao && v.autocorrecao.precisa ? v.autocorrecao : null;

  // 16/10/2026 (dono: "menos texto"): a palavra "Conferência" virou o ícone; o nome fica no title.
  if (pendente) {
    return (
      <div className="flex min-h-8 min-w-0 items-center">
        <ScanSearch className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {conferindo ? (
          <span className="flex min-w-0 items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> conferindo
          </span>
        ) : (
          <>
            <span className="mr-auto text-[12px] text-muted-foreground">sem conferência</span>
            {acaoConferir}
          </>
        )}
      </div>
    );
  }

  const identidade = v && typeof v.identidade === "object" && v.identidade && "nivel" in v.identidade ? (v.identidade as any).nivel : null;
  return (
    <div className="min-w-0" data-conferencia="">
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        title="Conferência: abrir o detalhe"
        className="-mx-1 flex min-h-8 w-[calc(100%+8px)] min-w-0 items-center rounded-md px-1 py-0.5 text-left hover:bg-secondary"
      >
        <ScanSearch className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Conferência</span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-y-0.5">{v && <SelosDaConferencia v={v} />}</span>
        <ChevronDown className={`ml-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberta ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {decisao && !conferindo && <AindaComErro motivos={decisao.motivos} acaoCorrigir={acaoCorrigir} />}
      {aberta && v && (
        <div className="space-y-2 pb-1 pt-1.5 text-[12px]">
          {v.faltando && v.faltando.length > 0 && (
            <p className="[overflow-wrap:anywhere]"><span className="text-destructive">Faltou na arte:</span> {v.faltando.join(", ")}</p>
          )}
          {v.sobrando && v.sobrando.length > 0 && (
            <p className="[overflow-wrap:anywhere]"><span className="text-warning">Apareceu a mais:</span> {v.sobrando.join(", ")}</p>
          )}
          {identidade && <p className="text-muted-foreground">Identidade: {identidade}</p>}
          {v.texto_lido && (
            <div>
              <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Texto lido na imagem</p>
              <p className="mt-0.5 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{v.texto_lido}</p>
            </div>
          )}
          {v.erro && <p className="text-muted-foreground [overflow-wrap:anywhere]">A conferência não terminou ({v.erro}).</p>}
          {v.conferido_em && <p className="text-[11px] text-muted-foreground">Conferida em {dataEHora(v.conferido_em)}</p>}
          {acaoConferir && <div>{acaoConferir}</div>}
        </div>
      )}
    </div>
  );
}

type PropsDoBotao = Parameters<typeof BotaoComCusto>[0];

/**
 * Ação que gasta, desta lâmina. Em andamento, vira um botão desabilitado com
 * o mesmo rótulo (sem spinner nem preço): o andamento aparece só na prancheta.
 */
function BotaoDaLamina({ emAndamento, ...props }: PropsDoBotao & { emAndamento: boolean }) {
  if (emAndamento) {
    return (
      <Button type="button" variant={props.variant || "default"} size={props.size || "sm"} className={props.className} disabled>
        {props.rotulo}
      </Button>
    );
  }
  return <BotaoComCusto {...props} />;
}

const MODOS_DE_AJUSTE: { valor: "livre" | "areas" | "fundo"; rotulo: string; dica: string; icone: ReactNode }[] = [
  { valor: "livre", rotulo: "Livre", dica: "Livre: descreva a mudança; o gerador edita a lâmina inteira", icone: <TextCursorInput className="h-4 w-4" /> },
  { valor: "areas", rotulo: "Área", dica: "Área: marque uma área na lâmina grande; só ela muda", icone: <Crop className="h-4 w-4" /> },
  { valor: "fundo", rotulo: "Fundo", dica: "Fundo: troca só o fundo, mantendo texto e primeiro plano", icone: <Paintbrush className="h-4 w-4" /> },
];

/** Abas da ferramenta Lâmina (16/10/2026, dono: "seções empilhadas viram abas em ícone no topo"). */
type AbaDaLamina = "texto" | "ajustar" | "versoes" | "composicao";

export default function CardDoEstudio({
  conversaId,
  direcao,
  versoes,
  ocupado,
  conferindo,
  painel,
  onPainel,
  versaoVista,
  onVersaoVista,
  areas,
  onAreas,
  partesGerar,
  notaDoGerar,
  partesAjustar,
  partesConferir,
  onGerar,
  onAjustar,
  onConferir,
  onCorrigir,
  partesCorrigir,
  onConfigurar,
  onConcluido,
  semTrocaDeFundo = false,
  refinarTexto,
  instrucaoInicial,
  onDesfazerVersao,
}: {
  conversaId: string | null;
  direcao: CardDaDirecao;
  versoes: CardGerado[];
  /** Esta lâmina está na fila, gerando, ajustando ou na conferência (ou o trabalho já foi entregue). */
  ocupado: boolean;
  /** Este card está na conferência agora (depois de gerar ou ajustar). */
  conferindo: boolean;
  painel: PainelDaLamina;
  onPainel: (p: PainelDaLamina) => void;
  /** Versão mostrada na lâmina grande do centro. */
  versaoVista: number | null;
  onVersaoVista: (versao: number) => void;
  /** Áreas marcadas na lâmina grande (ajuste por área). */
  areas: Area[];
  onAreas: (areas: Area[]) => void;
  partesGerar: () => ParteDaEstimativa[];
  /** Nota do preço de gerar (ex.: "Inclui o fundo contínuo."), somada à descrição do botão. */
  notaDoGerar?: string;
  partesAjustar: () => ParteDaEstimativa[];
  partesConferir: () => ParteDaEstimativa[];
  onGerar: () => Promise<any>;
  onAjustar: (instrucao: string, opcoes?: OpcoesDoAjuste) => Promise<any>;
  onConferir: () => Promise<any>;
  /** "Corrigir de novo": a autocorreção a pedido da equipe (corrigir_card + conferir). */
  onCorrigir?: () => Promise<any>;
  partesCorrigir?: () => ParteDaEstimativa[];
  /** Grava na lâmina sem custo (estudio-arte "configurar"). */
  onConfigurar: (card: { imagens_ids?: string[]; texto_exato?: string }) => Promise<void>;
  onConcluido: () => void;
  /** Carrossel contínuo: o fundo é o panorama (o servidor recusa trocar só o fundo). */
  semTrocaDeFundo?: boolean;
  /** "Refinar texto" (26/09): o Estúdio passa o painel do refino; quem não passa (Estúdio Ads) segue igual. */
  refinarTexto?: ReactNode;
  /**
   * Frente EA: o pedido de ajuste do cliente, já no campo do ajuste livre
   * (o dono só confere e aperta Ajustar). Muda = preenche de novo.
   */
  instrucaoInicial?: string | null;
  /** Frente RO, fase 2: "Desfazer" o último ajuste (a lâmina volta para a versão anterior; a nova fica guardada). */
  onDesfazerVersao?: (versao: number) => Promise<unknown>;
}) {
  const { clientId } = useMesa();
  // Frente RO, fase 2: imagens no Ajustar e a proposta para o pedido vago.
  const anexosDoAjuste = useAnexos(clientId);
  const papeisDoAjuste = usePapeisDosAnexos();
  const imagensDoAjuste = anexosComPapel(anexosDoAjuste, papeisDoAjuste);
  const [proposta, setProposta] = useState<{ texto: string; opcoes: OpcoesDoAjuste } | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const ordenadas = versoes.slice().sort((a, b) => a.versao - b.versao);
  const ultima = ordenadas[ordenadas.length - 1] || null;
  const [instrucao, setInstrucao] = useState(instrucaoInicial || "");
  useEffect(() => {
    if (instrucaoInicial) setInstrucao(instrucaoInicial);
  }, [instrucaoInicial]);
  const [fundoId, setFundoId] = useState<string | null>(null);
  const [acervoAberto, setAcervoAberto] = useState<"fundo" | null>(null);
  const [editandoTexto, setEditandoTexto] = useState(false);
  const [texto, setTexto] = useState(direcao.texto_exato || "");
  const [salvandoTexto, setSalvandoTexto] = useState(false);
  const [pedidosAbertos, setPedidosAbertos] = useState(false);
  const blocoDeVersoes = useRef<HTMLDivElement>(null);
  const blocoDeAjuste = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!editandoTexto) setTexto(direcao.texto_exato || ""); }, [direcao.texto_exato, editandoTexto]);

  // Veio da prancheta pedindo as versões ou o ajuste: leva o bloco para a vista.
  useEffect(() => {
    const alvo = painel === "versoes" ? blocoDeVersoes.current : painel === "livre" || painel === "areas" || painel === "fundo" ? blocoDeAjuste.current : null;
    if (!alvo) return;
    const id = window.setTimeout(() => rolarAte(alvo, "nearest"), 60);
    return () => window.clearTimeout(id);
  }, [painel, direcao.ordem]);

  const vista = ordenadas.find((v) => v.versao === versaoVista) || ultima;
  const modoAjuste: "livre" | "areas" | "fundo" = painel === "areas" || (painel === "fundo" && !semTrocaDeFundo) ? painel : "livre";
  const modosDeAjuste = semTrocaDeFundo ? MODOS_DE_AJUSTE.filter((m) => m.valor !== "fundo") : MODOS_DE_AJUSTE;

  // A aba aberta sai do painel (a prancheta abre Versões ou o Ajuste); a Composição é só daqui.
  const [naComposicao, setNaComposicao] = useState(false);
  useEffect(() => setNaComposicao(false), [painel]);
  const abaDoPainel: AbaDaLamina =
    painel === "versoes" && ordenadas.length > 0 ? "versoes" : (painel === "livre" || painel === "areas" || painel === "fundo") && ultima ? "ajustar" : "texto";
  const aba: AbaDaLamina = naComposicao && direcao.composicao ? "composicao" : abaDoPainel;
  const abas = [
    { valor: "texto", rotulo: "Texto exato", icone: <FileText className="h-4 w-4" /> },
    ...(ultima ? [{ valor: "ajustar", rotulo: "Ajustes", icone: <PenTool className="h-4 w-4" /> }] : []),
    ...(ordenadas.length > 0 ? [{ valor: "versoes", rotulo: "Versões", icone: <History className="h-4 w-4" />, contador: ordenadas.length }] : []),
    ...(direcao.composicao ? [{ valor: "composicao", rotulo: "Composição pedida", icone: <LayoutTemplate className="h-4 w-4" /> }] : []),
  ];
  const escolherAba = (v: string) => {
    if (v === "composicao") {
      setNaComposicao(true);
      return;
    }
    setNaComposicao(false);
    onPainel(v === "versoes" ? "versoes" : v === "ajustar" ? modoAjuste : "direcao");
  };

  const acervo = useAcervo(!!fundoId || acervoAberto !== null);
  const fundo = fundoId ? (acervo.data || []).find((i) => i.id === fundoId) || null : null;

  const pedidos = useQuery({
    queryKey: ["mesa", "ajustes", conversaId, direcao.ordem],
    enabled: !!ultima && !!conversaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("agente_mensagens")
        .select("id, papel, conteudo, anexos, criado_em")
        .eq("conversa_id", conversaId)
        .order("criado_em", { ascending: true });
      if (error) throw error;
      return ((data || []) as any[]).filter((m) => {
        const anexos = Array.isArray(m.anexos) ? m.anexos : m.anexos ? [m.anexos] : [];
        return m.papel !== "sistema" && anexos.some((a: any) => Number(a?.ordem) === direcao.ordem);
      });
    },
  });

  // O estúdio não grava conversa por trabalho (conversa_id fica vazio); o
  // pedido de cada ajuste mora na própria versão (origem "ajuste",
  // instrucao). Sem conversa, é de lá que saem os pedidos anteriores.
  const pedidosDasVersoes = ordenadas
    .filter((v) => v.origem === "ajuste" && !!(v.instrucao && v.instrucao.trim()))
    .map((v) => ({ id: `v${v.versao}`, papel: "usuario", conteudo: `v${v.versao}: ${String(v.instrucao).trim()}` }));
  const pedidosAnteriores: { id: string; papel: string; conteudo: string }[] =
    pedidos.data && pedidos.data.length ? pedidos.data : pedidosDasVersoes;

  const salvarTexto = async () => {
    setSalvandoTexto(true);
    try {
      await onConfigurar({ texto_exato: texto.trim() });
      setEditandoTexto(false);
      toast.success("Texto salvo", { description: ultima ? "Gere de novo para a arte mostrar o texto novo." : undefined });
    } catch (e) {
      toast.error("Texto não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvandoTexto(false);
    }
  };

  const aoAjustar = (data?: unknown) => {
    // A proposta para o pedido vago fica na tela (a área marcada e o pedido também).
    if (data && typeof data === "object" && (data as { proposta_pendente?: boolean }).proposta_pendente) return;
    setInstrucao("");
    onAreas([]);
    setFundoId(null);
    anexosDoAjuste.limpar();
    papeisDoAjuste.limpar();
    setProposta(null);
    onConcluido();
  };

  /** Frente RO, fase 2: o ajuste com as imagens anexadas; o pedido vago volta com a proposta do diretor. */
  const ajustarComMais = async (instr: string, opcoes: OpcoesDoAjuste = {}) => {
    const anexos = corpoDosAnexos(imagensDoAjuste);
    const tudo: OpcoesDoAjuste = { ...opcoes, ...(anexos.length ? { anexos } : {}) };
    setProposta(null);
    try {
      return await onAjustar(instr, tudo);
    } catch (e) {
      if (e instanceof ErroDaMesa && e.codigo === "ajuste_proposta" && typeof e.detalhes.proposta === "string" && e.detalhes.proposta) {
        setProposta({ texto: String(e.detalhes.proposta), opcoes: tudo });
        return { custo_usd: Number(e.detalhes.custo_usd) || 0, proposta_pendente: true, aviso_da_acao: "O pedido ficou vago: o diretor fez uma proposta concreta. Confira e aplique." };
      }
      throw e;
    }
  };

  const desfazerUltimo = async () => {
    if (!ultima || !onDesfazerVersao) return;
    setDesfazendo(true);
    try {
      await onDesfazerVersao(ultima.versao);
      toast.success(`Voltou para a versão anterior`, { description: `A v${ultima.versao} fica guardada.` });
      onConcluido();
    } catch (e) {
      toast.error("Não foi possível desfazer", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setDesfazendo(false);
    }
  };
  const anexosDaVersao = ultima
    ? [
      ...((ultima as unknown as { aprendido?: unknown }).aprendido ? [(ultima as unknown as { aprendido?: unknown }).aprendido] : []),
      ...(Array.isArray((ultima as unknown as { regras_seguidas?: unknown }).regras_seguidas) && ((ultima as unknown as { regras_seguidas: unknown[] }).regras_seguidas).length
        ? [{ tipo: "regras_seguidas", regras: (ultima as unknown as { regras_seguidas: unknown[] }).regras_seguidas }]
        : []),
    ]
    : [];
  const campoDeAnexos = <AnexosComPapel controle={anexosDoAjuste} papeis={papeisDoAjuste} desabilitado={ocupado} />;

  const acaoConferir = vista && vista.versao === ultima?.versao ? (
    <BotaoDaLamina
      emAndamento={ocupado}
      rotulo={<><ScanSearch className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Conferir</span></>}
      titulo={`Conferir a lâmina ${direcao.ordem}`}
      descricao="Conferir: a leitura compara o texto da imagem com o texto exato e o Jev confere a identidade."
      variant="ghost"
      className="h-7 shrink-0 gap-0 px-1.5 text-[11px]"
      disabled={ocupado}
      partes={partesConferir}
      executar={onConferir}
      aoConcluir={onConcluido}
    />
  ) : null;

  const acaoCorrigir = onCorrigir && vista && vista.versao === ultima?.versao ? (
    <BotaoDaLamina
      emAndamento={ocupado}
      rotulo={<><Wrench className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Corrigir de novo</span></>}
      titulo={`Corrigir a lâmina ${direcao.ordem}`}
      descricao="Corrigir de novo: o estúdio edita a arte atual com os motivos da conferência (mesmo texto exato) e confere de novo antes de mostrar."
      variant="ghost"
      className="h-7 shrink-0 gap-0 px-1.5 text-[11px]"
      disabled={ocupado}
      partes={partesCorrigir || partesAjustar}
      executar={onCorrigir}
      aoConcluir={onConcluido}
    />
  ) : null;

  return (
    <div className="min-w-0 space-y-3">
      {/* Cabeçalho: qual lâmina e a ação principal (16/10/2026: Gerar/Refazer só com o ícone, sem borda; o preço continua). */}
      <div className="flex min-w-0 items-center">
        <div className="mr-2 min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">
            Lâmina {direcao.ordem}
            <span className="font-normal text-muted-foreground"> · {funcaoDaLamina(direcao)}</span>
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {ultima ? `v${vista?.versao} de ${ordenadas.length}` : "sem arte"}
          </p>
        </div>
        <BotaoDaLamina
          emAndamento={ocupado}
          rotulo={
            <>
              {ultima ? <RotateCw className="h-4 w-4" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
              <span className="sr-only">{ultima ? "Refazer" : "Gerar"}</span>
            </>
          }
          titulo={`${ultima ? "Refazer" : "Gerar"} a lâmina ${direcao.ordem}`}
          descricao={`${ultima ? "Refazer" : "Gerar"}: o gerador faz a lâmina inteira com o texto dentro. Depois a leitura confere a ortografia e o Jev confere a identidade.${notaDoGerar ? ` ${notaDoGerar}` : ""}`}
          variant={ultima ? "ghost" : "default"}
          className="h-8 shrink-0 gap-0 px-2"
          disabled={ocupado}
          partes={partesGerar}
          executar={onGerar}
          aoConcluir={onConcluido}
        />
      </div>

      {vista && <Conferencia versao={vista} conferindo={conferindo && vista.versao === ultima?.versao} acaoConferir={acaoConferir} acaoCorrigir={acaoCorrigir} />}

      {/* As seções viraram abas em ícone (16/10/2026); o nome fica no title e no leitor de tela. */}
      {abas.length > 1 && (
        <Etapas soIcone rotulo={`Partes da lâmina ${direcao.ordem}`} itens={abas} valor={aba} onEscolher={escolherAba} className="-mx-1" />
      )}

      {/* Texto exato: a conferência compara a arte com ele */}
      {aba === "texto" && (
      <section aria-label="Texto exato">
        {editandoTexto ? (
          <div className="space-y-2">
            <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} className="text-[13px]" aria-label="Texto exato" />
            <div className="flex justify-end">
              <button type="button" className={juntar(botao.icone, "mr-1")} aria-label="Cancelar" title="Cancelar" onClick={() => { setEditandoTexto(false); setTexto(direcao.texto_exato || ""); }}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <Button type="button" size="sm" className="h-8 w-8 p-0" aria-label="Salvar texto" title="Salvar texto" onClick={() => void salvarTexto()} disabled={salvandoTexto || texto.trim() === (direcao.texto_exato || "").trim()}>
                {salvandoTexto ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-start">
            <p className="min-w-0 flex-1 whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
              {direcao.texto_exato || "Sem texto nesta lâmina."}
            </p>
            <button type="button" className={juntar(botao.icone, "ml-1")} aria-label="Editar o texto exato" title="Editar o texto exato" onClick={() => setEditandoTexto(true)} disabled={ocupado}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {refinarTexto && !editandoTexto ? <div className="mt-2">{refinarTexto}</div> : null}
      </section>
      )}

      {/* Ajustes: livre, por área (marcada na lâmina grande) ou só o fundo */}
      {ultima && aba === "ajustar" && (
        <section ref={blocoDeAjuste} className="scroll-mt-2" aria-label="Ajustar esta lâmina">
          {/* Frente RO, fase 2: o que o último ajuste aprendeu (Esquecer) e as regras que a geração seguiu. */}
          {anexosDaVersao.length > 0 && (
            <div className="mb-1.5">
              <AprendizadoDoAgente anexos={anexosDaVersao} onEsquecer={(id) => esquecerRegraDoEstudio(clientId, id)} />
            </div>
          )}
          {vista && vista.versao !== ultima.versao && (
            // O servidor sempre ajusta a versão mais recente: quem olha uma
            // anterior achava que o ajuste partiria da que está na tela.
            <p className="mb-2 text-[12px] leading-snug text-muted-foreground" data-aviso="ajuste-parte-da-atual">
              Parte da v{ultima.versao}, não da v{vista.versao}.{" "}
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onVersaoVista(ultima.versao)}>
                Ver a atual
              </button>
            </p>
          )}
          <div className="flex min-w-0 items-center">
            <div className="flex min-w-0 items-center" role="tablist" aria-label="Tipo de ajuste">
              {modosDeAjuste.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  role="tab"
                  aria-selected={modoAjuste === m.valor}
                  aria-label={m.rotulo}
                  title={m.dica}
                  onClick={() => onPainel(m.valor)}
                  className={juntar(botao.icone, "mr-0.5", modoAjuste === m.valor && "bg-muted text-primary hover:text-primary")}
                >
                  {m.icone}
                </button>
              ))}
            </div>
            {ultima.origem === "ajuste" && ordenadas.length > 1 && onDesfazerVersao && (
              <button
                type="button"
                onClick={() => void desfazerUltimo()}
                disabled={ocupado || desfazendo}
                className={juntar(botao.icone, "ml-auto disabled:opacity-50")}
                data-desfazer-ajuste={ultima.versao}
                aria-label="Desfazer o último ajuste"
                title="Desfazer o último ajuste: volta para a versão anterior; a do ajuste fica guardada"
              >
                {desfazendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="h-4 w-4" aria-hidden="true" />}
              </button>
            )}
          </div>

          {modoAjuste === "livre" && (
            <div className="mt-2 space-y-2">
              <ZonaDeAnexos anexos={anexosDoAjuste} className="min-w-0" rotulo="Solte as imagens para o ajuste">
                <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={3} placeholder="Ex.: título maior e a planta mais à esquerda" className="text-[13px]" aria-label="Pedido de ajuste" />
                {campoDeAnexos}
              </ZonaDeAnexos>
              <div className="flex justify-end">
                {/* 17/10/2026 (dono: "no mobile está faltando um botão ali de ajustar"): no celular e no tablet o botão diz "Ajustar"; no computador fica só o ícone. */}
                <BotaoDaLamina
                  emAndamento={ocupado}
                  rotulo={<><PenTool className="h-4 w-4" aria-hidden="true" /><span className="ml-1.5 lg:sr-only" data-rotulo-do-ajustar="">Ajustar</span></>}
                  titulo={`Ajustar a lâmina ${direcao.ordem}`}
                  descricao="Ajustar: o diretor transforma o pedido em instrução de edição e o gerador edita a versão atual. A nova versão passa pela conferência."
                  className="h-11 gap-0 px-4 lg:h-8 lg:px-2.5"
                  disabled={ocupado || !instrucao.trim() || anexosDoAjuste.subindo}
                  partes={partesAjustar}
                  executar={() => ajustarComMais(instrucao.trim())}
                  aoConcluir={aoAjustar}
                />
              </div>
            </div>
          )}

          {modoAjuste === "areas" && (
            <div className="mt-2 space-y-2">
              <div className="flex min-h-8 min-w-0 items-center">
                <span className={`min-w-0 flex-1 text-[12px] leading-snug ${areas.length ? "font-medium text-primary" : "text-muted-foreground"}`}>
                  {areas.length
                    ? `${areas.length} área${areas.length === 1 ? "" : "s"} marcada${areas.length === 1 ? "" : "s"}`
                    : "Marque a área na lâmina grande."}
                </span>
                {areas.length > 0 && (
                  <button type="button" className={botao.icone} aria-label="Limpar as áreas" title="Limpar as áreas" onClick={() => onAreas([])}>
                    <Eraser className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <ZonaDeAnexos anexos={anexosDoAjuste} className="min-w-0" rotulo="Solte as imagens para o ajuste">
                <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={3} placeholder="O que mudar nas áreas. Ex.: trocar o copo por uma xícara branca, ou deixa mais bonito aqui" className="text-[13px]" aria-label="O que mudar nas áreas" />
                {campoDeAnexos}
              </ZonaDeAnexos>
              <div className="flex justify-end">
                <BotaoDaLamina
                  emAndamento={ocupado}
                  rotulo={<><Crop className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Ajustar a área</span></>}
                  titulo={`Ajustar áreas da lâmina ${direcao.ordem}`}
                  descricao="Ajustar a área: o gerador edita só dentro das áreas marcadas (máscara). Pedido vago vira uma proposta concreta antes de gastar. A nova versão passa pela conferência."
                  className="h-8 gap-0 px-2.5"
                  disabled={ocupado || !instrucao.trim() || areas.length === 0 || anexosDoAjuste.subindo}
                  partes={partesAjustar}
                  executar={() => ajustarComMais(instrucao.trim(), { areas })}
                  aoConcluir={aoAjustar}
                />
              </div>
            </div>
          )}

          {modoAjuste === "fundo" && (
            <div className="mt-2 space-y-2">
              <div className="flex min-w-0 items-center">
                {fundoId ? (
                  <>
                    <div className="mr-2 w-10 shrink-0">{fundo ? <FotoDoAcervo imagem={fundo} /> : <div className="h-10 w-10 animate-pulse rounded-md bg-secondary" />}</div>
                    <p className="min-w-0 flex-1 truncate text-[12px]">{fundo ? fundo.nome : "Foto do acervo"}</p>
                    <button type="button" className={botao.icone} aria-label="Tirar a foto do fundo" title="Tirar a foto do fundo" onClick={() => setFundoId(null)}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={juntar(botao.icone, acervoAberto === "fundo" && "bg-muted text-foreground")}
                    aria-label="Foto do acervo como fundo"
                    title="Foto do acervo como fundo"
                    aria-pressed={acervoAberto === "fundo"}
                    onClick={() => setAcervoAberto(acervoAberto === "fundo" ? null : "fundo")}
                  >
                    <ImageIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {acervoAberto === "fundo" && (
                <SeletorDoAcervo
                  titulo="Novo fundo"
                  escolhidas={fundoId ? [fundoId] : []}
                  onEscolher={(i) => { setFundoId(i.id); setAcervoAberto(null); }}
                  onFechar={() => setAcervoAberto(null)}
                />
              )}
              <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={2} placeholder="Opcional. Ex.: fundo de madeira clara, luz de manhã" className="text-[13px]" aria-label="Como deve ser o fundo" />
              <div className="flex justify-end">
                <BotaoDaLamina
                  emAndamento={ocupado}
                  rotulo={<><Paintbrush className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Trocar o fundo</span></>}
                  titulo={`Trocar o fundo da lâmina ${direcao.ordem}`}
                  descricao="Trocar o fundo: o gerador troca só o fundo, mantendo o texto e o primeiro plano. A nova versão passa pela conferência."
                  className="h-8 gap-0 px-2.5"
                  disabled={ocupado || (!instrucao.trim() && !fundoId)}
                  partes={partesAjustar}
                  executar={() => onAjustar(instrucao.trim() || "Trocar só o fundo, mantendo o texto e o primeiro plano.", { tipo: "fundo", imagem_id: fundoId || undefined })}
                  aoConcluir={aoAjustar}
                />
              </div>
            </div>
          )}

          {/* Frente RO, fase 2: o pedido vago virou uma proposta concreta; nada foi gerado ainda. */}
          {proposta && (
            <div className="mt-2 min-w-0" data-proposta-do-ajuste="">
              <p className="text-[12px] leading-snug [overflow-wrap:anywhere]">
                <span className="font-medium">Proposta do diretor:</span> {proposta.texto}
              </p>
              <div className="mt-1 flex min-w-0 items-center justify-end">
                <button
                  type="button"
                  className={juntar(botao.icone, "mr-1")}
                  aria-label="Editar a proposta"
                  title="Editar a proposta"
                  onClick={() => { setInstrucao(proposta.texto); setProposta(null); }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <BotaoDaLamina
                  emAndamento={ocupado}
                  rotulo={<><Check className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Aplicar a proposta</span></>}
                  titulo={`Aplicar a proposta na lâmina ${direcao.ordem}`}
                  descricao="Aplicar a proposta: edita a versão atual com a proposta, só na área marcada quando houver. A nova versão passa pela conferência."
                  className="h-8 gap-0 px-2.5"
                  disabled={ocupado}
                  partes={partesAjustar}
                  executar={() => onAjustar(proposta.texto, { ...proposta.opcoes, confirmado: true })}
                  aoConcluir={aoAjustar}
                />
              </div>
            </div>
          )}

          {pedidosAnteriores.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setPedidosAbertos((a) => !a)}
                aria-expanded={pedidosAbertos}
                aria-label={`Pedidos anteriores (${pedidosAnteriores.length})`}
                title="Pedidos anteriores"
                className="flex h-7 items-center rounded-md px-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <MessagesSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                <span className="tabular-nums" aria-hidden="true">{pedidosAnteriores.length}</span>
                <ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${pedidosAbertos ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {pedidosAbertos && (
                <ul className="mt-1 space-y-1.5">
                  {pedidosAnteriores.slice(-6).map((m) => (
                    <li
                      key={m.id}
                      className={`rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed [overflow-wrap:anywhere] ${m.papel === "usuario" ? "bg-primary/10 text-foreground" : "bg-secondary text-muted-foreground"}`}
                    >
                      {m.conteudo}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* Versões: clique mostra a versão na lâmina grande */}
      {ordenadas.length > 0 && aba === "versoes" && (
        <section ref={blocoDeVersoes} className="scroll-mt-2" aria-label={`Versões (${ordenadas.length})`}>
          <ul className="grid grid-cols-4 gap-2">
            {ordenadas.slice().reverse().map((v) => (
              <li key={v.versao} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onVersaoVista(v.versao)}
                  title={v.instrucao || (v.origem === "ajuste" ? "ajuste" : "geração")}
                  aria-pressed={vista?.versao === v.versao}
                  className={`block w-full overflow-hidden rounded-md border-2 transition-colors ${vista?.versao === v.versao ? "border-primary" : "border-transparent hover:border-primary/50"}`}
                >
                  <Moldura45>
                    <ImagemDaMesa caminho={v.storage_path} alt={`Versão ${v.versao}`} className="h-full w-full" />
                  </Moldura45>
                </button>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">v{v.versao}</span> {v.versao === ultima?.versao ? "atual" : v.origem === "ajuste" ? "ajuste" : ""}
                </p>
                {rotuloDaVersao(v) && (
                  <p className="truncate text-[11px] text-muted-foreground" data-versao-fidelidade={v.fidelidade_referencia} title="Fidelidade à referência usada nesta versão">
                    {rotuloDaVersao(v)}
                    {v.prancha && v.prancha.length ? ` · quadro ${v.prancha[0].quadro}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Direção da lâmina (composição pedida): aba própria */}
      {direcao.composicao && aba === "composicao" && (
        <section aria-label="Composição pedida">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{direcao.composicao}</p>
        </section>
      )}
    </div>
  );
}
