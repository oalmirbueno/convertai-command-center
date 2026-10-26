import { useMemo, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, CheckCheck, Clock, CornerDownLeft, Loader2, MessageCircle, MonitorSmartphone, Pencil, RefreshCw, RotateCcw, Send, SkipForward, Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useCentralReviews } from "@/hooks/useCentralReviews";
import { useRascunhosDaSemana } from "@/hooks/useMensagensDaSemana";
import { centralReviewError } from "@/lib/centralReview";
import { NOME_DO_RITUAL, aprovarEEnviar, montarMensagens, prazoEmPalavras, pularMensagem, type MensagemDaSemana } from "@/lib/mensagensDaSemana";
import { reescreverRitual } from "@/components/central/agenteCentralApi";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import MensagensAutomaticas from "@/components/central/MensagensAutomaticas";
import {
  BotaoComIcone,
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  JanelaCentral,
  Secao,
  botao,
  campo,
  campoTexto,
  espaco,
  etiqueta,
  juntar,
  larguraDaMesa,
  superficie,
  texto,
} from "@/components/sistema";

/*
 * Mensagens da semana (26/10/2026): todas as mensagens prontas dos rituais de
 * segunda, quarta e sexta, de todos os clientes, numa tela só. O dono edita o
 * texto (ou pede o ajuste ao agente da Central), aprova uma a uma ou todas, ou
 * pula. Nada sai sem ele. O fluxo de aprovação e envio é o da Central
 * (src/lib/mensagensDaSemana.ts).
 *
 * Redesenho da tarde (dono: "bagunçada; tudo intuitivo, alinhadinho"): um
 * cartão por mensagem numa grade alinhada, a prévia como balão de WhatsApp, a
 * situação por cor e ícone (para aprovar / vencida / aprovada), UMA ação
 * principal (Aprovar e enviar) e a edição numa janela no centro.
 */

const SECOES: Array<{ chave: string; situacoes: Array<MensagemDaSemana["situacao"]>; titulo: string }> = [
  { chave: "pronta", situacoes: ["pronta", "venceu"], titulo: "Para aprovar" },
  { chave: "aprovada", situacoes: ["aprovada"], titulo: "Aprovadas, o Hermes envia" },
];

/** Cartões por vez (o resto entra com "Mostrar mais"). */
const POR_PAGINA = 12;

type Ocupado = "aprovar" | "pular" | "ajustar";

function Situacao({ m, agora }: { m: MensagemDaSemana; agora: number }) {
  if (m.situacao === "aprovada") return <span className={juntar(etiqueta, "bg-success/10 text-success")} data-prazo=""><CheckCheck className="mr-1 h-3 w-3" aria-hidden="true" />aprovada</span>;
  if (m.situacao === "venceu") return <span className={juntar(etiqueta, "bg-destructive/10 text-destructive")} data-prazo=""><AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />{prazoEmPalavras(m.venceEm, agora)}</span>;
  const urgente = !!m.venceEm && Date.parse(m.venceEm) - agora < 6 * 3_600_000;
  return <span className={juntar(etiqueta, urgente ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")} data-prazo=""><Clock className="mr-1 h-3 w-3" aria-hidden="true" />{prazoEmPalavras(m.venceEm, agora)}</span>;
}

/** A prévia como o cliente vê: balão de WhatsApp (ou do portal) com a hora. */
function Balao({ texto: corpo, canal, hora, editada, linhas = 6 }: { texto: string; canal: MensagemDaSemana["canal"]; hora: string; editada?: boolean; linhas?: 6 | 4 }) {
  const whatsapp = canal === "whatsapp";
  return (
    <div className={juntar("min-w-0 rounded-md px-3 py-3", whatsapp ? "bg-[#efeae2] dark:bg-[#0b141a]" : "bg-muted/50")} data-balao={canal}>
      <div className={juntar("relative ml-auto min-w-0 max-w-[92%] rounded-md rounded-tr-none px-2.5 pb-1.5 pt-2 shadow-sm", whatsapp ? "bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]" : "bg-card text-foreground")}>
        <p className={juntar("whitespace-pre-wrap text-[13px] leading-5 [overflow-wrap:anywhere]", linhas === 6 ? "line-clamp-6" : "line-clamp-4")}>{corpo || "Sem texto"}</p>
        <p className="mt-0.5 flex items-center justify-end text-[11px] leading-4 opacity-60">
          {editada && <span className="mr-1.5">editada ·</span>}
          {hora}
          {whatsapp && <CheckCheck className="ml-1 h-3 w-3" aria-hidden="true" />}
        </p>
      </div>
    </div>
  );
}

const horaDe = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
};

export default function MensagensDaSemana() {
  const { user, profile } = useAuth();
  const eAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const pedidos = useCentralReviews(eAdmin, null);
  const rascunhos = useRascunhosDaSemana(eAdmin);
  const identidades = useIdentidadesDosClientes();
  const { data: clientes = [] } = useClients();
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<Record<string, Ocupado>>({});
  const [escondidas, setEscondidas] = useState<string[]>([]);
  const [confirmarTodas, setConfirmarTodas] = useState(false);
  const [emLote, setEmLote] = useState<{ feitas: number; total: number } | null>(null);
  /** A mensagem aberta na janela de edição. */
  const [editando, setEditando] = useState<string | null>(null);
  const [paginas, setPaginas] = useState<Record<string, number>>({});

  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clientes as Array<{ id: string; company_name?: string | null; full_name?: string | null }>) m.set(String(c.id), c.company_name || c.full_name || "Cliente");
    return m;
  }, [clientes]);
  const agora = Date.now();
  const mensagens = useMemo(
    // A ordem de montarMensagens: prontas pelo prazo (o que vence antes vem antes), depois vencidas e aprovadas.
    () => montarMensagens(rascunhos.data ?? [], pedidos.data ?? [], Date.now()).filter((m) => escondidas.indexOf(m.chave) < 0),
    [rascunhos.data, pedidos.data, escondidas],
  );
  const prontas = mensagens.filter((m) => m.situacao !== "aprovada");
  const aberta = editando ? mensagens.find((m) => m.chave === editando) || null : null;

  if (profile && !eAdmin) return <Navigate to="/central" replace />;

  const textoDe = (m: MensagemDaSemana) => (textos[m.chave] !== undefined ? textos[m.chave] : m.report.summary || "");
  const editada = (m: MensagemDaSemana) => textoDe(m).trim() !== (m.report.summary || "").trim();
  const nomeDe = (m: MensagemDaSemana) => nomes.get(m.clientId) || "Cliente";
  const atualizar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["central-review-approvals"] }),
      queryClient.invalidateQueries({ queryKey: ["mensagens-da-semana"] }),
    ]);
  };
  const marcar = (m: MensagemDaSemana, o: Ocupado | null) =>
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
      if (editando === m.chave) setEditando(null);
      return true;
    } catch (e) {
      toast.error(`${nomeDe(m)}: ${centralReviewError(e)}`);
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
      if (editando === m.chave) setEditando(null);
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

  const botaoAprovar = (m: MensagemDaSemana, classe = "") => {
    const agindo = ocupado[m.chave];
    return (
      <button type="button" onClick={() => void aprovar(m)} disabled={!!agindo || !!emLote || !textoDe(m).trim()} className={juntar(botao.primario, "h-8", classe)} aria-label={`Aprovar e enviar a mensagem de ${nomeDe(m)}`}>
        {agindo === "aprovar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}
        Aprovar e enviar
      </button>
    );
  };
  const botaoPular = (m: MensagemDaSemana) => {
    const agindo = ocupado[m.chave];
    return (
      <button type="button" onClick={() => void pular(m)} disabled={!!agindo || !!emLote} className={botao.icone} title={m.situacao === "pronta" ? "Pular: registra que esta mensagem não vai" : "Pular: tira da lista"} aria-label={`Pular a mensagem de ${nomeDe(m)}`}>
        {agindo === "pular" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <SkipForward className="h-4 w-4" aria-hidden="true" />}
      </button>
    );
  };

  const cartao = (m: MensagemDaSemana): ReactNode => {
    const decide = m.situacao !== "aprovada";
    const nomeCliente = nomeDe(m);
    return (
      <li key={m.chave} className={juntar(superficie.painel, "flex min-w-0 flex-col p-4")} data-mensagem={m.situacao}>
        <div className="flex min-w-0 items-center">
          <LogoDoCliente url={identidades.data?.get(m.clientId)?.profile_picture_url ?? null} nome={nomeCliente} tamanho={32} className="mr-2.5" />
          <div className="min-w-0 flex-1">
            <p className={juntar(texto.corpo, "truncate font-medium")}>{nomeCliente}</p>
            <p className={juntar(texto.auxiliar, "truncate")}>{NOME_DO_RITUAL[m.ritual] || m.report.title}</p>
          </div>
          <span className="ml-2 shrink-0 text-muted-foreground" title={m.canal === "whatsapp" ? `WhatsApp · ${m.destinatario}` : "Portal do cliente"} aria-label={m.canal === "whatsapp" ? "WhatsApp" : "Portal"}>
            {m.canal === "whatsapp" ? <MessageCircle className="h-4 w-4" /> : <MonitorSmartphone className="h-4 w-4" />}
          </span>
        </div>
        <div className="mt-3 flex min-w-0 items-center">
          <Situacao m={m} agora={agora} />
          {m.canal === "whatsapp" && <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>{m.destinatario}</span>}
        </div>
        <div className="mt-3 min-w-0">
          <Balao texto={decide ? textoDe(m) : m.report.summary || ""} canal={m.canal} hora={horaDe(m.report.created_at)} editada={decide && editada(m)} linhas={decide ? 6 : 4} />
        </div>
        {decide && (
          <div className="mt-auto flex min-w-0 items-center pt-3">
            {botaoAprovar(m, "mr-1")}
            <button type="button" onClick={() => setEditando(m.chave)} disabled={!!ocupado[m.chave]} className={juntar(botao.icone, "ml-auto")} title="Editar o texto ou pedir ajuste ao agente" aria-label={`Editar a mensagem de ${nomeCliente}`}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
            {botaoPular(m)}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-mensagens-da-semana="">
      <CabecalhoDePagina
        titulo="Mensagens da semana"
        descricao={`${mensagens.filter((m) => m.situacao === "pronta").length} prontas${vencidas ? ` · ${vencidas} ${vencidas === 1 ? "vencida" : "vencidas"}` : ""}`}
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
          : mensagens.length === 0 ? <EstadoVazio icone={<CheckCheck className="h-5 w-5" />} titulo="Nenhuma mensagem esperando você esta semana." descricao="Quando um ritual ficar pronto, ele aparece aqui." />
            : SECOES.map((s) => {
              const daSecao = mensagens.filter((m) => s.situacoes.indexOf(m.situacao) >= 0);
              if (!daSecao.length) return null;
              const pagina = paginas[s.chave] || 1;
              const visiveis = daSecao.slice(0, pagina * POR_PAGINA);
              return (
                <Secao key={s.chave} titulo={s.titulo} descricao={`${daSecao.length}`} recolher={`mensagens-semana:${s.chave}`} recolhidaDeInicio={s.chave === "aprovada"}>
                  <ul className={juntar(espaco.grade, "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4")} aria-label={s.titulo}>
                    {visiveis.map(cartao)}
                  </ul>
                  {daSecao.length > visiveis.length && (
                    <button type="button" onClick={() => setPaginas((x) => ({ ...x, [s.chave]: pagina + 1 }))} className={juntar(botao.discreto, "relative -left-3 mt-2")}>
                      Mostrar mais {Math.min(POR_PAGINA, daSecao.length - visiveis.length)}
                    </button>
                  )}
                </Secao>
              );
            })}

      {/* Cobranças (D+1, D+5, D+10) e o lembrete de aprovação: mesmo rito, o dono aprova e o Hermes envia. */}
      <MensagensAutomaticas />

      <JanelaCentral
        aberta={!!aberta}
        onMudar={(v) => { if (!v) setEditando(null); }}
        titulo={aberta ? nomeDe(aberta) : "Mensagem"}
        descricao={aberta ? NOME_DO_RITUAL[aberta.ritual] || aberta.report.title : undefined}
        icone={<Pencil className="h-4 w-4" />}
        largura="md"
        rodape={aberta ? (
          <div className="flex min-w-0 items-center">
            {botaoAprovar(aberta)}
            {editada(aberta) && <button type="button" onClick={() => setTextos((x) => { const y = { ...x }; delete y[aberta.chave]; return y; })} className={juntar(botao.icone, "ml-1")} title="Voltar ao texto original (editada: ao aprovar, vira uma nova versão)" aria-label="Voltar ao texto original"><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>}
            <span className="ml-auto">{botaoPular(aberta)}</span>
          </div>
        ) : undefined}
      >
        {aberta && (
          <div className="min-w-0 space-y-3" data-edicao="">
            <div className="flex min-w-0 items-center">
              <Situacao m={aberta} agora={agora} />
              <span className={juntar(texto.auxiliar, "ml-2 min-w-0 truncate")}>{aberta.canal === "whatsapp" ? `WhatsApp · ${aberta.destinatario}` : "Portal do cliente"}</span>
            </div>
            <div>
              <label className={juntar(texto.rotulo, "mb-1 block")} htmlFor={`texto-${aberta.chave}`}>Texto da mensagem para {nomeDe(aberta)}</label>
              <textarea id={`texto-${aberta.chave}`} value={textoDe(aberta)} onChange={(e) => setTextos((x) => ({ ...x, [aberta.chave]: e.target.value }))} rows={8} className={campoTexto} disabled={!!ocupado[aberta.chave]} />
            </div>
            <div>
              <label className={juntar(texto.rotulo, "mb-1 flex items-center")} htmlFor={`ajuste-${aberta.chave}`}><Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" aria-hidden="true" />Pedir ajuste ao agente</label>
              <div className="flex min-w-0 items-center">
                <input id={`ajuste-${aberta.chave}`} value={ajustes[aberta.chave] || ""} onChange={(e) => setAjustes((x) => ({ ...x, [aberta.chave]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") void ajustar(aberta); }} placeholder="Ex.: mais curto, cite o novo criativo" className={juntar(campo, "min-w-0 flex-1")} disabled={!!ocupado[aberta.chave]} />
                <button type="button" onClick={() => void ajustar(aberta)} disabled={!!ocupado[aberta.chave] || !(ajustes[aberta.chave] || "").trim()} className={juntar(botao.icone, "ml-1")} title="Enviar o pedido de ajuste ao agente da Central" aria-label="Enviar o pedido de ajuste">
                  {ocupado[aberta.chave] === "ajustar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CornerDownLeft className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div>
              <p className={juntar(texto.rotulo, "mb-1")}>Como o cliente vê</p>
              <Balao texto={textoDe(aberta)} canal={aberta.canal} hora={horaDe(aberta.report.created_at)} editada={editada(aberta)} />
            </div>
          </div>
        )}
      </JanelaCentral>
    </div>
  );
}
