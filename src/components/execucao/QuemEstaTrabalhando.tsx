import { MessageCircle, SquareArrowOutUpRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { botao, juntar, superficie } from "@/components/sistema";

/**
 * Quem está trabalhando, como gente (16/10/2026, dono: "clico em 'trabalhando agora' e abre os
 * agentes e o que estão fazendo, de forma natural e humanizada: 'estou fazendo arte no carrossel
 * para o cliente; quer conversar comigo?'"). Vale para todos: Paperclip, agentes internos e Hermes.
 * Cada cartão fala em primeira pessoa (fraseDoAgente) e tem Conversar comigo e Ver o trabalho.
 */

export type PessoaTrabalhando = {
  operatorId: string;
  agente: string;
  frase: string;
  cliente?: string | null;
  linkId?: string | null;
  titulo?: string | null;
  agora: boolean;
  status: string;
  outras: number;
};

const TOM: Record<string, string> = {
  in_progress: "bg-success", queued: "bg-info", review: "bg-warning", awaiting_input: "bg-warning", blocked: "bg-destructive",
};

export default function QuemEstaTrabalhando({ aberto, aoFechar, pessoas, aoConversar, aoVerTrabalho }: {
  aberto: boolean;
  aoFechar: () => void;
  pessoas: PessoaTrabalhando[];
  aoConversar: (operatorId: string) => void;
  aoVerTrabalho: (linkId: string, titulo?: string) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-[15px] font-semibold">Quem está trabalhando</DialogTitle>
          <DialogDescription className="mt-0.5 text-[12px] text-muted-foreground">Cada agente conta o que está fazendo. Converse com ele para ver o andamento ou trabalhar junto.</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {pessoas.length === 0 ? <p className="p-6 text-center text-[13px] text-muted-foreground">Nenhum agente com trabalho aberto agora.</p> : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {pessoas.map((p) => (
                <li key={p.operatorId} className={juntar(superficie.painel, "flex min-w-0 flex-col p-4")}>
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[15px] font-semibold text-primary" aria-hidden="true">
                      {p.agente.trim()[0]?.toUpperCase()}
                      <span className={juntar("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card", TOM[p.status] || "bg-muted-foreground", p.agora && "animate-pulse")} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold">{p.agente}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{p.agora ? "trabalhando agora" : "com trabalho aberto"}{p.outras > 0 ? ` · +${p.outras} ${p.outras === 1 ? "outra tarefa" : "outras tarefas"}` : ""}</span>
                    </span>
                  </div>
                  {/* A fala do agente, como um balão de conversa. */}
                  <p className="mt-3 rounded-xl rounded-tl-sm bg-muted/50 px-3.5 py-2.5 text-[14px] leading-6 text-foreground">{p.frase}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={juntar(botao.primario, "h-9 px-3 text-[13px]")} onClick={() => aoConversar(p.operatorId)}><MessageCircle className="mr-1.5 h-4 w-4" />Conversar comigo</button>
                    {p.linkId && <button type="button" className={juntar(botao.secundario, "h-9 px-3 text-[13px]")} onClick={() => aoVerTrabalho(p.linkId!, p.titulo || undefined)}><SquareArrowOutUpRight className="mr-1.5 h-4 w-4" />Ver o trabalho</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
