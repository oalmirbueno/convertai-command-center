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

/**
 * O prompt pronto para colar na IA quando a conexão complica (18/11/2026, pedido do dono): ela mesma
 * configura, testa e diz o que falta, com os mesmos sinais que o servidor devolve.
 */
export function promptDeConexao(url: string, chave: string): string {
  const comeco = `${chave.slice(0, 12)}…`;
  return [
    "Conecte-se ao servidor MCP central da Aceleriq e confirme que está funcionando.",
    "",
    `Servidor (Streamable HTTP): ${url}`,
    `Autenticação: cabeçalho HTTP de nome Authorization e valor Bearer ${chave}`,
    "(a palavra Bearer, um espaço e a chave inteira, sem aspas e sem espaço no fim).",
    "Se o seu cliente não deixar escolher o nome do cabeçalho, mande a chave em X-API-Key.",
    `Se você só roda comando local (STDIO): npx -y mcp-remote ${url} --header Authorization:\${AUTH_HEADER} com a variável AUTH_HEADER="Bearer ${chave}".`,
    "",
    "Depois de conectar, nesta ordem:",
    "1. Liste as ferramentas (tools/list): devem aparecer perto de 200, todas começando com aceleriq_.",
    "2. Chame aceleriq_health: em key tem que aparecer o nome da chave e as permissões. Se aparecer public:discovery, a chave não chegou: refaça o cabeçalho.",
    "3. Chame aceleriq_capabilities para ver o que você pode executar e aceleriq_guia para o mapa do painel.",
    "",
    `Se vier "chave ... não reconhecida", a chave em uso não é esta: o começo certo é ${comeco}. Troque pela chave acima, inteira.`,
    "Se vier \"Origin is not allowed\", faça a chamada do servidor, não de dentro de um navegador.",
    "Nunca escreva a chave em mensagens, logs, arquivos ou memória.",
    "Quando terminar, me diga o nome da chave que o aceleriq_health mostrou e quantas ferramentas apareceram.",
  ].join("\n");
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
        {!temChave && " Troque SUA_CHAVE_mcp_live pela chave de Gerar chave."}
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
      <div className="flex min-w-0 flex-wrap items-center border-t border-border pt-3">
        <p className={juntar(texto.auxiliar, "mr-3 min-w-0 flex-1")}>Deu complicação? Cole o prompt pronto na IA: ela configura, testa e diz o que falta.</p>
        <button type="button" className={botao.secundario} onClick={() => void copiar(promptDeConexao(url, chaveReal), "Prompt copiado")} data-copiar-prompt="">
          <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Copiar prompt para a IA
        </button>
      </div>
    </div>
  );
}
