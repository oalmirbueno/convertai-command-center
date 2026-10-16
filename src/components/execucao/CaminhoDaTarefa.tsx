import { ArrowRight, CheckCircle2, Clock3, Hand, Lock } from "lucide-react";
import { limparTecnico } from "@/lib/cadernoExecucao";
import { juntar } from "@/components/sistema";

/**
 * O caminho de uma tarefa num desenho (16/10/2026, dono: "o bloqueado não tem informação, está
 * muito vazio... de forma intuitiva, se possível desenhado, com um diagrama"): o que já foi feito,
 * onde parou, o que destrava e o que vem depois. Quatro passos, em linha no computador e em pé no
 * celular. O texto de cada passo já vem limpo (sem ids nem códigos).
 */

export type MotivoParaGente = { texto: string; retomavel: boolean };

/** Texto colado sem espaço ("concluirMetaleituraapósconfirmação"): descola onde dá. */
export function descolar(t: string): string {
  const palavras = t.trim().split(/\s+/).filter(Boolean);
  const media = palavras.length ? t.replace(/\s+/g, "").length / palavras.length : 0;
  if (media <= 14) return t;
  return t.replace(/([a-zà-ú])([A-ZÀ-Ú])/g, "$1 $2").replace(/([a-zà-ú]{3,})(\d)/g, "$1 $2").replace(/(\d)([a-zà-ú]{3,})/gi, "$1 $2");
}

/** O motivo técnico do travamento, dito para gente, e se basta mandar o agente retomar. */
export function motivoParaGente(bruto?: string | null): MotivoParaGente | null {
  const t = String(bruto || "").trim();
  if (!t) return null;
  if (/heartbeat|expir|lease|timeout|sem sinal|stale|sem atualiza/i.test(t)) return { texto: "O agente parou de dar sinal no meio do trabalho. Nada se perdeu: é só mandar retomar.", retomavel: true };
  if (/encerrad|arquivad|exclu[ií]d/i.test(t)) return { texto: "A tarefa foi encerrada ou excluída, e esta execução ficou sobrando.", retomavel: false };
  if (/acesso|senha|login|credencial|permiss|token/i.test(t)) return { texto: `Falta um acesso para continuar. ${limparTecnico(descolar(t))}`.trim(), retomavel: false };
  return { texto: limparTecnico(descolar(t)), retomavel: false };
}

type Passo = { rotulo: string; texto: string | null; tom: "feito" | "parou" | "voce" | "depois" };

const ESTILO: Record<Passo["tom"], { Icone: typeof CheckCircle2; circulo: string; texto: string }> = {
  feito: { Icone: CheckCircle2, circulo: "bg-success/15 text-success", texto: "text-success" },
  parou: { Icone: Lock, circulo: "bg-destructive/15 text-destructive", texto: "text-destructive" },
  voce: { Icone: Hand, circulo: "bg-warning/15 text-warning", texto: "text-warning" },
  depois: { Icone: ArrowRight, circulo: "bg-muted text-muted-foreground", texto: "text-muted-foreground" },
};

export default function CaminhoDaTarefa({ feito, parou, destrava, depois = "O agente continua sozinho e registra no diário.", esperaRevisao = false }: {
  feito?: string | null;
  parou?: string | null;
  destrava?: string | null;
  depois?: string | null;
  /** Em revisão: o passo do meio é "Sua revisão" (relógio), não "Travou aqui" (cadeado). */
  esperaRevisao?: boolean;
}) {
  const passos: Passo[] = [
    { rotulo: "Já foi feito", texto: feito ? limparTecnico(descolar(feito)) : "Ainda sem comprovação registrada.", tom: "feito" },
    { rotulo: esperaRevisao ? "Espera a sua revisão" : "Parou aqui", texto: parou || (esperaRevisao ? "A entrega está pronta para você olhar." : null), tom: esperaRevisao ? "voce" : "parou" },
    { rotulo: esperaRevisao ? "Você decide" : "O que destrava", texto: destrava ? limparTecnico(descolar(destrava)) : esperaRevisao ? "Aprovar e concluir, pedir ajuste ou reprovar." : "Responder ao agente (texto, link ou arquivo).", tom: "voce" },
    { rotulo: "Depois", texto: depois, tom: "depois" },
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-4 sm:gap-0" aria-label="Caminho da tarefa">
      {passos.map((p, i) => {
        const e = ESTILO[p.tom];
        const Icone = esperaRevisao && i === 1 ? Clock3 : e.Icone;
        return (
          <li key={p.rotulo} className="relative flex gap-3 sm:flex-col sm:items-center sm:px-2 sm:text-center">
            {i < passos.length - 1 && <span className="absolute left-4 top-9 h-[calc(100%-1.5rem)] w-px bg-border sm:left-[calc(50%+1.25rem)] sm:top-4 sm:h-px sm:w-[calc(100%-2.5rem)]" aria-hidden="true" />}
            <span className={juntar("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", e.circulo)}><Icone className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0 sm:mt-2">
              <span className={juntar("block text-[11.5px] font-semibold uppercase tracking-wide", e.texto)}>{p.rotulo}</span>
              {p.texto && <span className="mt-0.5 line-clamp-3 block text-[12.5px] leading-5 text-foreground/85">{p.texto}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
