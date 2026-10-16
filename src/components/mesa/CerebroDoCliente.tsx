import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Plus, RefreshCw, Search, Archive, RotateCcw, BookOpen, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar } from "@/components/sistema/estilos";
import { AREA, CATEGORIA, areaDoRegistro, categoriaDoRegistro, estadoDoRegistro, filtrarConhecimento, secoesDoDossie, type RegistroDeConhecimento } from "@/lib/mesa/conhecimentoDoCliente";
import { AGENTE_DA_AREA, chaveDoAprendizado, lerCerebro, type AreaDoCerebro } from "../../../supabase/functions/_shared/cerebro-do-cliente";
import { textoDoErro } from "@/lib/mesa/api";

const selectClass = "h-8 min-w-0 rounded-md bg-muted/60 px-2 text-[12px]";
const dataCurta = (v?: string | null) => v ? new Date(v).toLocaleDateString("pt-BR") : "Sem data";
const NOMES_DAS_ABAS: Record<string, string> = { visao: "Visão atual", uso: "Em uso", revisar: "A revisar", historico: "Histórico", resultados: "Sinais" };
/**
 * Segundo cérebro do cliente (16/10, dono: "está ocupando muito e tem que
 * melhorar"): virou uma aba do Contexto e ficou enxuto. Sem caixas nem
 * bordas, ações só em ícone (o nome no title e no leitor de tela), os
 * metadados de cada registro em uma linha e o dossiê em seções recolhidas.
 */
export default function CerebroDoCliente({ clientId, userId, somenteMemoria = false, onRevisar }: { clientId: string; userId?: string | null; somenteMemoria?: boolean; onRevisar?: (texto: string) => void }) {
  const qc = useQueryClient();
  const [aba, setAba] = useState(somenteMemoria ? "uso" : "visao");
  const [busca, setBusca] = useState("");
  const [buscaDossie, setBuscaDossie] = useState("");
  const [limiteDossie, setLimiteDossie] = useState(6);
  const [area, setArea] = useState("todas");
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [limite, setLimite] = useState(15);
  const [novo, setNovo] = useState(false);
  const [texto, setTexto] = useState("");
  const [evidencia, setEvidencia] = useState("");
  const [novaArea, setNovaArea] = useState<AreaDoCerebro>("geral");
  const [categoria, setCategoria] = useState("aprendizado");
  const [validade, setValidade] = useState("90");
  const [gravando, setGravando] = useState(false);
  const consulta = useQuery({
    queryKey: ["mesa", "cerebro-organizado", clientId], enabled: !!clientId, staleTime: 30_000, refetchOnWindowFocus: true,
    queryFn: async () => {
      const [memorias, dossies, atual] = await Promise.all([
        supabase.from("agente_memoria").select("id,client_id,texto,agente,tipo,ativa,area,categoria,fonte,origem,evidencia,motivo,criado_em,valido_ate,substituida_por,reforcos,chave").eq("client_id", clientId).order("criado_em", { ascending: false }).limit(500),
        supabase.from("client_dossiers").select("id,content,summary,version,source,updated_at,change_reason,is_current").eq("client_id", clientId).eq("dossier_type", "contexto").is("project_id", null).order("version", { ascending: false }).limit(12),
        supabase.from("client_dossiers").select("id,content,summary,version,source,updated_at,change_reason,is_current").eq("client_id", clientId).eq("dossier_type", "contexto").is("project_id", null).eq("is_current", true).maybeSingle(),
      ]);
      if (memorias.error) throw memorias.error;
      if (dossies.error) throw dossies.error;
      if (atual.error) throw atual.error;
      return { registros: (memorias.data || []) as RegistroDeConhecimento[], dossies: dossies.data || [], atual: atual.data };
    },
  });
  const sinais = useQuery({ queryKey: ["mesa", "sinais-conhecimento", clientId], enabled: !!clientId && aba === "resultados", staleTime: 60_000, queryFn: () => lerCerebro(supabase, clientId) });
  const dados = consulta.data;
  const registros = dados?.registros || [];
  const atual = dados?.atual;
  const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const secoes = secoesDoDossie(atual?.content || "").filter(s => normalizar(`${s.titulo} ${s.texto}`).includes(normalizar(buscaDossie.trim())));
  const contagem = (estado: string) => registros.filter(r => estadoDoRegistro(r) === estado).length;
  const lista = filtrarConhecimento(registros, clientId, aba, busca, area).filter(r => tipoFiltro === "todos" || categoriaDoRegistro(r) === tipoFiltro);
  const atualizar = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["mesa", "cerebro-organizado", clientId] }), qc.invalidateQueries({ queryKey: ["mesa", "memoria", clientId] }), qc.invalidateQueries({ queryKey: ["mesa", "saude-conhecimento"] })]);
  };
  const alternar = async (registro: RegistroDeConhecimento, ativa: boolean) => {
    setGravando(true);
    try {
      const r = await supabase.from("agente_memoria").update({ ativa }).eq("client_id", clientId).eq("id", registro.id).eq("ativa", registro.ativa).is("substituida_por", null).select("id").maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) throw new Error("Este registro mudou. Atualize e confira novamente.");
      toast.success(ativa ? "Conhecimento reativado" : "Guardado no histórico", { description: ativa ? "A validade original foi preservada." : "O histórico permanece disponível para consulta." });
      await atualizar();
    } catch (e) { toast.error("Não foi possível salvar", { description: textoDoErro(e) }); }
    finally { setGravando(false); }
  };
  const salvar = async () => {
    if (texto.trim().length < 3 || gravando) return;
    setGravando(true);
    try {
      const agente = AGENTE_DA_AREA[novaArea];
      const chave = chaveDoAprendizado(texto);
      const existente = await supabase.from("agente_memoria").select("id").eq("client_id", clientId).eq("agente", agente).eq("ativa", true).eq("chave", chave).limit(1);
      if (existente.error) throw existente.error;
      if (existente.data?.length) { toast.info("Esse conhecimento já está registrado", { description: "Confira em Em uso ou A revisar; nada foi duplicado." }); return; }
      const r = await supabase.from("agente_memoria").insert({ client_id: clientId, agente, area: novaArea, categoria, tipo: categoria, texto: texto.trim(), chave, evidencia: evidencia.trim() || null, origem: "manual", fonte: "painel", criado_por: userId || null, ativa: true, reforcos: 1, valido_ate: validade ? new Date(Date.now() + Number(validade) * 86400000).toISOString() : null }).select("id").single();
      if (r.error) throw r.error;
      if (!r.data) throw new Error("A gravação não foi confirmada.");
      setTexto(""); setEvidencia(""); setNovo(false); setAba("uso");
      await atualizar(); toast.success("Conhecimento salvo para este cliente");
    } catch (e) { toast.error("Conhecimento não salvo", { description: textoDoErro(e) }); }
    finally { setGravando(false); }
  };
  return <section aria-label="Segundo cérebro do cliente" className="min-w-0 space-y-3">
    <div className="flex min-w-0 items-center">
      <Brain className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><h2 className="shrink-0 text-[13px] font-semibold">Segundo cérebro</h2>
      <AjudaRecolhida className="ml-1" rotulo="Como o segundo cérebro funciona">Dossiê e memória do cliente, com origem e validade. Em uso significa registro ativo, não fato verificado. Os agentes leem as áreas relevantes e as regras gerais. Arquivar preserva o histórico. A validade vencida não apaga o registro.</AjudaRecolhida>
      {/* Abas do cérebro na mesma linha do título (rolam de lado no celular). */}
      <div role="tablist" aria-label="Conhecimento do cliente" className="scrollbar-hidden ml-2 flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
        {(somenteMemoria ? ["uso","revisar","historico","resultados"] : ["visao","uso","revisar","historico","resultados"]).map(v => <button key={v} type="button" role="tab" aria-selected={aba === v} title={v === "resultados" ? "Resultados e sinais" : undefined} onClick={() => { setAba(v); setLimite(15); }} className={`toque-compacto h-8 shrink-0 whitespace-nowrap rounded-full px-2.5 text-[12px] transition-colors ${aba === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}>{NOMES_DAS_ABAS[v]}{["uso","revisar","historico"].includes(v) && <span className="ml-1 tabular-nums opacity-70">{contagem(v)}</span>}</button>)}
      </div>
      <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setNovo(!novo)} aria-expanded={novo} aria-label="Registrar" title="Registrar conhecimento"><Plus className="h-4 w-4" /></button>
      <button type="button" className={botao.icone} aria-label="Atualizar segundo cérebro" title="Atualizar segundo cérebro" disabled={consulta.isFetching} onClick={() => { void consulta.refetch(); if (aba === "resultados") void sinais.refetch(); }}><RefreshCw className={`h-4 w-4 ${consulta.isFetching ? "animate-spin" : ""}`} /></button>
    </div>
    {novo && <form className="space-y-3 rounded-lg bg-muted/40 p-3" onSubmit={e => { e.preventDefault(); void salvar(); }}>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-[12px]">Área<select aria-label="Área do conhecimento" value={novaArea} onChange={e => setNovaArea(e.target.value as AreaDoCerebro)} className={selectClass}>{Object.entries(AREA).map(([v,n]) => <option key={v} value={v}>{n}</option>)}</select></label>
        <label className="grid gap-1 text-[12px]">Tipo<select aria-label="Tipo de conhecimento" value={categoria} onChange={e => setCategoria(e.target.value)} className={selectClass}>{["aprendizado","preferencia","evitar"].map(v => <option key={v} value={v}>{CATEGORIA[v]}</option>)}</select></label>
        <label className="grid gap-1 text-[12px]">Validade<select aria-label="Validade do conhecimento" value={validade} onChange={e => setValidade(e.target.value)} className={selectClass}><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="">Sem prazo</option></select></label>
      </div>
      <Textarea aria-label="Conhecimento do cliente" value={texto} onChange={e => setTexto(e.target.value)} maxLength={1600} rows={3} placeholder="Uma decisão, preferência ou informação que os agentes precisam lembrar." />
      <Input aria-label="Fonte do conhecimento" value={evidencia} onChange={e => setEvidencia(e.target.value)} maxLength={400} placeholder="Fonte ou evidência: reunião, documento, pedido do cliente…" />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setNovo(false)}>Cancelar</Button><Button type="submit" disabled={gravando || texto.trim().length < 3}>Salvar conhecimento</Button></div>
    </form>}
    {consulta.isLoading && <p className="text-[12px] text-muted-foreground">Reunindo o conhecimento do cliente…</p>}
    {consulta.isError && <p role="alert" className="text-[12px] text-destructive">Não foi possível consultar o conhecimento. Use Atualizar para tentar novamente.</p>}
    {dados && aba === "visao" && <div className="space-y-3">
      <div className="flex min-w-0 items-center text-[12px] text-muted-foreground"><BookOpen className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{atual ? `Dossiê v${atual.version} · ${dataCurta(atual.updated_at)} · ${atual.source || "Origem não informada"}` : "Dossiê ainda não registrado"}</span>{atual && <Input aria-label="Buscar no dossiê" placeholder="Buscar no dossiê" value={buscaDossie} onChange={e => { setBuscaDossie(e.target.value); setLimiteDossie(6); }} className="ml-2 h-8 w-32 shrink-0 border-0 bg-muted/60 text-[12px] sm:w-48" />}{onRevisar && <button type="button" className={juntar(botao.icone, "ml-1")} aria-label="Revisar com o agente" title="Revisar com o agente" onClick={() => onRevisar("Revise o dossiê e o conhecimento deste cliente com base nas fontes disponíveis. Separe fatos, decisões, pendências e dúvidas. Preserve o histórico e não apresente hipótese como fato confirmado.")}><MessageSquarePlus className="h-4 w-4" /></button>}</div>
      {atual?.summary && <p className="line-clamp-3 text-[13px] leading-relaxed" title={atual.summary}>{atual.summary}</p>}
      {contagem("revisar") > 0 && <button type="button" className="text-left text-[12px] text-amber-500" onClick={() => setAba("revisar")}>{contagem("revisar")} registros precisam de revisão de validade ou período</button>}
      <div className="-mx-2 min-w-0">
        {secoes.slice(0,limiteDossie).map((s,i) => <details key={`${s.titulo}-${i}`} className="rounded-lg px-2 py-1.5 hover:bg-muted/40"><summary className="cursor-pointer text-[13px] font-medium">{s.titulo}</summary><div className="prose prose-sm dark:prose-invert mt-1.5 max-w-none break-words text-muted-foreground"><ReactMarkdown skipHtml components={{ img: ({ alt }) => <span>{alt}</span> }}>{s.texto}</ReactMarkdown></div></details>)}
      </div>
      {secoes.length > limiteDossie && <Button size="sm" variant="ghost" className="h-8 text-[12px]" onClick={() => setLimiteDossie(v => v + 6)}>Mais seções ({secoes.length - limiteDossie})</Button>}
      {atual && !secoes.length && <p className="text-[12px] text-muted-foreground">Nenhuma seção encontrada com essa busca.</p>}
      {!atual && <p className="text-[12px] text-muted-foreground">Registre informações confirmadas ou peça ao agente para organizar as fontes existentes.</p>}
    </div>}
    {dados && ["uso","revisar","historico"].includes(aba) && <>
      <div className="flex flex-wrap gap-2"><div className="relative min-w-[160px] flex-1"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input className="h-8 border-0 bg-muted/60 pl-8 text-[12px]" aria-label="Buscar no conhecimento" placeholder="Buscar informação ou fonte" value={busca} onChange={e => { setBusca(e.target.value); setLimite(15); }} /></div><select aria-label="Filtrar área" className={selectClass} value={area} onChange={e => { setArea(e.target.value); setLimite(15); }}><option value="todas">Todas as áreas</option>{Object.entries(AREA).map(([v,n]) => <option value={v} key={v}>{n}</option>)}</select><select aria-label="Filtrar tipo de conhecimento" className={selectClass} value={tipoFiltro} onChange={e => { setTipoFiltro(e.target.value); setLimite(15); }}><option value="todos">Todos os tipos</option>{Object.entries(CATEGORIA).map(([v,n]) => <option value={v} key={v}>{n}</option>)}</select></div>
      <div className="-mx-2 min-w-0 divide-y divide-border/50">
      {lista.slice(0,limite).map(r => <article key={r.id} className="min-w-0 space-y-1 rounded-lg px-2 py-2 hover:bg-muted/30">
        <div className="flex min-w-0 items-center text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate"><span className="font-medium text-primary">{CATEGORIA[categoriaDoRegistro(r)]}</span> · {AREA[areaDoRegistro(r)]} · {dataCurta(r.criado_em)}{r.reforcos && r.reforcos > 1 ? ` · ${r.reforcos} registros semelhantes` : ""} · {r.valido_ate ? `Validade: ${dataCurta(r.valido_ate)}` : "Sem prazo de validade"}</span>
          {!r.substituida_por && <button type="button" className={juntar(botao.icone, "-my-1 ml-1 h-7 w-7")} disabled={gravando} aria-label={r.ativa ? "Arquivar" : "Reativar"} title={r.ativa ? "Arquivar (guarda no histórico)" : "Reativar"} onClick={() => void alternar(r,!r.ativa)}>{r.ativa ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}</button>}
          {r.substituida_por && <span className="ml-1 shrink-0" title="Substituído por conhecimento mais recente">substituído</span>}
        </div>
        {r.texto.length > 500 ? <details><summary className="cursor-pointer text-[13px] leading-relaxed">{r.texto.slice(0,180)}… <span className="text-primary">Ler registro</span></summary><p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{r.texto}</p></details> : <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{r.texto}</p>}
        <p className="truncate text-[11px] text-muted-foreground" title={r.evidencia || undefined}>Origem: {r.fonte || r.origem || "não informada"} · {r.evidencia ? `Fonte: ${r.evidencia}` : "Sem evidência vinculada"}</p>
        {r.motivo && <details><summary className="cursor-pointer text-[11px] text-muted-foreground">Motivo</summary><p className="mt-1 text-[12px]">{r.motivo}</p></details>}
      </article>)}
      </div>
      {!lista.length && <p className="py-3 text-[12px] text-muted-foreground">Nenhum registro com esses filtros.</p>}
      {lista.length > limite && <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => setLimite(v => v + 15)}>Ver mais ({lista.length - limite})</Button>}
      {aba === "historico" && dados.dossies.length > 1 && <details><summary className="cursor-pointer text-[12px]">Versões anteriores do dossiê</summary>{dados.dossies.filter(d => !d.is_current).map(d => <details key={d.id} className="mt-2 pl-3"><summary className="cursor-pointer text-[12px]">v{d.version} · {dataCurta(d.updated_at)} · {d.change_reason || "Atualização do contexto"}</summary><p className="mt-2 whitespace-pre-wrap text-[12px] text-muted-foreground">{d.content}</p></details>)}</details>}
      {registros.length >= 500 && <p className="text-[12px] text-muted-foreground">Exibindo os 500 registros mais recentes.</p>}
    </>}
    {dados && aba === "resultados" && <div className="space-y-2">
      {sinais.isLoading && <p className="text-[12px] text-muted-foreground">Consultando os sinais…</p>}
      {sinais.isError && <p role="alert" className="text-[12px] text-destructive">Não foi possível consultar os sinais. Tente atualizar.</p>}
      <p className="text-[12px] text-muted-foreground">Sinais registrados de campanhas, aprovações e redes. Uma observação isolada não comprova uma regra para o cliente.</p>
      {sinais.data && sinais.data.avisos.length > 0 && <p role="status" className="text-[12px] text-amber-500">Algumas fontes não responderam. Os resultados abaixo podem estar incompletos.</p>}
      {sinais.data?.fatos.filter(f => f.fonte !== "memoria").map(f => <article key={`${f.fonte}-${f.id}`} className="rounded-lg px-2 py-1.5 hover:bg-muted/30"><p className="text-[13px]">{f.texto}</p><p className="mt-1 text-[12px] text-muted-foreground">{f.fonte} · {dataCurta(f.criado_em)}</p>{f.evidencia && <p className="mt-1 text-[12px] text-muted-foreground">{f.evidencia}</p>}</article>)}
      {sinais.data && !sinais.data.fatos.some(f => f.fonte !== "memoria") && <p className="text-[12px] text-muted-foreground">Ainda não há sinais nessas fontes para este cliente.</p>}
    </div>}
  </section>;
}
