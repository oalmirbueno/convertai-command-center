import { useEffect, useState } from "react";

/**
 * A data de agora, que continua certa com o tempo passando.
 *
 * O Ciclo vive instalado como aplicativo e fica aberto por dias: se a data
 * for lida uma única vez na montagem, o app continua mostrando a semana (e o
 * "hoje") de quando foi aberto. Aqui a hora é reavaliada de minuto em minuto
 * e sempre que o app volta para a frente, então virar o dia ou a semana
 * atualiza a tela sozinho.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, [intervalMs]);

  return now;
}
