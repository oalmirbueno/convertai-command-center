import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
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
  apagarAtividade,
  concluirAtividade,
  listarAtividades,
  rotuloDaAtividade,
  salvarAtividade,
} from "@/lib/comercial";

/**
 * A agenda de um lead.
 *
 * Substitui o `next_action` de texto livre, que era um campo só: marcar a
 * ligação como feita apagava a reunião marcada, e não sobrava registro do
 * que foi tentado. Aqui cada compromisso tem tipo, data e dono, e concluir
 * empurra a linha para a história do lead — que é o que responde "o que já
 * tentaram aqui?" quando outra pessoa pega a conversa.
 */

interface Props {
  leadId: string;
  donoPadrao?: string | null;
  onMudou?: () => void;
}

const paraCampoLocal = (iso: string) => {
  const data = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}T${pad(
    data.getHours(),
  )}:${pad(data.getMinutes())}`;
};

const proximaHoraLocal = () => {
  const data = new Date();
  data.setHours(data.getHours() + 1, 0, 0, 0);
  return paraCampoLocal(data.toISOString());
};

const quando = (iso: string) => {
  const data = new Date(iso);
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function AtividadesDoLead({ leadId, donoPadrao, onMudou }: Props) {
  const queryClient = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState("ligacao");
  const [prazo, setPrazo] = useState(proximaHoraLocal);
  const [salvando, setSalvando] = useState(false);

  const { data: todas = [] } = useQuery({
    queryKey: ["comercial-atividades"],
    queryFn: listarAtividades,
  });

  const doLead = useMemo(
    () =>
      todas
        .filter((a) => a.lead_id === leadId)
        .sort((a, b) => {
          // Aberta antes de concluída; dentro de cada grupo, a mais próxima
          // primeiro. Concluída no topo empurraria o compromisso de hoje
          // para baixo justamente quando ele importa.
          const abertaA = a.done_at ? 1 : 0;
          const abertaB = b.done_at ? 1 : 0;
          if (abertaA !== abertaB) return abertaA - abertaB;
          return a.due_at.localeCompare(b.due_at);
        }),
    [todas, leadId],
  );

  const recarregar = async () => {
    await queryClient.invalidateQueries({ queryKey: ["comercial-atividades"] });
    onMudou?.();
  };

  const criar = async () => {
    if (titulo.trim().length < 2) {
      toast.error("Diga o que precisa ser feito.");
      return;
    }
    setSalvando(true);
    const ok = await salvarAtividade({
      leadId,
      kind: tipo,
      title: titulo,
      dueAt: prazo,
      ownerId: donoPadrao || null,
    });
    setSalvando(false);
    if (!ok) {
      toast.error("Não foi possível agendar.");
      return;
    }
    setTitulo("");
    setPrazo(proximaHoraLocal());
    await recarregar();
    toast.success("Agendado.");
  };

  const agora = new Date().toISOString();

  return (
    <div className="border-t border-border pt-3">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Atividades
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_auto_auto]">
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="h-10 sm:w-[120px]">
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
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="O que precisa ser feito"
          className="h-10"
        />
        <Input
          type="datetime-local"
          value={prazo}
          onChange={(e) => setPrazo(e.target.value)}
          className="h-10 sm:w-[190px]"
          aria-label="Quando"
        />
        <button
          type="button"
          onClick={() => void criar()}
          disabled={salvando}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Agendar
        </button>
      </div>

      <div className="mt-2 space-y-1.5">
        {doLead.map((atividade) => (
          <Linha
            key={atividade.id}
            atividade={atividade}
            agora={agora}
            onAlternar={async () => {
              if (await concluirAtividade(atividade, !atividade.done_at)) {
                await recarregar();
              } else toast.error("Não foi possível salvar.");
            }}
            onApagar={async () => {
              if (await apagarAtividade(atividade.id)) {
                await recarregar();
                toast.success("Atividade removida.");
              } else toast.error("Não foi possível remover.");
            }}
          />
        ))}
        {doLead.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[10.5px] leading-relaxed text-muted-foreground">
            Nada agendado. Lead sem próximo compromisso é lead que some — o funil
            morre de esquecimento, não de proposta recusada.
          </p>
        )}
      </div>
    </div>
  );
}

function Linha({
  atividade,
  agora,
  onAlternar,
  onApagar,
}: {
  atividade: Atividade;
  agora: string;
  onAlternar: () => void;
  onApagar: () => void;
}) {
  const feita = Boolean(atividade.done_at);
  const atrasada = !feita && atividade.due_at < agora;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
        feita
          ? "border-border bg-background opacity-60"
          : atrasada
            ? "border-warning/40 bg-warning/[0.05]"
            : "border-border bg-background"
      }`}
    >
      <button
        type="button"
        onClick={onAlternar}
        title={feita ? "Reabrir" : "Concluir"}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
          feita
            ? "border-border text-muted-foreground"
            : "border-primary/40 bg-primary/10 text-primary"
        }`}
      >
        {feita ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[12px] ${
            feita ? "text-muted-foreground line-through" : "font-medium text-foreground"
          }`}
        >
          {atividade.title}
        </p>
        <p
          className={`flex items-center gap-1 text-[10px] ${
            atrasada ? "font-semibold text-warning" : "text-muted-foreground"
          }`}
        >
          <Clock className="h-3 w-3" />
          {rotuloDaAtividade(atividade.kind)} · {quando(atividade.due_at)}
          {atrasada && " · atrasada"}
        </p>
      </div>
      <button
        type="button"
        onClick={onApagar}
        title="Remover"
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
