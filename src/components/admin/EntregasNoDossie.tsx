import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, PackageCheck, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { comoAbrir } from "@/components/execucao/OQueFoiFeito";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { etiqueta, juntar, texto } from "@/components/sistema/estilos";

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

  // Bloco aberto dentro da seção do dossiê (28/09): sem cartão, sem cartão por
  // item e sem rolagem própria (a região da Central já rola; a leitura para
  // nas 12 mais recentes).
  if (error) {
    return (
      <p role="status" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
        Não consegui ler as entregas: {error instanceof Error ? error.message : String(error)}.
        Isso não significa que nada foi entregue.
      </p>
    );
  }
  if (isLoading || data.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex min-w-0 items-center">
        <PackageCheck className="mr-1.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
        <p className={juntar(texto.rotulo, "min-w-0 truncate")}>O que já foi entregue</p>
        <span className={juntar(etiqueta, "ml-1.5 bg-muted text-muted-foreground")}>{data.length}</span>
        <AjudaRecolhida className="ml-1" rotulo="De onde vêm as entregas">
          Vem da mesma memória que o Ciclo e a Central leem; por isso aparece aqui sem ninguém copiar nada.
        </AjudaRecolhida>
      </div>

      <ul className="mt-1.5 divide-y divide-border">
        {data.map((e) => {
          // O metadata é a fonte boa; o texto é o resgate para as entregas
          // antigas, gravadas antes dos campos existirem.
          const acessoBruto = (e.metadata?.onde_acessar as string | undefined)
            ?? extrairAcesso(e.content);
          const acesso = acessoBruto ? comoAbrir(acessoBruto) : null;
          const autonoma = e.metadata?.autonoma === true;
          const temMarca = typeof e.metadata?.autonoma === "boolean";

          return (
            <li key={e.id} className="min-w-0 py-2">
              <div className="flex min-w-0 items-baseline">
                <p className="mr-2 min-w-0 flex-1 text-[13px] text-foreground">
                  {e.title || primeiraLinha(e.content)}
                </p>
                {temMarca && (
                  <span className={cn(
                    etiqueta,
                    "mr-2",
                    autonoma ? "bg-info/15 text-info" : "bg-success/15 text-success",
                  )}>
                    {autonoma ? <Sparkles className="mr-1 h-2.5 w-2.5" aria-hidden="true" /> : <ShieldCheck className="mr-1 h-2.5 w-2.5" aria-hidden="true" />}
                    {autonoma ? "por conta" : "autorizado"}
                  </span>
                )}
                <span className={juntar(texto.auxiliar, "shrink-0 tabular-nums")}>{quando(e.created_at)}</span>
              </div>

              {acesso && (
                <p className="mt-0.5 break-all text-[12px]">
                  {acesso.tipo === "texto" ? (
                    <span className="text-muted-foreground">{acesso.valor}</span>
                  ) : (
                    <a
                      href={acesso.valor}
                      {...(acesso.tipo === "url"
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="inline-flex items-center text-primary underline"
                    >
                      <ExternalLink className="mr-1 h-2.5 w-2.5 shrink-0" aria-hidden="true" />{acesso.valor}
                    </a>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
