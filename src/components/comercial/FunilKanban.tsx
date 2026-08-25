import { useMemo, useRef, useState } from "react";
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
import { Download, GripVertical, Plus, Search, ThumbsDown, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

/**
 * O funil, arrastável de ponta a ponta.
 *
 * Antes o estágio só mudava abrindo o lead e escolhendo o destino numa lista
 * — três toques para dizer "avançou". Num funil, mover é o gesto principal:
 * é o que se faz dez vezes por dia e o que dá a leitura do quadro.
 *
 * O arrasto usa mouse e toque como SENSORES SEPARADOS, igual à agenda: com o
 * cartão inteiro arrastável, um sensor de ponteiro único captura o toque e
 * mata a rolagem no celular. Mouse dispara com 3px; no dedo, é preciso
 * segurar 150ms — e até lá a lista rola normalmente.
 *
 * Ganho e Perdido não são colunas: viram uma faixa que só aparece durante o
 * arrasto. Coluna de fechado incha para sempre e empurra o trabalho de hoje
 * para fora da tela; a faixa aparece na hora exata em que ela é útil.
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
}

/**
 * O que decide se um lead está esquecido, num lugar só.
 *
 * Passou a olhar a AGENDA em vez do antigo `next_action_at`: o campo de
 * texto livre era uma anotação que ninguém atualizava, e a atividade é um
 * compromisso com data que alguém precisa concluir.
 */
const estaAtrasado = (agenda: AgendaDoLead) => agenda.atrasadas > 0;

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
}: Props) {
  const queryClient = useQueryClient();
  const [arrastando, setArrastando] = useState<Lead | null>(null);
  const [busca, setBusca] = useState("");
  // A visão separada por classe: cliente atual, upsell e novo prospect não
  // podem se misturar na leitura, mesmo dividindo os mesmos estágios.
  const [classe, setClasse] = useState<string>("todas");
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
   * quebrado — e quem arrasta tenta de novo, criando duas gravações. Se o
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

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onNovo}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-[12.5px] font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Novo lead
        </button>
        <button
          type="button"
          onClick={onImportar}
          disabled={importando}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          Trazer do diagnóstico
        </button>
        <div className="relative min-w-[160px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou empresa"
            className="h-10 pl-9"
            aria-label="Buscar no funil"
          />
        </div>
      </div>

      {/* A régua da visão: cada chip separa uma classe, e "sem classe" empurra
          para a mão o que ainda não foi confirmado: não confirmado é estado
          visível, não um buraco. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {[
          { id: "todas", label: "Todas", total: leads.length },
          ...CLASSES_DO_LEAD.map((c) => ({
            id: c.id as string,
            label: c.label,
            total: leads.filter((lead) => lead.classe === c.id).length,
          })),
          {
            id: "sem",
            label: "Sem classe",
            total: leads.filter((lead) => !lead.classe).length,
          },
        ].map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setClasse(chip.id)}
            className={`flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition-colors ${
              classe === chip.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {chip.label}
            <span className="tabular-nums opacity-70">{chip.total}</span>
          </button>
        ))}
      </div>

      {carregando ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Carregando o funil…
        </p>
      ) : leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">O funil está vazio</p>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
            Cadastre quem já está em conversa, ou traga de uma vez quem preencheu o
            diagnóstico. Cada lead guarda o valor proposto separado em mensalidade e
            entrada, que é o que faz a meta de mensalidade nova bater no fim do mês.
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={aoIniciar} onDragEnd={aoTerminar}>
          {/* A faixa de fechar só existe enquanto há cartão na mão. */}
          {arrastando && (
            <div className="sticky top-2 z-20 mb-2 grid grid-cols-2 gap-2">
              <AlvoDeFechamento
                id="ganho"
                rotulo="Soltar para GANHAR"
                icone={<Trophy className="h-4 w-4" />}
                tom="success"
              />
              <AlvoDeFechamento
                id="perdido"
                rotulo="Soltar para PERDER"
                icone={<ThumbsDown className="h-4 w-4" />}
                tom="destructive"
              />
            </div>
          )}

          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
            {ESTAGIOS_ABERTOS.map((estagio) => (
              <Coluna
                key={estagio}
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

          <DragOverlay dropAnimation={null}>
            {arrastando && (
              <div className="w-[230px] rotate-2 rounded-xl border border-primary bg-card p-2.5 shadow-lg">
                <p className="truncate text-[12.5px] font-semibold text-foreground">
                  {arrastando.name}
                </p>
                {arrastando.company && (
                  <p className="truncate text-[10.5px] text-muted-foreground">
                    {arrastando.company}
                  </p>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

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
  estagio,
  leads,
  agendaDe,
  arrastandoAlgo,
  onAbrir,
}: {
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

  return (
    <div
      ref={setNodeRef}
      className={`w-[240px] shrink-0 rounded-2xl border p-2.5 transition-colors ${
        isOver
          ? "border-primary bg-primary/[0.07]"
          : arrastandoAlgo
            ? "border-dashed border-border bg-card/40"
            : "border-border bg-card/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          title={ajuda}
          className="truncate text-[11px] font-bold uppercase tracking-wide text-foreground"
        >
          {rotuloDoEstagio(estagio)}
        </p>
        <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
          {leads.length}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
        {emJogo > 0 ? `${dinheiro(emJogo)} em jogo` : "vazio"}
        {leads.length > 0 && ` · ${qualificadas}/${leads.length} qualificadas`}
      </p>

      <div className="mt-2 space-y-1.5">
        {leads.map((lead) => (
          <Cartao
            key={lead.id}
            lead={lead}
            agenda={agendaDe(lead)}
            onAbrir={onAbrir}
          />
        ))}
        <div
          className={`rounded-xl border border-dashed px-2 py-4 text-center text-[10px] transition-colors ${
            isOver
              ? "border-primary text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          {isOver ? "soltar aqui" : leads.length === 0 ? "vazio" : "arraste para cá"}
        </div>
      </div>
    </div>
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
      onKeyDown={(evento) => {
        if (evento.key === "Enter") onAbrir(lead);
      }}
      className={`w-full cursor-grab rounded-xl border p-2.5 text-left transition-colors active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      } ${
        atrasado
          ? "border-warning/40 bg-warning/[0.05]"
          : "border-border bg-background hover:border-primary/40"
      }`}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold text-foreground">
            {lead.name}
          </p>
          {lead.company && (
            <p className="truncate text-[10.5px] text-muted-foreground">{lead.company}</p>
          )}
          <p
            className={`mt-0.5 text-[9.5px] uppercase tracking-wide ${
              lead.classe ? "text-muted-foreground" : "italic text-muted-foreground/60"
            }`}
          >
            {rotuloDaClasse(lead.classe)}
          </p>
          <p className="mt-1 text-[10.5px] font-semibold tabular-nums text-primary">
            {lead.monthly_value > 0 && `${dinheiro(lead.monthly_value)}/mês`}
            {lead.monthly_value > 0 && lead.one_off_value > 0 && " + "}
            {lead.one_off_value > 0 && `${dinheiro(lead.one_off_value)} entrada`}
            {lead.monthly_value === 0 && lead.one_off_value === 0 && "sem valor definido"}
          </p>
          {/* O compromisso marcado, não uma anotação: é o que diz se este
              lead tem alguém cuidando dele. */}
          {agenda.proxima ? (
            <p
              className={`mt-1 truncate text-[10px] ${
                atrasado ? "font-semibold text-warning" : "text-muted-foreground"
              }`}
            >
              {atrasado ? "Atrasado: " : `${rotuloDaAtividade(agenda.proxima.kind)}: `}
              {agenda.proxima.title}
            </p>
          ) : (
            <p className="mt-1 text-[10px] italic text-muted-foreground/70">
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
        : "border-success/40 bg-success/10 text-success"
      : isOver
        ? "border-destructive bg-destructive text-white"
        : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <div
      ref={setNodeRef}
      className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-dashed text-[11.5px] font-bold uppercase tracking-wide transition-colors ${cor}`}
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

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onCancelar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ganhou ? (
              <Trophy className="h-4 w-4 text-success" />
            ) : (
              <ThumbsDown className="h-4 w-4 text-destructive" />
            )}
            {ganhou ? "Fechou com" : "Perdeu"} {lead.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {ganhou ? (
            <>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {lead.monthly_value > 0 && `${dinheiro(lead.monthly_value)}/mês`}
                {lead.monthly_value > 0 && lead.one_off_value > 0 && " + "}
                {lead.one_off_value > 0 && `${dinheiro(lead.one_off_value)} de entrada`}
                {lead.monthly_value === 0 &&
                  lead.one_off_value === 0 &&
                  "Este lead está sem valor definido. A meta de mensalidade nova não vai contar nada por ele."}
              </p>
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Cliente no painel (opcional)
                </p>
                {/* O elo com o cadastro é o que deixa o financeiro responder
                    depois quanto aquele lead virou de verdade. */}
                <Select value={cliente} onValueChange={setCliente}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Ligar a um cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Ainda não cadastrei</SelectItem>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">
                Por que não seguiu? É a única linha que ensina o próximo lead.
              </p>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Preço, prazo, escolheu outro, sumiu…"
                className="h-10"
                autoFocus
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancelar}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border text-[12px] font-semibold text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
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
              className={`h-11 flex-1 rounded-xl text-[12px] font-semibold text-white ${
                ganhou ? "bg-success" : "bg-destructive"
              }`}
            >
              {ganhou ? "Confirmar ganho" : "Confirmar perda"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
