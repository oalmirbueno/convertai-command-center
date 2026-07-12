import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Copy, Cpu, Eye, EyeOff,
  Key, Loader2, Network, Plus, RefreshCw, RotateCw, Server, ShieldCheck,
  Trash2, XCircle, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ConfirmModal from "@/components/ui/ConfirmModal";

/* ─── Config ──────────────────────────────────────────────── */
const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const MCP_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/mcp-server`;

const SCOPES: { id: string; label: string; hint: string; danger?: boolean }[] = [
  { id: "aceleriq:read", label: "aceleriq:read", hint: "Leitura de projetos, tarefas, clientes, relatórios." },
  { id: "aceleriq:write", label: "aceleriq:write", hint: "Criar/atualizar tarefas e rascunhos de relatório. Nunca cria cliente, cobrança ou publica.", danger: true },
  { id: "aceleriq:finance", label: "aceleriq:finance", hint: "Leitura de indicadores financeiros agregados." },
  { id: "memory:read", label: "memory:read", hint: "Consulta ao Segundo Cérebro (GitHub, somente leitura)." },
  { id: "memory:propose", label: "memory:propose", hint: "Propor arquivos em memory/inbox/chatgpt/ (nunca sobrescreve).", danger: true },
];

const EXPIRY_PRESETS: { label: string; days: number | null }[] = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "1 ano", days: 365 },
  { label: "Sem expiração", days: null },
];

/* ─── Types ───────────────────────────────────────────────── */
interface ApiKey {
  id: string;
  name: string;
  key_preview: string;
  scopes: string[] | null;
  origin: string | null;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface McpDiscovery {
  name?: string;
  version?: string;
  status?: string;
  toolCount?: number;
  secondBrain?: { configured: boolean };
  serverTime?: string;
  protocolVersion?: string;
}

interface AuditRow {
  id: string;
  created_at: string;
  tool_name: string;
  key_id: string | null;
  origin: string | null;
  success: boolean;
  status_code: number | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  correlation_id: string;
}

/* ─── Helpers ─────────────────────────────────────────────── */
async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `mcp_live_${b64}`;
}

const fmtDate = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

function keyStatus(k: ApiKey): { label: string; tone: "green" | "amber" | "red" | "muted" } {
  if (k.revoked_at) return { label: "Revogada", tone: "red" };
  if (!k.is_active) return { label: "Inativa", tone: "muted" };
  if (k.expires_at && new Date(k.expires_at) < new Date()) return { label: "Expirada", tone: "red" };
  if (k.expires_at) {
    const daysLeft = (new Date(k.expires_at).getTime() - Date.now()) / 86400000;
    if (daysLeft < 7) return { label: `Expira em ${Math.max(0, Math.ceil(daysLeft))}d`, tone: "amber" };
  }
  return { label: "Ativa", tone: "green" };
}

/* ─── Component ───────────────────────────────────────────── */
export default function MCPManager() {
  const [discovery, setDiscovery] = useState<McpDiscovery | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [loadingDiscovery, setLoadingDiscovery] = useState(true);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [showOnlyMcp, setShowOnlyMcp] = useState(true);

  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [rotateFor, setRotateFor] = useState<ApiKey | null>(null);
  const [revokeFor, setRevokeFor] = useState<ApiKey | null>(null);
  const [testFor, setTestFor] = useState<ApiKey | null>(null);

  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [issuedName, setIssuedName] = useState<string>("");
  const [tokenRevealed, setTokenRevealed] = useState(false);

  /* ─── Load discovery ─── */
  const loadDiscovery = useCallback(async () => {
    setLoadingDiscovery(true);
    setDiscoveryError(null);
    try {
      const r = await fetch(MCP_URL, { method: "GET" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDiscovery(await r.json());
    } catch (e) {
      setDiscoveryError((e as Error).message);
    } finally {
      setLoadingDiscovery(false);
    }
  }, []);

  /* ─── Load keys ─── */
  const loadKeys = useCallback(async () => {
    setLoadingKeys(true);
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, key_preview, scopes, origin, is_active, created_at, last_used_at, expires_at, revoked_at")
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar credenciais: " + error.message);
    setKeys((data as ApiKey[]) ?? []);
    setLoadingKeys(false);
  }, []);

  /* ─── Load audit ─── */
  const loadAudit = useCallback(async () => {
    setLoadingAudit(true);
    const { data, error } = await supabase
      .from("mcp_audit_log")
      .select("id, created_at, tool_name, key_id, origin, success, status_code, duration_ms, error_code, error_message, correlation_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error("Erro na auditoria: " + error.message);
    setAudit((data as AuditRow[]) ?? []);
    setLoadingAudit(false);
  }, []);

  useEffect(() => { loadDiscovery(); loadKeys(); loadAudit(); }, [loadDiscovery, loadKeys, loadAudit]);

  const mcpKeys = useMemo(
    () => showOnlyMcp ? keys.filter(k => (k.origin ?? "").toLowerCase() === "mcp" || (k.scopes ?? []).some(s => s.startsWith("aceleriq:") || s.startsWith("memory:"))) : keys,
    [keys, showOnlyMcp]
  );

  const keyById = useMemo(() => new Map(keys.map(k => [k.id, k])), [keys]);

  /* ─── Create ─── */
  const createCredential = async (name: string, scopes: string[], expiresAt: string | null) => {
    const raw = generateToken();
    const hash = await sha256Hex(raw);
    const preview = raw.slice(0, 12) + "…";
    const { data: userData } = await supabase.auth.getUser();

    const { error, data } = await supabase.from("api_keys").insert({
      name: name.trim(),
      key_hash: hash,
      key_preview: preview,
      scopes,
      origin: "mcp",
      is_active: true,
      expires_at: expiresAt,
      created_by: userData.user?.id ?? null,
    } as any).select().single();

    if (error) { toast.error("Erro ao criar: " + error.message); return null; }
    // Token is only shown once; never persisted anywhere else.
    setIssuedToken(raw);
    setIssuedName(name);
    setTokenRevealed(false);
    await loadKeys();
    return data as ApiKey;
  };

  const revokeCredential = async (k: ApiKey) => {
    const { error } = await supabase.from("api_keys")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", k.id);
    if (error) return toast.error("Erro ao revogar: " + error.message);
    toast.success("Credencial revogada");
    await loadKeys();
  };

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" /> MCP · Model Context Protocol
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-2xl">
            Painel administrativo do servidor MCP do Aceleriq OS. Gere credenciais escopadas para ChatGPT, Claude, Codex, Hermes, OpenClaw e outros agentes autorizados.
            Os tokens são exibidos <span className="font-semibold text-foreground">uma única vez</span> — nunca são armazenados em texto claro.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { loadDiscovery(); loadKeys(); loadAudit(); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Atualizar
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Nova credencial
          </Button>
        </div>
      </div>

      {/* ── Status cards ───────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-3">
        <StatusCard
          icon={<Server className="w-4 h-4" />}
          title="Servidor MCP"
          loading={loadingDiscovery}
          ok={!!discovery && !discoveryError}
          error={discoveryError}
        >
          {discovery && (
            <div className="space-y-1.5 text-[11px]">
              <Row label="Servidor" value={<code className="text-foreground">{discovery.name}@{discovery.version}</code>} />
              <Row label="Protocolo" value={<code>{discovery.protocolVersion}</code>} />
              <Row label="Tools expostos" value={<Badge variant="secondary" className="text-[10px]">{discovery.toolCount ?? 0}</Badge>} />
              <Row label="Endpoint" value={<code className="text-[10px] break-all">{MCP_URL}</code>} />
              <Row label="Hora do servidor" value={fmtDate(discovery.serverTime ?? null)} />
            </div>
          )}
        </StatusCard>

        <StatusCard
          icon={<Cpu className="w-4 h-4" />}
          title="Segundo Cérebro (GitHub bridge)"
          loading={loadingDiscovery}
          ok={!!discovery?.secondBrain?.configured}
          error={discovery?.secondBrain && !discovery.secondBrain.configured ? "Bridge não configurada" : null}
        >
          {discovery?.secondBrain && (
            <div className="space-y-1.5 text-[11px]">
              <Row label="Status" value={
                discovery.secondBrain.configured
                  ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-500 border-0">Configurado</Badge>
                  : <Badge variant="destructive" className="text-[10px]">Não configurado</Badge>
              } />
              <Row label="Escrita permitida" value={<code className="text-[10px]">memory/inbox/chatgpt/</code>} />
              <Row label="Detalhes" value={<span className="text-muted-foreground">via <code>aceleriq_capabilities</code></span>} />
            </div>
          )}
        </StatusCard>
      </div>

      {/* ── Main tabs ──────────────────────────────────────── */}
      <Tabs defaultValue="credentials" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md h-9">
          <TabsTrigger value="credentials" className="text-xs gap-1.5"><Key className="w-3.5 h-3.5" /> Credenciais</TabsTrigger>
          <TabsTrigger value="tools" className="text-xs gap-1.5"><Zap className="w-3.5 h-3.5" /> Tools</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1.5"><Activity className="w-3.5 h-3.5" /> Auditoria</TabsTrigger>
        </TabsList>

        {/* ── Credentials ── */}
        <TabsContent value="credentials" className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            <Checkbox id="only-mcp" checked={showOnlyMcp} onCheckedChange={v => setShowOnlyMcp(v === true)} />
            <label htmlFor="only-mcp" className="text-muted-foreground cursor-pointer select-none">
              Mostrar apenas credenciais MCP (origem = <code>mcp</code> ou escopos MCP)
            </label>
          </div>

          {loadingKeys ? (
            <div className="py-8 text-center text-xs text-muted-foreground"><Loader2 className="w-4 h-4 mx-auto animate-spin mb-1" /> Carregando…</div>
          ) : mcpKeys.length === 0 ? (
            <Card className="bg-secondary/30 border-dashed">
              <CardContent className="py-8 text-center">
                <Key className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm">Nenhuma credencial MCP</p>
                <p className="text-xs text-muted-foreground mt-1">Crie uma credencial para conectar agentes externos.</p>
                <Button size="sm" className="mt-3" onClick={() => setShowCreate(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Nova credencial
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {mcpKeys.map(k => {
                const st = keyStatus(k);
                const tones: Record<string, string> = {
                  green: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20",
                  amber: "bg-amber-500/15 text-amber-500 border-amber-500/20",
                  red: "bg-red-500/15 text-red-500 border-red-500/20",
                  muted: "bg-muted text-muted-foreground border-border",
                };
                return (
                  <Card key={k.id} className="bg-card">
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold truncate">{k.name}</span>
                            <Badge className={`text-[10px] border ${tones[st.tone]}`} variant="outline">{st.label}</Badge>
                            {k.origin && <Badge variant="outline" className="text-[10px]">origin: {k.origin}</Badge>}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <Key className="w-3 h-3 text-muted-foreground" />
                            <code className="bg-secondary px-1.5 py-0.5 rounded font-mono">{k.key_preview}</code>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(k.scopes ?? []).map(s => (
                              <Badge key={s} variant="secondary" className="text-[10px] font-mono">{s}</Badge>
                            ))}
                          </div>
                          <div className="grid sm:grid-cols-3 gap-x-6 gap-y-1 text-[10.5px] text-muted-foreground">
                            <span><Clock className="w-3 h-3 inline mr-1" />Criada {fmtDate(k.created_at)}</span>
                            <span><Activity className="w-3 h-3 inline mr-1" />Uso {fmtDate(k.last_used_at)}</span>
                            <span><ShieldCheck className="w-3 h-3 inline mr-1" />Expira {fmtDate(k.expires_at)}</span>
                          </div>
                        </div>
                        <div className="flex sm:flex-col gap-1 sm:items-end">
                          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => setTestFor(k)}>
                            <Zap className="w-3.5 h-3.5" /> Testar
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => setRotateFor(k)} disabled={!!k.revoked_at}>
                            <RotateCw className="w-3.5 h-3.5" /> Rotacionar
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive" onClick={() => setRevokeFor(k)} disabled={!!k.revoked_at}>
                            <Trash2 className="w-3.5 h-3.5" /> Revogar
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Tools ── */}
        <TabsContent value="tools" className="mt-3">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-xs flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                Tools registrados no servidor MCP
                <Badge variant="secondary" className="text-[10px]">{discovery?.toolCount ?? 0}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                O total exposto acima vem do discovery público do servidor (<code>{discovery?.name}@{discovery?.version}</code>).
                O catálogo detalhado (nomes, descrições e escopos por tool, bem como as tools visíveis para cada credencial)
                exige Bearer válido e é retornado pela tool <code>aceleriq_capabilities</code>. Use o botão
                <span className="mx-1 inline-flex items-center gap-1"><Zap className="w-3 h-3" /> Testar</span>
                em uma credencial para ver o total visível para aquela chave.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audit ── */}
        <TabsContent value="audit" className="mt-3">
          <Card>
            <CardHeader className="py-3 flex-row items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-primary" /> Auditoria MCP · últimas 200 chamadas
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={loadAudit} disabled={loadingAudit}>
                <RefreshCw className={`w-3.5 h-3.5 ${loadingAudit ? "animate-spin" : ""}`} />
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {audit.length === 0 ? (
                <p className="text-[11px] text-muted-foreground py-6 text-center">Nenhuma chamada registrada.</p>
              ) : (
                <div className="overflow-x-auto -mx-3 sm:mx-0">
                  <table className="w-full text-[10.5px] min-w-[640px]">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-1.5 px-2 font-medium">Quando</th>
                        <th className="py-1.5 px-2 font-medium">Tool</th>
                        <th className="py-1.5 px-2 font-medium">Chave</th>
                        <th className="py-1.5 px-2 font-medium">Status</th>
                        <th className="py-1.5 px-2 font-medium text-right">ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map(a => (
                        <tr key={a.id} className="border-b border-border/50 hover:bg-secondary/40">
                          <td className="py-1.5 px-2 whitespace-nowrap">{fmtDate(a.created_at)}</td>
                          <td className="py-1.5 px-2 font-mono">{a.tool_name}</td>
                          <td className="py-1.5 px-2 truncate max-w-[160px]">{a.key_id ? (keyById.get(a.key_id)?.name ?? a.key_id.slice(0, 8)) : "—"}</td>
                          <td className="py-1.5 px-2">
                            {a.success
                              ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-500 border-0">{a.status_code ?? 200}</Badge>
                              : <Badge variant="destructive" className="text-[10px]" title={a.error_message ?? ""}>{a.status_code ?? "err"} · {a.error_code ?? "fail"}</Badge>}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">{a.duration_ms ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Create dialog ─────────────────────────────────── */}
      <CreateCredentialDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreate={createCredential}
        preset={null}
      />

      {/* ── Rotate dialog ─────────────────────────────────── */}
      <CreateCredentialDialog
        open={!!rotateFor}
        onOpenChange={o => !o && setRotateFor(null)}
        onCreate={async (name, scopes, exp) => {
          const created = await createCredential(name, scopes, exp);
          if (created && rotateFor) await revokeCredential(rotateFor);
          setRotateFor(null);
          return created;
        }}
        preset={rotateFor ? { name: `${rotateFor.name} (rotacionada)`, scopes: rotateFor.scopes ?? [], expiresAt: rotateFor.expires_at } : null}
        rotate
      />

      {/* ── Issued token modal (shown only once) ──────────── */}
      <Dialog open={!!issuedToken} onOpenChange={o => { if (!o) { setIssuedToken(null); setTokenRevealed(false); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" /> Credencial criada
            </DialogTitle>
            <DialogDescription className="text-xs">
              <span className="font-semibold text-amber-500">Este token será mostrado apenas uma vez.</span> Copie e guarde em local seguro (gerenciador de senhas, cofre da equipe). Após fechar, não será possível recuperá-lo — apenas rotacionar ou revogar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome</Label>
              <p className="text-sm">{issuedName}</p>
            </div>
            <div>
              <Label className="text-xs">Token completo</Label>
              <div className="mt-1 p-2.5 bg-secondary rounded border border-border font-mono text-[11px] break-all">
                {tokenRevealed ? issuedToken : "•".repeat(48)}
              </div>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="outline" onClick={() => setTokenRevealed(v => !v)}>
                  {tokenRevealed ? <><EyeOff className="w-3.5 h-3.5 mr-1" /> Ocultar</> : <><Eye className="w-3.5 h-3.5 mr-1" /> Revelar</>}
                </Button>
                <Button size="sm" onClick={async () => {
                  if (!issuedToken) return;
                  try { await navigator.clipboard.writeText(issuedToken); toast.success("Copiado"); } catch { toast.error("Não foi possível copiar"); }
                }}>
                  <Copy className="w-3.5 h-3.5 mr-1" /> Copiar token
                </Button>
              </div>
            </div>
            <div className="p-2.5 rounded border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-500 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>Apenas o hash SHA-256 e um preview (12 chars) foram gravados. O token nunca aparece em logs, auditoria ou banco de dados.</span>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setIssuedToken(null); setTokenRevealed(false); }}>Concluí — guardei em local seguro</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke confirm ────────────────────────────────── */}
      <ConfirmModal
        open={!!revokeFor}
        title="Revogar credencial"
        description={`A credencial "${revokeFor?.name}" será desativada imediatamente. Chamadas futuras retornarão 401. A ação é irreversível — para restaurar, crie uma nova credencial.`}
        confirmLabel="Revogar"
        onConfirm={async () => { if (revokeFor) await revokeCredential(revokeFor); setRevokeFor(null); }}
        onCancel={() => setRevokeFor(null)}
      />

      {/* ── Test connection dialog ────────────────────────── */}
      <TestConnectionDialog open={!!testFor} onOpenChange={o => !o && setTestFor(null)} keyName={testFor?.name ?? ""} />
    </div>
  );
}

/* ─── Status card ─────────────────────────────────────────── */
function StatusCard({
  icon, title, loading, ok, error, children,
}: {
  icon: React.ReactNode; title: string; loading: boolean; ok: boolean; error: string | null; children?: React.ReactNode;
}) {
  return (
    <Card className="bg-card">
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-xs font-semibold">
            {icon} {title}
          </div>
          {loading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            : ok
              ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-500 border-0"><CheckCircle2 className="w-3 h-3 mr-1" /> Online</Badge>
              : <Badge variant="destructive" className="text-[10px]"><XCircle className="w-3 h-3 mr-1" /> Offline</Badge>}
        </div>
        {error && <p className="text-[11px] text-red-500 mb-2">{error}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

/* ─── Create / Rotate dialog ─────────────────────────────── */
function CreateCredentialDialog({
  open, onOpenChange, onCreate, preset, rotate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (name: string, scopes: string[], expiresAt: string | null) => Promise<any>;
  preset: { name: string; scopes: string[]; expiresAt: string | null } | null;
  rotate?: boolean;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["aceleriq:read"]);
  const [expiryPreset, setExpiryPreset] = useState<string>("90");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(preset?.name ?? "");
      setScopes(preset?.scopes?.length ? preset.scopes : ["aceleriq:read"]);
      setExpiryPreset("90");
      setSaving(false);
    }
  }, [open, preset]);

  const toggle = (id: string) =>
    setScopes(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const submit = async () => {
    if (!name.trim()) return toast.error("Nome é obrigatório");
    if (scopes.length === 0) return toast.error("Selecione ao menos um escopo");
    setSaving(true);
    const days = expiryPreset === "never" ? null : parseInt(expiryPreset, 10);
    const expiresAt = days ? new Date(Date.now() + days * 86400_000).toISOString() : null;
    const created = await onCreate(name, scopes, expiresAt);
    setSaving(false);
    if (created) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rotate ? "Rotacionar credencial" : "Nova credencial MCP"}</DialogTitle>
          <DialogDescription className="text-xs">
            {rotate
              ? "Cria uma nova credencial com os mesmos escopos e revoga a anterior automaticamente."
              : "Gere um token seguro para um agente externo. Somente o hash é gravado no banco."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Nome descritivo *</Label>
            <Input placeholder="Ex: ChatGPT Work · Almir" value={name} onChange={e => setName(e.target.value)} />
            <p className="text-[10px] text-muted-foreground mt-1">Use um nome que identifique o agente e o operador.</p>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Escopos concedidos *</Label>
            <div className="space-y-1.5">
              {SCOPES.map(s => (
                <label key={s.id} className="flex items-start gap-2 p-2 rounded border border-border hover:bg-secondary/40 cursor-pointer">
                  <Checkbox checked={scopes.includes(s.id)} onCheckedChange={() => toggle(s.id)} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <code className="text-[11px] font-semibold">{s.label}</code>
                      {s.danger && <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-500">sensível</Badge>}
                    </div>
                    <p className="text-[10.5px] text-muted-foreground">{s.hint}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Expiração *</Label>
            <Select value={expiryPreset} onValueChange={setExpiryPreset}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPIRY_PRESETS.map(p => (
                  <SelectItem key={String(p.days)} value={p.days === null ? "never" : String(p.days)}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">Recomendado: 90 dias. Você pode rotacionar a qualquer momento.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Gerando…</> : rotate ? "Rotacionar" : "Gerar token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Test connection dialog ─────────────────────────────── */
function TestConnectionDialog({ open, onOpenChange, keyName }: { open: boolean; onOpenChange: (o: boolean) => void; keyName: string }) {
  const [token, setToken] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; latencyMs?: number; toolCount?: number; error?: string; server?: string } | null>(null);

  useEffect(() => { if (open) { setToken(""); setResult(null); setRunning(false); } }, [open]);

  const run = async () => {
    if (!token.trim()) return toast.error("Cole o token gerado para essa credencial.");
    setRunning(true); setResult(null);
    const started = performance.now();
    try {
      const init = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token.trim()}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      if (!init.ok) throw new Error(`initialize HTTP ${init.status}`);
      const initBody = await init.json();
      if (initBody.error) throw new Error(initBody.error.message);
      const list = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token.trim()}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      const listBody = await list.json();
      if (listBody.error) throw new Error(listBody.error.message);
      setResult({
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        toolCount: (listBody.result?.tools ?? []).length,
        server: `${initBody.result?.serverInfo?.name}@${initBody.result?.serverInfo?.version}`,
      });
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Testar conexão</DialogTitle>
          <DialogDescription className="text-xs">
            Credencial: <span className="font-semibold text-foreground">{keyName}</span>.
            Cole o token completo (só você possui a cópia) para validar <code>initialize</code> + <code>tools/list</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Token</Label>
            <Input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="mcp_live_…" className="font-mono text-xs" />
            <p className="text-[10px] text-muted-foreground mt-1">O token não é gravado em nenhum lugar — usado apenas nesta chamada.</p>
          </div>
          {result && (
            <div className={`p-2.5 rounded border text-[11px] ${result.ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500" : "border-red-500/30 bg-red-500/5 text-red-500"}`}>
              {result.ok
                ? <div className="space-y-0.5"><div className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Conexão OK</div><div>Servidor: <code>{result.server}</code></div><div>Tools visíveis: {result.toolCount}</div><div>Latência: {result.latencyMs} ms</div></div>
                : <div className="flex items-start gap-1.5"><XCircle className="w-3.5 h-3.5 mt-0.5" /> <span>{result.error}</span></div>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={run} disabled={running || !token.trim()}>
            {running ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Testando…</> : "Testar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
