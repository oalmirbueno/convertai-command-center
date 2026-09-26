import type { ReactNode } from "react";
import { AlertTriangle, Database, Info } from "lucide-react";
import { ROTULO_DO_STATUS, type AvisoDoJev, type StatusDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";

/** Peças pequenas repetidas nas etapas da Mesa Roteiros. */

/** Campo de texto da mesa: o mesmo do sistema de design (36 px, rótulo em cima pelo CampoDeFormulario). */
export const CAMPO = campo;

export const OBJETIVOS = [
  { valor: "ensinar", rotulo: "Ensinar" },
  { valor: "engajar", rotulo: "Engajar" },
  { valor: "apresentar", rotulo: "Apresentar" },
  { valor: "captar", rotulo: "Captar contatos" },
  { valor: "vender", rotulo: "Vender" },
];

const TOM_DO_STATUS: Record<StatusDoRoteiro, string> = {
  rascunho: "bg-muted text-muted-foreground",
  aprovado: "bg-primary/10 text-primary",
  gravado: "bg-foreground/10 text-foreground",
};

export function SeloDoStatus({ status }: { status: StatusDoRoteiro }) {
  return (
    <span className={juntar(etiqueta, TOM_DO_STATUS[status] || TOM_DO_STATUS.rascunho)} data-status-do-roteiro={status}>
      {ROTULO_DO_STATUS[status] || status}
    </span>
  );
}

/**
 * Cabeçalho de etapa ou de seção: título curto com o "?" ao lado, uma linha de
 * estado e as ações na mesma linha. No celular as ações encolhem (ícone) e,
 * se faltar espaço, descem juntas à direita; o título nunca some.
 */
export function Cabecalho({ titulo, ajuda, estado, acoes, nivel = 2, icone }: { titulo: ReactNode; ajuda?: ReactNode; estado?: ReactNode; acoes?: ReactNode; nivel?: 2 | 3; icone?: ReactNode }) {
  // O cabeçalho do sistema (mesmo desenho). Promovido em 26/09 (frente C).
  return (
    <CabecalhoDeSecao
      data-cabecalho-da-etapa=""
      titulo={titulo}
      ajuda={ajuda}
      rotuloDaAjuda={typeof titulo === "string" ? `Sobre ${titulo}` : "O que é isto?"}
      descricao={estado}
      acao={acoes}
      nivel={nivel}
      icone={icone}
      classeDoTitulo={nivel === 3 ? "text-[13.5px]" : ""}
      truncar
    />
  );
}

/** Rótulo de botão que vira só ícone no celular (o botão leva o aria-label com o texto todo). Mora no sistema. */
export { RotuloLargo } from "@/components/sistema/BotaoComIcone";

export function AvisoDoBanco() {
  return (
    <div className="flex min-w-0 items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] leading-4" role="status" data-aviso-banco="">
      <Database className="mr-2 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
      <p className="mr-1 min-w-0 flex-1 [overflow-wrap:anywhere]">O banco ainda não guarda roteiros.</p>
      <AjudaRecolhida rotulo="Sobre o banco dos roteiros">
        Falta aplicar o SQL da Mesa Roteiros. Dá para gerar e baixar o PDF, mas o roteiro não fica salvo.
      </AjudaRecolhida>
    </div>
  );
}

/** O aviso do Jev: retenção, clareza e promessa contra oferta. Só aviso, nunca bloqueio. */
export function AvisoDoJevCartao({ aviso }: { aviso: AvisoDoJev | null | undefined }) {
  if (!aviso) return null;
  const nota = (n: number | null) => (n == null ? "sem nota" : `${n.toFixed(1).replace(".", ",")} de 5`);
  const prob = aviso.promessa_cumprida;
  return (
    <div className={juntar("rounded-md px-3 py-2.5", aviso.frases.length ? "bg-amber-500/10" : "bg-muted/50")} data-aviso-jev="">
      <div className="flex min-w-0 items-center text-[12px] font-medium">
        {aviso.frases.length ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" /> : <Info className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="min-w-0 truncate">Conferência editorial (aviso, não bloqueia)</span>
      </div>
      <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>
        Retenção {nota(aviso.retencao)} · Clareza {nota(aviso.clareza)} · Promessa cumprida {prob == null ? "sem leitura" : prob >= 0.5 ? "sim" : "duvidosa"}
      </p>
      {aviso.frases.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] [overflow-wrap:anywhere]">
          {aviso.frases.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
