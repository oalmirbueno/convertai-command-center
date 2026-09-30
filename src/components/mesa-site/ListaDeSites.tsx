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
import { rotuloDoTipo, TIPOS_DE_SITE } from "../../../supabase/functions/_shared/site-biblioteca";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CHAVES, chamarSite, type LinhaDoSite, useSites } from "./siteApi";

const rotuloDaEtapa = (e: string) => (ETAPAS_DO_SITE.find((x) => x.valor === e) || { rotulo: e }).rotulo;

/**
 * Nome do site novo já preenchido (UXS 30/09): "Site <nome>" no institucional
 * e "<tipo> <nome>" nos outros; com o mesmo nome já usado (vivo ou
 * arquivado), soma " 2", " 3"...
 */
export function nomePadraoDoSite(tipo: string, dono: string, usados: string[]): string {
  const quem = (dono || "").trim();
  const base = (tipo === "institucional" ? `Site${quem ? ` ${quem}` : ""}` : `${rotuloDoTipo(tipo)}${quem ? ` ${quem}` : ""}`).slice(0, 110);
  const tem = (n: string) => usados.some((u) => u.trim().toLowerCase() === n.toLowerCase());
  if (!tem(base)) return base;
  for (let i = 2; i < 100; i += 1) if (!tem(`${base} ${i}`)) return `${base} ${i}`;
  return base;
}

/** Os sites do cliente (da marca aberta) e o "Novo site". Arquivar nunca apaga. */
export default function ListaDeSites({ marcaId, marcaNome, onAbrir, icone }: { marcaId: string | null; /** Nome da marca aberta quando o cliente tem mais de uma. */ marcaNome?: string | null; onAbrir: (id: string, etapa?: string) => void; icone?: ReactNode }) {
  const { clientId, clientName } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const sitesQ = useSites(clientId, marcaId);
  // Só o que a pessoa digitou; sem isso, o nome sai do tipo e da marca (troca junto, sem efeito e sem piscar).
  const [nomeDigitado, setNomeDigitado] = useState<string | null>(null);
  const [tipo, setTipo] = useState<string>("institucional");
  const [criando, setCriando] = useState(false);
  const todos = sitesQ.data ? sitesQ.data.lista : [];
  const vivos = todos.filter((s) => !s.arquivado_em);
  const arquivados = todos.filter((s) => !!s.arquivado_em);
  const nome = nomeDigitado !== null ? nomeDigitado : nomePadraoDoSite(tipo, marcaNome || clientName || "", todos.map((s) => s.nome));

  const criar = async () => {
    const n = nome.trim();
    if (!n || criando) return;
    setCriando(true);
    try {
      const d = await chamarSite<{ site: LinhaDoSite }>("site_criar", { client_id: clientId, nome: n, tipo, marca_id: marcaId || undefined });
      setNomeDigitado(null);
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
            {s.tipo ? `${rotuloDoTipo(s.tipo)} · ` : ""}
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
        ajuda="Cada site é um projeto de código do cliente (na marca aberta), construído pelo motor de código com prévia ao vivo. O tipo (institucional, landing de campanha, portfólio, loja simples ou link na bio) dá o mapa inicial de páginas e seções; dá para trocar na Direção. Arquivar guarda o site e o código; nada é apagado."
        recolher={false}
      >
        {/* UXS 30/09: uma linha só (Tipo, Nome já preenchido e Novo site); no celular, Tipo em cima e Nome e botão embaixo. Espaço por margem (Safari 11). */}
        <form
          className="flex min-w-0 flex-wrap items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void criar();
          }}
          data-novo-site=""
        >
          <div className="mb-2 mr-2 w-full min-w-0 sm:w-auto sm:shrink-0">
            <SeletorCompacto rotulo="Tipo do site novo" modo="lista" opcoes={TIPOS_DE_SITE.map((t) => ({ valor: t.id, rotulo: t.rotulo, descricao: t.descricao }))} valor={tipo} onEscolher={setTipo} />
          </div>
          <div className="mb-2 flex min-w-0 flex-1 items-center">
            <input
              value={nome}
              onChange={(e) => setNomeDigitado(e.target.value)}
              onFocus={(e) => e.target.select()}
              maxLength={120}
              placeholder="Nome do site"
              className={juntar(campo, "mr-2 min-w-0 flex-1")}
              aria-label="Nome do novo site"
            />
            <button type="submit" className={juntar(botao.primario, "shrink-0")} disabled={!nome.trim() || criando}>
              {criando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : icone ? <span className="mr-1 inline-flex">{icone}</span> : null}
              Novo site
            </button>
          </div>
        </form>
        {sitesQ.data && sitesQ.data.aviso && <p className={texto.auxiliar}>{sitesQ.data.aviso}</p>}
        {!vivos.length && !sitesQ.isLoading && <EstadoVazio compacto icone={<Globe className="h-5 w-5" />} titulo="Nenhum site ainda." descricao="Escolha o tipo e comece pelo briefing." />}
        {vivos.length > 0 && <ul className={juntar(lista.aberta, lista.divisoria)}>{vivos.map(linha)}</ul>}
      </Secao>
      {arquivados.length > 0 && (
        <Secao
          titulo="Arquivados"
          descricao={`${arquivados.length}`}
          recolher="mesa-site:sites:arquivados"
          recolhidaDeInicio
        >
          <ul className={juntar(lista.aberta, lista.divisoria)}>{arquivados.map(linha)}</ul>
        </Secao>
      )}
    </div>
  );
}
