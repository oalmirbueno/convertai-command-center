import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, Bot, CalendarX2, Flame, CheckCircle2, ExternalLink, KeyRound, Megaphone, MessageCircle, RefreshCw, ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  CabecalhoDePagina, Carregando, EstadoDeErro, EstadoVazio, Secao, botao, espaco, etiqueta, juntar, larguraDaMesa, lista, texto,
} from "@/components/sistema";
import {
  destinoDaCampanha, destinoDoFeito, destinoDoPedido, destinoDoRisco, normalizarResumo, resumoEstaVazio, rpcAusente,
  type NivelDoDia, type ResumoDoDia, type TipoDoPedido,
} from "@/lib/resumoDoDia";

/*
 * Hoje (26/10/2026). Decisão do dono: "1 resumo por dia numa tela Hoje + 1
 * aviso no sino". A porta de entrada da área de agentes: o que precisa de
 * você, quem está sem post, o que mudou nos anúncios e o que ficou pronto
 * ontem com prova. Poucas linhas por seção; cada linha tem uma ação só.
 * Os dados saem da RPC resumo_do_dia (formato em src/lib/resumoDoDia.ts).
 */

const POR_SECAO = 5;

const quando = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
};

const ICONE_DO_PEDIDO: Record<TipoDoPedido, ReactNode> = {
  aprovacao: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
  vinculo: <Bot className="h-4 w-4" aria-hidden="true" />,
  mensagem: <MessageCircle className="h-4 w-4" aria-hidden="true" />,
  anuncio: <Megaphone className="h-4 w-4" aria-hidden="true" />,
  acesso: <KeyRound className="h-4 w-4" aria-hidden="true" />,
  outro: <ArrowRight className="h-4 w-4" aria-hidden="true" />,
};

const TOM_DO_NIVEL: Record<NivelDoDia, string> = {
  critico: "bg-destructive/10 text-destructive",
  atencao: "bg-warning/10 text-warning",
  info: "bg-muted text-muted-foreground",
};
const NOME_DO_NIVEL: Record<NivelDoDia, string> = { critico: "Urgente", atencao: "Atenção", info: "Info" };

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

/** Mostra as primeiras linhas; o resto abre num toque ("mais N"). */
function Linhas<T>({ itens, rotulo, linha }: { itens: T[]; rotulo: string; linha: (x: T) => ReactNode }) {
  const [todas, setTodas] = useState(false);
  const visiveis = todas ? itens : itens.slice(0, POR_SECAO);
  return (
    <>
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label={rotulo}>{visiveis.map(linha)}</ul>
      {itens.length > POR_SECAO && (
        <button type="button" onClick={() => setTodas(!todas)} className={juntar(botao.discreto, "relative -left-3 mt-1 h-8 text-[12px]")}>
          {todas ? "Mostrar menos" : `Mais ${itens.length - POR_SECAO}`}
        </button>
      )}
    </>
  );
}

/** Uma linha: ícone, o quê, uma linha de apoio e a ação (a linha inteira é o link). */
function Linha({ icone, tom, principal, apoio, acao, para, externo, dados }: {
  icone: ReactNode; tom?: string; principal: ReactNode; apoio?: ReactNode; acao: string; para?: string | null; externo?: string | null; dados?: Record<string, string>;
}) {
  const miolo = (
    <>
      <span className={juntar("mr-2.5 mt-0.5 shrink-0 self-start", tom || "text-muted-foreground")}>{icone}</span>
      <span className="min-w-0 flex-1">
        <span className={juntar(texto.corpo, "block font-medium [overflow-wrap:anywhere]")}>{principal}</span>
        {apoio ? <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{apoio}</span> : null}
      </span>
      {(para || externo) && <span className={juntar(botao.icone, "ml-2 self-center")} title={acao} aria-hidden="true">{externo ? <ExternalLink className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}</span>}
    </>
  );
  const classe = juntar(lista.linha, "items-start");
  return (
    <li {...dados}>
      {externo ? (
        <a href={externo} target="_blank" rel="noopener noreferrer" className={classe} title={acao} aria-label={`${acao}: ${typeof principal === "string" ? principal : ""}`}>{miolo}</a>
      ) : para ? (
        <Link to={para} className={classe} title={acao} aria-label={`${acao}: ${typeof principal === "string" ? principal : ""}`}>{miolo}</Link>
      ) : (
        <div className={classe}>{miolo}</div>
      )}
    </li>
  );
}

export default function Hoje() {
  const consulta = useResumoDoDia();
  const r = consulta.data?.resumo;
  const pedidos = r?.precisaDeVoce ?? [];

  return (
    <div className={juntar(larguraDaMesa, espaco.pagina, "pb-10")} data-hoje="">
      <CabecalhoDePagina
        titulo="Hoje"
        descricao={r?.geradoEm ? `Resumo de ${quando(r.geradoEm)}` : consulta.isLoading ? undefined : "Sem resumo ainda"}
        ajuda="Um resumo por dia do trabalho dos agentes: o que só você decide, quem está sem post, o que mudou nos anúncios e o que ficou pronto ontem com prova. Cada linha leva direto ao lugar certo. O sino avisa uma vez por dia."
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
                <Secao titulo="Precisa de você" descricao={pedidos.length ? `${pedidos.length} ${pedidos.length === 1 ? "decisão" : "decisões"}` : "Nada esperando você"} recolher="hoje:precisa">
                  {pedidos.length === 0 ? <EstadoVazio compacto titulo="Nada esperando você." /> : (
                    <Linhas itens={pedidos} rotulo="Precisa de você" linha={(p) => {
                      const d = destinoDoPedido(p);
                      return <Linha key={p.chave} dados={{ "data-pedido-do-dia": p.tipo }} icone={ICONE_DO_PEDIDO[p.tipo]} tom="text-warning" principal={p.nome} apoio={p.motivo} acao={d.rotulo} para={d.rota} />;
                    }} />
                  )}
                </Secao>

                {r.clientesEmRisco.length > 0 && (
                  <Secao titulo="Clientes sem post" descricao={`${r.clientesEmRisco.length}`} recolher="hoje:calendario" divisoria>
                    <Linhas itens={r.clientesEmRisco} rotulo="Clientes sem post" linha={(c) => (
                      <Linha
                        key={c.clientId}
                        dados={{ "data-risco": c.clientId }}
                        icone={<CalendarX2 className="h-4 w-4" aria-hidden="true" />}
                        tom={c.diasSemPost !== null && c.diasSemPost >= 7 ? "text-destructive" : "text-warning"}
                        principal={`${c.nome} · ${c.diasSemPost !== null ? `${c.diasSemPost} ${c.diasSemPost === 1 ? "dia" : "dias"} sem post` : c.situacao}`}
                        apoio={[c.falta, c.sugestao].filter(Boolean).join(" · ") || undefined}
                        acao="Abrir a pauta na Mesa"
                        para={destinoDoRisco(c)}
                      />
                    )} />
                  </Secao>
                )}

                {r.campanhas.length > 0 && (
                  <Secao titulo="Dá para fazer campanha" descricao={`${r.campanhas.length}`} recolher="hoje:campanhas" divisoria>
                    <Linhas itens={r.campanhas} rotulo="Dá para fazer campanha" linha={(c) => (
                      <Linha
                        key={c.clientId}
                        dados={{ "data-campanha-do-dia": c.clientId }}
                        icone={<Flame className="h-4 w-4" aria-hidden="true" />}
                        tom="text-primary"
                        principal={`${c.nome} · ${c.tema}`}
                        apoio={c.porQue}
                        acao="Abrir Campanhas"
                        para={destinoDaCampanha(c)}
                      />
                    )} />
                  </Secao>
                )}

                {(r.alertas.length > 0 || r.mudancas.length > 0) && (
                  <Secao
                    titulo="Anúncios"
                    descricao={[r.alertas.length ? `${r.alertas.length} ${r.alertas.length === 1 ? "alerta" : "alertas"}` : "", r.mudancas.length ? `${r.mudancas.length} ${r.mudancas.length === 1 ? "mudança" : "mudanças"}` : ""].filter(Boolean).join(" · ")}
                    recolher="hoje:anuncios"
                    divisoria
                    acao={<Link to="/anuncios/hoje" className={botao.icone} title="Abrir Anúncios hoje" aria-label="Abrir Anúncios hoje"><Megaphone className="h-4 w-4" aria-hidden="true" /></Link>}
                  >
                    <Linhas
                      itens={[...r.alertas.map((a) => ({ alerta: a, mudanca: null })), ...r.mudancas.map((m) => ({ alerta: null, mudanca: m }))]}
                      rotulo="Anúncios"
                      linha={({ alerta, mudanca }) => alerta ? (
                        <Linha
                          key={alerta.chave}
                          dados={{ "data-alerta-do-dia": alerta.nivel }}
                          icone={<span className={juntar(etiqueta, TOM_DO_NIVEL[alerta.nivel])}>{NOME_DO_NIVEL[alerta.nivel]}</span>}
                          principal={alerta.cliente ? `${alerta.cliente}: ${alerta.texto}` : alerta.texto}
                          acao="Abrir Anúncios hoje"
                          para="/anuncios/hoje"
                        />
                      ) : mudanca ? (
                        <Linha
                          key={mudanca.chave}
                          dados={{ "data-mudanca-do-dia": "" }}
                          icone={<Megaphone className="h-4 w-4" aria-hidden="true" />}
                          principal={`${mudanca.cliente} · ${mudanca.acao}${mudanca.alvo ? ` ${mudanca.alvo}` : ""}`}
                          apoio={[(mudanca.antes || mudanca.depois) ? `${mudanca.antes || "-"} → ${mudanca.depois || "-"}` : "", mudanca.quem, quando(mudanca.quando)].filter(Boolean).join(" · ")}
                          acao={mudanca.provaUrl ? "Ver a prova" : "Abrir Anúncios hoje"}
                          externo={mudanca.provaUrl && /^https?:\/\//i.test(mudanca.provaUrl) ? mudanca.provaUrl : null}
                          para="/anuncios/hoje"
                        />
                      ) : null}
                    />
                  </Secao>
                )}

                <Secao titulo="Feito ontem com prova" descricao={r.feitoOntem.length ? `${r.feitoOntem.length}` : "Nada entregue com prova ontem"} recolher="hoje:feito" divisoria>
                  {r.feitoOntem.length === 0 ? <EstadoVazio compacto titulo="Nenhuma entrega com prova ontem." /> : (
                    <Linhas itens={r.feitoOntem} rotulo="Feito ontem com prova" linha={(f) => {
                      const d = destinoDoFeito(f);
                      return <Linha key={f.chave} dados={{ "data-feito": "" }} icone={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} tom="text-success" principal={f.nome} apoio={[f.agente, quando(f.quando)].filter(Boolean).join(" · ") || undefined} acao={d.externo ? "Ver a prova" : "Abrir o diário"} externo={d.externo} para={d.rota} />;
                    }} />
                  )}
                </Secao>

              </>}
    </div>
  );
}
