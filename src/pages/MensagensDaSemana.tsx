import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCheck, ChevronDown, CornerDownLeft, Loader2, MessageCircle, MonitorSmartphone, RefreshCw, RotateCcw, Send, SkipForward, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useCentralReviews } from "@/hooks/useCentralReviews";
import { useRascunhosDaSemana } from "@/hooks/useMensagensDaSemana";
import { centralReviewError } from "@/lib/centralReview";
import { NOME_DO_RITUAL, aprovarEEnviar, montarMensagens, prazoEmPalavras, pularMensagem, type MensagemDaSemana } from "@/lib/mensagensDaSemana";
import { reescreverRitual } from "@/components/central/agenteCentralApi";
import {
  BotaoComIcone,
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  Secao,
  botao,
  campo,
  campoTexto,
  espaco,
  etiqueta,
  juntar,
  larguraDaMesa,
  texto,
} from "@/components/sistema";

/*
 * Mensagens da semana (26/10/2026): todas as mensagens prontas dos rituais de
 * segunda, quarta e sexta, de todos os clientes, numa tela só. O dono edita o
 * texto (ou pede o ajuste ao agente da Central), aprova uma a uma ou todas, ou
 * pula. Nada sai sem ele. O fluxo de aprovação e envio é o da Central
 * (src/lib/mensagensDaSemana.ts).
 */

/*
 * 26/10 (dono: "uma coisa por vez, mais enxuto"): duas listas só (para aprovar,
 * com as vencidas junto, e as aprovadas recolhidas), agrupadas por cliente, e
 * uma mensagem aberta por vez. As outras ficam numa linha com o começo do texto.
 */
const SECOES: Array<{ chave: string; situacoes: Array<MensagemDaSemana["situacao"]>; titulo: string }> = [
  { chave: "pronta", situacoes: ["pronta", "venceu"], titulo: "Para aprovar" },
  { chave: "aprovada", situacoes: ["aprovada"], titulo: "Aprovadas, o Hermes envia" },
];

/** Marca de "a pessoa fechou a aberta" (nenhuma aberta até escolher outra). */
const FECHADAS = "__nenhuma__";

export default function MensagensDaSemana() {
  const { user, profile } = useAuth();
  const eAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const pedidos = useCentralReviews(eAdmin, null);
  const rascunhos = useRascunhosDaSemana(eAdmin);
  const { data: clientes = [] } = useClients();
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<Record<string, "aprovar" | "pular" | "ajustar">>({});
  const [escondidas, setEscondidas] = useState<string[]>([]);
  const [confirmarTodas, setConfirmarTodas] = useState(false);
  const [emLote, setEmLote] = useState<{ feitas: number; total: number } | null>(null);
  /** A mensagem aberta (uma por vez); sem escolha, a primeira da lista. */
  const [abertaEscolhida, setAbertaEscolhida] = useState<string | null>(null);
  const [pedindoAjuste, setPedindoAjuste] = useState<string | null>(null);

  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes as Array<{ id: string; company_name?: string | null; full_name?: string | null }>) m.set(String(c.id), c.company_name || c.full_name || "Cliente");
    return m;
  }, [clientes]);
  const agora = Date.now();
  const mensagens = useMemo(
    () => montarMensagens(rascunhos.data ?? [], pedidos.data ?? [], Date.now())
      .filter((m) => escondidas.indexOf(m.chave) < 0)
      // Agrupadas por cliente (dentro do cliente, a ordem da semana).
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (nomes.get(a.m.clientId) || "").localeCompare(nomes.get(b.m.clientId) || "", "pt-BR") || a.i - b.i)
      .map((x) => x.m),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rascunhos.data, pedidos.data, escondidas, nomes],
  );
  const prontas = mensagens.filter((m) => m.situacao !== "aprovada");
  const aberta = abertaEscolhida && prontas.some((m) => m.chave === abertaEscolhida) ? abertaEscolhida : abertaEscolhida === FECHADAS ? null : prontas[0]?.chave ?? null;

  if (profile && !eAdmin) return <Navigate to="/central" replace />;

  const textoDe = (m: MensagemDaSemana) => (textos[m.chave] !== undefined ? textos[m.chave] : m.report.summary || "");
  const atualizar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["central-review-approvals"] }),
      queryClient.invalidateQueries({ queryKey: ["mensagens-da-semana"] }),
    ]);
  };
  const marcar = (m: MensagemDaSemana, o: "aprovar" | "pular" | "ajustar" | null) =>
    setOcupado((x) => {
      const y = { ...x };
      if (o) y[m.chave] = o;
      else delete y[m.chave];
      return y;
    });

  const aprovar = async (m: MensagemDaSemana, silencioso = false): Promise<boolean> => {
    if (!user) return false;
    marcar(m, "aprovar");
    try {
      const r = await aprovarEEnviar(m, textoDe(m), user.id);
      if (!silencioso) toast.success(r.via === "portal" ? "Aprovada e publicada no portal do cliente." : "Aprovada. O Hermes envia no grupo e registra o envio.");
      setEscondidas((x) => x.concat(m.chave));
      return true;
    } catch (e) {
      toast.error(`${nomes.get(m.clientId) || "Cliente"}: ${centralReviewError(e)}`);
      return false;
    } finally {
      marcar(m, null);
    }
  };

  const aprovarTodas = async () => {
    if (!confirmarTodas) { setConfirmarTodas(true); return; }
    setConfirmarTodas(false);
    const fila = prontas.slice();
    let ok = 0;
    setEmLote({ feitas: 0, total: fila.length });
    for (const m of fila) {
      // Uma de cada vez: o banco confere versão e hash de cada pedido.
      if (await aprovar(m, true)) ok += 1;
      setEmLote({ feitas: ok, total: fila.length });
    }
    setEmLote(null);
    await atualizar();
    if (ok) toast.success(`${ok} de ${fila.length} ${fila.length === 1 ? "mensagem aprovada" : "mensagens aprovadas"}.`);
  };

  const pular = async (m: MensagemDaSemana) => {
    marcar(m, "pular");
    try {
      const r = await pularMensagem(m);
      setEscondidas((x) => x.concat(m.chave));
      toast.success(r === "pulada" ? "Pulada: não vai para o cliente." : "Tirada da lista.");
      void atualizar();
    } catch (e) {
      toast.error(centralReviewError(e));
    } finally {
      marcar(m, null);
    }
  };

  const ajustar = async (m: MensagemDaSemana) => {
    const pedido = (ajustes[m.chave] || "").trim();
    if (!pedido) return;
    marcar(m, "ajustar");
    try {
      const r = await reescreverRitual({ clientId: m.clientId, ritual: m.ritual, instrucao: pedido, anterior: textoDe(m) });
      if (!r.ritual?.body) throw new Error(r.ritual_erro || "O agente não devolveu o texto agora.");
      setTextos((x) => ({ ...x, [m.chave]: r.ritual!.body }));
      setAjustes((x) => ({ ...x, [m.chave]: "" }));
      toast.success("Ajustado. Confira o texto e aprove.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ajustar agora.");
    } finally {
      marcar(m, null);
    }
  };

  const carregando = pedidos.isLoading || rascunhos.isLoading;
  const erro = pedidos.error || rascunhos.error;
  const vencidas = mensagens.filter((m) => m.situacao === "venceu").length;

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-mensagens-da-semana="">
      <CabecalhoDePagina
        titulo="Mensagens da semana"
        descricao={`${mensagens.filter((m) => m.situacao === "pronta").length} prontas${vencidas ? ` · ${vencidas} vencidas` : ""}`}
        ajuda="Todas as mensagens dos rituais de segunda, quarta e sexta, de todos os clientes. Edite o texto ou peça o ajuste ao agente, e aprove. No WhatsApp, o Hermes envia no grupo e registra; no portal, a aprovação já publica. Pular registra que esta não vai. Nada sai sem você."
        acoes={<>
          <Link to="/central" className={botao.icone} title="Voltar à Central" aria-label="Voltar à Central"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
          <button type="button" onClick={() => void atualizar()} className={botao.icone} title="Atualizar" aria-label="Atualizar"><RefreshCw className={juntar("h-4 w-4", (pedidos.isFetching || rascunhos.isFetching) && "animate-spin")} aria-hidden="true" /></button>
          {prontas.length > 1 && (
            <BotaoComIcone
              variante={confirmarTodas ? "primario" : "secundario"}
              icone={emLote ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              rotulo={emLote ? `Aprovando ${emLote.feitas}/${emLote.total}` : confirmarTodas ? `Confirmar: aprovar ${prontas.length}` : `Aprovar todas (${prontas.length})`}
              onClick={() => void aprovarTodas()}
              disabled={!!emLote}
              title="Aprova todas as prontas e as vencidas desta lista, uma de cada vez"
            />
          )}
        </>}
      />

      {carregando ? <Carregando linhas={4} rotulo="Carregando as mensagens da semana" />
        : erro ? <EstadoDeErro titulo="Não foi possível ler as mensagens." descricao={(erro as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void atualizar()}>Tentar de novo</button>} />
          : mensagens.length === 0 ? <EstadoVazio titulo="Nenhuma mensagem esperando você esta semana." descricao="Quando um ritual ficar pronto, ele aparece aqui." />
            : SECOES.map((s, i) => {
              const daSecao = mensagens.filter((m) => s.situacoes.indexOf(m.situacao) >= 0);
              if (!daSecao.length) return null;
              return (
                <Secao key={s.chave} titulo={s.titulo} descricao={`${daSecao.length}`} recolher={`mensagens-semana:${s.chave}`} recolhidaDeInicio={s.chave === "aprovada"} divisoria={i > 0}>
                  <ul className="min-w-0 max-w-3xl divide-y divide-border/60" aria-label={s.titulo}>
                    {daSecao.map((m) => {
                      const valor = textoDe(m);
                      const editado = valor.trim() !== (m.report.summary || "").trim();
                      const agindo = ocupado[m.chave];
                      const urgente = m.situacao === "pronta" && !!m.venceEm && Date.parse(m.venceEm) - agora < 6 * 3_600_000;
                      const decide = m.situacao !== "aprovada";
                      const estaAberta = decide && m.chave === aberta;
                      const nomeCliente = nomes.get(m.clientId) || "Cliente";
                      return (
                        <li key={m.chave} className="min-w-0 py-2.5" data-mensagem={m.situacao} data-aberta={estaAberta ? "" : undefined}>
                          <button
                            type="button"
                            onClick={() => { if (decide) setAbertaEscolhida(estaAberta ? FECHADAS : m.chave); }}
                            aria-expanded={decide ? estaAberta : undefined}
                            className="flex w-full min-w-0 items-center rounded-md text-left"
                          >
                            {decide && <ChevronDown className={juntar("mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !estaAberta && "-rotate-90")} aria-hidden="true" />}
                            <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                              <span className="font-medium">{nomeCliente}</span>
                              <span className="text-muted-foreground"> · {NOME_DO_RITUAL[m.ritual] || m.report.title}</span>
                            </span>
                            <span className="ml-2 shrink-0 text-muted-foreground" title={m.canal === "whatsapp" ? `WhatsApp · ${m.destinatario}` : "Portal do cliente"} aria-label={m.canal === "whatsapp" ? "WhatsApp" : "Portal"}>
                              {m.canal === "whatsapp" ? <MessageCircle className="h-4 w-4" /> : <MonitorSmartphone className="h-4 w-4" />}
                            </span>
                            {decide && <span className={juntar(etiqueta, "ml-2 shrink-0", m.situacao === "venceu" ? "bg-destructive/10 text-destructive" : urgente ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")} data-prazo="">{prazoEmPalavras(m.venceEm, agora)}</span>}
                          </button>
                          {!decide ? (
                            <p className={juntar(texto.auxiliar, "mt-1 line-clamp-2 whitespace-pre-wrap pl-5")}>{m.report.summary}</p>
                          ) : !estaAberta ? (
                            <p className={juntar(texto.auxiliar, "mt-0.5 truncate pl-5")}>{valor.replace(/\s+/g, " ")}</p>
                          ) : (
                            <div className="mt-2 min-w-0 pl-5">
                              <label className="sr-only" htmlFor={`texto-${m.chave}`}>Texto da mensagem para {nomeCliente}</label>
                              <textarea id={`texto-${m.chave}`} value={valor} onChange={(e) => setTextos((x) => ({ ...x, [m.chave]: e.target.value }))} rows={6} className={campoTexto} disabled={!!agindo} />
                              {pedindoAjuste === m.chave && (
                                <div className="mt-2 flex min-w-0 items-center">
                                  <label className="sr-only" htmlFor={`ajuste-${m.chave}`}>Pedir ajuste ao agente</label>
                                  <input id={`ajuste-${m.chave}`} autoFocus value={ajustes[m.chave] || ""} onChange={(e) => setAjustes((x) => ({ ...x, [m.chave]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") void ajustar(m); }} placeholder="Ex.: mais curto, cite o novo criativo" className={juntar(campo, "min-w-0 flex-1")} disabled={!!agindo} />
                                  <button type="button" onClick={() => void ajustar(m)} disabled={!!agindo || !(ajustes[m.chave] || "").trim()} className={juntar(botao.icone, "ml-1")} title="Enviar o pedido de ajuste ao agente da Central" aria-label="Enviar o pedido de ajuste">
                                    {agindo === "ajustar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CornerDownLeft className="h-4 w-4" aria-hidden="true" />}
                                  </button>
                                </div>
                              )}
                              <div className="mt-2 flex min-w-0 flex-wrap items-center">
                                <button type="button" onClick={() => void aprovar(m)} disabled={!!agindo || !!emLote || !valor.trim()} className={juntar(botao.primario, "mr-1")}>
                                  {agindo === "aprovar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                                  Aprovar e enviar
                                </button>
                                <button type="button" onClick={() => setPedindoAjuste(pedindoAjuste === m.chave ? null : m.chave)} disabled={!!agindo} className={botao.icone} title="Pedir ajuste ao agente" aria-label="Pedir ajuste ao agente" aria-pressed={pedindoAjuste === m.chave}>
                                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <button type="button" onClick={() => void pular(m)} disabled={!!agindo || !!emLote} className={botao.icone} title={m.situacao === "pronta" ? "Pular: registra que esta mensagem não vai" : "Pular: tira da lista"} aria-label="Pular">
                                  {agindo === "pular" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <SkipForward className="h-4 w-4" aria-hidden="true" />}
                                </button>
                                {editado && <button type="button" onClick={() => setTextos((x) => { const y = { ...x }; delete y[m.chave]; return y; })} className={botao.icone} title="Voltar ao texto original (editada: ao aprovar, vira uma nova versão)" aria-label="Voltar ao texto original"><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>}
                                {editado && <span className={juntar(texto.auxiliar, "ml-1")}>editada</span>}
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Secao>
              );
            })}
    </div>
  );
}
