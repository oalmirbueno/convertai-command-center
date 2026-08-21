import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Clock, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TIPOS_DE_ATIVIDADE,
  type Atividade,
  type Lead,
  apagarAtividade,
  concluirAtividade,
  rotuloDaAtividade,
  salvarAtividade,
} from "@/lib/comercial";

/**
 * A agenda do comercial, em calendario de mes.
 *
 * Antes era uma lista de "atrasadas, hoje, depois". Lista responde o que
 * fazer agora, mas nao responde a pergunta que se faz ao marcar uma reuniao:
 * "como esta minha semana?". Num calendario a resposta e o proprio desenho
 * da tela, e marcar vira tocar no dia.
 *
 * Aceita compromisso PROPRIO, sem lead: reuniao de planejamento, bloco para
 * escrever proposta, conversa com quem ainda nao virou lead. Sem isso a
 * agenda seria metade da verdade, e ninguem confiaria nela para saber se o
 * dia esta cheio.
 */

interface Props {
  atividades: Atividade[];
  leads: Lead[];
  onAbrirLead: (lead: Lead) => void;
  onMudou: () => Promise<unknown>;
}

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const pad = (n: number) => String(n).padStart(2, "0");
const diaIso = (data: Date) =>
  `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * O dia local de um compromisso.
 *
 * A conta usa o relogio de quem esta olhando, e nao a data em UTC: uma
 * reuniao das 21h de Brasilia cai no dia seguinte em UTC, e apareceria na
 * casinha errada do calendario.
 */
const diaDoCompromisso = (atividade: Atividade) => diaIso(new Date(atividade.due_at));

export default function AgendaComercial({
  atividades,
  leads,
  onAbrirLead,
  onMudou,
}: Props) {
  const queryClient = useQueryClient();
  const hoje = new Date();
  const [mesAberto, setMesAberto] = useState(
    () => new Date(hoje.getFullYear(), hoje.getMonth(), 1),
  );
  const [diaEscolhido, setDiaEscolhido] = useState<string>(diaIso(hoje));
  const [novoEm, setNovoEm] = useState<string | null>(null);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Atividade[]>();
    for (const atividade of atividades) {
      const dia = diaDoCompromisso(atividade);
      const lista = mapa.get(dia) || [];
      lista.push(atividade);
      mapa.set(dia, lista);
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.due_at.localeCompare(b.due_at));
    }
    return mapa;
  }, [atividades]);

  const porLead = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  // A grade comeca no domingo da semana do dia 1 e vai ate fechar a ultima
  // semana: mes que comeca na quinta perderia os tres primeiros dias se a
  // grade comecasse no dia 1.
  const celulas = useMemo(() => {
    const primeiro = new Date(mesAberto.getFullYear(), mesAberto.getMonth(), 1);
    const inicio = new Date(primeiro);
    inicio.setDate(inicio.getDate() - inicio.getDay());
    const dias: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      const dia = new Date(inicio);
      dia.setDate(inicio.getDate() + i);
      dias.push(dia);
      if (
        i >= 27 &&
        dia.getDay() === 6 &&
        dia.getMonth() !== mesAberto.getMonth() &&
        dia > primeiro
      ) {
        break;
      }
    }
    return dias;
  }, [mesAberto]);

  const recarregar = async () => {
    await queryClient.invalidateQueries({ queryKey: ["comercial-atividades"] });
    await onMudou();
  };

  const doDia = porDia.get(diaEscolhido) || [];
  const hojeIso = diaIso(hoje);
  const agoraIso = new Date().toISOString();
  const abertasAtrasadas = atividades.filter(
    (a) => !a.done_at && a.due_at < agoraIso,
  ).length;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() =>
              setMesAberto(
                new Date(mesAberto.getFullYear(), mesAberto.getMonth() - 1, 1),
              )
            }
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-[13px] font-semibold capitalize text-foreground">
            {mesAberto.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </p>
          <button
            type="button"
            onClick={() =>
              setMesAberto(
                new Date(mesAberto.getFullYear(), mesAberto.getMonth() + 1, 1),
              )
            }
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1">
          {DIAS_DA_SEMANA.map((dia) => (
            <p
              key={dia}
              className="pb-1 text-center text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {dia}
            </p>
          ))}
          {celulas.map((data) => {
            const chave = diaIso(data);
            const doMes = data.getMonth() === mesAberto.getMonth();
            const lista = porDia.get(chave) || [];
            const abertas = lista.filter((a) => !a.done_at);
            const temAtraso = abertas.some((a) => a.due_at < agoraIso);
            const escolhido = chave === diaEscolhido;
            return (
              <button
                key={chave}
                type="button"
                onClick={() => setDiaEscolhido(chave)}
                className={`flex min-h-[54px] flex-col items-start rounded-lg border p-1 text-left transition-colors ${
                  escolhido
                    ? "border-primary bg-primary/[0.08]"
                    : doMes
                      ? "border-border bg-background hover:border-primary/40"
                      : "border-transparent bg-secondary/20"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-bold tabular-nums ${
                    chave === hojeIso
                      ? "bg-primary text-primary-foreground"
                      : doMes
                        ? "text-foreground"
                        : "text-muted-foreground/50"
                  }`}
                >
                  {data.getDate()}
                </span>
                {abertas.length > 0 && (
                  <span
                    className={`mt-0.5 w-full truncate rounded px-1 text-[9px] font-semibold ${
                      temAtraso
                        ? "bg-warning/20 text-warning"
                        : "bg-primary/15 text-primary"
                    }`}
                  >
                    {abertas.length}{" "}
                    {abertas.length === 1 ? "compromisso" : "compromissos"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {abertasAtrasadas > 0 && (
        <p className="rounded-xl border border-warning/25 bg-warning/[0.06] px-3 py-2 text-[11px] font-medium text-warning">
          {abertasAtrasadas}{" "}
          {abertasAtrasadas === 1
            ? "compromisso passou da hora"
            : "compromissos passaram da hora"}
        </p>
      )}

      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] font-semibold capitalize text-foreground">
            {new Date(`${diaEscolhido}T12:00:00`).toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </p>
          <button
            type="button"
            onClick={() => setNovoEm(diaEscolhido)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Marcar
          </button>
        </div>

        <div className="mt-2 space-y-1.5">
          {doDia.map((atividade) => {
            const lead = atividade.lead_id ? porLead.get(atividade.lead_id) : null;
            const feita = Boolean(atividade.done_at);
            const atrasada = !feita && atividade.due_at < agoraIso;
            return (
              <div
                key={atividade.id}
                className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${
                  feita
                    ? "border-border bg-background opacity-60"
                    : atrasada
                      ? "border-warning/40 bg-warning/[0.05]"
                      : "border-border bg-background"
                }`}
              >
                <button
                  type="button"
                  onClick={async () => {
                    if (await concluirAtividade(atividade, !feita)) await recarregar();
                    else toast.error("Não foi possível salvar.");
                  }}
                  title={feita ? "Reabrir" : "Concluir"}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                    feita
                      ? "border-border text-muted-foreground"
                      : "border-primary/40 bg-primary/10 text-primary"
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[12.5px] ${
                      feita
                        ? "text-muted-foreground line-through"
                        : "font-medium text-foreground"
                    }`}
                  >
                    {atividade.title}
                  </p>
                  <p className="flex items-center gap-1 truncate text-[10.5px] text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0" />
                    {horaDe(atividade.due_at)} · {rotuloDaAtividade(atividade.kind)}
                    {lead ? (
                      <>
                        {" · "}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => onAbrirLead(lead)}
                          onKeyDown={(e) => e.key === "Enter" && onAbrirLead(lead)}
                          className="cursor-pointer truncate font-semibold text-primary hover:underline"
                        >
                          {lead.name}
                        </span>
                      </>
                    ) : (
                      <>
                        {" · "}
                        <span className="inline-flex items-center gap-0.5">
                          <User className="h-3 w-3" />
                          seu
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (await apagarAtividade(atividade.id)) {
                      await recarregar();
                      toast.success("Compromisso removido.");
                    } else toast.error("Não foi possível remover.");
                  }}
                  title="Remover"
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {doDia.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[10.5px] text-muted-foreground">
              Nenhum compromisso neste dia.
            </p>
          )}
        </div>
      </div>

      {novoEm && (
        <NovoCompromisso
          dia={novoEm}
          leads={leads}
          onFechar={() => setNovoEm(null)}
          onSalvo={async () => {
            setNovoEm(null);
            await recarregar();
          }}
        />
      )}
    </div>
  );
}

function NovoCompromisso({
  dia,
  leads,
  onFechar,
  onSalvo,
}: {
  dia: string;
  leads: Lead[];
  onFechar: () => void;
  onSalvo: () => Promise<void>;
}) {
  const [tipo, setTipo] = useState("reuniao");
  const [titulo, setTitulo] = useState("");
  const [hora, setHora] = useState("09:00");
  const [leadId, setLeadId] = useState("proprio");
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (titulo.trim().length < 2) {
      toast.error("Diga o que vai acontecer.");
      return;
    }
    setSalvando(true);
    const ok = await salvarAtividade({
      leadId: leadId === "proprio" ? null : leadId,
      kind: tipo,
      title: titulo,
      dueAt: `${dia}T${hora}`,
    });
    setSalvando(false);
    if (!ok) {
      toast.error("Não foi possível marcar.");
      return;
    }
    toast.success("Marcado.");
    await onSalvo();
  };

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DE_ATIVIDADE.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              className="h-10 w-[110px]"
              aria-label="Hora"
            />
          </div>

          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="O que vai acontecer"
            className="h-10"
            autoFocus
          />

          {/* Com quem, ou com ninguem: a reuniao de planejamento e tao
              compromisso quanto a ligacao para o lead, e precisa caber aqui. */}
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">Com quem</p>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="proprio">Compromisso seu (sem lead)</SelectItem>
                {leads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name}
                    {lead.company ? ` (${lead.company})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando}
            className="h-11 w-full rounded-xl bg-primary text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            Marcar na agenda
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
