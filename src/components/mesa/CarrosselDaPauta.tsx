import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Crown, GripVertical, X } from "lucide-react";
import { foco, juntar } from "@/components/sistema/estilos";
import { MiniaturaDaFoto } from "@/components/mesa-foto/Comuns";
import AcoesProDaFoto from "@/components/mesa-foto/AcoesProDaFoto";
import type { FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import { emAlta, LADO_DE_ALTA, moverNaOrdem } from "@/components/mesa-foto/fotoDaPautaApi";

/**
 * Carrossel da pauta (27/10/2026): as fotos escolhidas na ordem do post,
 * arrastáveis (ou pelas setas), capa em um clique, aviso de foto abaixo da
 * alta qualidade com o Ampliar fiel ali mesmo (versão nova no acervo; nada é
 * colado por cima). A entrega segue o fluxo do post de fotos (Preparar na
 * Agenda); texto nas lâminas só pelo Estúdio de artes, quando pedirem.
 */
export default function CarrosselDaPauta({ fotos, onOrdem, onTrocar, entrega, somenteLeitura = false }: {
  fotos: FotoDoAcervo[];
  onOrdem?: (ids: string[]) => void;
  /** Troca uma foto por outra versão (Ampliar), no mesmo lugar. */
  onTrocar?: (antiga: string, nova: FotoDoAcervo) => void;
  /** Formato e botão de entrega do fluxo existente. */
  entrega?: ReactNode;
  somenteLeitura?: boolean;
}) {
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const ids = fotos.map((f) => f.id);
  const mover = (de: number, para: number) => { if (onOrdem) onOrdem(moverNaOrdem(ids, de, para)); };
  const baixas = fotos.filter((f) => emAlta(f) === false);
  const atual = fotos.find((f) => f.id === escolhida) || null;
  return <section aria-label="Carrossel do post" className="min-w-0 space-y-3" data-carrossel-da-pauta="">
    <p role="status" className="text-[12px] text-muted-foreground">{!fotos.length ? "Escolha ou gere fotos para montar o carrossel." : fotos.length === 1 ? "Foto única." : `${fotos.length} lâminas. A primeira é a capa.`}{baixas.length ? ` ${baixas.length} abaixo de ${LADO_DE_ALTA} px.` : ""}</p>
    <ol className="grid grid-cols-2 gap-2" aria-label="Ordem do carrossel">
      {fotos.map((f, i) => <li key={f.id} className={juntar("min-w-0 rounded-md", arrastando === i ? "opacity-50" : "")} data-lamina={i + 1}
        draggable={!somenteLeitura} onDragStart={(e) => { setArrastando(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
        onDragOver={(e) => { if (!somenteLeitura) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); const de = Number(e.dataTransfer.getData("text/plain")); if (Number.isFinite(de)) mover(de, i); setArrastando(null); }} onDragEnd={() => setArrastando(null)}>
        <div className="relative">
          <button type="button" aria-label={`Lâmina ${i + 1}: ${f.nome}`} aria-pressed={escolhida === f.id} onClick={() => setEscolhida(escolhida === f.id ? null : f.id)} className={juntar("block w-full overflow-hidden rounded-md border-2", foco, escolhida === f.id ? "border-primary" : "border-transparent")}><MiniaturaDaFoto foto={f} /></button>
          <span className="pointer-events-none absolute left-1 top-1 rounded-full bg-card/90 px-1.5 text-[11px] font-semibold">{i === 0 ? "Capa" : i + 1}</span>
          {emAlta(f) === false && <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-card/90 px-1 text-[11px] text-primary">baixa</span>}
          {!somenteLeitura && <GripVertical className="pointer-events-none absolute right-1 top-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        </div>
        {!somenteLeitura && <div className="mt-1 flex items-center justify-between">
          <button type="button" disabled={!i} aria-label={`Mover lâmina ${i + 1} para antes`} onClick={() => mover(i, i - 1)} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /></button>
          <button type="button" disabled={!i} aria-label={`Usar lâmina ${i + 1} como capa`} title="Usar como capa" onClick={() => mover(i, 0)} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"><Crown className="h-3.5 w-3.5" aria-hidden="true" /></button>
          <button type="button" aria-label={`Tirar lâmina ${i + 1}`} onClick={() => onOrdem?.(ids.filter((x) => x !== f.id))} className="rounded p-1 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          <button type="button" disabled={i === fotos.length - 1} aria-label={`Mover lâmina ${i + 1} para depois`} onClick={() => mover(i, i + 1)} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"><ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </div>}
      </li>)}
    </ol>
    {atual && !somenteLeitura && onTrocar && <div className="min-w-0 border-t pt-3" data-alta-qualidade={atual.id}>
      <p className="mb-1 text-[12px] font-medium text-muted-foreground">Alta qualidade · {atual.largura && atual.altura ? `${atual.largura} × ${atual.altura} px` : "tamanho não medido"}</p>
      <AcoesProDaFoto foto={atual} mostrarCriativo={false} onPronta={(nova) => { onTrocar(atual.id, nova); setEscolhida(nova.id); }} />
    </div>}
    {entrega}
  </section>;
}
