import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, juntar } from "@/components/sistema/estilos";
import { MODELOS_PRONTOS, type ModeloPronto } from "../../../supabase/functions/mesa-site/modulos/modelos-prontos";
import { CHAVES, chamarSite, type LinhaDoSite, useSites } from "./siteApi";
import GaleriaDeSitesProntos from "./GaleriaDeSitesProntos";
import { nomePadraoDoSite } from "./ListaDeSites";

/** O pedido que cria o site a partir de um site pronto: objetivo do modelo e a partida "modelo_pronto". */
export function jornadaDoPronto(m: Pick<ModeloPronto, "id" | "objetivo">, siteId: string) {
  return { site_id: siteId, objetivo: m.objetivo[0], partida: { tipo: "modelo_pronto" as const, modelo_id: m.id } };
}

/**
 * Biblioteca dos sites prontos na tela inicial da Mesa Site (25/10/2026, dono:
 * "não aparece a biblioteca de referências reais para usar"). A mesma galeria
 * do passo Partida, com a miniatura real, o objetivo, a licença e a prévia.
 * "Usar este site" cria um site novo na marca aberta, grava o objetivo do
 * modelo e a partida "modelo_pronto" e abre na jornada (Conferir).
 */
export default function BibliotecaDeSitesProntos({ marcaId, marcaNome, onAbrir }: { marcaId: string | null; marcaNome?: string | null; onAbrir: (id: string, etapa?: string) => void }) {
  const { clientId, clientName } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const sitesQ = useSites(clientId, marcaId);
  const [usando, setUsando] = useState<string | null>(null);

  const usar = async (m: ModeloPronto) => {
    if (usando) return;
    setUsando(m.id);
    let criado: LinhaDoSite | null = null;
    try {
      const nomes = sitesQ.data ? sitesQ.data.lista.map((s) => s.nome) : [];
      const d = await chamarSite<{ site: LinhaDoSite }>("site_criar", { client_id: clientId, nome: nomePadraoDoSite(m.tipo_sugerido, marcaNome || clientName || "", nomes), tipo: m.tipo_sugerido, marca_id: marcaId || undefined });
      criado = d.site;
      await chamarSite("jornada_salvar", jornadaDoPronto(m, criado.id));
      await qc.invalidateQueries({ queryKey: CHAVES.sites(clientId, marcaId) });
      onAbrir(criado.id, "conferir");
    } catch (e) {
      avisarErro(e, criado ? "O site foi criado, mas a partida não foi salva" : "O site não foi criado");
      if (criado) {
        void qc.invalidateQueries({ queryKey: CHAVES.sites(clientId, marcaId) });
        onAbrir(criado.id, "partida");
      }
    } finally {
      setUsando(null);
    }
  };

  return (
    <Secao
      titulo="Sites prontos"
      descricao={`${MODELOS_PRONTOS.length} sites`}
      ajuda="Sites reais de código aberto (licença MIT), a mesma galeria do passo Partida. Usar este site cria um site novo na marca aberta, já com o objetivo do modelo e a partida no site pronto, e abre para conferir os dados do cliente. O motor reaproveita a estrutura e o estilo; texto, fotos, cores e logo são sempre do cliente."
      recolher="mesa-site:sites:prontos"
      data-biblioteca-de-prontos=""
    >
      <GaleriaDeSitesProntos
        modelos={MODELOS_PRONTOS.slice()}
        acao={(m) => (
          <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void usar(m)} disabled={!!usando} title={`Criar um site a partir de ${m.nome}`} data-usar-pronto={m.id}>
            {usando === m.id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Usar este site
          </button>
        )}
      />
    </Secao>
  );
}
