import { useState } from "react";
import { KeyRound, Loader2, Plus, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { textoDoErro, usd, type PrevisaoDoPlano } from "@/lib/mesa/api";

export interface ConsumoDoMes {
  saldo_usd?: number;
  total_usd?: number;
  usos?: number;
  recargas_usd?: number;
  por_modelo?: { modelo_id: string; rotulo?: string | null; usos: number; custo_usd: number }[];
  por_tarefa?: { tarefa: string; usos: number; custo_usd: number }[];
}

const TAREFAS: Record<string, string> = {
  calendario: "Calendário",
  estudio: "Estúdio",
  conversa: "Conversa",
  leitura_referencia: "Leitura de referência",
  verificacao: "Conferência",
};

/** Modelos que não moram no catálogo de IA (o Jev é cobrado à parte, por token de entrada). */
const ROTULOS_FORA_DO_CATALOGO: Record<string, string> = {
  "typesafe:jev-latest": "Jev (notas e conferências)",
};

/**
 * Barra de custo fixa da Mesa: saldo da carteira do cliente, gasto do mês
 * (por modelo e por tarefa ao tocar), recarga (admin e gestor) e os atalhos
 * de admin para chaves e modelos.
 */
export default function BarraDeCusto({
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
  previsao?: PrevisaoDoPlano | null;
  carregando: boolean;
  podeRecarregar: boolean;
  isAdmin: boolean;
  onRecarregar: () => void;
  onChaves: () => void;
  onModelos: () => void;
}) {
  const negativo = saldoUsd !== null && saldoUsd < 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" />
        Saldo
        <strong className={`text-[13px] font-semibold ${negativo ? "text-destructive" : "text-foreground"}`}>
          {carregando && saldoUsd === null ? <Loader2 className="inline h-3 w-3 animate-spin" /> : saldoUsd === null ? "?" : usd(saldoUsd)}
        </strong>
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
            Gasto do mês
            <strong className="text-[13px] font-semibold text-foreground">{usd(consumo?.total_usd || 0)}</strong>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(92vw,340px)] p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Por modelo</p>
          <ul className="mt-1.5 space-y-1">
            {(consumo?.por_modelo || []).length === 0 && <li className="text-[12px] text-muted-foreground">Nada gasto neste mês.</li>}
            {(consumo?.por_modelo || []).map((m) => (
              <li key={m.modelo_id} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="min-w-0 truncate">{m.rotulo || ROTULOS_FORA_DO_CATALOGO[m.modelo_id] || m.modelo_id} <span className="text-muted-foreground">· {m.usos}x</span></span>
                <span className="shrink-0 font-medium">{usd(m.custo_usd)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">Por tarefa</p>
          <ul className="mt-1.5 space-y-1">
            {(consumo?.por_tarefa || []).map((t) => (
              <li key={t.tarefa} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="min-w-0 truncate">{TAREFAS[t.tarefa] || t.tarefa} <span className="text-muted-foreground">· {t.usos}x</span></span>
                <span className="shrink-0 font-medium">{usd(t.custo_usd)}</span>
              </li>
            ))}
          </ul>
          {!!consumo?.recargas_usd && (
            <p className="mt-3 text-[11.5px] text-muted-foreground">Recargas no mês: {usd(consumo.recargas_usd)}</p>
          )}
        </PopoverContent>
      </Popover>
      {previsao && (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground" title="Previsão pelo plano do cliente">
          {previsao.posts_por_mes ? `Plano ${previsao.posts_por_mes} posts` : "Por post"}
          <strong className="text-[13px] font-semibold text-foreground">
            {previsao.previsao_mes_usd != null ? `≈ ${usd(previsao.previsao_mes_usd)}` : `≈ ${usd(previsao.custo_por_post_usd)}`}
          </strong>
          {previsao.posts_que_o_saldo_cobre != null && (
            <span className="hidden sm:inline">· saldo cobre {previsao.posts_que_o_saldo_cobre}</span>
          )}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {podeRecarregar && (
          <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={onRecarregar}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Recarregar
          </Button>
        )}
        {isAdmin && (
          <>
            <button type="button" onClick={onModelos} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Modelos de IA
            </button>
            <button type="button" onClick={onChaves} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <KeyRound className="h-3.5 w-3.5" /> Chaves e cotas
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Recarga da carteira: só admin e gestor (a RPC confere de novo no banco). */
export function DialogoDeRecarga({
  aberto,
  onOpenChange,
  clientId,
  clientName,
  onRecarregado,
  sugestaoUsd,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName: string;
  onRecarregado: () => void;
  /** Quanto falta para cobrir o plano do mês (previsão menos saldo). */
  sugestaoUsd?: number | null;
}) {
  const [valor, setValor] = useState("");
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    const n = Number(String(valor).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    setSalvando(true);
    try {
      const { data, error } = await (supabase as any).rpc("ia_carteira_recarregar", {
        _client_id: clientId,
        _valor_usd: n,
        _observacao: nota.trim() || null,
      });
      if (error) throw error;
      toast.success("Carteira recarregada", { description: `Novo saldo: ${usd(Number(data))}.` });
      setValor("");
      setNota("");
      onRecarregado();
      onOpenChange(false);
    } catch (e) {
      toast.error("Recarga não registrada", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!salvando) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Recarregar carteira de IA</DialogTitle>
          <DialogDescription>Crédito só para {clientName}. Cada geração deste cliente desconta daqui.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mesa-recarga-valor">Valor (US$)</Label>
            <Input id="mesa-recarga-valor" inputMode="decimal" placeholder="20,00" value={valor} onChange={(e) => setValor(e.target.value)} />
            {!!sugestaoUsd && sugestaoUsd > 0 && (
              <button
                type="button"
                className="text-[11.5px] text-primary underline-offset-2 hover:underline"
                onClick={() => setValor(sugestaoUsd.toFixed(2).replace(".", ","))}
              >
                Sugestão para cobrir o plano do mês: {usd(sugestaoUsd)}
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mesa-recarga-nota">Observação</Label>
            <Input id="mesa-recarga-nota" placeholder="Ex.: pacote de setembro pago pelo cliente" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={() => void salvar()} disabled={salvando}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Recarregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
