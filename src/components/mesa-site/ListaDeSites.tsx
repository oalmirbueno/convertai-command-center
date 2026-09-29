import { useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Globe, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import MenuMais from "@/components/sistema/MenuMais";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataCurta } from "@/lib/mesa/api";
import { ETAPAS_DO_SITE } from "../../../supabase/functions/_shared/site-metodo";
import { CHAVES, chamarSite, type LinhaDoSite, useSites } from "./siteApi";

const rotuloDaEtapa = (e: string) => (ETAPAS_DO_SITE.find((x) => x.valor === e) || { rotulo: e }).rotulo;

/** Os sites do cliente (da marca aberta) e o "Novo site". Arquivar nunca apaga. */
export default function ListaDeSites({ marcaId, onAbrir, icone }: { marcaId: string | null; onAbrir: (id: string, etapa?: string) => void; icone?: ReactNode }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const sitesQ = useSites(clientId, marcaId);
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [verArquivados, setVerArquivados] = useState(false);
  const todos = sitesQ.data ? sitesQ.data.lista : [];
  const vivos = todos.filter((s) => !s.arquivado_em);
  const arquivados = todos.filter((s) => !!s.arquivado_em);

  const criar = async () => {
    const n = nome.trim();
    if (!n || criando) return;
    setCriando(true);
    try {
      const d = await chamarSite<{ site: LinhaDoSite }>("site_criar", { client_id: clientId, nome: n, marca_id: marcaId || undefined });
      setNome("");
      void qc.invalidateQueries({ queryKey: CHAVES.sites(clientId, marcaId) });
      onAbrir(d.site.id, "briefing");
    } catch (e) {
      avisarErro(e, "O site não foi criado");
    } finally {
      setCriando(false);
    }
  };

  const arquivar = async (s: LinhaDoSite, arquivar: boolean) => {
    try {
      await chamarSite("site_arquivar", { site_id: s.id, arquivar });
      void qc.invalidateQueries({ queryKey: CHAVES.sites(clientId, marcaId) });
    } catch (e) {
      avisarErro(e, arquivar ? "Não foi possível arquivar" : "Não foi possível desarquivar");
    }
  };

  const linha = (s: LinhaDoSite) => (
    <li key={s.id} className={lista.linha} data-site={s.id}>
      <button type="button" className="mr-2 flex min-w-0 flex-1 items-center text-left" onClick={() => onAbrir(s.id, s.etapa)}>
        <Globe className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate font-medium")}>{s.nome}</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>
            {rotuloDaEtapa(s.etapa)} · {dataCurta(s.atualizado_em)}
          </span>
        </span>
      </button>
      <MenuMais
        rotulo={`Mais ações de ${s.nome}`}
        itens={[
          s.arquivado_em
            ? { rotulo: "Desarquivar", icone: <ArchiveRestore className="h-4 w-4" />, aoEscolher: () => void arquivar(s, false) }
            : { rotulo: "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => void arquivar(s, true), perigo: true },
        ]}
      />
    </li>
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[880px] space-y-6 pt-2" data-lista-de-sites="">
      <Secao
        titulo="Sites"
        descricao={sitesQ.data && sitesQ.data.indisponivel ? "Banco sem a Mesa Site" : `${vivos.length} ${vivos.length === 1 ? "site" : "sites"}`}
        ajuda="Cada site é um projeto de código do cliente (na marca aberta), construído pelo motor de código com prévia ao vivo. Arquivar guarda o site e o código; nada é apagado."
        recolher={false}
      >
        <form
          className="flex min-w-0 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void criar();
          }}
        >
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Nome do site (ex.: Site institucional)" className={juntar(campo, "mr-2 flex-1")} aria-label="Nome do novo site" />
          <button type="submit" className={botao.primario} disabled={!nome.trim() || criando}>
            {criando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : icone}
            Novo site
          </button>
        </form>
        {sitesQ.data && sitesQ.data.aviso && <p className={texto.auxiliar}>{sitesQ.data.aviso}</p>}
        {!vivos.length && !sitesQ.isLoading && <EstadoVazio compacto icone={<Globe className="h-5 w-5" />} titulo="Nenhum site ainda." descricao="Dê um nome e comece pelo briefing." />}
        {vivos.length > 0 && <ul className={juntar(lista.aberta, lista.divisoria)}>{vivos.map(linha)}</ul>}
      </Secao>
      {arquivados.length > 0 && (
        <Secao
          titulo="Arquivados"
          descricao={`${arquivados.length}`}
          recolher="mesa-site:sites:arquivados"
          recolhidaDeInicio={!verArquivados}
          acao={
            <button type="button" className={botao.discreto} onClick={() => setVerArquivados(!verArquivados)}>
              {verArquivados ? "Esconder" : "Ver"}
            </button>
          }
        >
          <ul className={juntar(lista.aberta, lista.divisoria)}>{arquivados.map(linha)}</ul>
        </Secao>
      )}
    </div>
  );
}
