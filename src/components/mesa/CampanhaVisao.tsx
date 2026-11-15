import { useQueryClient } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { botao, juntar } from "@/components/sistema";
import { ProgressBar } from "@/components/ds";
import { NumerosOusados } from "./ousado";
import { useMesa } from "./MesaContexto";
import { type Campanha } from "./mesaV4Api";
import { numerosDaCampanha, resumoDaCampanhaEmHtml, type SituacaoDaPeca } from "./regrasDaCampanha";
import { PecasPorFase, useAcoesDasPecas } from "./CampanhaPecas";
import CampanhaAds from "./CampanhaAds";
import CampanhaCanvas from "./CampanhaCanvas";
import CampanhaReferenciaPadrao from "./CampanhaReferenciaPadrao";

/**
 * A campanha pronta (21/10/2026): capa com o selo, o título, o período e o estado; os números (peças,
 * prontas, na agenda, aprovadas); a linha do tempo das peças por fase com a capa de cada arte; e o resumo
 * para exportar (a página abre pronta para imprimir ou salvar em PDF pelo navegador).
 */

export function exportarResumo(html: string, nome: string) {
  try {
    const janela = window.open("", "_blank");
    if (janela) {
      janela.document.open();
      janela.document.write(html);
      janela.document.close();
      window.setTimeout(() => {
        try {
          janela.focus();
          janela.print();
        } catch {
          /* a página fica aberta para imprimir à mão */
        }
      }, 600);
      return;
    }
  } catch {
    /* janela bloqueada: baixa o arquivo */
  }
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campanha"}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function CampanhaVisao({
  campanha,
  pecas,
  onAbrirArteRapida,
  onAbrirStories,
}: {
  campanha: Campanha;
  pecas: SituacaoDaPeca[];
  onAbrirArteRapida?: (trabalhoId: string) => void;
  onAbrirStories?: (sequenciaId: string) => void;
}) {
  // 22/10/2026: cada peça da visão abre no Estúdio (ou nos Stories) direto daqui.
  const acoes = useAcoesDasPecas({ campanha, pecas, onAbrirArteRapida, onAbrirStories });
  const { clientName } = useMesa();
  const qc = useQueryClient();
  const n = numerosDaCampanha(pecas);
  const paleta = ((campanha.identidade && campanha.identidade.paleta_apoio) || []).filter((c) => c && c.hex);

  const exportar = () => {
    const imagens: Record<string, string> = {};
    pecas.forEach((p) => {
      if (!p.capa) return;
      const url = qc.getQueryData<string>(["mesa", "url", "mesa", p.capa]);
      if (url) imagens[p.capa] = url;
    });
    exportarResumo(resumoDaCampanhaEmHtml({ campanha, pecas, numeros: n, imagens, cliente: clientName }), campanha.nome);
    toast.success("Resumo da campanha", { description: "Aberto para imprimir ou salvar em PDF." });
  };

  return (
    <div className="min-w-0 space-y-5" data-visao-da-campanha="">
      {/* v4: o selo, o nome, o período e o estado já estão no cabeçalho da campanha logo acima; aqui ficam só a paleta, o conceito e o exportar. */}
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1 space-y-2">
          {paleta.length > 0 && (
            <span className="flex" aria-label="Paleta da campanha">
              {paleta.map((c, i) => (
                <span key={`${c.hex}-${i}`} className="mr-1 inline-block h-4 w-4 rounded-full border border-border" style={{ backgroundColor: c.hex }} title={c.nome || c.hex} />
              ))}
            </span>
          )}
          {campanha.conceito && <p className="text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{campanha.conceito}</p>}
        </div>
        <button type="button" className={juntar(botao.icone, "ml-2 shrink-0")} onClick={exportar} aria-label="Exportar o resumo" title="Exportar o resumo (imprimir ou salvar em PDF)">
          <FileDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Rodada ousada (15/11/2026): números grandes; as peças no cartão sólido e as prontas com a barra do andamento (prontas sobre peças). */}
      <NumerosOusados
        rotulo="Números da campanha"
        colunas={4}
        tamanho="md"
        destaque={0}
        tinta={-1}
        itens={[
          { rotulo: "Peças", valor: n.pecas },
          { rotulo: "Prontas", valor: n.prontas, apoio: n.gerando ? `${n.gerando} gerando` : undefined, grafico: n.pecas > 0 ? <ProgressBar value={n.prontas} max={n.pecas} label={`${n.prontas} de ${n.pecas} peças prontas`} /> : undefined },
          { rotulo: "Na agenda", valor: n.naAgenda, grafico: n.pecas > 0 ? <ProgressBar value={n.naAgenda} max={n.pecas} tone={2} label={`${n.naAgenda} de ${n.pecas} peças na agenda`} /> : undefined },
          { rotulo: "Aprovadas", valor: n.aprovadas, apoio: n.comErro ? `${n.comErro} com erro` : undefined, grafico: n.pecas > 0 ? <ProgressBar value={n.aprovadas} max={n.pecas} tone={2} label={`${n.aprovadas} de ${n.pecas} peças aprovadas`} /> : undefined },
        ]}
      />

      {/* 22/10/2026: o padrão visual da campanha (referências e o estilo em uma frase), com trocar. */}
      <div className="min-w-0 border-t border-border pt-4">
        <CampanhaReferenciaPadrao campanha={campanha} pecas={pecas} compacto />
      </div>

      {/* Vínculo opcional com a campanha de anúncios (números da Meta já sincronizados e atalho para a Mesa Ads). */}
      <div className="min-w-0 border-t border-border pt-4">
        <CampanhaAds campanha={campanha} />
      </div>

      {/* 25/10/2026: a campanha no canvas do Laboratório (abrir, sincronizar e as sugestões do canvas). */}
      <CampanhaCanvas campanha={campanha} />

      <PecasPorFase pecas={pecas} acoes={acoes} vazio="Sem peças ainda: gere a campanha completa." />
    </div>
  );
}
