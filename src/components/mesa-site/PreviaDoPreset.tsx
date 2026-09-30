import type { CSSProperties } from "react";
import type { PresetDeEstilo } from "../../../supabase/functions/_shared/site-biblioteca";

const FONTE: Record<PresetDeEstilo["previa"]["titulo"], string> = {
  serifada: "Georgia, 'Times New Roman', serif",
  sans: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', monospace",
};

/** Cor de destaque da marca (a do papel primário, ou a primeira). */
export function destaqueDaMarca(paleta: Array<{ hex?: string | null; papel?: string | null }> | null | undefined, reserva: string): string {
  const cores = (paleta || []).filter((c) => typeof c.hex === "string" && /^#[0-9a-f]{6}$/i.test(String(c.hex)));
  const primaria = cores.find((c) => /prim|destaque/i.test(String(c.papel || "")));
  return String((primaria || cores[0] || { hex: reserva }).hex);
}

/**
 * Miniatura do preset: fundo, título e destaque da marca (a paleta do site é
 * sempre a da marca). Com `dna` (o DNA do estilo da base, UXM), a miniatura
 * mostra o que o estilo muda no site: fundo quase preto ou claro, título
 * serifado gigante ou pesado, blocos em grade bento, vidro, profundidade,
 * textura e luz. A cor de destaque continua a da marca.
 */
export function PreviaDoPreset({ p, destaque, nome, dna }: { p: PresetDeEstilo; destaque: string; nome: string; dna?: string[] | null }) {
  const v = p.previa;
  const tem = (id: string) => !!dna && dna.indexOf(id) >= 0;
  const escuro = tem("quase_preto");
  const claro = !escuro && tem("claro_editorial");
  const fundo = escuro ? "#0b0b0c" : claro ? "#fafaf7" : v.fundo;
  const cor = escuro ? "#f5f5f3" : claro ? "#111111" : v.texto;
  const camadas: string[] = [];
  if (tem("luz_dramatica")) camadas.push(`radial-gradient(circle at 80% 20%, ${escuro ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)"}, transparent 55%)`);
  if (tem("textura")) camadas.push("repeating-linear-gradient(45deg, rgba(127,127,127,0.10) 0, rgba(127,127,127,0.10) 1px, transparent 1px, transparent 6px)");
  const caixa: CSSProperties = { background: camadas.length ? `${camadas.join(", ")}, ${fundo}` : fundo, color: cor };
  const titulo: CSSProperties = {
    fontFamily: tem("serifada_gigante") ? FONTE.serifada : FONTE[v.titulo],
    fontWeight: tem("sans_pesada") ? 800 : v.peso,
    letterSpacing: v.titulo === "serifada" || tem("serifada_gigante") ? "-0.02em" : "-0.01em",
  };
  const apoio: CSSProperties = { background: v.apoio, borderRadius: v.raio };
  if (tem("vidro")) {
    apoio.background = escuro ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.55)";
    apoio.border = `1px solid ${escuro ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.10)"}`;
  }
  if (tem("profundidade") || tem("cena_3d")) apoio.boxShadow = "0 6px 14px rgba(0,0,0,0.28)";
  return (
    <div className="relative h-24 overflow-hidden rounded-md" style={caixa} aria-hidden="true" data-previa-dna={dna && dna.length ? dna.join(" ") : undefined}>
      <div className="absolute left-3 top-3 right-3">
        <div className="truncate text-[20px] leading-6" style={titulo}>
          {nome}
        </div>
        <div className="mt-1.5 h-1.5 w-3/4 rounded-sm" style={{ background: cor, opacity: 0.25 }} />
        {!tem("minimalista") && <div className="mt-1 h-1.5 w-1/2 rounded-sm" style={{ background: cor, opacity: 0.15 }} />}
      </div>
      <div className="absolute bottom-3 left-3 h-5 w-20" style={{ background: destaque, borderRadius: v.raio }} />
      {tem("bento") ? (
        <>
          <div className="absolute bottom-3 right-3 h-8 w-6" style={apoio} />
          <div className="absolute bottom-3 h-3.5 w-6" style={{ ...apoio, right: 42 }} />
          <div className="absolute h-3.5 w-6" style={{ ...apoio, right: 42, bottom: 30 }} />
        </>
      ) : (
        <div className="absolute bottom-3 right-3 h-8 w-14" style={apoio} />
      )}
    </div>
  );
}
