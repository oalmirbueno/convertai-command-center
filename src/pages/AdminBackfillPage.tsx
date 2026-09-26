import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Send, CheckCircle2, XCircle } from "lucide-react";
import {
  CabecalhoDePagina,
  CampoDeFormulario,
  EstadoDeErro,
  GrupoDeCampos,
  Painel,
  RegiaoRolavel,
  Secao,
  botao,
  campo,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";

const PORTAL_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
if (!PORTAL_SUPABASE_URL) {
  throw new Error("VITE_SUPABASE_URL is required for Ops backfill");
}
const BACKFILL_URL = `${PORTAL_SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/backfill-to-ops`;

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

  const numeros = result
    ? [
        { rotulo: "Total", valor: result.total ?? 0, cor: "text-foreground", icone: null },
        { rotulo: "Sucesso", valor: result.success ?? 0, cor: "text-primary", icone: <CheckCircle2 className="mr-1 h-3 w-3 text-primary" aria-hidden="true" /> },
        { rotulo: "Falhas", valor: result.failed ?? 0, cor: "text-destructive", icone: <XCircle className="mr-1 h-3 w-3 text-destructive" aria-hidden="true" /> },
      ]
    : [];

  return (
    <div className="min-w-0 space-y-6">
      <CabecalhoDePagina
        titulo="Backfill de leads para o Ops"
        ajuda={
          <>
            Envia os diagnósticos antigos do quiz para o Aceleriq Ops. Só vão as submissões com status <code>submitted</code>. Duplicatas são tratadas no destino.
          </>
        }
      />

      <div className="max-w-3xl space-y-6">
        <Painel
          titulo="Executar sincronização"
          rodape={
            <button type="button" className={botao.primario} onClick={runBackfill} disabled={running || !secret.trim()}>
              {running ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Executando backfill...
                </>
              ) : (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Executar backfill
                </>
              )}
            </button>
          }
        >
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="Secret" apoio="Cabeçalho x-webhook-secret do Ops.">
              <input
                id="secret"
                type="password"
                placeholder="x-webhook-secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !running && secret.trim()) runBackfill();
                }}
                autoComplete="off"
                disabled={running}
                className={juntar(campo, "font-mono")}
              />
            </CampoDeFormulario>
          </GrupoDeCampos>
        </Painel>

        {errorMsg && (
          <EstadoDeErro
            titulo="O backfill não foi concluído."
            descricao={errorMsg}
            acao={
              secret.trim() ? (
                <button type="button" className={botao.secundario} onClick={runBackfill} disabled={running}>
                  Tentar de novo
                </button>
              ) : undefined
            }
          />
        )}

        {result && !errorMsg && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {numeros.map((n) => (
                <div key={n.rotulo} className={juntar(superficie.painel, "min-w-0 px-3 py-3 sm:px-4")}>
                  <p className={juntar(texto.rotulo, "flex items-center truncate")}>
                    {n.icone}
                    {n.rotulo}
                  </p>
                  <p className={juntar("mt-1 text-[22px] font-semibold leading-7 tabular-nums", n.cor)}>{n.valor}</p>
                </div>
              ))}
            </div>

            {result.errors && result.errors.length > 0 && (
              <Secao titulo="Erros" descricao={`${result.errors.length} ${result.errors.length === 1 ? "registro" : "registros"}`} divisoria>
                <RegiaoRolavel rotulo="Erros do backfill" memoria="backfill:erros" className="lg:max-h-[50vh]">
                  <ul className="divide-y divide-border">
                    {result.errors.map((e, i) => (
                      <li key={i} className="min-w-0 py-2.5">
                        <p className={juntar(texto.auxiliar, "truncate font-mono")}>{e.token}</p>
                        <p className="mt-0.5 font-mono text-[12.5px] leading-5 text-destructive [overflow-wrap:anywhere]">{e.error}</p>
                      </li>
                    ))}
                  </ul>
                </RegiaoRolavel>
              </Secao>
            )}

            <Secao titulo="Resposta" descricao="JSON devolvido pela função" divisoria>
              <pre className={juntar(superficie.poco, "overflow-x-auto p-3 font-mono text-[12px] leading-5")}>{JSON.stringify(result, null, 2)}</pre>
            </Secao>
          </>
        )}
      </div>
    </div>
  );
}
