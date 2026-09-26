import { Link } from "react-router-dom";
import { Settings2 } from "lucide-react";
import type { PlataformaAds, PlataformaResumo } from "@/lib/esteira/esteiraTipos";
import { EstadoVazio, SeletorCompacto, botao, juntar, texto } from "@/components/sistema";

const ESTADO: Record<PlataformaResumo["estado"], { ponto: string; texto: (p: PlataformaResumo) => string }> = {
  ativa: { ponto: "bg-primary", texto: (p) => `${p.ativas} no ar${p.vendas7d > 0 ? ` · ${p.vendas7d} venda${p.vendas7d === 1 ? "" : "s"} 7d` : ""}` },
  ligada: { ponto: "bg-warning", texto: () => "ligada, sem campanha" },
  pausada: { ponto: "bg-muted-foreground/60", texto: () => "conta pausada" },
  "nao-configurada": { ponto: "border border-border bg-transparent", texto: () => "não configurada" },
};

interface Props {
  plataformas: PlataformaResumo[];
  selecionada: PlataformaAds;
  onSelecionar: (p: PlataformaAds) => void;
}

/**
 * Seletor de plataforma no topo da aba Tráfego: Meta, Google, TikTok.
 * Sistema de design: até 4 opções viram um segmentado (SeletorCompacto); o
 * estado de cada plataforma vai no ponto colorido e o da escolhida numa linha
 * de apoio embaixo.
 */
export default function TrafegoPlataformas({ plataformas, selecionada, onSelecionar }: Props) {
  const atual = plataformas.find((p) => p.key === selecionada) || null;
  return (
    <div className="min-w-0">
      <SeletorCompacto
        rotulo="Plataforma de anúncio"
        valor={selecionada}
        onEscolher={(v) => onSelecionar(v as PlataformaAds)}
        larguraTotal
        opcoes={plataformas.map((p) => ({
          valor: p.key,
          rotulo: p.rotulo,
          icone: <span className={`inline-block h-2 w-2 rounded-full ${ESTADO[p.estado].ponto}`} />,
        }))}
      />
      {atual && <p className={juntar(texto.auxiliar, "mt-1.5 truncate")}>{atual.rotulo}: {ESTADO[atual.estado].texto(atual)}</p>}
    </div>
  );
}

/** Plataforma sem conta: diz o que falta e leva para configurar. */
export function PlataformaNaoConfigurada({ plataforma }: { plataforma: PlataformaResumo }) {
  const frase = plataforma.estado === "pausada"
    ? "Conta pausada. Reative em Anúncios para a coleta voltar."
    : plataforma.estado === "ligada"
      ? "Ligada, sem campanha cadastrada. Os números aparecem quando a primeira subir."
      : plataforma.estado === "ativa"
        ? "Campanha no ar, sem números coletados ainda."
        : "Ainda não configurada para este cliente. Conecte a conta em Anúncios.";
  return (
    <EstadoVazio
      compacto
      titulo={plataforma.rotulo}
      descricao={frase}
      acao={
        <Link to="/anuncios" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")}>
          <Settings2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {plataforma.estado === "nao-configurada" ? "Configurar" : "Abrir Anúncios"}
        </Link>
      }
    />
  );
}
