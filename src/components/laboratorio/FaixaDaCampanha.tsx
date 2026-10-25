import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, Link2, Loader2, Megaphone, RefreshCw, Unlink, Wand2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AjudaRecolhida, JanelaCentral, MenuMais, botao, juntar, superficie, texto } from "@/components/sistema";
import { ErroDaMesa, textoDoErro } from "@/lib/mesa/api";
import {
  chavesDaPonte,
  decidirSugestao,
  desligarProjeto,
  lerEstadoDaPonte,
  ligarProjetoACampanha,
  montarCampanhaDoCanvas,
  rotuloDaChave,
  sincronizarAgora,
  type EstadoDaPonte,
  type ResumoDaSincronia,
  type SugestaoDaPonte,
} from "@/lib/ponte/ponteApi";
import JanelaDeCusto from "./JanelaDeCusto";

/**
 * A faixa "Campanha" do editor do Laboratório (Ponte Laboratório ↔ Campanhas, 25/10/2026, dono: "o laboratório do
 * canvas sincronize com a área campanhas ... e vice-versa ... atualizações e movimento de ambos os lados já
 * atualiza as duas frentes ... sempre complementando e nunca substituindo").
 *
 * - Ligada: o nome da campanha (abre na Mesa do cliente), a última sincronia e o que entrou, "Sincronizar agora",
 *   as sugestões da campanha para o canvas (Aceitar ou Recusar) e o aviso das sugestões do canvas para a campanha.
 * - Sem ligação: "Montar campanha a partir deste canvas" (custo antes) e "Ligar a uma campanha" do cliente.
 * O tempo real das sugestões e da campanha atualiza a faixa sozinho; o canvas o editor recarrega.
 */

export interface PropsDaFaixa {
  projetoId: string;
  clienteId: string | null;
  /** Salva o canvas antes de chamar a ponte (a ponte lê o que está gravado). */
  antesDeChamar: () => Promise<void>;
  /** A ponte mudou o canvas (ligar, montar, sugestão aceita): o editor relê o projeto. */
  aoMudarCanvas: () => void;
}

/** A rota da campanha na Mesa do cliente. */
export const rotaDaCampanha = (clientId: string, campanhaId: string) => `/mesa?client=${clientId}&aba=campanhas&campanha=${campanhaId}`;

const quando = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.round(min / 60)} h`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

/** O que entrou na última sincronia, em frase curta ("2 nós novos, 1 peça nova"). */
export function frasesDoResumo(r: Partial<ResumoDaSincronia> | undefined): string {
  if (!r) return "";
  const partes: string[] = [];
  const conta = (n: number | undefined, um: string, varios: string) => {
    if (n && n > 0) partes.push(`${n} ${n === 1 ? um : varios}`);
  };
  conta(r.nos_novos, "nó novo", "nós novos");
  conta(r.nos_atualizados, "nó atualizado", "nós atualizados");
  conta(r.pecas_novas, "peça nova", "peças novas");
  conta(r.campos_preenchidos, "campo preenchido", "campos preenchidos");
  return partes.join(", ");
}

/** Valor de uma sugestão em texto legível (texto, número, lista ou objeto curto). */
export function valorLegivel(v: unknown): string {
  if (v == null || v === "") return "vazio";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(valorLegivel).join(", ");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** O custo que a ponte pede para montar a campanha (409 confirmar_custo), ou null. */
export function custoDoMontar(e: unknown): number | null {
  if (!(e instanceof ErroDaMesa) || (e.codigo !== "confirmar_custo" && e.codigo !== "confirmacao_necessaria")) return null;
  const d = (e.detalhes && typeof e.detalhes === "object" ? e.detalhes : {}) as Record<string, unknown>;
  const est = (d.estimativa && typeof d.estimativa === "object" ? d.estimativa : {}) as Record<string, unknown>;
  const n = Number(d.total_usd ?? d.custo_usd ?? d.estimativa_usd ?? est.total_usd ?? est.custo_usd);
  return isFinite(n) ? n : 0;
}

function Sugestao({ s, aoDecidir }: { s: SugestaoDaPonte; aoDecidir?: (aceitar: boolean) => Promise<void> }) {
  const [rodando, setRodando] = useState<"sim" | "nao" | null>(null);
  const decidir = async (aceitar: boolean) => {
    if (!aoDecidir) return;
    setRodando(aceitar ? "sim" : "nao");
    try {
      await aoDecidir(aceitar);
    } finally {
      setRodando(null);
    }
  };
  return (
    <li className="grid min-w-0 grid-cols-1 gap-2 border-t border-border py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto]" data-sugestao-da-ponte={s.id}>
      <div className="min-w-0">
        <p className={juntar(texto.corpo, "font-medium")}>{s.rotulo || rotuloDaChave(s.chave)}</p>
        <p className={juntar(texto.auxiliar, "break-words")}>
          <span className="line-through opacity-70">{valorLegivel(s.valor_atual)}</span>
          <span className="mx-1">→</span>
          <span className="text-foreground">{valorLegivel(s.valor_sugerido)}</span>
        </p>
      </div>
      {aoDecidir && (
        <div className="flex items-center gap-2 self-center">
          <button type="button" className={botao.secundario} onClick={() => void decidir(true)} disabled={!!rodando} aria-label={`Aceitar: ${s.rotulo || rotuloDaChave(s.chave)}`}>
            {rodando === "sim" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Aceitar
          </button>
          <button type="button" className={botao.discreto} onClick={() => void decidir(false)} disabled={!!rodando} aria-label={`Recusar: ${s.rotulo || rotuloDaChave(s.chave)}`}>
            {rodando === "nao" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Recusar
          </button>
        </div>
      )}
    </li>
  );
}

type CampanhaDoCliente = { id: string; nome: string; status: string; periodo_inicio: string | null; periodo_fim: string | null };

async function lerCampanhasDoCliente(clienteId: string): Promise<CampanhaDoCliente[]> {
  const { data, error } = await (supabase as any)
    .from("mesa_campanhas")
    .select("id, nome, status, periodo_inicio, periodo_fim")
    .eq("client_id", clienteId)
    .order("atualizado_em", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data || []) as CampanhaDoCliente[];
}

function JanelaDeLigar({ aberta, clienteId, onFechar, onEscolher }: { aberta: boolean; clienteId: string; onFechar: () => void; onEscolher: (id: string) => Promise<void> }) {
  const lista = useQuery({ queryKey: ["ponte", "campanhas-do-cliente", clienteId], queryFn: () => lerCampanhasDoCliente(clienteId), enabled: aberta && !!clienteId });
  const [ligando, setLigando] = useState<string | null>(null);
  return (
    <JanelaCentral aberta={aberta} onFechar={() => (ligando ? undefined : onFechar())} titulo="Ligar a uma campanha" icone={<Link2 className="h-4 w-4" />} largura="md">
      {lista.isLoading ? (
        <p className={texto.auxiliar}>
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Lendo as campanhas do cliente…
        </p>
      ) : lista.isError ? (
        <p className={juntar(texto.auxiliar, "text-destructive")}>{textoDoErro(lista.error)}</p>
      ) : !(lista.data || []).length ? (
        <p className={texto.auxiliar}>Este cliente ainda não tem campanha. Use Montar campanha a partir deste canvas.</p>
      ) : (
        <ul className="min-w-0" aria-label="Campanhas do cliente">
          {(lista.data || []).map((c) => (
            <li key={c.id} className="flex min-w-0 items-center gap-3 border-t border-border py-2.5 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {c.status}
                  {c.periodo_inicio ? ` · ${c.periodo_inicio.slice(8, 10)}/${c.periodo_inicio.slice(5, 7)}` : ""}
                  {c.periodo_fim ? ` a ${c.periodo_fim.slice(8, 10)}/${c.periodo_fim.slice(5, 7)}` : ""}
                </span>
              </span>
              <button
                type="button"
                className={botao.secundario}
                disabled={!!ligando}
                onClick={async () => {
                  setLigando(c.id);
                  try {
                    await onEscolher(c.id);
                  } finally {
                    setLigando(null);
                  }
                }}
                aria-label={`Ligar à campanha ${c.nome}`}
              >
                {ligando === c.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Ligar
              </button>
            </li>
          ))}
        </ul>
      )}
    </JanelaCentral>
  );
}

export default function FaixaDaCampanha({ projetoId, clienteId, antesDeChamar, aoMudarCanvas }: PropsDaFaixa) {
  const qc = useQueryClient();
  const chave = chavesDaPonte.porProjeto(projetoId);
  const estado = useQuery({ queryKey: chave, queryFn: () => lerEstadoDaPonte({ projetoId }), retry: false, staleTime: 15_000 });
  const [sincronizando, setSincronizando] = useState(false);
  const [ligarAberta, setLigarAberta] = useState(false);
  const [sugestoesAbertas, setSugestoesAbertas] = useState(true);
  const [custo, setCusto] = useState<number | null>(null);
  const [montando, setMontando] = useState(false);
  const e: EstadoDaPonte | undefined = estado.data;
  const campanha = e && e.ligada ? e.campanha : null;
  const abertas = ((e && e.sugestoes) || []).filter((s) => s.situacao === "aberta");
  const paraOCanvas = abertas.filter((s) => s.destino === "canvas");
  const paraACampanha = abertas.filter((s) => s.destino === "campanha");
  const reler = () => void qc.invalidateQueries({ queryKey: chave });

  // Tempo real: sugestões e a própria campanha mudam a faixa (o canvas o editor acompanha pela linha do projeto).
  const campanhaId = campanha ? campanha.id : "";
  useEffect(() => {
    if (!campanhaId) return;
    const sb = supabase as any;
    if (!sb || typeof sb.channel !== "function") return;
    let canal: any = null;
    try {
      canal = sb
        .channel(`ponte:${campanhaId}:${Date.now().toString(36)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "ponte_sugestoes", filter: `campanha_id=eq.${campanhaId}` }, () => reler())
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mesa_campanhas", filter: `id=eq.${campanhaId}` }, () => reler())
        .subscribe();
    } catch {
      canal = null;
    }
    return () => {
      try {
        if (canal) sb.removeChannel(canal);
      } catch {
        /* canal já fechado */
      }
    };
  }, [campanhaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicarResultado = (estadoNovo: EstadoDaPonte | undefined) => {
    if (estadoNovo) qc.setQueryData(chave, estadoNovo);
    else reler();
    aoMudarCanvas();
  };

  const sincronizar = async () => {
    if (!campanha) return;
    setSincronizando(true);
    try {
      await antesDeChamar();
      const r = await sincronizarAgora(campanha.id);
      aplicarResultado(r && r.estado);
      const frase = frasesDoResumo(r && r.resumo);
      toast.success("Sincronizado", { description: frase || "Os dois lados já estavam iguais." });
    } catch (err) {
      toast.error("Não sincronizou", { description: textoDoErro(err) });
    } finally {
      setSincronizando(false);
    }
  };

  const montar = async (confirmado: boolean) => {
    setMontando(true);
    try {
      await antesDeChamar();
      const r = await montarCampanhaDoCanvas(projetoId, confirmado);
      setCusto(null);
      reler();
      aoMudarCanvas();
      void qc.invalidateQueries({ queryKey: ["mesa", "campanhas"] });
      toast.success("Campanha montada", { description: "Ela já está na Mesa do cliente, ligada a este canvas." });
      return r;
    } catch (err) {
      const valor = custoDoMontar(err);
      if (valor !== null && !confirmado) setCusto(valor);
      else toast.error("Não montou a campanha", { description: textoDoErro(err) });
      return null;
    } finally {
      setMontando(false);
    }
  };

  const ligar = async (id: string) => {
    try {
      await antesDeChamar();
      const r = await ligarProjetoACampanha(projetoId, id);
      setLigarAberta(false);
      aplicarResultado(r && r.estado);
      toast.success("Canvas ligado à campanha", { description: frasesDoResumo(r && r.resumo) || "Os dois lados ficam em dia a partir de agora." });
    } catch (err) {
      toast.error("Não ligou", { description: textoDoErro(err) });
    }
  };

  const desligar = async () => {
    try {
      await desligarProjeto(projetoId);
      reler();
      toast.success("Ligação desfeita", { description: "Nada foi apagado nos dois lados." });
    } catch (err) {
      toast.error("Não desligou", { description: textoDoErro(err) });
    }
  };

  const decidir = (s: SugestaoDaPonte) => async (aceitar: boolean) => {
    try {
      const r = await decidirSugestao(s.id, aceitar);
      if (r && r.estado) qc.setQueryData(chave, r.estado);
      else reler();
      if (aceitar) aoMudarCanvas();
      toast.success(aceitar ? "Sugestão aceita" : "Sugestão recusada");
    } catch (err) {
      toast.error("Não decidiu", { description: textoDoErro(err) });
    }
  };

  // A ponte ainda não responde (função sem publicar ou fora do ar): a faixa some sem atrapalhar o editor.
  if (estado.isError || estado.isLoading) return null;

  return (
    <section className={juntar(superficie.poco, "mb-2 min-w-0 px-3 py-2")} aria-label="Campanha deste canvas" data-faixa-da-campanha={campanha ? "ligada" : "solta"}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <Megaphone className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        {campanha ? (
          <>
            <span className={juntar(texto.corpo, "min-w-0 truncate")}>
              Campanha:{" "}
              <Link to={rotaDaCampanha(campanha.client_id, campanha.id)} className="font-medium text-primary hover:underline" data-link-da-campanha="">
                {campanha.nome}
              </Link>
            </span>
            <span className={juntar(texto.auxiliar, "min-w-0 truncate")} data-estado-da-sincronia="">
              {e && e.sincronia && e.sincronia.ultima_em ? `Sincronizado ${quando(e.sincronia.ultima_em)}` : "Ainda não sincronizado"}
              {e && e.sincronia && frasesDoResumo(e.sincronia.resumo) ? ` · ${frasesDoResumo(e.sincronia.resumo)}` : ""}
            </span>
            <span className="hidden flex-1 sm:block" />
            {paraACampanha.length > 0 && (
              <Link to={rotaDaCampanha(campanha.client_id, campanha.id)} className={juntar(texto.auxiliar, "hover:underline")} data-sugestoes-para-a-campanha={paraACampanha.length}>
                {paraACampanha.length === 1 ? "1 sugestão do canvas espera na campanha" : `${paraACampanha.length} sugestões do canvas esperam na campanha`}
              </Link>
            )}
            <button type="button" className={botao.secundario} onClick={() => void sincronizar()} disabled={sincronizando} data-sincronizar-agora="">
              {sincronizando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Sincronizar agora
            </button>
            <MenuMais rotulo="Mais da ligação com a campanha" itens={[{ rotulo: "Desligar da campanha", icone: <Unlink className="h-4 w-4" />, perigo: true, dica: "Solta a ligação; nada é apagado nos dois lados.", aoEscolher: () => void desligar() }]} />
          </>
        ) : clienteId ? (
          <>
            <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>Este canvas ainda não tem campanha.</span>
            <AjudaRecolhida rotulo="Como funciona a ligação com a campanha">
              Montar lê o canvas (oferta, público, produtos, funil e as peças) e cria a campanha na Mesa do cliente, já ligada. Ligar junta este canvas a uma campanha que já existe. Depois disso, o que muda de um lado aparece no outro: campo vazio é preenchido, peça nova entra, e o que difere vira sugestão para você aceitar ou recusar. Nada é substituído sozinho.
            </AjudaRecolhida>
            <button type="button" className={botao.secundario} onClick={() => setLigarAberta(true)} data-ligar-a-campanha="">
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Ligar a uma campanha
            </button>
            <button type="button" className={botao.primario} onClick={() => void montar(false)} disabled={montando} data-montar-campanha="">
              {montando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Montar campanha a partir deste canvas
            </button>
          </>
        ) : (
          <span className={juntar(texto.auxiliar, "min-w-0 flex-1")}>Escolha o cliente no Canvas Studio para ligar este canvas a uma campanha.</span>
        )}
      </div>

      {campanha && paraOCanvas.length > 0 && (
        <div className="mt-2 min-w-0 border-t border-border pt-2" data-sugestoes-para-o-canvas={paraOCanvas.length}>
          <button type="button" className={juntar(texto.corpo, "flex items-center font-medium")} onClick={() => setSugestoesAbertas(!sugestoesAbertas)} aria-expanded={sugestoesAbertas}>
            {sugestoesAbertas ? <ChevronDown className="mr-1 h-4 w-4" aria-hidden="true" /> : <ChevronRight className="mr-1 h-4 w-4" aria-hidden="true" />}
            A campanha sugere ({paraOCanvas.length})
          </button>
          {sugestoesAbertas && (
            <ul className="min-w-0" aria-label="Sugestões da campanha para o canvas">
              {paraOCanvas.map((s) => (
                <Sugestao key={s.id} s={s} aoDecidir={decidir(s)} />
              ))}
            </ul>
          )}
        </div>
      )}

      {clienteId && <JanelaDeLigar aberta={ligarAberta} clienteId={clienteId} onFechar={() => setLigarAberta(false)} onEscolher={ligar} />}
      <JanelaDeCusto
        aberta={custo !== null}
        titulo="Montar a campanha a partir do canvas"
        linhas={custo !== null ? [{ id: "montar", nome: "Campanha completa (briefing, linha do tempo e série)", custo_usd: custo }] : []}
        total={custo || 0}
        rodando={montando}
        creditos={false}
        onConfirmar={() => void montar(true)}
        onFechar={() => setCusto(null)}
      />
    </section>
  );
}
