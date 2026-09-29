import { NavLink } from "react-router-dom";
import { Timer } from "lucide-react";
import { useClients } from "@/hooks/useSupabaseData";
import { useCronometro } from "@/components/cronometro/CronometroProvider";
import { ROTULOS_DAS_AREAS, type Instantaneo } from "@/lib/cronometro/motor";
import { formatarDuracao, formatarRelogio, formatarRelogioCurto } from "@/lib/horas/formato";
import { cn } from "@/lib/utils";

/**
 * Cronômetro pequeno do topo (frente CR): o cliente em que a pessoa está e o
 * tempo dela nele no mês. Contando, o ponto é verde; parado, cinza (o motivo
 * fica no nome do botão). Clicar abre a central de horas (admin e gestor).
 * Sem cliente em foco: só o ícone da central (admin e gestor) ou nada.
 */

const MOTIVOS: Record<string, string> = {
  contando: "contando",
  ociosa: "pausado, 5 min sem mexer",
  escondida: "pausado, aba em segundo plano",
  "outra-aba": "contando em outra aba",
  "sem-cliente": "sem cliente",
  "fora-de-area": "sem cliente",
  desligado: "desligado",
};

const PILULA =
  "toque-compacto inline-flex h-8 min-w-0 max-w-[260px] shrink items-center rounded-lg px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Pilula({ estado, podeAbrirCentral }: { estado: Instantaneo; podeAbrirCentral: boolean }) {
  const { data: clientes } = useClients();
  const achado = ((clientes as Array<{ id: string; company_name?: string | null; full_name?: string | null }> | undefined) || []).find(
    (c) => c.id === estado.cliente,
  );
  const nome = (achado && (achado.company_name || achado.full_name)) || "Cliente";
  const area = (estado.area && ROTULOS_DAS_AREAS[estado.area]) || "";
  const situacao = MOTIVOS[estado.motivo] || "";
  const rotulo = `${nome}: ${formatarDuracao(estado.segundosDoMes)} no mês, ${situacao}${area ? ` (${area})` : ""}`;
  const conteudo = (
    <>
      <span
        aria-hidden="true"
        data-contando={estado.contando ? "sim" : "nao"}
        className={cn("mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full", estado.contando ? "bg-primary" : "bg-muted-foreground/60")}
      />
      <span className="mr-1.5 hidden min-w-0 max-w-[140px] truncate lg:inline">{nome}</span>
      <span className="hidden tabular-nums sm:inline">{formatarRelogio(estado.segundosDoMes)}</span>
      <span className="tabular-nums sm:hidden">{formatarRelogioCurto(estado.segundosDoMes)}</span>
    </>
  );
  if (podeAbrirCentral) {
    return (
      <NavLink to="/horas" aria-label={`${rotulo}. Abrir horas e custos`} title={rotulo} data-cronometro-do-topo="" className={PILULA}>
        {conteudo}
      </NavLink>
    );
  }
  return (
    <span role="status" aria-label={rotulo} title={rotulo} data-cronometro-do-topo="" className={PILULA}>
      {conteudo}
    </span>
  );
}

export default function CronometroDoTopo({ podeAbrirCentral }: { podeAbrirCentral: boolean }) {
  const estado = useCronometro();
  if (!estado.ativo) return null;
  if (!estado.cliente || !estado.area) {
    if (!podeAbrirCentral) return null;
    return (
      <NavLink
        to="/horas"
        aria-label="Horas e custos"
        title="Horas e custos"
        data-cronometro-do-topo="sem-cliente"
        className="hidden w-8 h-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
      >
        <Timer className="w-4 h-4" />
      </NavLink>
    );
  }
  return <Pilula estado={estado} podeAbrirCentral={podeAbrirCentral} />;
}
