import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { Check, ExternalLink, Loader2, RefreshCw, Workflow, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { textoDoErro } from "@/lib/mesa/api";
import { AjudaRecolhida, botao, juntar, texto } from "@/components/sistema";
import { useMesa } from "./MesaContexto";
import { chaves, type Campanha } from "./mesaV4Api";
import { abrirCampanhaNoLab, decidirSugestao, sincronizarAgora, type SincroniaDaCampanha, type SugestaoDaPonte } from "@/lib/ponte/ponteApi";

/**
 * A campanha no canvas do Laboratório (25/10/2026, dono: "o laboratório do canvas sincronize com a área
 * campanhas ... e vice-versa ... atualizações e movimento de ambos os lados já atualiza as duas frentes ...
 * sempre complementando e nunca substituindo"). Contrato: docs/laboratorio/PONTE-CAMPANHAS.md.
 *
 * - O bloco "Canvas" (na Visão): abrir no Laboratório (cria o canvas da campanha quando falta), o estado da
 *   sincronia e "Sincronizar agora".
 * - As sugestões do canvas para a campanha (ponte_sugestoes, destino 'campanha'): quando os dois lados
 *   divergem, nada é trocado sozinho; a equipe aceita ou recusa aqui. As da campanha para o canvas aparecem
 *   só como aviso, com o link para o Laboratório (lá é que se decide).
 * - Tempo real: a campanha aberta, a série e as sugestões; a tela relê sozinha quando o canvas mexe.
 */

export type { SugestaoDaPonte };

export const chaveDasSugestoes = (campanhaId: string) => ["mesa", "ponte-sugestoes", campanhaId] as const;
export const chaveDasPecas = (clientId: string, campanhaId: string) => ["mesa", "campanha-pecas", clientId, campanhaId] as const;

/** O endereço do Laboratório com o projeto aberto (o mesmo que a página lê: aba e projeto). */
export const enderecoDoProjeto = (projetoId: string) => `/laboratorio?aba=projetos&projeto=${encodeURIComponent(projetoId)}`;

// ------------------------------------------------------------------ o estado da ponte na campanha

export interface EstadoDaSincronia {
  projetoId: string | null;
  ultima: string | null;
  pecasNovas: number;
  camposPreenchidos: number;
  avisos: string[];
}

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const textoOuNulo = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** mesa_campanhas.sincronia (SincroniaDaCampanha da ponte) em forma fixa; o que faltar fica vazio, nunca quebra a tela. */
export function lerSincronia(campanha: Pick<Campanha, "id"> & { sincronia?: unknown }): EstadoDaSincronia {
  const s = objeto(campanha.sincronia) as SincroniaDaCampanha & Record<string, unknown>;
  const resumo = objeto(s.resumo);
  return {
    projetoId: textoOuNulo(s.projeto_id),
    ultima: textoOuNulo(s.ultima_em),
    pecasNovas: Math.max(0, Math.round(Number(resumo.pecas_novas) || 0)),
    camposPreenchidos: Math.max(0, Math.round(Number(resumo.campos_preenchidos) || 0)),
    avisos: (Array.isArray(s.avisos) ? s.avisos : []).filter((a): a is string => typeof a === "string" && !!a.trim()).slice(0, 3),
  };
}

const quando = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/** Um valor de sugestão em texto curto (texto, número, lista ou objeto). */
export function valorLegivel(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if (typeof v === "string") return v.length > 220 ? `${v.slice(0, 217)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => valorLegivel(x)).join(", ").slice(0, 220);
  const o = objeto(v);
  const principal = o.nome || o.titulo || o.tema || o.texto;
  if (typeof principal === "string") return principal.slice(0, 220);
  try {
    return JSON.stringify(v).slice(0, 220);
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------ leitura e tempo real

export async function lerSugestoesDaPonte(campanhaId: string): Promise<SugestaoDaPonte[]> {
  const { data, error } = await (supabase as any)
    .from("ponte_sugestoes")
    .select("id, campanha_id, projeto_id, destino, chave, rotulo, valor_atual, valor_sugerido, situacao, created_at")
    .eq("campanha_id", campanhaId)
    .eq("situacao", "aberta")
    .order("created_at", { ascending: false })
    .limit(60);
  // Banco sem a ponte ainda: sem sugestões (a tela segue).
  if (error) return [];
  return (data || []) as SugestaoDaPonte[];
}

export function useSugestoesDaPonte(campanhaId: string) {
  return useQuery({ queryKey: chaveDasSugestoes(campanhaId), queryFn: () => lerSugestoesDaPonte(campanhaId), enabled: !!campanhaId, staleTime: 15_000 });
}

/**
 * Escuta a campanha aberta, a série dela e as sugestões da ponte; qualquer mudança (do canvas, de outra pessoa
 * ou da própria ponte) relê as chaves desta tela. Desinscreve ao sair ou ao trocar de campanha.
 */
export function useTempoRealDaCampanha(campanha: Pick<Campanha, "id" | "proposta_id">) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const id = campanha.id;
  const propostaId = campanha.proposta_id || "";
  useEffect(() => {
    const sb = supabase as any;
    if (!id || !sb || typeof sb.channel !== "function") return;
    const reler = (quais: Array<readonly unknown[]>) => {
      for (const k of quais) void qc.invalidateQueries({ queryKey: k as unknown[] });
    };
    let canal: any = null;
    try {
      canal = sb
        .channel(`campanha-ponte:${id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "mesa_campanhas", filter: `id=eq.${id}` }, () =>
          reler([chaves.campanhas(clientId), chaveDasPecas(clientId, id)]),
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "ponte_sugestoes", filter: `campanha_id=eq.${id}` }, () =>
          reler([chaveDasSugestoes(id)]),
        );
      if (propostaId) {
        canal = canal.on("postgres_changes", { event: "*", schema: "public", table: "calendario_propostas", filter: `id=eq.${propostaId}` }, () =>
          reler([chaves.proposta(propostaId), chaveDasPecas(clientId, id), chaves.campanhas(clientId)]),
        );
      }
      canal.subscribe();
    } catch {
      canal = null;
    }
    return () => {
      try {
        if (canal) sb.removeChannel(canal);
      } catch {
        /* nada a soltar */
      }
    };
  }, [id, propostaId, clientId, qc]);
}

/** Navega pelo roteador quando a tela está dentro dele; fora (prévia solta), pelo endereço. */
function useIrPara(): (url: string) => void {
  const dentro = useInRouterContext();
  // O contexto do roteador não muda durante a vida do componente: a ordem dos hooks fica estável.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const navegar = dentro ? useNavigate() : null;
  return (url: string) => {
    if (navegar) navegar(url);
    else if (typeof window !== "undefined") window.location.assign(url);
  };
}

// ------------------------------------------------------------------ o bloco

export default function CampanhaCanvas({ campanha }: { campanha: Campanha }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const navigate = useIrPara();
  const estado = lerSincronia(campanha as Campanha & { sincronia?: unknown });
  const sugestoes = useSugestoesDaPonte(campanha.id);
  const paraACampanha = (sugestoes.data || []).filter((s) => s.destino === "campanha");
  const paraOCanvas = (sugestoes.data || []).filter((s) => s.destino === "canvas");
  const [abertas, setAbertas] = useState(true);
  const [decidindo, setDecidindo] = useState<string | null>(null);

  const reler = () => {
    void qc.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    void qc.invalidateQueries({ queryKey: chaveDasSugestoes(campanha.id) });
    void qc.invalidateQueries({ queryKey: chaveDasPecas(clientId, campanha.id) });
    if (campanha.proposta_id) void qc.invalidateQueries({ queryKey: chaves.proposta(campanha.proposta_id) });
  };

  const abrir = useMutation({
    mutationFn: () => abrirCampanhaNoLab(campanha.id),
    onSuccess: (r) => {
      reler();
      const projeto = r && r.projeto_id ? r.projeto_id : estado.projetoId;
      if (projeto) navigate(enderecoDoProjeto(projeto));
    },
    onError: (e) => toast.error("Não abri o canvas", { description: textoDoErro(e) }),
  });
  const sincronia = useMutation({
    mutationFn: () => sincronizarAgora(campanha.id),
    onSuccess: () => {
      reler();
      toast.success("Campanha e canvas sincronizados");
    },
    onError: (e) => toast.error("A sincronia não rodou", { description: textoDoErro(e) }),
  });
  const decidir = async (s: SugestaoDaPonte, aceitar: boolean) => {
    setDecidindo(s.id);
    try {
      await decidirSugestao(s.id, aceitar);
      reler();
      toast.success(aceitar ? "Sugestão aplicada" : "Sugestão recusada", aceitar ? { description: s.rotulo } : undefined);
    } catch (e) {
      toast.error("Não decidi a sugestão", { description: textoDoErro(e) });
    } finally {
      setDecidindo(null);
    }
  };

  const ligado = !!estado.projetoId;
  const resumo: string[] = [];
  if (estado.pecasNovas) resumo.push(`${estado.pecasNovas} ${estado.pecasNovas === 1 ? "peça nova veio" : "peças novas vieram"} do canvas`);
  if (estado.camposPreenchidos) resumo.push(`${estado.camposPreenchidos} ${estado.camposPreenchidos === 1 ? "campo vazio preenchido" : "campos vazios preenchidos"}`);

  return (
    <section id={`campanha-canvas-${campanha.id}`} className="min-w-0 border-t border-border pt-4" aria-label="Canvas do Laboratório" data-canvas-da-campanha={ligado ? "ligado" : "sem"}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Workflow className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className={juntar(texto.tituloSecao, "min-w-0")}>Canvas</h3>
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>
          {ligado ? `No Laboratório${estado.ultima ? ` · sincronizado ${quando(estado.ultima)}` : ""}` : "Ainda sem canvas"}
        </span>
        <AjudaRecolhida rotulo="Como a campanha e o canvas conversam">
          A campanha aparece no canvas do Laboratório como nós: cliente, marca, produtos, oferta, público, o funil com as fases e uma peça por nó. O que você mexer de um lado chega ao outro sozinho, sempre completando: campo vazio é preenchido e peça nova entra na série. Quando os dois lados têm valores diferentes, nada é trocado; a diferença vira sugestão para você aceitar ou recusar.
        </AjudaRecolhida>
        {ligado && (
          <button type="button" className={botao.secundario} onClick={() => sincronia.mutate()} disabled={sincronia.isPending}>
            {sincronia.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Sincronizar agora
          </button>
        )}
        <button type="button" className={ligado ? botao.secundario : botao.primario} onClick={() => abrir.mutate()} disabled={abrir.isPending}>
          {abrir.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {ligado ? "Abrir no Laboratório" : "Montar o canvas"}
        </button>
      </div>
      {resumo.length > 0 && <p className={juntar(texto.auxiliar, "mt-2")}>{resumo.join(" · ")}</p>}
      {estado.avisos.length > 0 && <p className={juntar(texto.auxiliar, "mt-2")}>{estado.avisos.join(" ")}</p>}

      {paraACampanha.length > 0 && (
        <div className="mt-3 min-w-0" data-sugestoes-do-canvas={paraACampanha.length}>
          <button type="button" className={juntar(texto.rotulo, "hover:text-foreground")} onClick={() => setAbertas(!abertas)} aria-expanded={abertas}>
            O canvas sugere {paraACampanha.length} {paraACampanha.length === 1 ? "mudança" : "mudanças"} {abertas ? "▾" : "▸"}
          </button>
          {abertas && (
            <ul className="mt-2 min-w-0" aria-label="Sugestões do canvas para a campanha">
              {paraACampanha.map((s) => (
                <li key={s.id} className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 border-t border-border py-3 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_200px]" data-sugestao={s.id}>
                  <div className="min-w-0">
                    <p className={juntar(texto.corpo, "font-medium")}>{s.rotulo}</p>
                    <dl className="mt-1 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                      <div className="min-w-0">
                        <dt className={texto.rotulo}>Na campanha</dt>
                        <dd className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>{valorLegivel(s.valor_atual)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className={texto.rotulo}>No canvas</dt>
                        <dd className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{valorLegivel(s.valor_sugerido)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex min-w-0 items-start gap-2 lg:flex-col">
                    <button type="button" className={juntar(botao.primario, "lg:w-full")} onClick={() => void decidir(s, true)} disabled={decidindo !== null} aria-label={`Aceitar: ${s.rotulo}`}>
                      {decidindo === s.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                      Aceitar
                    </button>
                    <button type="button" className={juntar(botao.discreto, "lg:w-full")} onClick={() => void decidir(s, false)} disabled={decidindo !== null} aria-label={`Recusar: ${s.rotulo}`}>
                      <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      Recusar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {paraOCanvas.length > 0 && estado.projetoId && (
        <p className={juntar(texto.auxiliar, "mt-3")} data-sugestoes-para-o-canvas={paraOCanvas.length}>
          A campanha tem {paraOCanvas.length} {paraOCanvas.length === 1 ? "sugestão" : "sugestões"} para o canvas.{" "}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => navigate(enderecoDoProjeto(estado.projetoId as string))}>
            Decidir no Laboratório
          </button>
        </p>
      )}
    </section>
  );
}

/** O botão da barra do detalhe: mostra quantas sugestões do canvas esperam e leva ao bloco. */
export function BotaoDoCanvas({ campanha, onIr }: { campanha: Campanha; onIr: () => void }) {
  const sugestoes = useSugestoesDaPonte(campanha.id);
  const n = (sugestoes.data || []).filter((s) => s.destino === "campanha").length;
  const ligado = !!lerSincronia(campanha as Campanha & { sincronia?: unknown }).projetoId;
  return (
    <button
      type="button"
      className={juntar(botao.icone, "relative")}
      onClick={onIr}
      aria-label={n ? `Canvas: ${n} ${n === 1 ? "sugestão" : "sugestões"} do canvas` : "Canvas da campanha"}
      title={ligado ? "Canvas no Laboratório" : "Montar o canvas da campanha"}
      data-botao-do-canvas={n}
    >
      <Workflow className="h-4 w-4" aria-hidden="true" />
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-none text-primary-foreground">
          {n > 9 ? "9+" : n}
        </span>
      )}
    </button>
  );
}

/** O selo pequeno "no canvas" na lista de campanhas. */
export function SeloNoCanvas({ campanha }: { campanha: Campanha }) {
  if (!lerSincronia(campanha as Campanha & { sincronia?: unknown }).projetoId) return null;
  return (
    <span className="mr-1.5 inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" title="Campanha ligada a um canvas do Laboratório" data-no-canvas="">
      <Workflow className="mr-0.5 h-3 w-3" aria-hidden="true" />
      no canvas
    </span>
  );
}
