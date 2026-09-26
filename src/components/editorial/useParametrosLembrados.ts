import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { gravarEstadoDaTela, lerEstadoDaTela } from "@/components/sistema";

/**
 * useSearchParams que lembra (frente E4, 26/09; docs/design/SISTEMA.md,
 * "Estado que não se perde").
 *
 * A Agenda guarda visão e filtros no endereço (o link pode ser mandado para
 * alguém). Só que entrar pelo menu abre "/calendario" limpo, e a pessoa
 * perdia o mês/semana/lista e os filtros que tinha escolhido. Aqui:
 * - chegar SEM nenhuma das chaves no endereço traz de volta as guardadas
 *   (a tela já lê com elas no primeiro render, sem piscar o padrão, e o
 *   endereço é corrigido logo em seguida com replace);
 * - chegar COM alguma chave (link, Mesa, agendamento) respeita o link;
 * - toda mudança dessas chaves é guardada (por usuário e rota).
 * A data e o conteúdo aberto não entram: voltar outro dia abre no hoje.
 */
export function useParametrosLembrados(chave: string, chaves: readonly string[]) {
  const [url, setUrl] = useSearchParams();
  const [pendente, setPendente] = useState<Record<string, string> | null>(() => {
    if (chaves.some((k) => url.has(k))) return null;
    const guardado = lerEstadoDaTela<Record<string, string> | null>(
      chave,
      null,
      (v) => !!v && typeof v === "object" && !Array.isArray(v),
    );
    return guardado && Object.keys(guardado).length > 0 ? guardado : null;
  });

  const params = useMemo(() => {
    if (!pendente) return url;
    const junto = new URLSearchParams(url);
    chaves.forEach((k) => {
      const v = pendente[k];
      if (typeof v === "string" && v && !junto.has(k)) junto.set(k, v);
    });
    return junto;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pendente]);

  // Põe no endereço o que foi trazido de volta (uma vez).
  useEffect(() => {
    if (!pendente) return;
    setUrl(params, { replace: true });
    setPendente(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guarda a cada mudança (depois de trazer de volta).
  useEffect(() => {
    if (pendente) return;
    const valor: Record<string, string> = {};
    chaves.forEach((k) => {
      const v = url.get(k);
      if (v) valor[k] = v;
    });
    gravarEstadoDaTela(chave, Object.keys(valor).length > 0 ? valor : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pendente, chave]);

  return [params, setUrl] as const;
}
