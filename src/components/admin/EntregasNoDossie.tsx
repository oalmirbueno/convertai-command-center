import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, PackageCheck, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { comoAbrir } from "@/components/execucao/OQueFoiFeito";

/**
 * O que já foi entregue para este cliente — dentro do dossiê.
 *
 * O dossiê lia duas tabelas e respondia uma pergunta só: "quem é este
 * cliente". Faltava a outra metade, que é a que se usa numa reunião:
 * "e o que a gente já fez para ele?".
 *
 * NÃO entra em CONTEXTO_KINDS de propósito. Aquele conjunto escolhe o
 * texto que É o dossiê; uma entrega de terça-feira competindo para ser a
 * descrição do cliente trocaria a identidade dele pelo último recado.
 * São perguntas diferentes e merecem lugares diferentes.
 *
 * O link de acesso vem junto porque foi essa a condição do dono para a
 * autonomia dos agentes: saber que algo foi feito não ajuda se ninguém
 * consegue abrir.
 */

const quando = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "";

/** O "Onde acessar:" que a entrega grava dentro do conteúdo. */
export function extrairAcesso(conteudo?: string | null): string | null {
  const m = String(conteudo ?? "").match(/^Onde acessar:\s*(.+)$/mi);
  return m ? m[1].trim() : null;
}

/** A primeira linha é o que foi feito; o resto é o como e o acesso. */
export function primeiraLinha(conteudo?: string | null): string {
  return String(conteudo ?? "").split("\n")[0]?.trim() ?? "";
}

export default function EntregasNoDossie({ clientId }: { clientId: string }) {
  const { data = [], error, isLoading } = useQuery({
    queryKey: ["entregas-no-dossie", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("project_memory")
        .select("id, title, content, metadata, created_at")
        .eq("client_id", clientId)
        .eq("kind", "entrega")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw new Error(error.message);
      return (data || []) as any[];
    },
    enabled: Boolean(clientId),
  });

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-secondary p-3 text-[12px] text-destructive">
        Não consegui ler as entregas: {error instanceof Error ? error.message : String(error)}.
        Isso não significa que nada foi entregue — a leitura é que falhou.
      </div>
    );
  }
  if (isLoading || data.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <PackageCheck className="h-3.5 w-3.5 text-success" /> O que já foi entregue
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px]">{data.length}</span>
      </p>

      <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
        {data.map((e) => {
          // O metadata é a fonte boa; o texto é o resgate para as entregas
          // antigas, gravadas antes dos campos existirem.
          const acessoBruto = (e.metadata?.onde_acessar as string | undefined)
            ?? extrairAcesso(e.content);
          const acesso = acessoBruto ? comoAbrir(acessoBruto) : null;
          const autonoma = e.metadata?.autonoma === true;
          const temMarca = typeof e.metadata?.autonoma === "boolean";

          return (
            <div key={e.id} className="rounded-lg border border-border bg-secondary/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {temMarca && (
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                    autonoma ? "bg-info/15 text-info" : "bg-success/15 text-success",
                  )}>
                    {autonoma ? <Sparkles className="h-2.5 w-2.5" /> : <ShieldCheck className="h-2.5 w-2.5" />}
                    {autonoma ? "por conta" : "autorizado"}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">{quando(e.created_at)}</span>
              </div>

              <p className="mt-0.5 text-[12.5px] text-foreground">
                {e.title || primeiraLinha(e.content)}
              </p>

              {acesso && (
                <p className="mt-1 break-all text-[11px]">
                  {acesso.tipo === "texto" ? (
                    <span className="text-muted-foreground">{acesso.valor}</span>
                  ) : (
                    <a
                      href={acesso.valor}
                      {...(acesso.tipo === "url"
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="inline-flex items-center gap-1 text-primary underline"
                    >
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />{acesso.valor}
                    </a>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
        Vem da mesma memória que o Ciclo e a Central leem — por isso aparece aqui
        sem ninguém copiar nada.
      </p>
    </div>
  );
}
