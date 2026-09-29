import { Check, Clapperboard, Coins } from "lucide-react";
import { juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { tempoFino } from "@/lib/editor/tempo";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";

/**
 * Mensagens padrão da conversa do agente editor (frente EDT, F3): o jeito do
 * pacote de edição com o visual do painel. "Amostra pronta pra conferir" e o
 * custo moram aqui; o "O que mudei" é o próprio cartão da ação (a lista e a
 * prova), para não repetir a lista duas vezes.
 * Sem caixa dentro de caixa: tudo mora dentro do balão do agente, separado por
 * espaço; explicação só no title (o "?" do painel).
 */

export const TIPO_DO_PADRAO = "padrao_do_editor";

export type MensagemPadraoDoEditor =
  | { tipo: typeof TIPO_DO_PADRAO; forma: "amostra"; url: string | null; inicio_s: number; fim_s: number; estilos: { nome: string; ligado: boolean }[] }
  | { tipo: typeof TIPO_DO_PADRAO; forma: "custo"; pedido_usd: number; conversa_usd: number; gerar_usd?: number | null };

/** Os 5 estilos que a amostra mostra ligados ou não (lido do projeto, não do que o agente disse). */
export function estilosLigados(p: ProjetoDeEdicao, corDaMarca: string | null): { nome: string; ligado: boolean }[] {
  const clipes = (tipo: string, f?: (e: Record<string, unknown>) => boolean) =>
    p.trilhas.filter((t) => t.tipo === tipo && !t.oculta).reduce((n, t) => n + t.clipes.filter((c) => !f || f((c.estilo || {}) as Record<string, unknown>)).length, 0);
  return [
    { nome: "Legenda", ligado: clipes("legenda") > 0 },
    { nome: "Animações", ligado: clipes("sobreposicao", (e) => typeof e.peca === "string" && e.peca !== "logo") > 0 },
    { nome: "Logo", ligado: clipes("sobreposicao", (e) => e.peca === "logo") > 0 || clipes("sobreposicao", (e) => e.peca === "cartao_final") > 0 },
    { nome: "Cor de destaque", ligado: !!corDaMarca },
    { nome: "Trilha e efeitos", ligado: clipes("audio", (e) => e.papel === "trilha" || e.papel === "efeito") > 0 },
  ];
}

export function lerMensagensPadrao(anexos: unknown[]): MensagemPadraoDoEditor[] {
  return (anexos || []).filter((a) => a && typeof a === "object" && (a as { tipo?: unknown }).tipo === TIPO_DO_PADRAO) as MensagemPadraoDoEditor[];
}

export default function MensagemPadrao({ m }: { m: MensagemPadraoDoEditor }) {
  if (m.forma === "amostra") {
    const ligados = m.estilos.filter((e) => e.ligado).length;
    return (
      <div className="min-w-0 space-y-1.5 pt-1" data-padrao-do-editor="amostra">
        <p className="flex items-center font-medium">
          <Clapperboard className="mr-1.5 h-4 w-4 text-primary" />
          Amostra pronta pra conferir
        </p>
        <p className={texto.auxiliar}>
          {tempoFino(m.inicio_s)} a {tempoFino(m.fim_s)}
        </p>
        {m.url ? <video src={m.url} controls playsInline preload="metadata" className="max-h-[320px] w-full rounded-md bg-black" /> : <p className={texto.auxiliar}>O link venceu: abra de novo pela barra do editor.</p>}
        <p className={juntar(texto.auxiliar, "pt-0.5")} title="Lido do projeto: o que está na linha do tempo agora.">
          Estilos ligados {ligados}/{m.estilos.length}
        </p>
        <div className="flex flex-wrap">
          {m.estilos.map((e) => (
            <span key={e.nome} className={juntar("mb-1 mr-1 rounded-full px-2 py-0.5 text-[11px]", e.ligado ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground")}>
              {e.ligado && <Check className="-mt-0.5 mr-0.5 inline h-3 w-3" />}
              {e.nome}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <p className={juntar(texto.auxiliar, "flex items-center pt-1")} data-padrao-do-editor="custo" title="O custo do pedido é o que o modelo gastou agora; a conversa soma os pedidos desta tela.">
      <Coins className="mr-1 h-3.5 w-3.5" />
      Custo deste pedido {usd(m.pedido_usd)} · conversa {usd(m.conversa_usd)}
      {typeof m.gerar_usd === "number" ? ` · geração a confirmar ${usd(m.gerar_usd)}` : ""}
    </p>
  );
}
