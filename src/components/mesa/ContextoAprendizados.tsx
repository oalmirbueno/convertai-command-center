import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, EstadoDeErro, EstadoVazio, SeletorCompacto, botao, juntar } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { useMarcaDaMesa } from "./MesaContexto";
import {
  type AprendizadoNaTela,
  aprendizadosDaMarca,
  aprendizadosDoPainel,
  chaveDoTexto,
  dataCurtaDoAprendizado,
  FILTROS_DOS_APRENDIZADOS,
  type FonteDoAprendizado,
  gruposDosAprendizados,
  type LinhaDaMemoria,
  ROTULO_DA_AREA,
  ROTULO_DA_FONTE,
} from "./aprendizadosDoPainel";

/**
 * "O que o painel aprendeu" (frente AP, 27/09/2026), no Contexto: o que o
 * cérebro do cliente guardou com a origem (entrega, ajuste, reprovação,
 * números reais, pedido a um agente), a força (quantas vezes se repetiu) e a
 * data. Esquecer tira da memória ativa; o aviso traz Desfazer. Lê direto do
 * banco (RLS da equipe).
 *
 * 29/09 (dono: "todos eles têm que aprender com cada ajuste"): agrupado por
 * agente (quem segue a regra), com a área, o "não fazer" marcado, a marca
 * (filtro quando o cliente tem Acerbi e CME), e o texto editável na hora.
 */

const COLUNAS = "id, agente, tipo, texto, origem, ativa, criado_em, categoria, fonte, reforcos, reforcado_em, area, motivo, referencia_id, evidencia";

export const chaveDosAprendizados = (clientId: string) => ["mesa", "aprendizados", clientId];
/** A conversa dos agentes ("Aprendi", com Esquecer) usa esta chave: editar ou esquecer aqui atualiza lá. */
const chaveDasRegrasAtivas = (clientId: string) => ["agentes", "regras-ativas", clientId];

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
        .limit(300);
      if (error) throw error;
      return (data || []) as LinhaDaMemoria[];
    },
  });
}

async function mudarAtiva(clientId: string, id: string, ativa: boolean) {
  const { error } = await (supabase as any).from("agente_memoria").update({ ativa }).eq("id", id).eq("client_id", clientId);
  if (error) throw error;
}

/** Texto novo da regra: a chave acompanha (a mesma regra dita de novo continua virando reforço). */
async function mudarTexto(clientId: string, id: string, texto: string) {
  const { error } = await (supabase as any).from("agente_memoria").update({ texto, chave: chaveDoTexto(texto) }).eq("id", id).eq("client_id", clientId);
  if (error) throw error;
}

function LinhaDoAprendizado({
  a,
  nomeDaMarca,
  onEsquecer,
  onSalvar,
  ocupado,
}: {
  a: AprendizadoNaTela;
  nomeDaMarca: string | null;
  onEsquecer: () => void;
  onSalvar: (texto: string) => Promise<boolean>;
  ocupado: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(a.texto);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const t = rascunho.replace(/\s+/g, " ").trim();
    if (t.length < 3 || t === a.texto) {
      setEditando(false);
      setRascunho(a.texto);
      return;
    }
    setSalvando(true);
    const ok = await onSalvar(t.slice(0, 600));
    setSalvando(false);
    if (ok) setEditando(false);
  };
  const detalhes = [
    a.origem || ROTULO_DA_FONTE[a.fonte],
    a.area ? ROTULO_DA_AREA[a.area] || a.area : "",
    nomeDaMarca || "",
    a.forca > 1 ? `${a.forca}x` : "",
    a.data ? dataCurtaDoAprendizado(a.data) : "",
  ].filter(Boolean);
  return (
    <li className="flex min-w-0 items-start py-2" data-aprendizado={a.id}>
      <div className="min-w-0 flex-1">
        {editando ? (
          <div className="flex min-w-0 items-start">
            <textarea
              className="min-h-[52px] min-w-0 flex-1 resize-none rounded-md border border-border bg-background px-2 py-1 text-[13px] leading-snug focus:border-primary/60 focus:outline-none"
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void salvar();
                }
                if (e.key === "Escape") {
                  setEditando(false);
                  setRascunho(a.texto);
                }
              }}
              aria-label="Texto da regra"
              autoFocus
            />
            <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => void salvar()} disabled={salvando} aria-label="Salvar o texto" title="Salvar">
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
            <button type="button" className={botao.icone} onClick={() => { setEditando(false); setRascunho(a.texto); }} aria-label="Cancelar a edição" title="Cancelar">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className="text-[13px] leading-snug [overflow-wrap:anywhere]" title={a.motivo || undefined}>
            {a.evitar && <span className="mr-1 text-[11px] font-medium text-destructive">Não fazer:</span>}
            {a.texto}
          </p>
        )}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={a.motivo || undefined}>
          {detalhes.join(" · ")}
        </p>
      </div>
      {!editando && (
        <>
          <button
            type="button"
            className={juntar(botao.icone, "-my-1 ml-2")}
            onClick={() => setEditando(true)}
            disabled={ocupado}
            aria-label="Editar o texto deste aprendizado"
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={juntar(botao.icone, "-my-1")}
            onClick={onEsquecer}
            disabled={ocupado}
            aria-label="Esquecer este aprendizado"
            title="Esquecer"
          >
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </>
      )}
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
  const { marcas } = useMarcaDaMesa();
  const [filtroLocal, setFiltroLocal] = useState<FiltroDosAprendizados>("todos");
  const [marcaDoFiltro, setMarcaDoFiltro] = useState<string>("todas");
  const controlado = filtroDeFora !== undefined && !!onFiltro;
  const filtro = controlado ? filtroDeFora! : filtroLocal;
  const setFiltro = controlado ? onFiltro! : setFiltroLocal;
  const [ocupado, setOcupado] = useState<string | null>(null);
  const idsDasMarcas = marcas.map((m) => m.id);
  const nomeDaMarca = (id: string | null) => (id ? (marcas.find((m) => m.id === id) || { nome: null as string | null }).nome : null);
  const lista = aprendizadosDaMarca(aprendizadosDoPainel(consulta.data, filtro), marcaDoFiltro, idsDasMarcas);
  const grupos = gruposDosAprendizados(lista);
  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: chaveDosAprendizados(clientId) });
    void queryClient.invalidateQueries({ queryKey: chaveDasRegrasAtivas(clientId) });
  };

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

  const salvarTexto = async (a: AprendizadoNaTela, texto: string): Promise<boolean> => {
    setOcupado(a.id);
    try {
      await mudarTexto(clientId, a.id, texto);
      toast.success("Regra atualizada", {
        description: "Os agentes passam a seguir o texto novo.",
        action: {
          label: "Desfazer",
          onClick: () => {
            mudarTexto(clientId, a.id, a.texto)
              .then(atualizar)
              .catch((e) => toast.error("Não foi possível desfazer", { description: textoDoErro(e) }));
          },
        },
      });
      return true;
    } catch (e) {
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
      return false;
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
  const temMarcas = marcas.length > 1;
  return (
    <div className="min-w-0">
      {(!controlado || temMarcas) && (
        <div className="flex min-w-0 flex-wrap items-center">
          {!controlado && <SeletorDaOrigem valor={filtro} onEscolher={setFiltro} />}
          {temMarcas && (
            <span className={juntar(!controlado && "ml-2")}>
              <SeletorCompacto
                rotulo="Marca"
                opcoes={[{ valor: "todas", rotulo: "Todas as marcas" }].concat(marcas.map((m) => ({ valor: m.id, rotulo: m.nome })))}
                valor={marcaDoFiltro}
                onEscolher={setMarcaDoFiltro}
                listaQuandoNaoCabe
              />
            </span>
          )}
        </div>
      )}
      {lista.length === 0 ? (
        <EstadoVazio
          compacto
          titulo="Nada aqui ainda"
          descricao="Cada entrega, ajuste, pedido aos agentes e número real ensina o painel."
          className={controlado && !temMarcas ? "" : "mt-3"}
        />
      ) : (
        <div className={juntar("space-y-3", (!controlado || temMarcas) && "mt-2")}>
          {grupos.map((g) => (
            <section key={g.agente} className="min-w-0" aria-label={g.rotulo}>
              <h4 className="text-[12px] font-medium text-muted-foreground">
                {g.rotulo} <span className="font-normal">· {g.itens.length}</span>
              </h4>
              <ul className="divide-y divide-border">
                {g.itens.map((a) => (
                  <LinhaDoAprendizado
                    key={a.id}
                    a={a}
                    nomeDaMarca={temMarcas ? nomeDaMarca(a.marca) : null}
                    ocupado={ocupado === a.id}
                    onEsquecer={() => void esquecer(a)}
                    onSalvar={(t) => salvarTexto(a, t)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
