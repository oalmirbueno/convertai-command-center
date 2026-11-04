import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { ArrowRight, CalendarClock, ExternalLink, GripVertical, MessageCircle, RotateCcw, UserPlus } from "lucide-react";
import { Etapas, RegiaoRolavel, botao, etiqueta, juntar, texto } from "@/components/sistema";
import {
  ETAPAS_DO_FUNIL, ROTULO_STATUS_PROPOSTA, dataBR, fmtMoeda, hojeISO, linkDoWhatsApp, mensagemDeRetomada, somaPorMoeda, totalEmTexto,
} from "@/lib/freela/freelaLib";
import type { Tables } from "@/integrations/supabase/types";

type Proposta = Tables<"freela_propostas">;
type Contato = Tables<"freela_contatos">;

/** Quadro do funil do Freela, no mesmo desenho do funil do Comercial: colunas com rolagem própria e arrastar. */
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
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

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
    window.setTimeout(() => { acabouDeArrastar.current = false; }, 150);
    const proposta = propostas.find((p) => p.id === e.active.id);
    const etapa = e.over ? String(e.over.id) : null;
    if (proposta && etapa && etapa !== proposta.status) onMover(proposta, etapa);
  };
  const abrir = (p: Proposta) => { if (!acabouDeArrastar.current) onAbrir(p); };

  return (
    <DndContext sensors={sensors} onDragStart={aoIniciar} onDragEnd={aoTerminar} onDragCancel={() => setArrastando(null)}>
      <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:pb-12">
        <Etapas
          className="sticky top-0 z-10 -mx-4 mb-2 border-b border-border bg-background px-4 sm:hidden [&_button]:h-11"
          rotulo="Etapas do funil"
          itens={ETAPAS_DO_FUNIL.map((etapa) => ({
            valor: etapa,
            rotulo: ROTULO_STATUS_PROPOSTA[etapa],
            contador: (porEtapa.get(etapa) || []).length,
          }))}
          valor={etapaNoCelular}
          onEscolher={setEtapaNoCelular}
        />
        <div className="min-w-0 sm:-mx-1 sm:flex sm:overflow-x-auto sm:px-1 sm:pb-2 lg:min-h-0 lg:flex-1 sm:[&>*+*]:ml-3 [scrollbar-width:thin]">
          {ETAPAS_DO_FUNIL.map((etapa) => (
            <Coluna key={etapa} etapa={etapa} propostas={porEtapa.get(etapa) || []} visivelNoCelular={etapaNoCelular === etapa} arrastandoAlgo={!!arrastando}>
              {(porEtapa.get(etapa) || []).map((p) => (
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
            </Coluna>
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {arrastando && (
          <div className="w-[230px] rotate-2 rounded-md border border-primary bg-card p-2.5 shadow-sm">
            <p className="truncate text-[13px] font-medium text-foreground">{arrastando.titulo}</p>
            <p className={juntar(texto.auxiliar, "tabular-nums")}>{fmtMoeda(arrastando.valor, arrastando.moeda)}</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Coluna({ etapa, propostas, visivelNoCelular, arrastandoAlgo, children }: {
  etapa: string;
  propostas: Proposta[];
  visivelNoCelular: boolean;
  arrastandoAlgo: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa });
  const rotulo = ROTULO_STATUS_PROPOSTA[etapa];
  return (
    <section
      ref={setNodeRef}
      aria-label={rotulo}
      className={juntar(
        visivelNoCelular ? "flex" : "hidden",
        "min-h-[12rem] w-full min-w-0 flex-col rounded-lg border p-1.5 transition-colors sm:flex sm:w-[260px] sm:shrink-0 lg:min-h-0 lg:w-auto lg:flex-1 lg:basis-0",
        "max-sm:min-h-0 max-sm:p-0",
        isOver ? "border-primary bg-primary/[0.06]" : arrastandoAlgo ? "border-dashed border-border" : "border-transparent",
      )}
    >
      <div className="hidden h-7 shrink-0 items-center px-1 sm:flex">
        <h3 className={juntar(texto.rotulo, "min-w-0 truncate text-foreground")}>{rotulo}</h3>
        <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">{propostas.length}</span>
      </div>
      <p className={juntar(texto.auxiliar, "shrink-0 truncate px-1 tabular-nums max-sm:hidden")}>{totalEmTexto(somaPorMoeda(propostas))}</p>
      {propostas.length === 0 && <p className={juntar(texto.auxiliar, "py-8 text-center sm:hidden")}>Nada nesta etapa.</p>}
      <RegiaoRolavel rotulo={`Propostas em ${rotulo}`} memoria={`freela:funil:${etapa}`} className="mt-2 space-y-1.5 lg:pr-1 max-sm:mt-0 max-sm:space-y-2">
        {children}
      </RegiaoRolavel>
    </section>
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

  return (
    <article ref={setNodeRef} className={juntar("rounded-md border border-border bg-card p-2.5", isDragging && "opacity-40")}>
      <div className="flex min-w-0 items-start">
        <button type="button" onClick={() => onAbrir(p)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13px] font-medium leading-5 text-foreground">{p.titulo}</p>
          <p className={juntar(texto.auxiliar, "truncate")}>{nome}</p>
          <p className="mt-1 text-[13px] font-medium tabular-nums text-foreground">{fmtMoeda(p.valor, p.moeda)}</p>
        </button>
        {!convertida && (
          <button type="button" {...listeners} {...attributes} aria-label={`Arrastar ${p.titulo}`} className="ml-1 shrink-0 cursor-grab touch-none text-muted-foreground">
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {p.validade_ate && p.status !== "aceita" && p.status !== "perdida" && (
        <p className={juntar(texto.auxiliar, "mt-1")}>válida até {dataBR(p.validade_ate)}</p>
      )}
      {p.link_externo && (
        <a href={p.link_externo} target="_blank" rel="noopener noreferrer" className={juntar(texto.auxiliar, "mt-1 inline-flex items-center text-primary hover:underline")}>
          proposta <ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
        </a>
      )}

      {p.status === "aceita" && (
        convertida ? (
          <Link to="/clientes" className={juntar(etiqueta, "mt-2 inline-flex bg-success/15 text-success")}>Virou cliente</Link>
        ) : (
          <div className="mt-2 space-y-1.5">
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
          </div>
        )
      )}

      {p.status === "perdida" && (
        <div className="mt-2 space-y-1.5">
          {p.motivo_perda && <p className={juntar(texto.auxiliar, "line-clamp-3")}>{p.motivo_perda}</p>}
          {p.follow_up_em && (
            <p className={juntar(texto.auxiliar, "flex items-center", retomarVenceu && "font-medium text-warning")}>
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
    </article>
  );
}
