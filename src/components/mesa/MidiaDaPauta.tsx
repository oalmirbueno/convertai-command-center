import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Wand2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AcoesDaBancada } from "./BancadaDaPauta";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { partesDaMidia } from "./mesaV4Api";
import { pensarMidiaDaPeca } from "./planoDoMes";
import { juntar, texto } from "@/components/sistema/estilos";
import type { ItemDoMes } from "./useItensDoMes";

/**
 * A mídia da pauta pensada pelo nicho (23/10/2026): uma linha que recolhe com o que o painel escolheu (fotos do
 * Workspace pelo Jev, referência livre com licença, roteiro do vídeo com gancho) e o ícone "Pensar a mídia" com o
 * custo antes do clique.
 * 26/10/2026 (dono: "sem monte de linha, mais clean"): deixou de ser uma linha própria em cima da peça. Mora na
 * barra da bancada (AcoesDaBancada): a varinha com o custo e, quando já pensada, o chip "Mídia" que abre o detalhe. Nada é gerado aqui: as fotos já abrem escolhidas na prancheta e o vídeo já abre com a
 * imagem de partida, o prompt e a fala; gerar continua no Estúdio, com o custo de sempre.
 */
export default function MidiaDaPauta({ item }: { item: ItemDoMes }) {
  const { clientId, catalogo } = useMesa();
  const cache = useQueryClient();
  const [aberta, setAberta] = useState(false);
  const m = item.midia || null;
  const tipo = item.modo_estudio === "video" ? "video" : item.modo_estudio === "fotos" ? "foto" : null;
  if (!tipo || item.planejamento) return null;
  const estado = m ? `Mídia: ${m.resumo}` : tipo === "video" ? "Roteiro e imagem de partida ainda não pensados" : "Fotos ainda não escolhidas";
  return (
    <AcoesDaBancada>
      <div className="flex min-w-0 shrink-0 items-center" data-midia-da-pauta={m ? m.fonte : "vazia"} title={estado}>
        {m && (
          <Popover open={aberta} onOpenChange={setAberta}>
            <PopoverTrigger asChild>
              <button type="button" className={juntar(texto.auxiliar, "h-8 max-w-[180px] truncate rounded-md px-2 hover:bg-muted hover:text-foreground")} aria-label={`Ver a mídia pensada: ${m.resumo}`}>
                Mídia
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[calc(100vw-24px)] max-w-[420px] p-3">
              <div className="min-w-0 space-y-1.5 text-[13px] leading-snug [overflow-wrap:anywhere]">
                <p className="font-medium">{m.resumo}</p>
                {m.gancho && <p><span className="text-muted-foreground">Gancho: </span>{m.gancho}</p>}
                {m.cenas.length > 0 && (
                  <ol className="list-decimal pl-5">
                    {m.cenas.map((c, i) => <li key={i}>{c}</li>)}
                  </ol>
                )}
                {m.narracao && <p><span className="text-muted-foreground">Fala: </span>{m.narracao}</p>}
                {m.acervo.length > 0 && <p><span className="text-muted-foreground">Do Workspace: </span>{m.acervo.map((a) => a.nome).join(", ")}</p>}
                {m.web.length > 0 && (
                  <ul className="space-y-1">
                    {m.web.map((w) => (
                      <li key={w.imagem_url} className="flex min-w-0 items-center">
                        {w.miniatura_url && <img src={w.miniatura_url} alt="" className="mr-2 h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />}
                        <span className="min-w-0 flex-1 truncate" title={w.titulo}>{w.titulo}</span>
                        <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{w.licenca}{w.autor ? ` · ${w.autor}` : ""}</span>
                        {w.fonte_url && (
                          <a href={w.fonte_url} target="_blank" rel="noreferrer noopener" className="ml-1 shrink-0 p-1 text-muted-foreground hover:text-foreground" aria-label="Abrir a fonte da referência" title="Abrir a fonte da referência">
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <BotaoComCusto
          rotulo={<Wand2 className="h-4 w-4" aria-hidden="true" />}
          titulo="Pensar a mídia pelo nicho"
          descricao={tipo === "video" ? "Escolhe a imagem de partida no Workspace e escreve o roteiro com gancho (2 versões, o Jev escolhe). Não gera o vídeo." : "Escolhe as fotos do Workspace que servem ao tema; sem nenhuma boa, busca referência livre com licença. Não gera foto."}
          partes={() => partesDaMidia(catalogo, 1)}
          executar={async () => {
            const r = await pensarMidiaDaPeca(clientId, item.id, tipo);
            await cache.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
            await cache.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
            setAberta(true);
            return r;
          }}
          variant="ghost"
          className="h-8 shrink-0 px-2"
        />
      </div>
    </AcoesDaBancada>
  );
}
