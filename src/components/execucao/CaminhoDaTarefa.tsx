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

/** Primeiro tira ids e códigos, depois descola: descolar antes quebrava o id e ele escapava. */
export function textoParaGente(t: string): string {
  return limparTecnico(descolar(limparTecnico(t)));
}

/**
 * Sobrou log de máquina (muitos pedaços com barra, sublinhado, número longo ou palavras coladas
 * gigantes)? Aí o passo mostra uma frase simples e o original fica no "?" do passo e no diário.
 */
export function pareceTecnico(t: string): boolean {
  const pedacos = t.split(/\s+/).filter(Boolean);
  if (pedacos.length < 4) return false;
  const tecnicos = pedacos.filter((p) => /[_/=]|\d{3,}|[a-f0-9]{6,}-|^[A-Z0-9]{5,}$/.test(p) || p.replace(/[^A-Za-zÀ-ú]/g, "").length > 18).length;
  return tecnicos / pedacos.length > 0.25;
}

/** O motivo técnico do travamento, dito para gente, e se basta mandar o agente retomar. */
export function motivoParaGente(bruto?: string | null): MotivoParaGente | null {
  const t = String(bruto || "").trim();
  if (!t) return null;
  if (/heartbeat|expir|lease|timeout|sem sinal|stale|sem atualiza/i.test(t)) return { texto: "O agente parou de dar sinal no meio do trabalho. Nada se perdeu: é só mandar retomar.", retomavel: true };
  if (/encerrad|arquivad|exclu[ií]d/i.test(t)) return { texto: "A tarefa foi encerrada ou excluída, e esta execução ficou sobrando.", retomavel: false };
  if (/acesso|senha|login|credencial|permiss|token/i.test(t)) return { texto: "Falta um acesso (login ou permissão) para continuar.", retomavel: false };
  const limpo = textoParaGente(t);
  return { texto: pareceTecnico(limpo) ? "O agente parou e anotou o motivo em linguagem técnica. Abra o diário para ver e responder." : limpo, retomavel: false };
}

type Passo = { rotulo: string; texto: string | null; tom: "feito" | "parou" | "voce" | "depois" };

const simples = (t: string, seTecnico: string) => { const l = textoParaGente(t); return pareceTecnico(l) ? seTecnico : l; };

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
    { rotulo: "Já foi feito", texto: feito ? simples(feito, "O agente registrou o trabalho feito (detalhe técnico no diário).") : "Ainda sem comprovação registrada.", tom: "feito" },
    { rotulo: esperaRevisao ? "Espera a sua revisão" : "Parou aqui", texto: parou || (esperaRevisao ? "A entrega está pronta para você olhar." : null), tom: esperaRevisao ? "voce" : "parou" },
    { rotulo: esperaRevisao ? "Você decide" : "O que destrava", texto: destrava ? simples(destrava, "O agente anotou o próximo passo; abra o diário para ver o que ele pede.") : esperaRevisao ? "Aprovar e concluir, pedir ajuste ou reprovar." : "Um toque: Pode seguir, Concluir ou Encerrar. Ou responda ao agente.", tom: "voce" },
    { rotulo: "Depois", texto: depois, tom: "depois" },
  ];
  // 16/10 (dono: "o texto está um por cima do outro, espremido"): em pé, um passo por linha, com
  // espaço para ler; o ícone e a linha que liga os passos ficam à esquerda.
  return (
    <ol className="space-y-0" aria-label="Caminho da tarefa">
      {passos.map((p, i) => {
        const e = ESTILO[p.tom];
        const Icone = esperaRevisao && i === 1 ? Clock3 : e.Icone;
        return (
          <li key={p.rotulo} className="relative flex gap-3 pb-3 last:pb-0">
            {i < passos.length - 1 && <span className="absolute left-4 top-8 h-[calc(100%-2rem)] w-px bg-border" aria-hidden="true" />}
            <span className={juntar("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", e.circulo)}><Icone className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1 pt-0.5">
              <span className={juntar("block text-[12px] font-semibold", e.texto)}>{p.rotulo}</span>
              {p.texto && <span className="mt-0.5 line-clamp-3 text-[13px] leading-6 text-foreground/90" title={p.texto}>{p.texto}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
