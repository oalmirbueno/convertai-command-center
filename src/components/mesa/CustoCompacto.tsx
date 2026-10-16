import { Plus, KeyRound, Settings2, Sparkles, Wallet, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ConsumoDoMes } from "@/components/mesa/BarraDeCusto";
import { usd, type PrevisaoDoPlano } from "@/lib/mesa/api";

/**
 * Saldo e gasto do mês no topo das mesas (Mesa, Mesa Ads, Mesa Foto).
 *
 * Mora aqui, fora da página da Mesa, desde 25/09 (frente U): a Mesa Ads e a
 * Mesa Foto importavam da página da Mesa e baixavam junto a fila de
 * prioridades e o painel de custos que elas não mostram.
 */

const TAREFAS: Record<string, string> = {
  calendario: "Calendário",
  estudio: "Estúdio",
  conversa: "Conversa",
  leitura_referencia: "Leitura de referência",
  verificacao: "Conferência",
};

/** Modelos que não moram no catálogo de IA (o Jev é cobrado à parte). */
const ROTULOS_FORA_DO_CATALOGO: Record<string, string> = {
  "typesafe:jev-latest": "Jev (notas e conferências)",
};

export const botaoPequeno =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Saldo e gasto do mês numa linha curta. Tocar abre o detalhe (por modelo,
 * por tarefa, previsão pelo plano); recarregar e os atalhos de admin ficam
 * em botões pequenos ao lado.
 */
export function CustoCompacto({
  saldoUsd,
  consumo,
  previsao,
  carregando,
  podeRecarregar,
  isAdmin,
  onRecarregar,
  onChaves,
  onModelos,
}: {
  saldoUsd: number | null;
  consumo: ConsumoDoMes | null;
  previsao: PrevisaoDoPlano | null;
  carregando: boolean;
  podeRecarregar: boolean;
  isAdmin: boolean;
  onRecarregar: () => void;
  onChaves: () => void;
  onModelos: () => void;
}) {
  const negativo = saldoUsd !== null && saldoUsd < 0;
  const baixo = saldoUsd !== null && !!previsao && previsao.custo_por_post_usd > 0 && saldoUsd < previsao.custo_por_post_usd;
  const alerta = negativo || baixo;
  return (
    <div className="flex min-w-0 shrink-0 items-center">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Saldo e gasto do mês"
            className="inline-flex h-8 min-w-0 items-center rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {/* 16/10/2026 (dono: "cara de aplicativo" no celular): abaixo de 640 px o saldo vira só o ícone da
                carteira (com o ponto vermelho do alerta); o valor e o gasto aparecem ao tocar. */}
            <Wallet className={`h-4 w-4 shrink-0 sm:mr-1.5 sm:h-3.5 sm:w-3.5 ${alerta ? "text-destructive" : ""}`} />
            <strong className={`hidden font-semibold tabular-nums sm:inline ${negativo ? "text-destructive" : "text-foreground"}`}>
              {carregando && saldoUsd === null ? <Loader2 className="inline h-3 w-3 animate-spin" /> : saldoUsd === null ? "?" : usd(saldoUsd)}
            </strong>
            {alerta && <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive sm:ml-1.5" aria-label={negativo ? "saldo negativo" : "saldo baixo"} />}
            <span className="ml-2 hidden whitespace-nowrap sm:inline">
              mês <span className="font-medium tabular-nums text-foreground">{usd((consumo && consumo.total_usd) || 0)}</span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-[calc(100vw-24px)] max-w-[340px] p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted px-2.5 py-2">
              <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Saldo</p>
              <p className={`text-[15px] font-semibold tabular-nums ${negativo ? "text-destructive" : "text-foreground"}`}>{saldoUsd === null ? "?" : usd(saldoUsd)}</p>
            </div>
            <div className="rounded-lg bg-muted px-2.5 py-2">
              <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Gasto do mês</p>
              <p className="text-[15px] font-semibold tabular-nums text-foreground">{usd((consumo && consumo.total_usd) || 0)}</p>
            </div>
          </div>
          {alerta && (
            <p className="mt-2 rounded-lg bg-warning/15 px-2.5 py-1.5 text-[11.5px] text-foreground">
              {negativo ? "Saldo negativo." : "Saldo baixo: não cobre um post pelo custo médio."}
              {podeRecarregar ? " Recarregue para seguir gerando." : ""}
            </p>
          )}
          {previsao && (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {previsao.posts_por_mes ? `Plano ${previsao.posts_por_mes} posts` : "Por post"}:{" "}
              <strong className="font-semibold text-foreground">
                ≈ {usd(previsao.previsao_mes_usd != null ? previsao.previsao_mes_usd : previsao.custo_por_post_usd)}
              </strong>
              {previsao.posts_que_o_saldo_cobre != null ? ` · o saldo cobre ${previsao.posts_que_o_saldo_cobre}` : ""}
            </p>
          )}
          <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Por modelo</p>
          <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
            {((consumo && consumo.por_modelo) || []).length === 0 && <li className="text-[12px] text-muted-foreground">Nada gasto neste mês.</li>}
            {((consumo && consumo.por_modelo) || []).map((m) => (
              <li key={m.modelo_id} className="flex items-baseline justify-between text-[12px]">
                <span className="mr-3 min-w-0 truncate">
                  {m.rotulo || ROTULOS_FORA_DO_CATALOGO[m.modelo_id] || m.modelo_id} <span className="text-muted-foreground">· {m.usos}x</span>
                </span>
                <span className="shrink-0 font-medium">{usd(m.custo_usd)}</span>
              </li>
            ))}
          </ul>
          {((consumo && consumo.por_tarefa) || []).length > 0 && (
            <>
              <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Por tarefa</p>
              <ul className="mt-1.5 space-y-1">
                {((consumo && consumo.por_tarefa) || []).map((t) => (
                  <li key={t.tarefa} className="flex items-baseline justify-between text-[12px]">
                    <span className="mr-3 min-w-0 truncate">
                      {TAREFAS[t.tarefa] || t.tarefa} <span className="text-muted-foreground">· {t.usos}x</span>
                    </span>
                    <span className="shrink-0 font-medium">{usd(t.custo_usd)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!!(consumo && consumo.recargas_usd) && <p className="mt-3 text-[11.5px] text-muted-foreground">Recargas no mês: {usd(consumo!.recargas_usd)}</p>}
          {/* No celular os atalhos ao lado do saldo saem do topo e moram aqui (16/10/2026). */}
          {(podeRecarregar || isAdmin) && (
            <div className="mt-3 flex flex-wrap border-t border-border pt-2 sm:hidden [&>*]:mr-1.5 [&>*]:mt-1" data-atalhos-do-saldo="">
              {podeRecarregar && (
                <button type="button" onClick={onRecarregar} className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[12.5px] font-medium text-primary-foreground">
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Recarregar
                </button>
              )}
              {isAdmin && (
                <button type="button" onClick={onModelos} className="inline-flex h-9 items-center rounded-lg bg-muted px-3 text-[12.5px]">
                  <Sparkles className="mr-1.5 h-4 w-4 text-muted-foreground" aria-hidden="true" /> Modelos de IA
                </button>
              )}
              {isAdmin && (
                <button type="button" onClick={onChaves} className="inline-flex h-9 items-center rounded-lg bg-muted px-3 text-[12.5px]">
                  <KeyRound className="mr-1.5 h-4 w-4 text-muted-foreground" aria-hidden="true" /> Chaves e cotas
                </button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {podeRecarregar && (
        <button type="button" onClick={onRecarregar} className={`${botaoPequeno} hidden sm:inline-flex`} aria-label="Recarregar carteira" title="Recarregar carteira">
          {/* 16/10/2026 (dono: "saldo: só o ícone"): o nome fica no title e no leitor de tela. */}
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {isAdmin && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={`${botaoPequeno} hidden sm:inline-flex`} aria-label="Modelos de IA e chaves" title="Modelos de IA e chaves">
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} className="w-52 p-1">
            <button type="button" onClick={onModelos} className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted">
              <Sparkles className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Modelos de IA
            </button>
            <button type="button" onClick={onChaves} className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted">
              <KeyRound className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Chaves e cotas
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
