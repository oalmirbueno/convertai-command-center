import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvisoDeErro } from "./Custo";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import CampanhaDetalhe, { SeloDoEstado } from "./CampanhaDetalhe";
import CampanhaNova from "./CampanhaNova";
import { chaves, lerCampanhas, lerHypes, periodoCurto, useMidia, type Campanha } from "./mesaV4Api";

/**
 * Aba Campanhas (entre Mês e Estúdio): as campanhas do cliente (promoção do
 * amor, dia do cliente...) com o tema, a identidade, o selo e os conteúdos.
 * No computador, lista à esquerda e a campanha à direita; no celular, uma
 * coisa de cada vez. Um hype da semana chega aqui já preenchido.
 */

function ItemDaLista({ campanha, ativa, onAbrir }: { campanha: Campanha; ativa: boolean; onAbrir: () => void }) {
  const paleta = (campanha.identidade && campanha.identidade.paleta_apoio) || [];
  const cor = paleta.length && paleta[0].hex ? String(paleta[0].hex) : undefined;
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-current={ativa ? "true" : undefined}
      className={`flex w-full min-w-0 items-center rounded-xl border bg-card p-2.5 text-left transition-colors ${ativa ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"}`}
    >
      <span className="mr-3 flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
        {campanha.selo_path ? (
          <ImagemDaMesa caminho={campanha.selo_path} alt="" className="h-full w-full !object-contain p-0.5" />
        ) : (
          <span className="text-[15px] font-semibold" style={cor ? { color: cor } : undefined}>{(campanha.nome || "C").charAt(0).toUpperCase()}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{campanha.nome}</span>
        <span className="mt-0.5 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
          <span className="mr-2 min-w-0 truncate">{periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}</span>
          <SeloDoEstado estado={campanha.status} />
        </span>
      </span>
    </button>
  );
}

export default function AbaCampanhas({
  campanhaId = null,
  onCampanha,
  hypeIndice = null,
  onLimparHype,
  onAbrirNoEstudio,
}: {
  campanhaId?: string | null;
  onCampanha?: (id: string | null) => void;
  /** Índice do hype (na busca mais recente) que abre a campanha nova já preenchida. */
  hypeIndice?: number | null;
  onLimparHype?: () => void;
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
} = {}) {
  const { clientId } = useMesa();
  const larga = useMidia("(min-width: 1024px)");
  const [idLocal, setIdLocal] = useState<string | null>(campanhaId);
  const [nova, setNova] = useState(hypeIndice !== null);
  const [projetoDaCriacao, setProjetoDaCriacao] = useState<Record<string, string>>({});

  const campanhas = useQuery({ queryKey: chaves.campanhas(clientId), queryFn: () => lerCampanhas(clientId) });
  const hypes = useQuery({ queryKey: chaves.hypes(clientId), enabled: hypeIndice !== null, queryFn: () => lerHypes(clientId) });
  const hype = hypeIndice !== null && hypes.data ? hypes.data.itens[hypeIndice] || null : null;

  useEffect(() => { setIdLocal(campanhaId); }, [campanhaId]);
  useEffect(() => { if (hypeIndice !== null) setNova(true); }, [hypeIndice]);

  const lista = campanhas.data || [];
  const escolhida = lista.find((c) => c.id === idLocal) || (larga && !nova ? lista[0] || null : null);

  const abrir = (id: string | null) => {
    setIdLocal(id);
    setNova(false);
    if (onCampanha) onCampanha(id);
  };

  const comecarNova = () => {
    setNova(true);
    setIdLocal(null);
    if (onCampanha) onCampanha(null);
  };

  const fecharNova = () => {
    setNova(false);
    if (onLimparHype) onLimparHype();
  };

  // No celular, mostra a lista ou o que foi aberto (nova ou uma campanha).
  const mostrarLista = larga || (!nova && !escolhida);
  const mostrarLado = larga || nova || !!escolhida;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      {mostrarLista && (
        <aside className="min-w-0 space-y-3">
          <div className="flex min-w-0 items-center">
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Campanhas</h2>
            <Button type="button" size="sm" className="h-8 shrink-0" onClick={comecarNova}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Nova campanha
            </Button>
          </div>
          {campanhas.isLoading && (
            <div className="space-y-2">
              <div className="h-16 animate-pulse rounded-xl bg-muted" />
              <div className="h-16 animate-pulse rounded-xl bg-muted" />
            </div>
          )}
          {campanhas.isError && <AvisoDeErro erro={campanhas.error} />}
          {campanhas.isSuccess && lista.length === 0 && !nova && (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <Megaphone className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-[12.5px] text-muted-foreground">Nenhuma campanha ainda.</p>
            </div>
          )}
          <ul className="space-y-2">
            {lista.map((c) => (
              <li key={c.id} className="min-w-0">
                <ItemDaLista campanha={c} ativa={!nova && !!escolhida && escolhida.id === c.id} onAbrir={() => abrir(c.id)} />
              </li>
            ))}
          </ul>
        </aside>
      )}

      {mostrarLado && (
        <div className="min-w-0">
          {nova ? (
            hypeIndice !== null && hypes.isLoading ? (
              <div className="h-64 animate-pulse rounded-xl bg-muted" />
            ) : (
              <CampanhaNova
                key={hype ? `hype-${hypeIndice}` : "nova"}
                hype={hype}
                onLimparHype={onLimparHype}
                onCancelar={lista.length || !larga ? fecharNova : undefined}
                onCriada={(c, projectId) => {
                  if (projectId) setProjetoDaCriacao((m) => ({ ...m, [c.id]: projectId }));
                  if (onLimparHype) onLimparHype();
                  abrir(c.id);
                }}
              />
            )
          ) : escolhida ? (
            <CampanhaDetalhe
              campanha={escolhida}
              projetoSugerido={projetoDaCriacao[escolhida.id] || null}
              onVoltar={() => abrir(null)}
              onAbrirNoEstudio={onAbrirNoEstudio}
            />
          ) : campanhas.isSuccess && lista.length === 0 ? (
            <CampanhaNova onCriada={(c, projectId) => {
              if (projectId) setProjetoDaCriacao((m) => ({ ...m, [c.id]: projectId }));
              abrir(c.id);
            }} />
          ) : null}
        </div>
      )}
    </div>
  );
}
