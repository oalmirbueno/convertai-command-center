import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import OrganogramaAgentes, { type NoDoOrganograma } from "@/components/execucao/OrganogramaAgentes";
import { juntar, superficie, texto } from "@/components/sistema";
import { SEM_AREA, type ItemDeOrdem } from "@/lib/hierarquiaDosAgentes";
import { funcoesRepetidas } from "@/lib/escritorio/funcaoRepetida";
import { fazendoAgora, presencaPorSlug, ultimaAtividade } from "@/lib/escritorio/presenca";
import type { AgenteDoEscritorio, Presenca } from "@/lib/escritorio/tipos";
import { CHAVES } from "./escritorioApi";

/**
 * Organograma do Escritório: a mesma hierarquia da Execução, com todas as
 * plataformas, o grau de cada agente no cartão e, em cima, o aviso de função
 * repetida (dois ativos na mesma área fazendo a mesma coisa).
 */
export default function AbaOrganograma({
  agentes,
  presencas,
  agora,
  admin,
  nomeDoDono,
  aoAbrirAgente,
  aoEditar,
}: {
  agentes: AgenteDoEscritorio[];
  presencas: Presenca[];
  agora: number;
  admin: boolean;
  nomeDoDono: string;
  /** Abre a ficha do agente no centro. */
  aoAbrirAgente: (slug: string) => void;
  aoEditar: (agente: AgenteDoEscritorio) => void;
}) {
  const qc = useQueryClient();
  const repetidas = useMemo(() => funcoesRepetidas(agentes), [agentes]);
  const presenca = useMemo(() => presencaPorSlug(presencas), [presencas]);

  const nos: NoDoOrganograma[] = useMemo(
    () => agentes.map((o) => {
      const p = presenca.get(o.slug);
      const fazendo = fazendoAgora(p, agora);
      return {
        id: o.id,
        nome: o.display_name,
        papel: o.scope,
        nivel: o.is_coordinator ? ("coordenador" as const) : ("operador" as const),
        ativo: o.status === "active",
        area: o.area,
        chefe: o.parent_slug ? agentes.find((x) => x.slug === o.parent_slug)?.display_name ?? o.parent_slug : null,
        agora: fazendo,
        agoraDesde: fazendo ? p?.batimento_em ?? null : null,
        ultimaVez: ultimaAtividade(o.last_run_at, p?.batimento_em),
        funcao: o.role,
        origem: o.origem ?? "hermes",
        grau: o.grau ?? "executor",
        aposentado: ["retired", "inactive"].includes(o.status),
        excluido: o.status === "inactive",
        porta: o.slug === "default",
      };
    }),
    [agentes, presenca, agora],
  );

  const reler = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: CHAVES.agentes }), qc.invalidateQueries({ queryKey: ["operadores-internos"] })]);
  };
  /** Grava a ordem (e a área de quem mudou de área), como na Execução. Só o admin passa no banco. */
  const mover = async (itens: ItemDeOrdem[]) => {
    if (itens.length === 0) return;
    const { error } = await (supabase as any).rpc("operadores_reordenar", { _itens: itens });
    if (error) { toast.error(String(error.message || "").includes("SO_ADMIN") ? "Só o administrador organiza os agentes." : "Não foi possível mover o agente."); return; }
    await reler();
  };
  const abrir = (no: NoDoOrganograma) => {
    const agente = agentes.find((o) => o.id === no.id);
    if (agente) aoAbrirAgente(agente.slug);
    else toast.info(no.nivel === "gateway" ? "O Hermes é a porta de entrada: a conversa acontece no grupo dele." : "Você está no topo: aprova, decide e recebe os relatórios.");
  };

  return (
    <div className="min-w-0 space-y-6">
      {repetidas.length > 0 && (
        <section aria-label="Função repetida" className={juntar(superficie.poco, "px-3.5 py-3")} data-funcao-repetida="">
          <p className={juntar(texto.corpo, "flex items-center font-medium")}>
            <AlertTriangle className="mr-1.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />Função repetida
          </p>
          <ul className="mt-1.5 space-y-1">
            {repetidas.map((r) => (
              <li key={r.chave} className={texto.corpo}>
                <span className="font-medium">{r.area || SEM_AREA}</span> · {r.funcao}: <span className="text-muted-foreground">{r.agentes.map((a) => a.nome).join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <OrganogramaAgentes
        nos={nos}
        nomeDoDono={nomeDoDono}
        podeOrganizar={admin}
        aoAbrir={abrir}
        aoEditar={(no) => { const agente = agentes.find((o) => o.id === no.id); if (agente) aoEditar(agente); }}
        aoMover={(itens) => void mover(itens)}
      />
    </div>
  );
}
