import { Copy, ExternalLink, Key, Lock, ShieldCheck } from "lucide-react";
import CascaPublica from "@/components/publico/CascaPublica";
import { toast } from "sonner";
import { MCP_OAUTH_METADATA_URL, MCP_SERVER_URL } from "@/lib/mcp/endpoints";
import { Secao, botao, etiqueta, juntar, superficie, texto } from "@/components/sistema";

const MCP_URL = MCP_SERVER_URL;
const PRM_URL = MCP_OAUTH_METADATA_URL;

const agents = [
  {
    name: "ChatGPT Work",
    auth: "OAuth",
    text: "Use a URL MCP e escolha OAuth. O ChatGPT abre a tela de login e autorização do Aceleriq.",
  },
  {
    name: "Claude Code",
    auth: "OAuth ou Bearer",
    text: "Prefira OAuth para acesso por usuário. Use Bearer só em automações técnicas controladas.",
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

/**
 * Guia público para conectar agentes ao MCP. Minimalista: a marca, os dois
 * endereços que importam, os agentes numa lista e os passos do ChatGPT Work.
 * Sem caixas empilhadas. Usa a mesma casca das outras páginas públicas; a
 * frase de apoio mora no "?" ao lado do título.
 */
export default function MCPConnect() {
  return (
    <CascaPublica
      largura="larga"
      centralizar={false}
      titulo="Conectar agentes ao Aceleriq OS"
      ajuda="Um endereço para ChatGPT Work, Codex, Claude Code, Hermes, OpenClaw e outros clientes MCP autorizados."
      acimaDoTitulo={
        <p className="mb-1.5 inline-flex items-center text-[12px] font-medium text-primary">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          MCP oficial
        </p>
      }
    >
      <div className="min-w-0 space-y-8">

        <Secao titulo="Endereços" divisoria>
          <ul className="divide-y divide-border">
            <li className="min-w-0 py-3 first:pt-0">
              <div className="flex min-w-0 items-center">
                <ShieldCheck className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-medium")}>URL MCP</span>
                <a href={MCP_URL} target="_blank" rel="noreferrer" className={juntar(botao.icone, "mr-1")} aria-label="Abrir status do servidor" title="Abrir status">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
                <button type="button" onClick={() => copy(MCP_URL)} className={botao.primario}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar URL
                </button>
              </div>
              <code className={juntar(superficie.poco, "mt-2 block px-3 py-2 font-mono text-[12px] leading-5 [overflow-wrap:anywhere]")}>{MCP_URL}</code>
            </li>
            <li className="min-w-0 py-3">
              <div className="flex min-w-0 items-center">
                <Lock className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-medium")}>Descoberta OAuth</span>
                <button type="button" onClick={() => copy(PRM_URL)} className={botao.secundario}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar PRM
                </button>
              </div>
              <code className={juntar(superficie.poco, "mt-2 block px-3 py-2 font-mono text-[12px] leading-5 [overflow-wrap:anywhere]")}>{PRM_URL}</code>
            </li>
          </ul>
        </Secao>

        <Secao titulo="Agentes" divisoria>
          <ul className="divide-y divide-border">
            {agents.map((agent) => (
              <li key={agent.name} className="min-w-0 py-3 first:pt-0">
                <div className="flex min-w-0 items-center">
                  <h2 className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate font-semibold")}>{agent.name}</h2>
                  <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>
                    <Key className="mr-1 h-3 w-3" aria-hidden="true" /> {agent.auth}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{agent.text}</p>
              </li>
            ))}
          </ul>
        </Secao>

        <Secao titulo="ChatGPT Work" divisoria>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-5 text-muted-foreground marker:text-primary">
            <li>Criar um Custom Connector MCP.</li>
            <li>Colar a URL MCP acima.</li>
            <li>Selecionar OAuth.</li>
            <li>Entrar no Aceleriq e autorizar a conexão quando a tela aparecer.</li>
          </ol>
        </Secao>
      </div>
    </CascaPublica>
  );
}
