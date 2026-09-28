import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { BotaoComCusto, useAvisarErro } from "../Custo";
import { useMesa } from "../MesaContexto";
import type { DestaqueSugerido } from "../../../../supabase/functions/_shared/conhecimento-perfil-instagram";
import { modeloDaAba } from "./BioENome";
import { chamarInstagram, type CapaGuardada, type DestaqueProposto } from "./instagramApi";

/**
 * Destaques certos para o perfil, já sugeridos (pedido do dono, 28/09). Ao
 * abrir a aba sem lista e sem capas, ela pede ao Jev (uma chamada, custo de
 * frações de centavo, mostrado depois) a nota de cada candidato para ESTE
 * cliente e preenche a lista, que aparece na hora como bolinhas na prévia.
 * "Com IA" soma destaques próprios do cliente escritos pelo modelo de texto
 * (custo antes, no botão). A equipe pode trocar tudo na lista embaixo.
 */

export type SugestaoGuardada = { destaques: DestaqueSugerido[]; custo_usd: number; com_ia: boolean; sem_jev: boolean; em: string };

const ETAPA: Record<number, string> = { 1: "o que é", 2: "prova", 3: "oferta", 4: "dúvidas", 5: "onde e quem" };

/**
 * O estado da sugestão mora na aba (não na ferramenta): a sugestão sai ao
 * abrir, mesmo com outra ferramenta aberta, e as bolinhas da prévia já
 * aparecem.
 */
export function useSugestaoDeDestaques({
  clientId,
  contaId,
  lista,
  capas,
  pronto,
  onUsar,
}: {
  clientId: string;
  contaId: string | null;
  lista: DestaqueProposto[];
  capas: CapaGuardada[];
  /** O painel já chegou (sem ele não se sabe se há capas). */
  pronto: boolean;
  onUsar: (l: DestaqueProposto[]) => void;
}) {
  const { catalogo, atualizarCusto } = useMesa();
  const avisarErro = useAvisarErro();
  const modelo = useMemo(() => modeloDaAba(catalogo), [catalogo]);
  const [guardada, setGuardada] = useEstadoDaTela<SugestaoGuardada | null>(`mesa:instagram:sugestao-destaques:${clientId}`, null);
  const [rodando, setRodando] = useState(false);
  const pediu = useRef(false);

  const pedir = async (comIa: boolean, usarSeVazia: boolean, lancar = false) => {
    setRodando(true);
    try {
      const r = await chamarInstagram<SugestaoGuardada>("sugerir_destaques", clientId, { ...(contaId ? { conta_id: contaId } : {}), com_ia: comIa, ...(comIa && modelo ? { modelo_id: modelo.id } : {}) });
      const g: SugestaoGuardada = { destaques: Array.isArray(r.destaques) ? r.destaques : [], custo_usd: Number(r.custo_usd || 0), com_ia: !!r.com_ia, sem_jev: !!r.sem_jev, em: new Date().toISOString() };
      setGuardada(g);
      atualizarCusto();
      if (usarSeVazia && g.destaques.length) onUsar(g.destaques.map((d) => ({ nome: d.nome, icone: d.icone })));
      return r;
    } catch (e) {
      // Pelo botão com custo, o erro volta para ele (que avisa e relê o saldo).
      if (lancar) throw e;
      avisarErro(e, "Sugestão de destaques");
      return null;
    } finally {
      setRodando(false);
    }
  };

  // Já sugere ao abrir: sem lista, sem capas e sem sugestão guardada (uma vez por cliente).
  useEffect(() => {
    if (!pronto || pediu.current || guardada || lista.length || capas.length) return;
    pediu.current = true;
    void pedir(false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, pronto]);

  return { guardada, rodando, pedir, modelo };
}

export type SugestaoDaAba = ReturnType<typeof useSugestaoDeDestaques>;

export default function SugestaoDeDestaques({ sugestao, lista, onUsar }: { sugestao: SugestaoDaAba; lista: DestaqueProposto[]; onUsar: (l: DestaqueProposto[]) => void }) {
  const { clientId } = useMesa();
  const { guardada, rodando, pedir, modelo } = sugestao;
  const [recolhido, setRecolhido] = useRecolhido(`mesa:instagram:sugestao-recolhida:${clientId}`, false);
  const usada = !!guardada && guardada.destaques.length > 0 && lista.length === guardada.destaques.length && guardada.destaques.every((d, i) => lista[i] && lista[i].nome === d.nome);

  return (
    <div className="min-w-0 rounded-md border border-primary/30 bg-primary/5 px-3 py-2" data-sugestao-de-destaques="">
      <div className="flex min-w-0 items-center justify-between">
        <TituloRecolhivel
          titulo="Sugestão para este perfil"
          recolhido={recolhido}
          onAlternar={() => setRecolhido(!recolhido)}
          resumo={guardada ? `${guardada.destaques.length} destaques` : rodando ? "pensando" : ""}
        />
        {rodando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Sugerindo" />}
      </div>
      {!recolhido && (
        <div className="mt-2 min-w-0 space-y-2">
          {!guardada && !rodando && <p className={juntar(texto.auxiliar, "leading-5")}>O Jev escolhe os destaques certos para este cliente, na ordem de quem chega.</p>}
          {rodando && !guardada && <p className={texto.auxiliar}>Escolhendo os destaques deste perfil...</p>}
          {guardada && (
            <>
              <ol className="min-w-0 space-y-1">
                {guardada.destaques.map((d, i) => (
                  <li key={d.nome} className="flex min-w-0 items-center text-[12.5px]">
                    <span className="mr-2 w-4 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="w-[86px] shrink-0 truncate font-medium text-foreground">{d.nome}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.para || d.icone}</span>
                    <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{ETAPA[d.etapa] || ""}</span>
                    {d.nota !== null && (
                      <span className="ml-2 block h-1.5 w-10 shrink-0 overflow-hidden rounded bg-muted" title={`Nota do Jev ${String(d.nota).replace(".", ",")} de 3`}>
                        <span className="block h-full rounded bg-primary" style={{ width: `${Math.round((d.nota / 3) * 100)}%` }} />
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              <p className={texto.auxiliar}>
                {guardada.sem_jev ? "O Jev não respondeu: ordem padrão de negócio local." : `Escolha do Jev${guardada.com_ia ? " com destaques escritos pela IA" : ""}. Custo ${usd(guardada.custo_usd)}.`}
              </p>
            </>
          )}
          <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-2">
            {guardada && guardada.destaques.length > 0 && (
              <button type="button" className={juntar(botao.primario, "h-8 px-3 text-[12.5px]")} onClick={() => onUsar(guardada.destaques.map((d) => ({ nome: d.nome, icone: d.icone })))} disabled={usada}>
                {usada ? "Em uso na lista" : "Usar esta sugestão"}
              </button>
            )}
            <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} onClick={() => void pedir(false, false)} disabled={rodando}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Sugerir de novo
            </button>
            <BotaoComCusto
              rotulo={
                <span className="inline-flex items-center">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Com IA
                </span>
              }
              titulo="Destaques com IA"
              descricao="O modelo escreve destaques próprios deste cliente e o Jev escolhe entre eles e os típicos."
              partes={() => [{ modeloId: modelo ? modelo.id : null, tipo: "texto", tokensEntrada: 3000, tokensSaida: 700 }]}
              executar={() => pedir(true, false, true)}
              variant="outline"
              className="h-8"
              disabled={rodando || !modelo}
            />
          </div>
        </div>
      )}
    </div>
  );
}
