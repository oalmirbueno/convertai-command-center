import type { ReactNode } from "react";
import { AlertTriangle, Database, Info } from "lucide-react";
import { ROTULO_DO_STATUS, type AvisoDoJev, type StatusDoRoteiro } from "../../../supabase/functions/_shared/roteiro-modelo";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CabecalhoDeSecao, type RecolherDoCabecalho } from "@/components/sistema/Secao";
import { useRecolhido } from "@/components/sistema/TituloRecolhivel";
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
export function Cabecalho({
  titulo,
  ajuda,
  estado,
  acoes,
  nivel = 2,
  icone,
  recolher,
}: {
  titulo: ReactNode;
  ajuda?: ReactNode;
  estado?: ReactNode;
  acoes?: ReactNode;
  nivel?: 2 | 3;
  icone?: ReactNode;
  /** O título vira o botão de recolher o bloco (recolhido, as ações somem). */
  recolher?: RecolherDoCabecalho;
}) {
  // O cabeçalho do sistema (mesmo desenho). Promovido em 26/09 (frente C).
  return (
    <CabecalhoDeSecao
      data-cabecalho-da-etapa=""
      titulo={titulo}
      ajuda={ajuda}
      rotuloDaAjuda={typeof titulo === "string" ? `Sobre ${titulo}` : "O que é isto?"}
      descricao={estado}
      acao={recolher && recolher.recolhido ? undefined : acoes}
      nivel={nivel}
      icone={icone}
      recolher={recolher}
      truncar
    />
  );
}

/**
 * Bloco recolhível das etapas (o mesmo desenho em todas): linha fina em cima,
 * o Cabecalho com o título que recolhe (lembrado por `chave`, com o cliente) e
 * o conteúdo, que sai da tela quando recolhido. Recolhido, fica o `resumo`.
 */
export function BlocoRecolhivel({
  chave,
  titulo,
  ajuda,
  estado,
  acoes,
  resumo,
  icone,
  nivel = 3,
  divisoria = true,
  recolhidoDeInicio = false,
  className = "",
  children,
  ...resto
}: {
  chave: string;
  titulo: ReactNode;
  ajuda?: ReactNode;
  estado?: ReactNode;
  acoes?: ReactNode;
  resumo?: ReactNode;
  icone?: ReactNode;
  nivel?: 2 | 3;
  divisoria?: boolean;
  recolhidoDeInicio?: boolean;
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const [recolhido, setRecolhido] = useRecolhido(chave, recolhidoDeInicio);
  return (
    <section className={juntar("min-w-0 space-y-3", divisoria && "border-t border-border pt-5", className)} data-recolhido={recolhido ? "sim" : "nao"} {...resto}>
      <Cabecalho nivel={nivel} icone={icone} titulo={titulo} ajuda={ajuda} estado={estado} acoes={acoes} recolher={{ recolhido, onAlternar: () => setRecolhido(!recolhido), resumo }} />
      {!recolhido && children}
    </section>
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
