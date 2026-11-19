import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArrowLeft, CalendarPlus, CheckSquare, FileText, Inbox, Paperclip, RefreshCw, Reply, Send, ShieldAlert, Trash2 } from "lucide-react";
import { diaLegivel, fraseDoErro } from "@/lib/produto/api";
import { correio, correioDesligado, type CaixaDoCorreio } from "@/lib/produto/email-central";
import { GRUPOS, agruparCaixa, criarTarefa, iniciais, type EuNoCorreio, type MensagemDaCaixa } from "@/lib/produto/correio-dia";
import { CampoDeBusca, Carregando, EstadoDeErro, EstadoVazio, botao, etiqueta, foco, juntar, texto } from "@/components/sistema";
import { NovoCompromisso, chaveDasTarefas } from "./PainelDoDia";
import CorpoDoEmail from "./CorpoDoEmail";

/** Uma cor suave por remetente (sempre a mesma para a mesma pessoa): a lista ganha vida sem virar carnaval. */
const CORES_DE_PESSOA = [
  ["#D9F7E6", "#0B5134"], ["#FFE4D6", "#8A3A12"], ["#E6E0FF", "#3F2D8C"], ["#D8ECFF", "#124A82"],
  ["#FFF2C4", "#6E5100"], ["#FFDCE7", "#8C1D45"], ["#D6F5F2", "#0C5A54"], ["#EDE3D6", "#5B4120"],
] as const;
export function corDaPessoa(texto: string): { background: string; color: string } {
  let h = 0;
  for (const ch of String(texto || "").toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [background, color] = CORES_DE_PESSOA[h % CORES_DE_PESSOA.length];
  return { background, color };
}

const cartao = "min-w-0 rounded-3xl bg-card";
const acao = juntar("inline-flex h-9 items-center rounded-full border border-border bg-card px-3.5 text-[13px] font-medium hover:bg-muted", foco);
const POR_PAGINA = 30;

/** O webmail de cada provedor, para quando a caixa ainda não está ligada ao painel. */
const WEBMAIL: Record<string, string> = { migadu: "https://webmail.migadu.com", zoho: "https://mail.zoho.com", google: "https://mail.google.com" };

/** O que aparece em vez da lista quando a caixa ainda não tem provedor ligado. */
export function CaixaEmPreparo({ caixa }: { caixa: CaixaDoCorreio }) {
  const webmail = WEBMAIL[caixa.provedor] || "";
  return (
    <div className={juntar(cartao, "p-6")} data-correio-em-preparo="">
      <EstadoVazio
        icone={<Inbox className="h-5 w-5" aria-hidden="true" />}
        titulo={`${caixa.endereco} ainda não está ligada ao painel`}
        descricao="Quem administra a empresa conecta a caixa uma vez, com a senha dela. Enquanto isso, o e-mail continua funcionando no webmail, com o mesmo endereço e senha."
        acao={webmail ? <a href={webmail} target="_blank" rel="noreferrer" className={botao.primario}>Abrir o webmail</a> : undefined}
      />
    </div>
  );
}

/** Nome da pasta como a pessoa entende, e o ícone dela. */
export function nomeDaPasta(id: string): { nome: string; icone: typeof Inbox; ordem: number } {
  const n = id.toLowerCase();
  if (n === "inbox") return { nome: "Entrada", icone: Inbox, ordem: 0 };
  if (/^(sent|enviad|itens enviados)/.test(n)) return { nome: "Enviados", icone: Send, ordem: 1 };
  if (/draft|rascunho/.test(n)) return { nome: "Rascunhos", icone: FileText, ordem: 2 };
  if (/arquivo|archive/.test(n)) return { nome: id === "Arquivo do Gmail" ? "Arquivo do Gmail" : "Arquivo", icone: Archive, ordem: 3 };
  if (/junk|spam/.test(n)) return { nome: "Spam", icone: ShieldAlert, ordem: 8 };
  if (/trash|lixeira|deleted/.test(n)) return { nome: "Lixeira", icone: Trash2, ordem: 9 };
  return { nome: id, icone: FileText, ordem: 5 };
}

/** O endereço puro de "Fulano <fulano@x.com>" (é o que o envio aceita). */
export function enderecoDe(de: string): string {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(de || "");
  if (m) return m[1].toLowerCase();
  const solto = /([^\s<>"]+@[^\s<>"]+\.[^\s<>"]+)/.exec(de || "");
  return solto ? solto[1].toLowerCase() : "";
}

/** "Fulano <fulano@x.com>" vira "Fulano"; só o endereço fica como está. */
const nomeDe = (de: string) => (de || "").replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || enderecoDe(de) || "Sem remetente";

/**
 * A caixa do correio: pastas à esquerda, a lista no meio (na Entrada, separada por prioridade) e a
 * mensagem à direita, com responder, marcar reunião e virar tarefa. No celular, uma coisa de cada vez.
 */
export default function CaixaPorPrioridade({ caixa, eu }: { caixa: CaixaDoCorreio; eu: EuNoCorreio | null }) {
  const qc = useQueryClient();
  const [pasta, setPasta] = useState("INBOX");
  const [busca, setBusca] = useState("");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [marcando, setMarcando] = useState(false);

  const pastas = useQuery({ queryKey: ["produto", "correio", "pastas", caixa.id], queryFn: () => correio.pastas(caixa.id), enabled: caixa.ligado, retry: 1, staleTime: 60_000 });
  const mensagens = useInfiniteQuery({
    queryKey: ["produto", "correio", "mensagens", caixa.id, pasta, busca],
    queryFn: ({ pageParam }) => correio.listar(caixa.id, pasta, busca || undefined, pageParam as number) as Promise<MensagemDaCaixa[]>,
    initialPageParam: 1,
    getNextPageParam: (ultima, todas) => (ultima.length >= POR_PAGINA ? todas.length + 1 : undefined),
    enabled: caixa.ligado,
    retry: 1,
  });
  const lista = useMemo(() => (mensagens.data ? mensagens.data.pages.flat() : []), [mensagens.data]);
  const naEntrada = pasta === "INBOX" && !busca;
  const grupos = useMemo(() => agruparCaixa(lista), [lista]);
  const aberta = lista.filter((m) => m.id === abertaId)[0] || null;
  const lida = useQuery({ queryKey: ["produto", "correio", "mensagem", caixa.id, pasta, aberta ? aberta.id : ""], queryFn: () => correio.ler(caixa.id, pasta, aberta!.id), enabled: caixa.ligado && !!aberta, retry: 1 });
  const emPreparo = !caixa.ligado || (mensagens.isError && correioDesligado(mensagens.error));

  useEffect(() => {
    setAbertaId(null);
    setResposta("");
  }, [pasta, caixa.id]);

  const listaDePastas = useMemo(
    () => (pastas.data || [{ id: "INBOX", nome: "Entrada", nao_lidas: 0 }]).map((p) => ({ ...p, ...nomeDaPasta(p.id) })).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome)),
    [pastas.data],
  );

  if (emPreparo) return <CaixaEmPreparo caixa={caixa} />;

  const abrir = (id: string) => {
    setAbertaId(id);
    setResposta("");
  };
  const virarTarefa = async () => {
    if (!eu || !aberta) return;
    try {
      await criarTarefa(eu, { titulo: aberta.assunto, origem: `Do e-mail de ${nomeDe(aberta.de)}`, caixa_id: caixa.id, mensagem_ref: aberta.id });
      await qc.invalidateQueries({ queryKey: chaveDasTarefas });
      toast.success("Virou tarefa do seu dia.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível criar a tarefa."));
    }
  };
  const enviar = async () => {
    if (!aberta || !resposta.trim()) return;
    const para = enderecoDe(aberta.de);
    if (!para) return void toast.error("Não achei o endereço de quem mandou.");
    setEnviando(true);
    try {
      await correio.enviar(caixa.id, { para, assunto: /^re:/i.test(aberta.assunto) ? aberta.assunto : `Re: ${aberta.assunto}`, texto: resposta, em_resposta_a: aberta.mensagem_id || null });
      setResposta("");
      toast.success(`Resposta enviada para ${para}.`);
      void qc.invalidateQueries({ queryKey: ["produto", "correio", "pastas", caixa.id] });
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível enviar."));
    } finally {
      setEnviando(false);
    }
  };

  const pastaAtual = nomeDaPasta(pasta);
  const naoLidasAqui = (listaDePastas.find((p) => p.id === pasta) || { nao_lidas: 0 }).nao_lidas;
  const altura = "lg:h-[calc(100dvh-112px)]";

  return (
    <div className={juntar("grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[208px_minmax(300px,400px)_minmax(0,1fr)]", altura)} data-caixa-por-prioridade="">
      {/* Pastas */}
      <nav className={juntar("correio-pastas correio-rolagem min-w-0 rounded-3xl p-2 lg:overflow-y-auto", aberta && "max-lg:hidden")} aria-label="Pastas">
        <p className="hidden px-3 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] opacity-60 lg:block">Pastas</p>
        <ul className="flex min-w-0 [&>*]:mr-1 [&>*:last-child]:mr-0 overflow-x-auto lg:flex-col lg:overflow-visible" data-pastas-do-correio="">
          {listaDePastas.map((p) => {
            const Icone = p.icone;
            const ativa = p.id === pasta;
            return (
              <li key={p.id} className="shrink-0">
                <button type="button" onClick={() => setPasta(p.id)} aria-current={ativa ? "page" : undefined} className={juntar("flex h-10 w-full min-w-0 items-center rounded-2xl px-3 text-left text-[14px]", foco)} data-pasta={p.id}>
                  <Icone className="mr-2.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{p.nome}</span>
                  {p.nao_lidas > 0 && <span className="correio-contador ml-2 rounded-full px-1.5 text-[11px] font-semibold tabular-nums">{p.nao_lidas}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Lista */}
      <section className={juntar(cartao, "flex min-h-0 flex-col", aberta && "max-lg:hidden")} aria-label="Mensagens">
        <div className="border-b border-border p-4">
          <div className="flex min-w-0 items-center">
            <h1 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>{pastaAtual.nome}</h1>
            {naoLidasAqui > 0 && <span className={juntar(etiqueta, "mr-1 bg-accent-soft text-primary")}>{naoLidasAqui} não lidas</span>}
            <button type="button" className={botao.icone} onClick={() => { void mensagens.refetch(); void pastas.refetch(); }} aria-label="Atualizar" title="Atualizar" data-atualizar-caixa="">
              <RefreshCw className={juntar("h-4 w-4", mensagens.isFetching && "animate-spin")} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-3">
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder={`Buscar em ${pastaAtual.nome}`} rotulo={`Buscar em ${pastaAtual.nome}`} />
          </div>
        </div>
        <div className="correio-rolagem min-h-0 flex-1 overflow-y-auto p-2" data-lista-do-correio="">
          {mensagens.isLoading ? (
            <div className="p-3"><Carregando linhas={7} rotulo="Lendo a caixa" /></div>
          ) : mensagens.isError ? (
            <div className="p-3"><EstadoDeErro titulo={fraseDoErro(mensagens.error, "Não foi possível ler a caixa agora.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void mensagens.refetch()}>Tentar de novo</button>} /></div>
          ) : !lista.length ? (
            <div className="p-3"><EstadoVazio compacto titulo={busca ? "Nada encontrado." : `${pastaAtual.nome} vazia.`} /></div>
          ) : naEntrada ? (
            GRUPOS.map((g) => <Grupo key={g.id} nome={g.nome} porque={g.porque} ponto={g.ponto} itens={grupos[g.id]} abertaId={abertaId} aoAbrir={abrir} />)
          ) : (
            <div className="space-y-1">{lista.map((m) => <Linha key={m.id} m={m} aberta={m.id === abertaId} aoAbrir={abrir} enviados={pastaAtual.nome === "Enviados"} />)}</div>
          )}
          {mensagens.hasNextPage && (
            <div className="p-2">
              <button type="button" className={juntar(botao.secundario, "w-full")} onClick={() => void mensagens.fetchNextPage()} disabled={mensagens.isFetchingNextPage} data-carregar-mais="">
                {mensagens.isFetchingNextPage ? "Carregando..." : "Carregar mais antigas"}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Leitura */}
      <article className={juntar(cartao, "flex min-h-0 flex-col", !aberta && "max-lg:hidden")} aria-label="Mensagem aberta" data-leitura-do-correio="">
        {!aberta ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EstadoVazio icone={<Inbox className="h-5 w-5" aria-hidden="true" />} titulo="Escolha uma mensagem" descricao="Ela abre aqui, com responder, marcar reunião e virar tarefa." />
          </div>
        ) : (
          <div className="correio-rolagem min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            <button type="button" className={juntar(botao.discreto, "mb-3 h-9 lg:hidden")} onClick={() => setAbertaId(null)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {pastaAtual.nome}
            </button>
            <h2 className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">{aberta.assunto}</h2>
            <div className="mt-4 flex min-w-0 items-center">
              <span className="mr-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[14px] font-semibold" style={corDaPessoa(enderecoDe(aberta.de))} aria-hidden="true">{iniciais(aberta.de)}</span>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-semibold")}>{nomeDe(aberta.de)}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{enderecoDe(aberta.de)} para {aberta.para || caixa.endereco}</span>
              </span>
              {aberta.recebida_em && <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{diaLegivel(aberta.recebida_em, true)}</span>}
            </div>
            <div className="mt-4 flex min-w-0 flex-wrap [&>*]:mb-2 [&>*]:mr-2">
              <a href="#resposta-do-correio" className={acao}><Reply className="mr-2 h-4 w-4" aria-hidden="true" />Responder</a>
              {eu && <button type="button" className={acao} onClick={() => setMarcando(true)} data-marcar-reuniao=""><CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />Marcar reunião</button>}
              {eu && <button type="button" className={acao} onClick={() => void virarTarefa()} data-virar-tarefa=""><CheckSquare className="mr-2 h-4 w-4" aria-hidden="true" />Virar tarefa</button>}
            </div>
            <div className="mt-5 border-t border-border pt-5">
              {lida.isLoading ? (
                <Carregando linhas={6} rotulo="Abrindo a mensagem" />
              ) : lida.isError || !lida.data ? (
                <EstadoDeErro titulo={fraseDoErro(lida.error, "Não foi possível abrir a mensagem.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void lida.refetch()}>Tentar de novo</button>} />
              ) : (
                <>
                  {lida.data.html ? (
                    <div data-texto-da-mensagem=""><CorpoDoEmail html={lida.data.html} titulo={aberta.assunto} /></div>
                  ) : (
                    <div className={juntar(texto.corpo, "whitespace-pre-wrap break-words text-[15px] leading-7")} data-texto-da-mensagem="">{lida.data.texto || "(mensagem sem texto)"}</div>
                  )}
                  {lida.data.anexos.length > 0 && (
                    <ul className="mt-5 flex min-w-0 flex-wrap [&>*]:mb-2 [&>*]:mr-2">
                      {lida.data.anexos.map((a, i) => (
                        <li key={`${a.nome}-${i}`} className="flex items-center rounded-2xl bg-muted px-3.5 py-2.5 text-[13px] font-medium">
                          <Paperclip className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          {a.nome}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div id="resposta-do-correio" className="mt-6 rounded-2xl border border-border p-4">
              <p className={juntar(texto.corpo, "mb-2 font-semibold")}>Responder para {enderecoDe(aberta.de) || "o remetente"}</p>
              <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} rows={5} aria-label="Sua resposta" placeholder="Escreva a resposta" className="w-full resize-y rounded-xl bg-muted p-3.5 text-[14px] leading-6 outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" data-campo-resposta="" />
              <div className="mt-3 flex justify-end">
                <button type="button" className={juntar(botao.primario, "correio-botao-forte")} onClick={() => void enviar()} disabled={!resposta.trim() || enviando} data-enviar-resposta="">
                  <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {enviando ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </article>
      {marcando && eu && aberta && <NovoCompromisso eu={eu} onFechar={() => setMarcando(false)} sugestao={{ titulo: aberta.assunto, detalhe: `Com ${nomeDe(aberta.de)}`, caixa_id: caixa.id, mensagem_ref: aberta.id }} />}
    </div>
  );
}

function Linha({ m, aberta, aoAbrir, enviados }: { m: MensagemDaCaixa; aberta: boolean; aoAbrir: (id: string) => void; enviados?: boolean }) {
  const quem = enviados ? `Para ${nomeDe(m.para)}` : nomeDe(m.de);
  return (
    <button type="button" onClick={() => aoAbrir(m.id)} aria-pressed={aberta} className={juntar("flex w-full min-w-0 items-start rounded-2xl p-3 text-left", foco, !aberta && "hover:bg-muted/70")} data-mensagem={m.id}>
      <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold" style={corDaPessoa(enderecoDe(enviados ? m.para : m.de))} aria-hidden="true">{iniciais(enviados ? m.para : m.de)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline">
          {!m.lida && <i className="correio-nao-lida mr-2 h-2 w-2 shrink-0 self-center rounded-full" aria-label="Não lida" />}
          <span className={juntar("min-w-0 flex-1 truncate text-[14px]", !m.lida ? "font-semibold" : "text-foreground")}>{quem}</span>
          {m.recebida_em && <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{diaLegivel(m.recebida_em)}</span>}
        </span>
        <span className={juntar("block truncate text-[13px]", !m.lida ? "font-medium text-foreground" : "text-muted-foreground")}>
          {m.tem_anexo && <Paperclip className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />}
          {m.assunto}
        </span>
      </span>
    </button>
  );
}

function Grupo({ nome, porque, ponto, itens, abertaId, aoAbrir }: { nome: string; porque: string; ponto: string; itens: MensagemDaCaixa[]; abertaId: string | null; aoAbrir: (id: string) => void }) {
  if (!itens.length) return null;
  return (
    <div className="min-w-0 pb-2" data-grupo-da-caixa={nome}>
      <div className="sticky top-0 z-[1] flex min-w-0 items-center bg-card px-3 pb-1.5 pt-2">
        <i className={juntar("mr-2 h-2 w-2 shrink-0 rounded-full", ponto)} aria-hidden="true" />
        <h2 className="flex-1 text-[13px] font-semibold">{nome} <span className="font-normal text-muted-foreground">{itens.length}</span></h2>
        <span className={juntar(texto.auxiliar, "truncate")}>{porque}</span>
      </div>
      <div className="space-y-1">{itens.map((m) => <Linha key={m.id} m={m} aberta={m.id === abertaId} aoAbrir={aoAbrir} />)}</div>
    </div>
  );
}
