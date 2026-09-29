import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Circle, Loader2, Pause, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { custoDaResposta, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { BotaoComCusto } from "./Custo";
import { ImagemDaMesa } from "./MesaContexto";
import type { Trabalho } from "./useItensDoMes";
import { desfazerVersaoDaLamina, passoDoPlano } from "./diretorDoEstudioApi";
import { planoDoAnexo, type PassoDoPlano, type PlanoDoDiretor as Plano } from "../../../supabase/functions/estudio-arte/diretor-agentico";

/**
 * O plano do diretor (frente RO, fase 2, 29/09). Pedido do dono: "o agente
 * diretor do Estúdio tem que ser agêntico e completo". O que custa (ajustar o
 * texto na arte, refazer, variações) ou sai para o mundo (entregar, agendar)
 * vira uma lista de passos:
 * - custo antes, um clique para confirmar; só o ajuste de texto de custo
 *   pequeno numa ordem clara roda sozinho;
 * - andamento de cada passo (a fazer, fazendo, feito, falhou com o motivo,
 *   parado) e Parar sempre à vista enquanto roda;
 * - a prova no fim: a miniatura de antes e a de depois de cada lâmina, com o
 *   Desfazer (volta para a versão anterior; a nova fica guardada).
 * Cada passo usa o caminho de sempre da tela (quem hospeda passa `executar`).
 */

export type ExecutorDoPasso = (passo: PassoDoPlano) => Promise<unknown>;

/** Planos que já começaram nesta aba (remontar o cartão não roda de novo). */
const jaRodando = new Set<string>();

const ICONE: Record<PassoDoPlano["estado"], ReactNode> = {
  pendente: <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />,
  executando: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />,
  feito: <Check className="h-3.5 w-3.5 text-success" aria-hidden />,
  falhou: <TriangleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden />,
  parado: <Pause className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />,
};
const NOME_DO_ESTADO: Record<PassoDoPlano["estado"], string> = { pendente: "a fazer", executando: "fazendo", feito: "feito", falhou: "falhou", parado: "parado" };

const maiorVersao = (t: Trabalho, ordem: number) => (t.cards || []).filter((v) => v.ordem === ordem).reduce((m, v) => Math.max(m, v.versao), 0);

export default function PlanoDoDiretor({
  plano,
  mensagemId,
  trabalho,
  executar,
  partes,
  bloqueado = false,
  onAtualizar,
}: {
  plano: Plano;
  mensagemId: string;
  trabalho: Trabalho;
  executar: ExecutorDoPasso;
  /** Custo dos passos que faltam (a estimativa do botão). */
  partes: (passos: PassoDoPlano[]) => ParteDaEstimativa[];
  bloqueado?: boolean;
  onAtualizar: () => void;
}) {
  const [atual, setAtual] = useState<Plano>(plano);
  const [rodando, setRodando] = useState(false);
  const [parando, setParando] = useState(false);
  const parar = useRef(false);
  const assinatura = JSON.stringify(plano.passos.map((p) => [p.id, p.estado])) + (plano.confirmado_em || "") + (plano.descartado_em || "");
  useEffect(() => {
    if (!rodando) setAtual(plano);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  const gravar = async (patch: Record<string, unknown>) => {
    try {
      const r = await passoDoPlano(mensagemId, atual.id, patch);
      const novo = r && r.plano ? planoDoAnexo(r.plano) : null;
      if (novo) setAtual(novo);
      return novo;
    } catch (e) {
      // O passo aconteceu; só o registro na conversa falhou (a tela segue com o estado local).
      toast.warning("O andamento do plano não foi gravado", { description: textoDoErro(e) });
      return null;
    }
  };
  const local = (id: string, patch: Partial<PassoDoPlano>) => setAtual((p) => ({ ...p, passos: p.passos.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  const rodar = async () => {
    if (jaRodando.has(atual.id) && rodando) return { custo_usd: 0 };
    jaRodando.add(atual.id);
    parar.current = false;
    setRodando(true);
    let custo = 0;
    try {
      await gravar({ plano: "confirmar" });
      for (const p of atual.passos) {
        if (p.estado !== "pendente") continue;
        if (parar.current) {
          await gravar({ plano: "parar" });
          break;
        }
        const antes = p.ordem ? maiorVersao(trabalho, p.ordem) : null;
        local(p.id, { estado: "executando", versao_antes: antes });
        await gravar({ passo_id: p.id, estado: "executando", ...(antes !== null ? { versao_antes: antes } : {}) });
        try {
          const r = await executar(p);
          const c = custoDaResposta(r) || 0;
          custo += c;
          local(p.id, { estado: "feito", custo_usd: c });
          await gravar({ passo_id: p.id, estado: "feito", custo_usd: c });
        } catch (e) {
          const motivo = textoDoErro(e, "O passo não pôde ser feito.");
          local(p.id, { estado: "falhou", motivo });
          await gravar({ passo_id: p.id, estado: "falhou", motivo });
          // Um passo que falhou para o plano: os seguintes dependem dele (entregar depois de refazer...).
          await gravar({ plano: "parar" });
          break;
        }
      }
      onAtualizar();
      return { custo_usd: custo };
    } finally {
      setRodando(false);
      setParando(false);
    }
  };

  // Custo pequeno numa ordem clara (o ajuste de texto): roda sozinho, uma vez.
  useEffect(() => {
    if (atual.automatico && !atual.confirmado_em && !atual.descartado_em && !bloqueado && !jaRodando.has(atual.id)) void rodar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const desfazer = async (p: PassoDoPlano, versao: number) => {
    if (!p.ordem) return;
    try {
      await desfazerVersaoDaLamina(trabalho.id, p.ordem, versao);
      toast.success(`Lâmina ${p.ordem} voltou para a versão anterior`, { description: `A v${versao} fica guardada.` });
      onAtualizar();
    } catch (e) {
      toast.error("Não foi possível desfazer", { description: textoDoErro(e), duration: 9000 });
    }
  };

  const pendentes = atual.passos.filter((p) => p.estado === "pendente");
  const aberto = !atual.confirmado_em && !atual.descartado_em;
  const versoes = trabalho.cards || [];

  return (
    <div className="mr-4 min-w-0" data-plano-do-diretor={atual.id} data-estado={atual.descartado_em ? "cancelado" : atual.terminado_em ? "terminado" : rodando ? "rodando" : aberto ? "aberto" : "parado"}>
      <p className="flex items-center text-[12px] font-medium">
        {aberto ? "Com custo, espera o seu clique" : atual.terminado_em ? "Feito" : rodando ? "Fazendo" : atual.descartado_em ? "Cancelado" : "Plano"}
        <AjudaRecolhida className="ml-1.5" rotulo="Como o diretor executa">
          O que não custa o diretor já fez, com Desfazer. O que custa (ajustar o texto na arte, refazer, variações) e o que sai para o mundo (entregar, agendar) espera o clique, com o custo antes. Depois, cada lâmina mostra a de antes e a de depois, com Desfazer.
        </AjudaRecolhida>
      </p>
      <ol className="mt-1 space-y-1.5">
        {atual.passos.map((p) => {
          const depois = p.ordem && typeof p.versao_antes === "number" ? versoes.filter((v) => v.ordem === p.ordem && v.versao > (p.versao_antes as number)).sort((a, b) => a.versao - b.versao) : [];
          const antes = p.ordem && typeof p.versao_antes === "number" ? versoes.find((v) => v.ordem === p.ordem && v.versao === p.versao_antes) || null : null;
          const ultima = depois.length ? depois[depois.length - 1] : null;
          const eAtual = !!ultima && !!p.ordem && ultima.versao === maiorVersao(trabalho, p.ordem);
          return (
            <li key={p.id} className="min-w-0" data-passo={p.operacao} data-estado={p.estado}>
              <div className="flex min-w-0 items-center text-[12px]">
                <span className="mr-1.5 shrink-0">{ICONE[p.estado]}</span>
                <span className="min-w-0 flex-1 truncate">{p.rotulo}</span>
                <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{NOME_DO_ESTADO[p.estado]}</span>
              </div>
              {p.estado === "falhou" && p.motivo && <p className="ml-5 text-[11px] leading-snug text-destructive [overflow-wrap:anywhere]">{p.motivo}</p>}
              {p.estado === "feito" && (antes || ultima) && (
                <div className="ml-5 mt-1 flex min-w-0 items-center" data-prova={p.ordem}>
                  {antes && (
                    <span className="mr-1.5 block h-12 w-10 shrink-0 overflow-hidden rounded border border-border" title={`Antes (v${antes.versao})`}>
                      <ImagemDaMesa caminho={antes.storage_path} alt={`Antes, v${antes.versao}`} className="h-full w-full" />
                    </span>
                  )}
                  {antes && ultima && <span className="mr-1.5 text-[11px] text-muted-foreground" aria-hidden>→</span>}
                  {ultima && (
                    <span className="mr-2 block h-12 w-10 shrink-0 overflow-hidden rounded border border-primary/50" title={`Depois (v${ultima.versao})`}>
                      <ImagemDaMesa caminho={ultima.storage_path} alt={`Depois, v${ultima.versao}`} className="h-full w-full" />
                    </span>
                  )}
                  {ultima && eAtual && antes && !bloqueado && (
                    <button type="button" onClick={() => void desfazer(p, ultima.versao)} className="inline-flex h-7 items-center text-[11px] text-muted-foreground hover:text-foreground" data-desfazer-versao={ultima.versao}>
                      <Undo2 className="mr-1 h-3 w-3" /> Desfazer
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex min-w-0 flex-wrap items-center">
        {/* Aberto, ou interrompido no meio (a tela fechou antes do fim): o que falta continua com o mesmo clique. */}
        {(aberto || (!atual.terminado_em && !atual.parado_em && !atual.descartado_em)) && pendentes.length > 0 && !rodando && (
          <>
            <span className="mb-1 mr-1.5">
              <BotaoComCusto
                rotulo={!aberto ? "Continuar" : pendentes.length === 1 ? "Confirmar e fazer" : `Confirmar e fazer os ${pendentes.length} passos`}
                titulo="Plano do diretor"
                descricao="Faz os passos na ordem, pelo caminho de sempre do Estúdio, e mostra o antes e depois de cada lâmina."
                partes={() => partes(pendentes)}
                executar={rodar}
                disabled={bloqueado}
                className="h-8"
              />
            </span>
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 px-2 text-[12px]" onClick={() => void gravar({ plano: "descartar" })} disabled={bloqueado}>
              Cancelar
            </Button>
          </>
        )}
        {rodando && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mb-1 h-8 px-2.5 text-[12px]"
            onClick={() => {
              parar.current = true;
              setParando(true);
            }}
            disabled={parando}
            data-parar-plano=""
          >
            {parando ? "Parando depois deste passo" : "Parar"}
          </Button>
        )}
        {!aberto && !rodando && typeof atual.custo_usd === "number" && atual.custo_usd > 0 && (
          <span className="mb-1 text-[11px] text-muted-foreground">Custo do plano: US$ {atual.custo_usd.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
}
