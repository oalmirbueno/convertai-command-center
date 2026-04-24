import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Send, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

const BACKFILL_URL = "https://gicbrgagstyvbaaumprj.supabase.co/functions/v1/backfill-to-ops";

interface BackfillResult {
  total?: number;
  success?: number;
  failed?: number;
  errors?: Array<{ token: string; error: string }>;
  error?: string;
}

export default function AdminBackfillPage() {
  const { profile, loading } = useAuth();
  const [secret, setSecret] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (loading) return null;
  if (profile?.role !== "admin") return <Navigate to="/dashboard" replace />;

  const runBackfill = async () => {
    if (!secret.trim()) {
      setErrorMsg("Informe o secret antes de executar.");
      return;
    }
    setRunning(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const res = await fetch(BACKFILL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": secret,
        },
      });
      const json = (await res.json()) as BackfillResult;
      if (!res.ok) {
        setErrorMsg(json.error || `HTTP ${res.status}`);
      }
      setResult(json);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha de rede");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="container max-w-3xl py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Backfill de Leads pro Ops</h1>
        <p className="text-muted-foreground mt-2">
          Envia todos os quiz submissions antigos pro Aceleriq Ops.
        </p>
      </div>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle>Executar sincronização</CardTitle>
          <CardDescription>
            Apenas submissions com status <code className="text-primary">submitted</code> serão empurradas. Duplicatas são tratadas no destino.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="secret">Secret</Label>
            <Input
              id="secret"
              type="password"
              placeholder="x-webhook-secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              disabled={running}
              className="font-mono"
            />
          </div>

          <Button
            size="lg"
            className="w-full h-14 text-base font-semibold"
            onClick={runBackfill}
            disabled={running || !secret.trim()}
          >
            {running ? (
              <>
                <Loader2 className="animate-spin" /> Executando backfill...
              </>
            ) : (
              <>
                <Send /> Executar Backfill
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {errorMsg && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {result && !errorMsg && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Total</p>
                <p className="text-3xl font-mono font-bold mt-1">{result.total ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-primary/40">
              <CardContent className="pt-6">
                <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-primary" /> Sucesso
                </p>
                <p className="text-3xl font-mono font-bold mt-1 text-primary">{result.success ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="border-destructive/40">
              <CardContent className="pt-6">
                <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-destructive" /> Falhas
                </p>
                <p className="text-3xl font-mono font-bold mt-1 text-destructive">{result.failed ?? 0}</p>
              </CardContent>
            </Card>
          </div>

          {result.errors && result.errors.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-base">Erros ({result.errors.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm font-mono">
                  {result.errors.map((e, i) => (
                    <li key={i} className="border-l-2 border-destructive pl-3">
                      <div className="text-muted-foreground text-xs">{e.token}</div>
                      <div className="text-destructive">{e.error}</div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resposta (JSON)</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/50 rounded-md p-4 text-xs overflow-x-auto font-mono">
                {JSON.stringify(result, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
