import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { botao, campo, juntar, Secao, superficie, texto } from "@/components/sistema";
import type { MetricaSemanaFato } from "@/lib/esteira/esteiraTipos";
import { situacaoDasMetas, type MetaDeSeguidores } from "../../../supabase/functions/_shared/metas-de-seguidores";

/**
 * Metas de seguidores do cliente (frente CE, 28/09/2026).
 *
 * O dono: "quando bater a meta, a mensagem reconhece e a próxima meta segue o
 * que estiver cadastrado". Aqui a equipe cadastra os degraus (1.000, 1.500,
 * 2.000...) e vê onde o cliente está; a Central lê a mesma tabela
 * (social_metas_seguidores) e a mensagem comemora a meta batida uma vez só.
 * Arquivar em vez de apagar.
 */

const milhar = (n: number) => Math.round(n).toLocaleString("pt-BR");
const dm = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

function contaPrincipal(metricas: readonly MetricaSemanaFato[]): MetricaSemanaFato[] {
  const porConta = new Map<string, MetricaSemanaFato[]>();
  for (const m of metricas) porConta.set(m.accountId, [...(porConta.get(m.accountId) ?? []), m]);
  let melhor: MetricaSemanaFato[] = [];
  for (const lista of porConta.values()) {
    const maior = Math.max(...lista.map((x) => x.followers ?? 0));
    if (!melhor.length || maior > Math.max(...melhor.map((x) => x.followers ?? 0))) melhor = lista;
  }
  return melhor;
}

export default function MetasDeSeguidores({ clientId, metricas, canWrite }: { clientId: string; metricas: readonly MetricaSemanaFato[]; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [meta, setMeta] = useState("");
  const [prazo, setPrazo] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["metas-seguidores", clientId],
    queryFn: async () => {
      const { data: linhas, error } = await (supabase as any)
        .from("social_metas_seguidores")
        .select("id, meta, prazo, criado_em, arquivada_em, nota")
        .eq("client_id", clientId)
        .is("arquivada_em", null)
        .order("meta", { ascending: true });
      if (error) {
        const ausente = ["42P01", "PGRST205"].includes(String(error.code ?? ""));
        return { metas: [] as MetaDeSeguidores[], instalada: !ausente, erro: ausente ? null : String(error.message ?? "erro") };
      }
      return { metas: (linhas ?? []) as MetaDeSeguidores[], instalada: true, erro: null as string | null };
    },
    staleTime: 60_000,
  });

  const principal = contaPrincipal(metricas);
  const pontos = principal.filter((m) => m.followers != null).map((m) => ({ quando: m.weekEnd || m.weekStart, seguidores: Number(m.followers) }));
  const situacao = situacaoDasMetas(data?.metas ?? [], pontos);

  const recarregar = () => void queryClient.invalidateQueries({ queryKey: ["metas-seguidores", clientId] });

  const adicionar = async () => {
    const n = Math.round(Number(meta.replace(/\D/g, "")));
    if (!Number.isFinite(n) || n <= 0) { toast.error("Digite a meta em número de seguidores."); return; }
    setSalvando(true);
    try {
      const { error } = await (supabase as any).from("social_metas_seguidores").insert({ client_id: clientId, meta: n, prazo: prazo || null });
      if (error) { toast.error(error.code === "23505" ? "Essa meta já está cadastrada." : "Não foi possível salvar a meta."); return; }
      setMeta(""); setPrazo("");
      toast.success(`Meta de ${milhar(n)} seguidores cadastrada.`);
      recarregar();
    } finally { setSalvando(false); }
  };

  const arquivar = async (m: MetaDeSeguidores) => {
    const { error } = await (supabase as any).from("social_metas_seguidores").update({ arquivada_em: new Date().toISOString() }).eq("id", m.id);
    if (error) { toast.error("Não foi possível arquivar."); return; }
    toast.success("Meta arquivada.");
    recarregar();
  };

  if (data && !data.instalada) {
    return (
      <Secao nivel={3} divisoria titulo="Metas de seguidores" recolher={`ciclo:folha:metas:${clientId}`}>
        <p className={texto.auxiliar}>As metas ainda não foram ativadas no banco (SQL CE-01). Depois disso, cadastre aqui os degraus e a mensagem da Central comemora quando bater.</p>
      </Secao>
    );
  }

  const batidas = new Set(situacao.batidas.map((b) => b.id));
  return (
    <Secao
      nivel={3}
      divisoria
      recolher={`ciclo:folha:metas:${clientId}`}
      resumo={situacao.proxima ? `próxima: ${milhar(situacao.proxima.meta)}` : `${(data?.metas ?? []).length} ${(data?.metas ?? []).length === 1 ? "meta" : "metas"}`}
      titulo="Metas de seguidores"
      descricao={situacao.atual !== null ? `Hoje ${milhar(situacao.atual)} seguidores${situacao.medidoEm ? `, medido até ${dm(situacao.medidoEm)}` : ""}` : "Sem medição de seguidores ainda"}>
      {isLoading && <p className={texto.auxiliar}>Carregando as metas…</p>}
      {data?.erro && <p className="text-[12px] text-destructive">Não foi possível ler as metas: {data.erro}</p>}
      {situacao.proxima && (
        <div className={juntar(superficie.poco, "mb-2 px-3 py-2")}>
          <p className="flex items-center text-[13px] font-medium text-foreground"><Target className="mr-1.5 h-3.5 w-3.5 text-primary" aria-hidden="true" />Próxima: {milhar(situacao.proxima.meta)} seguidores</p>
          <p className={texto.auxiliar}>
            Faltam {milhar(situacao.proxima.faltam)} ({situacao.proxima.progresso}% do caminho)
            {situacao.proxima.ritmoSemanal !== null ? `, ritmo de ${situacao.proxima.ritmoSemanal > 0 ? "+" : ""}${situacao.proxima.ritmoSemanal} por semana` : ""}
            {situacao.proxima.previsao ? `, perto de ${dm(situacao.proxima.previsao)}` : ""}
            {situacao.proxima.prazo ? `. Prazo ${dm(situacao.proxima.prazo)}${situacao.proxima.noPrazo === false ? ": no ritmo atual não chega" : ""}` : ""}.
          </p>
        </div>
      )}
      {(data?.metas ?? []).length > 0 && (
        <ul className="divide-y divide-border">
          {(data?.metas ?? []).map((m) => (
            <li key={m.id} className="flex min-w-0 items-center py-1.5">
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                {milhar(Number(m.meta))} seguidores{m.prazo ? ` até ${dm(m.prazo)}` : ""}
              </span>
              <span className={juntar("mr-2 shrink-0 text-[12px]", batidas.has(m.id) ? "text-primary" : "text-muted-foreground")}>{batidas.has(m.id) ? "batida" : "aberta"}</span>
              {canWrite && (
                <button type="button" onClick={() => void arquivar(m)} className={botao.icone} aria-label={`Arquivar a meta de ${milhar(Number(m.meta))}`}>
                  <Archive className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="mt-2 grid min-w-0 grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <input value={meta} onChange={(e) => setMeta(e.target.value)} inputMode="numeric" placeholder="Nova meta (ex.: 1500)" aria-label="Nova meta de seguidores" className={campo} />
          <input value={prazo} onChange={(e) => setPrazo(e.target.value)} type="date" aria-label="Prazo da meta (opcional)" className={juntar(campo, "hidden sm:block")} />
          <button type="button" onClick={() => void adicionar()} disabled={salvando || !meta.trim()} className={botao.secundario}>Adicionar</button>
        </div>
      )}
    </Secao>
  );
}
