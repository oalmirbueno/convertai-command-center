import { Link } from "react-router-dom";
import { Settings2 } from "lucide-react";
import type { PlataformaAds, PlataformaResumo } from "@/lib/esteira/esteiraTipos";

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

/** Seletor de plataforma no topo da aba Trafego: Meta, Google, TikTok. */
export default function TrafegoPlataformas({ plataformas, selecionada, onSelecionar }: Props) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-1.5" role="tablist" aria-label="Plataforma de anúncio">
      {plataformas.map((p) => {
        const ativo = p.key === selecionada;
        const e = ESTADO[p.estado];
        return (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={ativo}
            onClick={() => onSelecionar(p.key)}
            className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${ativo ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"} ${p.estado === "nao-configurada" && !ativo ? "opacity-70" : ""}`}
          >
            <p className={`flex items-center gap-1.5 text-[12.5px] font-semibold leading-tight ${ativo ? "text-primary" : "text-foreground"}`}>
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${e.ponto}`} aria-hidden />
              {p.rotulo}
            </p>
            <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{e.texto(p)}</p>
          </button>
        );
      })}
    </div>
  );
}

/** Painel para plataforma sem conta: diz o que falta e leva para configurar. */
export function PlataformaNaoConfigurada({ plataforma }: { plataforma: PlataformaResumo }) {
  const frase = plataforma.estado === "pausada"
    ? `A conta de ${plataforma.rotulo} deste cliente está pausada. Reative em Anúncios para a coleta voltar.`
    : plataforma.estado === "ligada"
      ? `${plataforma.rotulo} está ligado, mas ainda não há campanha cadastrada. Quando a primeira subir, os números aparecem aqui.`
      : `${plataforma.rotulo} ainda não está configurado para este cliente. Conecte a conta em Anúncios para a coleta começar.`;
  return (
    <section className="mt-3 rounded-2xl border border-dashed border-border bg-secondary/30 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{plataforma.rotulo}</p>
      <p className="mt-1 text-[13px] leading-snug text-foreground">{frase}</p>
      <Link to="/anuncios" className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-foreground hover:border-primary/50">
        <Settings2 className="h-3.5 w-3.5" />{plataforma.estado === "nao-configurada" ? "Configurar em Anúncios" : "Abrir Anúncios"}
      </Link>
    </section>
  );
}
