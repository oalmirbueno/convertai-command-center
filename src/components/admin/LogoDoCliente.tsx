import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { escolherIdentidadePrincipal } from "@/lib/identidadePrincipal";
import FotoDoCliente from "@/components/clients/FotoDoCliente";
import { contarPostsDasContas, contasEmpatadas } from "@/lib/postsDasContas";

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
 *
 * 26/10/2026: o desenho mora no FotoDoCliente (um sistema só). Com
 * `clienteId`, se a foto do Instagram não abrir (o link da Meta vence em
 * ~4 dias), entra a logo dos arquivos antes das iniciais.
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

      // Quantos posts cada conta tem: entre dois perfis do mesmo dono, o
      // principal é onde se posta. Só conta onde o nome e a foto empatam
      // (o volume nunca vence o nome), com contagem `head` (nenhuma linha
      // vem): ler social_post_metrics inteira trazia 2.668 linhas cortadas
      // em 1000 só para somar.
      const contas = new Set<string>();
      for (const [clientId, candidatas] of porClienteBruto) {
        for (const id of contasEmpatadas(candidatas, nomeDe.get(clientId))) contas.add(id);
      }
      const porConta = await contarPostsDasContas([...contas]);

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

/**
 * A identidade de CADA conta (e nao a principal do cliente): a tela de
 * metricas mostra um hub por conta de Instagram, e cada hub precisa do
 * proprio @ e da propria foto - senao @sitebolt aparece com a logo da
 * AcelerIQ, que e exatamente o erro que a escolha da principal evita.
 */
export function useIdentidadesPorConta() {
  return useQuery({
    queryKey: ["identidades-por-conta"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_client_identity")
        .select("client_id, external_account_id, profile_picture_url, username, captured_at")
        .order("captured_at", { ascending: false });
      if (error) throw new Error(error.message);
      const porConta = new Map<string, IdentidadeMinima>();
      for (const l of (data || []) as any[]) {
        if (!porConta.has(l.external_account_id)) {
          porConta.set(l.external_account_id, {
            client_id: l.client_id,
            profile_picture_url: l.profile_picture_url,
            username: l.username,
          });
        }
      }
      return porConta;
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
  clienteId,
}: {
  url?: string | null;
  nome?: string | null;
  tamanho?: number;
  className?: string;
  /** Com o id, a logo dos arquivos entra quando a foto do Instagram não abre. */
  clienteId?: string | null;
}) {
  return (
    <FotoDoCliente
      nome={String(nome ?? "")}
      fotos={url ? [{ url, tipo: "instagram" }] : null}
      clienteId={clienteId}
      lado={tamanho}
      forma="quadrada"
      alt={nome ? `Logo de ${nome}` : "Logo do cliente"}
      tituloSemFoto={`Sem foto de perfil capturada para ${nome || "este cliente"}`}
      className={className}
    />
  );
}
