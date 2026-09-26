import { useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { Download, GripVertical, KanbanSquare, ListFilter, Plus, ThumbsDown, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AreaDeTrabalho,
  CampoDeFormulario,
  Carregando,
  EstadoVazio,
  Etapas,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  campo,
  foco,
  juntar,
  texto,
} from "@/components/sistema";
import {
  ESTAGIOS,
  ESTAGIOS_ABERTOS,
  type AgendaDoLead,
  type Atividade,
  type EstagioId,
  type Lead,
  CLASSES_DO_LEAD,
  agendaDoLead,
  dinheiro,
  leadQualificado,
  moverLead,
  rotuloDaClasse,
  rotuloDaAtividade,
  rotuloDoEstagio,
} from "@/lib/comercial";
import { CampoDeBusca } from "@/components/sistema";
import { ehTexto, umaDe, useEstadoDoComercial } from "./useEstadoDoComercial";

/**
 * O funil, arrastável de ponta a ponta.
 *
 * Antes o estágio só mudava abrindo o lead e escolhendo o destino numa lista
 * (três toques para dizer "avançou"). Num funil, mover é o gesto principal:
 * é o que se faz dez vezes por dia e o que dá a leitura do quadro.
 *
 * O arrasto usa mouse e toque como SENSORES SEPARADOS, igual à agenda: com o
 * cartão inteiro arrastável, um sensor de ponteiro único captura o toque e
 * mata a rolagem no celular. Mouse dispara com 3px; no dedo, é preciso
 * segurar 150ms, e até lá a lista rola normalmente.
 *
 * Ganho e Perdido não são colunas: viram uma faixa que só aparece durante o
 * arrasto. Coluna de fechado incha para sempre e empurra o trabalho de hoje
 * para fora da tela; a faixa aparece na hora exata em que ela é útil.
 *
 * Rolagem (sistema de design): de 1024 px para cima o quadro ocupa a altura
 * da janela e cada coluna rola sozinha, lembrando onde estava; se as colunas
 * não cabem, o quadro rola para o lado por dentro. No tablet as colunas ficam
 * lado a lado e a página rola normal; no celular, uma etapa por vez.
 */

interface Props {
  leads: Lead[];
  atividades: Atividade[];
  carregando: boolean;
  clientes: Array<{ id: string; nome: string }>;
  onAbrir: (lead: Lead) => void;
  onNovo: () => void;
  onImportar: () => void;
  importando: boolean;
  onMovido: () => Promise<unknown>;
  /** Controles da página na mesma fileira dos filtros (ex.: Negócios | Empresas). */
  filtrosAntes?: ReactNode;
  /**
   * Lugar da página para os filtros (a linha das Etapas, de 1280 px para
   * cima): a fileira sobe para a linha das áreas e o quadro ganha altura.
   */
  destinoDosFiltros?: HTMLElement | null;
}

/**
 * O que decide se um lead está esquecido, num lugar só.
 *
 * Passou a olhar a AGENDA em vez do antigo `next_action_at`: o campo de
 * texto livre era uma anotação que ninguém atualizava, e a atividade é um
 * compromisso com data que alguém precisa concluir.
 */
const estaAtrasado = (agenda: AgendaDoLead) => agenda.atrasadas > 0;

const CLASSES_DO_FILTRO = ["todas", ...CLASSES_DO_LEAD.map((c) => c.id as string), "sem"];

export default function FunilKanban({
  leads,
  atividades,
  carregando,
  clientes,
  onAbrir,
  onNovo,
  onImportar,
  importando,
  onMovido,
  filtrosAntes,
  destinoDosFiltros = null,
}: Props) {
  const queryClient = useQueryClient();
  const [arrastando, setArrastando] = useState<Lead | null>(null);
  // Busca, classe e etapa do celular ficam guardadas: sair e voltar mantém.
  const [busca, setBusca] = useEstadoDoComercial("funil:busca", "", { validar: ehTexto });
  // A visão separada por classe: cliente atual, upsell e novo prospect não
  // podem se misturar na leitura, mesmo dividindo os mesmos estágios.
  const [classe, setClasse] = useEstadoDoComercial<string>("funil:classe", "todas", { validar: umaDe(CLASSES_DO_FILTRO) });
  // No celular o quadro mostra UMA etapa por vez, escolhida nas Etapas: seis
  // colunas estreitas rolando de lado nao se leem em 380px de tela.
  const [etapaNoCelular, setEtapaNoCelular] = useEstadoDoComercial<EstagioId>("funil:etapa-no-celular", ESTAGIOS_ABERTOS[0], {
    validar: umaDe(ESTAGIOS_ABERTOS),
  });
  const [fechamento, setFechamento] = useState<{
    lead: Lead;
    destino: "ganho" | "perdido";
  } | null>(null);
  // Guarda o clique: sem isto, soltar o cartão no mesmo lugar abre o lead.
  const acabouDeArrastar = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const agoraIso = new Date().toISOString();
  const termo = busca.trim().toLowerCase();
  const agendaDe = (lead: Lead) => agendaDoLead(atividades, lead.id, agoraIso);

  const porEstagio = useMemo(() => {
    const mapa = new Map<string, Lead[]>();
    for (const estagio of ESTAGIOS_ABERTOS) mapa.set(estagio, []);
    for (const lead of leads) {
      if (!mapa.has(lead.stage)) continue;
      if (classe === "sem" ? lead.classe !== null : classe !== "todas" && lead.classe !== classe) {
        continue;
      }
      if (
        termo &&
        !`${lead.name} ${lead.company || ""}`.toLowerCase().includes(termo)
      ) {
        continue;
      }
      mapa.get(lead.stage)!.push(lead);
    }
    // Atrasado primeiro: o quadro tem que empurrar para a mão o que está
    // parado, não escondê-lo no fim da coluna.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => {
        const agendaA = agendaDoLead(atividades, a.id, agoraIso);
        const agendaB = agendaDoLead(atividades, b.id, agoraIso);
        const atrasoA = estaAtrasado(agendaA) ? 0 : 1;
        const atrasoB = estaAtrasado(agendaB) ? 0 : 1;
        if (atrasoA !== atrasoB) return atrasoA - atrasoB;
        // Sem compromisso marcado vai para o fim: é o lead que ninguém
        // agendou, e o quadro precisa deixar isso visível.
        return (agendaA.proxima?.due_at || "9999").localeCompare(
          agendaB.proxima?.due_at || "9999",
        );
      });
    }
    return mapa;
  }, [leads, termo, classe, atividades, agoraIso]);

  /**
   * Move na tela primeiro, grava depois.
   *
   * Esperar a ida ao banco para o cartão sair do lugar faz o arrasto parecer
   * quebrado, e quem arrasta tenta de novo, criando duas gravações. Se o
   * banco recusar, a lista é recarregada e o cartão volta sozinho.
   */
  const moverNaTela = (leadId: string, destino: EstagioId) => {
    queryClient.setQueryData<Lead[]>(["comercial-leads"], (atual) =>
      (atual || []).map((lead) =>
        lead.id === leadId ? { ...lead, stage: destino } : lead,
      ),
    );
  };

  const aplicarMovimento = async (
    lead: Lead,
    destino: EstagioId,
    motivo?: string,
    clienteGanho?: string | null,
  ) => {
    moverNaTela(lead.id, destino);
    const ok = await moverLead({ lead, paraEstagio: destino, motivo, clienteGanho });
    await onMovido();
    if (!ok) {
      toast.error("Não foi possível mover o lead.");
      return;
    }
    toast.success(`${lead.name} → ${rotuloDoEstagio(destino)}`);
  };

  const aoIniciar = (evento: DragStartEvent) => {
    const lead = (evento.active.data.current as { lead?: Lead } | undefined)?.lead;
    setArrastando(lead || null);
  };

  const aoTerminar = async (evento: DragEndEvent) => {
    const lead = (evento.active.data.current as { lead?: Lead } | undefined)?.lead;
    setArrastando(null);
    acabouDeArrastar.current = true;
    // O clique de "soltar" chega logo depois do fim do arrasto.
    window.setTimeout(() => {
      acabouDeArrastar.current = false;
    }, 120);
    const destino = evento.over?.id ? String(evento.over.id) : null;
    if (!lead || !destino || destino === lead.stage) return;

    // Fechar pede contexto: o motivo da perda é o que ensina o próximo lead,
    // e o cliente do ganho é a ponte para o financeiro responder quanto
    // aquele lead virou.
    if (destino === "ganho" || destino === "perdido") {
      setFechamento({ lead, destino });
      return;
    }
    await aplicarMovimento(lead, destino as EstagioId);
  };

  // A régua da visão: cada opção separa uma classe, e "sem classe" empurra
  // para a mão o que ainda não foi confirmado: não confirmado é estado
  // visível, não um buraco.
  const opcoesDeClasse = [
    { valor: "todas", rotulo: "Todas", descricao: "Todas as classes", contador: leads.length },
    ...CLASSES_DO_LEAD.map((c) => ({
      valor: c.id as string,
      rotulo: c.label,
      contador: leads.filter((lead) => lead.classe === c.id).length,
    })),
    { valor: "sem", rotulo: "Sem classe", contador: leads.filter((lead) => !lead.classe).length },
  ];

  const emLinha = Boolean(destinoDosFiltros);
  const filtros = (
    <div
      className={emLinha ? "flex min-w-0 items-center [&>*+*]:ml-2" : "-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1"}
      role="group"
      aria-label="Filtros do funil"
    >
        {filtrosAntes}
        <SeletorCompacto
          rotulo="Classe"
          icone={<ListFilter className="h-3.5 w-3.5" />}
          opcoes={opcoesDeClasse}
          valor={classe}
          onEscolher={setClasse}
        />
        <CampoDeBusca
          valor={busca}
          onMudar={setBusca}
          placeholder="Buscar por nome ou empresa"
          rotulo="Buscar no funil"
          className={emLinha ? "w-[240px] desk:w-[300px]" : "min-w-[180px] flex-1 sm:max-w-[320px]"}
        />
    </div>
  );

  return (
    <>
      {destinoDosFiltros ? createPortal(filtros, destinoDosFiltros) : filtros}

      <AreaDeTrabalho principalRolavel={false} rotuloDoPrincipal="Funil" className={emLinha ? "" : "mt-3"}>
        {carregando ? (
          <Carregando rotulo="Carregando o funil" linhas={4} />
        ) : leads.length === 0 ? (
          <EstadoVazio
            icone={<KanbanSquare className="h-5 w-5" />}
            titulo="O funil está vazio"
            descricao="Cadastre quem já está em conversa ou traga quem preencheu o diagnóstico."
            acao={
              <div className="flex flex-wrap items-center justify-center [&>*]:m-1">
                <button type="button" onClick={onImportar} disabled={importando} className={botao.secundario}>
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Trazer do diagnóstico
                </button>
                <button type="button" onClick={onNovo} className={botao.primario}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Novo lead
                </button>
              </div>
            }
          />
        ) : (
          <DndContext sensors={sensors} onDragStart={aoIniciar} onDragEnd={aoTerminar}>
            {/* lg:pb-12: o botão flutuante do painel (canto de baixo) não cobre o alvo de soltar da última coluna. */}
            <div className="relative flex min-w-0 flex-col lg:min-h-0 lg:flex-1 lg:pb-12">
              {/* A faixa de fechar só existe enquanto há cartão na mão. No
                  computador ela cobre o topo das colunas (nada se mexe de
                  lugar durante o arrasto); no celular gruda no topo da tela. */}
              {arrastando && (
                <div className="sticky top-2 z-20 mb-2 grid grid-cols-2 gap-2 lg:absolute lg:inset-x-0 lg:top-0 lg:mb-0">
                  <AlvoDeFechamento
                    id="ganho"
                    rotulo="Soltar para ganhar"
                    icone={<Trophy className="mr-2 h-4 w-4" aria-hidden="true" />}
                    tom="success"
                  />
                  <AlvoDeFechamento
                    id="perdido"
                    rotulo="Soltar para perder"
                    icone={<ThumbsDown className="mr-2 h-4 w-4" aria-hidden="true" />}
                    tom="destructive"
                  />
                </div>
              )}

              {/* Celular: uma etapa por vez, com a contagem de cada uma. */}
              <Etapas
                className="mb-2 border-b border-border sm:hidden"
                rotulo="Etapas do funil"
                itens={ESTAGIOS_ABERTOS.map((estagio) => ({
                  valor: estagio,
                  rotulo: rotuloDoEstagio(estagio),
                  contador: (porEstagio.get(estagio) || []).length,
                }))}
                valor={etapaNoCelular}
                onEscolher={(v) => setEtapaNoCelular(v as EstagioId)}
              />

              <div className="min-w-0 sm:-mx-1 sm:flex sm:overflow-x-auto sm:px-1 sm:pb-2 lg:min-h-0 lg:flex-1 sm:[&>*+*]:ml-3 [scrollbar-width:thin]">
                {ESTAGIOS_ABERTOS.map((estagio) => (
                  <Coluna
                    key={estagio}
                    visivelNoCelular={etapaNoCelular === estagio}
                    estagio={estagio}
                    leads={porEstagio.get(estagio) || []}
                    agendaDe={agendaDe}
                    arrastandoAlgo={Boolean(arrastando)}
                    onAbrir={(lead) => {
                      if (acabouDeArrastar.current) return;
                      onAbrir(lead);
                    }}
                  />
                ))}
              </div>
            </div>

            <DragOverlay dropAnimation={null}>
              {arrastando && (
                <div className="w-[230px] rotate-2 rounded-md border border-primary bg-card p-2.5 shadow-lg">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {arrastando.name}
                  </p>
                  {arrastando.company && (
                    <p className={juntar(texto.auxiliar, "truncate")}>
                      {arrastando.company}
                    </p>
                  )}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </AreaDeTrabalho>

      {fechamento && (
        <DialogoDeFechamento
          lead={fechamento.lead}
          destino={fechamento.destino}
          clientes={clientes}
          onCancelar={async () => {
            setFechamento(null);
            // O cartão pode ter sido movido na tela por outro caminho; a
            // recarga garante que ele volte para onde o banco diz.
            await onMovido();
          }}
          onConfirmar={async (motivo, clienteGanho) => {
            const alvo = fechamento;
            setFechamento(null);
            await aplicarMovimento(alvo.lead, alvo.destino, motivo, clienteGanho);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────── Coluna ─────────────────────────────────── */

function Coluna({
  visivelNoCelular,
  estagio,
  leads,
  agendaDe,
  arrastandoAlgo,
  onAbrir,
}: {
  visivelNoCelular: boolean;
  estagio: EstagioId;
  leads: Lead[];
  agendaDe: (lead: Lead) => AgendaDoLead;
  arrastandoAlgo: boolean;
  onAbrir: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: estagio });
  const emJogo = leads.reduce(
    (soma, lead) => soma + lead.monthly_value * 12 + lead.one_off_value,
    0,
  );
  // Qualificada = classe + dono + próximo passo agendado. O placar fica no
  // topo da coluna porque "quantas dessas são de verdade" é a pergunta que
  // se faz olhando o estágio, não abrindo lead por lead.
  const qualificadas = leads.filter((lead) =>
    leadQualificado(lead, Boolean(agendaDe(lead).proxima)),
  ).length;
  const ajuda = ESTAGIOS.find((e) => e.id === estagio)?.ajuda;
  const rotulo = rotuloDoEstagio(estagio);

  return (
    <section
      ref={setNodeRef}
      aria-label={rotulo}
      // A lista de cartões rola por dentro da coluna (de 1024 px para cima):
      // com dez leads em "Novo" a coluna empurrava a pagina inteira e as
      // outras sumiam da tela.
      className={juntar(
        visivelNoCelular ? "flex" : "hidden",
        "min-h-[12rem] w-full min-w-0 flex-col rounded-lg border p-1.5 transition-colors sm:flex sm:w-[260px] sm:shrink-0 lg:min-h-0 lg:w-auto lg:min-w-[232px] lg:flex-1",
        isOver ? "border-primary bg-primary/[0.06]" : arrastandoAlgo ? "border-dashed border-border" : "border-transparent",
      )}
    >
      {/* No celular o nome e a contagem já estão nas Etapas logo acima. */}
      <div className="hidden h-7 shrink-0 items-center px-1 sm:flex">
        <h3 title={ajuda} className={juntar(texto.rotulo, "min-w-0 truncate text-foreground")}>
          {rotulo}
        </h3>
        <span className="ml-2 shrink-0 text-[11px] tabular-nums text-muted-foreground">{leads.length}</span>
      </div>
      <p className={juntar(texto.auxiliar, "shrink-0 truncate px-1 tabular-nums")}>
        {emJogo > 0 ? `${dinheiro(emJogo)} em jogo` : "vazio"}
        {leads.length > 0 && ` · ${qualificadas}/${leads.length} qualificadas`}
      </p>

      <RegiaoRolavel
        rotulo={`Leads em ${rotulo}`}
        memoria={`comercial:funil:${estagio}`}
        className="mt-2 space-y-1.5 lg:pr-1"
      >
        {leads.map((lead) => (
          <Cartao
            key={lead.id}
            lead={lead}
            agenda={agendaDe(lead)}
            onAbrir={onAbrir}
          />
        ))}
      </RegiaoRolavel>
      {/* O alvo de soltar fica fora da rolagem: sempre visivel no pe da coluna. */}
      <div className="mt-1.5 shrink-0">
        <div
          className={juntar(
            "rounded-md border border-dashed px-2 py-2 text-center text-[11px] transition-colors",
            isOver ? "border-primary text-primary" : "border-border text-muted-foreground",
          )}
        >
          {isOver ? "soltar aqui" : leads.length === 0 ? "vazio" : "arraste para cá"}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── Cartão ─────────────────────────────────── */

function Cartao({
  lead,
  agenda,
  onAbrir,
}: {
  lead: Lead;
  agenda: AgendaDoLead;
  onAbrir: (lead: Lead) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lead:${lead.id}`,
    data: { lead },
  });
  const atrasado = estaAtrasado(agenda);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onAbrir(lead)}
      role="button"
      tabIndex={0}
      aria-label={`Abrir lead ${lead.name}`}
      onKeyDown={(evento) => {
        if (evento.key === "Enter") onAbrir(lead);
      }}
      className={juntar(
        "w-full cursor-grab rounded-md border bg-card p-2.5 text-left transition-colors active:cursor-grabbing",
        foco,
        isDragging && "opacity-40",
        atrasado ? "border-warning/50" : "border-border hover:border-muted-foreground/30",
      )}
    >
      <div className="flex items-start">
        <GripVertical className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-5 text-foreground">
            {lead.name}
          </p>
          {lead.company && (
            <p className={juntar(texto.auxiliar, "truncate")}>{lead.company}</p>
          )}
          <p className={juntar("mt-0.5 truncate text-[11px] leading-4", lead.classe ? "text-muted-foreground" : "italic text-muted-foreground/70")}>
            {rotuloDaClasse(lead.classe)}
          </p>
          <p className="mt-1 truncate text-[12px] font-medium tabular-nums text-primary">
            {lead.monthly_value > 0 && `${dinheiro(lead.monthly_value)}/mês`}
            {lead.monthly_value > 0 && lead.one_off_value > 0 && " + "}
            {lead.one_off_value > 0 && `${dinheiro(lead.one_off_value)} entrada`}
            {lead.monthly_value === 0 && lead.one_off_value === 0 && "sem valor definido"}
          </p>
          {/* O compromisso marcado, não uma anotação: é o que diz se este
              lead tem alguém cuidando dele. */}
          {agenda.proxima ? (
            <p
              className={juntar(
                "mt-1 truncate text-[11px] leading-4",
                atrasado ? "font-medium text-warning" : "text-muted-foreground",
              )}
            >
              {atrasado ? "Atrasado: " : `${rotuloDaAtividade(agenda.proxima.kind)}: `}
              {agenda.proxima.title}
            </p>
          ) : (
            <p className="mt-1 text-[11px] italic leading-4 text-muted-foreground/70">
              sem próximo passo
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────── Faixa de ganho e perda ────────────────────────── */

function AlvoDeFechamento({
  id,
  rotulo,
  icone,
  tom,
}: {
  id: "ganho" | "perdido";
  rotulo: string;
  icone: React.ReactNode;
  tom: "success" | "destructive";
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const cor =
    tom === "success"
      ? isOver
        ? "border-success bg-success text-white"
        : "border-success/50 bg-card text-success"
      : isOver
        ? "border-destructive bg-destructive text-white"
        : "border-destructive/50 bg-card text-destructive";
  return (
    <div
      ref={setNodeRef}
      className={juntar("flex h-12 items-center justify-center rounded-md border-2 border-dashed text-[13px] font-semibold transition-colors", cor)}
    >
      {icone}
      {rotulo}
    </div>
  );
}

/* ───────────────────────── Diálogo de fechamento ────────────────────────── */

function DialogoDeFechamento({
  lead,
  destino,
  clientes,
  onCancelar,
  onConfirmar,
}: {
  lead: Lead;
  destino: "ganho" | "perdido";
  clientes: Array<{ id: string; nome: string }>;
  onCancelar: () => void;
  onConfirmar: (motivo: string, clienteGanho: string | null) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [cliente, setCliente] = useState("nenhum");
  const ganhou = destino === "ganho";
  const valor =
    lead.monthly_value === 0 && lead.one_off_value === 0
      ? "Sem valor definido: a meta de mensalidade nova não conta nada por ele."
      : [
          lead.monthly_value > 0 ? `${dinheiro(lead.monthly_value)}/mês` : "",
          lead.one_off_value > 0 ? `${dinheiro(lead.one_off_value)} de entrada` : "",
        ]
          .filter(Boolean)
          .join(" + ");

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onCancelar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center text-[15px]">
            {ganhou ? (
              <Trophy className="mr-2 h-4 w-4 text-success" aria-hidden="true" />
            ) : (
              <ThumbsDown className="mr-2 h-4 w-4 text-destructive" aria-hidden="true" />
            )}
            {ganhou ? "Fechou com" : "Perdeu"} {lead.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {ganhou ? (
            // O elo com o cadastro é o que deixa o financeiro responder
            // depois quanto aquele lead virou de verdade.
            <CampoDeFormulario rotulo="Cliente no painel" apoio={valor}>
              <select value={cliente} onChange={(e) => setCliente(e.target.value)} className={campo}>
                <option value="nenhum">Ainda não cadastrei</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          ) : (
            <CampoDeFormulario rotulo="Por que não seguiu?" obrigatorio ajuda="É a única linha que ensina o próximo lead.">
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Preço, prazo, escolheu outro, sumiu"
                className={campo}
                autoFocus
              />
            </CampoDeFormulario>
          )}

          <div className="flex items-center justify-end [&>*+*]:ml-2">
            <button type="button" onClick={onCancelar} className={botao.secundario}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                if (!ganhou && motivo.trim().length < 3) {
                  toast.error("Escreva o motivo em uma linha.");
                  return;
                }
                onConfirmar(motivo, cliente === "nenhum" ? null : cliente);
              }}
              className={ganhou ? juntar(botao.primario, "bg-success hover:bg-success/90") : juntar(botao.primario, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            >
              {ganhou ? "Confirmar ganho" : "Confirmar perda"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
