import { useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyOpsMilestone, notifyOpsUpdate } from "@/lib/opsSync";
import { useProjects, useClients } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { Plus, X, Loader2, Upload, FileSpreadsheet, Trash2, BarChart3, LineChart } from "lucide-react";
import { parseFile, type ParsedReport } from "@/lib/adsParser";
import { notifyAdmin } from "@/lib/notifyHelpers";
import { recordMemory } from "@/lib/clientMemory";
import {
  AreaDeTrabalho,
  BarraDeAcoes,
  CabecalhoDePagina,
  CampoDeFormulario,
  GrupoDeCampos,
  Secao,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";

const ehTexto = (v: unknown) => typeof v === "string";
const ehLista = (v: unknown) => Array.isArray(v);
const ehObjeto = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

const defaultMetrics = [
  // Alcance e exposição
  { key: "reach", label: "Alcance", suffix: "" },
  { key: "impressions", label: "Impressões", suffix: "" },
  { key: "frequency", label: "Frequência", suffix: "x" },
  // Tráfego
  { key: "clicks", label: "Cliques (Todos)", suffix: "" },
  { key: "link_clicks", label: "Cliques no Link", suffix: "" },
  { key: "landing_page_views", label: "Visit. Landing", suffix: "" },
  { key: "ctr", label: "CTR", suffix: "%" },
  { key: "cpc", label: "CPC", suffix: "R$" },
  { key: "cpm", label: "CPM", suffix: "R$" },
  // Investimento e resultado
  { key: "ad_spend", label: "Investimento", suffix: "R$" },
  { key: "results", label: "Resultados", suffix: "" },
  { key: "cost_per_result", label: "Custo/Resultado", suffix: "R$" },
  { key: "cpa", label: "CPA", suffix: "R$" },
  // Mensagens / Leads (distintos!)
  { key: "messages", label: "Mensagens", suffix: "" },
  { key: "cost_per_message", label: "Custo/Mensagem", suffix: "R$" },
  { key: "leads", label: "Leads", suffix: "" },
  { key: "cost_per_lead", label: "Custo/Lead", suffix: "R$" },
  // Social / Perfil
  { key: "profile_visits", label: "Visitas ao Perfil", suffix: "" },
  { key: "followers_gained", label: "Novos Seguidores", suffix: "" },
  { key: "followers_total", label: "Seguidores (Total)", suffix: "" },
  { key: "engagement", label: "Engajamento", suffix: "" },
  { key: "engagement_rate", label: "Taxa Engaj.", suffix: "%" },
  { key: "likes", label: "Curtidas", suffix: "" },
  { key: "comments", label: "Comentários", suffix: "" },
  { key: "shares", label: "Compart.", suffix: "" },
  { key: "saves", label: "Salvamentos", suffix: "" },
  // Vídeo
  { key: "video_views", label: "Views de Vídeo", suffix: "" },
  { key: "thru_plays", label: "ThruPlays", suffix: "" },
  // E-commerce
  { key: "purchases", label: "Compras", suffix: "" },
  { key: "revenue", label: "Receita", suffix: "R$" },
  { key: "roas", label: "ROAS", suffix: "x" },
  { key: "add_to_cart", label: "Add. Carrinho", suffix: "" },
  { key: "initiate_checkout", label: "Checkout Inic.", suffix: "" },
];

interface CustomMetric {
  label: string;
  value: number | string;
}

interface ChartDataRow {
  label: string;
  [key: string]: string | number;
}

const CHART_TYPES = [
  { value: "area", label: "Área", icon: LineChart },
  { value: "bar", label: "Barras", icon: BarChart3 },
  { value: "line", label: "Linha", icon: LineChart },
];

export default function AdminReportCreate({ editId }: { editId?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { data: clients } = useClients();
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Vindo da área de Anúncios, a tela já abre preenchida com os números REAIS
  // da campanha. Antes o caminho era exportar a planilha do Gerenciador e
  // subir aqui; agora o dado já está no painel e digitar de novo só criaria
  // chance de erro.
  const [params] = useSearchParams();

  // Rascunho do relatório novo: fica guardado no navegador até salvar ou
  // descartar (sair e voltar não perde nada). Vindo de Anúncios, o rascunho é
  // daquela chegada (cliente e período), para não misturar com outro.
  const origem = params.get("cliente") || params.get("metricas")
    ? `anuncios:${params.get("cliente") || ""}:${params.get("inicio") || ""}:${params.get("fim") || ""}`
    : "manual";
  const esquecedores: Array<() => void> = [];
  const useCampo = <T,>(nome: string, inicial: T, validar: (v: unknown) => boolean) => {
    const r = useEstadoDaTela<T>(`novo:${origem}:${nome}`, inicial, { validar });
    esquecedores.push(r[2]);
    return r;
  };

  const [clientId, setClientId] = useCampo("cliente", params.get("cliente") || "", ehTexto);
  const [projectId, setProjectId] = useCampo("projeto", "", ehTexto);
  const [title, setTitle] = useCampo("titulo", params.get("titulo") || "", ehTexto);
  const [periodStart, setPeriodStart] = useCampo("inicio", params.get("inicio") || "", ehTexto);
  const [periodEnd, setPeriodEnd] = useCampo("fim", params.get("fim") || "", ehTexto);
  const [summary, setSummary] = useCampo("resumo", params.get("resumo") || "", ehTexto);
  const [highlights, setHighlights] = useCampo("destaques", params.get("destaques") || "", ehTexto);
  const [nextSteps, setNextSteps] = useCampo("proximos", "", ehTexto);
  const [internalNotes, setInternalNotes] = useCampo("internas", "", ehTexto);
  const [metricasIniciais] = useState<Record<string, number>>(() => {
    // Os números chegam da área de Anúncios já nos nomes que este relatório
    // usa (ad_spend, reach, results...), então caem direto nos campos.
    try {
      const cru = params.get("metricas");
      if (!cru) return {};
      const lido = JSON.parse(cru) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(lido)
          .filter(([, valor]) => Number.isFinite(Number(valor)))
          .map(([chave, valor]) => [chave, Number(valor)]),
      );
    } catch {
      return {};
    }
  });
  const [metrics, setMetrics] = useCampo<Record<string, number>>("metricas", metricasIniciais, ehObjeto);
  const [customMetrics, setCustomMetrics] = useCampo<CustomMetric[]>("personalizadas", [], ehLista);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileUrl, setFileUrl] = useCampo("arquivo", "", ehTexto);
  const [fileName, setFileName] = useCampo("nome-do-arquivo", "", ehTexto);
  const [chartData, setChartData] = useCampo<ChartDataRow[]>("grafico", [], ehLista);
  const [chartType, setChartType] = useCampo("tipo-do-grafico", "area", (v) => v === "area" || v === "bar" || v === "line");
  const [chartColumns, setChartColumns] = useCampo<string[]>("colunas", [], ehLista);
  const [parsedSource, setParsedSource] = useCampo<{ source: string; label: string; rows: any[]; dimensionKey: string } | null>("fonte", null, (v) => v === null || ehObjeto(v));

  const temRascunho = [
    clientId !== (params.get("cliente") || ""),
    projectId,
    title !== (params.get("titulo") || ""),
    summary !== (params.get("resumo") || ""),
    highlights !== (params.get("destaques") || ""),
    nextSteps,
    internalNotes,
    customMetrics.length,
    chartData.length,
    fileUrl,
  ].some(Boolean);
  const descartarRascunho = () => {
    esquecedores.forEach((esquecer) => esquecer());
  };

  const filteredProjects = (projects || []).filter((p: any) => !clientId || p.client_id === clientId);

  const addCustomMetric = () => setCustomMetrics(prev => [...prev, { label: "", value: "" }]);
  const removeCustomMetric = (idx: number) => setCustomMetrics(prev => prev.filter((_, i) => i !== idx));
  const updateCustomMetric = (idx: number, field: "label" | "value", val: string) => {
    setCustomMetrics(prev => prev.map((m, i) => i === idx ? { ...m, [field]: field === "value" ? Number(val) || val : val } : m));
  };

  // CSV IMPORT
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed: ParsedReport = await parseFile(file);
      if (!parsed.chartData.length) { toast.error("Não consegui ler dados do arquivo."); return; }
      setChartData(parsed.chartData as any);
      setChartColumns(parsed.chartColumns);
      setMetrics(prev => ({ ...prev, ...Object.fromEntries(Object.entries(parsed.metrics).map(([k, v]) => [k, Math.round(Number(v) * 100) / 100])) }));
      if (parsed.customMetrics?.length) {
        setCustomMetrics(prev => {
          const existing = new Set(prev.map(m => m.label.toLowerCase()));
          const additions = parsed.customMetrics.filter(m => !existing.has(m.label.toLowerCase()));
          return [...prev, ...additions];
        });
      }
      if (parsed.periodStart && !periodStart) setPeriodStart(parsed.periodStart);
      if (parsed.periodEnd && !periodEnd) setPeriodEnd(parsed.periodEnd);
      setParsedSource({ source: parsed.source, label: parsed.sourceLabel, rows: parsed.rows, dimensionKey: parsed.dimensionKey });
      const mappedCount = Object.keys(parsed.metrics).length;
      const customCount = parsed.customMetrics?.length || 0;
      toast.success(`${parsed.sourceLabel}: ${parsed.rows.length} linhas, ${mappedCount} métricas mapeadas${customCount ? ` + ${customCount} personalizadas` : ""}`);
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao processar arquivo: " + (err?.message || "desconhecido"));
    }
    e.target.value = "";
  };

  // Manual chart data entry
  const addChartRow = () => {
    const cols = chartColumns.length > 0 ? chartColumns : ["Valor"];
    if (chartColumns.length === 0) setChartColumns(["Valor"]);
    const row: ChartDataRow = { label: "" };
    cols.forEach(c => { row[c] = 0; });
    setChartData(prev => [...prev, row]);
  };

  const addChartColumn = () => {
    const name = prompt("Nome da coluna (ex: Alcance, Cliques):");
    if (!name?.trim()) return;
    setChartColumns(prev => [...prev, name.trim()]);
    setChartData(prev => prev.map(row => ({ ...row, [name.trim()]: 0 })));
  };

  const updateChartCell = (rowIdx: number, key: string, val: string) => {
    setChartData(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: key === "label" ? val : (Number(val) || 0) } : r));
  };

  const removeChartRow = (idx: number) => setChartData(prev => prev.filter((_, i) => i !== idx));

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!clientId) {
      toast.error("Selecione o cliente antes de enviar o arquivo.");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `reports/${clientId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("files").upload(path, file);
      if (error) throw error;
      setFileUrl(`files://${path}`);
      setFileName(file.name);
      toast.success("Arquivo enviado!");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (status: string) => {
    if (!clientId || !projectId || !title) {
      toast.error("Preencha cliente, projeto e título.");
      return;
    }
    setSaving(true);
    try {
      const metricsPayload: any = { ...metrics, custom: customMetrics.filter(m => m.label) };
      if (parsedSource) {
        metricsPayload.__source = parsedSource.source;
        metricsPayload.__source_label = parsedSource.label;
        metricsPayload.__breakdown = parsedSource.rows.slice(0, 200);
        metricsPayload.__dimension = parsedSource.dimensionKey;
      }
      const payload: any = {
        client_id: clientId,
        project_id: projectId,
        title,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        summary: summary || null,
        highlights: highlights || null,
        next_steps: nextSteps || null,
        internal_notes: internalNotes || null,
        metrics: metricsPayload,
        file_url: fileUrl || null,
        chart_data: chartData.length > 0 ? chartData : null,
        chart_type: chartType,
        status,
        created_by: user!.id,
      };

      await supabase.from("reports").insert(payload);

      if (status === "published") {
        // Notify client
        await supabase.from("notifications").insert({
          user_id: clientId,
          message: `Novo relatório disponível: ${title}`,
          notification_type: "report",
          link: "/relatorios",
        });
        // Notify admin (if creator is not admin)
        await notifyAdmin(`Novo relatório publicado: ${title}`, "report", "/relatorios");
        // Update feed
        const { data: upd } = await supabase.from("updates").insert({
          project_id: projectId,
          author_id: user!.id,
          client_visible: true,
          message: `Relatório publicado: ${title}`,
          update_type: "milestone",
        }).select().single();
        notifyOpsUpdate(upd);

        // O relatório entra na história do cliente.
        //
        // Sem isto ele era um documento solto: a Central escrevia o ritual da
        // semana sem saber que um relatório tinha sido publicado, e o ciclo
        // não contava com essa entrega. Agora a mesma memória que alimenta o
        // ritual, o dossiê e o MCP passa a conhecer o que foi entregue e o que
        // ficou combinado como próximo passo.
        await recordMemory({
          clientId,
          projectId,
          kind: "entrega",
          title: `Relatório publicado: ${title}`,
          content: [
            periodStart && periodEnd ? `Período: ${periodStart} a ${periodEnd}.` : "",
            summary,
            highlights ? `Destaques: ${highlights}` : "",
            nextSteps ? `Próximos passos combinados: ${nextSteps}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          source: "relatorio",
          tags: ["relatorio", "entrega"],
          metadata: {
            report_title: title,
            period_start: periodStart || null,
            period_end: periodEnd || null,
            source_kind: parsedSource?.source || null,
          },
        });
      }

      queryClient.invalidateQueries({ queryKey: ["reports"] });
      // A Central e o ciclo leem a memória do cliente: recarregam junto.
      queryClient.invalidateQueries({ queryKey: ["memoria-cliente"] });
      toast.success(status === "published" ? "Relatório publicado!" : "Rascunho salvo!");
      descartarRascunho();
      navigate("/relatorios");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const acoes = (
    <>
      <button type="button" onClick={() => handleSave("draft")} disabled={saving} className={botao.secundario}>
        Salvar rascunho
      </button>
      <button type="button" onClick={() => handleSave("published")} disabled={saving} className={botao.primario}>
        {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
        Publicar relatório
      </button>
    </>
  );

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Novo relatório"
        voltar={{ para: "/relatorios", rotulo: "Relatórios" }}
        descricao={temRascunho ? "Rascunho guardado neste navegador" : undefined}
        ajuda="Relatório de entrega: números do período, gráfico, análise e anexo. O rascunho fica guardado aqui enquanto você não salva."
        acoes={
          <>
            {temRascunho && (
              <button type="button" onClick={descartarRascunho} className={juntar(botao.discreto, "hidden sm:inline-flex")}>
                Descartar rascunho
              </button>
            )}
            <span className="hidden sm:contents [&>*]:ml-2">{acoes}</span>
          </>
        }
      />

      <AreaDeTrabalho memoriaDaRolagem="relatorio:novo" rotuloDoPrincipal="Formulário do relatório">
        <div className="max-w-4xl space-y-6 pb-4">
          {/* INFORMAÇÕES BÁSICAS */}
          <GrupoDeCampos titulo="Informações básicas">
            <CampoDeFormulario rotulo="Cliente" obrigatorio>
              <select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(""); }} className={campo}>
                <option value="">Selecione</option>
                {(clients || []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.company_name || c.full_name}</option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Projeto" obrigatorio>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={campo}>
                <option value="">Selecione</option>
                {filteredProjects.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Título" obrigatorio largo>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Relatório semanal de redes sociais" className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Início do período">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Fim do período">
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={campo} />
            </CampoDeFormulario>
          </GrupoDeCampos>

          {/* MÉTRICAS */}
          <Secao
            titulo="Métricas"
            divisoria
            descricao={parsedSource ? `Fonte: ${parsedSource.label} · ${parsedSource.rows.length} linhas · dimensão ${parsedSource.dimensionKey}` : undefined}
            ajuda="Importe o export do Google Ads, Meta Ads, Social Media ou Vendas (CSV/XLSX). O sistema detecta o tipo, normaliza as colunas e preenche os números e o gráfico."
            acao={
              <button type="button" onClick={() => csvInputRef.current?.click()} className={botao.secundario} aria-label="Importar CSV ou XLSX">
                <FileSpreadsheet className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                <span className="hidden sm:inline">Importar CSV / XLSX</span>
              </button>
            }
          >
            <input ref={csvInputRef} type="file" accept=".csv,.tsv,.txt,.xlsx" className="hidden" onChange={handleCsvImport} />
            <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-4">
              {defaultMetrics.map((m) => (
                <CampoDeFormulario key={m.key} rotulo={m.suffix ? `${m.label} (${m.suffix})` : m.label}>
                  <input
                    type="number"
                    value={metrics[m.key] ?? ""}
                    onChange={(e) => setMetrics((prev) => ({ ...prev, [m.key]: Number(e.target.value) }))}
                    placeholder="0"
                    className={juntar(campo, "tabular-nums")}
                  />
                </CampoDeFormulario>
              ))}
            </div>

            <div className="mt-5">
              <p className={juntar(texto.rotulo, "mb-2")}>Métricas personalizadas</p>
              {customMetrics.length > 0 && (
                <ul className="mb-2 space-y-2">
                  {customMetrics.map((cm, idx) => (
                    <li key={idx} className="flex min-w-0 items-center">
                      <input value={cm.label} onChange={(e) => updateCustomMetric(idx, "label", e.target.value)} placeholder="Nome da métrica" aria-label="Nome da métrica" className={juntar(campo, "flex-1")} />
                      <input type="number" value={cm.value} onChange={(e) => updateCustomMetric(idx, "value", e.target.value)} placeholder="Valor" aria-label="Valor da métrica" className={juntar(campo, "ml-2 w-28 shrink-0 tabular-nums")} />
                      <button type="button" onClick={() => removeCustomMetric(idx)} className={juntar(botao.icone, "ml-1 hover:text-destructive")} aria-label="Remover métrica">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={addCustomMetric} className={juntar(botao.discreto, "-ml-2.5 text-primary")}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Adicionar métrica
              </button>
            </div>
          </Secao>

          {/* DADOS DO GRÁFICO */}
          <Secao
            titulo="Gráfico"
            divisoria
            descricao={chartData.length ? `${chartData.length} ${chartData.length === 1 ? "linha" : "linhas"}` : undefined}
            ajuda="Monte a tabela que aparece no gráfico do relatório. Importe via CSV ou adicione linhas à mão."
            acao={
              <SeletorCompacto
                rotulo="Tipo de gráfico"
                opcoes={CHART_TYPES.map((ct) => ({ valor: ct.value, rotulo: ct.label, icone: <ct.icon className="h-3.5 w-3.5" /> }))}
                valor={chartType}
                onEscolher={setChartType}
              />
            }
          >
            {chartData.length > 0 && (
              <div className="mb-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-[13px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className={juntar(texto.rotulo, "px-2 py-2 text-left")}>Período</th>
                      {chartColumns.map((col) => (
                        <th key={col} className={juntar(texto.rotulo, "px-2 py-2 text-right")}>{col}</th>
                      ))}
                      <th className="w-9" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {chartData.map((row, ri) => (
                      <tr key={ri}>
                        <td className="px-1 py-1">
                          <input value={row.label} onChange={(e) => updateChartCell(ri, "label", e.target.value)} placeholder="Ex.: Sem 1" aria-label="Período" className={juntar(campo, "h-8 border-transparent bg-transparent")} />
                        </td>
                        {chartColumns.map((col) => (
                          <td key={col} className="px-1 py-1">
                            <input
                              type="number"
                              value={row[col] ?? 0}
                              onChange={(e) => updateChartCell(ri, col, e.target.value)}
                              aria-label={col}
                              className={juntar(campo, "h-8 border-transparent bg-transparent text-right tabular-nums")}
                            />
                          </td>
                        ))}
                        <td className="text-right">
                          <button type="button" onClick={() => removeChartRow(ri)} className={juntar(botao.icone, "hover:text-destructive")} aria-label="Remover linha">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="-ml-2.5 flex flex-wrap items-center">
              <button type="button" onClick={addChartRow} className={juntar(botao.discreto, "text-primary")}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Adicionar linha
              </button>
              <button type="button" onClick={addChartColumn} className={juntar(botao.discreto, "text-primary")}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Adicionar coluna
              </button>
            </div>
          </Secao>

          {/* ANÁLISE E CONTEÚDO */}
          <GrupoDeCampos titulo="Análise" colunas={1} className="border-t border-border pt-5">
            <CampoDeFormulario rotulo="Resumo executivo">
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={6} placeholder="Resumo geral do período analisado..." className={campoTexto} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Destaques do período">
              <textarea value={highlights} onChange={(e) => setHighlights(e.target.value)} rows={4} placeholder={"Post com mais engajamento: ...\nMelhor dia: ...\nMeta superada: ..."} className={campoTexto} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Próximos passos">
              <textarea value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} rows={4} placeholder={"Aumentar frequência de Reels...\nTestar novos horários..."} className={campoTexto} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Observações internas" apoio="Não aparece para o cliente.">
              <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} placeholder="Notas internas da equipe..." className={campoTexto} />
            </CampoDeFormulario>
          </GrupoDeCampos>

          {/* ANEXOS */}
          <Secao titulo="Anexo" divisoria ajuda="Relatório externo em PDF, PPTX ou DOC. Escolha o cliente antes de enviar.">
            {fileName ? (
              <div className={juntar(superficie.poco, "flex min-w-0 items-center px-3 py-2")}>
                <Upload className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{fileName}</span>
                <button type="button" onClick={() => { setFileUrl(""); setFileName(""); }} className={juntar(botao.discreto, "ml-2 h-8 text-destructive")}>
                  Remover
                </button>
              </div>
            ) : (
              <label className={juntar("flex min-w-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border px-4 py-6 transition-colors hover:border-primary/50", uploading && "pointer-events-none opacity-70")}>
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                <span className={texto.auxiliar}>{uploading ? "Enviando..." : "Clique ou arraste um arquivo"}</span>
                <input type="file" className="hidden" accept=".pdf,.pptx,.doc,.docx" onChange={handleFileUpload} disabled={uploading} />
              </label>
            )}
          </Secao>

          {/* Celular: as ações ficam no pé, sempre à vista */}
          <BarraDeAcoes fixa className="sm:hidden" inicio={temRascunho ? <button type="button" onClick={descartarRascunho} className="text-[12px] text-muted-foreground underline">Descartar</button> : undefined}>
            {acoes}
          </BarraDeAcoes>
        </div>
      </AreaDeTrabalho>
    </div>
  );
}
