import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useKitDaMesa } from "@/components/mesa/kitDaMesa";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { normalizarEstilo, PRESETS_DE_ESTILO, PRESETS_DE_MOTION, type PresetDeEstilo } from "../../../supabase/functions/_shared/site-biblioteca";
import { rotuloDoAtributo } from "../../../supabase/functions/_shared/site-metodo";
import { chamarSite, type LinhaDoSite, useSalvarSite } from "./siteApi";
import { CUSTO_DO_JEV } from "./EditorDoMapa";

const FONTE: Record<PresetDeEstilo["previa"]["titulo"], string> = {
  serifada: "Georgia, 'Times New Roman', serif",
  sans: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', monospace",
};

/** Cor de destaque da marca (a do papel primário, ou a primeira). */
function destaqueDaMarca(paleta: Array<{ hex?: string | null; papel?: string | null }> | null | undefined, reserva: string): string {
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

/**
 * Presets de estilo (DNA) com prévia e presets de movimento dentro do kit
 * livre (SIT2). Escolher o preset troca o DNA dele (atributos, movimento e
 * nível); nicho, cores e leitura das referências ficam. "Sugerir com o Jev"
 * escolhe numa lista fechada pela marca e pelas referências, sem gravar.
 */
export default function PresetsDeEstilo({ site }: { site: LinhaDoSite }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const kit = useKitDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const salvo = normalizarEstilo(site.estilo || {});
  const [preset, setPreset] = useState<string | null>(salvo.preset);
  const [motion, setMotion] = useState<string[]>(salvo.motion);
  const [sugerido, setSugerido] = useState<{ id: string | null; prob: number | null; custo: number } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const reserva = site.dna && Array.isArray(site.dna.cores_das_referencias) && site.dna.cores_das_referencias[0] ? String(site.dna.cores_das_referencias[0]) : "#00D52B";
  const destaque = destaqueDaMarca((kit.data && (kit.data as { paleta?: Array<{ hex?: string; papel?: string }> }).paleta) || (marca ? marca.paleta : null), reserva);
  const nome = (marca && marca.nome) || site.nome;

  useEffect(() => {
    const e = normalizarEstilo(site.estilo || {});
    setPreset(e.preset);
    setMotion(e.motion);
    // Ao abrir outro site ou quando o estilo salvo muda (o diretor de site também escolhe).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(site.estilo || null)]);

  const mudou = preset !== salvo.preset || motion.join(",") !== salvo.motion.join(",");

  const sugerir = async () => {
    setOcupado("jev");
    try {
      const d = await chamarSite<{ preset: string | null; probabilidades: Record<string, number>; aviso: string | null; custo_usd: number }>("preset_sugerir", { site_id: site.id });
      setSugerido({ id: d.preset, prob: d.preset && d.probabilidades ? d.probabilidades[d.preset] ?? null : null, custo: d.custo_usd || 0 });
      if (d.preset) setPreset(d.preset);
      if (d.aviso) avisarErro(new Error(d.aviso), "Sugestão do Jev");
    } catch (e) {
      avisarErro(e, "O Jev não sugeriu");
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async () => {
    setOcupado("salvar");
    try {
      await salvarSite("estilo_salvar", { site_id: site.id, preset, motion, aplicar_dna: true });
      setSugerido(null);
    } catch (e) {
      avisarErro(e, "O estilo não foi salvo");
    } finally {
      setOcupado(null);
    }
  };

  const alternarMotion = (id: string) => setMotion((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.length >= 3 ? l : l.concat([id])));
  const escolhido = PRESETS_DE_ESTILO.find((p) => p.id === preset) || null;

  return (
    <Secao
      titulo="Estilo"
      descricao={escolhido ? `${escolhido.rotulo}${mudou ? " · não salvo" : ""}` : "Sem preset"}
      ajuda="Onze estéticas nomeadas, com prévia na cor de destaque da marca. O preset troca o DNA (atributos, movimento e nível de referência); a paleta do site continua a da marca. Os presets de movimento usam só o kit livre (Motion, GSAP com ScrollTrigger e SplitText, Lenis e CSS) e respeitam o movimento reduzido. Até 3 presets de movimento."
      recolher="mesa-site:direcao:estilo"
      acao={
        <>
          <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!!ocupado} onClick={() => void sugerir()} title={`Custo do Jev: ~${usd(CUSTO_DO_JEV)}`} data-sugerir-preset="">
            {ocupado === "jev" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            Sugerir com o Jev
          </button>
          <button type="button" className={botao.primario} disabled={!!ocupado || !mudou} onClick={() => void salvar()} data-salvar-estilo="">
            {ocupado === "salvar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Salvar o estilo
          </button>
        </>
      }
    >
      {sugerido && (
        <p className={texto.auxiliar}>
          {sugerido.id ? `O Jev sugeriu ${(PRESETS_DE_ESTILO.find((p) => p.id === sugerido.id) || { rotulo: sugerido.id }).rotulo}${sugerido.prob !== null ? ` (${Math.round(sugerido.prob * 100)}%)` : ""}; salve para aplicar.` : "O Jev não escolheu."} Custo {usd(sugerido.custo)}.
        </p>
      )}
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label="Presets de estilo" data-presets-de-estilo="">
        {PRESETS_DE_ESTILO.map((p) => {
          const ligado = p.id === preset;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={ligado}
              onClick={() => setPreset(ligado ? null : p.id)}
              title={`${p.descricao}. DNA: ${p.atributos.map(rotuloDoAtributo).join(", ")}`}
              className={juntar("min-w-0 rounded-md p-1 text-left transition-colors", ligado ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-muted")}
              data-preset={p.id}
            >
              <PreviaDoPreset p={p} destaque={destaque} nome={nome} />
              <span className="mt-1.5 flex min-w-0 items-center px-1">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{p.rotulo}</span>
                {ligado ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> : <span className={juntar(etiqueta, "bg-muted")}>{p.modo}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="min-w-0 border-t border-border pt-3">
        <span className={juntar(texto.rotulo, "mb-1.5 block")}>Movimento (kit livre)</span>
        <div className="flex flex-wrap" role="group" aria-label="Presets de movimento">
          {PRESETS_DE_MOTION.map((m) => {
            const ligado = motion.indexOf(m.id) >= 0;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={ligado}
                title={`${m.descricao} (${m.pecas.join(", ")})`}
                onClick={() => alternarMotion(m.id)}
                className={juntar(etiqueta, "mb-2 mr-2 h-7 px-2.5 text-[12px]", ligado ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70")}
              >
                {m.rotulo}
              </button>
            );
          })}
        </div>
      </div>
    </Secao>
  );
}
