import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Check, CircleDollarSign, Crown, Handshake, Plus, Radar, Target, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ESTAGIOS_ABERTOS, rotuloDoEstagio } from "@/lib/comercial/estagios";
import { ehGestor, lerRanking, reais, type EstadoDoProduto } from "@/lib/produto/api";
import { Carregando, EstadoVazio, botao, etiqueta, foco, juntar, texto } from "@/components/sistema";
import { nomesDasEtapas } from "@/lib/produto/nichos";
import { Barra, CartaoDoPainel, Foto, Variacao, corDaEtapa } from "./pecas";

// As tabelas crm_* ainda não estão nos tipos gerados do banco.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

export interface LeadDoResumo {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  monthly_value: number;
  one_off_value: number;
  closed_at: string | null;
  owner_id: string | null;
  created_at: string;
  origin?: string | null;
}

export interface CompromissoDoResumo {
  id: string;
  title: string;
  due_at: string;
  lead_id: string | null;
}

export interface ResumoDoCrm {
  abertos: number;
  emJogo: number;
  ganhosNoMes: number;
  vendidoNoMes: number;
  vendidoNoMesAnterior: number;
  perdidosNoMes: number;
  /** Dos negócios fechados no mês, quantos por cento foram ganhos (nulo sem fechamento). */
  conversao: number | null;
  novosNoMes: number;
  hoje: number;
  atrasados: number;
  semDono: number;
  temMeta: boolean;
  etapas: Array<{ id: string; rotulo: string; quantos: number; valor: number }>;
  compromissos: Array<CompromissoDoResumo & { atrasado: boolean; lead: string | null }>;
  recentes: LeadDoResumo[];
  /** Os últimos seis meses, do mais antigo ao atual. */
  meses: Array<{ mes: string; rotulo: string; vendido: number; ganhos: number }>;
  origens: Array<{ id: string; rotulo: string; quantos: number; ganhos: number }>;
}

const valorDoLead = (l: Pick<LeadDoResumo, "monthly_value" | "one_off_value">) => (Number(l.monthly_value) || 0) * 12 + (Number(l.one_off_value) || 0);

const ROTULO_DA_ORIGEM: Record<string, string> = {
  manual: "Cadastro manual", quiz: "Diagnóstico", indicacao: "Indicação", formulario: "Formulário", api: "Integração", maquina: "Máquina de leads",
  maquina_de_leads: "Máquina de leads", campanha: "Campanha", site: "Site", whatsapp: "WhatsApp", instagram: "Instagram", meta: "Anúncio na Meta", google: "Google",
};
export const rotuloDaOrigem = (id: string | null | undefined): string => {
  const chave = String(id || "manual").toLowerCase();
  return ROTULO_DA_ORIGEM[chave] || chave.charAt(0).toUpperCase() + chave.slice(1).replace(/_/g, " ");
};

/** O dia e o começo do mês em São Paulo. */
function agoraEmSaoPaulo(agora = Date.now()) {
  const dia = new Date(agora - 3 * 3600 * 1000).toISOString().slice(0, 10);
  return { dia, mes: `${dia.slice(0, 7)}-01` };
}

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesAntes = (mes: string, quantos: number): string => {
  const ano = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7)) - 1 - quantos;
  const d = new Date(Date.UTC(ano, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

/** As contas da tela inicial, separadas da leitura para o teste. */
export function resumirCrm(leads: LeadDoResumo[], compromissos: CompromissoDoResumo[], temMeta: boolean, agora = Date.now()): ResumoDoCrm {
  const { dia, mes } = agoraEmSaoPaulo(agora);
  const inicioDeHoje = new Date(`${dia}T00:00:00-03:00`).getTime();
  const fimDeHoje = new Date(`${dia}T23:59:59-03:00`).getTime();
  const inicioDoMes = new Date(`${mes}T00:00:00-03:00`).getTime();
  const abertos = leads.filter((l) => l.stage !== "ganho" && l.stage !== "perdido");
  const nomeDoLead = (id: string | null) => {
    const l = id ? leads.filter((x) => x.id === id)[0] : null;
    return l ? l.company || l.name : null;
  };
  const ateHoje = compromissos
    .filter((c) => new Date(c.due_at).getTime() <= fimDeHoje)
    .sort((a, b) => (a.due_at < b.due_at ? -1 : 1))
    .map((c) => ({ ...c, atrasado: new Date(c.due_at).getTime() < inicioDeHoje, lead: nomeDoLead(c.lead_id) }));

  const mesDoFechamento = (l: LeadDoResumo) => (l.closed_at ? `${new Date(new Date(l.closed_at).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 7)}-01` : "");
  const ganhos = leads.filter((l) => l.stage === "ganho" && l.closed_at);
  const meses = [5, 4, 3, 2, 1, 0].map((n) => {
    const m = mesAntes(mes, n);
    const doMes = ganhos.filter((l) => mesDoFechamento(l) === m);
    return { mes: m, rotulo: MES_CURTO[Number(m.slice(5, 7)) - 1], vendido: doMes.reduce((s, l) => s + valorDoLead(l), 0), ganhos: doMes.length };
  });
  const ganhosNoMes = ganhos.filter((l) => new Date(l.closed_at as string).getTime() >= inicioDoMes);
  const perdidosNoMes = leads.filter((l) => l.stage === "perdido" && l.closed_at && new Date(l.closed_at).getTime() >= inicioDoMes).length;
  const fechados = ganhosNoMes.length + perdidosNoMes;

  const porOrigem: Record<string, { quantos: number; ganhos: number }> = {};
  leads.forEach((l) => {
    const chave = String(l.origin || "manual").toLowerCase();
    if (!porOrigem[chave]) porOrigem[chave] = { quantos: 0, ganhos: 0 };
    porOrigem[chave].quantos += 1;
    if (l.stage === "ganho") porOrigem[chave].ganhos += 1;
  });

  return {
    abertos: abertos.length,
    emJogo: abertos.reduce((s, l) => s + valorDoLead(l), 0),
    ganhosNoMes: ganhosNoMes.length,
    vendidoNoMes: meses[5].vendido,
    vendidoNoMesAnterior: meses[4].vendido,
    perdidosNoMes,
    conversao: fechados ? Math.round((ganhosNoMes.length / fechados) * 100) : null,
    novosNoMes: leads.filter((l) => new Date(l.created_at).getTime() >= inicioDoMes).length,
    hoje: ateHoje.filter((c) => !c.atrasado).length,
    atrasados: ateHoje.filter((c) => c.atrasado).length,
    semDono: abertos.filter((l) => !l.owner_id).length,
    temMeta,
    etapas: ESTAGIOS_ABERTOS.map((id) => {
      const daEtapa = abertos.filter((l) => l.stage === id);
      return { id, rotulo: rotuloDoEstagio(id), quantos: daEtapa.length, valor: daEtapa.reduce((s, l) => s + valorDoLead(l), 0) };
    }),
    compromissos: ateHoje.slice(0, 6),
    recentes: leads.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5),
    meses,
    origens: Object.keys(porOrigem)
      .map((id) => ({ id, rotulo: rotuloDaOrigem(id), quantos: porOrigem[id].quantos, ganhos: porOrigem[id].ganhos }))
      .sort((a, b) => b.quantos - a.quantos)
      .slice(0, 5),
  };
}

async function lerResumoDoCrm(): Promise<ResumoDoCrm> {
  const { dia, mes } = agoraEmSaoPaulo();
  const [leads, atividades, metas] = await Promise.all([
    db.from("crm_leads").select("id, name, company, stage, monthly_value, one_off_value, closed_at, owner_id, created_at, origin").is("archived_at", null).limit(3000),
    db.from("crm_activities").select("id, title, due_at, lead_id").is("done_at", null).lte("due_at", `${dia}T23:59:59-03:00`).order("due_at", { ascending: true }).limit(200),
    db.from("crm_goals").select("id").eq("period", mes).gt("target", 0).limit(1),
  ]);
  if (leads.error) throw leads.error;
  return resumirCrm((leads.data || []) as LeadDoResumo[], (atividades.data || []) as CompromissoDoResumo[], !!(metas.data && metas.data.length));
}

const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const diaCurto = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
const hojePorExtenso = () => {
  const t = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const reaisCurto = (v: number) => (v >= 1000000 ? `R$ ${(v / 1000000).toFixed(1).replace(".", ",")} mi` : v >= 1000 ? `R$ ${Math.round(v / 1000)} mil` : reais(v));

function Numero({ icone, rotulo, valor, apoio, lado, para, alerta }: { icone: ReactNode; rotulo: string; valor: ReactNode; apoio?: ReactNode; lado?: ReactNode; para?: string; alerta?: boolean }) {
  const miolo = (
    <>
      <span className="flex min-w-0 items-center">
        <span className={juntar("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", alerta ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary")}>{icone}</span>
        <span className={juntar(texto.rotulo, "ml-3 min-w-0 flex-1 truncate")}>{rotulo}</span>
        {lado}
      </span>
      <span className="mt-3 block truncate text-[26px] font-semibold leading-8 tracking-[-0.02em] text-foreground tabular-nums">{valor}</span>
      <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{apoio || " "}</span>
    </>
  );
  const classe = "produto-cartao block min-w-0 rounded-xl p-4 sm:p-5";
  return para ? <Link to={para} className={juntar(classe, foco)} data-numero={rotulo}>{miolo}</Link> : <div className={classe} data-numero={rotulo}>{miolo}</div>;
}

/** Vendas dos últimos seis meses: área leve em SVG (sem biblioteca, desenha na hora). */
function VendasPorMes({ meses }: { meses: ResumoDoCrm["meses"] }) {
  const L = 600;
  const A = 180;
  const topo = 16;
  const base = A - 8;
  const maior = Math.max(1, ...meses.map((m) => m.vendido));
  const passo = L / (meses.length - 1);
  const pontos = meses.map((m, i) => ({ x: Math.round(i * passo), y: Math.round(base - (m.vendido / maior) * (base - topo)) }));
  const linha = pontos.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return (
    <div className="min-w-0" data-vendas-por-mes="">
      <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" className="block h-[168px] w-full" role="img" aria-label={`Vendas por mês: ${meses.map((m) => `${m.rotulo} ${reais(m.vendido)}`).join(", ")}`}>
        <defs>
          <linearGradient id="produto-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.32" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={L} y1={base - f * (base - topo)} y2={base - f * (base - topo)} stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${linha} L${L},${base} L0,${base} Z`} fill="url(#produto-area)" />
        <path d={linha} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <ul className="mt-2 grid min-w-0 grid-cols-6">
        {meses.map((m, i) => (
          <li key={m.mes} className={juntar("min-w-0", i === 0 ? "text-left" : i === meses.length - 1 ? "text-right" : "text-center")}>
            <span className={juntar(texto.auxiliar, "block truncate", i === meses.length - 1 && "font-medium text-foreground")}>{m.rotulo}</span>
            <span className={juntar("block truncate text-[11px] leading-4 tabular-nums", i === meses.length - 1 ? "text-primary" : "text-muted-foreground")}>{m.vendido ? reaisCurto(m.vendido) : "0"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** O funil de agora: uma fatia por etapa, na cor da etapa, afunilando do topo para o fechamento. */
function FunilDeAgora({ etapas }: { etapas: ResumoDoCrm["etapas"] }) {
  const maior = Math.max(1, ...etapas.map((e) => e.quantos));
  return (
    <ol className="min-w-0 space-y-2" data-funil-agora="">
      {etapas.map((e, i) => {
        const largura = e.quantos ? Math.max(14, Math.round((e.quantos / maior) * 100)) : 6;
        const anterior = i > 0 ? etapas[i - 1].quantos : 0;
        return (
          <li key={e.id}>
            <Link to="/app/crm/crm" className={juntar("grid min-w-0 grid-cols-[minmax(0,116px)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg py-1 sm:grid-cols-[minmax(0,148px)_minmax(0,1fr)_auto]", foco)}>
              <span className="flex min-w-0 items-center">
                <span className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: corDaEtapa(e.id) }} aria-hidden="true" />
                <span className={juntar(texto.corpo, "min-w-0 truncate")}>{e.rotulo}</span>
              </span>
              <span className="flex min-w-0 justify-center" aria-hidden="true">
                <span className="produto-fatia flex h-8 items-center justify-center rounded-md text-[12px] font-semibold text-white" style={{ width: `${largura}%`, backgroundColor: corDaEtapa(e.id), opacity: e.quantos ? 1 : 0.28, animationDelay: `${i * 60}ms` }}>
                  {e.quantos > 0 ? e.quantos : ""}
                </span>
              </span>
              <span className="w-[92px] shrink-0 text-right sm:w-[124px]">
                <span className={juntar(texto.corpo, "block truncate font-medium tabular-nums")}>{reaisCurto(e.valor)}</span>
                <span className={juntar(texto.auxiliar, "block truncate tabular-nums")}>{i > 0 && anterior > 0 ? `${Math.round((e.quantos / anterior) * 100)}% da etapa anterior` : `${e.quantos} ${e.quantos === 1 ? "negócio" : "negócios"}`}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * O painel do CRM: os números do mês, o funil de agora na cor de cada etapa,
 * as vendas dos últimos meses, o ranking da equipe, a agenda de hoje e de onde
 * os negócios vêm. Cada pessoa vê o recorte que o cargo dela permite: o
 * vendedor vê os números dele; o gerente, os da equipe; quem administra, tudo.
 */
export default function InicioDoProduto({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const papel = estado.eu ? estado.eu.papel : "usuario";
  const admin = papel === "admin";
  const gestor = ehGestor(papel);
  const resumo = useQuery({ queryKey: ["produto", "inicio", conta.id], queryFn: lerResumoDoCrm, enabled: estado.crm, staleTime: 30_000 });
  const ranking = useQuery({ queryKey: ["produto", "ranking", conta.id], queryFn: () => lerRanking(), enabled: estado.crm, staleTime: 30_000 });
  // O painel abre fora do CRM: os nomes das etapas vêm do perfil da empresa, não do escopo.
  const nomes = nomesDasEtapas(conta.perfil) as Record<string, string>;
  const r = resumo.data ? { ...resumo.data, etapas: resumo.data.etapas.map((e) => ({ ...e, rotulo: nomes[e.id] || e.rotulo })) } : undefined;
  const primeiroNome = estado.eu && estado.eu.nome ? estado.eu.nome.split(" ")[0] : "";
  const temMaquina = !!estado.plano && estado.plano.limites.maquina_buscas_mes > 0;
  const recorte = estado.ve_tudo ? "da empresa" : papel === "gerente" ? "da sua equipe" : "seus";
  const podio = (ranking.data || []).slice(0, 5);
  const maiorVenda = Math.max(1, ...podio.map((l) => l.vendido));
  const maiorOrigem = r ? Math.max(1, ...r.origens.map((o) => o.quantos)) : 1;

  const passos: Array<{ feito: boolean; texto: string; para: string }> = [];
  if (estado.crm && r) {
    passos.push({ feito: r.abertos + r.ganhosNoMes > 0, texto: "Cadastrar o primeiro negócio", para: "/app/crm/crm" });
    if (temMaquina) passos.push({ feito: estado.maquina_no_mes > 0, texto: "Buscar empresas na Máquina de leads", para: "/app/crm/leads" });
    passos.push({ feito: r.temMeta, texto: "Definir a meta do mês", para: "/app/crm/metas" });
  }
  if (admin) {
    if (conta.usuarios_contratados > 1) passos.push({ feito: estado.equipe.length > 1, texto: "Convidar a equipe", para: "/app/equipe" });
    passos.push({ feito: !!conta.aparencia.logo || !!conta.aparencia.cor, texto: "Pôr o logo e a cor da empresa", para: "/app/conta?parte=aparencia" });
    if (conta.estado === "teste") passos.push({ feito: false, texto: "Assinar para não perder o acesso", para: "/app/conta?parte=plano" });
  }
  if (gestor) passos.push({ feito: false, texto: "Ligar uma automação pronta", para: "/app/automacoes" });
  const pendentes = passos.filter((p) => !p.feito);

  if (!estado.crm) {
    return (
      <div className="min-w-0" data-inicio-do-produto="">
        <EstadoVazio titulo="O CRM está pausado." descricao={admin ? "Veja a assinatura para liberar o acesso da equipe." : "Fale com quem administra a empresa."} acao={admin ? <Link to="/app/conta?parte=plano" className={botao.primario}>Ver o plano</Link> : undefined} />
      </div>
    );
  }

  return (
    <div className="produto-entra-em-ordem min-w-0 space-y-4" data-inicio-do-produto="">
      <div className="flex min-w-0 flex-wrap items-end">
        <div className="mb-1 mr-4 min-w-0 flex-1">
          <h1 className="truncate text-[24px] font-semibold leading-8 tracking-[-0.02em] text-foreground">{primeiroNome ? `Olá, ${primeiroNome}` : "Painel"}</h1>
          <p className={juntar(texto.auxiliar, "truncate")}>{hojePorExtenso()} · números {recorte}</p>
        </div>
        <div className="mb-1 flex shrink-0 items-center">
          {temMaquina && (
            <Link to="/app/crm/leads" className={juntar(botao.secundario, "mr-2 hidden sm:inline-flex")}>
              <Radar className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Buscar leads
            </Link>
          )}
          <Link to="/app/crm/crm?novo=1" className={botao.primario} data-novo-negocio="">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Negócio
          </Link>
        </div>
      </div>

      {gestor && r && r.semDono > 0 && (
        <Link to="/app/crm/crm" className={juntar("flex min-w-0 items-center rounded-lg bg-warning/10 px-3 py-2 text-[13px] font-medium text-warning", foco)} data-sem-responsavel="">
          <span className="min-w-0 flex-1 truncate">{r.semDono} {r.semDono === 1 ? "negócio está sem responsável" : "negócios estão sem responsável"}</span>
          <span className="ml-2 shrink-0">Distribuir</span>
        </Link>
      )}

      <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-numeros-do-painel="">
        <Numero icone={<CircleDollarSign className="h-5 w-5" aria-hidden="true" />} rotulo="Vendido no mês" valor={r ? reaisCurto(r.vendidoNoMes) : "…"} apoio={r ? `${r.ganhosNoMes} ${r.ganhosNoMes === 1 ? "venda" : "vendas"}` : undefined} lado={r ? <Variacao agora={r.vendidoNoMes} antes={r.vendidoNoMesAnterior} /> : undefined} para="/app/crm/metas" />
        <Numero icone={<Handshake className="h-5 w-5" aria-hidden="true" />} rotulo="Em negociação" valor={r ? reaisCurto(r.emJogo) : "…"} apoio={r ? `${r.abertos} ${r.abertos === 1 ? "negócio aberto" : "negócios abertos"}` : undefined} para="/app/crm/crm" />
        <Numero icone={<TrendingUp className="h-5 w-5" aria-hidden="true" />} rotulo="Conversão do mês" valor={r ? (r.conversao === null ? "0%" : `${r.conversao}%`) : "…"} apoio={r ? (r.conversao === null ? "nenhum negócio fechado ainda" : `${r.ganhosNoMes} ganhos · ${r.perdidosNoMes} perdidos`) : undefined} />
        <Numero icone={<CalendarClock className="h-5 w-5" aria-hidden="true" />} rotulo="Para hoje" valor={r ? String(r.hoje + r.atrasados) : "…"} apoio={r ? (r.atrasados ? `${r.atrasados} em atraso` : "compromissos") : undefined} para="/app/crm/agenda" alerta={!!r && r.atrasados > 0} />
      </div>

      <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <CartaoDoPainel titulo="Funil agora" apoio={r ? `${r.abertos} ${r.abertos === 1 ? "negócio" : "negócios"} · ${reais(r.emJogo)}` : undefined} acao={<Link to="/app/crm/crm" className={juntar(botao.discreto, "h-8")}>Abrir o funil</Link>} data-cartao-funil="">
          {!r ? (
            <Carregando linhas={5} rotulo="Carregando o funil" />
          ) : r.abertos === 0 ? (
            <EstadoVazio compacto titulo="Nenhum negócio aberto." descricao="Cadastre o primeiro ou busque empresas na Máquina de leads." acao={<Link to="/app/crm/crm?novo=1" className={juntar(botao.secundario, "h-8")}>Cadastrar</Link>} />
          ) : (
            <FunilDeAgora etapas={r.etapas} />
          )}
        </CartaoDoPainel>

        <CartaoDoPainel titulo="Vendas por mês" apoio="Negócios ganhos nos últimos seis meses" data-cartao-vendas="">
          {!r ? <Carregando linhas={4} rotulo="Carregando as vendas" /> : <VendasPorMes meses={r.meses} />}
        </CartaoDoPainel>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <CartaoDoPainel titulo="Ranking do mês" apoio="Quem mais vendeu" acao={<Link to="/app/equipe" className={juntar(botao.discreto, "h-8")}>Equipe</Link>} data-cartao-ranking="">
          {ranking.isLoading ? (
            <Carregando linhas={4} rotulo="Carregando o ranking" />
          ) : podio.length === 0 ? (
            <p className={texto.auxiliar}>O ranking aparece quando a equipe entra.</p>
          ) : (
            <ol className="min-w-0 space-y-3">
              {podio.map((l, i) => (
                <li key={l.membro_id} className="grid min-w-0 grid-cols-[20px_auto_minmax(0,1fr)_auto] items-center gap-x-2.5">
                  <span className={juntar("text-center text-[12px] font-semibold tabular-nums", i === 0 && l.vendido > 0 ? "text-[hsl(45_95%_55%)]" : "text-muted-foreground")}>{i === 0 && l.vendido > 0 ? <Crown className="mx-auto h-4 w-4" aria-label="Primeiro lugar" /> : i + 1}</span>
                  <Foto nome={l.nome} foto={l.foto} tamanho="p" />
                  <span className="min-w-0">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{l.nome}</span>
                    <Barra parte={l.meta_mensal > 0 ? l.vendido / l.meta_mensal : l.vendido / maiorVenda} className="mt-1" altura={4} />
                  </span>
                  <span className={juntar(texto.corpo, "shrink-0 text-right font-medium tabular-nums")}>{reaisCurto(l.vendido)}</span>
                </li>
              ))}
            </ol>
          )}
        </CartaoDoPainel>

        <CartaoDoPainel titulo="Para hoje" apoio={r ? (r.hoje + r.atrasados === 0 ? "Nada pendente" : `${r.hoje + r.atrasados} ${r.hoje + r.atrasados === 1 ? "compromisso" : "compromissos"}`) : undefined} acao={<Link to="/app/crm/agenda" className={juntar(botao.discreto, "h-8")}>Agenda</Link>} data-cartao-hoje="">
          {!r ? (
            <Carregando linhas={3} rotulo="Carregando a agenda" />
          ) : r.compromissos.length === 0 ? (
            <p className={texto.auxiliar}>Nenhum compromisso para hoje. Todo negócio aberto merece um próximo passo marcado.</p>
          ) : (
            <ul className="-mx-2 min-w-0" data-para-hoje="">
              {r.compromissos.map((c) => (
                <li key={c.id}>
                  <Link to="/app/crm/agenda" className={juntar("flex min-w-0 items-center rounded-lg px-2 py-2 transition-colors hover:bg-muted/50", foco)}>
                    <span className={juntar("mr-3 w-[44px] shrink-0 text-[12px] font-medium tabular-nums", c.atrasado ? "text-warning" : "text-muted-foreground")}>{c.atrasado ? diaCurto(c.due_at) : horaCurta(c.due_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate")}>{c.title}</span>
                      {c.lead && <span className={juntar(texto.auxiliar, "block truncate")}>{c.lead}</span>}
                    </span>
                    {c.atrasado && <span className={juntar(etiqueta, "ml-2 bg-warning/10 text-warning")}>Atrasado</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CartaoDoPainel>

        <CartaoDoPainel titulo="De onde vêm os negócios" apoio={r ? `${r.novosNoMes} ${r.novosNoMes === 1 ? "novo" : "novos"} neste mês` : undefined} acao={gestor ? <Link to="/app/captacao" className={juntar(botao.discreto, "h-8")}>Captação</Link> : undefined} className="lg:col-span-2 xl:col-span-1" data-cartao-origens="">
          {!r ? (
            <Carregando linhas={3} rotulo="Carregando as origens" />
          ) : r.origens.length === 0 ? (
            <p className={texto.auxiliar}>Quando os negócios entrarem, a origem de cada um aparece aqui.</p>
          ) : (
            <ul className="min-w-0 space-y-3">
              {r.origens.map((o) => (
                <li key={o.id} className="min-w-0">
                  <span className="flex min-w-0 items-baseline">
                    <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{o.rotulo}</span>
                    <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{o.quantos} · {o.ganhos} {o.ganhos === 1 ? "ganho" : "ganhos"}</span>
                  </span>
                  <Barra parte={o.quantos / maiorOrigem} className="mt-1.5" />
                </li>
              ))}
            </ul>
          )}
        </CartaoDoPainel>
      </div>

      <div className={juntar("grid min-w-0 grid-cols-1 items-stretch gap-4", pendentes.length > 0 && "xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]")}>
        <CartaoDoPainel titulo="Negócios mais novos" acao={<Link to="/app/crm/crm" className={juntar(botao.discreto, "h-8")}>Ver todos</Link>} data-cartao-recentes="">
          {!r ? (
            <Carregando linhas={4} rotulo="Carregando os negócios" />
          ) : r.recentes.length === 0 ? (
            <p className={texto.auxiliar}>Nenhum negócio cadastrado ainda.</p>
          ) : (
            <ul className="-mx-2 min-w-0" data-negocios-recentes="">
              {r.recentes.map((l) => (
                <li key={l.id}>
                  <Link to="/app/crm/crm" className={juntar("flex min-w-0 items-center rounded-lg px-2 py-2 transition-colors hover:bg-muted/50", foco)}>
                    <Foto nome={l.company || l.name} tamanho="p" />
                    <span className="ml-3 min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate font-medium")}>{l.company || l.name}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>{l.company ? l.name : rotuloDaOrigem(l.origin)} · entrou em {diaCurto(l.created_at)}</span>
                    </span>
                    <span className="ml-2 inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-medium text-white" style={{ backgroundColor: corDaEtapa(l.stage) }}>{nomes[l.stage] || rotuloDoEstagio(l.stage)}</span>
                    <span className={juntar(texto.corpo, "ml-3 hidden w-[104px] shrink-0 text-right tabular-nums sm:block")}>{reais(valorDoLead(l))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CartaoDoPainel>

        {pendentes.length > 0 && (
          <CartaoDoPainel titulo="Próximos passos" apoio={`${passos.length - pendentes.length} de ${passos.length} feitos`} acao={<Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />} data-cartao-passos="">
            <ul className="-mx-2 min-w-0" data-proximos-passos="">
              {passos.map((p) => (
                <li key={p.texto}>
                  <Link to={p.para} className={juntar("flex min-w-0 items-center rounded-lg px-2 py-2 transition-colors hover:bg-muted/50", foco)}>
                    <span className={juntar("mr-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", p.feito ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {p.feito && <Check className="h-3 w-3" aria-hidden="true" />}
                    </span>
                    <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", p.feito && "text-muted-foreground line-through")}>{p.texto}</span>
                    {!p.feito && <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  </Link>
                </li>
              ))}
            </ul>
          </CartaoDoPainel>
        )}
      </div>
    </div>
  );
}
