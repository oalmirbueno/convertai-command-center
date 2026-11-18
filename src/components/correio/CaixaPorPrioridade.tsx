import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, CheckSquare, Inbox, RefreshCw, Reply, Send, Sparkles } from "lucide-react";
import { diaLegivel, fraseDoErro } from "@/lib/produto/api";
import { correio, correioDesligado, type CaixaDoCorreio } from "@/lib/produto/email-central";
import { GRUPOS, agruparCaixa, criarTarefa, iniciais, type EuNoCorreio, type GrupoDaCaixa, type MensagemDaCaixa } from "@/lib/produto/correio-dia";
import { CampoDeBusca, Carregando, EstadoDeErro, EstadoVazio, botao, etiqueta, foco, juntar, texto } from "@/components/sistema";
import { AgendaDeHoje, NovoCompromisso, TarefasDoDia, chaveDasTarefas } from "./PainelDoDia";

const cartao = "min-w-0 rounded-3xl bg-card p-5";
const acao = juntar("inline-flex h-10 items-center rounded-full border border-border px-3.5 text-[13px] font-medium hover:bg-muted", foco);

/** O que aparece em vez da lista quando a caixa ainda não tem provedor ligado. */
export function CaixaEmPreparo({ caixa }: { caixa: CaixaDoCorreio }) {
  return (
    <div className={cartao} data-correio-em-preparo="">
      <EstadoVazio
        icone={<Inbox className="h-5 w-5" aria-hidden="true" />}
        titulo={`${caixa.endereco} está em preparação`}
        descricao="A leitura e o envio por aqui entram em seguida. Suas tarefas e a sua agenda já funcionam. Enquanto isso, o e-mail continua no webmail, com o mesmo endereço e senha."
        acao={<a href="https://mail.zoho.com" target="_blank" rel="noreferrer" className={botao.primario}>Abrir o webmail</a>}
      />
    </div>
  );
}

/**
 * A caixa de entrada por prioridade: três grupos (responder hoje, acompanhar, pode esperar), a
 * mensagem aberta com as ações do dia a dia e, ao lado, a agenda e as tarefas da pessoa.
 */
export default function CaixaPorPrioridade({ caixa, eu }: { caixa: CaixaDoCorreio; eu: EuNoCorreio | null }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [marcando, setMarcando] = useState(false);
  const mensagens = useQuery({ queryKey: ["produto", "correio", "mensagens", caixa.id, busca], queryFn: () => correio.listar(caixa.id, "INBOX", busca || undefined) as Promise<MensagemDaCaixa[]>, enabled: caixa.ligado, retry: 0 });
  const lista = mensagens.data || [];
  const grupos = useMemo(() => agruparCaixa(lista), [lista]);
  const aberta = lista.filter((m) => m.id === abertaId)[0] || grupos.responder[0] || lista[0] || null;
  const lida = useQuery({ queryKey: ["produto", "correio", "mensagem", caixa.id, aberta ? aberta.id : ""], queryFn: () => correio.ler(caixa.id, "INBOX", aberta!.id), enabled: caixa.ligado && !!aberta, retry: 0 });
  const emPreparo = !caixa.ligado || (mensagens.isError && correioDesligado(mensagens.error));

  const virarTarefa = async () => {
    if (!eu || !aberta) return;
    try {
      await criarTarefa(eu, { titulo: aberta.assunto, origem: `Do e-mail de ${aberta.de}`, caixa_id: caixa.id, mensagem_ref: aberta.id });
      await qc.invalidateQueries({ queryKey: chaveDasTarefas });
      toast.success("Virou tarefa do seu dia.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível criar a tarefa."));
    }
  };
  const enviar = async () => {
    if (!aberta || !resposta.trim()) return;
    try {
      await correio.enviar(caixa.id, { para: aberta.de, assunto: /^re:/i.test(aberta.assunto) ? aberta.assunto : `Re: ${aberta.assunto}`, texto: resposta, em_resposta_a: aberta.id });
      setResposta("");
      toast.success("Enviado.");
      void mensagens.refetch();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível enviar."));
    }
  };

  const lateral = eu && (
    <aside className="flex min-w-0 flex-1 basis-[280px] flex-col space-y-4" aria-label="Seu dia">
      <AgendaDeHoje eu={eu} compacto />
      <TarefasDoDia eu={eu} compacto />
    </aside>
  );

  if (emPreparo) {
    return (
      <div className="flex min-w-0 flex-wrap items-start [&>*]:mb-4 [&>*]:mr-4" data-caixa-por-prioridade="preparo">
        <div className="min-w-0 flex-[2] basis-[420px]"><CaixaEmPreparo caixa={caixa} /></div>
        {lateral}
      </div>
    );
  }

  const total = grupos.responder.length;
  return (
    <div className="flex min-w-0 flex-wrap items-start [&>*]:mb-4 [&>*]:mr-4" data-caixa-por-prioridade="">
      <section className="flex min-w-0 flex-1 basis-[320px] flex-col space-y-3" aria-label="Mensagens">
        <div className={cartao}>
          <div className="flex min-w-0 items-center">
            <h1 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>Caixa de entrada</h1>
            <button type="button" className={botao.icone} onClick={() => void mensagens.refetch()} aria-label="Atualizar" title="Atualizar">
              <RefreshCw className={juntar("h-4 w-4", mensagens.isFetching && "animate-spin")} aria-hidden="true" />
            </button>
          </div>
          <p className={juntar(texto.auxiliar, "mb-3 mt-1")}>{total ? `${total} ${total === 1 ? "pede" : "pedem"} resposta hoje. O resto já está separado.` : "Nada pedindo resposta agora."}</p>
          <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Pessoa, assunto ou arquivo" rotulo="Buscar nesta caixa" />
        </div>
        {mensagens.isLoading ? (
          <div className={cartao}><Carregando linhas={6} rotulo="Lendo a caixa" /></div>
        ) : mensagens.isError ? (
          <div className={cartao}><EstadoDeErro titulo={fraseDoErro(mensagens.error, "Não foi possível ler a caixa agora.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void mensagens.refetch()}>Tentar de novo</button>} /></div>
        ) : !lista.length ? (
          <div className={cartao}><EstadoVazio compacto titulo="Caixa vazia." /></div>
        ) : (
          GRUPOS.map((g) => <Grupo key={g.id} id={g.id} nome={g.nome} porque={g.porque} ponto={g.ponto} itens={grupos[g.id]} abertaId={aberta ? aberta.id : null} aoAbrir={(id) => { setAbertaId(id); setResposta(""); }} />)
        )}
      </section>

      <article className={juntar(cartao, "flex-[2] basis-[460px]")} aria-label="Mensagem aberta" data-leitura-do-correio="">
        {!aberta ? (
          <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Escolha uma mensagem" />
        ) : (
          <div className="min-w-0 space-y-4">
            <div className="flex min-w-0 items-center">
              <span className="mr-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground text-[14px] font-semibold text-background" aria-hidden="true">{iniciais(aberta.de)}</span>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-semibold")}>{aberta.de}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>para {aberta.para || caixa.endereco}</span>
              </span>
              {aberta.recebida_em && <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{diaLegivel(aberta.recebida_em, true)}</span>}
            </div>
            <h2 className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">{aberta.assunto}</h2>
            <div className="flex min-w-0 flex-wrap [&>*]:mb-2 [&>*]:mr-2">
              <a href="#resposta-do-correio" className={acao}><Reply className="mr-2 h-4 w-4" aria-hidden="true" />Responder</a>
              {eu && <button type="button" className={acao} onClick={() => setMarcando(true)} data-marcar-reuniao=""><CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />Marcar reunião</button>}
              {eu && <button type="button" className={acao} onClick={() => void virarTarefa()} data-virar-tarefa=""><CheckSquare className="mr-2 h-4 w-4" aria-hidden="true" />Virar tarefa</button>}
            </div>
            {lida.isLoading ? (
              <Carregando linhas={6} rotulo="Abrindo a mensagem" />
            ) : lida.isError || !lida.data ? (
              <EstadoDeErro titulo={fraseDoErro(lida.error, "Não foi possível abrir a mensagem.")} />
            ) : (
              <>
                <div className={juntar(texto.corpo, "whitespace-pre-wrap break-words leading-7")}>{lida.data.texto}</div>
                {lida.data.anexos.length > 0 && (
                  <ul className="flex min-w-0 flex-wrap [&>*]:mb-2 [&>*]:mr-2">
                    {lida.data.anexos.map((a) => <li key={a.nome} className="rounded-2xl bg-muted px-3.5 py-2.5 text-[13px] font-medium">{a.nome}</li>)}
                  </ul>
                )}
              </>
            )}
            <div id="resposta-do-correio" className="rounded-2xl border border-border p-4">
              <div className="mb-2 flex min-w-0 items-center">
                <span className={juntar(texto.corpo, "flex-1 font-semibold")}>Responder</span>
                <span className={juntar(etiqueta, "bg-muted text-muted-foreground")} title="O copiloto resume a conversa e sugere a resposta. Entra com o plano Pro.">
                  <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
                  Copiloto em breve
                </span>
              </div>
              <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} rows={5} aria-label="Sua resposta" placeholder="Escreva a resposta" className="w-full resize-y rounded-xl bg-muted p-3.5 text-[14px] leading-6 outline-none placeholder:text-muted-foreground" />
              <div className="mt-3 flex justify-end">
                <button type="button" className={botao.primario} onClick={() => void enviar()} disabled={!resposta.trim()}>
                  <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Enviar
                </button>
              </div>
            </div>
          </div>
        )}
      </article>

      {lateral}
      {marcando && eu && aberta && <NovoCompromisso eu={eu} onFechar={() => setMarcando(false)} sugestao={{ titulo: aberta.assunto, detalhe: `Com ${aberta.de}`, caixa_id: caixa.id, mensagem_ref: aberta.id }} />}
    </div>
  );
}

function Grupo({ id, nome, porque, ponto, itens, abertaId, aoAbrir }: { id: GrupoDaCaixa; nome: string; porque: string; ponto: string; itens: MensagemDaCaixa[]; abertaId: string | null; aoAbrir: (id: string) => void }) {
  if (!itens.length) return null;
  return (
    <div className="min-w-0 space-y-2" data-grupo-da-caixa={id}>
      <div className="flex min-w-0 items-center px-2 pt-1">
        <i className={juntar("mr-2 h-2 w-2 shrink-0 rounded-full", ponto)} aria-hidden="true" />
        <h2 className={juntar(texto.corpo, "flex-1 font-semibold")}>{nome} <span className="font-normal text-muted-foreground">{itens.length}</span></h2>
        <span className={texto.auxiliar}>{porque}</span>
      </div>
      {itens.map((m) => (
        <button key={m.id} type="button" onClick={() => aoAbrir(m.id)} aria-pressed={m.id === abertaId} className={juntar("flex w-full min-w-0 items-start rounded-2xl bg-card p-3.5 text-left hover:bg-muted/60", foco, m.id === abertaId && "ring-2 ring-foreground")}>
          <span className={juntar("mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", m.id === abertaId ? "bg-foreground text-background" : "bg-muted")} aria-hidden="true">{iniciais(m.de)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline">
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", !m.lida && "font-semibold")}>{m.de}</span>
              {m.recebida_em && <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{diaLegivel(m.recebida_em)}</span>}
            </span>
            <span className={juntar(texto.corpo, "block truncate", !m.lida && "font-medium")}>{m.assunto}</span>
            <span className={juntar(texto.auxiliar, "block truncate")}>{m.resumo}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
