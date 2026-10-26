import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, Bot, CheckCircle2, ExternalLink, Flame, KeyRound, Megaphone, MessageCircle, RefreshCw, ShieldCheck, Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LogoDoCliente, { useIdentidadesDosClientes } from "@/components/admin/LogoDoCliente";
import {
  CabecalhoDePagina, Carregando, EstadoDeErro, EstadoVazio, FaixaDeNumeros, Secao, botao, espaco, etiqueta, foco, juntar, larguraDaMesa, superficie, texto,
} from "@/components/sistema";
import {
  destinoDaCampanha, destinoDoFeito, destinoDoPedido, destinoDoRisco, normalizarResumo, resumoEstaVazio, rpcAusente,
  type ClienteEmRisco, type NivelDoDia, type ResumoDoDia, type TipoDoPedido,
} from "@/lib/resumoDoDia";

/*
 * Hoje (26/10/2026). Decisão do dono: "1 resumo por dia numa tela Hoje + 1
 * aviso no sino". Redesenho da tarde (dono: "mais intuitiva, menos poluída,
 * mais organizadinha; não em lista assim"): os números do dia no topo, e cada
 * coisa vira um cartão numa grade alinhada, com UMA ação (o cartão inteiro é o
 * link). Precisa de você primeiro; clientes sem post com a logo, os dias sem
 * post em destaque e a barra do mês; anúncios em mini-indicadores; o feito de
 * ontem compacto. Os dados saem da RPC resumo_do_dia (src/lib/resumoDoDia.ts).
 */

/** Cartões por seção antes do "Mais N" (lista longa não empurra a tela). */
const POR_SECAO = 8;

const quando = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
};

const CARA_DO_PEDIDO: Record<TipoDoPedido, { icone: ReactNode; rotulo: string }> = {
  aprovacao: { icone: <ShieldCheck className="h-4 w-4" aria-hidden="true" />, rotulo: "Aprovação" },
  vinculo: { icone: <Bot className="h-4 w-4" aria-hidden="true" />, rotulo: "Agente pergunta" },
  mensagem: { icone: <MessageCircle className="h-4 w-4" aria-hidden="true" />, rotulo: "Mensagem" },
  anuncio: { icone: <Megaphone className="h-4 w-4" aria-hidden="true" />, rotulo: "Anúncio" },
  acesso: { icone: <KeyRound className="h-4 w-4" aria-hidden="true" />, rotulo: "Acesso" },
  outro: { icone: <ArrowRight className="h-4 w-4" aria-hidden="true" />, rotulo: "Pedido" },
};

const TOM_DO_NIVEL: Record<NivelDoDia, string> = {
  critico: "bg-destructive/10 text-destructive",
  atencao: "bg-warning/10 text-warning",
  info: "bg-muted text-muted-foreground",
};
const NOME_DO_NIVEL: Record<NivelDoDia, string> = { critico: "Urgente", atencao: "Atenção", info: "Info" };

/** Cartão-link da grade: a coisa inteira é a ação (1 por cartão). */
const cartaoLink = juntar(superficie.painel, "group flex h-full min-w-0 flex-col p-4 transition-colors hover:border-primary/40", foco);
const grade4 = juntar(espaco.grade, "sm:grid-cols-2 xl:grid-cols-4");

type Leitura = { resumo: ResumoDoDia; ausente: boolean };

export function useResumoDoDia() {
  return useQuery({
    queryKey: ["resumo-do-dia"],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<Leitura> => {
      const { data, error } = await (supabase as any).rpc("resumo_do_dia");
      if (error) {
        if (rpcAusente(error)) return { resumo: normalizarResumo(null), ausente: true };
        throw new Error(error.message);
      }
      return { resumo: normalizarResumo(data), ausente: false };
    },
  });
}

/** "Cliente · Área · assunto": o assunto em destaque, cliente e área em cima. */
function partesDoNome(nome: string): { origem: string; assunto: string } {
  const partes = nome.split(" · ");
  if (partes.length < 2) return { origem: "", assunto: nome };
  return { origem: partes.slice(0, -1).join(" · "), assunto: partes[partes.length - 1] };
}

/** Mostra os primeiros cartões; o resto entra num toque ("Mais N"). */
function Grade<T>({ itens, rotulo, classe = grade4, cartao }: { itens: T[]; rotulo: string; classe?: string; cartao: (x: T) => ReactNode }) {
  const [todas, setTodas] = useState(false);
  const visiveis = todas ? itens : itens.slice(0, POR_SECAO);
  return (
    <>
      <ul className={classe} aria-label={rotulo}>{visiveis.map(cartao)}</ul>
      {itens.length > POR_SECAO && (
        <button type="button" onClick={() => setTodas(!todas)} className={juntar(botao.discreto, "relative -left-3 mt-2 h-8 text-[12px]")}>
          {todas ? "Mostrar menos" : `Mais ${itens.length - POR_SECAO}`}
        </button>
      )}
    </>
  );
}

/** O cartão é um link interno ou externo (prova); sem destino, só o cartão. */
function CartaoQueLeva({ para, externo, rotulo, compacto = false, children }: { para?: string | null; externo?: string | null; rotulo: string; compacto?: boolean; children: ReactNode }) {
  const classe = juntar(cartaoLink, compacto && "p-3");
  if (externo) return <a href={externo} target="_blank" rel="noopener noreferrer" className={classe} title={rotulo} aria-label={rotulo}>{children}</a>;
  if (para) return <Link to={para} className={classe} title={rotulo} aria-label={rotulo}>{children}</Link>;
  return <div className={juntar(superficie.painel, "flex h-full min-w-0 flex-col", compacto ? "p-3" : "p-4")}>{children}</div>;
}

/** O pé do cartão: o nome da ação e a seta (o cartão inteiro é o clique). */
function PeDaAcao({ rotulo, externo = false }: { rotulo: string; externo?: boolean }) {
  return (
    <span className={juntar(texto.auxiliar, "mt-auto flex min-w-0 items-center pt-3 font-medium text-primary")}>
      <span className="min-w-0 truncate">{rotulo}</span>
      {externo ? <ExternalLink className="ml-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ArrowRight className="ml-1.5 h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
    </span>
  );
}

/** Barra do mês: quanto do calendário está pronto, com o tracinho de hoje. */
function BarraDoMes({ pct }: { pct: number | null }) {
  const agora = new Date();
  const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const hoje = Math.round((agora.getDate() / diasNoMes) * 100);
  if (pct === null) return <p className={juntar(texto.auxiliar, "mt-3")}>Mês sem leitura do calendário</p>;
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const cor = p >= hoje ? "bg-success" : p >= hoje - 20 ? "bg-warning" : "bg-destructive";
  return (
    <div className="mt-3 min-w-0" data-barra-do-mes={p}>
      <p className={juntar(texto.auxiliar, "flex items-baseline")}>
        <span>Mês</span>
        <span className="ml-auto tabular-nums"><span className="font-medium text-foreground">{p}%</span> pronto</span>
      </p>
      <div className="relative mt-1 h-1.5 w-full rounded-full bg-muted" role="img" aria-label={`Calendário do mês ${p}% pronto; hoje é ${hoje}% do mês`} title={`${p}% do mês pronto · hoje = ${hoje}% do mês`}>
        <div className={juntar("h-full rounded-full", cor)} style={{ width: `${p}%` }} />
        <span className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-foreground/60" style={{ left: `calc(${hoje}% - 1px)` }} aria-hidden="true" />
      </div>
    </div>
  );
}

function CartaoDeRisco({ c, logo }: { c: ClienteEmRisco; logo: string | null }) {
  const grave = c.diasSemPost !== null && c.diasSemPost >= 7;
  return (
    <li className="min-w-0" data-risco={c.clientId}>
      <CartaoQueLeva para={destinoDoRisco(c)} rotulo={`Abrir a pauta na Mesa: ${c.nome}`}>
        <span className="flex min-w-0 items-start">
          <LogoDoCliente url={logo} nome={c.nome} tamanho={36} className="mr-3" />
          <span className="min-w-0 flex-1">
            <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
            <span className={juntar(texto.auxiliar, "block truncate")}>{c.falta || c.situacao}</span>
          </span>
          <span className="ml-3 shrink-0 text-right">
            <span className={juntar(texto.numero, "block", grave ? "text-destructive" : c.diasSemPost === null ? "text-muted-foreground" : "text-warning")}>{c.diasSemPost === null ? "–" : c.diasSemPost}</span>
            <span className={juntar(texto.etiqueta, "block text-muted-foreground")}>{c.diasSemPost === null ? c.situacao : c.diasSemPost === 1 ? "dia sem post" : "dias sem post"}</span>
          </span>
        </span>
        <BarraDoMes pct={c.pctMes} />
        {c.sugestao && <span className={juntar(texto.auxiliar, "mt-2 flex min-w-0 items-center")}><Sparkles className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 truncate">{c.sugestao}</span></span>}
        <PeDaAcao rotulo="Abrir a pauta" />
      </CartaoQueLeva>
    </li>
  );
}

export default function Hoje() {
  const consulta = useResumoDoDia();
  const identidades = useIdentidadesDosClientes();
  const r = consulta.data?.resumo;
  const pedidos = r?.precisaDeVoce ?? [];
  const logoDe = (id: string | null) => (id ? identidades.data?.get(id)?.profile_picture_url ?? null : null);
  const irPara = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const urgentes = r ? r.alertas.filter((a) => a.nivel === "critico").length : 0;
  const atencao = r ? r.alertas.filter((a) => a.nivel === "atencao").length : 0;

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-hoje="">
      <CabecalhoDePagina
        titulo="Hoje"
        descricao={r?.geradoEm ? `Resumo de ${quando(r.geradoEm)}` : consulta.isLoading ? undefined : "Sem resumo ainda"}
        ajuda="Um resumo por dia do trabalho dos agentes: o que só você decide, quem está sem post, o que mudou nos anúncios e o que ficou pronto ontem com prova. Cada cartão leva direto ao lugar certo. O sino avisa uma vez por dia."
        acoes={<>
          <Link to="/execucao" className={botao.icone} title="Abrir a Execução (todos os agentes)" aria-label="Abrir a Execução"><Bot className="h-4 w-4" aria-hidden="true" /></Link>
          <button type="button" onClick={() => void consulta.refetch()} className={botao.icone} title="Atualizar" aria-label="Atualizar"><RefreshCw className={juntar("h-4 w-4", consulta.isFetching && "animate-spin")} aria-hidden="true" /></button>
        </>}
      />

      {consulta.isLoading ? <Carregando linhas={4} rotulo="Lendo o resumo do dia" />
        : consulta.error ? <EstadoDeErro titulo="Não foi possível ler o resumo do dia." descricao={(consulta.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => void consulta.refetch()}>Tentar de novo</button>} />
          : consulta.data?.ausente ? <EstadoVazio titulo="O resumo do dia ainda não chega a este painel." descricao="Falta ligar o resumo no servidor. Enquanto isso, a Execução mostra o que espera você." acao={<Link to="/execucao" className={botao.secundario}>Abrir a Execução</Link>} />
            : !r || resumoEstaVazio(r) ? <EstadoVazio icone={<CheckCircle2 className="h-5 w-5" />} titulo="Nada para hoje." descricao="Nenhuma decisão pendente, nenhum cliente sem post e nada mudou nos anúncios." />
              : <>
                <FaixaDeNumeros
                  rotulo="O dia em números"
                  colunas={4}
                  data-numeros-do-dia=""
                  itens={[
                    { rotulo: "Precisa de você", valor: String(pedidos.length), ponto: pedidos.length ? "alerta" : "verde", corDoValor: pedidos.length ? "text-warning" : undefined, apoio: pedidos.length ? (pedidos.length === 1 ? "decisão sua" : "decisões suas") : "nada esperando", aoClicar: irPara("hoje-precisa"), dica: "Ir para Precisa de você" },
                    { rotulo: "Clientes sem post", valor: String(r.clientesEmRisco.length), ponto: r.clientesEmRisco.length ? "perigo" : "verde", apoio: r.clientesEmRisco.length ? `o pior: ${r.clientesEmRisco[0].diasSemPost ?? "-"} dias` : "calendário em dia", aoClicar: irPara("hoje-calendario"), dica: "Ir para Clientes sem post" },
                    { rotulo: "Anúncios", valor: String(r.alertas.length + r.mudancas.length), ponto: urgentes ? "perigo" : atencao ? "alerta" : "neutro", apoio: `${urgentes} urgente${urgentes === 1 ? "" : "s"} · ${r.mudancas.length} ${r.mudancas.length === 1 ? "mudança" : "mudanças"}`, para: "/anuncios/hoje", dica: "Abrir Anúncios hoje" },
                    { rotulo: "Feito ontem", valor: String(r.feitoOntem.length), ponto: r.feitoOntem.length ? "verde" : "neutro", apoio: "com prova", aoClicar: irPara("hoje-feito"), dica: "Ir para Feito ontem" },
                  ]}
                />

                <Secao id="hoje-precisa" titulo="Precisa de você" descricao={pedidos.length ? `${pedidos.length} ${pedidos.length === 1 ? "decisão" : "decisões"}` : "Nada esperando você"} recolher="hoje:precisa">
                  {pedidos.length === 0 ? <EstadoVazio compacto titulo="Nada esperando você." descricao="Os agentes seguem sozinhos." /> : (
                    <Grade itens={pedidos} rotulo="Precisa de você" cartao={(p) => {
                      const d = destinoDoPedido(p);
                      const cara = CARA_DO_PEDIDO[p.tipo];
                      const { origem, assunto } = partesDoNome(p.nome);
                      return (
                        <li key={p.chave} className="min-w-0" data-pedido-do-dia={p.tipo}>
                          <CartaoQueLeva para={d.rota} rotulo={`${d.rotulo}: ${p.nome}`}>
                            <span className="flex min-w-0 items-center">
                              <span className="mr-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">{cara.icone}</span>
                              <span className={juntar(texto.etiqueta, "min-w-0 truncate text-muted-foreground")}>{cara.rotulo}</span>
                            </span>
                            {origem && <span className={juntar(texto.auxiliar, "mt-3 block truncate")}>{origem}</span>}
                            <span className={juntar(texto.corpo, "mt-0.5 line-clamp-2 font-medium [overflow-wrap:anywhere]", !origem && "mt-3")}>{assunto}</span>
                            {p.motivo && <span className={juntar(texto.auxiliar, "mt-1 block truncate")} title={p.motivo}>{p.motivo}</span>}
                            <PeDaAcao rotulo={d.rotulo} />
                          </CartaoQueLeva>
                        </li>
                      );
                    }} />
                  )}
                </Secao>

                {r.clientesEmRisco.length > 0 && (
                  <Secao id="hoje-calendario" titulo="Clientes sem post" descricao={`${r.clientesEmRisco.length}`} recolher="hoje:calendario">
                    <Grade itens={r.clientesEmRisco} rotulo="Clientes sem post" cartao={(c) => <CartaoDeRisco key={c.clientId} c={c} logo={logoDe(c.clientId)} />} />
                  </Secao>
                )}

                {r.campanhas.length > 0 && (
                  <Secao titulo="Dá para fazer campanha" descricao={`${r.campanhas.length}`} recolher="hoje:campanhas">
                    <Grade itens={r.campanhas} rotulo="Dá para fazer campanha" cartao={(c) => (
                      <li key={c.clientId} className="min-w-0" data-campanha-do-dia={c.clientId}>
                        <Link to={destinoDaCampanha(c)} className={juntar(cartaoLink, "flex-row items-center p-3")} title="Abrir Campanhas" aria-label={`Abrir Campanhas: ${c.nome} · ${c.tema}`}>
                          <LogoDoCliente url={logoDe(c.clientId)} nome={c.nome} tamanho={32} className="mr-3" />
                          <span className="min-w-0 flex-1">
                            <span className={juntar(texto.corpo, "flex min-w-0 items-center font-medium")}><Flame className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 truncate">{c.tema}</span></span>
                            <span className={juntar(texto.auxiliar, "block truncate")} title={c.porQue || undefined}>{c.nome}{c.porQue ? ` · ${c.porQue}` : ""}</span>
                          </span>
                          <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                        </Link>
                      </li>
                    )} />
                  </Secao>
                )}

                {(r.alertas.length > 0 || r.mudancas.length > 0) && (
                  <Secao
                    titulo="Anúncios"
                    descricao={[r.alertas.length ? `${r.alertas.length} ${r.alertas.length === 1 ? "alerta" : "alertas"}` : "", r.mudancas.length ? `${r.mudancas.length} ${r.mudancas.length === 1 ? "mudança" : "mudanças"}` : ""].filter(Boolean).join(" · ")}
                    recolher="hoje:anuncios"
                    acao={<Link to="/anuncios/hoje" className={botao.icone} title="Abrir Anúncios hoje" aria-label="Abrir Anúncios hoje"><Megaphone className="h-4 w-4" aria-hidden="true" /></Link>}
                  >
                    <div className={juntar(espaco.grade, "lg:grid-cols-2")}>
                      {r.alertas.length > 0 && (
                        <ul className="min-w-0 space-y-2" aria-label="Alertas dos anúncios">
                          {r.alertas.slice(0, 4).map((a) => (
                            <li key={a.chave} className="min-w-0" data-alerta-do-dia={a.nivel}>
                              <Link to="/anuncios/hoje" className={juntar(cartaoLink, "flex-row items-center p-3")} title="Abrir Anúncios hoje">
                                <span className={juntar(etiqueta, "mr-2.5 w-16 justify-center", TOM_DO_NIVEL[a.nivel])}>{NOME_DO_NIVEL[a.nivel]}</span>
                                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{a.cliente ? <span className="font-medium">{a.cliente} </span> : null}<span className="text-muted-foreground">{a.texto}</span></span>
                              </Link>
                            </li>
                          ))}
                          {r.alertas.length > 4 && <li className={texto.auxiliar}>+{r.alertas.length - 4} no Anúncios hoje</li>}
                        </ul>
                      )}
                      {r.mudancas.length > 0 && (
                        <ul className="min-w-0 space-y-2" aria-label="Mudanças nos anúncios">
                          {r.mudancas.slice(0, 4).map((m) => {
                            const prova = m.provaUrl && /^https?:\/\//i.test(m.provaUrl) ? m.provaUrl : null;
                            return (
                              <li key={m.chave} className="min-w-0" data-mudanca-do-dia="">
                                <CartaoQueLeva compacto externo={prova} para="/anuncios/hoje" rotulo={prova ? `Ver a prova: ${m.cliente} · ${m.acao}` : `Abrir Anúncios hoje: ${m.cliente} · ${m.acao}`}>
                                  <span className={juntar(texto.corpo, "flex min-w-0 items-center")}>
                                    <Bot className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate"><span className="font-medium">{m.cliente}</span> <span className="text-muted-foreground">{m.acao}{m.alvo ? ` ${m.alvo}` : ""}</span></span>
                                    {prova && <ExternalLink className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                                  </span>
                                  {(m.antes || m.depois) && <span className={juntar(texto.auxiliar, "mt-1 block truncate pl-[22px] tabular-nums")}>{`${m.antes || "-"} → ${m.depois || "-"}`}{m.quem ? ` · ${m.quem}` : ""}</span>}
                                </CartaoQueLeva>
                              </li>
                            );
                          })}
                          {r.mudancas.length > 4 && <li className={texto.auxiliar}>+{r.mudancas.length - 4} no Anúncios hoje</li>}
                        </ul>
                      )}
                    </div>
                  </Secao>
                )}

                <Secao id="hoje-feito" titulo="Feito ontem com prova" descricao={r.feitoOntem.length ? `${r.feitoOntem.length}` : "Nada entregue com prova ontem"} recolher="hoje:feito">
                  {r.feitoOntem.length === 0 ? <EstadoVazio compacto titulo="Nenhuma entrega com prova ontem." /> : (
                    <Grade itens={r.feitoOntem} rotulo="Feito ontem com prova" classe={juntar(espaco.grade, "gap-2 sm:grid-cols-2 xl:grid-cols-4")} cartao={(f) => {
                      const d = destinoDoFeito(f);
                      const { origem, assunto } = partesDoNome(f.nome);
                      return (
                        <li key={f.chave} className="min-w-0" data-feito="">
                          <CartaoQueLeva compacto externo={d.externo} para={d.rota} rotulo={`${d.externo ? "Ver a prova" : "Abrir o diário"}: ${f.nome}`}>
                            <span className="flex min-w-0 items-center">
                              <CheckCircle2 className="mr-2 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{assunto}</span>
                              {d.externo && <ExternalLink className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                            </span>
                            <span className={juntar(texto.auxiliar, "mt-0.5 block truncate pl-6")}>{[origem, f.agente, quando(f.quando)].filter(Boolean).join(" · ")}</span>
                          </CartaoQueLeva>
                        </li>
                      );
                    }} />
                  )}
                </Secao>
              </>}
    </div>
  );
}
