import { Camera, Clapperboard, Images, Smartphone, Square, Video, type LucideIcon } from "lucide-react";
import { juntar, texto } from "@/components/sistema/estilos";
import { OPCOES_DO_MES, ROTULO_DA_OPCAO, type OpcaoDoMes } from "../../../supabase/functions/agente-calendario/modulos/escolha-do-mes";

/**
 * Escolha de formatos na preparação do Mês (24/10/2026; dono: "só entram Story e vídeos com roteiro ou IA para
 * selecionar quando eu for preparar"). Chips só em ícone (o nome no title), um clique liga e desliga; a linha
 * de baixo diz o que está escolhido. Com `unico`, escolhe um só (clicar de novo solta: o painel varia).
 */
export const ICONE_DA_OPCAO: Record<OpcaoDoMes, LucideIcon> = {
  carrossel: Images,
  estatico: Square,
  foto: Camera,
  video_gravar: Video,
  video_ia: Clapperboard,
  stories: Smartphone,
};

export default function EscolhaDeFormatos({
  valor,
  onMudar,
  rotulo = "Formatos",
  unico = false,
  vazio,
  desabilitado = false,
  className,
}: {
  valor: OpcaoDoMes[];
  onMudar: (v: OpcaoDoMes[]) => void;
  rotulo?: string;
  /** Um formato só (a troca): clicar no escolhido solta. */
  unico?: boolean;
  /** O que a linha diz sem nada escolhido. */
  vazio?: string;
  desabilitado?: boolean;
  className?: string;
}) {
  const alternar = (o: OpcaoDoMes) => {
    if (unico) return onMudar(valor[0] === o ? [] : [o]);
    onMudar(valor.indexOf(o) >= 0 ? valor.filter((x) => x !== o) : OPCOES_DO_MES.map((x) => x.id).filter((x) => x === o || valor.indexOf(x) >= 0));
  };
  const nomes = OPCOES_DO_MES.filter((o) => valor.indexOf(o.id) >= 0).map((o) => ROTULO_DA_OPCAO[o.id]);
  return (
    <fieldset className={juntar("min-w-0", className)} disabled={desabilitado} data-escolha-de-formatos={valor.join(",") || "nicho"}>
      <legend className={texto.rotulo}>{rotulo}</legend>
      <div className="mt-1 flex min-w-0 flex-wrap items-center">
        {OPCOES_DO_MES.map((o) => {
          const Icone = ICONE_DA_OPCAO[o.id];
          const ligado = valor.indexOf(o.id) >= 0;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => alternar(o.id)}
              aria-pressed={ligado}
              aria-label={o.rotulo}
              title={`${o.titulo}${ligado ? " (escolhido)" : ""}`}
              data-opcao={o.id}
              className={juntar(
                "toque-compacto mb-1 mr-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                ligado ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              <Icone className="h-4 w-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <p className={juntar(texto.auxiliar, "truncate")} aria-live="polite" data-formatos-escolhidos="">
        {nomes.length ? nomes.join(", ") : vazio || "Pelo nicho do cliente"}
      </p>
    </fieldset>
  );
}
