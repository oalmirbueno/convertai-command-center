import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { estadoDosAvisos } from "@/lib/avisosDoNavegador";
import {
  etapasDoTeste,
  testeTerminou,
  type DisparoDoTeste,
  type EtapaDoTeste,
  type ResultadoDoTeste,
} from "@/lib/avisos/testeDeAvisos";

/**
 * "Testar avisos" (só admin): manda um aviso para a própria pessoa e mostra
 * o caminho dele no sino, no e-mail e no navegador. Nunca fala com cliente.
 * Confere de 3 em 3 segundos por até 1 minuto.
 */
const INTERVALO_MS = 3000;
const LIMITE_MS = 60000;

const ICONE: Record<EtapaDoTeste["estado"], ReactNode> = {
  ok: <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />,
  esperando: <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />,
  falhou: <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />,
  desligado: <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />,
};

export default function TesteDeAvisos({ idsNoSino }: { idsNoSino: readonly string[] }) {
  const [disparo, setDisparo] = useState<DisparoDoTeste | null>(null);
  const [resultado, setResultado] = useState<ResultadoDoTeste | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const inicio = useRef(0);

  const chegouNoSino = !!disparo?.notification_id && idsNoSino.includes(disparo.notification_id);
  const etapas = disparo ? etapasDoTeste(disparo, resultado, { chegouNoSino, navegador: estadoDosAvisos() }) : [];
  const terminou = etapas.length > 0 && testeTerminou(etapas);

  useEffect(() => {
    if (!disparo?.notification_id || !rodando) return;
    if (terminou || Date.now() - inicio.current > LIMITE_MS) {
      setRodando(false);
      return;
    }
    const vez = setTimeout(async () => {
      const { data, error } = await (supabase as any).rpc("notificacoes_teste_resultado", {
        _notification_id: disparo.notification_id,
      });
      if (error) {
        setErro("Não consegui ler o resultado do teste.");
        setRodando(false);
        return;
      }
      setResultado(data as ResultadoDoTeste);
    }, INTERVALO_MS);
    return () => clearTimeout(vez);
  }, [disparo, resultado, rodando, terminou]);

  const disparar = async () => {
    setErro(null);
    setResultado(null);
    setDisparo(null);
    setRodando(true);
    inicio.current = Date.now();
    const { data, error } = await (supabase as any).rpc("notificacoes_teste_disparar");
    if (error) {
      setRodando(false);
      setErro(
        /apenas_admin/.test(error.message || "")
          ? "Só administrador pode testar os avisos."
          : "O teste ainda não está disponível no banco (falta aplicar o N-01).",
      );
      return;
    }
    setDisparo(data as DisparoDoTeste);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={disparar}
        disabled={rodando}
        className="text-[11px] text-primary hover:underline disabled:opacity-60 bg-transparent border-none p-0"
      >
        {rodando ? "Testando avisos..." : "Testar avisos"}
      </button>
      {erro && <p className="text-[11px] text-destructive">{erro}</p>}
      {etapas.length > 0 && (
        <ul className="space-y-1" aria-live="polite">
          {etapas.map((etapa) => (
            <li key={etapa.canal} className="flex items-start gap-2 text-[11px] leading-snug">
              <span className="mt-0.5 shrink-0">{ICONE[etapa.estado]}</span>
              <span className="min-w-0">
                <span className="font-medium text-foreground">{etapa.canal}:</span>{" "}
                <span className="text-muted-foreground">{etapa.texto}</span>
              </span>
            </li>
          ))}
          {!rodando && !terminou && (
            <li className="text-[10.5px] text-muted-foreground">Passou de 1 minuto sem resposta. Tente de novo.</li>
          )}
        </ul>
      )}
    </div>
  );
}
