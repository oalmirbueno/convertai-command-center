import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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
        .select("client_id, profile_picture_url, username, captured_at")
        .order("captured_at", { ascending: false });
      if (error) throw new Error(error.message);
      // Uma identidade por cliente: a mais recente vence. Um cliente pode
      // ter mais de uma conta, e mostrar duas logos no mesmo cartão
      // confundiria em vez de ajudar.
      const porCliente = new Map<string, IdentidadeMinima>();
      for (const linha of ((data || []) as any[])) {
        if (!porCliente.has(linha.client_id)) {
          porCliente.set(linha.client_id, {
            client_id: linha.client_id,
            profile_picture_url: linha.profile_picture_url,
            username: linha.username,
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
