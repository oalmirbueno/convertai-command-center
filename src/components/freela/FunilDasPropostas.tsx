import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDraggable, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { ArrowRight, CalendarClock, ChevronRight, ExternalLink, GripVertical, MessageCircle, RotateCcw, UserPlus } from "lucide-react";
import { ColunaDoQuadro, QuadroKanban, botao, classesDoCartao, etiqueta, juntar, texto } from "@/components/sistema";
import {
  ETAPAS_DO_FUNIL, ROTULO_STATUS_PROPOSTA, dataBR, fmtMoeda, hojeISO, linkDoWhatsApp, mensagemDeRetomada, somaPorMoeda, totalEmTexto,
} from "@/lib/freela/freelaLib";
import type { Tables } from "@/integrations/supabase/types";

type Proposta = Tables<"freela_propostas">;
type Contato = Tables<"freela_contatos">;

/** Funil do Freela: o mesmo quadro do funil do Comercial (QuadroKanban); aqui só o que vai dentro do cartão. */
export default function FunilDasPropostas({
  propostas, contatoDe, propostasComProjeto, onAbrir, onMover, onTransformar, onVirarProjeto, onRetomar,
}: {
  propostas: Proposta[];
  contatoDe: (id: string) => Contato | undefined;
  propostasComProjeto: Set<string | null>;
  onAbrir: (p: Proposta) => void;
  onMover: (p: Proposta, etapa: string) => void;
  onTransformar: (p: Proposta) => void;
  onVirarProjeto: (p: Proposta) => void;
  onRetomar: (p: Proposta) => void;
}) {
  const [etapaNoCelular, setEtapaNoCelular] = useState<string>(ETAPAS_DO_FUNIL[0]);
  const [arrastando, setArrastando] = useState<Proposta | null>(null);
  const acabouDeArrastar = useRef(false);

  const porEtapa = useMemo(() => {
    const mapa = new Map<string, Proposta[]>(ETAPAS_DO_FUNIL.map((e) => [e, []]));
    propostas.forEach((p) => mapa.get(p.status)?.push(p));
    // Perdidos: quem está na hora de retomar vem primeiro.
    mapa.get("perdida")?.sort((a, b) => (a.follow_up_em || "9999").localeCompare(b.follow_up_em || "9999"));
    return mapa;
  }, [propostas]);

  const aoIniciar = (e: DragStartEvent) => setArrastando(propostas.find((p) => p.id === e.active.id) || null);
  const aoTerminar = (e: DragEndEvent) => {
    setArrastando(null);
    acabouDeArrastar.current = true;
    window.setTimeout(() => { acabouDeArrastar.current = false; }, 120);
    const proposta = propostas.find((p) => p.id === e.active.id);
    const etapa = e.over ? String(e.over.id) : null;
    if (proposta && etapa && etapa !== proposta.status) onMover(proposta, etapa);
  };
  const abrir = (p: Proposta) => { if (!acabouDeArrastar.current) onAbrir(p); };

  return (
    <QuadroKanban
      aoIniciar={aoIniciar}
      aoTerminar={aoTerminar}
      aoCancelar={() => setArrastando(null)}
      etapas={ETAPAS_DO_FUNIL.map((etapa) => ({
        valor: etapa,
        rotulo: ROTULO_STATUS_PROPOSTA[etapa],
        contador: (porEtapa.get(etapa) || []).length,
      }))}
      etapaNoCelular={etapaNoCelular}
      aoEscolherEtapa={setEtapaNoCelular}
      fantasma={arrastando ? { titulo: arrastando.titulo, apoio: fmtMoeda(arrastando.valor, arrastando.moeda) } : null}
    >
      {ETAPAS_DO_FUNIL.map((etapa) => {
        const daEtapa = porEtapa.get(etapa) || [];
        return (
          <ColunaDoQuadro
            key={etapa}
            id={etapa}
            rotulo={ROTULO_STATUS_PROPOSTA[etapa]}
            contagem={daEtapa.length}
            resumo={totalEmTexto(somaPorMoeda(daEtapa))}
            visivelNoCelular={etapaNoCelular === etapa}
            arrastandoAlgo={!!arrastando}
            memoria={`freela:funil:${etapa}`}
            vazio="Nenhuma proposta nesta etapa."
          >
            {daEtapa.map((p) => (
              <Cartao
                key={p.id}
                proposta={p}
                contato={contatoDe(p.contato_id)}
                virouProjeto={propostasComProjeto.has(p.id)}
                onAbrir={abrir}
                onTransformar={onTransformar}
                onVirarProjeto={onVirarProjeto}
                onRetomar={onRetomar}
              />
            ))}
          </ColunaDoQuadro>
        );
      })}
    </QuadroKanban>
  );
}

function Cartao({ proposta: p, contato, virouProjeto, onAbrir, onTransformar, onVirarProjeto, onRetomar }: {
  proposta: Proposta;
  contato: Contato | undefined;
  virouProjeto: boolean;
  onAbrir: (p: Proposta) => void;
  onTransformar: (p: Proposta) => void;
  onVirarProjeto: (p: Proposta) => void;
  onRetomar: (p: Proposta) => void;
}) {
  const convertida = !!p.convertida_em;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: p.id, disabled: convertida });
  const nome = contato ? contato.empresa || contato.nome : "Contato removido";
  const retomarVenceu = !!p.follow_up_em && p.follow_up_em <= hojeISO();
  const whatsapp = contato ? linkDoWhatsApp(contato.whatsapp, mensagemDeRetomada(contato.nome, p.titulo)) : null;
  // Botão dentro do cartão não arrasta nem abre a proposta.
  const soOBotao = {
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onAbrir(p)}
      role="button"
      tabIndex={0}
      aria-label={`Abrir proposta ${p.titulo}`}
      data-arrasta={convertida ? undefined : ""}
      onKeyDown={(evento) => {
        if (evento.key === "Enter") onAbrir(p);
      }}
      className={classesDoCartao(isDragging, p.status === "perdida" && retomarVenceu)}
    >
      <div className="flex items-start max-sm:items-center">
        <GripVertical className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 max-sm:hidden" aria-hidden="true" />
        <span aria-hidden="true" className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[14px] font-semibold text-primary sm:hidden">
          {(nome.trim().charAt(0) || "?").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-5 text-foreground max-sm:text-[14px]">{p.titulo}</p>
          <p className={juntar(texto.auxiliar, "truncate")}>{nome}</p>
          <p className="mt-1 truncate text-[12px] font-medium tabular-nums text-primary">{fmtMoeda(p.valor, p.moeda)}</p>
          {p.validade_ate && p.status !== "aceita" && p.status !== "perdida" && (
            <p className="mt-0.5 truncate text-[11px] tabular-nums leading-4 text-muted-foreground">válida até {dataBR(p.validade_ate)}</p>
          )}
          {p.link_externo && (
            <a href={p.link_externo} target="_blank" rel="noopener noreferrer" {...soOBotao} className="mt-0.5 inline-flex items-center text-[11px] leading-4 text-primary hover:underline">
              proposta <ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
        <span className="ml-2 inline-flex shrink-0 sm:hidden" aria-hidden="true">
          <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
        </span>
      </div>

      {p.status === "aceita" && (
        <div {...soOBotao} className="mt-2 space-y-1.5">
          {convertida ? (
            <Link to="/clientes" className={juntar(etiqueta, "inline-flex bg-success/15 text-success")}>Virou cliente</Link>
          ) : (
            <>
              <button type="button" onClick={() => onTransformar(p)} className={juntar(botao.primario, "w-full justify-center")}>
                <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Transformar em cliente
              </button>
              {!virouProjeto ? (
                <button type="button" onClick={() => onVirarProjeto(p)} className={juntar(botao.barra, "w-full justify-center")}>
                  <ArrowRight className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Só projeto, sem cliente
                </button>
              ) : (
                <span className={juntar(etiqueta, "bg-primary/10 text-primary")}>Virou projeto</span>
              )}
            </>
          )}
        </div>
      )}

      {p.status === "perdida" && (
        <div {...soOBotao} className="mt-2 space-y-1.5">
          {p.motivo_perda && <p className="line-clamp-3 text-[11px] leading-4 text-muted-foreground">{p.motivo_perda}</p>}
          {p.follow_up_em && (
            <p className={juntar("flex items-center text-[11px] leading-4", retomarVenceu ? "font-medium text-warning" : "text-muted-foreground")}>
              <CalendarClock className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {retomarVenceu ? "Hora de retomar" : "Retomar"} em {dataBR(p.follow_up_em)}
            </p>
          )}
          <div className="flex min-w-0 [&>*+*]:ml-1.5">
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={juntar(botao.barra, "inline-flex items-center")}>
                <MessageCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Mensagem
              </a>
            )}
            <button type="button" onClick={() => onRetomar(p)} className={botao.barra}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Retomar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
