import { useState } from "react";
import { HelpCircle, Wand2, X } from "lucide-react";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { partesDaConversa } from "../fotoApi";
import { capaDeReserva, MODELOS_PRONTOS, rotuloDaAcao, rotuloDaPose, TIPOS_DE_NO, type ModeloPronto } from "../canvasApi";
import { ICONES, PAINEL } from "./comum";

/**
 * Galeria de modelos prontos (dono, 25/09: "templates pré-prontos bonitos;
 * auto paint com base no contexto"). Cada modelo tem miniatura: a capa
 * (foto de base do dono em public/canvas-modelos, webp com jpg de reserva
 * para Safari 11 a 13) ou, sem capa ou se ela falhar, os cartões do modelo
 * desenhados sobre um gradiente. "Montar
 * pelo contexto" pede ao agente (IA, custo à vista) que escolha o modelo e
 * preencha produto, pessoa, ambiente e pedido pelo contexto do cliente.
 */

export function MiniaturaDoModelo({ m, altura = 84 }: { m: ModeloPronto; altura?: number }) {
  const [capaFalhou, setCapaFalhou] = useState(false);
  const capa = m.capa && !capaFalhou ? m.capa : null;
  return (
    <span className="relative block w-full overflow-hidden rounded-lg" style={{ height: altura, background: `linear-gradient(135deg, ${m.cores[0]}, ${m.cores[1]})` }} data-miniatura-do-modelo={m.chave} data-com-capa={capa ? "" : undefined}>
      {capa ? (
        <picture className="block h-full w-full">
          <source srcSet={capa} type="image/webp" />
          <img src={capaDeReserva(capa)} alt="" className="block h-full w-full object-cover" loading="lazy" decoding="async" onError={() => setCapaFalhou(true)} />
        </picture>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          {m.cartoes.map((c, i) => {
            const Icone = ICONES[c.tipo];
            return (
              <span key={`${c.tipo}-${i}`} className="-ml-1.5 flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-zinc-950/80 shadow first:ml-0">
                <Icone className={`h-3.5 w-3.5 ${TIPOS_DE_NO[c.tipo].texto}`} />
              </span>
            );
          })}
          <span className="ml-1.5 h-px w-4 bg-white/60" />
          <span className="ml-1 flex h-9 w-7 items-center justify-center rounded-md border border-white/30 bg-white/90 text-[9px] font-bold text-black">{m.resultado && m.resultado.carrossel ? `${m.resultado.carrossel}x` : "1"}</span>
        </span>
      )}
    </span>
  );
}

export function GaleriaDeModelos({ onAplicar, onFechar, onMontarPeloContexto }: { onAplicar: (chave: string) => void; onFechar?: () => void; onMontarPeloContexto?: () => Promise<unknown> }) {
  const { catalogo } = useMesa();
  return (
    <div className={`${PAINEL} min-w-0 rounded-2xl p-3`} data-modelos-prontos="">
      <div className="mb-2 flex items-center">
        <Wand2 className="mr-1.5 h-3.5 w-3.5 text-emerald-300" />
        <p className="flex-1 text-[12px] font-semibold">Modelos prontos: montam o quadro em 1 clique</p>
        {onMontarPeloContexto && (
          <BotaoComCusto
            rotulo={
              <>
                <Wand2 className="mr-1 h-3.5 w-3.5" /> Montar pelo contexto
              </>
            }
            titulo="Quadro montado pelo contexto"
            descricao="O agente lê o contexto do cliente, escolhe o modelo e preenche produto, pessoa, ambiente e pedido."
            variant="outline"
            className="mr-1.5 h-7 border-white/10 bg-white/5 text-[11.5px] text-zinc-100 hover:bg-white/10"
            partes={() => partesDaConversa(catalogo)}
            executar={onMontarPeloContexto}
          />
        )}
        {onFechar && (
          <button type="button" onClick={onFechar} aria-label="Fechar os modelos prontos" className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {MODELOS_PRONTOS.map((m) => (
          <button key={m.chave} type="button" onClick={() => onAplicar(m.chave)} data-modelo-pronto={m.chave} title={m.dica} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 text-left transition-colors hover:border-emerald-400/60">
            <MiniaturaDoModelo m={m} />
            <span className="mt-1.5 block truncate text-[12px] font-semibold leading-snug">{m.rotulo}</span>
            <span className="block truncate text-[10.5px] text-zinc-400">
              {[m.resultado && m.resultado.acao && m.resultado.acao !== "livre" ? rotuloDaAcao(m.resultado.acao) : "", m.resultado && m.resultado.pose && m.resultado.pose !== "nenhuma" ? rotuloDaPose(m.resultado.pose) : "", m.resultado && m.resultado.formato ? m.resultado.formato : ""].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ComoFunciona({ onFechar }: { onFechar: () => void }) {
  return (
    <div className={`${PAINEL} absolute left-1/2 top-3 z-10 w-[400px] max-w-[60%] -translate-x-1/2 rounded-2xl p-3`} data-como-funciona="">
      <div className="mb-1.5 flex items-center">
        <HelpCircle className="mr-1.5 h-3.5 w-3.5 text-emerald-300" />
        <p className="flex-1 text-[12px] font-semibold">Como funciona</p>
        <button type="button" onClick={onFechar} aria-label="Fechar o como funciona" className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ol className="space-y-1 text-[11.5px] leading-snug text-zinc-300">
        <li>
          <b className="text-white">1.</b> Ponha o que vai na foto: produto (da esteira no topo, até de outro cliente), pessoa, ambiente, estilo, um pedido ou o agente.
        </li>
        <li>
          <b className="text-white">2.</b> Cada cartão se liga sozinho ao Resultado. Arraste a ponta da linha para trocar a ligação; Delete apaga o cartão.
        </li>
        <li>
          <b className="text-white">3.</b> No Resultado, escolha a ação e a pose e toque em Gerar. A foto aparece nele e vai para o acervo.
        </li>
      </ol>
    </div>
  );
}
