import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Crop,
  ImageIcon,
  Loader2,
  MessageSquare,
  Paintbrush,
  Pencil,
  RefreshCw,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { dataEHora, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { BotaoComCusto } from "./Custo";
import { rolarAte } from "./EstudioAltura";
import { ImagemDaMesa } from "./MesaContexto";
import Moldura45 from "./Moldura45";
import { funcaoDaLamina } from "./PranchetaDoEstudio";
import SeletorDoAcervo, { FotoDoAcervo, useAcervo } from "./SeletorDoAcervo";
import type { Area } from "./estudioUtil";
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
}

// O estúdio grava a identidade como { nota, escala_max } (Score do Jev de 0 a escala_max).
const pct = (v: unknown): number | null => {
  if (typeof v !== "object" || v === null) return null;
  const nota = Number((v as any).nota ?? (v as any).score);
  const max = Number((v as any).escala_max);
  if (!Number.isFinite(nota) || !Number.isFinite(max) || max <= 0) return null;
  return Math.round(Math.max(0, Math.min(1, nota / max)) * 100);
};

function Selo({ tom, children, titulo }: { tom: "ok" | "alerta" | "erro" | "neutro"; children: ReactNode; titulo?: string }) {
  const cor =
    tom === "ok" ? "bg-success/10 text-success" : tom === "alerta" ? "bg-warning/15 text-warning" : tom === "erro" ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground";
  return (
    <span title={titulo} className={`mr-1 inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10.5px] font-medium ${cor}`}>
      {children}
    </span>
  );
}

function SelosDaConferencia({ v }: { v: Verificacao }) {
  const identidade = pct(v.identidade);
  return (
    <>
      {v.ortografia_ok === true && <Selo tom="ok" titulo="O texto lido na arte bate com o texto exato"><CheckCircle2 className="mr-1 h-3 w-3" /> texto ok</Selo>}
      {v.ortografia_ok === false && <Selo tom="erro" titulo="O texto lido na arte difere do texto exato"><TriangleAlert className="mr-1 h-3 w-3" /> erro de texto</Selo>}
      {identidade !== null && <Selo tom={identidade >= 70 ? "ok" : identidade >= 50 ? "alerta" : "erro"} titulo="Nota de identidade da marca (Jev)">identidade {identidade}%</Selo>}
      {v.logo_ok === true && <Selo tom="ok">logo ok</Selo>}
      {v.logo_ok === false && <Selo tom="alerta">{v.logo_presente ? "logo sobrando" : "logo faltando"}</Selo>}
      {v.erro && <Selo tom="alerta" titulo={v.erro}>incompleta</Selo>}
    </>
  );
}

/**
 * A autocorreção não resolveu (ou a chave "Corrigir sozinho" está desligada):
 * os motivos ficam à vista, com o botão "Corrigir de novo".
 */
function AindaComErro({ motivos, acaoCorrigir }: { motivos: string[]; acaoCorrigir: ReactNode }) {
  return (
    <div className="border-t border-border px-2.5 py-2" data-ainda-com-erro="">
      <p className="text-[11.5px] font-medium text-destructive">Ainda com erro</p>
      <ul className="mt-1 space-y-0.5 text-[11.5px] leading-snug text-foreground/90">
        {motivos.map((m, i) => (
          <li key={i} className="[overflow-wrap:anywhere]">{m}</li>
        ))}
      </ul>
      {acaoCorrigir && <div className="mt-2">{acaoCorrigir}</div>}
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

  if (pendente) {
    return (
      <div className="flex min-h-9 min-w-0 items-center rounded-lg border border-border bg-background px-2.5 py-1">
        <span className="mr-2 text-[11.5px] font-medium">Conferência</span>
        {conferindo ? (
          <span className="text-[11.5px] text-muted-foreground">em andamento</span>
        ) : (
          <>
            <span className="mr-auto text-[11.5px] text-muted-foreground">não feita</span>
            {acaoConferir}
          </>
        )}
      </div>
    );
  }

  const identidade = v && typeof v.identidade === "object" && v.identidade && "nivel" in v.identidade ? (v.identidade as any).nivel : null;
  return (
    <div className="rounded-lg border border-border bg-background">
      <button type="button" onClick={() => setAberta((a) => !a)} aria-expanded={aberta} className="flex min-h-9 w-full min-w-0 items-center rounded-lg px-2.5 py-1 text-left hover:bg-secondary">
        <span className="mr-2 shrink-0 text-[11.5px] font-medium">Conferência</span>
        <span className="flex min-w-0 flex-1 overflow-hidden">{v && <SelosDaConferencia v={v} />}</span>
        <ChevronDown className={`ml-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberta ? "rotate-180" : ""}`} />
      </button>
      {decisao && !conferindo && <AindaComErro motivos={decisao.motivos} acaoCorrigir={acaoCorrigir} />}
      {aberta && v && (
        <div className="space-y-2 border-t border-border px-2.5 pb-2.5 pt-2 text-[12px]">
          <div className="flex flex-wrap">{<SelosDaConferencia v={v} />}</div>
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

function Rotulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-h-7 items-center">
      <p className="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</p>
      {acao}
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
  { valor: "livre", rotulo: "Livre", dica: "Descreva a mudança; o gerador edita a lâmina inteira", icone: <MessageSquare className="mr-1 h-3.5 w-3.5" /> },
  { valor: "areas", rotulo: "Área", dica: "Marque uma área na lâmina grande; só ela muda", icone: <Crop className="mr-1 h-3.5 w-3.5" /> },
  { valor: "fundo", rotulo: "Fundo", dica: "Troca só o fundo, mantendo texto e primeiro plano", icone: <Paintbrush className="mr-1 h-3.5 w-3.5" /> },
];

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
}) {
  const ordenadas = versoes.slice().sort((a, b) => a.versao - b.versao);
  const ultima = ordenadas[ordenadas.length - 1] || null;
  const [instrucao, setInstrucao] = useState("");
  const [fundoId, setFundoId] = useState<string | null>(null);
  const [acervoAberto, setAcervoAberto] = useState<"fundo" | null>(null);
  const [editandoTexto, setEditandoTexto] = useState(false);
  const [texto, setTexto] = useState(direcao.texto_exato || "");
  const [salvandoTexto, setSalvandoTexto] = useState(false);
  const [composicaoAberta, setComposicaoAberta] = useState(false);
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

  const aoAjustar = () => {
    setInstrucao("");
    onAreas([]);
    setFundoId(null);
    onConcluido();
  };

  const acaoConferir = vista && vista.versao === ultima?.versao ? (
    <BotaoDaLamina
      emAndamento={ocupado}
      rotulo={<><RefreshCw className="mr-1 h-3 w-3" /> Conferir</>}
      titulo={`Conferir a lâmina ${direcao.ordem}`}
      descricao="A leitura compara o texto da imagem com o texto exato e o Jev confere a identidade."
      variant="outline"
      className="h-7 shrink-0 px-2 text-[11px]"
      disabled={ocupado}
      partes={partesConferir}
      executar={onConferir}
      aoConcluir={onConcluido}
    />
  ) : null;

  const acaoCorrigir = onCorrigir && vista && vista.versao === ultima?.versao ? (
    <BotaoDaLamina
      emAndamento={ocupado}
      rotulo={<><Wand2 className="mr-1 h-3 w-3" /> Corrigir de novo</>}
      titulo={`Corrigir a lâmina ${direcao.ordem}`}
      descricao="O estúdio edita a arte atual com os motivos da conferência (mesmo texto exato) e confere de novo antes de mostrar."
      variant="outline"
      className="h-7 shrink-0 px-2 text-[11px]"
      disabled={ocupado}
      partes={partesCorrigir || partesAjustar}
      executar={onCorrigir}
      aoConcluir={onConcluido}
    />
  ) : null;

  return (
    <div className="min-w-0 space-y-4">
      {/* Cabeçalho: qual lâmina e a ação principal */}
      <div className="flex min-w-0 items-center">
        <div className="mr-2 min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">
            Lâmina {direcao.ordem}
            <span className="font-normal text-muted-foreground"> · {funcaoDaLamina(direcao)}</span>
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {ultima ? `${ordenadas.length} ${ordenadas.length === 1 ? "versão" : "versões"} · vendo v${vista?.versao}` : "ainda sem arte"}
          </p>
        </div>
        <BotaoDaLamina
          emAndamento={ocupado}
          rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> {ultima ? "Refazer" : "Gerar"}</>}
          titulo={`${ultima ? "Refazer" : "Gerar"} a lâmina ${direcao.ordem}`}
          descricao={`O gerador faz a lâmina inteira com o texto dentro. Depois a leitura confere a ortografia e o Jev confere a identidade.${notaDoGerar ? ` ${notaDoGerar}` : ""}`}
          variant={ultima ? "outline" : "default"}
          className="h-9 shrink-0"
          disabled={ocupado}
          partes={partesGerar}
          executar={onGerar}
          aoConcluir={onConcluido}
        />
      </div>

      {vista && <Conferencia versao={vista} conferindo={conferindo && vista.versao === ultima?.versao} acaoConferir={acaoConferir} acaoCorrigir={acaoCorrigir} />}

      {/* Texto exato: a conferência compara a arte com ele */}
      <section>
        <Rotulo
          acao={
            !editandoTexto && (
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => setEditandoTexto(true)} disabled={ocupado}>
                <Pencil className="mr-1 h-3 w-3" /> Editar
              </Button>
            )
          }
        >
          Texto exato
        </Rotulo>
        {editandoTexto ? (
          <div className="space-y-2">
            <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} className="text-[13px]" />
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="ghost" className="mr-2" onClick={() => { setEditandoTexto(false); setTexto(direcao.texto_exato || ""); }}>
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={() => void salvarTexto()} disabled={salvandoTexto || texto.trim() === (direcao.texto_exato || "").trim()}>
                {salvandoTexto && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Salvar texto
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2.5 text-[13.5px] leading-relaxed [overflow-wrap:anywhere]">
            {direcao.texto_exato || "Sem texto nesta lâmina."}
          </p>
        )}
        {refinarTexto && !editandoTexto ? <div className="mt-2">{refinarTexto}</div> : null}
      </section>

      {/* Ajustes: livre, por área (marcada na lâmina grande) ou só o fundo */}
      {ultima && (
        <section ref={blocoDeAjuste} className="scroll-mt-2">
          <Rotulo>Ajustar esta lâmina</Rotulo>
          {vista && vista.versao !== ultima.versao && (
            // O servidor sempre ajusta a versão mais recente: quem olha uma
            // anterior achava que o ajuste partiria da que está na tela.
            <p className="mb-2 text-[11.5px] leading-snug text-muted-foreground" data-aviso="ajuste-parte-da-atual">
              O ajuste parte da versão atual (v{ultima.versao}), não da v{vista.versao} que está na tela.{" "}
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onVersaoVista(ultima.versao)}>
                Ver a atual
              </button>
            </p>
          )}
          <div className={`grid ${modosDeAjuste.length === 3 ? "grid-cols-3" : "grid-cols-2"} gap-1 rounded-lg border border-border bg-background p-1`} role="tablist" aria-label="Tipo de ajuste">
            {modosDeAjuste.map((m) => (
              <button
                key={m.valor}
                type="button"
                role="tab"
                aria-selected={modoAjuste === m.valor}
                title={m.dica}
                onClick={() => onPainel(m.valor)}
                className={`flex h-8 min-w-0 items-center justify-center rounded-md px-1 text-[12px] transition-colors ${
                  modoAjuste === m.valor ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {m.icone}
                <span className="truncate">{m.rotulo}</span>
              </button>
            ))}
          </div>

          {modoAjuste === "livre" && (
            <div className="mt-2.5 space-y-2">
              <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={3} placeholder="Ex.: título maior e a planta mais à esquerda" className="text-[13px]" />
              <div className="flex justify-end">
                <BotaoDaLamina
                  emAndamento={ocupado}
                  rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> Ajustar</>}
                  titulo={`Ajustar a lâmina ${direcao.ordem}`}
                  descricao="O diretor transforma o pedido em instrução de edição e o gerador edita a versão atual. A nova versão passa pela conferência."
                  disabled={ocupado || !instrucao.trim()}
                  partes={partesAjustar}
                  executar={() => onAjustar(instrucao.trim())}
                  aoConcluir={aoAjustar}
                />
              </div>
            </div>
          )}

          {modoAjuste === "areas" && (
            <div className="mt-2.5 space-y-2">
              <div className="flex min-h-7 items-center">
                <span className={`flex-1 text-[12px] leading-snug ${areas.length ? "font-medium text-primary" : "text-muted-foreground"}`}>
                  {areas.length
                    ? `${areas.length} área${areas.length === 1 ? "" : "s"} marcada${areas.length === 1 ? "" : "s"}`
                    : "Arraste sobre a lâmina grande para marcar a área."}
                </span>
                {areas.length > 0 && (
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => onAreas([])}>
                    Limpar
                  </Button>
                )}
              </div>
              <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={3} placeholder="O que mudar nas áreas. Ex.: trocar o copo por uma xícara branca" className="text-[13px]" />
              <div className="flex justify-end">
                <BotaoDaLamina
                  emAndamento={ocupado}
                  rotulo={<><Crop className="mr-1 h-3.5 w-3.5" /> Ajustar a área</>}
                  titulo={`Ajustar áreas da lâmina ${direcao.ordem}`}
                  descricao="O gerador edita só dentro das áreas marcadas (máscara). A nova versão passa pela conferência."
                  disabled={ocupado || !instrucao.trim() || areas.length === 0}
                  partes={partesAjustar}
                  executar={() => onAjustar(instrucao.trim(), { areas })}
                  aoConcluir={aoAjustar}
                />
              </div>
            </div>
          )}

          {modoAjuste === "fundo" && (
            <div className="mt-2.5 space-y-2">
              {fundoId ? (
                <div className="flex min-w-0 items-center rounded-lg border border-border bg-background p-2">
                  <div className="mr-2.5 w-12 shrink-0">{fundo ? <FotoDoAcervo imagem={fundo} /> : <div className="h-12 w-12 animate-pulse rounded-md bg-secondary" />}</div>
                  <p className="min-w-0 flex-1 truncate text-[12.5px]">{fundo ? fundo.nome : "Foto do acervo"}</p>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => setFundoId(null)}>
                    Tirar
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setAcervoAberto(acervoAberto === "fundo" ? null : "fundo")}>
                  <ImageIcon className="mr-1.5 h-3.5 w-3.5" /> Foto do acervo como fundo
                </Button>
              )}
              {acervoAberto === "fundo" && (
                <SeletorDoAcervo
                  titulo="Novo fundo"
                  escolhidas={fundoId ? [fundoId] : []}
                  onEscolher={(i) => { setFundoId(i.id); setAcervoAberto(null); }}
                  onFechar={() => setAcervoAberto(null)}
                />
              )}
              <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={2} placeholder="Opcional. Ex.: fundo de madeira clara, luz de manhã" className="text-[13px]" />
              <div className="flex justify-end">
                <BotaoDaLamina
                  emAndamento={ocupado}
                  rotulo={<><Paintbrush className="mr-1 h-3.5 w-3.5" /> Trocar o fundo</>}
                  titulo={`Trocar o fundo da lâmina ${direcao.ordem}`}
                  descricao="O gerador troca só o fundo, mantendo o texto e o primeiro plano. A nova versão passa pela conferência."
                  disabled={ocupado || (!instrucao.trim() && !fundoId)}
                  partes={partesAjustar}
                  executar={() => onAjustar(instrucao.trim() || "Trocar só o fundo, mantendo o texto e o primeiro plano.", { tipo: "fundo", imagem_id: fundoId || undefined })}
                  aoConcluir={aoAjustar}
                />
              </div>
            </div>
          )}

          {pedidosAnteriores.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setPedidosAbertos((a) => !a)} aria-expanded={pedidosAbertos} className="flex h-7 items-center text-[11.5px] text-muted-foreground hover:text-foreground">
                <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${pedidosAbertos ? "rotate-180" : ""}`} />
                Pedidos anteriores ({pedidosAnteriores.length})
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
      {ordenadas.length > 0 && (
        <section ref={blocoDeVersoes} className="scroll-mt-2">
          <Rotulo>Versões ({ordenadas.length})</Rotulo>
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
                <p className="mt-1 truncate text-[10.5px] text-muted-foreground">
                  <span className="font-medium text-foreground">v{v.versao}</span> {v.versao === ultima?.versao ? "atual" : v.origem === "ajuste" ? "ajuste" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Direção da lâmina (composição): só aberta */}
      {direcao.composicao && (
        <section>
          <button type="button" onClick={() => setComposicaoAberta((a) => !a)} aria-expanded={composicaoAberta} className="flex h-7 items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
            <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${composicaoAberta ? "rotate-180" : ""}`} />
            Composição pedida
          </button>
          {composicaoAberta && (
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{direcao.composicao}</p>
          )}
        </section>
      )}
    </div>
  );
}
