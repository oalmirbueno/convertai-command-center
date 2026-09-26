import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EstadoVazio, botao, campo, foco, juntar, texto } from "@/components/sistema";
import {
  TIPOS_DE_ATIVIDADE,
  type Atividade,
  apagarAtividade,
  concluirAtividade,
  listarAtividades,
  rotuloDaAtividade,
  salvarAtividade,
} from "@/lib/comercial";
import { ehTexto, useEstadoDoComercial } from "./useEstadoDoComercial";

/**
 * A agenda de um lead.
 *
 * Substitui o `next_action` de texto livre, que era um campo só: marcar a
 * ligação como feita apagava a reunião marcada, e não sobrava registro do
 * que foi tentado. Aqui cada compromisso tem tipo, data e dono, e concluir
 * empurra a linha para a história do lead, que é o que responde "o que já
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
  // O que foi escrito e não agendado volta ao reabrir o lead.
  const [titulo, setTitulo, esquecerTitulo] = useEstadoDoComercial(`rascunho:atividade:${leadId}`, "", { validar: ehTexto });
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
    esquecerTitulo();
    setPrazo(proximaHoraLocal());
    await recarregar();
    toast.success("Agendado.");
  };

  const agora = new Date().toISOString();
  const abertas = doLead.filter((a) => !a.done_at).length;

  return (
    <section className="border-t border-border pt-4" aria-label="Atividades do lead">
      <div className="mb-2 flex min-w-0 items-baseline">
        <h3 className={juntar(texto.tituloSecao, "text-[14px]")}>Atividades</h3>
        {doLead.length > 0 && <span className={juntar(texto.auxiliar, "ml-2")}>{abertas} em aberto</span>}
      </div>

      {/* Celular: tipo e quando lado a lado, e o que fazer com o botão na
          mesma linha (botão nunca sozinho numa linha). */}
      <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-[120px_190px_minmax(0,1fr)]">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo} aria-label="Tipo da atividade">
          {TIPOS_DE_ATIVIDADE.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={prazo}
          onChange={(e) => setPrazo(e.target.value)}
          className={campo}
          aria-label="Quando"
        />
        <div className="col-span-2 flex min-w-0 items-center md:col-span-1">
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void criar();
              }
            }}
            placeholder="O que precisa ser feito"
            aria-label="O que precisa ser feito"
            className={juntar(campo, "mr-2")}
          />
          <button type="button" onClick={() => void criar()} disabled={salvando} className={botao.secundario} aria-label="Agendar atividade">
            <Plus className="h-3.5 w-3.5 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Agendar</span>
          </button>
        </div>
      </div>

      <div className="mt-2">
        {doLead.length === 0 ? (
          <EstadoVazio compacto titulo="Nada agendado." descricao="Lead sem próximo compromisso some do funil." />
        ) : (
          <ul className="divide-y divide-border">
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
          </ul>
        )}
      </div>
    </section>
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
    <li className={juntar("flex min-w-0 items-center py-2", feita && "opacity-60")}>
      <button
        type="button"
        onClick={onAlternar}
        title={feita ? "Reabrir" : "Concluir"}
        aria-label={feita ? `Reabrir ${atividade.title}` : `Concluir ${atividade.title}`}
        className={juntar(
          "mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
          foco,
          feita ? "border-border text-muted-foreground" : "border-primary/50 text-primary hover:bg-primary/10",
        )}
      >
        {feita ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <div className="mr-2 min-w-0 flex-1">
        <p className={juntar(texto.corpo, "truncate", feita ? "text-muted-foreground line-through" : "font-medium")}>
          {atividade.title}
        </p>
        <p className={juntar(texto.auxiliar, "flex items-center truncate", atrasada && "font-medium text-warning")}>
          <Clock className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
          {rotuloDaAtividade(atividade.kind)} · {quando(atividade.due_at)}
          {atrasada && " · atrasada"}
        </p>
      </div>
      <button
        type="button"
        onClick={onApagar}
        title="Remover"
        aria-label={`Remover ${atividade.title}`}
        className={juntar(botao.icone, "hover:text-destructive")}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}
