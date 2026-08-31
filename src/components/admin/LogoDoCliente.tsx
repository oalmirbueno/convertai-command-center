import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { escolherIdentidadePrincipal } from "@/lib/identidadePrincipal";

/**
 * A logo do cliente, na lista — e não só depois de clicar.
 *
 * Uma grade de cartões só com nome obriga a ler para reconhecer. A marca
 * é o atalho: o olho acha antes da palavra. O painel já guardava a foto
 * de perfil de cada conta (vem junto com a identidade do Instagram) e
 * nunca a mostrava aqui.
 *
 * As iniciais NÃO são fallback decorativo: quando não há foto, elas dizem
 * honestamente que o painel não tem a imagem, em vez de exibir um ícone
 * genérico que pareceria a marca de alguém.
 */

export interface IdentidadeMinima {
  client_id: string;
  profile_picture_url: string | null;
  username: string | null;
}

/** Uma consulta só para a grade inteira, em vez de uma por cartão. */
export function useIdentidadesDosClientes() {
  return useQuery({
    queryKey: ["identidades-dos-clientes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_client_identity")
        .select("client_id, external_account_id, profile_picture_url, username, captured_at");
      if (error) throw new Error(error.message);
      const linhas = (data || []) as any[];
      if (linhas.length === 0) return new Map<string, IdentidadeMinima>();

      // Quantos posts cada conta tem: entre dois perfis do mesmo dono, o
      // principal é onde se posta.
      const { data: posts } = await (supabase as any)
        .from("social_post_metrics").select("external_account_id");
      const porConta = new Map<string, number>();
      for (const m of ((posts || []) as any[])) {
        porConta.set(m.external_account_id, (porConta.get(m.external_account_id) ?? 0) + 1);
      }

      // O nome do cliente é o que decide qual handle representa a marca.
      const ids = [...new Set(linhas.map((l) => l.client_id))];
      const { data: perfis } = await (supabase as any)
        .from("profiles").select("id, full_name, company_name").in("id", ids);
      const nomeDe = new Map(((perfis || []) as any[]).map(
        (p) => [p.id, (p.company_name || "").trim() || p.full_name]));

      /*
       * Uma identidade por cliente, escolhida por SINAL e não por sorteio.
       *
       * A AcelerIQ tem @aceleriq e @sitebolt capturados no mesmo segundo:
       * a regra antiga pegava "a mais recente" sem desempate, e a logo do
       * sitebolt apareceu como se fosse a da AcelerIQ. Marca errada é pior
       * que marca nenhuma — quem olha confia e não tem como desconfiar.
       */
      const porClienteBruto = new Map<string, any[]>();
      for (const l of linhas) {
        const atual = porClienteBruto.get(l.client_id);
        if (atual) atual.push(l);
        else porClienteBruto.set(l.client_id, [l]);
      }

      const porCliente = new Map<string, IdentidadeMinima>();
      for (const [clientId, candidatas] of porClienteBruto) {
        const escolhida = escolherIdentidadePrincipal(
          candidatas.map((c) => ({ ...c, posts: porConta.get(c.external_account_id) ?? 0 })),
          nomeDe.get(clientId),
        );
        if (escolhida) {
          porCliente.set(clientId, {
            client_id: clientId,
            profile_picture_url: escolhida.profile_picture_url,
            username: escolhida.username,
          });
        }
      }
      return porCliente;
    },
    staleTime: 600_000,
  });
}

export function iniciaisDe(nome?: string | null): string {
  const limpo = String(nome ?? "").trim();
  if (!limpo) return "?";
  return limpo
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export default function LogoDoCliente({
  url,
  nome,
  tamanho = 40,
  className,
}: {
  url?: string | null;
  nome?: string | null;
  tamanho?: number;
  className?: string;
}) {
  const estilo = { width: tamanho, height: tamanho };

  if (!url) {
    return (
      <span
        style={estilo}
        title={`Sem foto de perfil capturada para ${nome || "este cliente"}`}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl bg-secondary font-semibold text-muted-foreground",
          className,
        )}
      >
        <span style={{ fontSize: Math.max(10, tamanho * 0.32) }}>{iniciaisDe(nome)}</span>
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={nome ? `Logo de ${nome}` : "Logo do cliente"}
      style={estilo}
      loading="lazy"
      // A CDN da Meta recusa requisição com referer de outro domínio.
      referrerPolicy="no-referrer"
      className={cn("shrink-0 rounded-xl border border-border object-cover", className)}
    />
  );
}
