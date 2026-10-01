import { useEffect, useState } from "react";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { juntar, texto } from "@/components/sistema/estilos";
import { type EstadoDoMotor as Estado, estadoDoMotor, type ExecutorDaPrevia } from "../../../supabase/functions/mesa-site/modulos/site-previa";
import type { TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";

const PONTO: Record<Estado["tom"], string> = {
  ok: "bg-primary",
  andando: "bg-primary animate-pulse motion-reduce:animate-none",
  atencao: "bg-amber-500",
  erro: "bg-destructive",
};

/** O estado do motor muda com o relógio (batida de 90 s): relê a cada 30 s sem chamada nova. */
export function useEstadoDoMotor(executor: ExecutorDaPrevia, trabalhos: TrabalhoDoMotor[]): Estado {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return estadoDoMotor(executor, trabalhos, agora);
}

/**
 * Uma linha com o estado do motor de código (SPV, 30/09): sem worker, caiu no
 * meio, rodando (o quê, quanto já gastou), na fila, livre. O "?" diz o que
 * cada estado quer dizer e o que é operação (ligar o worker) e não código.
 */
export default function EstadoDoMotor({ estado, compacto = false }: { estado: Estado; compacto?: boolean }) {
  const detalhe = !compacto && estado.detalhe ? ` · ${estado.detalhe}` : "";
  return (
    <span className="inline-flex min-w-0 max-w-full items-center" data-estado-do-motor={estado.codigo} role="status" aria-live="polite">
      <span aria-hidden="true" className={juntar("mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full", PONTO[estado.tom])} />
      <span className={juntar(texto.auxiliar, "min-w-0 truncate", estado.tom === "erro" && "text-destructive")} title={`${estado.rotulo}${estado.detalhe ? ` · ${estado.detalhe}` : ""}`}>
        {estado.rotulo}
        {detalhe}
      </span>
      {!compacto && (
        <AjudaRecolhida rotulo="O que é o estado do motor?" titulo="Motor de código" className="ml-1 shrink-0">
          <span className="block">O motor constrói o site seção a seção. Ele roda no worker da máquina da agência, não no painel.</span>
          <span className="mt-1.5 block">Desligado: os pedidos esperam na fila. Para ligar, na máquina da agência: pasta workers/motor-codigo, npm run iniciar (as chaves ficam no .env de lá). A prévia rápida e as edições de conteúdo funcionam mesmo assim.</span>
          <span className="mt-1.5 block">Rodando: mostra a seção da vez, quantas já saíram e o gasto contra o teto. Parou no meio: o worker caiu; ligue de novo ou pare o trabalho.</span>
          {estado.avisos.map((a) => (
            <span key={a} className="mt-1.5 block text-amber-700 dark:text-amber-400">
              {a}
            </span>
          ))}
        </AjudaRecolhida>
      )}
    </span>
  );
}
