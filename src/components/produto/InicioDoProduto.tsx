import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Check, KanbanSquare, Mail, Plus, Radar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ESTAGIOS_ABERTOS, rotuloDoEstagio } from "@/lib/comercial/estagios";
import { reais, type EstadoDoProduto } from "@/lib/produto/api";
import { CabecalhoDePagina, Carregando, EstadoVazio, FaixaDeNumeros, Secao, botao, etiqueta, foco, juntar, lista, superficie, texto } from "@/components/sistema";

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
  hoje: number;
  atrasados: number;
  semDono: number;
  temMeta: boolean;
  etapas: Array<{ id: string; rotulo: string; quantos: number; valor: number }>;
  compromissos: Array<CompromissoDoResumo & { atrasado: boolean; lead: string | null }>;
  recentes: LeadDoResumo[];
}

const valorDoLead = (l: Pick<LeadDoResumo, "monthly_value" | "one_off_value">) => (Number(l.monthly_value) || 0) * 12 + (Number(l.one_off_value) || 0);

/** O dia e o começo do mês em São Paulo. */
function agoraEmSaoPaulo(agora = Date.now()) {
  const dia = new Date(agora - 3 * 3600 * 1000).toISOString().slice(0, 10);
  return { dia, mes: `${dia.slice(0, 7)}-01` };
}

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
  return {
    abertos: abertos.length,
    emJogo: abertos.reduce((s, l) => s + valorDoLead(l), 0),
    ganhosNoMes: leads.filter((l) => l.stage === "ganho" && l.closed_at && new Date(l.closed_at).getTime() >= inicioDoMes).length,
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
  };
}

async function lerResumoDoCrm(): Promise<ResumoDoCrm> {
  const { dia, mes } = agoraEmSaoPaulo();
  const [leads, atividades, metas] = await Promise.all([
    db.from("crm_leads").select("id, name, company, stage, monthly_value, one_off_value, closed_at, owner_id, created_at").is("archived_at", null).limit(3000),
    db.from("crm_activities").select("id, title, due_at, lead_id").is("done_at", null).lte("due_at", `${dia}T23:59:59-03:00`).order("due_at", { ascending: true }).limit(200),
    db.from("crm_goals").select("id").eq("period", mes).gt("target", 0).limit(1),
  ]);
  if (leads.error) throw leads.error;
  return resumirCrm((leads.data || []) as LeadDoResumo[], (atividades.data || []) as CompromissoDoResumo[], !!(metas.data && metas.data.length));
}

function Ferramenta({ para, icone, nome, linha, destaque, acao }: { para: string; icone: ReactNode; nome: string; linha: string; destaque?: boolean; acao?: string }) {
  return (
    <Link
      to={para}
      className={juntar(superficie.painel, "group flex min-w-0 items-center p-4 transition-colors hover:border-primary/60 sm:p-5", foco, destaque && "border-primary/40")}
      data-ferramenta={nome}
    >
      <span className="mr-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className={juntar(texto.tituloSecao, "block truncate")}>{nome}</span>
        <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{linha}</span>
      </span>
      <span className="ml-3 hidden shrink-0 items-center text-[13px] font-medium text-primary sm:inline-flex">
        {acao || "Abrir"}
        <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
      <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden="true" />
    </Link>
  );
}

const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const diaCurto = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
const hojePorExtenso = () => {
  const t = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * A entrada do produto: as duas ferramentas em destaque, o funil de agora, os
 * negócios mais novos e, ao lado, o que é para hoje e o que falta para a
 * empresa tirar proveito (a lista de passos some quando acaba).
 */
export default function InicioDoProduto({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const admin = !!estado.eu && estado.eu.papel === "admin";
  const resumo = useQuery({ queryKey: ["produto", "inicio", conta.id], queryFn: lerResumoDoCrm, enabled: estado.crm, staleTime: 30_000 });
  const r = resumo.data;
  const primeiroNome = estado.eu && estado.eu.nome ? estado.eu.nome.split(" ")[0] : "";
  const ativos = estado.equipe.filter((m) => m.estado === "ativo");
  const lugaresLivres = Math.max(0, conta.usuarios_contratados - estado.equipe.length);
  const temMaquina = !!estado.plano && estado.plano.limites.maquina_buscas_mes > 0;

  const passos: Array<{ feito: boolean; texto: string; para: string }> = [];
  if (estado.crm && r) {
    passos.push({ feito: r.abertos + r.ganhosNoMes > 0, texto: "Cadastrar o primeiro negócio", para: "/app/crm/crm" });
    if (temMaquina) passos.push({ feito: estado.maquina_no_mes > 0, texto: "Buscar empresas na Máquina de leads", para: "/app/crm/leads" });
    passos.push({ feito: r.temMeta, texto: "Definir a meta do mês", para: "/app/crm/metas" });
  }
  if (admin) {
    if (conta.usuarios_contratados > 1) passos.push({ feito: estado.equipe.length > 1, texto: "Convidar a equipe", para: "/app/conta?parte=equipe" });
    passos.push({ feito: !!conta.aparencia.logo || !!conta.aparencia.cor, texto: "Pôr o logo e a cor da empresa", para: "/app/conta?parte=aparencia" });
    if (conta.estado === "teste") passos.push({ feito: false, texto: "Assinar para não perder o acesso", para: "/app/conta?parte=plano" });
  }
  const pendentes = passos.filter((p) => !p.feito);

  const linhaDoCrm = !estado.crm
    ? "Pausado"
    : !r
      ? "Funil, empresas, agenda e metas"
      : r.atrasados > 0
        ? `${r.atrasados} ${r.atrasados === 1 ? "compromisso atrasado" : "compromissos atrasados"}`
        : r.hoje > 0
          ? `${r.hoje} ${r.hoje === 1 ? "compromisso hoje" : "compromissos hoje"}`
          : `${r.abertos} ${r.abertos === 1 ? "negócio aberto" : "negócios abertos"}`;
  const linhaDoEmail = conta.email_ativo ? `${conta.email_caixas_contratadas} ${conta.email_caixas_contratadas === 1 ? "caixa" : "caixas"} no domínio da empresa` : "Seu nome @ sua empresa";
  const maiorEtapa = r ? Math.max(1, ...r.etapas.map((e) => e.quantos)) : 1;

  return (
    <div className="produto-entra-em-ordem min-w-0 space-y-6" data-inicio-do-produto="">
      <CabecalhoDePagina
        titulo={primeiroNome ? `Olá, ${primeiroNome}` : "Início"}
        descricao={hojePorExtenso()}
        acoes={
          estado.crm ? (
            <>
              {temMaquina && (
                <Link to="/app/crm/leads" className={juntar(botao.secundario, "mr-2 hidden sm:inline-flex")}>
                  <Radar className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Buscar leads
                </Link>
              )}
              <Link to="/app/crm/crm" className={botao.primario} data-novo-negocio="">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Negócio
              </Link>
            </>
          ) : undefined
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <Ferramenta para="/app/crm" icone={<KanbanSquare className="h-6 w-6" aria-hidden="true" />} nome="CRM" linha={linhaDoCrm} destaque={estado.crm} />
        <Ferramenta para="/app/email" icone={<Mail className="h-6 w-6" aria-hidden="true" />} nome="E-mail profissional" linha={linhaDoEmail} destaque={conta.email_ativo} acao={conta.email_ativo ? "Abrir" : "Conhecer"} />
      </div>

      {estado.crm && (
        <FaixaDeNumeros
          rotulo="Números do CRM"
          itens={[
            { rotulo: "Em conversa", valor: r ? String(r.abertos) : "…", apoio: "negócios abertos", para: "/app/crm/crm" },
            { rotulo: "Em jogo", valor: r ? reais(r.emJogo) : "…", apoio: "em 12 meses" },
            { rotulo: "Ganhos no mês", valor: r ? String(r.ganhosNoMes) : "…", apoio: r && r.temMeta ? "com meta definida" : "sem meta definida", para: "/app/crm/metas", ponto: r && r.ganhosNoMes > 0 ? "verde" : undefined },
            { rotulo: "Para hoje", valor: r ? String(r.hoje + r.atrasados) : "…", apoio: r && r.atrasados ? `${r.atrasados} em atraso` : "compromissos", para: "/app/crm/agenda", ponto: r && r.atrasados ? "alerta" : undefined },
          ]}
        />
      )}

      <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <div className="min-w-0 space-y-6">
          {estado.crm && (
            <Secao
              titulo="Funil agora"
              descricao={r ? `${r.abertos} ${r.abertos === 1 ? "negócio" : "negócios"} · ${reais(r.emJogo)}` : undefined}
              acao={<Link to="/app/crm/crm" className={juntar(botao.discreto, "h-8")}>Abrir o funil</Link>}
              recolher={false}
            >
              {!r ? (
                <Carregando linhas={5} rotulo="Carregando o funil" />
              ) : r.abertos === 0 ? (
                <EstadoVazio compacto titulo="Nenhum negócio aberto." descricao="Cadastre o primeiro ou busque empresas na Máquina de leads." acao={<Link to="/app/crm/crm" className={juntar(botao.secundario, "h-8")}>Cadastrar</Link>} />
              ) : (
                <ul className="min-w-0 space-y-2.5" data-funil-agora="">
                  {r.etapas.map((e) => (
                    <li key={e.id} className="grid min-w-0 grid-cols-[104px_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[128px_minmax(0,1fr)_auto]">
                      <span className={juntar(texto.corpo, "min-w-0 truncate")}>{e.rotulo}</span>
                      <span className="block h-2 min-w-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <span className="produto-barra-do-funil block h-full rounded-full bg-primary" style={{ width: `${e.quantos ? Math.max(4, Math.round((e.quantos / maiorEtapa) * 100)) : 0}%` }} />
                      </span>
                      <span className={juntar(texto.auxiliar, "shrink-0 text-right tabular-nums")}>
                        <span className="font-medium text-foreground">{e.quantos}</span>
                        <span className="hidden sm:inline"> · {reais(e.valor)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          )}

          {estado.crm && r && r.recentes.length > 0 && (
            <Secao titulo="Negócios mais novos" recolher={false}>
              <ul className={juntar(lista.aberta, lista.divisoria)} data-negocios-recentes="">
                {r.recentes.map((l) => (
                  <li key={l.id}>
                    <Link to="/app/crm/crm" className={juntar(lista.linha, foco)}>
                      <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary">{(l.company || l.name || "?").charAt(0).toUpperCase()}</span>
                      <span className="min-w-0 flex-1">
                        <span className={juntar(texto.corpo, "block truncate font-medium")}>{l.company || l.name}</span>
                        <span className={juntar(texto.auxiliar, "block truncate")}>{l.company ? l.name : "Sem empresa"} · entrou em {diaCurto(l.created_at)}</span>
                      </span>
                      <span className={juntar(etiqueta, "ml-2", l.stage === "ganho" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{rotuloDoEstagio(l.stage)}</span>
                      <span className={juntar(texto.corpo, "ml-3 hidden w-[104px] shrink-0 text-right tabular-nums sm:block")}>{reais(valorDoLead(l))}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Secao>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {estado.crm && (
            <Secao
              titulo="Para hoje"
              descricao={r ? (r.hoje + r.atrasados === 0 ? "Nada pendente" : `${r.hoje + r.atrasados} ${r.hoje + r.atrasados === 1 ? "compromisso" : "compromissos"}`) : undefined}
              acao={<Link to="/app/crm/agenda" className={botao.icone} aria-label="Abrir a agenda" title="Abrir a agenda"><CalendarClock className="h-4 w-4" aria-hidden="true" /></Link>}
              recolher={false}
            >
              {!r ? (
                <Carregando linhas={3} rotulo="Carregando a agenda" />
              ) : r.compromissos.length === 0 ? (
                <p className={texto.auxiliar}>Nenhum compromisso para hoje.</p>
              ) : (
                <ul className={juntar(lista.aberta, lista.divisoria)} data-para-hoje="">
                  {r.compromissos.map((c) => (
                    <li key={c.id}>
                      <Link to="/app/crm/agenda" className={juntar(lista.linha, foco)}>
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
            </Secao>
          )}

          {pendentes.length > 0 && (
            <Secao titulo="Próximos passos" descricao={`${passos.length - pendentes.length} de ${passos.length} feitos`} recolher="produto:inicio:passos">
              <ul className={juntar(lista.aberta, lista.divisoria)} data-proximos-passos="">
                {passos.map((p) => (
                  <li key={p.texto}>
                    <Link to={p.para} className={juntar(lista.linha, foco)}>
                      <span className={juntar("mr-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", p.feito ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                        {p.feito && <Check className="h-3 w-3" aria-hidden="true" />}
                      </span>
                      <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", p.feito && "text-muted-foreground line-through")}>{p.texto}</span>
                      {!p.feito && <ArrowRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    </Link>
                  </li>
                ))}
              </ul>
            </Secao>
          )}

          <Secao
            titulo="Equipe"
            descricao={`${ativos.length} de ${conta.usuarios_contratados} ${conta.usuarios_contratados === 1 ? "usuário" : "usuários"}${lugaresLivres > 0 ? ` · ${lugaresLivres} ${lugaresLivres === 1 ? "lugar livre" : "lugares livres"}` : ""}`}
            acao={admin ? <Link to="/app/conta?parte=equipe" className={juntar(botao.discreto, "h-8")}>Gerenciar</Link> : undefined}
            recolher={false}
          >
            <div className="flex min-w-0 flex-wrap items-center" data-equipe-no-inicio="">
              {estado.equipe.slice(0, 8).map((m) => (
                <span
                  key={m.id}
                  title={`${m.nome || m.email || "Sem nome"}${m.estado === "convidado" ? " (convite enviado)" : ""}`}
                  className={juntar("mb-1.5 mr-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold", m.estado === "convidado" ? "border border-dashed border-border text-muted-foreground" : "bg-primary/10 text-primary")}
                >
                  {(m.nome || m.email || "?").charAt(0).toUpperCase()}
                </span>
              ))}
              {estado.crm && r && r.semDono > 0 && admin && (
                <Link to="/app/crm/crm" className={juntar(texto.auxiliar, "mb-1.5 ml-1 font-medium text-primary hover:underline")}>
                  {r.semDono} {r.semDono === 1 ? "negócio sem responsável" : "negócios sem responsável"}
                </Link>
              )}
            </div>
          </Secao>
        </div>
      </div>
    </div>
  );
}
