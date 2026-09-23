import { Check, CheckCircle2, Clock, FileText, Images, Palette, Video } from "lucide-react";
import { EditorialFileThumbnail, seloDaArteDoEstudio } from "@/components/editorial/EditorialCalendarViews";
import type { ArteDoEstudioNaAgenda } from "@/hooks/useEditorialCalendar";
import { editorialVisualStage, EDITORIAL_VISUAL_STAGE_LABELS, type EditorialVisualStage } from "@/lib/editorial";
import { corDaEtapa } from "@/lib/editorialCores";
import { TASK_DELIVERY_TYPE_LABELS, type TaskDeliveryType } from "@/lib/taskDeliveryTypes";
import { rotuloDaPublicacao, type ItemDaAgenda, type PostDaAgenda, type Selo, type TomDoSelo } from "./useAgendaDoMes";

/**
 * Cartões da Agenda do mês, com as mesmas cores e selos da Agenda do painel:
 * item ainda sem post em violeta ("Prazo · formato"), post pela cor da etapa
 * (programado em azul, publicado em verde, falhou em vermelho), miniatura da
 * arte (capa do carrossel ou do estático) e o selo "Arte pronta · N lâminas".
 * O título aparece inteiro até 3 linhas e o texto completo fica no tooltip.
 */

export type TamanhoDoCartao = "mes" | "grande";

export const formatoDoItem = (tipo: string | null | undefined) =>
  TASK_DELIVERY_TYPE_LABELS[String(tipo || "") as TaskDeliveryType] || String(tipo || "Conteúdo");

const ROTULO_DO_CONTEUDO: Record<string, string> = {
  static: "Estático",
  carousel: "Carrossel",
  reel: "Reel",
  story: "Story",
  video: "Vídeo",
  short: "Short",
  article: "Artigo",
  google_post: "Google",
  other: "Outro",
};

export const formatoDoPost = (tipo: string | null | undefined) => {
  const t = String(tipo || "");
  return Object.prototype.hasOwnProperty.call(ROTULO_DO_CONTEUDO, t) ? ROTULO_DO_CONTEUDO[t] : t || "Post";
};

/** Ícone do formato, igual à Agenda (carrossel, vídeo, texto). */
export function IconeDoFormato({ tipo, className = "h-3 w-3" }: { tipo: string | null | undefined; className?: string }) {
  const t = String(tipo || "");
  if (t === "carousel") return <Images className={className} aria-hidden />;
  if (t === "reel" || t === "video" || t === "short" || t === "story") return <Video className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

export const horaCurta = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

/** Cor sólida do ponto de cada selo da Mesa (roteiro, direção, arte). */
export const PONTO_DO_TOM: Record<TomDoSelo, string> = {
  neutro: "bg-muted-foreground/60",
  roteiro: "bg-sky-500",
  direcao: "bg-violet-500",
  producao: "bg-amber-500",
  pronto: "bg-emerald-500",
  entregue: "bg-success",
  alerta: "bg-destructive",
};

export function SeloDiscreto({ selo, className = "" }: { selo: Selo; className?: string }) {
  return (
    <span className={`flex min-w-0 items-center text-[11px] leading-4 text-muted-foreground ${className}`}>
      <span className={`mr-1.5 h-2 w-2 shrink-0 rounded-full ${PONTO_DO_TOM[selo.tom]}`} />
      <span className="truncate">{selo.rotulo}</span>
    </span>
  );
}

/** O selo da arte do Estúdio da Agenda: "Arte pronta · aguardando aprovação · 5 lâminas". */
export function SeloDaArte({ arte, className = "" }: { arte: ArteDoEstudioNaAgenda; className?: string }) {
  const selo = seloDaArteDoEstudio(arte);
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${
        selo.alerta ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      } ${className}`}
      title={[selo.texto, selo.laminas].filter(Boolean).join(" · ")}
    >
      <CheckCircle2 className="mr-1 h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{selo.texto}</span>
      {selo.laminas && <span className="ml-1 shrink-0 opacity-80">· {selo.laminas}</span>}
    </span>
  );
}

function Miniatura({ arte, tamanho }: { arte: ArteDoEstudioNaAgenda; tamanho: TamanhoDoCartao }) {
  return (
    <EditorialFileThumbnail
      file={arte.capa}
      fileChildren={arte.filhos}
      total={arte.total}
      className={tamanho === "mes" ? "mb-1.5 h-[84px] w-full rounded-md" : "h-[104px] w-[84px] rounded-lg"}
    />
  );
}

/** Etapa do post pelas mesmas regras da Agenda (passou da hora, publicado...). */
export function etapaDoPost(post: Pick<PostDaAgenda, "producao" | "status" | "scheduled_at">): EditorialVisualStage {
  const status = post.status === "partially_published" ? "published" : post.status;
  return editorialVisualStage(post.producao, status, post.scheduled_at);
}

/** Classes do violeta do item com prazo sem post, as mesmas da Agenda. */
export const COR_DO_PRAZO = { borda: "border-violet-500/25", fundo: "bg-violet-500/10", texto: "text-violet-600 dark:text-violet-400", ponto: "bg-violet-500" };

/** Texto inteiro do tooltip do item: título, formato, estado, roteiro. */
export function tooltipDoItem(item: ItemDaAgenda, selo: Selo, extra?: string | null) {
  const partes = [item.title, `${formatoDoItem(item.delivery_type)} · ${selo.rotulo}`];
  if (extra) partes.push(extra);
  return partes.join("\n");
}

export function CartaoDoItem({
  item,
  selo,
  arte,
  post,
  marcado,
  onToggle,
  tamanho = "mes",
  resumo,
}: {
  item: ItemDaAgenda;
  selo: Selo;
  arte: ArteDoEstudioNaAgenda | null;
  /** Primeiro post agendado deste item, se houver (dá a cor da etapa e o horário). */
  post: PostDaAgenda | null;
  marcado: boolean;
  onToggle: () => void;
  tamanho?: TamanhoDoCartao;
  /** Texto de apoio no cartão grande (gancho ou descrição). */
  resumo?: string | null;
}) {
  const etapa = post ? etapaDoPost(post) : null;
  const cor = etapa ? corDaEtapa(etapa) : COR_DO_PRAZO;
  const rotuloDaEtapa = etapa ? EDITORIAL_VISUAL_STAGE_LABELS[etapa] || rotuloDaPublicacao(post ? post.status : "") : "Prazo";
  const hora = post ? horaCurta(post.scheduled_at) : "";
  const titulo = tooltipDoItem(item, selo, resumo);
  const grande = tamanho === "grande";

  const caixa = (
    <span
      className={`mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
        marcado ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-card"
      }`}
      aria-hidden
    >
      {marcado && <Check className="h-2.5 w-2.5" />}
    </span>
  );

  const linhaDaEtapa = (
    <span className={`flex min-w-0 items-center text-[10.5px] font-semibold uppercase tracking-wide ${cor.texto}`}>
      <span className={`mr-1 h-1.5 w-1.5 shrink-0 rounded-full ${cor.ponto}`} />
      <span className="truncate">{rotuloDaEtapa}</span>
      {hora && (
        <span className="ml-auto flex shrink-0 items-center pl-1 font-medium normal-case tracking-normal tabular-nums">
          <Clock className="mr-0.5 h-3 w-3" />
          {hora}
        </span>
      )}
    </span>
  );

  const linhaDoFormato = (
    <span className="flex min-w-0 items-center text-[11px] text-muted-foreground">
      <IconeDoFormato tipo={item.delivery_type} className="mr-1 h-3 w-3 shrink-0" />
      <span className="truncate">{formatoDoItem(item.delivery_type)}</span>
    </span>
  );

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={marcado}
      title={titulo}
      data-cartao="item"
      className={`group flex w-full min-w-0 rounded-lg border text-left text-foreground transition-colors hover:border-primary/60 ${cor.borda} ${cor.fundo} ${
        marcado ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : ""
      } ${grande ? "items-start p-2.5" : "flex-col p-1.5"}`}
    >
      {grande ? (
        <>
          {arte ? (
            <span className="mr-3 shrink-0"><Miniatura arte={arte} tamanho="grande" /></span>
          ) : (
            <span className="mr-3 flex h-[104px] w-[84px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-card/60 text-muted-foreground">
              <Palette className="h-5 w-5" aria-hidden />
            </span>
          )}
          <span className="min-w-0 flex-1 space-y-1.5">
            {linhaDaEtapa}
            <span className="flex min-w-0 items-start">
              {caixa}
              <span className="ml-1.5 line-clamp-3 min-w-0 flex-1 text-[13.5px] font-semibold leading-snug [overflow-wrap:anywhere]">{item.title}</span>
            </span>
            {resumo && <span className="line-clamp-2 block text-[12px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{resumo}</span>}
            {linhaDoFormato}
            {arte ? <SeloDaArte arte={arte} /> : <SeloDiscreto selo={selo} />}
          </span>
        </>
      ) : (
        <>
          {arte && <Miniatura arte={arte} tamanho="mes" />}
          {linhaDaEtapa}
          <span className="mt-1 flex min-w-0 items-start">
            {caixa}
            <span className="ml-1.5 line-clamp-3 min-w-0 flex-1 text-[12.5px] font-medium leading-[1.3] [overflow-wrap:anywhere]">{item.title}</span>
          </span>
          <span className="mt-1">{linhaDoFormato}</span>
          {arte ? <SeloDaArte arte={arte} className="mt-1 self-start" /> : <SeloDiscreto selo={selo} className="mt-0.5" />}
        </>
      )}
    </button>
  );
}

export function CartaoDoPost({ post, arte, tamanho = "mes" }: { post: PostDaAgenda; arte: ArteDoEstudioNaAgenda | null; tamanho?: TamanhoDoCartao }) {
  const etapa = etapaDoPost(post);
  const cor = corDaEtapa(etapa);
  const rotulo = EDITORIAL_VISUAL_STAGE_LABELS[etapa] || rotuloDaPublicacao(post.status);
  const hora = horaCurta(post.scheduled_at);
  const grande = tamanho === "grande";
  return (
    <div
      title={`${post.titulo}\n${formatoDoPost(post.content_type)} · ${rotulo}${hora ? ` às ${hora}` : ""}`}
      data-cartao="post"
      className={`flex w-full min-w-0 rounded-lg border text-foreground ${cor.borda} ${cor.fundo} ${grande ? "items-start p-2.5" : "flex-col p-1.5"}`}
    >
      {arte && (grande ? <span className="mr-3 shrink-0"><Miniatura arte={arte} tamanho="grande" /></span> : <Miniatura arte={arte} tamanho="mes" />)}
      <span className="min-w-0 flex-1">
        <span className={`flex min-w-0 items-center text-[10.5px] font-semibold uppercase tracking-wide ${cor.texto}`}>
          <span className={`mr-1 h-1.5 w-1.5 shrink-0 rounded-full ${cor.ponto}`} />
          <span className="truncate">{rotulo}</span>
          {hora && (
            <span className="ml-auto flex shrink-0 items-center pl-1 font-medium normal-case tracking-normal tabular-nums">
              <Clock className="mr-0.5 h-3 w-3" />
              {hora}
            </span>
          )}
        </span>
        <span
          className={`mt-1 line-clamp-3 block min-w-0 [overflow-wrap:anywhere] ${grande ? "text-[13.5px] font-semibold leading-snug" : "text-[12.5px] font-medium leading-[1.3]"}`}
        >
          {post.titulo}
        </span>
        <span className="mt-1 flex min-w-0 items-center text-[11px] text-muted-foreground">
          <IconeDoFormato tipo={post.content_type} className="mr-1 h-3 w-3 shrink-0" />
          <span className="truncate">{formatoDoPost(post.content_type)} · post</span>
        </span>
      </span>
    </div>
  );
}

/** Legenda das cores, igual às da Agenda. */
export const LEGENDA_DAS_CORES: { rotulo: string; ponto: string }[] = [
  { rotulo: "prazo sem post", ponto: COR_DO_PRAZO.ponto },
  { rotulo: "em produção", ponto: corDaEtapa("production").ponto },
  { rotulo: "pronto", ponto: corDaEtapa("ready").ponto },
  { rotulo: "programado", ponto: corDaEtapa("scheduled").ponto },
  { rotulo: "passou da hora", ponto: corDaEtapa("overdue").ponto },
  { rotulo: "publicado", ponto: corDaEtapa("published").ponto },
  { rotulo: "falhou", ponto: corDaEtapa("failed").ponto },
];
