/**
 * Revisão de UX do build (frente UXM, 30/09/2026): as regras da base UI UX
 * Pro Max conferidas por código no HTML pré-renderizado e no CSS do dist
 * (revisarUx, puro, em _shared/uiux/revisao-ux.ts) e a prova que o agente do
 * motor deixou em .aceleriq/ux/<seção>.json (regras que pedem o layout vivo).
 * É aviso: nada trava a publicação.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AvisoDeUx, lerTokensDoCss, type ProvaDoAgente, revisarUx } from "../../../supabase/functions/_shared/uiux/revisao-ux.ts";

const MAX_CSS = 2_000_000;

/** O CSS do build (dist/assets/*.css juntos, até 2 MB). */
export function cssDoBuild(pasta: string): string {
  const assets = join(pasta, "dist", "assets");
  if (!existsSync(assets)) return "";
  let css = "";
  for (const nome of readdirSync(assets).filter((n) => /\.css$/i.test(n)).sort()) {
    if (css.length > MAX_CSS) break;
    css += `${readFileSync(join(assets, nome), "utf8")}\n`;
  }
  return css.slice(0, MAX_CSS);
}

/** As provas do agente (.aceleriq/ux/*.json): regra conferida ou pendente, por seção. Arquivo quebrado é ignorado. */
export function provasDoAgente(pasta: string): ProvaDoAgente[] {
  const dir = join(pasta, ".aceleriq", "ux");
  if (!existsSync(dir)) return [];
  const saida: ProvaDoAgente[] = [];
  for (const nome of readdirSync(dir).filter((n) => /^[a-z0-9_-]{1,60}\.json$/i.test(n)).slice(0, 60)) {
    try {
      const o = JSON.parse(readFileSync(join(dir, nome), "utf8")) as { conferidas?: unknown; pendentes?: unknown };
      const conferidas = (Array.isArray(o.conferidas) ? o.conferidas : []).map((x) => String(x)).filter((x) => /^uupm:ux:\d{1,3}$/.test(x)).slice(0, 120);
      const pendentes = (Array.isArray(o.pendentes) ? o.pendentes : [])
        .map((x) => (x && typeof x === "object" ? (x as { regra?: unknown; motivo?: unknown }) : {}))
        .filter((x) => typeof x.regra === "string" && /^uupm:ux:\d{1,3}$/.test(x.regra))
        .map((x) => ({ regra: String(x.regra), motivo: String(x.motivo == null ? "" : x.motivo).slice(0, 240) }))
        .slice(0, 60);
      saida.push({ secao: nome.replace(/\.json$/i, ""), conferidas, pendentes });
    } catch {
      // Prova ilegível não vira prova (o checklist mostra a regra como pendente).
    }
  }
  return saida;
}

export function revisaoDeUx(pasta: string, html: string): { avisos: AvisoDeUx[]; agente: ProvaDoAgente[] } {
  const marca = join(pasta, "src", "marca.css");
  const tokens = existsSync(marca) ? lerTokensDoCss(readFileSync(marca, "utf8")) : {};
  return { avisos: revisarUx(html, cssDoBuild(pasta), tokens), agente: provasDoAgente(pasta) };
}
