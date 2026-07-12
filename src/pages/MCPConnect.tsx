import { Copy, ExternalLink, Key, Lock, Network, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import aceleriqLogo from "@/assets/logo-aceleriq.png";
import { toast } from "sonner";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const MCP_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/mcp-server`;
const PRM_URL = `https://${PROJECT_ID}.supabase.co/functions/v1/mcp-oauth-metadata`;

const agents = [
  {
    name: "ChatGPT Work",
    auth: "OAuth",
    text: "Use a URL MCP e escolha OAuth. O ChatGPT deve abrir a tela de login e autorização do Aceleriq.",
  },
  {
    name: "Claude Code",
    auth: "OAuth ou Bearer",
    text: "Prefira OAuth para acesso por usuário. Use Bearer somente em automações técnicas controladas.",
  },
  {
    name: "Codex",
    auth: "Bearer",
    text: "Use o plugin oficial do Aceleriq e uma credencial mcp_live_* emitida na central administrativa.",
  },
  {
    name: "Hermes e OpenClaw",
    auth: "Bearer",
    text: "Use Streamable HTTP com Authorization Bearer e Accept application/json, text/event-stream.",
  },
];

function copy(value: string) {
  navigator.clipboard.writeText(value).then(() => toast.success("Copiado"), () => toast.error("Não foi possível copiar"));
}

export default function MCPConnect() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-4">
            <img src={aceleriqLogo} alt="Aceleriq" className="h-24 w-auto" />
            <div>
              <Badge variant="outline" className="mb-3 gap-1.5 border-primary/30 text-primary">
                <Network className="h-3.5 w-3.5" /> MCP oficial
              </Badge>
              <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">Conectar agentes ao Aceleriq OS</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Endpoint universal para ChatGPT Work, Codex, Claude Code, Hermes, OpenClaw e outros clientes MCP autorizados.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="gap-2">
            <a href={MCP_URL} target="_blank" rel="noreferrer">
              Abrir status <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" /> URL MCP</div>
              <div className="rounded-md border bg-secondary/40 p-3 font-mono text-xs break-all">{MCP_URL}</div>
              <Button size="sm" onClick={() => copy(MCP_URL)} className="gap-2"><Copy className="h-3.5 w-3.5" /> Copiar URL</Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-primary" /> Descoberta OAuth</div>
              <div className="rounded-md border bg-secondary/40 p-3 font-mono text-xs break-all">{PRM_URL}</div>
              <Button size="sm" variant="outline" onClick={() => copy(PRM_URL)} className="gap-2"><Copy className="h-3.5 w-3.5" /> Copiar PRM</Button>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          {agents.map(agent => (
            <Card key={agent.name}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{agent.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.text}</p>
                  </div>
                  <Badge variant="secondary" className="whitespace-nowrap"><Key className="mr-1 h-3 w-3" /> {agent.auth}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="rounded-lg border bg-card p-5 text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">Configuração recomendada para ChatGPT Work</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Criar um Custom Connector MCP.</li>
            <li>Colar a URL MCP acima.</li>
            <li>Selecionar OAuth.</li>
            <li>Entrar no Aceleriq e autorizar a conexão quando a tela aparecer.</li>
          </ol>
        </section>
      </div>
    </main>
  );
}