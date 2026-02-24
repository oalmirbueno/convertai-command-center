import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProjects, useClients } from "@/hooks/useSupabaseData";
import { toast } from "sonner";
import { ArrowLeft, Plus, X, Loader2, Upload, FileSpreadsheet, Trash2, BarChart3, LineChart, PieChart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const defaultMetrics = [
  { key: "reach", label: "Alcance", suffix: "" },
  { key: "impressions", label: "Impressões", suffix: "" },
  { key: "engagement", label: "Engajamento", suffix: "%" },
  { key: "clicks", label: "Cliques", suffix: "" },
  { key: "ctr", label: "CTR", suffix: "%" },
  { key: "conversions", label: "Conversões", suffix: "" },
  { key: "followers_gained", label: "Novos Seguidores", suffix: "" },
  { key: "ad_spend", label: "Investimento", suffix: "R$" },
  { key: "cpa", label: "CPA", suffix: "R$" },
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

  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [summary, setSummary] = useState("");
  const [highlights, setHighlights] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [customMetrics, setCustomMetrics] = useState<CustomMetric[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [chartData, setChartData] = useState<ChartDataRow[]>([]);
  const [chartType, setChartType] = useState("area");
  const [chartColumns, setChartColumns] = useState<string[]>([]);

  const filteredProjects = (projects || []).filter((p: any) => !clientId || p.client_id === clientId);

  const addCustomMetric = () => setCustomMetrics(prev => [...prev, { label: "", value: "" }]);
  const removeCustomMetric = (idx: number) => setCustomMetrics(prev => prev.filter((_, i) => i !== idx));
  const updateCustomMetric = (idx: number, field: "label" | "value", val: string) => {
    setCustomMetrics(prev => prev.map((m, i) => i === idx ? { ...m, [field]: field === "value" ? Number(val) || val : val } : m));
  };

  // CSV IMPORT
  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) { toast.error("CSV precisa ter cabeçalho + dados"); return; }

        const separator = lines[0].includes(";") ? ";" : ",";
        const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, ""));
        const cols = headers.slice(1); // first column is label/date

        const rows: ChartDataRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(separator).map(c => c.trim().replace(/^"|"$/g, ""));
          if (cells.length < 2) continue;
          const row: ChartDataRow = { label: cells[0] };
          cols.forEach((col, j) => {
            const val = cells[j + 1]?.replace(/[^\d.,\-]/g, "").replace(",", ".");
            row[col] = val ? Number(val) || 0 : 0;
          });
          rows.push(row);
        }

        setChartData(rows);
        setChartColumns(cols);

        // Auto-fill metrics from last row totals or averages
        if (rows.length > 0) {
          const lastRow = rows[rows.length - 1];
          const autoMetrics: Record<string, number> = {};
          cols.forEach(col => {
            const metricKey = defaultMetrics.find(m => m.label.toLowerCase() === col.toLowerCase())?.key;
            if (metricKey) {
              // Sum all values for this column
              const total = rows.reduce((sum, r) => sum + (Number(r[col]) || 0), 0);
              autoMetrics[metricKey] = total;
            }
          });
          if (Object.keys(autoMetrics).length > 0) {
            setMetrics(prev => ({ ...prev, ...autoMetrics }));
          }
        }

        toast.success(`${rows.length} linhas importadas com ${cols.length} colunas`);
      } catch {
        toast.error("Erro ao processar CSV");
      }
    };
    reader.readAsText(file);
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
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `reports/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("files").upload(path, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from("files").getPublicUrl(path);
      setFileUrl(urlData.publicUrl);
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
      const metricsPayload = { ...metrics, custom: customMetrics.filter(m => m.label) };
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
        await supabase.from("notifications").insert({
          user_id: clientId,
          message: `Novo relatório disponível: ${title}`,
          notification_type: "report",
          link: "/relatorios",
        });
        await supabase.from("updates").insert({
          project_id: projectId,
          author_id: user!.id,
          message: `Relatório publicado: ${title}`,
          update_type: "milestone",
        });
      }

      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success(status === "published" ? "Relatório publicado!" : "Rascunho salvo!");
      navigate("/relatorios");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in max-w-3xl mx-auto w-full">
      <button onClick={() => navigate("/relatorios")} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Voltar aos Relatórios
      </button>

      <h1 className="text-xl font-semibold text-foreground">Novo Relatório</h1>

      {/* INFORMAÇÕES BÁSICAS */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Informações Básicas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente</Label>
            <Select value={clientId} onValueChange={(v) => { setClientId(v); setProjectId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {(clients || []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.company_name || c.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Projeto</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {filteredProjects.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Título</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Relatório Semanal — Redes Sociais" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Período Início</Label>
            <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Período Fim</Label>
            <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </div>
        </div>
      </section>

      {/* MÉTRICAS */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Métricas de Performance</h2>
          <button
            onClick={() => csvInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] text-primary border border-primary/30 hover:bg-primary/10 transition-colors cursor-pointer bg-transparent"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Importar CSV
          </button>
          <input ref={csvInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleCsvImport} />
        </div>

        <p className="text-[11px] text-muted-foreground -mt-2">
          Preencha manualmente ou importe um CSV. Formato: primeira coluna = período (ex: "Sem 1"), demais colunas = métricas.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {defaultMetrics.map(m => (
            <div key={m.key}>
              <label className="text-[10px] text-muted-foreground uppercase block mb-1">
                {m.label} {m.suffix && <span className="text-primary">{m.suffix}</span>}
              </label>
              <Input
                type="number"
                value={metrics[m.key] ?? ""}
                onChange={e => setMetrics(prev => ({ ...prev, [m.key]: Number(e.target.value) }))}
                placeholder="0"
                className="bg-secondary"
              />
            </div>
          ))}
        </div>

        {customMetrics.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-[10px] text-muted-foreground uppercase">Métricas Personalizadas</p>
            {customMetrics.map((cm, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="flex-1">
                  <Input value={cm.label} onChange={e => updateCustomMetric(idx, "label", e.target.value)} placeholder="Nome da métrica" className="bg-secondary" />
                </div>
                <div className="w-28">
                  <Input type="number" value={cm.value} onChange={e => updateCustomMetric(idx, "value", e.target.value)} placeholder="Valor" className="bg-secondary" />
                </div>
                <button onClick={() => removeCustomMetric(idx)} className="p-2 text-muted-foreground hover:text-destructive transition-colors cursor-pointer bg-transparent border-none">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <button onClick={addCustomMetric} className="inline-flex items-center gap-2 text-[12px] text-primary hover:text-primary/80 transition-colors cursor-pointer bg-transparent border-none p-0">
          <Plus className="w-3 h-3" /> Adicionar métrica personalizada
        </button>
      </section>

      {/* DADOS DO GRÁFICO */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Dados do Gráfico</h2>
          <div className="flex gap-2">
            {CHART_TYPES.map(ct => (
              <button
                key={ct.value}
                onClick={() => setChartType(ct.value)}
                className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                  chartType === ct.value ? "bg-primary text-primary-foreground border-primary" : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                }`}
                title={ct.label}
              >
                <ct.icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Monte a tabela de dados que será exibida no gráfico do relatório. Importe via CSV ou adicione linhas manualmente.
        </p>

        {chartData.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 text-muted-foreground font-medium">Período</th>
                  {chartColumns.map(col => (
                    <th key={col} className="text-left py-2 px-2 text-muted-foreground font-medium">{col}</th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {chartData.map((row, ri) => (
                  <tr key={ri} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="py-1.5 px-1">
                      <Input
                        value={row.label}
                        onChange={e => updateChartCell(ri, "label", e.target.value)}
                        className="h-8 text-[12px] bg-transparent border-none"
                        placeholder="Ex: Sem 1"
                      />
                    </td>
                    {chartColumns.map(col => (
                      <td key={col} className="py-1.5 px-1">
                        <Input
                          type="number"
                          value={row[col] ?? 0}
                          onChange={e => updateChartCell(ri, col, e.target.value)}
                          className="h-8 text-[12px] bg-transparent border-none font-mono"
                        />
                      </td>
                    ))}
                    <td>
                      <button onClick={() => removeChartRow(ri)} className="p-1 text-muted-foreground hover:text-destructive cursor-pointer bg-transparent border-none">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={addChartRow} className="inline-flex items-center gap-2 text-[12px] text-primary hover:text-primary/80 transition-colors cursor-pointer bg-transparent border-none p-0">
            <Plus className="w-3 h-3" /> Adicionar linha
          </button>
          <span className="text-muted-foreground">•</span>
          <button onClick={addChartColumn} className="inline-flex items-center gap-2 text-[12px] text-primary hover:text-primary/80 transition-colors cursor-pointer bg-transparent border-none p-0">
            <Plus className="w-3 h-3" /> Adicionar coluna
          </button>
        </div>
      </section>

      {/* ANÁLISE E CONTEÚDO */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Análise e Conteúdo</h2>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Resumo Executivo</Label>
          <Textarea value={summary} onChange={e => setSummary(e.target.value)} rows={6} placeholder="Resumo geral do período analisado..." className="bg-secondary" />
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Destaques do Período</Label>
          <Textarea value={highlights} onChange={e => setHighlights(e.target.value)} rows={4} placeholder="🏆 Post com mais engajamento: ...&#10;📈 Melhor dia: ...&#10;🎯 Meta superada: ..." className="bg-secondary" />
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Próximos Passos</Label>
          <Textarea value={nextSteps} onChange={e => setNextSteps(e.target.value)} rows={4} placeholder="→ Aumentar frequência de Reels...&#10;→ Testar novos horários..." className="bg-secondary" />
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Observações Internas <span className="text-destructive text-[9px]">(não visível ao cliente)</span>
          </Label>
          <Textarea value={internalNotes} onChange={e => setInternalNotes(e.target.value)} rows={3} placeholder="Notas internas da equipe..." className="bg-secondary" />
        </div>
      </section>

      {/* ANEXOS */}
      <section className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Anexos</h2>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Upload de Relatório Externo (PDF/PPTX)</Label>
          {fileName ? (
            <div className="flex items-center gap-2 mt-2 text-sm text-foreground">
              <span>📄 {fileName}</span>
              <button onClick={() => { setFileUrl(""); setFileName(""); }} className="text-destructive text-xs hover:underline cursor-pointer bg-transparent border-none">Remover</button>
            </div>
          ) : (
            <label className="mt-2 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-8 cursor-pointer hover:border-primary/50 transition-colors">
              {uploading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <Upload className="w-6 h-6 text-muted-foreground" />}
              <span className="text-xs text-muted-foreground mt-2">{uploading ? "Enviando..." : "Clique ou arraste um arquivo"}</span>
              <input type="file" className="hidden" accept=".pdf,.pptx,.doc,.docx" onChange={handleFileUpload} disabled={uploading} />
            </label>
          )}
        </div>
      </section>

      {/* ACTIONS */}
      <div className="flex gap-3 pb-8">
        <button
          onClick={() => handleSave("draft")}
          disabled={saving}
          className="flex-1 px-4 py-3 rounded-xl text-[13px] bg-secondary text-foreground hover:bg-secondary/80 transition-colors cursor-pointer border-none font-medium"
        >
          Salvar Rascunho
        </button>
        <button
          onClick={() => handleSave("published")}
          disabled={saving}
          className="flex-1 px-4 py-3 rounded-xl text-[13px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none font-medium"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Publicar Relatório"}
        </button>
      </div>
    </div>
  );
}
