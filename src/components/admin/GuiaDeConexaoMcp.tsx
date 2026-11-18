import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { SeletorCompacto, botao, juntar, superficie, texto } from "@/components/sistema";

/**
 * Como ligar qualquer IA no MCP central do Aceleriq (18/11/2026, pedido do dono: "conexão de agentes não
 * está conectando em nenhum; deixe com essas opções, STDIO e Streamable HTTP, um central que qualquer IA
 * consiga ler, executar e fazer completo").
 *
 * O erro que travava ("Headers.append: 'Painel Aceleriq' is an invalid header name") vinha de pôr o nome
 * do painel no campo do NOME do cabeçalho. Aqui o nome é sempre `Authorization` e o valor `Bearer <chave>`,
 * em linhas separadas e com a configuração pronta para colar.
 */

export type Transporte = "http" | "stdio";

export function configDoMcp(url: string, chave: string, transporte: Transporte, nome = "aceleriq"): string {
  const valor = `Bearer ${chave}`;
  const servidor = transporte === "http"
    ? { type: "http", url, headers: { Authorization: valor } }
    : { command: "npx", args: ["-y", "mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"], env: { AUTH_HEADER: valor } };
  return JSON.stringify({ mcpServers: { [nome]: servidor } }, null, 2);
}

async function copiar(conteudo: string, aviso: string) {
  try {
    await navigator.clipboard.writeText(conteudo);
    toast.success(aviso);
  } catch {
    toast.error("Não foi possível copiar");
  }
}

function Linha({ rotulo, valor, mostrar, aviso }: { rotulo: string; valor: string; mostrar?: string; aviso: string }) {
  return (
    <li className="flex min-w-0 items-center py-2">
      <span className={juntar(texto.rotulo, "mr-3 w-36 shrink-0")}>{rotulo}</span>
      <code className="mr-2 min-w-0 flex-1 font-mono text-[12px] leading-5 [overflow-wrap:anywhere]">{mostrar ?? valor}</code>
      <button type="button" className={botao.icone} onClick={() => void copiar(valor, aviso)} aria-label={`Copiar ${rotulo}`} title={`Copiar ${rotulo}`}>
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

export default function GuiaDeConexaoMcp({ url, chave, esconderChave = false }: { url: string; chave?: string | null; esconderChave?: boolean }) {
  const [transporte, setTransporte] = useState<Transporte>("http");
  const temChave = !!chave;
  const chaveReal = chave || "SUA_CHAVE_mcp_live";
  const chaveVista = temChave && esconderChave ? `${chaveReal.slice(0, 12)}${"•".repeat(16)}` : chaveReal;
  const json = configDoMcp(url, chaveReal, transporte);
  const jsonVisto = configDoMcp(url, chaveVista, transporte);

  return (
    <div className="min-w-0 space-y-3" data-guia-de-conexao-mcp="">
      <SeletorCompacto
        rotulo="Tipo de conexão"
        modo="segmentado"
        opcoes={[{ valor: "http", rotulo: "Streamable HTTP" }, { valor: "stdio", rotulo: "STDIO" }]}
        valor={transporte}
        onEscolher={(v) => setTransporte(v === "stdio" ? "stdio" : "http")}
      />
      <ul className="divide-y divide-border border-y border-border">
        {transporte === "http" ? (
          <>
            <Linha rotulo="URL do servidor" valor={url} aviso="URL copiada" />
            <Linha rotulo="Nome do cabeçalho" valor="Authorization" aviso="Nome do cabeçalho copiado" />
            <Linha rotulo="Valor do cabeçalho" valor={`Bearer ${chaveReal}`} mostrar={`Bearer ${chaveVista}`} aviso="Valor copiado" />
          </>
        ) : (
          <>
            <Linha rotulo="Comando" valor="npx" aviso="Comando copiado" />
            <Linha rotulo="Argumentos" valor={`-y mcp-remote ${url} --header Authorization:\${AUTH_HEADER}`} aviso="Argumentos copiados" />
            <Linha rotulo="Variável AUTH_HEADER" valor={`Bearer ${chaveReal}`} mostrar={`Bearer ${chaveVista}`} aviso="Valor copiado" />
          </>
        )}
      </ul>
      <p className="text-[12px] leading-5 text-muted-foreground">
        {transporte === "http"
          ? "O nome do cabeçalho é sempre Authorization (nunca o nome do painel). O valor começa com Bearer e um espaço."
          : "STDIO roda no computador: precisa do Node instalado. O mcp-remote faz a ponte com o servidor do Aceleriq."}
        {!temChave && " Troque SUA_CHAVE_mcp_live pela chave gerada em Gerar acesso completo."}
      </p>
      <div className="min-w-0">
        <div className="mb-1.5 flex min-w-0 items-center">
          <p className={juntar(texto.rotulo, "min-w-0 flex-1")}>Configuração pronta (JSON)</p>
          <button type="button" className={botao.discreto} onClick={() => void copiar(json, "Configuração copiada")} data-copiar-json="">
            <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar JSON
          </button>
        </div>
        <pre className={juntar(superficie.poco, "max-h-56 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[12px] leading-5")}>{jsonVisto}</pre>
      </div>
    </div>
  );
}
