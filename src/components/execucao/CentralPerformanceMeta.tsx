import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AdsCampaign, AdsDaily } from "@/hooks/useAdsMetrics";
import { carteiraPerformance, execucaoReal } from "@/lib/performanceMeta";
import { goalForObjective, statusLabel } from "@/lib/adsLanguage";
import { Carregando, botao, campo, juntar } from "@/components/sistema";
import DocumentoDaExecucao from "./DocumentoDaExecucao";
import AprovacoesExplicadas from "./AprovacoesExplicadas";
import { estadoDaExecucao } from "@/lib/execucaoApresentacao";
import CarteiraDaOperacao, { OrganizarCarteira, nomeCliente, ROLAGEM_OPERACAO } from './CarteiraDaOperacao';
import DiarioDaExecucao from './DiarioDaExecucao';
import { lerCarteira } from '@/lib/carteiraOperacao';
import { toast } from 'sonner';

const data = (v?: string | null) => v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Não informado";
const dinheiro = (v: number | null | undefined, moeda?: string) => v == null ? "Não informado" : moeda ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(v) : `${Number(v).toLocaleString("pt-BR")} (moeda não informada)`;
const filtros = [["todas", "Todas"], ["entrega", "Entrega observada"], ["sem_entrega", "Sem entrega"], ["proxima", "Próximas do término"], ["divergencia", "Divergências"], ["desatualizada", "Conferir dados"]] as const;

/** Paginação estável: não apresenta o limite padrão do PostgREST como carteira completa. */
async function paginas(criar: () => any) {
  const total: any[] = [];
  for (let inicio = 0; ; inicio += 500) {
    const r = await criar().range(inicio, inicio + 499);
    if (r.error) throw r.error;
    total.push(...(r.data || []));
    if ((r.data || []).length < 500) return total;
    if (inicio >= 49500) throw new Error("A carteira excedeu a janela de leitura. Refine o período antes de conferir os totais.");
  }
}

export default function CentralPerformanceMeta({ aoAbrir, clienteExterno = "" }: { aoAbrir: (id: string, titulo?: string) => void; clienteExterno?: string }) {
  const { user } = useAuth();
  const [aba, setAba] = useState("visao");
  const [conversa, setConversa] = useState<{ linkId: string; cliente: { id: string; nome: string }; pedido: string } | null>(null);
  const [filtro, setFiltro] = useState("todas");
  const [busca, setBusca] = useState("");
  const [cliente, setCliente] = useState("");
  const q = useQuery({
    queryKey: ["execucao-performance-meta", user?.id], enabled: !!user,
    staleTime: 60000, refetchInterval: 60000,
    queryFn: async () => {
      const desde = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
      const [campanhas, dias, contas, projetos, agentes, contasNomes, papeisClientes] = await Promise.all([
        paginas(() => supabase.from("ads_campaigns").select("id,client_id,external_account_id,campaign_id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,updated_at").order("id")),
        paginas(() => supabase.from("ads_campaign_daily").select("*").gte("day", desde).order("id")),
        paginas(() => supabase.from("ads_account_snapshot").select("external_account_id,currency,coletado_em,account_status").order("external_account_id")),
        paginas(() => supabase.from("projects").select("id,name,scope,updated_at").ilike("name", "%Carteira Meta Ads%").is('deleted_at', null).order("id")),
        paginas(() => supabase.from("internal_operators").select("id,display_name,slug").order("id")),
        paginas(() => supabase.from("external_accounts").select("id,display_name,external_id").order("id")),
        paginas(() => supabase.from('user_roles').select('user_id').eq('role', 'client').order('user_id')),
      ]);
      const clientes: any[] = [];
      const idsClientes = [...new Set(papeisClientes.map(c => c.user_id))];
      for (let i = 0; i < idsClientes.length; i += 150) {
        clientes.push(...await paginas(() => supabase.from('profiles').select('id,company_name,full_name,plan_status').in('id', idsClientes.slice(i, i + 150)).order('id')));
      }
      clientes.sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b), 'pt-BR'));
      const tarefas = projetos.length ? await paginas(() => supabase.from("tasks").select("id,title,assigned_to,status").in("project_id", projetos.map(p => p.id)).order("id")) : [];
      const links = tarefas.length ? await paginas(() => supabase.from("operator_task_links").select("*").or(`kanban_task_id.in.(${tarefas.map(t => t.id).join(",")}),painel_task_id.in.(${tarefas.map(t => t.id).join(",")})`).order("id")) : [];
      const linkIds = links.map(l => l.id);
      const [runs, diario, aprovacoes, entregas] = linkIds.length ? await Promise.all([
        paginas(() => supabase.from("operator_runs").select("id,operator_id,task_link_id,run_key,status,heartbeat_at,timeout_seconds,detail,started_at,finished_at").or(`task_link_id.in.(${linkIds.join(",")}),run_key.like.meta-snapshot-review-%`).order("id")),
        paginas(() => supabase.from("operator_participations").select("id,task_link_id,title,body,attachments,created_at,entry_type").in("task_link_id", linkIds).order("id")),
        paginas(() => supabase.from("operator_approvals").select("id,task_link_id,o_que,payload_version,status,created_at,decision_note,payload").in("task_link_id", linkIds).order("id")),
        paginas(() => supabase.from("operator_deliveries").select("id,task_link_id,approval_id,o_que,como,onde_acessar,occurred_at").in("task_link_id", linkIds).order("id")),
      ]) : [[], [], [], []];
      if (projetos.length > 1) throw new Error('Há mais de uma frente Meta Ads. Confira qual carteira está em uso.');
      const carteira = projetos[0] ? lerCarteira(projetos[0].scope) : null;
      return { campanhas: campanhas as AdsCampaign[], dias: dias as AdsDaily[], contas, contasNomes, clientes, projetos, carteira, tarefas, links, agentes, runs, diario, aprovacoes, entregas, desde };
    },
  });
  if (q.isLoading) return <Carregando linhas={5} rotulo="Lendo carteira e decisões" />;
  if (q.error || !q.data) return <div role="alert" className="rounded-xl border border-destructive/30 p-5"><p>Não foi possível conferir a carteira completa. Os totais não foram calculados.</p><button className={botao.secundario} onClick={() => void q.refetch()}>Tentar novamente</button></div>;
  const d = q.data;
  const nome = (id: string) => { const p = d.clientes.find(c => c.id === id); return p?.company_name || p?.full_name || "Cliente sem nome acessível"; };
  const selecionados = d.carteira?.client_ids ?? d.clientes.filter(c => ['active', 'onboarding', 'standby'].includes(c.plan_status) && c.id !== '14f72d12-a00b-4673-99c6-4dabbcc8aad1').map(c => c.id);
  const clientesVisiveis = d.clientes.filter(c => selecionados.includes(c.id) && (!cliente || cliente === c.id) && (!clienteExterno || nome(c.id) === clienteExterno) && nome(c.id).toLowerCase().includes(busca.toLowerCase()));
  const base = carteiraPerformance(d.campanhas, d.dias).filter(x => selecionados.includes(x.campanha.client_id) && (!cliente || x.campanha.client_id === cliente) && (!clienteExterno || nome(x.campanha.client_id) === clienteExterno) && `${nome(x.campanha.client_id)} ${x.campanha.name}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase()));
  const conversar = (c: { id: string; company_name?: string; full_name?: string }, criativo = false) => {
    const coordenador = d.agentes.find(a => a.slug === 'augusto');
    const link = d.links.filter(l => l.operator_id === coordenador?.id && !['cancelled', 'done'].includes(l.status)).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    if (!link) { toast.error('Esta frente ainda precisa de um agente vinculado para receber a conversa.'); return; }
    setConversa({ linkId: link.id, cliente: { id: c.id, nome: nomeCliente(c) }, pedido: criativo ? 'Prepare uma proposta de criativo para este cliente usando o contexto, os resultados e os materiais das Mesas. Diga o objetivo, a ideia, o formato e o próximo passo. Registre na tarefa certa; não publique nem altere verba.' : '' });
  };
  const combina = (x: typeof base[number], f: string) => f === "todas" || (f === "proxima" ? x.proxima : f === "divergencia" ? x.divergencia : x.situacao === f);
  const linhas = base.filter(x => combina(x, filtro));
  const pendentes = d.aprovacoes.filter(a => ["pendente", "adiado"].includes(a.status));
  const nomesAgentes = new Map<string, string>(d.agentes.map(a => [a.id, a.display_name]));
  const titulos = new Map<string, string>(d.tarefas.map(t => [t.id, t.title]));
  return <section className="min-w-0 space-y-4" aria-label="Central de Performance Meta Ads">
    <DiarioDaExecucao linkId={conversa?.linkId || null} aberto={!!conversa} aoFechar={() => setConversa(null)} nomesDeAgentes={nomesAgentes} titulo={conversa ? `${conversa.cliente.nome} · Conversar com a operação` : undefined} contextoInicial={conversa ? { cliente: conversa.cliente, pedido: conversa.pedido } : undefined} />
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Central de Performance Meta Ads</h2><p className="mt-1 text-sm text-muted-foreground">Carteira, decisões e trabalho comprovado · leitura do painel a cada minuto</p></div><button className={botao.secundario} disabled={q.isFetching} onClick={() => void q.refetch()}>{q.isFetching ? "Conferindo…" : "Atualizar leitura"}</button></header>
    {['visao', 'campanhas'].includes(aba) && <div className="flex flex-wrap gap-2"><input className={juntar(campo, "max-w-xs")} aria-label="Buscar campanha ou cliente" placeholder="Buscar cliente ou campanha" value={busca} onChange={e => setBusca(e.target.value)} /><select aria-label="Cliente da carteira" className={juntar(campo, "max-w-xs")} value={cliente} onChange={e => setCliente(e.target.value)}><option value="">Todos os clientes</option>{d.clientes.filter(c => selecionados.includes(c.id)).map(c => <option key={c.id} value={c.id}>{nome(c.id)}</option>)}</select></div>}
    {['visao', 'campanhas'].includes(aba) && <div className="grid grid-cols-2 gap-2 xl:grid-cols-6">{filtros.slice(1).map(([id, label]) => <button key={id} aria-pressed={aba === "campanhas" && filtro === id} className={juntar("rounded-xl border p-3 text-left hover:bg-muted/40", filtro === id && aba === "campanhas" ? "border-primary bg-primary/5" : "border-border")} onClick={() => { setFiltro(id); setAba("campanhas"); }}><span className="block text-2xl font-semibold tabular-nums">{base.filter(x => combina(x, id)).length}</span><span className="text-xs text-muted-foreground">{label}</span></button>)}<button className="rounded-xl border border-border p-3 text-left hover:bg-muted/40" onClick={() => setAba("decisoes")}><span className="block text-2xl font-semibold">{pendentes.length}</span><span className="text-xs text-muted-foreground">Decisões da frente</span></button></div>}
    <nav className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Visões da performance">{[["visao", "Visão geral"], ["campanhas", "Campanhas"], ["decisoes", "Decisões"], ["agentes", "Agentes"], ["relatorios", "Relatórios"], ["historico", "Histórico"]].map(([id, label]) => <button key={id} className={aba === id ? botao.primario : botao.discreto} aria-pressed={aba === id} onClick={() => setAba(id)}>{label}</button>)}</nav>
    {['visao', 'campanhas'].includes(aba) ? <OrganizarCarteira clientes={d.clientes} projeto={d.projetos[0]} selecionados={selecionados} /> : <p className="text-xs text-muted-foreground">Toda a frente · estas atualizações podem envolver vários clientes. Confira o cliente indicado em cada pedido.</p>}
    {aba === 'visao' && <CarteiraDaOperacao clientes={clientesVisiveis} linhas={base} aoConversar={conversar} aoVerCampanhas={id => { setCliente(id); setFiltro('todas'); setBusca(''); setAba('campanhas'); }} />}
    {aba === "campanhas" && <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{linhas.length} de {base.length} campanhas · métricas de {d.desde.split("-").reverse().join("/")} até hoje</span><button className={botao.discreto} onClick={() => setFiltro("todas")}>Ver todas</button></div>
      <p className="rounded-lg bg-muted/40 px-4 py-3 text-xs leading-5 text-muted-foreground">Fonte: espelho Meta no painel. “Entrega observada” usa o último dia disponível, com coleta de até 36 horas e dia de até 72 horas; não comprova entrega neste instante. Orçamento cadastrado não equivale a verba autorizada.</p>
      <div className={juntar(ROLAGEM_OPERACAO, "max-h-[65vh] overflow-x-auto rounded-xl border border-border")}><table className="w-full min-w-[1080px] text-left text-sm"><thead className="sticky top-0 bg-card text-xs text-muted-foreground"><tr>{["Cliente / campanha", "Cadastro / entrega", "Gasto e resultado", "Verba / término", "Fonte e corte"].map(t => <th key={t} className="px-4 py-3 font-medium">{t}</th>)}</tr></thead><tbody className="divide-y divide-border">{linhas.map(x => {
        const c = x.campanha; const conta = d.contas.find(a => a.external_account_id === c.external_account_id); const moeda = conta?.currency; const contaNome = d.contasNomes.find(a => a.id === c.external_account_id);
        return <tr key={c.id} className="align-top hover:bg-muted/20"><td className="max-w-sm px-4 py-4"><p className="text-xs font-medium text-primary">{nome(c.client_id)}</p><p className="mt-1 font-medium">{c.name || "Campanha sem nome"}</p><p className="mt-1 text-xs text-muted-foreground">Conta: {contaNome?.display_name || "Nome não informado"}</p><p className="mt-2 text-xs text-muted-foreground">{goalForObjective(c.objective).label}</p><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Identificação da conta</summary><p className="break-all">Conta Meta: {contaNome?.external_id || "Não informada"}<br />Campanha Meta: {c.campaign_id}</p></details></td>
          <td className="px-4 py-4"><p>{statusLabel(c.status, c.status).label}</p><p className={juntar("mt-2 text-xs", x.situacao === "entrega" ? "text-primary" : "text-warning")}>{x.situacao === "entrega" ? "Entrega observada" : x.situacao === "sem_entrega" ? "Sem entrega no último dia" : "Entrega não confirmada"}</p>{x.divergencia && <p className="mt-2 text-xs text-warning">Conferir divergência</p>}</td>
          <td className="px-4 py-4 tabular-nums"><p>{dinheiro(x.resumo?.investido, moeda)}</p><p className="mt-2 text-xs">{x.resumo?.resultados == null ? "Resultado não informado" : `${x.resumo.resultados.toLocaleString("pt-BR")} ${x.resumo.goal.resultPlural}`}</p><p className="mt-1 text-xs text-muted-foreground">Por resultado: {dinheiro(x.resumo?.custoPorResultado, moeda)}</p></td>
          <td className="px-4 py-4 text-xs"><p>{c.daily_budget != null ? `${dinheiro(c.daily_budget, moeda)}/dia` : `${dinheiro(c.lifetime_budget, moeda)} total`}</p><p className="mt-1 text-muted-foreground">Cadastrado · autorização na proposta</p><p className={juntar("mt-2", x.vencida && "text-warning")}>Término: {data(c.stop_time)}{x.vencida ? " · vencido" : ""}</p></td>
          <td className="px-4 py-4 text-xs text-muted-foreground"><p>Espelho Meta / painel</p><p className="mt-2">Métricas: {data(x.corte)}</p><p>Dia observado: {x.ultimoDia?.split("-").reverse().join("/") || "Não disponível"}</p><p className="mt-1">Cadastro: {data(c.updated_at)}</p></td></tr>;
      })}</tbody></table>{!linhas.length && <p className="p-6 text-sm text-muted-foreground">Nenhuma campanha corresponde a este filtro.</p>}</div>
    </>}
    {aba === "decisoes" && <><p className="text-sm text-muted-foreground">A aprovação vale somente para a versão e o escopo exibidos. Execução e resultado são conferidos separadamente.</p><AprovacoesExplicadas nomesDeAgentes={nomesAgentes} titulosDeTarefas={titulos} destaqueId={null} aoAbrirDiario={aoAbrir} filtroVinculos={d.links.map(l => l.id)} />{!pendentes.length && <p className="rounded-xl border border-border p-6 text-sm">Nenhuma proposta formal pendente nesta frente. Recomendações em relatórios ainda não são autorizações.</p>}</>}
    {aba === "agentes" && <div className="grid gap-4 xl:grid-cols-2">{d.links.map(l => { const runs = d.runs.filter(r => r.task_link_id === l.id).sort((a, b) => b.started_at.localeCompare(a.started_at)); return <article key={l.id} className={juntar(ROLAGEM_OPERACAO, "max-h-[60vh] space-y-3 rounded-xl border border-border p-5")}><header><p className="text-base font-semibold">{nomesAgentes.get(l.operator_id) || "Agente"}</p><p className="mt-1 text-xs text-muted-foreground">{execucaoReal(runs) ? "Execução em andamento com sinal recente" : "Sem execução em andamento confirmada"}</p></header><p className="text-sm font-medium">{titulos.get(l.kanban_task_id || l.painel_task_id) || "Frente operacional"}</p><p className="text-xs text-muted-foreground">Escopo: carteira · última execução: {data(runs[0]?.started_at)}</p>{l.last_action && <DocumentoDaExecucao texto={l.last_action} compacto />}{l.next_step && <div className="border-l-2 border-primary pl-3"><h4 className="text-xs font-semibold">Próximo passo</h4><DocumentoDaExecucao texto={l.next_step} compacto /></div>}{l.block_reason && <p className="text-sm text-warning">{l.block_reason}</p>}<button className={botao.secundario} onClick={() => aoAbrir(l.id, titulos.get(l.kanban_task_id || l.painel_task_id))}>Abrir trabalho e conversar</button></article>; })}{!d.links.length && <p>Nenhuma tarefa vinculada à frente Meta Ads foi encontrada.</p>}</div>}
    {aba === "relatorios" && <div className="grid gap-4 xl:grid-cols-2"><p className="text-sm text-muted-foreground xl:col-span-2">Relatórios de toda a carteira. Abra o texto ou o comprovante para conferir os clientes analisados.</p>{d.runs.filter(r => r.detail?.summary).sort((a, b) => b.started_at.localeCompare(a.started_at)).map(r => <article key={r.id} className={juntar(ROLAGEM_OPERACAO, "max-h-[65vh] rounded-xl border border-border p-5")}><p className="text-xs text-muted-foreground">{nomesAgentes.get(r.operator_id)} · {data(r.started_at)} · análise da carteira</p><h3 className="mt-2 font-semibold">{r.detail.title || "Relatório da rotina Meta Ads"}</h3><DocumentoDaExecucao texto={r.detail.summary} anexos={r.detail.attachments || []} compacto /></article>)}{d.diario.filter(e => ["evidencia", "entrega", "contexto", "comentario"].includes(e.entry_type)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(e => <article key={e.id} className={juntar(ROLAGEM_OPERACAO, "max-h-[65vh] rounded-xl border border-border p-5")}><p className="text-xs text-muted-foreground">{data(e.created_at)}</p><h3 className="mt-2 font-semibold">{e.title || "Atualização da carteira"}</h3><DocumentoDaExecucao texto={e.body} anexos={e.attachments || []} compacto /></article>)}{d.links.filter(l => l.last_evidence).map(l => <article key={l.id} className={juntar(ROLAGEM_OPERACAO, "max-h-[65vh] rounded-xl border border-border p-5")}><h3 className="font-semibold">Comprovantes · {nomesAgentes.get(l.operator_id)}</h3><DocumentoDaExecucao texto={l.last_evidence} /></article>)}{!d.diario.length && !d.links.some(l => l.last_evidence) && <p>Não há relatório acessível registrado nesta frente. Um caminho na VPS precisa ser importado como arquivo para abrir no painel.</p>}</div>}
    {aba === "historico" && <div className="space-y-4"><p className="text-sm text-muted-foreground">Proposta → decisão → execução com comprovante → resultado medido. Um relatório, por si só, não comprova otimização.</p>{d.aprovacoes.map(a => { const entregas = d.entregas.filter(e => e.approval_id === a.id); return <article key={a.id} className={juntar(ROLAGEM_OPERACAO, "max-h-[65vh] rounded-xl border border-border p-5")}><h3 className="font-semibold">{a.o_que}</h3><p className="mt-2 text-xs text-muted-foreground">Versão {a.payload_version} · {data(a.created_at)}</p><p className="mt-3 text-sm">Decisão: {({ aprovado: "Aprovada", rejeitado: "Rejeitada", alteracoes_pedidas: "Ajustes solicitados", pendente: "Pendente", adiado: "Adiada" } as Record<string, string>)[a.status] || "A conferir"}</p>{a.decision_note && <DocumentoDaExecucao texto={a.decision_note} />}{entregas.map(e => <div key={e.id} className="mt-3 border-l-2 border-primary pl-3"><p className="text-sm">Execução registrada: {e.o_que} · {data(e.occurred_at)}</p><DocumentoDaExecucao texto={e.onde_acessar || "Comprovante não informado"} /></div>)}{!entregas.length && <p className="mt-2 text-sm text-muted-foreground">Nenhuma execução comprovada vinculada a esta proposta.</p>}<p className="mt-2 text-xs text-muted-foreground">Resultado após a mudança: sem medição vinculada. Os totais da carteira não comprovam o efeito desta proposta.</p></article>; })}{!d.aprovacoes.length && <p className="rounded-xl border border-border p-5 text-sm">Ainda não há propostas versionadas nesta frente.</p>}<details><summary className="cursor-pointer text-sm">Execuções e relatórios registrados ({d.runs.length})</summary>{[...d.runs].sort((a, b) => b.started_at.localeCompare(a.started_at)).map(r => <div className="border-b border-border py-3" key={r.id}><p className="text-sm">{nomesAgentes.get(r.operator_id)} · {estadoDaExecucao(r.status)} · {data(r.started_at)}</p><DocumentoDaExecucao texto={r.detail?.action || r.detail?.title || "Sem descrição registrada"} compacto /></div>)}</details></div>}
  </section>;
}
