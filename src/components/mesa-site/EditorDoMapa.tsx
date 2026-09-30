import { useEffect, useRef, useState, type SetStateAction } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import MenuMais from "@/components/sistema/MenuMais";
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
import { mapaDoPadrao, variantesDaSecao } from "../../../supabase/functions/_shared/site-variantes";
import { lerBaseDeDesign } from "../../../supabase/functions/_shared/uiux/consultas";
import { carregarBaseDaTela, CREDITO_DA_BASE } from "@/lib/uiux/carregar";
import { chamarSite, type LinhaDoSite } from "./siteApi";

const OPCOES_DA_BIBLIOTECA = BIBLIOTECA_DE_SECOES.filter((s) => !s.global);
/** Jev: ~3 mil tokens a US$ 0,042 por milhão (mesma conta do servidor). */
export const CUSTO_DO_JEV = 0.00013;

/**
 * Seletor da biblioteca, agrupado por categoria (nomes do mercado). UXS 30/09:
 * `curto` é o texto da primeira opção (no celular a lista nativa do sistema
 * abre com os grupos: mais rápido que um submenu de 50 itens).
 */
function SeletorDaBiblioteca({ valor, onEscolher, rotulo, curto, className }: { valor: string; onEscolher: (tipo: string) => void; rotulo: string; curto?: string; className?: string }) {
  const categorias = Object.keys(ROTULO_DA_CATEGORIA).filter((c) => OPCOES_DA_BIBLIOTECA.some((s) => s.categoria === c));
  return (
    <select value={valor} onChange={(e) => e.target.value && onEscolher(e.target.value)} className={juntar(campo, "h-8 w-auto max-w-[220px] text-[12px]", className)} aria-label={rotulo}>
      <option value="">{curto || rotulo}</option>
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

/** O mapa na tela difere do salvo? (site antigo sem mapa salvo conta como mudado: salvar o grava). */
export function mapaMudou(site: LinhaDoSite, mapa: MapaDoSite): boolean {
  const salvo = mapaDoSite(site);
  return JSON.stringify(normalizarMapa(mapa, mapa.tipo)) !== JSON.stringify(normalizarMapa(salvo, salvo.tipo)) || !site.mapa || !Array.isArray((site.mapa as any).paginas);
}

/**
 * Tipo de site e mapa (SIT2): páginas e seções da biblioteca, editáveis
 * (subir, descer, trocar, tirar, acrescentar, página nova). "Montar com o
 * Jev" propõe o mapa pelo briefing (Noul por seção opcional) e fica como
 * prévia até salvar. UXS 30/09: o mapa é da etapa Direção (valor e onMapa),
 * que grava mapa, estilo e direção juntos no Salvar e no Seguir da barra.
 * No celular, subir, descer e tirar vão para o "..." da linha; trocar o tipo
 * mostra "Mapa trocado · Desfazer".
 */
export default function EditorDoMapa({ site, mapa, onMapa }: { site: LinhaDoSite; mapa: MapaDoSite; onMapa: (m: MapaDoSite) => void }) {
  const avisarErro = useAvisarErro();
  const [previa, setPrevia] = useState<{ incluidas: Array<{ id: string; prob: number }>; custo: number; aviso: string | null } | null>(null);
  const [doPadrao, setDoPadrao] = useState<string | null>(null);
  const padraoDaBase = lerBaseDeDesign(site.direcao ? site.direcao.base_de_design : null).padrao;
  const [ocupado, setOcupado] = useState<string | null>(null);
  // O Desfazer do tipo só vale para o site que estava aberto.
  const siteAberto = useRef(site.id);
  const atual = useRef(mapa);
  atual.current = mapa;
  /** O mesmo jeito do estado local de antes: valor ou função sobre o mapa atual. */
  const setMapa = (v: SetStateAction<MapaDoSite>) => onMapa(typeof v === "function" ? (v as (m: MapaDoSite) => MapaDoSite)(atual.current) : v);

  useEffect(() => {
    siteAberto.current = site.id;
    setPrevia(null);
    // UXM: a nota da ordem do padrão vale até o mapa ser gravado (antes saía no "Salvar o mapa").
    setDoPadrao(null);
    // Ao abrir outro site ou quando o mapa salvo muda (a prévia do Jev foi salva ou o diretor mudou o mapa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(site.mapa || null), site.tipo]);

  const mudou = mapaMudou(site, mapa);
  const total = secoesDoMapa(mapa).length;

  const trocarTipo = (tipo: string) => {
    if (!ehTipoDeSite(tipo)) return;
    const anterior = atual.current;
    const previaAnterior = previa;
    const novo = mapaPadrao(tipo as TipoDeSite);
    setMapa(novo);
    setPrevia(null);
    if (JSON.stringify(novo) === JSON.stringify(anterior)) return;
    const doSite = site.id;
    toast.success("Mapa trocado", {
      action: {
        label: "Desfazer",
        onClick: () => {
          if (siteAberto.current !== doSite) return;
          onMapa(anterior);
          setPrevia(previaAnterior);
        },
      },
    });
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

  /** UXM: a ordem do padrão da base entra na página inicial (prévia até salvar), com as variantes ligadas. */
  const aplicarPadrao = async () => {
    if (!padraoDaBase) return;
    setOcupado("padrao");
    try {
      const b = await carregarBaseDaTela();
      const p = b.base.padroes.filter((x) => x.id === padraoDaBase.id)[0];
      if (!p) throw new Error("O padrão escolhido não está na base.");
      const r = mapaDoPadrao(atual.current, p);
      setMapa(r.mapa);
      setPrevia(null);
      const partes = [
        r.entraram.length ? `entraram ${r.entraram.map((t) => (secaoDaBiblioteca(t) || { rotulo: t }).rotulo).join(", ")}` : "nenhuma seção nova",
        r.so_real.length ? `só com dado real: ${r.so_real.map((t) => (secaoDaBiblioteca(t) || { rotulo: t }).rotulo).join(", ")}` : "",
        r.sem_equivalente.length ? `sem peça na biblioteca: ${r.sem_equivalente.join(", ")}` : "",
      ].filter(Boolean);
      setDoPadrao(`Ordem de ${padraoDaBase.rotulo || padraoDaBase.id}: ${partes.join("; ")}. O Salvar da etapa grava o mapa.`);
    } catch (e) {
      avisarErro(e, "A ordem do padrão não entrou");
    } finally {
      setOcupado(null);
    }
  };

  const trocarVariante = (uid: string, variante: string) =>
    setMapa((m) => ({
      ...m,
      fonte: "manual",
      paginas: m.paginas.map((p) => ({
        ...p,
        secoes: p.secoes.map((x) => {
          if (x.uid !== uid) return x;
          if (!variante) {
            const { variante: _sem, ...resto } = x;
            return resto;
          }
          return { ...x, variante };
        }),
      })),
    }));

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

  return (
    <Secao
      titulo="Tipo e mapa do site"
      descricao={`${mapa.paginas.length} página(s) · ${total} seção(ões)${mudou ? " · não salvo" : ""}`}
      ajuda="O tipo de site dá o mapa padrão (páginas e seções). A biblioteca usa os nomes do mercado: hero cinematográfico, bento, prova social, pricing, FAQ, CTA final, galeria antes e depois, contato com mapa. Montar com o Jev lê o briefing e o contexto e acrescenta as seções que o negócio pede (as de prova só com dado real). É prévia até salvar: o Salvar e o Seguir no pé da etapa gravam o mapa, o estilo e a direção juntos, e salvar guarda a versão anterior."
      recolher="mesa-site:direcao:mapa"
      acao={
        <button type="button" className={botao.secundario} disabled={!!ocupado} onClick={() => void montarComJev()} title={`Custo do Jev: ~${usd(CUSTO_DO_JEV)}`} data-montar-mapa="">
          {ocupado === "jev" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
          Montar com o Jev
        </button>
      }
    >
      <SeletorCompacto rotulo="Tipo de site" opcoes={TIPOS_DE_SITE.map((t) => ({ valor: t.id, rotulo: t.rotulo, descricao: t.descricao }))} valor={mapa.tipo} onEscolher={trocarTipo} listaQuandoNaoCabe />
      {padraoDaBase && (
        <div className="flex min-w-0 flex-wrap items-center" data-padrao-da-base={padraoDaBase.id}>
          <span className={juntar(texto.rotulo, "mr-2")}>Padrão da base</span>
          <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate")} title={CREDITO_DA_BASE}>
            {padraoDaBase.rotulo || padraoDaBase.id}
          </span>
          <button type="button" className={botao.discreto} disabled={!!ocupado} onClick={() => void aplicarPadrao()} data-aplicar-ordem-do-padrao="">
            {ocupado === "padrao" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Aplicar a ordem do padrão
          </button>
        </div>
      )}
      {doPadrao && (
        <p className={juntar(texto.auxiliar, "whitespace-normal")} data-previa-do-padrao="">
          {doPadrao}
        </p>
      )}
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
            <input value={p.titulo} onChange={(e) => renomear(p.id, e.target.value)} className={juntar(campo, "mr-2 h-8 w-28 shrink-0 font-medium sm:w-40")} aria-label={`Nome da página ${pi + 1}`} />
            <span className={juntar(texto.auxiliar, "mr-2 min-w-0 flex-1 truncate")}>{p.slug ? `/${p.slug}/` : "página inicial"}</span>
            <SeletorDaBiblioteca rotulo="Acrescentar seção" curto="+ Seção" className="w-[104px] shrink-0 sm:w-auto" valor="" onEscolher={(tipo) => setMapa((m) => adicionarSecaoNoMapa(m, p.id, tipo))} />
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
              const nome = lib ? lib.rotulo : s.tipo;
              return (
                <li key={s.uid} className={lista.linha} data-secao-do-mapa={s.uid}>
                  <span className={juntar(texto.auxiliar, "mr-2 w-5 shrink-0 tabular-nums")}>{i + 1}</span>
                  <span className="mr-2 min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")} title={lib ? lib.descricao : undefined}>
                      {nome}
                    </span>
                  </span>
                  {lib && lib.so_real && <span className={juntar(etiqueta, "mr-2 shrink-0 bg-muted")}>só foto real</span>}
                  {variantesDaSecao(s.tipo).length > 0 && (
                    <select
                      value={s.variante || ""}
                      onChange={(e) => trocarVariante(s.uid, e.target.value)}
                      className={juntar(campo, "mr-1 h-8 w-[88px] shrink-0 text-[12px] sm:w-auto sm:max-w-[160px]")}
                      aria-label={`Variante de ${nome}`}
                      data-variante-da-secao={s.uid}
                    >
                      <option value="">Variante</option>
                      {variantesDaSecao(s.tipo).map((v) => (
                        <option key={v.id} value={v.id} title={v.padrao}>
                          {v.rotulo}
                        </option>
                      ))}
                    </select>
                  )}
                  <SeletorDaBiblioteca rotulo={`Trocar ${nome} por`} curto="Trocar" className="w-[104px] shrink-0 sm:w-auto sm:max-w-[220px]" valor="" onEscolher={(tipo) => setMapa((m) => trocarSecaoNoMapa(m, s.uid, tipo))} />
                  <button type="button" className={juntar(botao.icone, "ml-1 hidden sm:inline-flex")} aria-label={`Subir ${nome}`} disabled={i === 0} onClick={() => mover(p.id, i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className={juntar(botao.icone, "hidden sm:inline-flex")} aria-label={`Descer ${nome}`} disabled={i === p.secoes.length - 1} onClick={() => mover(p.id, i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" className={juntar(botao.icone, "hidden sm:inline-flex")} aria-label={`Tirar ${nome}`} onClick={() => setMapa((m) => removerSecaoDoMapa(m, s.uid))}>
                    <X className="h-4 w-4" />
                  </button>
                  {/* Celular (< 640 px): subir, descer e tirar no "..." da linha; o nome da seção fica à vista. */}
                  <MenuMais
                    vertical
                    className="ml-1 sm:hidden"
                    rotulo={`Mais ações de ${nome}`}
                    itens={[
                      { rotulo: "Subir", icone: <ArrowUp className="h-4 w-4" />, aoEscolher: () => mover(p.id, i, -1), desativado: i === 0 },
                      { rotulo: "Descer", icone: <ArrowDown className="h-4 w-4" />, aoEscolher: () => mover(p.id, i, 1), desativado: i === p.secoes.length - 1 },
                      { rotulo: "Tirar", icone: <X className="h-4 w-4" />, aoEscolher: () => setMapa((m) => removerSecaoDoMapa(m, s.uid)), perigo: true },
                    ]}
                  />
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
