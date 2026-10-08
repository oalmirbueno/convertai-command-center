import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, ArrowUpRight, Bot, CircleAlert, ShieldCheck, Sparkles } from "lucide-react";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { Carregando, EstadoDeErro, botao, juntar, useEstadoDaTela } from "@/components/sistema";
import { ROLAGEM_OPERACAO } from "@/components/execucao/CarteiraDaOperacao";
import { ROTULO_DO_ESTADO, type Fonte, type ItemDaResposta, type SecaoDaResposta } from "../../../supabase/functions/gestor-aceleriq/modulos/ficha";

/**
 * A conversa do Gestor Aceleriq (Central de Autonomia, 08/10/2026).
 *
 * Pedido do dono: conversa que flui como com uma pessoa (mensagens curtas,
 * uma por balão, chegando uma de cada vez, como no dots) e com interface
 * inteligente (cartão visual com os números, sugestões de próxima pergunta,
 * como no ChatGPT atual). Limpa, com espaço para conversar.
 *
 * A régua de prova não muda: cada balão de fato cita fontes clicáveis; a
 * abertura, o fechamento e as sugestões são montados em código a partir das
 * contagens (sem fato novo).
 */

export type RespostaDoGestor = {
  tipo?: "resposta" | "esclarecer";
  origem?: "ia_conferida" | "motor";
  cabecalho?: string;
  abertura?: string;
  fechamento?: string | null;
  sugestoes?: string[];
  itens?: ItemDaResposta[];
  fontes?: Fonte[];
  avisos?: string[];
  contagem?: Partial<Record<SecaoDaResposta, number>>;
  cliente?: { id: string; nome: string; projeto_id: string | null } | null;
  opcoes?: Array<{ id: string; nome: string }>;
  texto?: string;
  total_de_fontes?: number;
  custo_usd?: number;
};
type Mensagem = { id: string; papel: "usuario" | "gestor" | "sistema"; conteudo: string; dados?: RespostaDoGestor; criado_em: string; pendente?: boolean; nova?: boolean };

export type PedidoAoHermes = { cliente: { id: string; nome: string } | null; texto: string };

const COMECOS = [
  "O que aconteceu com a Acerbi nesta semana?",
  "O que está bloqueado agora e por quê?",
  "O que espera a minha decisão?",
  "Quais entregas estão em revisão?",
];

/** Pausa entre um balão e o próximo (a conversa "chega" aos poucos). Em teste, tudo de uma vez. */
const PAUSA_MS = import.meta.env.MODE === "test" ? 0 : 520;

const hora = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");

const SECAO: Record<SecaoDaResposta, { rotulo: string; cor: string; barra: string }> = {
  feito: { rotulo: "Feito com prova", cor: "text-success", barra: "bg-success" },
  concluido_sem_prova: { rotulo: "Concluído sem prova", cor: "text-warning", barra: "bg-warning/60" },
  em_revisao: { rotulo: "Em revisão", cor: "text-info", barra: "bg-info" },
  em_andamento: { rotulo: "Em andamento", cor: "text-foreground", barra: "bg-muted-foreground/50" },
  bloqueado: { rotulo: "Bloqueado", cor: "text-warning", barra: "bg-warning" },
  decisao: { rotulo: "Sua decisão", cor: "text-destructive", barra: "bg-destructive" },
  lacuna: { rotulo: "Pendências e lacunas", cor: "text-muted-foreground", barra: "bg-muted-foreground/30" },
  proximo: { rotulo: "Próximos passos", cor: "text-primary", barra: "bg-primary" },
};
const NUMEROS: SecaoDaResposta[] = ["feito", "em_revisao", "em_andamento", "bloqueado", "decisao", "concluido_sem_prova"];

const BALAO_GESTOR = "w-fit max-w-[88%] rounded-[20px] rounded-tl-md bg-muted/70 px-4 py-2.5 text-[14px] leading-relaxed text-foreground sm:max-w-[78%]";

function Digitando({ rotulo }: { rotulo?: string }) {
  return (
    <div className={juntar(BALAO_GESTOR, "flex items-center gap-2 py-3")} role="status" aria-label={rotulo || "O Gestor está escrevendo"}>
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70" style={{ animationDelay: `${i * 140}ms` }} />)}
      </span>
      {rotulo && <span className="text-[12px] text-muted-foreground">{rotulo}</span>}
    </div>
  );
}

function CartaoDoRecorte({ d }: { d: RespostaDoGestor }) {
  const c = d.contagem || {};
  const itens = NUMEROS.filter((s) => (c[s] || 0) > 0);
  const total = itens.reduce((t, s) => t + (c[s] || 0), 0);
  if (!total) return null;
  return (
    <div className="w-full max-w-[560px] rounded-2xl border border-border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">{d.cabecalho}</p>
        <span className={juntar("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", d.origem === "ia_conferida" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
          <ShieldCheck className="h-3 w-3" />{d.origem === "ia_conferida" ? "Conferido nas fontes" : "Só fatos registrados"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {itens.map((s) => (
          <div key={s} className="min-w-0">
            <p className={juntar("text-[22px] font-semibold leading-none tabular-nums", SECAO[s].cor)}>{c[s]}</p>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">{SECAO[s].rotulo}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {itens.map((s) => <span key={s} className={SECAO[s].barra} style={{ width: `${((c[s] || 0) / total) * 100}%` }} />)}
      </div>
    </div>
  );
}

function FonteAberta({ f, aoAbrirDiario }: { f: Fonte; aoAbrirDiario: (linkId: string, titulo?: string) => void }) {
  return (
    <div className="w-full max-w-[560px] rounded-2xl border border-border bg-background p-3 text-[12px] shadow-sm">
      <p className="font-medium text-foreground"><span className="mr-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{f.apelido}</span>{f.titulo}</p>
      <p className="mt-1 text-muted-foreground">{ROTULO_DO_ESTADO[f.estado]}{f.cliente ? ` · ${f.cliente}` : ""}{f.agente ? ` · ${f.agente}` : ""}</p>
      <p className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-foreground/85">{f.texto}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {f.ids.vinculo && <button type="button" className={juntar(botao.discreto, "h-7 rounded-full px-3 text-[12px]")} onClick={() => aoAbrirDiario(f.ids.vinculo!, f.titulo)}>Abrir diário da execução</button>}
        {f.link && <a href={f.link} target="_blank" rel="noreferrer" className={juntar(botao.discreto, "h-7 rounded-full px-3 text-[12px]")}>Abrir publicação <ArrowUpRight className="ml-1 h-3 w-3" /></a>}
      </div>
    </div>
  );
}

/** Uma resposta do Gestor: abertura, cartão, balões por assunto, fechamento e o que fazer a seguir. */
function Resposta({ d, nova, aoAbrirDiario, aoEncaminhar, aoPerguntar }: {
  d: RespostaDoGestor;
  nova: boolean;
  aoAbrirDiario: (linkId: string, titulo?: string) => void;
  aoEncaminhar: (p: PedidoAoHermes) => void;
  aoPerguntar: (pergunta: string, clienteId?: string) => void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const fontes = useMemo(() => new Map((d.fontes || []).map((f) => [f.apelido, f])), [d.fontes]);
  const itens = d.itens || [];

  // A sequência que "chega": abertura, cartão, cada balão, fechamento.
  const passos = useMemo(() => {
    const p: Array<{ tipo: "abertura" | "cartao" | "item" | "fechamento"; item?: ItemDaResposta; i?: number }> = [];
    if (d.abertura) p.push({ tipo: "abertura" });
    if (d.contagem && Object.values(d.contagem).some((v) => (v || 0) > 0)) p.push({ tipo: "cartao" });
    itens.forEach((item, i) => p.push({ tipo: "item", item, i }));
    if (d.fechamento) p.push({ tipo: "fechamento" });
    return p;
  }, [d, itens]);
  const [vistos, setVistos] = useState(nova && PAUSA_MS > 0 ? 1 : passos.length);
  useEffect(() => {
    if (vistos >= passos.length) return;
    const t = setTimeout(() => setVistos((v) => v + 1), PAUSA_MS);
    return () => clearTimeout(t);
  }, [vistos, passos.length]);
  const terminou = vistos >= passos.length;
  // A rolagem acompanha cada balão que chega (só na resposta nova; o histórico fica onde está).
  const fimDaResposta = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (nova) fimDaResposta.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [vistos, nova]);

  if (d.tipo === "esclarecer") {
    return (
      <div className="space-y-2">
        <div className={BALAO_GESTOR}>{d.texto}</div>
        <div className="flex flex-wrap gap-2">
          {(d.opcoes || []).map((o) => <button key={o.id + o.nome} type="button" className="rounded-full border border-border bg-background px-3 py-1.5 text-[13px] hover:bg-muted" onClick={() => aoPerguntar("", o.id)}>{o.nome}</button>)}
        </div>
      </div>
    );
  }

  const proximas = itens.filter((i) => i.secao === "proximo").map((i) => `- ${i.texto}`);
  let secaoAnterior: SecaoDaResposta | null = null;
  return (
    <div className="flex flex-col items-start gap-1.5">
      {passos.slice(0, vistos).map((p, k) => {
        if (p.tipo === "abertura") return <div key="ab" className={BALAO_GESTOR}>{d.abertura}</div>;
        if (p.tipo === "fechamento") return <div key="fe" className={BALAO_GESTOR}>{d.fechamento}</div>;
        if (p.tipo === "cartao") return <div key="ca" className="my-1 w-full"><CartaoDoRecorte d={d} /></div>;
        const item = p.item!;
        const novaSecao = item.secao !== secaoAnterior;
        secaoAnterior = item.secao;
        const abertaAqui = item.fontes.find((a) => a === aberta && fontes.get(a));
        return (
          <Fragment key={`it-${p.i}`}>
            {novaSecao && (
              <p className={juntar("mt-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide", SECAO[item.secao].cor)}>
                <span className={juntar("h-1.5 w-1.5 rounded-full", SECAO[item.secao].barra)} aria-hidden="true" />{SECAO[item.secao].rotulo}
              </p>
            )}
            <div className={BALAO_GESTOR}>
              {item.texto}
              <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                {item.fontes.map((a) => fontes.get(a) ? (
                  <button key={a} type="button" aria-expanded={aberta === a} onClick={() => setAberta(aberta === a ? null : a)} className={juntar("rounded-full px-1.5 py-px text-[10px] font-semibold transition-colors", aberta === a ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20")}>{a}</button>
                ) : null)}
              </span>
            </div>
            {abertaAqui && <FonteAberta f={fontes.get(abertaAqui)!} aoAbrirDiario={aoAbrirDiario} />}
          </Fragment>
        );
      })}
      {!terminou && <Digitando />}
      {terminou && (
        <>
          {!!d.avisos?.length && (
            <ul className="mt-1 space-y-0.5 px-1 text-[12px] text-muted-foreground">
              {d.avisos.map((a, k) => <li key={k} className="flex gap-1.5"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />{a}</li>)}
            </ul>
          )}
          {itens.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/10"
                title="Abre o diário da coordenação com o pedido pronto. Você revisa e envia; o Hermes lê o diário."
                onClick={() => aoEncaminhar({
                  cliente: d.cliente ? { id: d.cliente.id, nome: d.cliente.nome } : null,
                  texto: [`Pedido do Gestor Aceleriq (${d.cabecalho}).`, proximas.length ? `Próximas ações apontadas:\n${proximas.join("\n")}` : "Revise a situação abaixo e diga o próximo passo.", "", d.texto || ""].join("\n").trim(),
                })}
              >
                <Bot className="mr-1.5 h-3.5 w-3.5" />Encaminhar ao Hermes
              </button>
              {(d.sugestoes || []).map((s) => (
                <button key={s} type="button" className="rounded-full border border-border bg-background px-3 py-1.5 text-[13px] text-foreground hover:bg-muted" onClick={() => aoPerguntar(s, d.cliente && !/cliente precisa/i.test(s) ? d.cliente.id : undefined)}>{s}</button>
              ))}
            </div>
          )}
        </>
      )}
      <div ref={fimDaResposta} />
    </div>
  );
}

export default function GestorConversa({ periodoDaTela, aoAbrirDiario, aoEncaminhar }: {
  periodoDaTela: string;
  aoAbrirDiario: (linkId: string, titulo?: string) => void;
  aoEncaminhar: (p: PedidoAoHermes) => void;
}) {
  const queryClient = useQueryClient();
  const [rascunho, setRascunho] = useEstadoDaTela<string>("execucao:gestor:rascunho", "");
  const [locais, setLocais] = useState<Mensagem[]>([]);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const conversa = useQuery({
    queryKey: ["gestor-aceleriq", "conversa"],
    queryFn: async () => (await chamarFuncao<{ mensagens: Mensagem[] }>("gestor-aceleriq", { acao: "conversa" })).mensagens || [],
    staleTime: 60_000,
  });
  const perguntar = useMutation({
    mutationFn: async (x: { pergunta: string; cliente_id?: string }) => chamarFuncao<RespostaDoGestor & { mensagem_id?: string }>("gestor-aceleriq", {
      acao: "perguntar", pergunta: x.pergunta, cliente_id: x.cliente_id || null,
      // Sem período na frase, vale o da tela.
      periodo: /hoje|ontem|semana|m[eê]s|[uú]ltim[oa]s?\s+\d+\s+dias?/i.test(x.pergunta) ? null : periodoDaTela,
    }),
    onMutate: (x) => {
      const agora = new Date().toISOString();
      setLocais([{ id: `p-${agora}`, papel: "usuario", conteudo: x.pergunta, criado_em: agora }, { id: `r-${agora}`, papel: "gestor", conteudo: "", criado_em: agora, pendente: true }]);
      setRascunho("");
    },
    onSuccess: (d) => {
      setLocais((ls) => ls.map((m) => (m.pendente ? { ...m, pendente: false, nova: true, conteudo: d.texto || "", dados: d } : m)));
      void queryClient.invalidateQueries({ queryKey: ["gestor-aceleriq", "conversa"] });
    },
    onError: (e, x) => {
      setLocais([]);
      setRascunho(x.pergunta);
      toast.error(textoDoErro(e, "O Gestor não respondeu. Tente de novo."));
    },
  });

  // As locais ficam até a próxima pergunta; quando a conversa gravada já traz a mesma troca, a gravada sai
  // (a resposta nova continua "chegando" sem piscar nem duplicar).
  const mensagens = useMemo(() => {
    const salvas = conversa.data || [];
    if (!locais.length) return salvas;
    const pergunta = locais.find((m) => m.papel === "usuario")?.conteudo;
    const n = salvas.length;
    const jaSalva = n >= 2 && salvas[n - 2].papel === "usuario" && salvas[n - 2].conteudo === pergunta;
    return [...(jaSalva ? salvas.slice(0, n - 2) : salvas), ...locais];
  }, [conversa.data, locais]);

  useEffect(() => { fim.current?.scrollIntoView?.({ block: "end", behavior: "smooth" }); }, [mensagens.length, perguntar.isPending]);
  useEffect(() => {
    const t = campo.current;
    if (!t) return;
    // Vazio: altura natural de uma linha (medir antes do layout dava 160 px).
    if (!rascunho) { t.style.height = ""; return; }
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [rascunho]);

  const ultimaPergunta = [...mensagens].reverse().find((m) => m.papel === "usuario")?.conteudo || "";
  const enviar = (pergunta: string, cliente_id?: string) => {
    const texto = (pergunta || ultimaPergunta).trim();
    if (texto && !perguntar.isPending) perguntar.mutate({ pergunta: texto, cliente_id });
  };

  return (
    <section aria-label="Gestor Aceleriq" className="flex h-[min(78vh,860px)] min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border/70 px-4 py-3 sm:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight">Gestor Aceleriq</h3>
          <p className="truncate text-[12px] text-muted-foreground">Conversa com a sua operação · tudo com prova no OS</p>
        </div>
      </div>

      <div className={juntar(ROLAGEM_OPERACAO, "min-h-0 flex-1")} aria-live="polite">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6">
          {conversa.isLoading ? <Carregando linhas={3} rotulo="Carregando a conversa" /> : conversa.isError ? (
            <EstadoDeErro titulo="Não foi possível ler a conversa." descricao={textoDoErro(conversa.error)} acao={<button type="button" className={botao.secundario} onClick={() => void conversa.refetch()}>Tentar de novo</button>} />
          ) : mensagens.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></span>
              <p className="mt-4 text-[18px] font-semibold">O que você quer saber da operação?</p>
              <p className="mt-1 max-w-md text-[13px] text-muted-foreground">Pergunte como a um gerente: por cliente, por período, por agente. Eu respondo com o que está registrado no OS.</p>
              <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {COMECOS.map((s) => <button key={s} type="button" className="rounded-2xl border border-border bg-background px-4 py-3 text-left text-[13px] hover:bg-muted" onClick={() => enviar(s)}>{s}</button>)}
              </div>
            </div>
          ) : mensagens.map((m, k) => (
            m.papel === "usuario" ? (
              <div key={m.id} className="flex flex-col items-end gap-1">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] rounded-tr-md bg-primary px-4 py-2.5 text-[14px] leading-relaxed text-primary-foreground sm:max-w-[75%]">{m.conteudo}</div>
                {hora(m.criado_em) && <span className="px-1 text-[11px] text-muted-foreground">{hora(m.criado_em)}</span>}
              </div>
            ) : m.pendente ? (
              <div key={m.id}><Digitando rotulo="Lendo tarefas, execuções e provas…" /></div>
            ) : m.dados && (m.dados.tipo === "resposta" || m.dados.tipo === "esclarecer") ? (
              <Resposta
                key={m.id}
                d={{ ...m.dados, texto: m.dados.texto || m.conteudo }}
                nova={!!m.nova && k === mensagens.length - 1}
                aoAbrirDiario={aoAbrirDiario}
                aoEncaminhar={aoEncaminhar}
                aoPerguntar={(p, clienteId) => enviar(p, clienteId)}
              />
            ) : (
              <div key={m.id} className={BALAO_GESTOR}>{m.conteudo}</div>
            )
          ))}
          <div ref={fim} />
        </div>
      </div>

      <form className="shrink-0 border-t border-border/70 bg-card px-3 py-3 sm:px-5" onSubmit={(e) => { e.preventDefault(); enviar(rascunho); }}>
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[26px] border border-border bg-background py-1.5 pl-4 pr-1.5 shadow-sm focus-within:border-primary/50">
          <textarea
            ref={campo}
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(rascunho); } }}
            rows={1}
            maxLength={1500}
            placeholder="Pergunte ao Gestor…"
            aria-label="Pergunta ao Gestor Aceleriq"
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] leading-5 outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40" disabled={perguntar.isPending || !rascunho.trim()} aria-label="Perguntar">
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </form>
    </section>
  );
}
