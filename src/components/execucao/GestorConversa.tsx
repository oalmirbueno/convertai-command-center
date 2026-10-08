import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, ArrowUpRight, Bot, CheckCircle2, CircleAlert, ExternalLink, FileText, Image as ImageIcon, Loader2, Mic, Paperclip, ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import type { AcaoDoAgente, PedidoDaAcao, RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";
import { arquivosParaOEnvio, lerArquivosDoAgente, type ArquivoLidoNaTela, type ArquivoNaoLidoNaTela } from "@/components/mesa/leituraDeArquivos";
import { duracaoDoAudio, ehAudio, ehImagem, MAX_BYTES_DO_AUDIO, MAX_IMAGENS_DO_GESTOR, prepararImagem, tempoDoAudio, tipoDoAudioParaEnvio, type ImagemDoGestor } from "@/lib/gestorAnexos";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { Carregando, EstadoDeErro, botao, juntar, useEstadoDaTela } from "@/components/sistema";
import { ROLAGEM_OPERACAO } from "@/components/execucao/CarteiraDaOperacao";
import { ROTULO_DO_ESTADO, type Fonte, type ItemDaResposta, type SecaoDaResposta } from "../../../supabase/functions/gestor-aceleriq/modulos/ficha";
import { objetoDaFonte, objetoValido, ROTULO_DO_TIPO, type ObjetoAberto } from "@/lib/centralObjetos";
import { arquivosDoWorkspace, TIPO_ARQUIVO_DO_WORKSPACE } from "@/lib/centralArrastar";

/**
 * A conversa do Gestor Aceleriq (Central de Autonomia, 08/10/2026).
 *
 * Pedido do dono: conversa que flui como com uma pessoa (mensagens curtas,
 * uma por balão, chegando uma de cada vez, como no dots) e com interface
 * inteligente (cartão visual com os números, sugestões de próxima pergunta,
 * como no ChatGPT atual). Limpa, com espaço para conversar.
 *
 * A régua de prova não muda: cada balão de fato cita fontes clicáveis.
 * 09/10: conversa contínua. Sem abertura, fechamento, rótulos de seção e
 * sugestões fixas; o cartão de números só aparece quando o Gestor marca
 * (panorama). Entregas e objetos abrem na lateral nativa (aoAbrirObjeto).
 */

export type RespostaDoGestor = {
  tipo?: "resposta" | "esclarecer";
  origem?: "ia_conferida" | "motor";
  cabecalho?: string;
  abertura?: string | null;
  fechamento?: string | null;
  mostrar_numeros?: boolean;
  abrir?: ObjetoAberto | null;
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
  acoes?: AcaoDoAgente[];
  bloqueadas?: Array<{ pedido: string; motivo: string; onde: string; link: string | null }>;
  mensagem_id?: string | null;
  conversa_id?: string | null;
};

/** O que a ação feita entregou, relido do banco pela função (estado real, id gravado e atalho). */
type Entrega = { ref: string; nome: string; tipo: "tarefa" | "memoria" | "fila_do_agente" | "aprovacao"; objeto?: ObjetoAberto; cliente: string | null; projeto: string | null; estado: string; id: string; link: string; proxima: string };

const ROTULO_DA_ENTREGA: Record<Entrega["tipo"], string> = { tarefa: "Tarefa", memoria: "Memória do cliente", fila_do_agente: "Na fila do agente", aprovacao: "Decisão registrada" };

/** Cartão compacto do que foi feito (relido do banco). Clicar abre o objeto na lateral nativa. */
function CartaoDeEntrega({ e, aoAbrirObjeto }: { e: Entrega; aoAbrirObjeto?: (o: ObjetoAberto) => void }) {
  const objeto = objetoValido(e.objeto) || (e.tipo === "tarefa" || e.tipo === "fila_do_agente" ? objetoValido({ tipo: "tarefa", id: e.id, titulo: e.nome }) : null);
  const corpo = (
    <>
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-snug text-foreground">{e.nome}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{ROTULO_DA_ENTREGA[e.tipo]} · {e.estado}{e.cliente ? ` · ${e.cliente}` : ""}</span>
      </span>
      {objeto && aoAbrirObjeto ? <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
    </>
  );
  return objeto && aoAbrirObjeto ? (
    <button type="button" onClick={() => aoAbrirObjeto(objeto)} title={`${e.proxima} (id ${e.id.slice(0, 8)})`} aria-label={`Abrir ${e.nome}`} className="flex w-full max-w-[520px] items-start gap-2 rounded-lg border border-success/30 bg-background px-3 py-2.5 text-left shadow-sm transition-colors hover:border-success/60 hover:bg-muted/40" data-entrega={e.tipo}>
      {corpo}
    </button>
  ) : (
    <div className="flex w-full max-w-[520px] items-start gap-2 rounded-lg border border-success/30 bg-background px-3 py-2.5 shadow-sm" title={e.proxima} data-entrega={e.tipo}>{corpo}</div>
  );
}
type Mensagem = { id: string; papel: "usuario" | "gestor" | "sistema"; conteudo: string; dados?: RespostaDoGestor; criado_em: string; pendente?: boolean; nova?: boolean; pedido?: { anexos?: Array<{ nome: string; tipo: string; caracteres: number }>; nao_lidos?: Array<{ nome: string; motivo: string }>; imagens?: Array<{ nome: string }>; audio?: { segundos: number } | null; previas?: string[] } };

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
  anexo: { rotulo: "Do que você mandou", cor: "text-primary", barra: "bg-primary/60" },
  feito: { rotulo: "Feito com prova", cor: "text-success", barra: "bg-success" },
  concluido_sem_prova: { rotulo: "Concluído sem prova", cor: "text-warning", barra: "bg-warning/60" },
  em_revisao: { rotulo: "Em revisão", cor: "text-info", barra: "bg-info" },
  em_andamento: { rotulo: "Em andamento", cor: "text-foreground", barra: "bg-muted-foreground/50" },
  bloqueado: { rotulo: "Bloqueado", cor: "text-warning", barra: "bg-warning" },
  decisao: { rotulo: "Sua decisão", cor: "text-destructive", barra: "bg-destructive" },
  lacuna: { rotulo: "Pendências e lacunas", cor: "text-muted-foreground", barra: "bg-muted-foreground/30" },
  proximo: { rotulo: "Próximos passos", cor: "text-primary", barra: "bg-primary" },
  conversa: { rotulo: "Conversa", cor: "text-foreground", barra: "bg-muted-foreground/30" },
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

function FonteAberta({ f, aoAbrirDiario, aoAbrirObjeto }: { f: Fonte; aoAbrirDiario: (linkId: string, titulo?: string) => void; aoAbrirObjeto?: (o: ObjetoAberto) => void }) {
  const objeto = objetoDaFonte(f);
  return (
    <div className="w-full max-w-[560px] rounded-2xl border border-border bg-background p-3 text-[12px] shadow-sm">
      <p className="font-medium text-foreground"><span className="mr-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{f.apelido}</span>{f.titulo}</p>
      <p className="mt-1 text-muted-foreground">{ROTULO_DO_ESTADO[f.estado]}{f.cliente ? ` · ${f.cliente}` : ""}{f.agente ? ` · ${f.agente}` : ""}</p>
      <p className="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-foreground/85">{f.texto}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {objeto && aoAbrirObjeto && <button type="button" className={juntar(botao.discreto, "h-7 rounded-full px-3 text-[12px]")} onClick={() => aoAbrirObjeto(objeto)}>Abrir {ROTULO_DO_TIPO[objeto.tipo].toLowerCase()} ao lado</button>}
        {f.ids.vinculo && <button type="button" className={juntar(botao.discreto, "h-7 rounded-full px-3 text-[12px]")} onClick={() => aoAbrirDiario(f.ids.vinculo!, f.titulo)}>Diário da execução</button>}
        {f.link && <a href={f.link} target="_blank" rel="noreferrer" className={juntar(botao.discreto, "h-7 rounded-full px-3 text-[12px]")}>Abrir publicação <ArrowUpRight className="ml-1 h-3 w-3" /></a>}
      </div>
    </div>
  );
}

/** Uma resposta do Gestor: as mensagens dele, o cartão de números quando ele marca, ações, entregas e o objeto aberto. */
function Resposta({ d, nova, aoAbrirDiario, aoEncaminhar, aoPerguntar, mensagemId, aoAbrirNoPainel, aoAbrirObjeto, aoMudou }: {
  d: RespostaDoGestor;
  nova: boolean;
  mensagemId?: string | null;
  aoAbrirNoPainel?: (caminho: string, rotulo: string) => void;
  aoAbrirObjeto?: (o: ObjetoAberto) => void;
  aoMudou?: () => void;
  aoAbrirDiario: (linkId: string, titulo?: string) => void;
  aoEncaminhar: (p: PedidoAoHermes) => void;
  aoPerguntar: (pergunta: string, clienteId?: string) => void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  // A ação muda depois de Confirmar/Desfazer: a versão gravada que a função devolve vale.
  const [acoesAtuais, setAcoesAtuais] = useState<Record<string, AcaoDoAgente>>({});
  const fontes = useMemo(() => new Map((d.fontes || []).map((f) => [f.apelido, f])), [d.fontes]);
  const itens = d.itens || [];

  // A sequência que "chega": cada balão (e o cartão de números só quando o Gestor marca; respostas antigas sem a marca mantêm o cartão).
  const comNumeros = d.mostrar_numeros === true || (d.mostrar_numeros === undefined && !!d.abertura);
  const passos = useMemo(() => {
    const p: Array<{ tipo: "abertura" | "cartao" | "item" | "fechamento"; item?: ItemDaResposta; i?: number }> = [];
    if (d.abertura) p.push({ tipo: "abertura" });
    if (comNumeros && d.contagem && Object.values(d.contagem).some((v) => (v || 0) > 0)) p.push({ tipo: "cartao" });
    itens.forEach((item, i) => p.push({ tipo: "item", item, i }));
    if (d.fechamento) p.push({ tipo: "fechamento" });
    return p;
  }, [d, itens, comNumeros]);
  const [vistos, setVistos] = useState(nova && PAUSA_MS > 0 ? 1 : passos.length);
  useEffect(() => {
    if (vistos >= passos.length) return;
    const t = setTimeout(() => setVistos((v) => v + 1), PAUSA_MS);
    return () => clearTimeout(t);
  }, [vistos, passos.length]);
  const terminou = vistos >= passos.length;
  // "Abre o que você fez": o objeto pedido abre sozinho na lateral (uma vez, só na resposta nova).
  const abrirPedido = objetoValido(d.abrir);
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (nova && terminou && abrirPedido && aoAbrirObjeto && !jaAbriu.current) { jaAbriu.current = true; aoAbrirObjeto(abrirPedido); }
  }, [nova, terminou, abrirPedido, aoAbrirObjeto]);
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
  return (
    <div className="flex flex-col items-start gap-1.5">
      {passos.slice(0, vistos).map((p, k) => {
        if (p.tipo === "abertura") return <div key="ab" className={BALAO_GESTOR}>{d.abertura}</div>;
        if (p.tipo === "fechamento") return <div key="fe" className={BALAO_GESTOR}>{d.fechamento}</div>;
        if (p.tipo === "cartao") return <div key="ca" className="my-1 w-full"><CartaoDoRecorte d={d} /></div>;
        const item = p.item!;
        const abertaAqui = item.fontes.find((a) => a === aberta && fontes.get(a));
        return (
          <Fragment key={`it-${p.i}`}>
            <div className={BALAO_GESTOR} data-secao={item.secao}>
              {item.texto}
              <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                {item.fontes.map((a) => fontes.get(a) ? (
                  <button key={a} type="button" aria-expanded={aberta === a} onClick={() => setAberta(aberta === a ? null : a)} className={juntar("rounded-full px-1.5 py-px text-[10px] font-semibold transition-colors", aberta === a ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20")}>{a}</button>
                ) : null)}
              </span>
            </div>
            {abertaAqui && <FonteAberta f={fontes.get(abertaAqui)!} aoAbrirDiario={aoAbrirDiario} aoAbrirObjeto={aoAbrirObjeto} />}
          </Fragment>
        );
      })}
      {!terminou && <Digitando />}
      {terminou && (
        <>
          {(d.acoes || []).map((bruta) => {
            const a = acoesAtuais[bruta.id] || bruta;
            const entregas = ((a as AcaoDoAgente & { entregas?: Entrega[] }).entregas || []);
            return (
              <div key={a.id} className="mt-1 w-full max-w-[600px] space-y-2" data-acao-do-gestor={a.id}>
                {mensagemId ? (
                  <CartaoDeAcao
                    acao={a}
                    titulo={a.executada_direto ? "Feito agora" : "Para confirmar"}
                    observacao="Sem custo. Fica registrado com você como autor."
                    recemFeita={!!a.executada_direto && nova}
                    onPedido={(pedido: PedidoDaAcao) => chamarFuncao<RespostaDaAcao>("gestor-aceleriq", {
                      acao: pedido === "desfazer" ? "desfazer_acao" : "executar_acao", mensagem_id: mensagemId, acao_id: a.id,
                      descartar: pedido === "descartar", parar: pedido === "parar",
                    })}
                    onFeito={(_p, r) => { const novo = r.anexo as AcaoDoAgente | undefined; if (novo && novo.id) setAcoesAtuais((x) => ({ ...x, [novo.id]: novo })); aoMudou?.(); }}
                  />
                ) : <p className="text-[12px] text-muted-foreground">A conversa não foi gravada: abra de novo para confirmar esta ação.</p>}
                {entregas.map((e) => <CartaoDeEntrega key={`${e.ref}-${e.id}`} e={e} aoAbrirObjeto={aoAbrirObjeto} />)}
              </div>
            );
          })}
          {(d.bloqueadas || []).map((b, i) => (
            <div key={i} className="mt-1 w-full max-w-[560px] rounded-2xl border border-warning/40 bg-warning/5 p-3" data-decisao-do-gestor="">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning"><ShieldAlert className="h-3.5 w-3.5" />Precisa da sua decisão</p>
              <p className="mt-1 text-[14px] text-foreground">{b.pedido}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{b.motivo}</p>
              {b.link && (
                <div className="mt-2 flex gap-1.5">
                  {aoAbrirNoPainel && <button type="button" onClick={() => aoAbrirNoPainel(b.link!, b.pedido)} className="rounded-full bg-warning/90 px-3 py-1 text-[12px] font-medium text-background">Decidir</button>}
                </div>
              )}
            </div>
          ))}
          {!!d.avisos?.length && (
            <ul className="mt-1 space-y-0.5 px-1 text-[12px] text-muted-foreground">
              {d.avisos.map((a, k) => <li key={k} className="flex gap-1.5"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />{a}</li>)}
            </ul>
          )}
          {abrirPedido && aoAbrirObjeto && (
            <button type="button" onClick={() => aoAbrirObjeto(abrirPedido)} className="mt-1 inline-flex max-w-[520px] items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted" data-objeto-aberto="">
              <ArrowUpRight className="h-3.5 w-3.5" /><span className="truncate">{ROTULO_DO_TIPO[abrirPedido.tipo]} aberta ao lado: <span className="text-foreground">{abrirPedido.titulo || "abrir"}</span></span>
            </button>
          )}
          {(itens.length > 0 || (d.sugestoes || []).length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {itens.length > 0 && (
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Levar esta resposta ao Hermes (você revisa antes de enviar)"
                  aria-label="Encaminhar ao Hermes"
                  onClick={() => aoEncaminhar({
                    cliente: d.cliente ? { id: d.cliente.id, nome: d.cliente.nome } : null,
                    texto: [`Pedido do Gestor Aceleriq (${d.cabecalho}).`, proximas.length ? `Próximas ações apontadas:\n${proximas.join("\n")}` : "Revise a situação abaixo e diga o próximo passo.", "", d.texto || ""].join("\n").trim(),
                  })}
                >
                  <Bot className="h-3.5 w-3.5" />
                </button>
              )}
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

type AnexoDoc = ArquivoLidoNaTela;
type AnexoNaoLido = ArquivoNaoLidoNaTela;
type PedidoDoDono = { anexos?: Array<{ nome: string; tipo: string; caracteres: number }>; nao_lidos?: Array<{ nome: string; motivo: string }>; imagens?: Array<{ nome: string }>; audio?: { segundos: number } | null; previas?: string[] };

/** O que o dono mandou junto (fica embaixo do balão dele). */
function AnexosDoPedido({ p }: { p?: PedidoDoDono | null }) {
  if (!p) return null;
  const docs = p.anexos || [];
  const imgs = p.imagens || [];
  if (!docs.length && !imgs.length && !p.audio && !(p.nao_lidos || []).length) return null;
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5 sm:max-w-[75%]">
      {p.audio && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"><Mic className="h-3 w-3" />Áudio {tempoDoAudio(p.audio.segundos)} · transcrito</span>}
      {(p.previas || []).map((src, i) => <img key={i} src={src} alt="" className="h-16 w-16 rounded-xl border border-border object-cover" />)}
      {!p.previas?.length && imgs.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground"><ImageIcon className="h-3 w-3" />{imgs.length} {imgs.length === 1 ? "imagem" : "imagens"}</span>}
      {docs.map((a, i) => <span key={i} className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground" title={`${a.caracteres.toLocaleString("pt-BR")} caracteres lidos`}><FileText className="h-3 w-3 shrink-0" /><span className="truncate">{a.nome}</span></span>)}
      {(p.nao_lidos || []).map((a, i) => <span key={`n${i}`} className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-warning/10 px-2.5 py-1 text-[11px] text-warning" title={a.motivo}><CircleAlert className="h-3 w-3 shrink-0" /><span className="truncate">{a.nome} (não lido)</span></span>)}
    </div>
  );
}

type Gravando = { inicio: number; segundos: number };

export type ContextoDaConversa = { conversaId: string | null; cliente: { id: string; nome: string } | null; projeto: { id: string; nome: string } | null; titulo?: string | null };

export default function GestorConversa({ periodoDaTela, aoAbrirDiario, aoEncaminhar, acoes, className, contexto, aoConversaCriada, aoAbrirNoPainel, aoAbrirObjeto }: {
  periodoDaTela: string;
  /** A conversa aberta e o recorte dela (cliente e projeto). Sem conversa: a primeira pergunta cria uma. */
  contexto?: ContextoDaConversa;
  aoConversaCriada?: (id: string) => void;
  aoAbrirNoPainel?: (caminho: string, rotulo: string) => void;
  /** Abre um objeto do OS (tarefa, memória, aprovação...) na lateral nativa da Central. */
  aoAbrirObjeto?: (o: ObjetoAberto) => void;
  aoAbrirDiario: (linkId: string, titulo?: string) => void;
  aoEncaminhar: (p: PedidoAoHermes) => void;
  /** Botões do cabeçalho (ampliar, tela cheia), da tela que contém o chat. */
  acoes?: ReactNode;
  /** Altura e moldura: quem contém decide (padrão: ocupa a altura do pai). */
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [rascunho, setRascunho] = useEstadoDaTela<string>("execucao:gestor:rascunho", "");
  const [locais, setLocais] = useState<Mensagem[]>([]);
  const [docs, setDocs] = useState<AnexoDoc[]>([]);
  const [naoLidos, setNaoLidos] = useState<AnexoNaoLido[]>([]);
  const [imagens, setImagens] = useState<ImagemDoGestor[]>([]);
  const [lendo, setLendo] = useState(0);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [gravando, setGravando] = useState<Gravando | null>(null);
  const [soltando, setSoltando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const gravador = useRef<MediaRecorder | null>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const descartarGravacao = useRef(false);

  const conversaId = contexto?.conversaId || null;
  const criadaAgora = useRef<string | null>(null);
  const conversa = useQuery({
    queryKey: ["gestor-aceleriq", "conversa", conversaId],
    enabled: !!conversaId || !contexto,
    queryFn: async () => conversaId
      ? (await chamarFuncao<{ mensagens: Mensagem[] }>("gestor-aceleriq", { acao: "abrir_conversa", conversa_id: conversaId })).mensagens || []
      : (await chamarFuncao<{ mensagens: Mensagem[] }>("gestor-aceleriq", { acao: "conversa" })).mensagens || [],
    staleTime: 30_000,
  });
  // Trocou de conversa (não foi a que acabou de nascer desta pergunta): a tela local recomeça.
  useEffect(() => {
    if (conversaId && conversaId === criadaAgora.current) return;
    setLocais([]);
  }, [conversaId]);
  const atualizarConversa = () => void queryClient.invalidateQueries({ queryKey: ["gestor-aceleriq", "conversa", conversaId] });

  type Envio = { pergunta: string; cliente_id?: string; audio?: { segundos: number } | null; docs?: AnexoDoc[]; naoLidos?: AnexoNaoLido[]; imagens?: ImagemDoGestor[] };
  const perguntar = useMutation({
    mutationFn: async (x: Envio) => chamarFuncao<RespostaDoGestor & { mensagem_id?: string }>("gestor-aceleriq", {
      acao: "perguntar", pergunta: x.pergunta,
      conversa_id: conversaId,
      // Sem conversa aberta, a nova nasce no recorte escolhido (cliente da tela ou o da sugestão).
      cliente_id: conversaId ? null : (x.cliente_id || contexto?.cliente?.id || null),
      // Sem período na frase, vale o da tela.
      periodo: /hoje|ontem|semana|m[eê]s|[uú]ltim[oa]s?\s+\d+\s+dias?/i.test(x.pergunta) ? null : periodoDaTela,
      arquivos: x.docs?.length || x.naoLidos?.length ? arquivosParaOEnvio(x.docs || [], x.naoLidos || []) : null,
      imagens: (x.imagens || []).map((i) => ({ nome: i.nome, mime: i.mime, base64: i.base64 })),
      audio: x.audio || null,
    }),
    onMutate: (x) => {
      const agora = new Date().toISOString();
      const pedido: PedidoDoDono = {
        anexos: (x.docs || []).map((a) => ({ nome: a.nome, tipo: a.tipo, caracteres: a.caracteres })),
        nao_lidos: (x.naoLidos || []).map((a) => ({ nome: a.nome, motivo: a.motivo })),
        imagens: (x.imagens || []).map((i) => ({ nome: i.nome })),
        previas: (x.imagens || []).map((i) => i.previa),
        audio: x.audio || null,
      };
      setLocais([{ id: `p-${agora}`, papel: "usuario", conteudo: x.pergunta, criado_em: agora, pedido }, { id: `r-${agora}`, papel: "gestor", conteudo: "", criado_em: agora, pendente: true }]);
      setRascunho("");
      setDocs([]); setNaoLidos([]); setImagens([]);
    },
    onSuccess: (d) => {
      setLocais((ls) => ls.map((m) => (m.pendente ? { ...m, pendente: false, nova: true, conteudo: d.texto || "", dados: d } : m)));
      void queryClient.invalidateQueries({ queryKey: ["gestor-aceleriq", "conversas"] });
      if (!conversaId && d.conversa_id) { criadaAgora.current = d.conversa_id; aoConversaCriada?.(d.conversa_id); }
      else void queryClient.invalidateQueries({ queryKey: ["gestor-aceleriq", "conversa", conversaId] });
    },
    onError: (e, x) => {
      setLocais([]);
      setRascunho(x.audio ? "" : x.pergunta);
      if (!x.audio) { setDocs(x.docs || []); setNaoLidos(x.naoLidos || []); setImagens(x.imagens || []); }
      toast.error(textoDoErro(e, "O Gestor não respondeu. Tente de novo."));
    },
  });

  // As locais ficam até a próxima pergunta; quando a conversa gravada já traz a mesma troca, a gravada sai
  // (a resposta nova continua "chegando" sem piscar nem duplicar; as prévias das imagens continuam na tela).
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
  useEffect(() => () => { fluxo.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setGravando((g) => (g ? { ...g, segundos: (Date.now() - g.inicio) / 1000 } : g)), 250);
    return () => clearInterval(t);
  }, [!!gravando]);

  const ultimaPergunta = [...mensagens].reverse().find((m) => m.papel === "usuario")?.conteudo || "";
  const temAnexo = docs.length > 0 || imagens.length > 0;
  const ocupado = perguntar.isPending || lendo > 0 || transcrevendo;
  const enviar = (pergunta: string, cliente_id?: string, audio?: { segundos: number } | null) => {
    const texto = (pergunta || (temAnexo ? "" : ultimaPergunta)).trim();
    if ((!texto && !temAnexo) || ocupado) return;
    perguntar.mutate({ pergunta: texto, cliente_id, audio, docs, naoLidos, imagens });
  };

  /** Áudio (gravado ou anexado) vira texto e a mensagem sai na hora, com o que estiver escrito e anexado. */
  const transcreverEEnviar = async (audio: Blob, nome: string, segundos: number) => {
    if (audio.size > MAX_BYTES_DO_AUDIO) { toast.error("O áudio passou de 24 MB. Mande em partes menores."); return; }
    setTranscrevendo(true);
    try {
      const tipo = tipoDoAudioParaEnvio({ name: nome, type: audio.type });
      const { data, error } = await supabase.functions.invoke("gestor-aceleriq", {
        body: audio,
        headers: { "Content-Type": tipo, "x-gestor-acao": "transcrever", "x-gestor-duracao": String(Math.round(segundos) || 0) },
      });
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, "Não deu para transcrever o áudio."));
      const r = data as { texto?: string; segundos?: number; mensagem?: string; error?: string };
      if (r?.error || !r?.texto) throw new Error(r?.mensagem || "Não deu para entender o áudio.");
      const escrito = rascunho.trim();
      const texto = escrito ? `${escrito}\n\n(áudio) ${r.texto}` : r.texto;
      perguntar.mutate({ pergunta: texto, audio: { segundos: Math.round(r.segundos || segundos) }, docs, naoLidos, imagens });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para transcrever o áudio.");
    } finally {
      setTranscrevendo(false);
    }
  };

  const adicionar = (lista: FileList | File[] | null | undefined) => {
    const todos = lista ? (Array.prototype.slice.call(lista) as File[]) : [];
    if (!todos.length) return;
    const audios = todos.filter(ehAudio);
    const fotos = todos.filter((f) => !ehAudio(f) && ehImagem(f));
    const outros = todos.filter((f) => !ehAudio(f) && !ehImagem(f));
    if (audios.length) {
      const a = audios[0];
      if (audios.length > 1) toast.info("Mandei o primeiro áudio; envie os outros depois.");
      void duracaoDoAudio(a).then((s) => transcreverEEnviar(a, a.name, s));
    }
    if (fotos.length) {
      const vagas = MAX_IMAGENS_DO_GESTOR - imagens.length;
      if (vagas <= 0) toast.info(`Até ${MAX_IMAGENS_DO_GESTOR} imagens por mensagem.`);
      fotos.slice(0, Math.max(0, vagas)).forEach((f) => {
        setLendo((n) => n + 1);
        prepararImagem(f)
          .then((img) => setImagens((l) => (l.length < MAX_IMAGENS_DO_GESTOR ? l.concat(img) : l)))
          .catch(() => toast.error(`Não deu para abrir ${f.name}.`))
          .finally(() => setLendo((n) => n - 1));
      });
    }
    if (outros.length) {
      setLendo((n) => n + 1);
      const jaUsados = docs.reduce((n, a) => n + a.caracteres, 0);
      lerArquivosDoAgente(outros, jaUsados)
        .then((r) => {
          if (r.lidos.length) setDocs((l) => l.concat(r.lidos));
          if (r.naoLidos.length) setNaoLidos((l) => l.concat(r.naoLidos));
          // Imagens de dentro do ZIP entram como imagens (até o teto).
          r.imagens.slice(0, Math.max(0, MAX_IMAGENS_DO_GESTOR - imagens.length)).forEach((f: File) => {
            prepararImagem(f).then((img) => setImagens((l) => (l.length < MAX_IMAGENS_DO_GESTOR ? l.concat(img) : l))).catch(() => undefined);
          });
        })
        .catch(() => toast.error("Não deu para ler os arquivos", { description: "Tente de novo ou mande em PDF." }))
        .finally(() => setLendo((n) => n - 1));
    }
  };

  const gravacaoPossivel = typeof window !== "undefined" && typeof (window as unknown as { MediaRecorder?: unknown }).MediaRecorder === "function" && !!navigator.mediaDevices?.getUserMedia;
  const comecarGravacao = async () => {
    if (gravando || ocupado) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      fluxo.current = s;
      const C = (window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder;
      const formato = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => typeof C.isTypeSupported === "function" && C.isTypeSupported(t));
      const g = new C(s, formato ? { mimeType: formato } : undefined);
      pedacos.current = [];
      descartarGravacao.current = false;
      g.ondataavailable = (e) => { if (e.data && e.data.size) pedacos.current.push(e.data); };
      g.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        fluxo.current = null;
        const inicio = gravadorInicio.current;
        const segundos = (Date.now() - inicio) / 1000;
        setGravando(null);
        if (descartarGravacao.current) return;
        const blob = new Blob(pedacos.current, { type: (g.mimeType || formato || "audio/webm").split(";")[0] });
        if (segundos < 0.8 || !blob.size) { toast.info("Áudio curto demais."); return; }
        void transcreverEEnviar(blob, `gravacao.${blob.type.indexOf("mp4") >= 0 ? "m4a" : "webm"}`, segundos);
      };
      gravador.current = g;
      gravadorInicio.current = Date.now();
      g.start(1000);
      setGravando({ inicio: Date.now(), segundos: 0 });
    } catch {
      toast.error("O navegador não liberou o microfone.", { description: "Libere o microfone para este site e tente de novo." });
    }
  };
  const gravadorInicio = useRef(0);
  const pararGravacao = (descartar: boolean) => {
    descartarGravacao.current = descartar;
    const g = gravador.current;
    if (g && g.state !== "inactive") g.stop();
  };
  // Teto da gravação: 10 minutos.
  useEffect(() => { if (gravando && gravando.segundos >= 600) pararGravacao(false); }, [gravando]);

  return (
    <section
      aria-label="Gestor Aceleriq"
      className={juntar("relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card", className || "h-full min-h-[480px]")}
      onDragOver={(e) => { const t = e.dataTransfer?.types; if (t && (t.indexOf("Files") >= 0 || t.indexOf(TIPO_ARQUIVO_DO_WORKSPACE) >= 0)) { e.preventDefault(); setSoltando(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setSoltando(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setSoltando(false);
        const doWorkspace = e.dataTransfer?.getData?.(TIPO_ARQUIVO_DO_WORKSPACE);
        if (doWorkspace) {
          setLendo((n) => n + 1);
          void arquivosDoWorkspace(doWorkspace).then((lista) => adicionar(lista)).catch(() => toast.error("Não consegui baixar o arquivo do Workspace.")).finally(() => setLendo((n) => n - 1));
          return;
        }
        adicionar(e.dataTransfer?.files);
      }}
    >
      {soltando && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/90 text-[14px] font-medium text-primary">
          Solte aqui: documentos, imagens ou áudio
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border/70 px-4 py-2.5 sm:px-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-tight">{contexto?.titulo || "Gestor Aceleriq"}</h3>
          <p className="truncate text-[12px] text-muted-foreground">
            {contexto ? (contexto.cliente ? `${contexto.cliente.nome}${contexto.projeto ? ` · ${contexto.projeto.nome}` : ""}` : "Visão geral da Aceleriq") : "Conversa com a sua operação"} · tudo com prova no OS
          </p>
        </div>
        {acoes && <div className="flex shrink-0 items-center gap-1">{acoes}</div>}
      </div>

      <div className={juntar(ROLAGEM_OPERACAO, "min-h-0 flex-1")} aria-live="polite">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6">
          {conversa.isLoading ? <Carregando linhas={3} rotulo="Carregando a conversa" /> : conversa.isError ? (
            <EstadoDeErro titulo="Não foi possível ler a conversa." descricao={textoDoErro(conversa.error)} acao={<button type="button" className={botao.secundario} onClick={() => void conversa.refetch()}>Tentar de novo</button>} />
          ) : mensagens.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></span>
              <p className="mt-4 text-[18px] font-semibold">O que você quer saber da operação?</p>
              <p className="mt-1 max-w-md text-[13px] text-muted-foreground">Pergunte como a um gerente: por cliente, por período, por agente. Pode mandar arquivo, print ou áudio.</p>
              <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {COMECOS.map((s) => <button key={s} type="button" className="rounded-2xl border border-border bg-background px-4 py-3 text-left text-[13px] hover:bg-muted" onClick={() => enviar(s)}>{s}</button>)}
              </div>
            </div>
          ) : mensagens.map((m, k) => (
            m.papel === "usuario" ? (
              <div key={m.id} className="flex flex-col items-end gap-1">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] rounded-tr-md bg-primary px-4 py-2.5 text-[14px] leading-relaxed text-primary-foreground sm:max-w-[75%]">{m.conteudo}</div>
                <AnexosDoPedido p={(m.pedido || (m.dados as unknown as PedidoDoDono)) ?? null} />
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
                mensagemId={m.dados.mensagem_id || (m.id && !String(m.id).startsWith("r-") ? m.id : null)}
                aoAbrirNoPainel={aoAbrirNoPainel}
                aoAbrirObjeto={aoAbrirObjeto}
                aoMudou={atualizarConversa}
              />
            ) : m.papel === "sistema" ? (
              <p key={m.id} className="px-1 text-center text-[11px] text-muted-foreground">{m.conteudo} · {hora(m.criado_em)}</p>
            ) : (
              <div key={m.id} className={BALAO_GESTOR}>{m.conteudo}</div>
            )
          ))}
          {transcrevendo && <div className="flex justify-end"><span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[12px] text-primary"><Loader2 className="h-3.5 w-3.5 animate-spin" />Transcrevendo o áudio…</span></div>}
          <div ref={fim} />
        </div>
      </div>

      <form className="shrink-0 border-t border-border/70 bg-card px-3 py-3 sm:px-5" onSubmit={(e) => { e.preventDefault(); enviar(rascunho); }}>
        <div className="mx-auto w-full max-w-3xl">
          {(temAnexo || naoLidos.length > 0 || lendo > 0) && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {imagens.map((i) => (
                <span key={i.id} className="relative">
                  <img src={i.previa} alt={i.nome} className="h-14 w-14 rounded-xl border border-border object-cover" />
                  <button type="button" aria-label={`Tirar ${i.nome}`} onClick={() => setImagens((l) => l.filter((x) => x.id !== i.id))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background"><X className="h-3 w-3" /></button>
                </span>
              ))}
              {docs.map((a) => (
                <span key={a.id} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-2.5 pr-1 text-[12px]" title={`${a.caracteres.toLocaleString("pt-BR")} caracteres lidos`}>
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{a.nome}</span>
                  <button type="button" aria-label={`Tirar ${a.nome}`} onClick={() => setDocs((l) => l.filter((x) => x.id !== a.id))} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted"><X className="h-3 w-3" /></button>
                </span>
              ))}
              {naoLidos.map((a) => (
                <span key={a.id} className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-warning/40 bg-warning/5 py-1 pl-2.5 pr-1 text-[12px] text-warning" title={a.motivo}>
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{a.nome}</span>
                  <button type="button" aria-label={`Tirar ${a.nome}`} onClick={() => setNaoLidos((l) => l.filter((x) => x.id !== a.id))} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted"><X className="h-3 w-3" /></button>
                </span>
              ))}
              {lendo > 0 && <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Lendo…</span>}
            </div>
          )}
          {gravando ? (
            <div className="flex items-center gap-2 rounded-[26px] border border-destructive/40 bg-background py-1.5 pl-4 pr-1.5 shadow-sm">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
              <span className="flex-1 text-[14px] tabular-nums text-foreground">Gravando {tempoDoAudio(gravando.segundos)}</span>
              <button type="button" onClick={() => pararGravacao(true)} className="flex h-9 items-center rounded-full px-3 text-[13px] text-muted-foreground hover:bg-muted" aria-label="Cancelar a gravação">Cancelar</button>
              <button type="button" onClick={() => pararGravacao(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-label="Enviar o áudio"><ArrowUp className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="flex items-end gap-1.5 rounded-[26px] border border-border bg-background py-1.5 pl-1.5 pr-1.5 shadow-sm focus-within:border-primary/50">
              <input ref={seletor} type="file" multiple className="hidden" onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }} />
              <button type="button" onClick={() => seletor.current?.click()} disabled={ocupado} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40" aria-label="Anexar arquivo, imagem ou áudio" title="Anexar arquivo, imagem ou áudio (ou arraste para cá)">
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                ref={campo}
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(rascunho); } }}
                onPaste={(e) => { const fs = e.clipboardData?.files; if (fs && fs.length) { e.preventDefault(); adicionar(fs); } }}
                rows={1}
                maxLength={4000}
                placeholder={temAnexo ? "Diga o que quer saber sobre o anexo…" : "Pergunte ao Gestor…"}
                aria-label="Pergunta ao Gestor Aceleriq"
                className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[14px] leading-5 outline-none placeholder:text-muted-foreground"
              />
              {!rascunho.trim() && !temAnexo && gravacaoPossivel ? (
                <button type="button" onClick={() => void comecarGravacao()} disabled={ocupado} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40" aria-label="Gravar áudio" title="Gravar áudio">
                  <Mic className="h-4 w-4" />
                </button>
              ) : (
                <button type="submit" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40" disabled={ocupado || (!rascunho.trim() && !temAnexo)} aria-label="Perguntar">
                  {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                </button>
              )}
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
