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

/** Miniatura do preset: fundo, título e destaque da marca (a paleta do site é sempre a da marca). */
export function PreviaDoPreset({ p, destaque, nome }: { p: PresetDeEstilo; destaque: string; nome: string }) {
  const v = p.previa;
  return (
    <div className="relative h-24 overflow-hidden rounded-md" style={{ background: v.fundo, color: v.texto }} aria-hidden="true">
      <div className="absolute left-3 top-3 right-3">
        <div className="truncate text-[20px] leading-6" style={{ fontFamily: FONTE[v.titulo], fontWeight: v.peso, letterSpacing: v.titulo === "serifada" ? "-0.02em" : "-0.01em" }}>
          {nome}
        </div>
        <div className="mt-1.5 h-1.5 w-3/4 rounded-sm" style={{ background: v.texto, opacity: 0.25 }} />
        <div className="mt-1 h-1.5 w-1/2 rounded-sm" style={{ background: v.texto, opacity: 0.15 }} />
      </div>
      <div className="absolute bottom-3 left-3 h-5 w-20" style={{ background: destaque, borderRadius: v.raio }} />
      <div className="absolute bottom-3 right-3 h-8 w-14" style={{ background: v.apoio, borderRadius: v.raio }} />
    </div>
  );
}
