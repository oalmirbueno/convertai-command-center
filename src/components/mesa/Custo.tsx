import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  custoDaResposta,
  ErroDaMesa,
  estimarCusto,
  mensagemDoCodigo,
  textoDoErro,
  usd,
  type ParteDaEstimativa,
} from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";

/**
 * Regra da Mesa: toda ação que gasta mostra o preço estimado ANTES e o custo
 * real DEPOIS. Este arquivo é o único caminho para isso na tela:
 * - BotaoComCusto: abre a confirmação com a estimativa e o saldo; só depois
 *   de confirmar executa; ao terminar, avisa o custo real da resposta.
 * - EstimativaInline: preço estimado ao lado de um botão rápido (conversa).
 * - AvisoDeErro: a frase do erro com o próximo passo (recarregar, cota, chave).
 */

export function useEstimativa(partes: ParteDaEstimativa[] | null, ativo = true) {
  const chave = JSON.stringify(partes || []);
  return useQuery({
    queryKey: ["mesa", "estimativa", chave],
    enabled: ativo && !!partes && partes.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => estimarCusto(partes || []),
  });
}

function erroDeSaldo(falta: number, saldo: number | null) {
  const detalhes = { falta_usd: falta, saldo_usd: saldo };
  return new ErroDaMesa("saldo_insuficiente", mensagemDoCodigo("saldo_insuficiente", detalhes), detalhes);
}

/** Botão do próximo passo quando a IA recusa. */
export function AcaoDoErro({ erro, onDepois }: { erro: unknown; onDepois?: () => void }) {
  const mesa = useMesa();
  if (!(erro instanceof ErroDaMesa) || !erro.acao) return null;
  const { acao } = erro;
  if (acao === "recarregar" && !mesa.podeRecarregar) {
    return <p className="text-[11.5px] text-muted-foreground">Peça a um admin ou gestor para recarregar a carteira deste cliente.</p>;
  }
  if ((acao === "cota" || acao === "chave" || acao === "modelo") && !mesa.isAdmin) {
    return <p className="text-[11.5px] text-muted-foreground">Peça a um admin para resolver em {acao === "modelo" ? "Modelos de IA" : "Chaves e cotas"}.</p>;
  }
  const abrir = () => {
    if (acao === "recarregar") mesa.abrirRecarga();
    else if (acao === "modelo") mesa.abrirModelos();
    else mesa.abrirChaves();
    onDepois?.();
  };
  return (
    <Button type="button" size="sm" variant="outline" onClick={abrir} className="h-8 text-[12px]">
      {erro.rotuloAcao}
    </Button>
  );
}

export function AvisoDeErro({ erro, className = "" }: { erro: unknown; className?: string }) {
  if (!erro) return null;
  return (
    <div className={`flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 ${className}`}>
      <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{textoDoErro(erro)}</span>
      </p>
      <AcaoDoErro erro={erro} />
    </div>
  );
}

/** Aviso de erro em toast, com o botão do próximo passo quando houver. */
export function useAvisarErro() {
  const mesa = useMesa();
  return (erro: unknown, titulo?: string) => {
    const texto = textoDoErro(erro);
    let action: { label: string; onClick: () => void } | undefined;
    if (erro instanceof ErroDaMesa && erro.acao) {
      if (erro.acao === "recarregar" && mesa.podeRecarregar) action = { label: erro.rotuloAcao || "Recarregar", onClick: mesa.abrirRecarga };
      if ((erro.acao === "cota" || erro.acao === "chave") && mesa.isAdmin) action = { label: erro.rotuloAcao || "Chaves e cotas", onClick: mesa.abrirChaves };
      if (erro.acao === "modelo" && mesa.isAdmin) action = { label: erro.rotuloAcao || "Modelos", onClick: mesa.abrirModelos };
    }
    toast.error(titulo || "Não foi possível concluir", { description: texto, action, duration: 9000 });
  };
}

/** Preço estimado em linha, para botões de uso rápido (mensagem na conversa). */
export function EstimativaInline({ partes, prefixo = "~" }: { partes: ParteDaEstimativa[] | null; prefixo?: string }) {
  const { data, isLoading, isError } = useEstimativa(partes);
  if (!partes || partes.length === 0) return null;
  if (isLoading) return <span className="text-[11px] text-muted-foreground">estimando…</span>;
  if (isError) return <span className="text-[11px] text-muted-foreground">sem estimativa</span>;
  return <span className="text-[11px] text-muted-foreground">{prefixo}{usd(data)} por envio</span>;
}

/** Avisa o custo real que veio na resposta e atualiza a barra de custo. */
export function avisarCustoReal(rotulo: string, data: any, atualizar: () => void) {
  const custo = custoDaResposta(data);
  atualizar();
  toast.success(rotulo, {
    description: custo === null ? "Custo registrado na carteira do cliente." : `Custo real: ${usd(custo)}.`,
  });
  return custo;
}

interface BotaoComCustoProps {
  rotulo: ReactNode;
  titulo: string;
  descricao?: string;
  /** Partes da estimativa; a confirmação mostra a soma antes de gastar. */
  partes: () => ParteDaEstimativa[];
  /** A ação que gasta. Só roda depois da confirmação. */
  executar: () => Promise<any>;
  aoConcluir?: (data: any, custoReal: number | null) => void;
  /** Fecha a confirmação ao confirmar (ação longa com progresso próprio). */
  fecharAoConfirmar?: boolean;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm";
  className?: string;
  rotuloConfirmar?: string;
}

export function BotaoComCusto({
  rotulo,
  titulo,
  descricao,
  partes,
  executar,
  aoConcluir,
  fecharAoConfirmar = false,
  disabled,
  variant = "default",
  size = "sm",
  className = "",
  rotuloConfirmar = "Confirmar e gastar",
}: BotaoComCustoProps) {
  const mesa = useMesa();
  const avisarErro = useAvisarErro();
  const [aberto, setAberto] = useState(false);
  const [partesAtuais, setPartesAtuais] = useState<ParteDaEstimativa[] | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const estimativa = useEstimativa(partesAtuais, aberto);

  const abrir = () => {
    setErro(null);
    try {
      setPartesAtuais(partes());
    } catch (e) {
      setPartesAtuais(null);
      setErro(e);
    }
    setAberto(true);
  };

  const confirmar = async () => {
    setErro(null);
    if (fecharAoConfirmar) setAberto(false);
    setRodando(true);
    try {
      const data = await executar();
      const custo = custoDaResposta(data);
      mesa.atualizarCusto();
      if (!fecharAoConfirmar) {
        toast.success(titulo, {
          description: custo === null ? "Custo registrado na carteira do cliente." : `Custo real: ${usd(custo)}.`,
        });
        setAberto(false);
      }
      aoConcluir?.(data, custo);
    } catch (e) {
      if (fecharAoConfirmar) avisarErro(e, titulo);
      else setErro(e);
    } finally {
      setRodando(false);
    }
  };

  const faltaSaldo =
    estimativa.data !== undefined && mesa.saldoUsd !== null && mesa.saldoUsd < estimativa.data;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || rodando}
        onClick={abrir}
        className={className}
      >
        {rodando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        {rotulo}
      </Button>
      <Dialog open={aberto} onOpenChange={(v) => { if (!rodando) setAberto(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription className="text-[12.5px] leading-relaxed">{descricao || "Confira o custo estimado antes de gastar."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-secondary/30 p-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Custo estimado</p>
                <p className="mt-0.5 text-[18px] font-semibold text-foreground">
                  {estimativa.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : estimativa.data !== undefined ? usd(estimativa.data) : "sem estimativa"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Saldo do cliente</p>
                <p className={`mt-0.5 flex items-center gap-1.5 text-[18px] font-semibold ${faltaSaldo ? "text-destructive" : "text-foreground"}`}>
                  <Wallet className="h-4 w-4 opacity-60" />
                  {mesa.saldoUsd === null ? "?" : usd(mesa.saldoUsd)}
                </p>
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              A estimativa usa a tabela de preços do catálogo e um tamanho típico desta ação. O custo real aparece quando terminar.
            </p>
            {faltaSaldo && (
              <AvisoDeErro erro={erroDeSaldo((estimativa.data || 0) - (mesa.saldoUsd || 0), mesa.saldoUsd)} />
            )}
            {estimativa.isError && <AvisoDeErro erro={estimativa.error} />}
            {erro && <AvisoDeErro erro={erro} />}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={rodando}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void confirmar()}
              disabled={rodando || partesAtuais === null || estimativa.isLoading || (partesAtuais.length > 0 && estimativa.data === undefined)}
            >
              {rodando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {rotuloConfirmar}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
