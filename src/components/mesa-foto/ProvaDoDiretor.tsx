import { ArrowRight } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { MiniaturaDaFoto } from "./Comuns";
import { useFotos, type FotoDoAcervo } from "./fotoApi";

/**
 * A prova do que o diretor fez (dono, 27/09: "ele tem que sempre trazer
 * provas das ações"): depois de feito, as fotos que ele mexeu ou gerou, com o
 * antes e o depois lado a lado quando há um antes (variação, melhoria). O
 * "onde ficou" é o botão do caminho, logo acima. Só mostra o que já está no
 * acervo; o resto aparece quando a lista relê.
 */

export type ParDaProva = { antes: string | null; depois: string };

/** Pares antes e depois das propostas feitas (geração: alvo e foto nova; sem custo: a foto mexida). */
export function paresDaProva(acao: Pick<AcaoDoAgente, "agente" | "itens" | "resultados" | "contexto">): ParDaProva[] {
  const feitos = (acao.resultados || []).filter((r) => r.ok);
  const saida: ParDaProva[] = [];
  const pedidos = ((acao.contexto || {}) as Record<string, any>).pedidos || {};
  feitos.forEach((r) => {
    const x = (r.desfazer || {}) as Record<string, unknown>;
    const nova = typeof x.imagem_id === "string" ? x.imagem_id : null;
    if (acao.agente === "diretor_geracao") {
      if (!nova) return;
      const pd = pedidos[r.ref] || null;
      const antes = pd && (pd.operacao === "variar_imagem" || pd.operacao === "melhorar_foto") ? String(pd.alvo_id || "") || null : null;
      saida.push({ antes, depois: nova });
      return;
    }
    // Sem custo: a própria foto (aprovada, arquivada, no post, no Canvas...).
    if (/^i\d+/.test(r.ref)) saida.push({ antes: null, depois: r.alvo_id });
  });
  const vistos: string[] = [];
  return saida.filter((p) => {
    const k = `${p.antes || ""}>${p.depois}`;
    if (vistos.indexOf(k) >= 0) return false;
    vistos.push(k);
    return true;
  }).slice(0, 12);
}

export default function ProvaDoDiretor({ acao }: { acao: AcaoDoAgente }) {
  const { clientId } = useMesa();
  const fotos = useFotos(clientId);
  const porId = new Map((fotos.data || []).map((f) => [f.id, f] as [string, FotoDoAcervo]));
  const pares = paresDaProva(acao).filter((p) => porId.has(p.depois));
  if (!pares.length) return null;
  const comAntes = pares.some((p) => p.antes && porId.has(p.antes));
  return (
    <div className="mt-1.5 min-w-0 rounded-lg border border-border bg-background p-2" data-prova-do-diretor={acao.id}>
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{comAntes ? "Prova: antes e depois" : "Prova: as fotos"}</p>
      <ul className="flex min-w-0 flex-wrap">
        {pares.map((p) => {
          const antes = p.antes ? porId.get(p.antes) || null : null;
          const depois = porId.get(p.depois) as FotoDoAcervo;
          return (
            <li key={`${p.antes || ""}-${p.depois}`} className="mb-1.5 mr-2 flex items-center">
              {antes && (
                <>
                  <span className="w-12">
                    <MiniaturaDaFoto foto={antes} selo={false} />
                  </span>
                  <ArrowRight className="mx-0.5 h-3 w-3 text-muted-foreground" aria-label="virou" />
                </>
              )}
              <span className="w-12" title={depois.nome}>
                <MiniaturaDaFoto foto={depois} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
