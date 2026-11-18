import NumerosOusados from "@/components/admin/NumerosOusados";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { StatusDot, type Tone } from "@/components/ds";
import {
  lerMonitor,
  lerMonitorDaConta,
  reais,
  ROTULO_DO_ESTADO,
  type EmpresaNoMonitor,
  type NivelDaSaude,
} from "@/lib/produto/api";
import { Carregando, EstadoDeErro, EstadoVazio, JanelaCentral, Secao, botao, etiqueta, juntar, lista, superficie, texto } from "@/components/sistema";

/**
 * O monitor do produto, para a administração da casa (18/11/2026): se está
 * tudo em ordem (e-mails, cobrança, rotinas, integrações, convites) e o
 * movimento do CRM de cada empresa, relido sozinho a cada 15 segundos.
 * Mostra números e movimento; o nome dos leads de cada empresa não aparece.
 */

const RELER_A_CADA = 15_000;
const TOM: Record<NivelDaSaude, Tone> = { ok: "success", atencao: "warning", problema: "danger" };
const PESO: Record<NivelDaSaude, number> = { problema: 0, atencao: 1, ok: 2 };
const ETAPA: Record<string, string> = { novo: "Novo", contato: "Contato", diagnostico: "Diagnóstico", proposta: "Proposta", negociacao: "Negociação", ganho: "Ganho no mês", perdido: "Perdido no mês" };
const ORDEM_DAS_ETAPAS = ["novo", "contato", "diagnostico", "proposta", "negociacao", "ganho", "perdido"];
const PAPEL: Record<string, string> = { admin: "administra", gerente: "gerente", usuario: "vendedor" };

const etapa = (id: string | null) => (id ? ETAPA[id] || id : "");

/** "agora", "há 4 min", "há 3 h", "há 2 dias" ou "nunca". */
export function haQuanto(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return "nunca";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "nunca";
  const min = Math.floor((agora - t) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/** Mexeram no CRM nos últimos 10 minutos. */
const emUsoAgora = (e: EmpresaNoMonitor, agora: number) => !!e.ultima_atividade && agora - new Date(e.ultima_atividade).getTime() < 600_000;

/** O relógio que faz "há 2 min" andar entre uma releitura e outra. */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

export default function MonitorDoProduto() {
  const monitor = useQuery({ queryKey: ["produto", "casa", "monitor"], queryFn: lerMonitor, refetchInterval: RELER_A_CADA });
  const agora = useAgora();
  const [aberta, setAberta] = useState<string | null>(null);

  if (monitor.isLoading) return <Carregando linhas={6} rotulo="Carregando o monitor" />;
  if (monitor.isError || !monitor.data) {
    return <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void monitor.refetch()}>Tentar de novo</button>} />;
  }

  const { saude, empresas } = monitor.data;
  const pontos = saude.slice().sort((a, b) => PESO[a.nivel] - PESO[b.nivel]);
  const problemas = saude.filter((s) => s.nivel === "problema").length;
  const atencoes = saude.filter((s) => s.nivel === "atencao").length;
  const geral: NivelDaSaude = problemas ? "problema" : atencoes ? "atencao" : "ok";
  const frase = problemas
    ? `${problemas} ${problemas === 1 ? "problema" : "problemas"} para resolver${atencoes ? ` e ${atencoes} para olhar` : ""}`
    : atencoes
      ? `${atencoes} ${atencoes === 1 ? "ponto pede" : "pontos pedem"} atenção`
      : "Tudo em ordem";
  const somar = (campo: "novos_hoje" | "movimentos_hoje" | "abertos" | "valor_aberto" | "tarefas_atrasadas") => empresas.reduce((s, e) => s + e[campo], 0);
  const usando = empresas.filter((e) => emUsoAgora(e, agora)).length;
  const empresaAberta = empresas.filter((e) => e.id === aberta)[0] || null;

  return (
    <div className="min-w-0 space-y-5" data-monitor-do-produto="">
      <div className={juntar(superficie.painel, "flex min-w-0 flex-wrap items-center px-4 py-3")} data-saude-geral={geral}>
        <StatusDot tone={TOM[geral]} pulse={geral !== "ok"} />
        <span className={juntar(texto.corpo, "ml-3 min-w-0 flex-1 font-medium")}>{frase}</span>
        <span className={juntar(texto.apoio, "ml-3 tabular-nums")} aria-live="off">
          ao vivo · lido {haQuanto(new Date(monitor.dataUpdatedAt).toISOString(), agora)}
        </span>
        <button type="button" className={juntar(botao.icone, "ml-2")} onClick={() => void monitor.refetch()} aria-label="Reler agora" title="Reler agora">
          <RefreshCw className={juntar("h-4 w-4", monitor.isFetching ? "animate-spin" : "")} aria-hidden="true" />
        </button>
      </div>

      <NumerosOusados
        rotulo="O dia nos CRMs"
        itens={[
          { rotulo: "Usando agora", valor: String(usando), apoio: `de ${empresas.length} ${empresas.length === 1 ? "empresa" : "empresas"}`, ponto: usando ? "verde" : undefined },
          { rotulo: "Leads novos hoje", valor: String(somar("novos_hoje")) },
          { rotulo: "Movimentos hoje", valor: String(somar("movimentos_hoje")) },
          { rotulo: "Em aberto", valor: reais(somar("valor_aberto")), apoio: `${somar("abertos")} negócios` },
        ]}
      />

      <Secao titulo="Está tudo em ordem?" descricao={`${saude.length - problemas - atencoes} de ${saude.length} em ordem`}>
        <ul className={juntar(superficie.painel, lista.divisoria, "px-2 py-1.5 sm:px-3")} data-lista-da-saude="">
          {pontos.map((s) => (
            <li key={s.chave} className={juntar(lista.linha, "items-start hover:bg-transparent")} data-saude={s.chave} data-nivel={s.nivel}>
              <StatusDot tone={TOM[s.nivel]} className="mt-1.5" />
              <span className="ml-3 min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block font-medium")}>{s.titulo}</span>
                <span className={juntar(texto.apoio, "block")}>{s.resumo}</span>
                {s.detalhe && <span className={juntar(texto.apoio, "mt-0.5 block break-words", s.nivel === "problema" ? "text-destructive" : "")}>{s.detalhe}</span>}
              </span>
              {s.quando && <span className={juntar(texto.apoio, "ml-3 shrink-0 text-right tabular-nums")}>{s.rotulo_quando} {haQuanto(s.quando, agora)}</span>}
            </li>
          ))}
        </ul>
      </Secao>

      <Secao titulo="O CRM de cada empresa" descricao="Quem mexeu por último aparece primeiro. Abra uma empresa para ver o funil, as pessoas e os movimentos.">
        {empresas.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhuma empresa ainda." />
        ) : (
          <ul className={juntar(superficie.painel, lista.divisoria, "px-2 py-1.5 sm:px-3")} data-lista-do-monitor="">
            {empresas.map((e) => (
              <li key={e.id}>
                <button type="button" className={juntar(lista.linha, "w-full text-left")} onClick={() => setAberta(e.id)} data-empresa-no-monitor={e.id}>
                  <StatusDot tone={emUsoAgora(e, agora) ? "success" : "neutral"} pulse={emUsoAgora(e, agora)} />
                  <span className="ml-3 min-w-0 flex-1">
                    <span className="flex min-w-0 items-center">
                      <span className={juntar(texto.corpo, "truncate font-medium")}>{e.nome}</span>
                      {!e.liberada && <span className={juntar(etiqueta, "ml-2 bg-danger-soft text-destructive")}>sem acesso</span>}
                      {e.tarefas_atrasadas > 0 && <span className={juntar(etiqueta, "ml-2 bg-warning-soft text-warning")}>{e.tarefas_atrasadas} {e.tarefas_atrasadas === 1 ? "tarefa atrasada" : "tarefas atrasadas"}</span>}
                    </span>
                    <span className={juntar(texto.apoio, "block truncate")}>
                      {ROTULO_DO_ESTADO[e.estado].toLowerCase()} · {e.usuarios_ativos} {e.usuarios_ativos === 1 ? "usuário" : "usuários"}
                      {e.convites ? ` · ${e.convites} sem entrar` : ""} · mexeram {haQuanto(e.ultima_atividade, agora)} · entraram {haQuanto(e.ultimo_acesso, agora)}
                    </span>
                  </span>
                  <span className="ml-3 hidden shrink-0 text-right sm:block">
                    <span className={juntar(texto.corpo, "block tabular-nums")}>{e.novos_hoje} hoje · {e.novos_7d} em 7 dias</span>
                    <span className={juntar(texto.apoio, "block tabular-nums")}>{e.abertos} em aberto · {reais(e.valor_aberto)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {empresaAberta && <EmpresaAoVivo empresa={empresaAberta} agora={agora} onFechar={() => setAberta(null)} />}
    </div>
  );
}

function EmpresaAoVivo({ empresa, agora, onFechar }: { empresa: EmpresaNoMonitor; agora: number; onFechar: () => void }) {
  const d = useQuery({ queryKey: ["produto", "casa", "monitor", empresa.id], queryFn: () => lerMonitorDaConta(empresa.id), refetchInterval: RELER_A_CADA });
  const funil = (d.data ? d.data.funil : []).slice().sort((a, b) => {
    const ia = ORDEM_DAS_ETAPAS.indexOf(a.etapa);
    const ib = ORDEM_DAS_ETAPAS.indexOf(b.etapa);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const maior = funil.reduce((m, f) => Math.max(m, f.negocios), 1);
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="lg"
      titulo={empresa.nome}
      descricao={`mexeram ${haQuanto(empresa.ultima_atividade, agora)} · relido a cada 15 segundos`}
      ajuda="Aqui a casa acompanha o movimento: quantos negócios em cada etapa, quem está trabalhando e o que mudou. O nome e o contato dos leads são da empresa e não aparecem."
      rodape={
        <Link to="/produto/crm/empresas" className={botao.secundario} onClick={onFechar}>
          Ajustar plano e pessoas
        </Link>
      }
    >
      {d.isLoading ? (
        <Carregando linhas={5} rotulo="Carregando o CRM da empresa" />
      ) : d.isError || !d.data ? (
        <EstadoDeErro acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void d.refetch()}>Tentar de novo</button>} />
      ) : (
        <div className="min-w-0 space-y-5" data-empresa-ao-vivo={empresa.id}>
          <NumerosOusados
            tamanho="compacto"
            tinta={-1}
            rotulo="Números da empresa"
            itens={[
              { rotulo: "Novos hoje", valor: String(empresa.novos_hoje), apoio: `${empresa.novos_7d} em 7 dias` },
              { rotulo: "Em aberto", valor: String(empresa.abertos), apoio: reais(empresa.valor_aberto) },
              { rotulo: "Ganhos no mês", valor: String(empresa.ganhos_mes), apoio: reais(empresa.valor_ganho_mes) },
              { rotulo: "Tarefas atrasadas", valor: String(empresa.tarefas_atrasadas), ponto: empresa.tarefas_atrasadas ? "alerta" : undefined },
            ]}
          />

          <Secao titulo="Funil">
            {funil.length === 0 ? (
              <EstadoVazio compacto titulo="Nenhum negócio no funil ainda." />
            ) : (
              <ul className="min-w-0 space-y-2" data-funil-ao-vivo="">
                {funil.map((f) => (
                  <li key={f.etapa} className="flex min-w-0 items-center">
                    <span className={juntar(texto.apoio, "w-32 shrink-0 truncate")}>{etapa(f.etapa)}</span>
                    <span className="ml-3 h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round((f.negocios / maior) * 100))}%` }} />
                    </span>
                    <span className={juntar(texto.corpo, "ml-3 w-36 shrink-0 text-right tabular-nums")}>{f.negocios} · {reais(f.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo="Pessoas" descricao={`${d.data.pessoas.length}`}>
            <ul className={juntar(lista.aberta, lista.divisoria)} data-pessoas-ao-vivo="">
              {d.data.pessoas.map((p) => (
                <li key={p.id} className={juntar(lista.linha, "hover:bg-transparent")}>
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{p.nome}</span>
                    <span className={juntar(texto.apoio, "block truncate")}>
                      {p.estado === "convidado" ? "convidado, ainda não entrou" : `${p.cargo || PAPEL[p.papel] || p.papel} · entrou ${haQuanto(p.ultimo_acesso, agora)} · mexeu ${haQuanto(p.ultimo_movimento, agora)}`}
                    </span>
                  </span>
                  <span className="ml-3 shrink-0 text-right">
                    <span className={juntar(texto.corpo, "block tabular-nums")}>{p.abertos} em aberto · {p.ganhos_mes} ganhos</span>
                    <span className={juntar(texto.apoio, "block tabular-nums", p.tarefas_atrasadas ? "text-warning" : "")}>
                      {p.movimentos_7d} movimentos em 7 dias{p.tarefas_atrasadas ? ` · ${p.tarefas_atrasadas} atrasadas` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Secao>

          <Secao titulo="Últimos movimentos" descricao="os 40 mais recentes">
            {d.data.movimentos.length === 0 ? (
              <EstadoVazio compacto titulo="Nenhum movimento ainda." />
            ) : (
              <ul className={juntar(lista.aberta, lista.divisoria)} data-movimentos-ao-vivo="">
                {d.data.movimentos.map((m) => (
                  <li key={m.id} className={juntar(lista.linha, "py-2 hover:bg-transparent")}>
                    <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                      <span className="font-medium">{m.quem || "Automático"}</span>{" "}
                      {m.de && m.para ? `moveu um negócio de ${etapa(m.de)} para ${etapa(m.para)}` : m.para ? `colocou um negócio em ${etapa(m.para)}` : `registrou ${m.tipo.replace(/_/g, " ")}`}
                    </span>
                    <span className={juntar(texto.apoio, "ml-3 shrink-0 tabular-nums")}>{haQuanto(m.quando, agora)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>
      )}
    </JanelaCentral>
  );
}
