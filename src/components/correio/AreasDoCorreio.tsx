import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CalendarClock, Check, Clock, FileSignature, FolderClosed, Inbox, Link2, ListFilter, Megaphone, MessageSquareReply, Repeat2, Send, Share2, Undo2, Users, X, Zap, BellRing, BriefcaseBusiness } from "lucide-react";
import { correio, correioDesligado, enderecosColados, type CaixaDoCorreio } from "@/lib/produto/email-central";
import { COLUNAS, agruparCaixa, colunaDaMensagem, fraseDoDia, hojeEmBrasilia, listarCompromissos, listarTarefas, type ColunaDoQuadro, type EuNoCorreio, type MensagemDaCaixa } from "@/lib/produto/correio-dia";
import { diaLegivel, fraseDoErro, lerOfertas, lerPrecos, type CaixaDeEmail } from "@/lib/produto/api";
import { Carregando, EstadoDeErro, EstadoVazio, botao, etiqueta, foco, juntar, texto } from "@/components/sistema";
import { AgendaDeHoje, TarefasDoDia, chaveDaAgenda, chaveDasTarefas } from "./PainelDoDia";
import { CaixaEmPreparo, LeituraDaMensagem, categoriaDa, enderecoDe, nomeDe, useMensagensDaPasta } from "./CaixaPorPrioridade";
import LogoDoRemetente from "./LogoDoRemetente";
import TrazerEmailsAntigos from "@/components/produto/TrazerEmailsAntigos";

const cartao = "min-w-0 rounded-3xl bg-card p-5";
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Titulo({ titulo, frase, direita }: { titulo: string; frase: string; direita?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-end px-1 pt-2">
      <div className="min-w-0 flex-1">
        <h1 className={texto.tituloPagina}>{titulo}</h1>
        <p className={juntar(texto.auxiliar, "mt-1.5 max-w-[640px] leading-5")}>{frase}</p>
      </div>
      {direita}
    </div>
  );
}

// ------------------------------------------------------------------ quadro

const COR_DA_COLUNA: Record<ColunaDoQuadro, string> = {
  chegou: "hsl(212 80% 45%)",
  responder: "hsl(0 72% 51%)",
  aguardando: "hsl(36 92% 46%)",
  concluido: "hsl(152 60% 36%)",
};
const AJUDA_DA_COLUNA: Record<ColunaDoQuadro, string> = {
  chegou: "Ainda não lidas",
  responder: "Alguém espera você",
  aguardando: "Você espera alguém",
  concluido: "Lidas e resolvidas",
};

/**
 * O quadro da caixa: só as conversas de gente (aba Principal), em quatro colunas que rolam sozinhas.
 * Clicou no cartão, a mensagem abre ao lado como foi enviada, com responder. Usa a mesma lista da
 * Caixa (o cache é um só), então abrir o quadro depois da caixa é instantâneo.
 */
export function QuadroDaCaixa({ caixa, eu }: { caixa: CaixaDoCorreio; eu?: EuNoCorreio | null }) {
  const mensagens = useMensagensDaPasta(caixa, "INBOX", "");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [todas, setTodas] = useState(false);
  const emPreparo = !caixa.ligado || (mensagens.isError && correioDesligado(mensagens.error));
  const lista = useMemo(() => (mensagens.data ? mensagens.data.pages.flat() : []), [mensagens.data]);
  const doQuadro = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return lista.filter((m) => (todas || categoriaDa(m) === "principal") && (!f || `${m.assunto} ${m.de}`.toLowerCase().includes(f)));
  }, [lista, filtro, todas]);
  const porColuna = useMemo(() => {
    const g: Record<ColunaDoQuadro, MensagemDaCaixa[]> = { chegou: [], responder: [], aguardando: [], concluido: [] };
    for (const m of doQuadro) g[colunaDaMensagem(m)].push(m);
    return g;
  }, [doQuadro]);
  const aberta = lista.filter((m) => m.id === abertaId)[0] || null;

  return (
    <div className="min-w-0 space-y-4" data-quadro-da-caixa="">
      <Titulo
        titulo="Quadro da caixa"
        frase="Cada conversa é um cartão e anda sozinho: quando você responde, quando alguém responde ou quando o assunto termina. Clique para abrir."
        direita={
          <div className="mt-3 flex min-w-0 items-center [&>*]:ml-2">
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar cartões" aria-label="Filtrar cartões" className="h-10 w-[200px] rounded-full border border-border bg-card px-4 text-[14px] outline-none focus:ring-2 focus:ring-ring" data-filtro-do-quadro="" />
            <button type="button" onClick={() => setTodas((v) => !v)} aria-pressed={todas} className={juntar("inline-flex h-10 items-center rounded-full border px-4 text-[13px] font-medium", foco, todas ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")} data-quadro-todas="">
              <ListFilter className="mr-2 h-4 w-4" aria-hidden="true" />
              {todas ? "Todas as abas" : "Só Principal"}
            </button>
          </div>
        }
      />
      {emPreparo ? (
        <CaixaEmPreparo caixa={caixa} />
      ) : mensagens.isLoading ? (
        <div className={cartao}><Carregando linhas={5} rotulo="Montando o quadro" /></div>
      ) : mensagens.isError ? (
        <div className={cartao}><EstadoDeErro titulo={fraseDoErro(mensagens.error, "Não foi possível ler a caixa agora.")} acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void mensagens.refetch()}>Tentar de novo</button>} /></div>
      ) : (
        <div className={juntar("grid min-w-0 grid-cols-1 gap-4", aberta ? "xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]" : "")}>
          <div className={juntar("grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2", aberta ? "" : "lg:grid-cols-4")}>
            {COLUNAS.map((c) => {
              const cartoes = porColuna[c.id];
              return (
                <section key={c.id} className="flex min-w-0 flex-col rounded-3xl bg-card lg:h-[calc(100dvh-230px)]" aria-label={c.nome} data-coluna={c.id}>
                  <div className="flex items-center border-b border-border px-4 py-3">
                    <i className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COR_DA_COLUNA[c.id] }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <h2 className={juntar(texto.corpo, "font-semibold leading-5")}>{c.nome}</h2>
                      <span className={juntar(texto.auxiliar, "block")}>{AJUDA_DA_COLUNA[c.id]}</span>
                    </span>
                    <span className={juntar(etiqueta, "bg-muted text-foreground tabular-nums")}>{cartoes.length}</span>
                  </div>
                  <div className="correio-rolagem max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-2 lg:max-h-none" data-cartoes-da-coluna={c.id}>
                    {!cartoes.length ? (
                      <p className={juntar(texto.auxiliar, "p-3 text-center")}>Nada aqui.</p>
                    ) : (
                      cartoes.map((m) => (
                        <button key={m.id} type="button" onClick={() => setAbertaId(m.id)} aria-pressed={m.id === abertaId} className={juntar("mb-2 block w-full min-w-0 rounded-2xl border bg-card p-3 text-left transition-shadow hover:shadow-md", foco, m.id === abertaId ? "border-foreground" : "border-border")} style={{ borderLeft: `4px solid ${COR_DA_COLUNA[c.id]}` }} data-cartao={m.id}>
                          <span className="flex min-w-0 items-center">
                            <LogoDoRemetente endereco={enderecoDe(m.de)} nome={nomeDe(m.de)} tamanho={26} className="mr-2" />
                            <span className={juntar("min-w-0 flex-1 truncate text-[13px]", !m.lida ? "font-semibold" : "text-muted-foreground")}>{nomeDe(m.de)}</span>
                            {m.recebida_em && <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{diaLegivel(m.recebida_em)}</span>}
                          </span>
                          <span className={juntar(texto.corpo, "mt-2 line-clamp-2 block font-medium leading-5")}>{m.assunto}</span>
                        </button>
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          {aberta && (
            <article className="relative flex min-h-0 min-w-0 flex-col rounded-3xl bg-card xl:h-[calc(100dvh-230px)]" aria-label="Mensagem aberta" data-quadro-leitura="">
              <button type="button" className={juntar(botao.icone, "absolute right-3 top-3 z-[2]")} onClick={() => setAbertaId(null)} aria-label="Fechar a mensagem" title="Fechar">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <LeituraDaMensagem caixa={caixa} pasta="INBOX" m={aberta} eu={eu || null} />
            </article>
          )}
        </div>
      )}
      {mensagens.hasNextPage && !emPreparo && (
        <div className="flex justify-center">
          <button type="button" className={botao.secundario} onClick={() => void mensagens.fetchNextPage()} disabled={mensagens.isFetchingNextPage}>
            {mensagens.isFetchingNextPage ? "Carregando..." : "Trazer conversas mais antigas"}
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ meu dia

/** Meu dia: a agenda, as tarefas e o que a caixa pede, numa frase só. */
export function MeuDia({ caixa, eu, nome }: { caixa: CaixaDoCorreio | null; eu: EuNoCorreio; nome: string }) {
  const dia = hojeEmBrasilia();
  const tarefas = useQuery({ queryKey: chaveDasTarefas, queryFn: listarTarefas });
  const agenda = useQuery({ queryKey: chaveDaAgenda(dia), queryFn: () => listarCompromissos(dia) });
  const semCaixa: CaixaDoCorreio = { id: "", endereco: "", pessoa: "", minha: false, dono: null, dominio: "", provedor: "nenhum", ligado: false };
  const mensagens = useMensagensDaPasta(caixa || semCaixa, "INBOX", "");
  const lista = mensagens.data ? mensagens.data.pages.flat().filter((m) => categoriaDa(m) === "principal") : [];
  const frase = fraseDoDia({
    responder: agruparCaixa(lista).responder.length,
    compromissos: (agenda.data || []).length,
    tarefasAbertas: (tarefas.data || []).filter((t) => !t.feita_em).length,
  });
  const primeiro = (nome || "").trim().split(/\s+/)[0];
  return (
    <div className="min-w-0 space-y-4" data-meu-dia="">
      <Titulo titulo={primeiro ? `Olá, ${primeiro}` : "Meu dia"} frase={frase} />
      <div className="flex min-w-0 flex-wrap items-start [&>*]:mb-4 [&>*]:mr-4">
        <div className="min-w-0 flex-1 basis-[320px]"><AgendaDeHoje eu={eu} /></div>
        <div className="min-w-0 flex-1 basis-[320px]"><TarefasDoDia eu={eu} /></div>
        <section className={juntar(cartao, "flex-1 basis-[280px]")} aria-label="Documentos">
          <h2 className={juntar(texto.corpo, "mb-2 font-semibold")}>Documentos</h2>
          <EstadoVazio compacto titulo="Em breve." descricao="Os anexos vão sozinhos para a pasta da pessoa ou do assunto." />
          <FolderClosed className="mt-3 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ campanhas

const LOTE = 25;

/**
 * Campanhas: e-mail para uma lista, saindo da caixa da empresa. A lista é colada; o envio vai em lotes
 * de 25, cada pessoa recebe o seu (ninguém vê os outros), com o aviso de descadastro no rodapé, e
 * respeita o limite do dia. As respostas voltam para a caixa.
 */
export function CampanhasDoCorreio({ caixa }: { caixa: CaixaDoCorreio | null }) {
  const qc = useQueryClient();
  const [lista, setLista] = useState("");
  const [assunto, setAssunto] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [autorizados, setAutorizados] = useState(false);
  const [enviando, setEnviando] = useState<{ feitos: number; total: number } | null>(null);
  const historico = useQuery({ queryKey: ["produto", "correio", "campanhas", caixa ? caixa.id : ""], queryFn: () => correio.campanhas(caixa!.id), enabled: !!caixa && caixa.ligado, retry: 1 });
  const { validos, invalidos } = useMemo(() => enderecosColados(lista), [lista]);
  const limite = historico.data ? historico.data.limite_do_dia : 150;
  const usados = historico.data ? historico.data.usados_hoje : 0;
  const sobra = Math.max(0, limite - usados);

  if (!caixa) return <EstadoVazio icone={<Megaphone className="h-5 w-5" aria-hidden="true" />} titulo="Escolha uma caixa para enviar a campanha" />;
  if (!caixa.ligado) return <CaixaEmPreparo caixa={caixa} />;

  const pronto = !!assunto.trim() && !!mensagem.trim() && validos.length > 0 && autorizados && !enviando;
  const testar = async () => {
    if (!assunto.trim() || !mensagem.trim()) return void toast.error("Escreva o assunto e a mensagem.");
    try {
      await correio.campanha(caixa.id, { para: [caixa.endereco], assunto: `[Teste] ${assunto}`, texto: mensagem });
      toast.success(`Teste enviado para ${caixa.endereco}.`);
      void historico.refetch();
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível enviar o teste."));
    }
  };
  const enviar = async () => {
    const alvo = validos.slice(0, sobra);
    if (!alvo.length) return void toast.error("O limite de hoje acabou. Amanhã a campanha continua.");
    setEnviando({ feitos: 0, total: alvo.length });
    let enviados = 0;
    const falhas: string[] = [];
    try {
      for (let i = 0; i < alvo.length; i += LOTE) {
        const r = await correio.campanha(caixa.id, { para: alvo.slice(i, i + LOTE), assunto, texto: mensagem });
        enviados += r.enviados;
        falhas.push(...r.falhas);
        setEnviando({ feitos: Math.min(alvo.length, i + LOTE), total: alvo.length });
        if (r.ficaram.length) break;
      }
      const ficaram = validos.length - enviados - falhas.length;
      toast.success(`${enviados} enviados${falhas.length ? `, ${falhas.length} com erro` : ""}${ficaram > 0 ? `. ${ficaram} ficam para amanhã` : ""}.`);
      setLista(ficaram > 0 ? validos.slice(enviados + falhas.length).join("\n") : "");
    } catch (e) {
      toast.error(fraseDoErro(e, "O envio parou no meio. O que saiu está no histórico."));
    } finally {
      setEnviando(null);
      void qc.invalidateQueries({ queryKey: ["produto", "correio", "campanhas", caixa.id] });
    }
  };

  const campo = "w-full rounded-2xl border border-border bg-card px-4 py-3 text-[14px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";
  return (
    <div className="min-w-0 space-y-4" data-campanhas-do-correio="">
      <Titulo titulo="Campanhas" frase={`E-mail para uma lista, saindo de ${caixa.endereco}. Cada pessoa recebe o seu e as respostas voltam para a caixa.`} />
      <div className="flex min-w-0 flex-wrap items-start [&>*]:mb-4 [&>*]:mr-4">
        <section className={juntar(cartao, "flex-[2] basis-[460px] space-y-4")} aria-label="Nova campanha">
          <div>
            <label className={juntar(texto.corpo, "mb-1.5 block font-semibold")} htmlFor="camp-lista">1. Para quem</label>
            <textarea id="camp-lista" value={lista} onChange={(e) => setLista(e.target.value)} rows={4} placeholder="Cole os e-mails aqui, um por linha ou separados por vírgula" className={campo} data-campanha-lista="" />
            <p className={juntar(texto.auxiliar, "mt-1.5")}>
              <b className="text-foreground">{validos.length}</b> {validos.length === 1 ? "endereço válido" : "endereços válidos"}
              {invalidos.length > 0 && <span className="text-destructive">, {invalidos.length} {invalidos.length === 1 ? "inválido ignorado" : "inválidos ignorados"}</span>}
            </p>
          </div>
          <div>
            <label className={juntar(texto.corpo, "mb-1.5 block font-semibold")} htmlFor="camp-assunto">2. O que dizer</label>
            <input id="camp-assunto" value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Assunto" maxLength={200} className={juntar(campo, "mb-2")} data-campanha-assunto="" />
            <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={8} placeholder="Escreva a mensagem como escreveria para um cliente" aria-label="Mensagem" className={campo} data-campanha-mensagem="" />
            <p className={juntar(texto.auxiliar, "mt-1.5")}>No fim vai sozinho: "Para não receber mais, responda SAIR."</p>
          </div>
          <label className="flex items-start text-[13px] leading-5">
            <input type="checkbox" checked={autorizados} onChange={(e) => setAutorizados(e.target.checked)} className="mr-2 mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" data-campanha-autorizados="" />
            Essas pessoas são clientes ou contatos que aceitaram receber e-mails da empresa.
          </label>
          {enviando && (
            <div aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((enviando.feitos / Math.max(1, enviando.total)) * 100)}%` }} /></div>
              <p className={juntar(texto.auxiliar, "mt-1.5")}>Enviando {enviando.feitos} de {enviando.total}...</p>
            </div>
          )}
          <div className="flex flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2">
            <button type="button" className={juntar(botao.primario, "correio-botao-forte")} disabled={!pronto} onClick={() => void enviar()} data-campanha-enviar="">
              <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {!validos.length ? "Enviar campanha" : validos.length > sobra ? `Enviar para ${sobra} hoje` : `Enviar para ${validos.length}`}
            </button>
            <button type="button" className={botao.secundario} disabled={!!enviando} onClick={() => void testar()} data-campanha-teste="">Mandar um teste para mim</button>
          </div>
        </section>
        <div className="min-w-0 flex-1 basis-[300px] space-y-4">
          <section className={cartao} aria-label="Limite de hoje">
            <h2 className={juntar(texto.corpo, "font-semibold")}>Hoje</h2>
            <p className="mt-1 text-[28px] font-semibold tabular-nums">{usados}<span className="text-[15px] font-normal text-muted-foreground"> de {limite}</span></p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round((usados / Math.max(1, limite)) * 100))}%` }} /></div>
            <p className={juntar(texto.auxiliar, "mt-2 leading-5")}>O limite protege o seu domínio de cair no spam. O que passar fica para o dia seguinte.</p>
          </section>
          <section className={cartao} aria-label="Enviadas">
            <h2 className={juntar(texto.corpo, "mb-2 font-semibold")}>Enviadas</h2>
            {historico.isLoading ? (
              <Carregando linhas={3} rotulo="Lendo o histórico" />
            ) : !historico.data || !historico.data.campanhas.length ? (
              <p className={texto.auxiliar}>Nenhuma campanha ainda.</p>
            ) : (
              <ul className="space-y-2">
                {historico.data.campanhas.slice(0, 12).map((c, i) => (
                  <li key={`${c.quando}-${i}`} className="rounded-2xl bg-muted/60 px-3 py-2.5">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.assunto || "(sem assunto)"}</span>
                    <span className={texto.auxiliar}>{diaLegivel(c.quando, true)} · {c.enviados} enviados{c.falhas ? ` · ${c.falhas} com erro` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ferramentas

type Ferramenta = { nome: string; plano: "Essencial" | "Pro" | "Equipe"; texto: string; pronta: boolean; icone: typeof Check; area?: string };
export const FERRAMENTAS: Ferramenta[] = [
  { nome: "Caixa por prioridade", plano: "Essencial", texto: "Abas como no Gmail (Principal, Atualizações, Promoções, Social) e, na Principal, o que pede resposta primeiro.", pronta: true, icone: Inbox, area: "caixa" },
  { nome: "Quadro da caixa", plano: "Essencial", texto: "Cada conversa vira um cartão que anda conforme as respostas. Clique e responda ali mesmo.", pronta: true, icone: ListFilter, area: "quadro" },
  { nome: "Agenda e reuniões", plano: "Essencial", texto: "Marque a reunião direto do e-mail e veja o dia num lugar só.", pronta: true, icone: CalendarClock, area: "dia" },
  { nome: "Tarefas do dia", plano: "Essencial", texto: "Um e-mail vira tarefa com um toque e aparece no seu dia.", pronta: true, icone: Check, area: "dia" },
  { nome: "Campanhas", plano: "Essencial", texto: "E-mail para uma lista, em lotes, com teste, limite do dia e descadastro.", pronta: true, icone: Megaphone, area: "campanhas" },
  { nome: "Trazer e-mails antigos", plano: "Essencial", texto: "Copia Gmail, Outlook, UOL, Locaweb e outros para a caixa nova, sem apagar nada lá.", pronta: true, icone: Repeat2 },
  { nome: "Visão do gestor", plano: "Equipe", texto: "Quem administra vê e troca entre todas as caixas da empresa.", pronta: true, icone: Users },
  { nome: "Documentos", plano: "Essencial", texto: "Anexos guardados sozinhos na pasta da pessoa ou do assunto.", pronta: false, icone: FolderClosed },
  { nome: "Copiloto", plano: "Pro", texto: "Resume a conversa e sugere a resposta no seu tom. Você revisa e envia.", pronta: false, icone: Bot },
  { nome: "Resposta automática", plano: "Pro", texto: "Responde sozinho o que é repetido, só nas regras que você aprovar.", pronta: false, icone: MessageSquareReply },
  { nome: "Caixas compartilhadas", plano: "Equipe", texto: "Contato, vendas e financeiro atendidos por várias pessoas, sem responder duas vezes.", pronta: false, icone: Share2 },
  { nome: "Agendar envio", plano: "Essencial", texto: "Escreva agora e escolha o dia e a hora em que o e-mail sai.", pronta: false, icone: Clock },
  { nome: "Lembrete de resposta", plano: "Essencial", texto: "Se ninguém responder em 3 dias, a conversa volta para o topo.", pronta: false, icone: BellRing },
  { nome: "Desfazer envio", plano: "Essencial", texto: "Alguns segundos para segurar o e-mail que saiu errado.", pronta: false, icone: Undo2 },
  { nome: "Assinatura e modelos", plano: "Essencial", texto: "Assinatura com a marca e respostas prontas para o que se repete.", pronta: false, icone: FileSignature },
  { nome: "Regras e filtros", plano: "Pro", texto: "Mande sozinho para uma pasta o que vem de um remetente ou assunto.", pronta: false, icone: Zap },
  { nome: "E-mail vira negócio", plano: "Pro", texto: "Pedido de orçamento entra direto no CRM como oportunidade.", pronta: false, icone: BriefcaseBusiness },
  { nome: "Resumo no WhatsApp", plano: "Pro", texto: "De manhã, o que importa na caixa chega numa mensagem.", pronta: false, icone: MessageSquareReply },
  { nome: "Anexo grande por link", plano: "Pro", texto: "Arquivo pesado vai como link seguro, sem estourar a caixa de ninguém.", pronta: false, icone: Link2 },
];

/** A caixa do correio no formato que o assistente de migração usa. */
const caixaParaMigrar = (c: CaixaDoCorreio): CaixaDeEmail => ({ id: c.id, dominio_id: "", conta_id: "", endereco: c.endereco, pessoa: c.pessoa, tipo: "caixa", estado: "ativa", tamanho_origem: null, observacao: null });

/**
 * Ferramentas: o plano da empresa com o preço de verdade, trazer os e-mails antigos, o que já
 * funciona (com atalho) e o que vem em seguida.
 */
export function FerramentasDoCorreio({ caixas, master, aoIr }: { caixas: CaixaDoCorreio[]; master: boolean; aoIr?: (area: string) => void }) {
  const precos = useQuery({ queryKey: ["produto", "precos"], queryFn: lerPrecos, staleTime: 300_000 });
  const ofertas = useQuery({ queryKey: ["produto", "ofertas"], queryFn: lerOfertas, staleTime: 300_000 });
  const prontas = FERRAMENTAS.filter((f) => f.pronta);
  const breve = FERRAMENTAS.filter((f) => !f.pronta);
  const p = precos.data;
  const ligadas = caixas.filter((c) => c.ligado);

  const cartaoDe = (f: Ferramenta) => {
    const Icone = f.icone;
    const conteudo = (
      <>
        <span className={juntar("mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", f.pronta ? "bg-accent-soft text-primary" : "bg-muted text-muted-foreground")} aria-hidden="true">
          <Icone className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center">
            <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-semibold")}>{f.nome}</span>
            <span className={juntar(etiqueta, "ml-2", f.pronta ? "bg-accent-soft text-primary" : "bg-muted text-muted-foreground")}>{f.pronta ? "Pronto" : f.plano}</span>
          </span>
          <span className={juntar(texto.auxiliar, "mt-1 block leading-5")}>{f.texto}</span>
        </span>
      </>
    );
    return f.area && aoIr ? (
      <button key={f.nome} type="button" onClick={() => aoIr(f.area!)} className={juntar("flex min-w-0 items-start rounded-3xl bg-card p-4 text-left transition-shadow hover:shadow-md", foco)} data-ferramenta={f.nome}>{conteudo}</button>
    ) : (
      <article key={f.nome} className="flex min-w-0 items-start rounded-3xl bg-card p-4" data-ferramenta={f.nome}>{conteudo}</article>
    );
  };

  return (
    <div className="min-w-0 space-y-6" data-ferramentas-do-correio="">
      <Titulo titulo="Ferramentas" frase="Tudo o que o e-mail da empresa precisa, num lugar só. O que está em breve aparece aqui sozinho quando ficar pronto." />

      <section className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" aria-label="Seu plano">
        <div className="correio-plano min-w-0 rounded-3xl p-6" data-plano-do-correio="">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] opacity-75">Seu plano</p>
          <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">E-mail profissional Aceleriq</h2>
          {precos.isLoading ? (
            <div className="mt-4"><Carregando linhas={2} rotulo="Lendo o plano" /></div>
          ) : p ? (
            <>
              <p className="mt-3 text-[36px] font-semibold leading-none tabular-nums">{reais(p.email_mensal)}<span className="text-[15px] font-normal opacity-75"> por mês</span></p>
              <ul className="mt-4 space-y-1.5 text-[14px]">
                <li className="flex items-center"><Check className="mr-2 h-4 w-4" aria-hidden="true" />{p.email_caixas_no_mensal} {p.email_caixas_no_mensal === 1 ? "caixa incluída" : "caixas incluídas"} com o domínio da empresa</li>
                {p.email_caixa_extra > 0 && <li className="flex items-center"><Check className="mr-2 h-4 w-4" aria-hidden="true" />Caixa a mais por {reais(p.email_caixa_extra)} por mês</li>}
                <li className="flex items-center"><Check className="mr-2 h-4 w-4" aria-hidden="true" />Correio, quadro, agenda, tarefas e campanhas</li>
                <li className="flex items-center"><Check className="mr-2 h-4 w-4" aria-hidden="true" />Funciona no celular e no Outlook, Apple Mail ou Gmail</li>
              </ul>
              <p className="mt-4 text-[13px] opacity-80">{ligadas.length} de {caixas.length} {caixas.length === 1 ? "caixa ligada" : "caixas ligadas"} ao correio.</p>
            </>
          ) : (
            <p className="mt-3 text-[14px] opacity-80">Não foi possível ler o plano agora.</p>
          )}
        </div>
        <div className="min-w-0 rounded-3xl bg-card p-6">
          <h2 className={texto.tituloSecao}>Para somar ao plano</h2>
          {ofertas.isLoading ? (
            <div className="mt-3"><Carregando linhas={3} rotulo="Lendo os extras" /></div>
          ) : !ofertas.data || !ofertas.data.length ? (
            <p className={juntar(texto.auxiliar, "mt-2")}>Nenhum extra disponível agora.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {ofertas.data.map((o) => (
                <li key={o.id} className="flex min-w-0 items-start rounded-2xl bg-muted/60 p-3" data-oferta={o.id}>
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block font-semibold")}>{o.nome}</span>
                    {o.descricao && <span className={juntar(texto.auxiliar, "block leading-5")}>{o.descricao}</span>}
                  </span>
                  <span className="ml-3 shrink-0 text-right text-[14px] font-semibold tabular-nums">{reais(o.valor)}<span className="block text-[11px] font-normal text-muted-foreground">{o.cobranca === "mensal" ? "por mês" : "uma vez"}</span></span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/app/email" className={juntar(botao.secundario, "mt-4 w-full")} data-pedir-extra="">Ver no painel do e-mail</Link>
        </div>
      </section>

      {master ? (
        <TrazerEmailsAntigos caixas={caixas.map(caixaParaMigrar)} />
      ) : (
        <section className={cartao} aria-label="Trazer e-mails antigos">
          <h2 className={texto.tituloSecao}>Trazer seus e-mails antigos</h2>
          <p className={juntar(texto.auxiliar, "mt-1.5 leading-5")}>Quem administra a empresa copia os e-mails do provedor antigo para a sua caixa, com três passos e sem apagar nada lá.</p>
        </section>
      )}

      <section className="min-w-0 space-y-3" aria-label="Já funciona">
        <h2 className={juntar(texto.tituloSecao, "px-1")}>Já funciona</h2>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{prontas.map(cartaoDe)}</div>
      </section>
      <section className="min-w-0 space-y-3" aria-label="Em breve">
        <h2 className={juntar(texto.tituloSecao, "px-1")}>Em breve</h2>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{breve.map(cartaoDe)}</div>
      </section>
    </div>
  );
}
