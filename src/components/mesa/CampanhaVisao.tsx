import { useQueryClient } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { FaixaDeNumeros, botao, juntar, texto } from "@/components/sistema";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { periodoCurto, type Campanha } from "./mesaV4Api";
import { numerosDaCampanha, resumoDaCampanhaEmHtml, type SituacaoDaPeca } from "./regrasDaCampanha";
import { PecasPorFase, useAcoesDasPecas } from "./CampanhaPecas";
import CampanhaAds from "./CampanhaAds";
import CampanhaCanvas from "./CampanhaCanvas";
import CampanhaReferenciaPadrao from "./CampanhaReferenciaPadrao";
import { SeloDoEstado } from "./CampanhaDetalhe";

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
      {/* Capa: selo grande, título, período e estado. */}
      <div className="flex min-w-0 items-center">
        <span className="mr-4 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {campanha.selo_path ? (
            <ImagemDaMesa caminho={campanha.selo_path} alt={`Selo de ${campanha.nome}`} className="h-full w-full !object-contain p-1" />
          ) : (
            <span className="text-[24px] font-semibold" style={paleta.length ? { color: String(paleta[0].hex) } : undefined}>{(campanha.nome || "C").charAt(0).toUpperCase()}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className={juntar(texto.tituloSecao, "truncate")} title={campanha.nome}>{campanha.nome}</p>
          <p className="mt-0.5 flex min-w-0 items-center text-[12px] text-muted-foreground">
            <span className="mr-2 truncate">{periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}</span>
            <SeloDoEstado estado={campanha.status} />
          </p>
          {paleta.length > 0 && (
            <span className="mt-1.5 flex" aria-label="Paleta da campanha">
              {paleta.map((c, i) => (
                <span key={`${c.hex}-${i}`} className="mr-1 inline-block h-4 w-4 rounded-full border border-border" style={{ backgroundColor: c.hex }} title={c.nome || c.hex} />
              ))}
            </span>
          )}
        </div>
        <button type="button" className={juntar(botao.icone, "ml-2")} onClick={exportar} aria-label="Exportar o resumo" title="Exportar o resumo (imprimir ou salvar em PDF)">
          <FileDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {campanha.conceito && <p className="text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{campanha.conceito}</p>}

      <FaixaDeNumeros
        rotulo="Números da campanha"
        colunas={4}
        tamanho="compacto"
        itens={[
          { rotulo: "Peças", valor: n.pecas },
          { rotulo: "Prontas", valor: n.prontas, ponto: n.prontas && n.prontas === n.pecas ? "verde" : "neutro", apoio: n.gerando ? `${n.gerando} gerando` : undefined },
          { rotulo: "Na agenda", valor: n.naAgenda },
          { rotulo: "Aprovadas", valor: n.aprovadas, apoio: n.comErro ? `${n.comErro} com erro` : undefined },
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
