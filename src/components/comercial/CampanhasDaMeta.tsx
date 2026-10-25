import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Search, X } from "lucide-react";
import { AjudaRecolhida, botao, campo, juntar, texto } from "@/components/sistema";
import { listarCampanhasDaMeta, rotuloDoStatusDaMeta, type CampanhaDaMeta } from "@/lib/comercial";

/**
 * As campanhas da Meta ligadas a uma campanha da casa e a chave do Mercúrio (25/10/2026, dono: "ligando com as
 * campanhas Ads com opção de selecionar, e nas campanhas sempre eu poder escolher usar ou não").
 * O lead que chega de um anúncio dessas campanhas entra nesta campanha da casa sozinho (gatilho do banco).
 * Sem rolagem própria: a busca mostra as 8 que casam; as escolhidas ficam em chips.
 */

const MOSTRAR = 8;

export function filtrarCampanhasDaMeta(lista: CampanhaDaMeta[], busca: string): CampanhaDaMeta[] {
  const b = busca.trim().toLowerCase();
  if (!b) return lista;
  return lista.filter((c) => `${c.nome} ${c.cliente} ${c.campaign_id}`.toLowerCase().indexOf(b) >= 0);
}

export default function CampanhasDaMeta({
  selecionadas,
  aoMudar,
  mercurioAtivo,
  aoMudarMercurio,
}: {
  selecionadas: string[];
  aoMudar: (ids: string[]) => void;
  mercurioAtivo: boolean;
  aoMudarMercurio: (v: boolean) => void;
}) {
  const consulta = useQuery({ queryKey: ["comercial-campanhas-da-meta"], queryFn: listarCampanhasDaMeta, staleTime: 60_000 });
  const [busca, setBusca] = useState("");
  const lista = consulta.data || [];
  const porId = useMemo(() => {
    const m: Record<string, CampanhaDaMeta> = {};
    for (const c of lista) m[c.campaign_id] = c;
    return m;
  }, [lista]);
  const achadas = filtrarCampanhasDaMeta(lista, busca).filter((c) => selecionadas.indexOf(c.campaign_id) < 0);
  const trocar = (id: string) => aoMudar(selecionadas.indexOf(id) >= 0 ? selecionadas.filter((x) => x !== id) : selecionadas.concat([id]));

  return (
    <section className="min-w-0 space-y-3 border-t border-border pt-4" aria-label="Campanhas da Meta e Mercúrio">
      <div className="flex min-w-0 items-center">
        <h3 className={juntar(texto.tituloSecao, "min-w-0 flex-1")}>Campanhas da Meta ligadas</h3>
        <AjudaRecolhida rotulo="Para que serve ligar a campanha da Meta">
          O lead que chega de um anúncio destas campanhas entra nesta campanha sozinho, e o custo por cliente sai certo.
        </AjudaRecolhida>
      </div>
      {selecionadas.length > 0 ? (
        <ul className="flex min-w-0 flex-wrap gap-1" aria-label="Campanhas da Meta escolhidas">
          {selecionadas.map((id) => {
            const c = porId[id];
            return (
              <li key={id} className="inline-flex min-w-0 max-w-full items-center rounded-md bg-muted px-2 py-1 text-[12px]">
                <span className="min-w-0 truncate">{c ? c.nome : id}</span>
                <button type="button" onClick={() => trocar(id)} className="ml-1 shrink-0 rounded text-muted-foreground hover:text-foreground" aria-label={`Tirar ${c ? c.nome : id}`}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={texto.auxiliar}>Nenhuma campanha da Meta ligada.</p>
      )}
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar campanha da Meta pelo nome ou cliente" className={juntar(campo, "pl-8")} aria-label="Buscar campanha da Meta" />
      </div>
      {consulta.isLoading ? (
        <p className={texto.auxiliar}>Lendo as campanhas da Meta…</p>
      ) : consulta.isError ? (
        <p className="text-[12px] text-destructive">Não foi possível ler as campanhas da Meta.</p>
      ) : lista.length === 0 ? (
        <p className={texto.auxiliar}>Nenhuma campanha da Meta sincronizada ainda.</p>
      ) : (
        <ul className="min-w-0 divide-y divide-border" aria-label="Campanhas da Meta para ligar">
          {achadas.slice(0, MOSTRAR).map((c) => (
            <li key={c.campaign_id} className="flex min-w-0 items-center py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{c.nome}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {[rotuloDoStatusDaMeta(c.status), c.cliente].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button type="button" onClick={() => trocar(c.campaign_id)} className={juntar(botao.secundario, "ml-2")} aria-label={`Ligar ${c.nome}`}>
                Ligar
              </button>
            </li>
          ))}
          {achadas.length > MOSTRAR && <li className={juntar(texto.auxiliar, "py-1.5")}>Mais {achadas.length - MOSTRAR}: refine a busca.</li>}
          {achadas.length === 0 && <li className={juntar(texto.auxiliar, "py-1.5")}>Nada encontrado.</li>}
        </ul>
      )}
      <div className="flex min-w-0 items-center gap-2 border-t border-border pt-3">
        <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <label className="flex min-w-0 flex-1 items-center text-[13px] font-medium">
          <input type="checkbox" className="mr-2" checked={mercurioAtivo} onChange={(e) => aoMudarMercurio(e.target.checked)} aria-label="O Mercúrio atende os leads desta campanha" />
          O Mercúrio atende os leads desta campanha
        </label>
        <AjudaRecolhida rotulo="Quando o Mercúrio entra">
          Com a chave ligada, todo lead novo desta campanha já chega com o Mercúrio atendendo. Vale só para lead da casa: lead que vem do site de um cliente nunca vai para o Mercúrio. Dá para ligar ou desligar em cada lead, na aba Agente.
        </AjudaRecolhida>
      </div>
    </section>
  );
}
