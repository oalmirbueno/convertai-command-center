import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, EstadoDeErro, EstadoVazio, SeletorCompacto, botao, juntar } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import {
  type AprendizadoNaTela,
  aprendizadosDoPainel,
  dataCurtaDoAprendizado,
  FILTROS_DOS_APRENDIZADOS,
  type FonteDoAprendizado,
  type LinhaDaMemoria,
  ROTULO_DA_FONTE,
} from "./aprendizadosDoPainel";

/**
 * "O que o painel aprendeu" (frente AP, 27/09/2026), no Contexto: o que o
 * cérebro do cliente guardou com a origem (entrega, ajuste, reprovação,
 * números reais), a força (quantas vezes se repetiu) e a data. Esquecer tira
 * da memória ativa; o aviso traz Desfazer. Lê direto do banco (RLS da equipe).
 */

const COLUNAS = "id, agente, tipo, texto, origem, ativa, criado_em, categoria, fonte, reforcos, reforcado_em, area, motivo";

export const chaveDosAprendizados = (clientId: string) => ["mesa", "aprendizados", clientId];

export function useAprendizadosDoCliente(clientId: string) {
  return useQuery({
    queryKey: chaveDosAprendizados(clientId),
    enabled: !!clientId,
    queryFn: async (): Promise<LinhaDaMemoria[]> => {
      const { data, error } = await (supabase as any)
        .from("agente_memoria")
        .select(COLUNAS)
        .eq("client_id", clientId)
        .eq("ativa", true)
        .order("criado_em", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as LinhaDaMemoria[];
    },
  });
}

async function mudarAtiva(clientId: string, id: string, ativa: boolean) {
  const { error } = await (supabase as any).from("agente_memoria").update({ ativa }).eq("id", id).eq("client_id", clientId);
  if (error) throw error;
}

function LinhaDoAprendizado({ a, onEsquecer, ocupado }: { a: AprendizadoNaTela; onEsquecer: () => void; ocupado: boolean }) {
  return (
    <li className="flex min-w-0 items-start py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug [overflow-wrap:anywhere]" title={a.motivo || undefined}>{a.texto}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {ROTULO_DA_FONTE[a.fonte]}
          {a.forca > 1 ? ` · ${a.forca}x` : ""}
          {a.data ? ` · ${dataCurtaDoAprendizado(a.data)}` : ""}
          {a.motivo ? ` · ${a.motivo}` : ""}
        </p>
      </div>
      <button
        type="button"
        className={juntar(botao.icone, "-my-1 ml-2")}
        onClick={onEsquecer}
        disabled={ocupado}
        aria-label="Esquecer este aprendizado"
        title="Esquecer"
      >
        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

export type FiltroDosAprendizados = "todos" | FonteDoAprendizado;

/**
 * Filtro por origem. Vai na linha do título do hub (28/09: seletor pequeno não
 * ganha linha própria); por isso a lista aceita o filtro de fora.
 */
export function SeletorDaOrigem({ valor, onEscolher }: { valor: FiltroDosAprendizados; onEscolher: (v: FiltroDosAprendizados) => void }) {
  return (
    <SeletorCompacto
      rotulo="Origem"
      opcoes={FILTROS_DOS_APRENDIZADOS.map((f) => ({ valor: f.valor, rotulo: f.rotulo }))}
      valor={valor}
      onEscolher={(v) => onEscolher(v as FiltroDosAprendizados)}
      listaQuandoNaoCabe
    />
  );
}

export default function ContextoAprendizados({
  clientId,
  filtro: filtroDeFora,
  onFiltro,
}: {
  clientId: string;
  /** Filtro controlado por quem chama (o seletor fica no título do hub). Sem ele, o seletor aparece em cima da lista. */
  filtro?: FiltroDosAprendizados;
  onFiltro?: (v: FiltroDosAprendizados) => void;
}) {
  const queryClient = useQueryClient();
  const consulta = useAprendizadosDoCliente(clientId);
  const [filtroLocal, setFiltroLocal] = useState<FiltroDosAprendizados>("todos");
  const controlado = filtroDeFora !== undefined && !!onFiltro;
  const filtro = controlado ? filtroDeFora! : filtroLocal;
  const setFiltro = controlado ? onFiltro! : setFiltroLocal;
  const [ocupado, setOcupado] = useState<string | null>(null);
  const lista = aprendizadosDoPainel(consulta.data, filtro);
  const atualizar = () => void queryClient.invalidateQueries({ queryKey: chaveDosAprendizados(clientId) });

  const esquecer = async (a: AprendizadoNaTela) => {
    setOcupado(a.id);
    try {
      await mudarAtiva(clientId, a.id, false);
      toast.success("Esquecido", {
        description: "O painel não usa mais este aprendizado.",
        action: {
          label: "Desfazer",
          onClick: () => {
            mudarAtiva(clientId, a.id, true)
              .then(atualizar)
              .catch((e) => toast.error("Não foi possível desfazer", { description: textoDoErro(e) }));
          },
        },
      });
    } catch (e) {
      toast.error("Não foi possível esquecer", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
      atualizar();
    }
  };

  if (consulta.isLoading && !consulta.data) return <Carregando linhas={3} rotulo="Lendo o que o painel aprendeu" />;
  if (consulta.isError && !consulta.data) {
    return (
      <EstadoDeErro
        descricao="A memória do cliente não respondeu."
        acao={<button type="button" className={botao.secundario} onClick={atualizar}>Tentar de novo</button>}
      />
    );
  }
  return (
    <div className="min-w-0">
      {!controlado && <SeletorDaOrigem valor={filtro} onEscolher={setFiltro} />}
      {lista.length === 0 ? (
        <EstadoVazio compacto titulo="Nada aqui ainda" descricao="Cada entrega, ajuste e número real ensina o painel." className={controlado ? "" : "mt-3"} />
      ) : (
        <ul className={juntar("divide-y divide-border", !controlado && "mt-2")}>
          {lista.map((a) => (
            <LinhaDoAprendizado key={a.id} a={a} ocupado={ocupado === a.id} onEsquecer={() => void esquecer(a)} />
          ))}
        </ul>
      )}
    </div>
  );
}
