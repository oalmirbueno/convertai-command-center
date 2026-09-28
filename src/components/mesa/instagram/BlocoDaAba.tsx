import { useEffect, useRef, type ReactNode } from "react";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { juntar, superficie } from "@/components/sistema/estilos";

/**
 * Um bloco da aba Instagram: título que recolhe (lembrado por cliente),
 * resumo curto quando recolhido e ação à direita. `pedidoDeAbrir` muda
 * quando alguém manda ir até o bloco (o caminho do agente, ?bloco=): abre
 * e rola até ele.
 */
export default function BlocoDaAba({
  id,
  clientId,
  titulo,
  resumo,
  acao,
  pedidoDeAbrir,
  inicialRecolhido = false,
  children,
}: {
  id: string;
  clientId: string;
  titulo: ReactNode;
  resumo?: ReactNode;
  acao?: ReactNode;
  pedidoDeAbrir?: number | null;
  inicialRecolhido?: boolean;
  children: ReactNode;
}) {
  const [recolhido, setRecolhido] = useRecolhido(`mesa:instagram:bloco:${id}:${clientId}`, inicialRecolhido);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!pedidoDeAbrir) return;
    setRecolhido(false);
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (el && typeof el.scrollIntoView === "function") {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch {
          el.scrollIntoView();
        }
      }
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoDeAbrir]);

  return (
    <section ref={ref} id={`ig-${id}`} data-bloco-do-instagram={id} className={juntar(superficie.painel, "min-w-0 scroll-mt-4 px-3 py-2.5 sm:px-4")}>
      <div className="flex min-w-0 items-center justify-between">
        <TituloRecolhivel titulo={titulo} recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={resumo} className="mr-2" />
        {!recolhido && acao ? <div className="flex shrink-0 items-center">{acao}</div> : null}
      </div>
      {!recolhido && <div className="mt-2.5 min-w-0">{children}</div>}
    </section>
  );
}
