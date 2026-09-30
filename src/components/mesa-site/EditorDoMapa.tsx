import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import {
  adicionarSecaoNoMapa,
  BIBLIOTECA_DE_SECOES,
  MAX_PAGINAS,
  mapaDoSite,
  mapaPadrao,
  type MapaDoSite,
  normalizarMapa,
  removerSecaoDoMapa,
  ROTULO_DA_CATEGORIA,
  secaoDaBiblioteca,
  secoesDoMapa,
  TIPOS_DE_SITE,
  trocarSecaoNoMapa,
  type TipoDeSite,
  ehTipoDeSite,
} from "../../../supabase/functions/_shared/site-biblioteca";
import { chamarSite, type LinhaDoSite, useSalvarSite } from "./siteApi";

const OPCOES_DA_BIBLIOTECA = BIBLIOTECA_DE_SECOES.filter((s) => !s.global);
/** Jev: ~3 mil tokens a US$ 0,042 por milhão (mesma conta do servidor). */
export const CUSTO_DO_JEV = 0.00013;

/** Seletor da biblioteca, agrupado por categoria (nomes do mercado). */
function SeletorDaBiblioteca({ valor, onEscolher, rotulo }: { valor: string; onEscolher: (tipo: string) => void; rotulo: string }) {
  const categorias = Object.keys(ROTULO_DA_CATEGORIA).filter((c) => OPCOES_DA_BIBLIOTECA.some((s) => s.categoria === c));
  return (
    <select value={valor} onChange={(e) => e.target.value && onEscolher(e.target.value)} className={juntar(campo, "h-8 w-auto max-w-[220px] text-[12px]")} aria-label={rotulo}>
      <option value="">{rotulo}</option>
      {categorias.map((c) => (
        <optgroup key={c} label={ROTULO_DA_CATEGORIA[c as keyof typeof ROTULO_DA_CATEGORIA]}>
          {OPCOES_DA_BIBLIOTECA.filter((s) => s.categoria === c).map((s) => (
            <option key={s.id} value={s.id} title={s.descricao}>
              {s.rotulo}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Tipo de site e mapa (SIT2): páginas e seções da biblioteca, editáveis
 * (subir, descer, trocar, tirar, acrescentar, página nova). "Montar com o
 * Jev" propõe o mapa pelo briefing (Noul por seção opcional) e fica como
 * prévia até Salvar. Salvar grava a versão anterior.
 */
export default function EditorDoMapa({ site }: { site: LinhaDoSite }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const salvo = useMemo(() => mapaDoSite(site), [site]);
  const [mapa, setMapa] = useState<MapaDoSite>(salvo);
  const [previa, setPrevia] = useState<{ incluidas: Array<{ id: string; prob: number }>; custo: number; aviso: string | null } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    setMapa(mapaDoSite(site));
    setPrevia(null);
    // Ao abrir outro site ou quando o mapa salvo muda (o diretor de site também muda o mapa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(site.mapa || null), site.tipo]);

  const mudou = JSON.stringify(normalizarMapa(mapa, mapa.tipo)) !== JSON.stringify(normalizarMapa(salvo, salvo.tipo)) || !site.mapa || !Array.isArray((site.mapa as any).paginas);
  const total = secoesDoMapa(mapa).length;

  const trocarTipo = (tipo: string) => {
    if (!ehTipoDeSite(tipo)) return;
    setMapa(mapaPadrao(tipo as TipoDeSite));
    setPrevia(null);
  };

  const mover = (paginaId: string, i: number, delta: number) =>
    setMapa((m) => ({
      ...m,
      fonte: "manual",
      paginas: m.paginas.map((p) => {
        if (p.id !== paginaId) return p;
        const j = i + delta;
        if (j < 0 || j >= p.secoes.length) return p;
        const secoes = p.secoes.slice();
        const x = secoes[i];
        secoes[i] = secoes[j];
        secoes[j] = x;
        return { ...p, secoes };
      }),
    }));

  const renomear = (paginaId: string, titulo: string) => setMapa((m) => ({ ...m, fonte: "manual", paginas: m.paginas.map((p) => (p.id === paginaId ? { ...p, titulo: titulo.slice(0, 40) } : p)) }));

  const novaPagina = () =>
    setMapa((m) => (m.paginas.length >= MAX_PAGINAS ? m : normalizarMapa({ ...m, paginas: [...m.paginas, { id: `pagina_${m.paginas.length + 1}`, slug: `pagina-${m.paginas.length + 1}`, titulo: `Página ${m.paginas.length + 1}`, secoes: [] }] }, m.tipo)));

  const tirarPagina = (paginaId: string) => setMapa((m) => ({ ...m, fonte: "manual", paginas: m.paginas.filter((p, i) => i === 0 || p.id !== paginaId) }));

  const alternarGlobal = (id: string) => setMapa((m) => ({ ...m, fonte: "manual", globais: m.globais.indexOf(id) >= 0 ? m.globais.filter((g) => g !== id) : ["topo", "rodape"].filter((g) => g === id || m.globais.indexOf(g) >= 0) }));

  const montarComJev = async () => {
    setOcupado("jev");
    try {
      const d = await chamarSite<{ mapa: MapaDoSite; incluidas: Array<{ id: string; prob: number }>; aviso: string | null; custo_usd: number }>("mapa_gerar", { site_id: site.id, tipo: mapa.tipo });
      setMapa(d.mapa);
      setPrevia({ incluidas: d.incluidas || [], custo: d.custo_usd || 0, aviso: d.aviso });
    } catch (e) {
      avisarErro(e, "O mapa não foi montado");
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async () => {
    setOcupado("salvar");
    try {
      await salvarSite("mapa_salvar", { site_id: site.id, tipo: mapa.tipo, mapa });
      setPrevia(null);
    } catch (e) {
      avisarErro(e, "O mapa não foi salvo");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Secao
      titulo="Tipo e mapa do site"
      descricao={`${mapa.paginas.length} página(s) · ${total} seção(ões)${mudou ? " · não salvo" : ""}`}
      ajuda="O tipo de site dá o mapa padrão (páginas e seções). A biblioteca usa os nomes do mercado: hero cinematográfico, bento, prova social, pricing, FAQ, CTA final, galeria antes e depois, contato com mapa. Montar com o Jev lê o briefing e o contexto e acrescenta as seções que o negócio pede (as de prova só com dado real). É prévia até você salvar; salvar guarda a versão anterior."
      recolher="mesa-site:direcao:mapa"
      acao={
        <>
          <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={!!ocupado} onClick={() => void montarComJev()} title={`Custo do Jev: ~${usd(CUSTO_DO_JEV)}`} data-montar-mapa="">
            {ocupado === "jev" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            Montar com o Jev
          </button>
          <button type="button" className={botao.primario} disabled={!!ocupado || !mudou || !total} onClick={() => void salvar()} data-salvar-mapa="">
            {ocupado === "salvar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Salvar o mapa
          </button>
        </>
      }
    >
      <SeletorCompacto rotulo="Tipo de site" opcoes={TIPOS_DE_SITE.map((t) => ({ valor: t.id, rotulo: t.rotulo, descricao: t.descricao }))} valor={mapa.tipo} onEscolher={trocarTipo} listaQuandoNaoCabe />
      {previa && (
        <p className={juntar(texto.auxiliar, "whitespace-normal")} data-previa-do-mapa="">
          {previa.aviso ||
            `Prévia do Jev${previa.incluidas.length ? `: entraram ${previa.incluidas.map((x) => `${(secaoDaBiblioteca(x.id) || { rotulo: x.id }).rotulo} ${Math.round(x.prob * 100)}%`).join(", ")}` : ": o padrão do tipo já cobre o briefing"}. Custo ${usd(previa.custo)}.`}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center">
        <span className={juntar(texto.rotulo, "mr-3")}>Em todas as páginas</span>
        {["topo", "rodape"].map((g) => (
          <label key={g} className="mr-4 flex cursor-pointer items-center py-1 text-[13px]">
            <input type="checkbox" className="mr-2" checked={mapa.globais.indexOf(g) >= 0} onChange={() => alternarGlobal(g)} />
            {(secaoDaBiblioteca(g) || { rotulo: g }).rotulo}
          </label>
        ))}
      </div>
      {mapa.paginas.map((p, pi) => (
        <div key={p.id} className="min-w-0 border-t border-border pt-3" data-pagina-do-mapa={p.id}>
          <div className="mb-1 flex min-w-0 items-center">
            <input value={p.titulo} onChange={(e) => renomear(p.id, e.target.value)} className={juntar(campo, "mr-2 h-8 w-40 font-medium")} aria-label={`Nome da página ${pi + 1}`} />
            <span className={juntar(texto.auxiliar, "mr-2 min-w-0 flex-1 truncate")}>{p.slug ? `/${p.slug}/` : "página inicial"}</span>
            <SeletorDaBiblioteca rotulo="Acrescentar seção" valor="" onEscolher={(tipo) => setMapa((m) => adicionarSecaoNoMapa(m, p.id, tipo))} />
            {pi > 0 && (
              <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Tirar a página ${p.titulo}`} title="Tirar a página" onClick={() => tirarPagina(p.id)}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {!p.secoes.length && <p className={texto.auxiliar}>Página sem seção: acrescente pela biblioteca.</p>}
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {p.secoes.map((s, i) => {
              const lib = secaoDaBiblioteca(s.tipo);
              return (
                <li key={s.uid} className={lista.linha} data-secao-do-mapa={s.uid}>
                  <span className={juntar(texto.auxiliar, "mr-2 w-5 shrink-0 tabular-nums")}>{i + 1}</span>
                  <span className="mr-2 min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")} title={lib ? lib.descricao : undefined}>
                      {lib ? lib.rotulo : s.tipo}
                    </span>
                  </span>
                  {lib && lib.so_real && <span className={juntar(etiqueta, "mr-2 bg-muted")}>só real</span>}
                  <SeletorDaBiblioteca rotulo="Trocar por" valor="" onEscolher={(tipo) => setMapa((m) => trocarSecaoNoMapa(m, s.uid, tipo))} />
                  <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Subir ${lib ? lib.rotulo : s.tipo}`} disabled={i === 0} onClick={() => mover(p.id, i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className={botao.icone} aria-label={`Descer ${lib ? lib.rotulo : s.tipo}`} disabled={i === p.secoes.length - 1} onClick={() => mover(p.id, i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" className={botao.icone} aria-label={`Tirar ${lib ? lib.rotulo : s.tipo}`} onClick={() => setMapa((m) => removerSecaoDoMapa(m, s.uid))}>
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {mapa.paginas.length < MAX_PAGINAS && mapa.tipo !== "bio" && mapa.tipo !== "landing" && (
        <button type="button" className={botao.discreto} onClick={novaPagina}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Nova página
        </button>
      )}
    </Secao>
  );
}
