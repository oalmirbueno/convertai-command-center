import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, CheckCircle2, ExternalLink, Loader2, Play, Send, Unlock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { botao, campoTexto, foco, juntar } from "@/components/sistema";

/*
 * Destravar aqui (19/10/2026, dono, com o print do cartão "Verzelo: conjunto contínuo travado por
 * acesso à Meta": "ter uma área que destrava tudo por ali; eu respondo e já resolvo ali mesmo, sem
 * precisar ir para outro lugar, qualquer ação").
 *
 * Responder, Pode seguir, Concluir ou Encerrar no próprio cartão da execução. Tudo passa por
 * operator_destravar_execucao: execução sem tarefa ganha o vínculo na hora, a resposta entra na
 * fila e no diário do agente, e a execução sai de "Bloqueada". Quando o motivo é acesso na Meta,
 * o atalho abre o Gerenciador de Negócios (liberar a conta ou a Página é clique do dono).
 */

export type AcaoDeDestrave = "responder" | "pode_seguir" | "concluir" | "encerrar";

const SUGESTOES = [
  "Já liberei o acesso, pode tentar de novo",
  "Siga com o seu melhor julgamento",
  "Faça só a parte que não depende de mim",
  "Não fazer isso agora",
];

const FEITO: Record<AcaoDeDestrave, string> = {
  responder: "Resposta enviada: o agente recebe na fila dele e segue.",
  pode_seguir: "Liberado: o agente segue com o melhor julgamento.",
  concluir: "Concluída por você.",
  encerrar: "Encerrada: o agente não continua.",
};

/** Sem resposta nesse tempo, solta o botão e avisa (nunca gira para sempre). */
const LIMITE_MS = 20_000;

/** O motivo fala de acesso na Meta (conta, Página, Composio, login do Facebook)? */
export function falaDaMeta(motivo: string | null | undefined): boolean {
  return /\bmeta\b|facebook|instagram|composio|gerenciador de neg|business|p[aá]gina|conta de an[uú]ncios|verifica[cç][aã]o em duas etapas/i.test(motivo || "");
}

export default function DestravarAqui({ runId, motivo, revisao = false, aoResolver }: {
  runId: string;
  /** O que o agente disse (para reconhecer acesso na Meta). */
  motivo?: string | null;
  /** Entrega para conferir: Concluir vira "Aprovar e concluir". */
  revisao?: boolean;
  aoResolver?: () => void;
}) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [rodando, setRodando] = useState<AcaoDeDestrave | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const meta = falaDaMeta(motivo);

  const agir = async (acao: AcaoDeDestrave) => {
    if (rodando) return;
    setRodando(acao);
    let relogio: number | undefined;
    const resposta = await Promise.race([
      (supabase as any).rpc("operator_destravar_execucao", { _run_id: runId, _acao: acao, _texto: texto.trim() || null })
        .then((r: { error: { message?: string } | null }) => r, (e: unknown) => ({ error: { message: e instanceof Error ? e.message : String(e) } })),
      new Promise<{ error: { message: string } }>((fim) => { relogio = window.setTimeout(() => fim({ error: { message: "O servidor demorou para responder. Tente de novo em instantes." } }), LIMITE_MS); }),
    ]);
    window.clearTimeout(relogio);
    if (resposta.error) {
      toast.error(resposta.error.message || "Não foi possível destravar.");
      setRodando(null);
      return;
    }
    setFeito(FEITO[acao]);
    toast.success(FEITO[acao]);
    void queryClient.invalidateQueries({ queryKey: ["operador-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["operador-vinculos"] });
    aoResolver?.();
  };

  if (feito) {
    return <p role="status" className="flex items-center rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[13px] text-success"><CheckCircle2 className="mr-1.5 h-4 w-4 shrink-0" aria-hidden="true" />{feito}</p>;
  }

  const giro = (acao: AcaoDeDestrave) => rodando === acao ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null;
  return (
    <section aria-label="Destravar aqui" className="rounded-xl border border-primary/40 bg-primary/5 p-3">
      <h4 className="flex items-center text-[13px] font-semibold text-foreground"><Unlock className="mr-1.5 h-4 w-4 text-primary" aria-hidden="true" />Destravar aqui</h4>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Responda ou decida aqui mesmo: o agente recebe na hora.</p>

      {meta && (
        <div className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-[12px] leading-5 text-foreground/90">
          <p>É acesso na Meta: libere a conta de anúncios ou a Página para a Aceleriq.</p>
          <p>Use Atribuir parceiro e Atribuir ativos ao Aceleriq Trafego.</p>
          <p>Depois toque em "Já liberei o acesso".</p>
          <a href="https://business.facebook.com/settings" target="_blank" rel="noopener noreferrer" className={juntar("mt-1.5 inline-flex items-center rounded font-medium text-primary underline-offset-2 hover:underline", foco)}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Abrir o Gerenciador de Negócios da Meta
          </a>
        </div>
      )}

      <textarea
        aria-label="Resposta ao agente"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Escreva a resposta ou toque numa sugestão"
        className={juntar(campoTexto, "mt-2 min-h-[56px]")}
      />
      <div className="-m-0.5 mt-1.5 flex flex-wrap">
        {SUGESTOES.map((s) => (
          <button key={s} type="button" onClick={() => setTexto((t) => (t.trim() ? `${t.trim()}. ${s}` : s))} className={juntar("m-0.5 rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:border-primary/50 hover:text-foreground", foco)}>{s}</button>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={!texto.trim() || !!rodando} onClick={() => void agir("responder")} className={juntar(botao.primario, "h-10 px-4")}>
          {giro("responder") || <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}Enviar resposta
        </button>
        <button type="button" disabled={!!rodando} onClick={() => void agir("pode_seguir")} title="O agente segue com o melhor julgamento; o revisor confere" className={juntar(botao.secundario, "h-10 px-3")}>
          {giro("pode_seguir") || <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />}Pode seguir
        </button>
        <button type="button" disabled={!!rodando} onClick={() => void agir("concluir")} title="Fecha: está resolvido" className={juntar(botao.secundario, "h-10 px-3 text-success")}>
          {giro("concluir") || <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}{revisao ? "Aprovar e concluir" : "Concluir"}
        </button>
        <button type="button" disabled={!!rodando} onClick={() => void agir("encerrar")} title="Encerra sem continuar" className={juntar(botao.discreto, "h-10 px-3")}>
          {giro("encerrar") || <Ban className="mr-1.5 h-4 w-4" aria-hidden="true" />}Encerrar
        </button>
      </div>
    </section>
  );
}
