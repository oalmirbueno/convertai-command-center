import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate, Loader2, Upload } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { rotuloDoTipo, secaoDaBiblioteca } from "../../../supabase/functions/_shared/site-biblioteca";
import { esqueletoDoModelo, MODELOS_DE_PAGINA, nomeDoSiteDoModelo, type ModeloDePagina } from "../../../supabase/functions/mesa-site/modulos/modelos-de-pagina";
import { CHAVES, chamarSite, type LinhaDoSite, useSites } from "./siteApi";

const ImportarSite = lazy(() => import("./ImportarSite"));

/** Altura da faixa de cada seção no desenho do modelo (o hero é maior). */
const alturaDaFaixa = (tipo: string) => (tipo === "hero" || tipo === "hero_dividido" ? "h-6" : tipo === "topo" || tipo === "rodape" ? "h-1.5" : "h-3");

function Esqueleto({ m }: { m: ModeloDePagina }) {
  return (
    <div className="flex h-[112px] min-w-0 flex-col justify-start overflow-hidden rounded-md bg-muted/50 p-2" aria-hidden="true">
      {esqueletoDoModelo(m).map((s, i) => (
        <span key={`${s.tipo}-${i}`} className={juntar("mb-1 block w-full shrink-0 rounded-sm", alturaDaFaixa(s.tipo), s.tipo === "hero" || s.tipo === "hero_dividido" ? "bg-primary/25" : "bg-muted-foreground/15")} />
      ))}
    </div>
  );
}

/**
 * Galeria de modelos de página e Importar site (Gravyx, 19/10/2026), embaixo
 * da lista de sites. "Usar modelo" cria um site novo com o mapa, o estilo e o
 * objetivo do modelo e a marca aberta (cores, fontes, logo e contexto), e
 * abre no Briefing. Importar (ícone) traz um site que já existe.
 */
export default function GaleriaDeModelos({ marcaId, marcaNome, onAbrir }: { marcaId: string | null; marcaNome?: string | null; onAbrir: (id: string, etapa?: string) => void }) {
  const { clientId, clientName } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const sitesQ = useSites(clientId, marcaId);
  const [usando, setUsando] = useState<string | null>(null);
  const [importar, setImportar] = useState(false);
  const [importarUsado, setImportarUsado] = useState(false);

  const usar = async (m: ModeloDePagina) => {
    if (usando) return;
    setUsando(m.id);
    try {
      const nomes = sitesQ.data ? sitesQ.data.lista.map((s) => s.nome) : [];
      const d = await chamarSite<{ site: LinhaDoSite }>("site_do_modelo", { client_id: clientId, marca_id: marcaId || undefined, modelo: m.id, nome: nomeDoSiteDoModelo(m, marcaNome || clientName || "", nomes) });
      void qc.invalidateQueries({ queryKey: CHAVES.sites(clientId, marcaId) });
      onAbrir(d.site.id, "briefing");
    } catch (e) {
      avisarErro(e, "O site do modelo não foi criado");
    } finally {
      setUsando(null);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-[880px] pt-6" data-galeria-de-modelos="">
      <Secao
        titulo="Modelos de página"
        descricao={`${MODELOS_DE_PAGINA.length} modelos`}
        ajuda="Cada modelo traz o mapa de seções, o estilo de partida e o objetivo da página. Usar modelo cria um site novo com a marca aberta (cores, fontes, logo e contexto dela, nunca de outra) e abre no Briefing; o motor constrói pelo método da casa. Pixel, Analytics e WhatsApp vêm das Integrações do cliente. O ícone de importar traz um site que já existe (zip, pasta ou HTML)."
        recolher="mesa-site:sites:modelos"
        acao={
          <button
            type="button"
            className={botao.icone}
            aria-label="Importar site existente"
            title="Importar site existente (zip, pasta ou HTML)"
            onClick={() => {
              setImportarUsado(true);
              setImportar(true);
            }}
            data-abrir-importacao=""
          >
            <Upload className="h-4 w-4" />
          </button>
        }
      >
        <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-modelos="">
          {MODELOS_DE_PAGINA.map((m) => (
            <li key={m.id} className="flex min-w-0 flex-col" data-modelo={m.id}>
              <Esqueleto m={m} />
              <p className={juntar(texto.corpo, "mt-2 truncate font-medium")}>{m.nome}</p>
              <p className={juntar(texto.auxiliar, "truncate")} title={`${m.descricao}. Seções: ${esqueletoDoModelo(m).map((s) => (secaoDaBiblioteca(s.tipo) || { rotulo: s.tipo }).rotulo).join(", ")}`}>
                {`${rotuloDoTipo(m.tipo)} · ${m.descricao}`}
              </p>
              <button type="button" className={juntar(botao.secundario, "mt-2 h-8 self-start")} onClick={() => void usar(m)} disabled={!!usando} data-usar-modelo={m.id}>
                {usando === m.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <LayoutTemplate className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                Usar modelo
              </button>
            </li>
          ))}
        </ul>
      </Secao>
      {importarUsado && (
        <Suspense fallback={null}>
          <ImportarSite aberta={importar} onMudar={setImportar} marcaId={marcaId} onImportado={(id) => onAbrir(id, "construcao")} />
        </Suspense>
      )}
    </div>
  );
}
