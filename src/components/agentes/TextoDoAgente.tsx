import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { pedacosComLinks, type DestinoDoAgente } from "@/lib/agentes/mapaDoPainel";
import { clienteDaRota } from "@/lib/lancador";
import { conversa, juntar } from "@/components/sistema/estilos";
import TextoFormatado from "@/components/agentes/respostas/TextoFormatado";
import BlocosDeResposta from "@/components/agentes/respostas/BlocosDeResposta";
import { separarResposta } from "../../../supabase/functions/_shared/resposta-em-partes";

/** O cliente do endereço atual (?client= ou /clientes/<id>), sem depender do roteador. */
function clienteDoEndereco(): string | null {
  if (typeof window === "undefined" || !window.location) return null;
  return clienteDaRota(window.location.pathname, window.location.search);
}

/**
 * Texto do agente (núcleo comum de apresentação, 09/10/2026): o MESMO jeito de
 * mostrar do Gestor em todos os agentes que usam este componente (Contexto,
 * Mês, Ads, Foto, Estúdio, Roteiros, Marca, Site, Motion, Proposta,
 * Contratos, Instagram, Perfis, Estilo, CFO, lançador...):
 * - markdown seguro (listas, tabelas, títulos; sem HTML cru);
 * - texto longo em partes (sem bloco gigante, sem "Claro! Aqui está...");
 * - quadros validados (fluxo, tabela, gráfico, métricas, progresso, entrega)
 *   quando o agente manda o trecho marcado (_shared/resposta-em-partes.ts);
 *   número sem fonte verificável não vira quadro;
 * - as rotas do mapa do painel viram atalho (com o cliente da tela), como antes.
 * Tamanho da conversa (14 px) em todo agente; `className` ainda vence.
 */
export default function TextoDoAgente({ texto, clientId, className = "" }: { texto: string; clientId?: string | null; className?: string }) {
  const cliente = clientId !== undefined ? clientId : clienteDoEndereco();
  const r = useMemo(() => {
    // Rota do mapa vira link markdown; o resto do texto fica como veio.
    const md = pedacosComLinks(texto, cliente).map((p) => (p.tipo === "link" ? `[${p.nome}](${p.link})` : p.texto)).join("");
    // Os agentes quebram linha simples para separar itens: vira quebra visível (o markdown juntaria as linhas).
    return separarResposta(md.replace(/([^\n])\n(?!\n)/g, "$1  \n"));
  }, [texto, cliente]);
  return (
    <div className={juntar("min-w-0 space-y-2 [overflow-wrap:anywhere]", conversa.mensagem, className)} data-texto-do-agente="">
      {r.partes.map((p, i) => p.tipo === "texto"
        ? <TextoFormatado key={`t-${i}`} texto={p.texto} className={className} />
        : <BlocosDeResposta key={`b-${i}`} blocos={p.blocos} />)}
      {r.recusados.length > 0 && <p className="text-[11px] text-muted-foreground" title={r.recusados.join(" · ")}>{r.recusados.length === 1 ? "1 quadro ficou de fora" : `${r.recusados.length} quadros ficaram de fora`} (sem fonte verificável)</p>}
    </div>
  );
}

/** Botão curto "Abrir <área>" para o destino que o agente devolveu. */
export function BotaoDaArea({ destino, onAbrir, className = "" }: { destino: DestinoDoAgente; onAbrir: (link: string) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onAbrir(destino.link)}
      data-abrir-area={destino.area}
      className={`inline-flex max-w-full items-center rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10 ${className}`}
    >
      <span className="truncate">Abrir {destino.nome}</span>
      <ArrowUpRight className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </button>
  );
}
