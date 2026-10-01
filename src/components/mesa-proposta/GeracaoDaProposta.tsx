import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { campo, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import MaisOpcoes from "./MaisOpcoes";

/**
 * Os ajustes da geração da proposta (frente PRS, 30/09): de onde a IA lê, a
 * pesquisa de mercado na web, o site do cliente e o modelo de IA. Antes
 * ficavam abertos no topo do Rascunho (quatro caixas, o seletor e o site);
 * agora moram recolhidos em "Ajustes da IA", ao lado do botão que gera, com
 * uma linha de estado. As mesmas chaves de antes: a escolha de quem já usava
 * a mesa continua valendo.
 */

export type FonteDoRascunho = "reuniao" | "briefing" | "contexto" | "site";
export const FONTES_DO_RASCUNHO: Array<{ valor: FonteDoRascunho; rotulo: string; curto: string }> = [
  { valor: "reuniao", rotulo: "Conversa e arquivos", curto: "conversa" },
  { valor: "briefing", rotulo: "Briefing", curto: "briefing" },
  { valor: "contexto", rotulo: "Contexto do cliente", curto: "contexto" },
  { valor: "site", rotulo: "Site do cliente", curto: "site" },
];

export function useAjustesDaGeracao() {
  const mesa = useMesa();
  const [pesquisar, setPesquisar] = useEstadoDaTela<boolean>("mesa-proposta:pesquisar", true, { validar: (v) => typeof v === "boolean" });
  const [fontes, setFontes] = useEstadoDaTela<FonteDoRascunho[]>("mesa-proposta:fontes", ["reuniao", "briefing", "contexto"], { validar: (v) => Array.isArray(v) });
  const [site, setSite] = useEstadoDaTela<string>(`mesa-proposta:site:${mesa.clientId}`, "", { validar: (v) => typeof v === "string" });
  const comSite = fontes.indexOf("site") >= 0 && !!site.trim();
  const siteOk = !site.trim() || /^https?:\/\/\S+\.\S+/i.test(site.trim());
  /** O que vai no pedido de gerar (a mesma forma de antes). */
  const pedido = () => ({ pesquisar, fontes, site: comSite ? site.trim() : undefined });
  const buscasWeb = pesquisar || comSite ? 5 : 0;
  return { pesquisar, setPesquisar, fontes, setFontes, site, setSite, siteOk, pedido, buscasWeb, pronto: siteOk && fontes.length > 0 };
}

export type AjustesDaGeracao = ReturnType<typeof useAjustesDaGeracao>;

/** Linha "Ajustes da IA" (recolhida): modelo, fontes, web e site. */
export function AjustesDaIA({ ajustes, modeloId, onModelo, chave, children }: { ajustes: AjustesDaGeracao; modeloId: string; onModelo: (id: string) => void; chave: string; /** Outras formas de gerar (gravar sem prévia, só o mercado). */ children?: ReactNode }) {
  const mesa = useMesa();
  const modelo = mesa.catalogo.find((m) => m.id === modeloId);
  const lidas = FONTES_DO_RASCUNHO.filter((f) => ajustes.fontes.indexOf(f.valor) >= 0).map((f) => f.curto);
  const resumo = [modelo ? modelo.rotulo || modelo.modelo_api : "sem modelo", lidas.length ? `lê ${lidas.join(", ")}` : "sem fonte", ajustes.pesquisar ? "pesquisa na web" : ""].filter(Boolean).join(" · ");
  const alternar = (f: FonteDoRascunho, sim: boolean) => ajustes.setFontes(sim ? ajustes.fontes.concat([f]) : ajustes.fontes.filter((x) => x !== f));
  return (
    <MaisOpcoes chave={chave} rotulo="Ajustes da IA" resumo={resumo} abertoDeInicio={!ajustes.pronto}>
      {children}
      <div className="max-w-[320px]">
        <SeletorDeModelo catalogo={mesa.catalogo} tipo="texto" valor={modeloId} onChange={onModelo} rotulo="Modelo de IA" />
      </div>
      <div className="min-w-0" aria-label="De onde ler">
        <span className={texto.rotulo}>Ler de</span>
        <div className="mt-1 flex min-w-0 flex-wrap [&>*]:mb-1 [&>*]:mr-4">
          {FONTES_DO_RASCUNHO.map((f) => (
            <label key={f.valor} className={juntar(texto.corpo, "inline-flex items-center")}>
              <input type="checkbox" className="mr-2" checked={ajustes.fontes.indexOf(f.valor) >= 0} onChange={(e) => alternar(f.valor, e.target.checked)} />
              {f.rotulo}
            </label>
          ))}
          <label className={juntar(texto.corpo, "inline-flex items-center")}>
            <input type="checkbox" className="mr-2" checked={ajustes.pesquisar} onChange={(e) => ajustes.setPesquisar(e.target.checked)} />
            <Globe className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Pesquisa de mercado na web
          </label>
        </div>
        {!ajustes.fontes.length && <p className={juntar(texto.auxiliar, "text-warning")}>Marque ao menos uma fonte.</p>}
        {ajustes.fontes.indexOf("site") >= 0 && (
          <CampoDeFormulario rotulo="Site do cliente" erro={ajustes.siteOk ? undefined : "Comece com https://"} className="mt-2 max-w-[420px]">
            <input value={ajustes.site} onChange={(e) => ajustes.setSite(e.target.value)} className={campo} placeholder="https://" inputMode="url" />
          </CampoDeFormulario>
        )}
      </div>
    </MaisOpcoes>
  );
}
