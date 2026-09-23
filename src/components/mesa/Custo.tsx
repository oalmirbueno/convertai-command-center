import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  custoDaResposta,
  ErroDaMesa,
  estimarCusto,
  estimarLocal,
  mensagemDoCodigo,
  textoDoErro,
  usd,
  type ParteDaEstimativa,
} from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";

/**
 * Regra da Mesa: toda ação que gasta mostra o preço estimado ANTES e o custo
 * real DEPOIS. Este arquivo é o único caminho para isso na tela:
 * - BotaoComCusto: preço estimado ao lado do rótulo, executa no clique (acima
 *   de US$ 1 ou sem estimativa, no segundo clique); ao terminar, avisa o custo real.
 * - EstimativaInline: preço estimado ao lado de um botão rápido (conversa).
 * - AvisoDeErro: a frase do erro com o próximo passo (recarregar, cota, chave).
 */

export function useEstimativa(partes: ParteDaEstimativa[] | null, ativo = true) {
  const { catalogo } = useMesa();
  const chave = JSON.stringify(partes || []);
  // Com o catálogo carregado a conta é local e instantânea (mesma fórmula do motor).
  const local = partes && partes.length && catalogo.length ? estimarLocal(partes, catalogo) : null;
  const remota = useQuery({
    queryKey: ["mesa", "estimativa", chave],
    enabled: ativo && !!partes && partes.length > 0 && local === null,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => estimarCusto(partes || []),
  });
  if (local !== null) {
    return { ...remota, data: local, isLoading: false, isFetching: false, isError: false, error: null } as typeof remota;
  }
  return remota;
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
  const mesa = useMesa();
  const versao = mesa.versaoCarteira || 0;
  // Guarda a versão da carteira de quando este erro apareceu: depois de uma
  // recarga, o aviso de saldo insuficiente que ficou na tela some sozinho.
  const visto = useRef<{ erro: unknown; versao: number } | null>(null);
  if (!visto.current || visto.current.erro !== erro) visto.current = { erro, versao };
  if (!erro) return null;
  if (erro instanceof ErroDaMesa && erro.codigo === "saldo_insuficiente" && versao > visto.current.versao) return null;
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
  /** Partes da estimativa; o preço aparece ao lado do botão antes de gastar. */
  partes: () => ParteDaEstimativa[];
  /** A ação que gasta. Roda no clique (acima de US$ 1, no segundo clique). */
  executar: () => Promise<any>;
  aoConcluir?: (data: any, custoReal: number | null) => void;
  /** Ação longa com progresso próprio: não avisa o custo ao terminar (quem chamou avisa). */
  fecharAoConfirmar?: boolean;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm";
  className?: string;
  rotuloConfirmar?: string;
}

/** Acima deste valor o botão pede um segundo clique antes de gastar. */
const LIMITE_SEM_CONFIRMAR_USD = 1;

/**
 * Botão de ação que gasta, sem janela: o preço estimado fica ao lado do rótulo
 * (conta local com o catálogo, instantânea), o clique executa na hora e o
 * andamento aparece no próprio botão, sem travar o resto da tela. Saldo que
 * não cobre a estimativa não executa: avisa e oferece a recarga. Ação acima de
 * US$ 1 pede um segundo clique ("confirmar").
 */
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
}: BotaoComCustoProps) {
  const mesa = useMesa();
  const avisarErro = useAvisarErro();
  const [rodando, setRodando] = useState(false);
  const [armado, setArmado] = useState(false);
  let partesAtuais: ParteDaEstimativa[] | null = null;
  try {
    partesAtuais = partes();
  } catch {
    partesAtuais = null;
  }
  const estimativa = useEstimativa(partesAtuais, !disabled);
  const valor = estimativa.data;

  const clicar = async () => {
    if (rodando) return;
    if (valor !== undefined && mesa.saldoUsd !== null && mesa.saldoUsd < valor) {
      avisarErro(erroDeSaldo(valor - mesa.saldoUsd, mesa.saldoUsd), titulo);
      return;
    }
    // Caro, ou sem estimativa (não dá para saber quanto vai gastar): segundo clique.
    if ((valor === undefined || valor > LIMITE_SEM_CONFIRMAR_USD) && !armado) {
      setArmado(true);
      window.setTimeout(() => setArmado(false), 6000);
      return;
    }
    setArmado(false);
    setRodando(true);
    try {
      const data = await executar();
      const custo = custoDaResposta(data);
      mesa.atualizarCusto();
      if (!fecharAoConfirmar) {
        toast.success(titulo, {
          description: custo === null ? "Custo registrado na carteira do cliente." : `Custo real: ${usd(custo)}.`,
        });
      }
      aoConcluir?.(data, custo);
    } catch (e) {
      avisarErro(e, titulo);
    } finally {
      setRodando(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled || rodando}
      onClick={() => void clicar()}
      className={className}
      title={descricao || titulo}
    >
      {rodando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      {armado ? (valor === undefined ? "Sem estimativa: clique de novo" : "Clique de novo para confirmar") : rotulo}
      {!rodando && valor !== undefined && (
        <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-px text-[10.5px] font-normal opacity-80 dark:bg-white/10">
          ~{usd(valor)}
        </span>
      )}
    </Button>
  );
}
