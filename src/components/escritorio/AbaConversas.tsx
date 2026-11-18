import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, Loader2, MessageSquarePlus, MessagesSquare, Users } from "lucide-react";
import { toast } from "sonner";
import { CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, JanelaCentral, botao, campo, campoTexto, etiqueta, juntar, lista, rolagem, texto } from "@/components/sistema";
import { haQuanto } from "@/lib/gruposAoVivo";
import { mensagemDoErroDoEscritorio } from "@/lib/escritorio/acessos";
import { linhasDasConversas, trecho } from "@/lib/escritorio/conversas";
import { DONO, type AgenteDoEscritorio, type Mensagem, type Sala } from "@/lib/escritorio/tipos";
import { CHAVES, donoEnviar, donoMarcarLidas, useConversa, useConversas, useSalas } from "./escritorioApi";

/**
 * Conversas do Escritório: à esquerda, com quem (ou em qual sala), o assunto,
 * o último recado e o ponto do que o dono ainda não leu; à direita, a conversa.
 * O dono escreve para um agente ou para uma sala. O resto da equipe só lê.
 * Os balões e o campo de escrever seguem o desenho da conversa do Gestor.
 */

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaCurto = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

const BALAO_DO_AGENTE = "w-fit max-w-[88%] whitespace-pre-wrap break-words rounded-[20px] rounded-tl-md bg-muted/70 px-4 py-2.5 text-[14px] leading-relaxed text-foreground sm:max-w-[78%]";
const BALAO_DO_DONO = "max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] rounded-tr-md bg-primary px-4 py-2.5 text-[14px] leading-relaxed text-primary-foreground sm:max-w-[75%]";

function Recados({ mensagens, nomeDe }: { mensagens: Mensagem[]; nomeDe: (slug: string) => string }) {
  const porId = useMemo(() => new Map(mensagens.map((m) => [m.id, m])), [mensagens]);
  let diaAnterior = "";
  return (
    <ol className="flex min-w-0 flex-col space-y-4" aria-label="Recados da conversa">
      {mensagens.map((m) => {
        const dia = diaCurto(m.created_at);
        const mudouODia = dia !== diaAnterior;
        diaAnterior = dia;
        const doDono = m.de_slug === DONO;
        const respondida = m.responde_a ? porId.get(m.responde_a) : undefined;
        return (
          <li key={m.id} className="min-w-0" data-recado={doDono ? "dono" : "agente"}>
            {mudouODia && <p className={juntar(texto.auxiliar, "mb-3 text-center")}>{dia}</p>}
            <div className={juntar("flex min-w-0 flex-col", doDono ? "items-end" : "items-start")}>
              <span className="mb-1 px-1 text-[11px] text-muted-foreground">{nomeDe(m.de_slug)} · {hora(m.created_at)}</span>
              {respondida && <span className="mb-1 max-w-[85%] truncate px-1 text-[12px] text-muted-foreground">Em resposta a {nomeDe(respondida.de_slug)}: {trecho(respondida.corpo, 70)}</span>}
              <div className={doDono ? BALAO_DO_DONO : BALAO_DO_AGENTE}>{m.corpo}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function NovaConversa({
  aberta,
  agentes,
  salas,
  aoFechar,
  aoCriar,
}: {
  aberta: boolean;
  agentes: AgenteDoEscritorio[];
  salas: Sala[];
  aoFechar: () => void;
  aoCriar: (conversaId: string) => void | Promise<void>;
}) {
  const [destino, setDestino] = useState("");
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (aberta) { setDestino(""); setAssunto(""); setCorpo(""); } }, [aberta]);

  const ativos = agentes.filter((a) => a.status === "active").sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));
  const salasAtivas = salas.filter((s) => s.ativo);
  const enviar = async () => {
    const [tipo, slug] = destino.split(":");
    if (!slug || !corpo.trim() || ocupado) return;
    setOcupado(true);
    try {
      const r = await donoEnviar({ corpo: corpo.trim(), assunto: assunto.trim() || null, para: tipo === "agente" ? slug : null, grupo: tipo === "sala" ? slug : null });
      await aoCriar(r.conversa_id);
      aoFechar();
    } catch (e) {
      toast.error(mensagemDoErroDoEscritorio(e, "Não foi possível enviar."));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={aoFechar}
      titulo="Nova conversa"
      icone={<MessageSquarePlus className="h-4 w-4" aria-hidden="true" />}
      ajuda="Você escreve como dono. Para um agente, a conversa é só com ele; para uma sala, todos os membros recebem."
      largura="md"
      rodape={
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end">
          <button type="button" className={botao.secundario} onClick={aoFechar}>Cancelar</button>
          <button type="button" className={juntar(botao.primario, "ml-2")} disabled={ocupado || !destino || !corpo.trim()} onClick={() => void enviar()}>{ocupado ? "Enviando…" : "Enviar"}</button>
        </div>
      }
    >
      <GrupoDeCampos colunas={1}>
        <CampoDeFormulario rotulo="Para" obrigatorio>
          <select className={campo} value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Escolha um agente ou uma sala</option>
            <optgroup label="Agentes">
              {ativos.map((a) => <option key={a.slug} value={`agente:${a.slug}`}>{a.display_name}</option>)}
            </optgroup>
            <optgroup label="Salas">
              {salasAtivas.map((s) => <option key={s.slug} value={`sala:${s.slug}`}>{s.nome}</option>)}
            </optgroup>
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Assunto">
          <input className={campo} value={assunto} maxLength={160} onChange={(e) => setAssunto(e.target.value)} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Mensagem" obrigatorio>
          <textarea className={campoTexto} value={corpo} maxLength={4000} onChange={(e) => setCorpo(e.target.value)} />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}

export default function AbaConversas({ agentes, admin, agora }: { agentes: AgenteDoEscritorio[]; admin: boolean; agora: number }) {
  const qc = useQueryClient();
  const q = useConversas();
  const salas = useSalas();
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [enviando, setEnviando] = useState(false);
  const conversa = useConversa(abertaId);
  const fim = useRef<HTMLDivElement>(null);

  const nomeDe = useMemo(() => {
    const nomes = new Map(agentes.map((a) => [a.slug, a.display_name]));
    return (slug: string) => (slug === DONO ? (admin ? "Você" : "Dono") : nomes.get(slug) ?? slug);
  }, [agentes, admin]);
  const linhas = useMemo(
    () => linhasDasConversas(q.data?.conversas ?? [], q.data?.mensagens ?? [], q.data?.leituras ?? [], nomeDe, salas.data?.salas ?? []),
    [q.data, salas.data, nomeDe],
  );
  const aberta = linhas.find((l) => l.id === abertaId) ?? null;
  const recados = conversa.data ?? [];
  const carregouAConversa = Boolean(abertaId) && !conversa.isLoading;
  const ultimoDeFora = [...recados].reverse().find((m) => m.de_slug !== DONO)?.id ?? null;

  // Abrir a conversa marca como lido (só o dono tem caixa de entrada aqui); recado novo com ela aberta também.
  useEffect(() => {
    if (!admin || !abertaId || !carregouAConversa) return;
    let vivo = true;
    donoMarcarLidas(abertaId)
      .then(() => { if (vivo) void qc.invalidateQueries({ queryKey: CHAVES.conversas }); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [admin, abertaId, carregouAConversa, ultimoDeFora, qc]);

  useEffect(() => { fim.current?.scrollIntoView?.({ block: "nearest" }); }, [recados.length, abertaId]);

  const abrir = (id: string | null) => { setRascunho(""); setAbertaId(id); };
  const relerTudo = (id: string) => Promise.all([qc.invalidateQueries({ queryKey: CHAVES.conversas }), qc.invalidateQueries({ queryKey: CHAVES.conversa(id) })]);
  const enviar = async () => {
    const corpo = rascunho.trim();
    if (!corpo || !abertaId || enviando) return;
    setEnviando(true);
    try {
      await donoEnviar({ corpo, conversaId: abertaId });
      setRascunho("");
      await relerTudo(abertaId);
    } catch (e) {
      toast.error(mensagemDoErroDoEscritorio(e, "Não foi possível enviar."));
    } finally {
      setEnviando(false);
    }
  };

  if (q.isLoading) return <Carregando rotulo="Lendo as conversas" linhas={6} />;
  if (q.error) return <EstadoDeErro titulo="Não foi possível ler as conversas." descricao={(q.error as Error).message} />;

  return (
    <div className="grid min-w-0 items-start gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]" data-conversas-do-escritorio="">
      <div className={juntar("min-w-0", abertaId && "hidden lg:block")}>
        <div className="mb-2 flex min-w-0 items-center">
          <h2 className={juntar(texto.tituloSecao, "mr-auto truncate")}>Conversas</h2>
          {admin && (
            <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setNovaAberta(true)}>
              <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Nova conversa
            </button>
          )}
        </div>
        {linhas.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhuma conversa ainda." descricao={admin ? "Comece uma com um agente ou com uma sala." : undefined} />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria, rolagem.longa)} aria-label="Conversas">
            {linhas.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => abrir(l.id)}
                  aria-current={l.id === abertaId ? "true" : undefined}
                  title={`Abrir a conversa com ${l.titulo}`}
                  className={juntar(lista.linha, "w-full items-start text-left", l.id === abertaId && lista.destaque)}
                >
                  <span className="mr-2.5 mt-1.5 flex h-2 w-2 shrink-0">
                    {l.naoLidas > 0 && <span className="h-2 w-2 rounded-full bg-primary" role="img" aria-label={l.naoLidas === 1 ? "1 recado não lido" : `${l.naoLidas} recados não lidos`} data-nao-lidas={l.naoLidas} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center">
                      {l.tipo === "grupo" && <Users className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Sala" />}
                      <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", l.naoLidas > 0 ? "font-semibold" : "font-medium")}>{l.titulo}</span>
                      <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{haQuanto(l.ultimaEm, agora)}</span>
                    </span>
                    {l.assunto && <span className={juntar(texto.corpo, "block truncate")}>{l.assunto}</span>}
                    {l.ultimo && <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{l.ultimo}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className={juntar("min-w-0", !abertaId && "hidden lg:block")} aria-label={aberta ? `Conversa com ${aberta.titulo}` : "Conversa"}>
        {!abertaId ? (
          <EstadoVazio icone={<MessagesSquare className="h-5 w-5" />} titulo="Escolha uma conversa." />
        ) : (
          <>
            <div className="mb-3 flex min-w-0 items-center border-b border-border pb-3">
              <button type="button" className={juntar(botao.icone, "mr-1 lg:hidden")} onClick={() => abrir(null)} aria-label="Voltar para as conversas" title="Voltar para as conversas">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className={juntar(texto.tituloSecao, "truncate")}>{aberta?.titulo ?? "Conversa"}</h2>
                {aberta?.assunto && <p className={juntar(texto.auxiliar, "truncate")}>{aberta.assunto}</p>}
              </div>
              {aberta?.tipo === "grupo" && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Sala</span>}
            </div>

            <div className={juntar(rolagem.longa, "min-w-0")}>
              {conversa.isLoading ? <Carregando rotulo="Carregando a conversa" linhas={3} />
                : conversa.error ? <EstadoDeErro titulo="Não foi possível ler a conversa." descricao={(conversa.error as Error).message} />
                : recados.length === 0 ? <EstadoVazio compacto titulo="Sem recados nesta conversa." />
                : <Recados mensagens={recados} nomeDe={nomeDe} />}
              <div ref={fim} />
            </div>

            {admin ? (
              <form className="mt-4" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
                <div className="flex items-end rounded-[26px] border border-border bg-background py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-primary/50">
                  <textarea
                    value={rascunho}
                    onChange={(e) => setRascunho(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
                    rows={1}
                    maxLength={4000}
                    placeholder={aberta?.tipo === "grupo" ? "Escreva para a sala…" : "Escreva para o agente…"}
                    aria-label="Mensagem do dono"
                    className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-5 outline-none placeholder:text-muted-foreground"
                  />
                  <button type="submit" className="ml-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40" disabled={enviando || !rascunho.trim()} aria-label="Enviar">
                    {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
              </form>
            ) : (
              <p className={juntar(texto.auxiliar, "mt-4")}>Só o dono escreve aqui. A equipe acompanha.</p>
            )}
          </>
        )}
      </section>

      {admin && (
        <NovaConversa
          aberta={novaAberta}
          agentes={agentes}
          salas={salas.data?.salas ?? []}
          aoFechar={() => setNovaAberta(false)}
          aoCriar={async (id) => { await relerTudo(id); abrir(id); }}
        />
      )}
    </div>
  );
}
