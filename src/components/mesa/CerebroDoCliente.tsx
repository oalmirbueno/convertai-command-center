import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Plus, RefreshCw, Search, Archive, RotateCcw, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { AREA, CATEGORIA, areaDoRegistro, categoriaDoRegistro, estadoDoRegistro, filtrarConhecimento, secoesDoDossie, type RegistroDeConhecimento } from "@/lib/mesa/conhecimentoDoCliente";
import { AGENTE_DA_AREA, chaveDoAprendizado, lerCerebro, type AreaDoCerebro } from "../../../supabase/functions/_shared/cerebro-do-cliente";
import { textoDoErro } from "@/lib/mesa/api";

const selectClass = "h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-xs";
const dataCurta = (v?: string | null) => v ? new Date(v).toLocaleDateString("pt-BR") : "Sem data";
export default function CerebroDoCliente({ clientId, userId, somenteMemoria = false, onRevisar }: { clientId: string; userId?: string | null; somenteMemoria?: boolean; onRevisar?: (texto: string) => void }) {
  const qc = useQueryClient();
  const [aba, setAba] = useState(somenteMemoria ? "uso" : "visao");
  const [busca, setBusca] = useState("");
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
    queryKey: ["mesa", "cerebro-organizado", clientId], enabled: !!clientId, staleTime: 30_000,
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
  return <section aria-label="Segundo cérebro do cliente" className="min-w-0 space-y-3 border-b border-border pb-4">
    <div className="flex flex-wrap items-center gap-2">
      <Brain className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Segundo cérebro</h2>
      <AjudaRecolhida rotulo="Como o segundo cérebro funciona">Dossiê e memória do cliente, com origem e validade. Em uso significa registro ativo, não fato verificado. Os agentes leem as áreas relevantes e as regras gerais. Arquivar preserva o histórico. A validade vencida não apaga o registro.</AjudaRecolhida>
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => setNovo(!novo)} aria-expanded={novo}><Plus className="mr-1 h-3.5 w-3.5" />Registrar</Button>
        <Button size="icon" variant="ghost" aria-label="Atualizar segundo cérebro" disabled={consulta.isFetching} onClick={() => { void consulta.refetch(); if (aba === "resultados") void sinais.refetch(); }}><RefreshCw className={`h-3.5 w-3.5 ${consulta.isFetching ? "animate-spin" : ""}`} /></Button>
      </div>
    </div>
    {novo && <form className="space-y-3 rounded-xl border border-border p-3" onSubmit={e => { e.preventDefault(); void salvar(); }}>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-xs">Área<select aria-label="Área do conhecimento" value={novaArea} onChange={e => setNovaArea(e.target.value as AreaDoCerebro)} className={selectClass}>{Object.entries(AREA).map(([v,n]) => <option key={v} value={v}>{n}</option>)}</select></label>
        <label className="grid gap-1 text-xs">Tipo<select aria-label="Tipo de conhecimento" value={categoria} onChange={e => setCategoria(e.target.value)} className={selectClass}>{["aprendizado","preferencia","evitar"].map(v => <option key={v} value={v}>{CATEGORIA[v]}</option>)}</select></label>
        <label className="grid gap-1 text-xs">Validade<select aria-label="Validade do conhecimento" value={validade} onChange={e => setValidade(e.target.value)} className={selectClass}><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="">Sem prazo</option></select></label>
      </div>
      <Textarea aria-label="Conhecimento do cliente" value={texto} onChange={e => setTexto(e.target.value)} maxLength={1600} rows={3} placeholder="Uma decisão, preferência ou informação que os agentes precisam lembrar." />
      <Input aria-label="Fonte do conhecimento" value={evidencia} onChange={e => setEvidencia(e.target.value)} maxLength={400} placeholder="Fonte ou evidência: reunião, documento, pedido do cliente…" />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setNovo(false)}>Cancelar</Button><Button type="submit" disabled={gravando || texto.trim().length < 3}>Salvar conhecimento</Button></div>
    </form>}
    <div role="tablist" aria-label="Conhecimento do cliente" className="flex flex-wrap gap-1">
      {(somenteMemoria ? ["uso","revisar","historico","resultados"] : ["visao","uso","revisar","historico","resultados"]).map(v => <button key={v} role="tab" aria-selected={aba === v} onClick={() => { setAba(v); setLimite(15); }} className={`rounded-lg px-3 py-2 text-xs ${aba === v ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`}>{({visao:"Visão atual",uso:"Em uso",revisar:"A revisar",historico:"Histórico",resultados:"Resultados e sinais"} as Record<string,string>)[v]}{["uso","revisar","historico"].includes(v) && <span className="ml-1 opacity-70">{contagem(v)}</span>}</button>)}
    </div>
    {consulta.isLoading && <p className="text-xs text-muted-foreground">Reunindo o conhecimento do cliente…</p>}
    {consulta.isError && <p role="alert" className="text-xs text-destructive">Não foi possível consultar o conhecimento. Use Atualizar para tentar novamente.</p>}
    {dados && aba === "visao" && <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><BookOpen className="h-3.5 w-3.5" />{atual ? `Dossiê v${atual.version} · ${dataCurta(atual.updated_at)} · ${atual.source || "Origem não informada"}` : "Dossiê ainda não registrado"}{onRevisar && <button className="ml-auto text-primary" onClick={() => onRevisar("Revise o dossiê e o conhecimento deste cliente com base nas fontes disponíveis. Separe fatos, decisões, pendências e dúvidas. Preserve o histórico e não apresente hipótese como fato confirmado.")}>Revisar com o agente</button>}</div>
      {atual?.summary && <p className="text-sm leading-relaxed">{atual.summary}</p>}
      {contagem("revisar") > 0 && <button className="text-left text-xs text-amber-500" onClick={() => setAba("revisar")}>{contagem("revisar")} registros precisam de revisão de validade ou período</button>}
      {secoesDoDossie(atual?.content || "").map((s,i) => <details key={i} className="rounded-lg border border-border p-3" open={i === 0}><summary className="cursor-pointer text-sm font-medium">{s.titulo}</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground break-words">{s.texto}</p></details>)}
      {!atual && <p className="text-xs text-muted-foreground">Registre informações confirmadas ou peça ao agente para organizar as fontes existentes.</p>}
    </div>}
    {dados && ["uso","revisar","historico"].includes(aba) && <>
      <div className="flex flex-wrap gap-2"><div className="relative min-w-[160px] flex-1"><Search className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" /><Input className="pl-8" aria-label="Buscar no conhecimento" placeholder="Buscar informação ou fonte" value={busca} onChange={e => { setBusca(e.target.value); setLimite(15); }} /></div><select aria-label="Filtrar área" className={selectClass} value={area} onChange={e => { setArea(e.target.value); setLimite(15); }}><option value="todas">Todas as áreas</option>{Object.entries(AREA).map(([v,n]) => <option value={v} key={v}>{n}</option>)}</select><select aria-label="Filtrar tipo de conhecimento" className={selectClass} value={tipoFiltro} onChange={e => { setTipoFiltro(e.target.value); setLimite(15); }}><option value="todos">Todos os tipos</option>{Object.entries(CATEGORIA).map(([v,n]) => <option value={v} key={v}>{n}</option>)}</select></div>
      {lista.slice(0,limite).map(r => <article key={r.id} className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span className="font-medium text-primary">{CATEGORIA[categoriaDoRegistro(r)]}</span><span>{AREA[areaDoRegistro(r)]}</span><span>{dataCurta(r.criado_em)}</span>{r.reforcos && r.reforcos > 1 ? <span>{r.reforcos} registros semelhantes</span> : null}</div>
        {r.texto.length > 500 ? <details><summary className="cursor-pointer text-sm leading-relaxed">{r.texto.slice(0,180)}… <span className="text-primary">Ler registro</span></summary><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{r.texto}</p></details> : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{r.texto}</p>}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span>Origem: {r.fonte || r.origem || "não informada"}</span><span>{r.valido_ate ? `Validade: ${dataCurta(r.valido_ate)}` : "Sem prazo de validade"}</span></div>
        {r.evidencia ? <p className="break-words text-xs text-muted-foreground">Fonte: {r.evidencia}</p> : <p className="text-[11px] text-muted-foreground">Sem evidência vinculada</p>}
        {r.motivo && <details><summary className="cursor-pointer text-xs text-muted-foreground">Motivo</summary><p className="mt-1 text-xs">{r.motivo}</p></details>}
        <div className="flex justify-end">{!r.substituida_por && <Button size="sm" variant="ghost" disabled={gravando} onClick={() => void alternar(r,!r.ativa)}>{r.ativa ? <Archive className="mr-1 h-3 w-3" /> : <RotateCcw className="mr-1 h-3 w-3" />}{r.ativa ? "Arquivar" : "Reativar"}</Button>}{r.substituida_por && <span className="text-xs text-muted-foreground">Substituído por conhecimento mais recente</span>}</div>
      </article>)}
      {!lista.length && <p className="py-3 text-xs text-muted-foreground">Nenhum registro com esses filtros.</p>}
      {lista.length > limite && <Button variant="outline" size="sm" onClick={() => setLimite(v => v + 15)}>Ver mais ({lista.length - limite})</Button>}
      {aba === "historico" && dados.dossies.length > 1 && <details><summary className="cursor-pointer text-xs">Versões anteriores do dossiê</summary>{dados.dossies.filter(d => !d.is_current).map(d => <details key={d.id} className="mt-2 border-l border-border pl-3"><summary className="cursor-pointer text-xs">v{d.version} · {dataCurta(d.updated_at)} · {d.change_reason || "Atualização do contexto"}</summary><p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{d.content}</p></details>)}</details>}
      {registros.length >= 500 && <p className="text-xs text-muted-foreground">Exibindo os 500 registros mais recentes.</p>}
    </>}
    {dados && aba === "resultados" && <div className="space-y-2">
      {sinais.isLoading && <p className="text-xs text-muted-foreground">Consultando os sinais…</p>}
      {sinais.isError && <p role="alert" className="text-xs text-destructive">Não foi possível consultar os sinais. Tente atualizar.</p>}
      <p className="text-xs text-muted-foreground">Sinais registrados de campanhas, aprovações e redes. Uma observação isolada não comprova uma regra para o cliente.</p>
      {sinais.data && sinais.data.avisos.length > 0 && <p role="status" className="text-xs text-amber-500">Algumas fontes não responderam. Os resultados abaixo podem estar incompletos.</p>}
      {sinais.data?.fatos.filter(f => f.fonte !== "memoria").map(f => <article key={`${f.fonte}-${f.id}`} className="rounded-lg border border-border p-3"><p className="text-sm">{f.texto}</p><p className="mt-1 text-xs text-muted-foreground">{f.fonte} · {dataCurta(f.criado_em)}</p>{f.evidencia && <p className="mt-1 text-xs text-muted-foreground">{f.evidencia}</p>}</article>)}
      {sinais.data && !sinais.data.fatos.some(f => f.fonte !== "memoria") && <p className="text-xs text-muted-foreground">Ainda não há sinais nessas fontes para este cliente.</p>}
    </div>}
  </section>;
}
