import { AvatarComPresenca } from "@/components/execucao/Visuais";
import { etiqueta, juntar, texto } from "@/components/sistema";
import { classeDaOrigem, nomeDaOrigem } from "@/lib/hierarquiaDosAgentes";
import { fazendoAgora, presenteAgora } from "@/lib/escritorio/presenca";
import { nomeDoGrau, type AgenteDoEscritorio, type Presenca } from "@/lib/escritorio/tipos";

/** Onde o agente roda (Hermes, Grok, n8n, OpenBot...), na mesma cor do organograma. */
export function EtiquetaDaPlataforma({ origem, className = "" }: { origem: string | null | undefined; className?: string }) {
  return <span className={juntar(etiqueta, classeDaOrigem(origem || "hermes"), className)} data-origem={origem || "hermes"}>{nomeDaOrigem(origem)}</span>;
}

export function EtiquetaDoGrau({ grau, className = "" }: { grau: string | null | undefined; className?: string }) {
  return <span className={juntar(etiqueta, "bg-muted text-foreground", className)} data-grau={grau || "executor"}>{nomeDoGrau(grau)}</span>;
}

/**
 * Um agente numa lista do Escritório: rosto, nome, "agora" quando o batimento
 * tem menos de 10 minutos e, embaixo do nome, o que ele diz que está fazendo.
 */
export default function LinhaDoAgente({
  agente,
  presenca,
  agora,
  comEtiquetas = false,
  className = "",
}: {
  agente: Pick<AgenteDoEscritorio, "slug" | "display_name" | "status" | "origem" | "grau">;
  presenca?: Presenca | null;
  agora: number;
  /** Plataforma e grau ao lado do nome (onde a lista não tem coluna própria para eles). */
  comEtiquetas?: boolean;
  className?: string;
}) {
  const presente = presenteAgora(presenca?.batimento_em, agora);
  const fazendo = fazendoAgora(presenca, agora);
  return (
    <span className={juntar("flex min-w-0 items-center", className)} data-agente-do-escritorio={agente.slug}>
      <AvatarComPresenca nome={agente.display_name} ativo={agente.status === "active"} tamanho={36} className="mr-3" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center">
          <span className={juntar(texto.corpo, "mr-2 truncate font-medium")}>{agente.display_name}</span>
          {presente && <span className={juntar(etiqueta, "mr-1.5 bg-success-soft text-success")} data-presenca="agora">agora</span>}
          {comEtiquetas && <EtiquetaDaPlataforma origem={agente.origem} className="mr-1.5" />}
          {comEtiquetas && <EtiquetaDoGrau grau={agente.grau} />}
        </span>
        {fazendo && <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")} data-fazendo="" title={fazendo}>{fazendo}</span>}
      </span>
    </span>
  );
}
