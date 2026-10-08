import { useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Globe, Info, LayoutGrid, RefreshCw } from "lucide-react";
import { botao, campo, juntar } from "@/components/sistema";
import { ROLAGEM_OPERACAO } from "@/components/execucao/CarteiraDaOperacao";
import { atalhosDaCentral, caminhoEmbutido, enderecoExterno, type ContextoDoAtalho } from "@/lib/centralAtalhos";

/**
 * Mesas, ferramentas e navegador dentro da Central (08/10/2026).
 *
 * - Mesas e ferramentas: a rota de sempre do painel (mesma origem, mesma
 *   sessão), aberta num iframe com ?embutido=1, que esconde a casca. O cliente
 *   e o projeto da conversa vão na rota (?client=, ?project=). Nada duplicado:
 *   é a própria tela.
 * - Navegador: páginas externas que permitem ser embutidas abrem aqui; as que
 *   bloqueiam (X-Frame-Options/CSP) não são contornadas: o botão abre em aba
 *   nova. Sem cookies nem senhas copiados: o iframe usa só a sessão que o
 *   próprio site já tem neste navegador, se tiver.
 */

function Quadro({ src, titulo, externo }: { src: string; titulo: string; externo?: boolean }) {
  return (
    <iframe
      key={src}
      src={src}
      title={titulo}
      className="h-full min-h-[420px] w-full flex-1 rounded-xl border border-border bg-background"
      // Externo: isolado (sem acesso ao painel). Interno: a própria tela do painel.
      {...(externo ? { sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox", referrerPolicy: "no-referrer" as const } : {})}
    />
  );
}

export function PainelDasMesas({ contexto, aberto, aoAbrir }: { contexto: ContextoDoAtalho & { clienteNome?: string | null }; aberto: { rotulo: string; caminho: string } | null; aoAbrir: (a: { rotulo: string; caminho: string } | null) => void }) {
  const [versao, setVersao] = useState(0);
  const atalhos = atalhosDaCentral(contexto);
  if (aberto) {
    const src = caminhoEmbutido(aberto.caminho);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => aoAbrir(null)} className={juntar(botao.icone, "h-7 w-7")} aria-label="Voltar às Mesas"><ArrowLeft className="h-3.5 w-3.5" /></button>
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{aberto.rotulo}{contexto.clienteNome ? ` · ${contexto.clienteNome}` : ""}</p>
          <button type="button" onClick={() => setVersao((v) => v + 1)} className={juntar(botao.icone, "h-7 w-7")} aria-label="Recarregar"><RefreshCw className="h-3.5 w-3.5" /></button>
          <a href={aberto.caminho} target="_blank" rel="noreferrer" className={juntar(botao.icone, "h-7 w-7")} aria-label="Abrir em aba nova" title="Abrir em aba nova"><ExternalLink className="h-3.5 w-3.5" /></a>
        </div>
        {src ? <Quadro key={`${src}-${versao}`} src={src} titulo={aberto.rotulo} /> : <p className="text-[12px] text-destructive">Caminho inválido.</p>}
      </div>
    );
  }
  return (
    <div className={juntar(ROLAGEM_OPERACAO, "min-h-0 flex-1")}>
      {!contexto.clientId && <p className="mb-2 px-1 text-[11px] text-muted-foreground">Sem cliente nesta conversa: as Mesas abrem sem cliente escolhido. Abra uma conversa de cliente para ir direto ao contexto dele.</p>}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {atalhos.map((a) => (
          <button key={a.id} type="button" onClick={() => aoAbrir({ rotulo: a.rotulo, caminho: a.caminho })} className="rounded-xl border border-border bg-background px-3 py-2.5 text-left hover:border-primary/40 hover:bg-muted/40">
            <span className="flex items-center gap-1.5 text-[13px] font-medium"><LayoutGrid className="h-3.5 w-3.5 text-primary" />{a.rotulo}</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{a.descricao}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NavegadorIntegrado() {
  const [entrada, setEntrada] = useState("");
  const [atual, setAtual] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const campoRef = useRef<HTMLInputElement>(null);
  const abrir = () => { const u = enderecoExterno(entrada); if (u) { setAtual(u); setEntrada(u); } };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <form className="flex shrink-0 items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); abrir(); }}>
        <label className="relative block flex-1">
          <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input ref={campoRef} value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="Endereço (ex.: instagram.com/cliente)" aria-label="Endereço da página" className={juntar(campo, "h-8 pl-8 text-[12px]")} inputMode="url" />
        </label>
        <button type="submit" className={juntar(botao.secundario, "h-8 px-3 text-[12px]")}>Abrir</button>
        {atual && <a href={atual} target="_blank" rel="noreferrer noopener" className={juntar(botao.icone, "h-8 w-8")} aria-label="Abrir em aba nova" title="Abrir em aba nova"><ExternalLink className="h-3.5 w-3.5" /></a>}
        <button type="button" onClick={() => setInfo((v) => !v)} className={juntar(botao.icone, "h-8 w-8")} aria-label="Como funciona" aria-expanded={info}><Info className="h-3.5 w-3.5" /></button>
      </form>
      {info && (
        <div className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          Abre aqui o que o próprio site permite embutir. Instagram, Meta, Google e bancos bloqueiam isso por segurança: aí use “Abrir em aba nova”. O painel não copia cookies, senhas nem tokens. Um navegador remoto isolado (para sites que bloqueiam) precisa de infraestrutura à parte e custo próprio; fica para quando você decidir.
        </div>
      )}
      {atual ? <Quadro src={atual} titulo="Navegador integrado" externo /> : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">Digite um endereço para abrir aqui ao lado da conversa.</div>
      )}
      {atual && <p className="shrink-0 px-1 text-[11px] text-muted-foreground">Ficou em branco ou recusou? O site não permite ser embutido: use o botão de aba nova.</p>}
    </div>
  );
}
