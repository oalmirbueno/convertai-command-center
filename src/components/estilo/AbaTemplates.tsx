import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Archive, ArchiveRestore, Check, ChevronLeft, ImagePlus, Layers, Loader2, ThumbsDown, ThumbsUp, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { AjudaRecolhida, EstadoVazio, SeletorCompacto, botao, campo, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { acaoDoAnexo, chamarAcaoDoAgente, type AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { padraoPara, textoDoErro } from "@/lib/mesa/api";
import { type AnexoParaEnviar, imagensDe, prepararAnexo } from "./estiloApi";
import {
  AREAS_DO_TEMPLATE,
  capaDoTemplate,
  chamarTemplates,
  chaveDosTemplates,
  type CorpoDoTemplate,
  type DeOnde,
  DIMENSOES_DA_COMBINACAO,
  DIMENSOES_DO_TEMPLATE,
  type EstadoDosTemplates,
  FORMATOS_DO_TEMPLATE,
  mover,
  normalizarEstadoDosTemplates,
  PARTES_DA_LAMINA,
  ROTULOS_DA_CONTINUIDADE,
  ROTULOS_DAS_AREAS,
  ROTULOS_DAS_DIMENSOES,
  ROTULOS_DAS_PARTES,
  ROTULOS_DOS_FORMATOS,
  rotuloDoTipo,
  type TemplateNaTela,
} from "./templatesApi";

/**
 * Aba Templates do painel do estilo (frente T). Três partes, pouco texto:
 * - Templates: os moldes do cliente e da agência (miniatura própria, versão,
 *   gostos, testes, âncoras, arquivar).
 * - Carrosséis: referências de carrossel com as lâminas na ordem (arrastar ou
 *   setas para ordenar, a ordem nova vira versão).
 * - Combinar: 2 ou 3 fontes; o Jev escolhe o melhor de cada dimensão, o
 *   diretor de arte redige e a proposta vem num cartão para confirmar.
 */

type Parte = "templates" | "carrosseis" | "combinar";
export type ReferenciaParaCombinar = { id: string; nome: string; url: string };

const quando = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

/** Imagem 4:5 sem aspect-ratio (Safari 11): a miniatura própria primeiro, o original se ela faltar. Nunca escurece. */
export function MiniaturaDoTemplate({ mini, url, alt, children, proporcao = 125 }: { mini?: string; url?: string; alt: string; children?: ReactNode; proporcao?: number }) {
  const [src, setSrc] = useState(mini || url || "");
  useEffect(() => setSrc(mini || url || ""), [mini, url]);
  return (
    <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: `${proporcao}%` }}>
      {src ? <img src={src} alt={alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={() => (url && src !== url ? setSrc(url) : undefined)} /> : null}
      {children}
    </div>
  );
}

/** O template em blocos curtos (proposta do agente, combinação e detalhe). */
export function PreviaDoTemplate({ corpo, deOnde = [] }: { corpo: CorpoDoTemplate | null; deOnde?: DeOnde[] }) {
  if (!corpo) return null;
  const areas = AREAS_DO_TEMPLATE.filter((a) => corpo.areas && corpo.areas[a]);
  const c = corpo.continuidade;
  return (
    <div className="min-w-0 space-y-2" data-previa-do-template="">
      {corpo.resumo && <p className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{corpo.resumo}</p>}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {DIMENSOES_DO_TEMPLATE.filter((d) => corpo.regras && corpo.regras[d] && corpo.regras[d].length > 0).map((d) => (
          <div key={d} className="min-w-0">
            <dt className={texto.rotulo}>{ROTULOS_DAS_DIMENSOES[d]}</dt>
            <dd className="mt-0.5 text-[12.5px] leading-5 [overflow-wrap:anywhere]">
              {corpo.regras[d].map((r, i) => (
                <span key={i} className="block">
                  {r}
                </span>
              ))}
            </dd>
          </div>
        ))}
        {areas.length > 0 && (
          <div className="min-w-0">
            <dt className={texto.rotulo}>Áreas</dt>
            <dd className="mt-0.5 text-[12.5px] leading-5 [overflow-wrap:anywhere]">
              {areas.map((a) => (
                <span key={a} className="block">
                  {ROTULOS_DAS_AREAS[a]}: {corpo.areas[a]}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
      {c && (
        <div className="min-w-0">
          <p className={texto.rotulo}>Continuidade</p>
          <p className="mt-0.5 text-[12.5px] leading-5 [overflow-wrap:anywhere]">
            {c.total} lâminas{c.tipos.length ? `: ${c.tipos.map((t) => ROTULOS_DA_CONTINUIDADE[t]).join(", ")}` : ""}
            {c.descricao ? `. ${c.descricao}` : ""}
          </p>
          <ol className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
            {c.laminas.map((l) => (
              <li key={l.ordem} className="[overflow-wrap:anywhere]">
                {l.ordem}. {l.papel}
                {l.funcao ? `, ${l.funcao}` : ""}
                {l.corte_direita ? `. Cruza a borda: ${l.corte_direita}` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
      {deOnde.length > 0 && (
        <div className="min-w-0" data-de-onde="">
          <p className={texto.rotulo}>De onde veio</p>
          <ul className="mt-0.5 space-y-0.5 text-[12px] leading-5">
            {deOnde.map((x, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                <span className="font-medium">{x.dimensao === "continuidade" ? "Continuidade" : ROTULOS_DAS_DIMENSOES[x.dimensao]}</span>
                <span className="text-muted-foreground"> · {x.nome || x.fonte}</span>: {x.frase}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Lâminas em ordem com arrastar (computador) e setas (celular e teclado). */
function LaminasOrdenaveis<T extends { chave: string; mini?: string; url?: string; nome: string }>({ itens, onMudar, onTirar, desativado }: { itens: T[]; onMudar: (novos: T[]) => void; onTirar?: (i: number) => void; desativado?: boolean }) {
  const arrastando = useRef<number | null>(null);
  return (
    <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-laminas-ordenaveis="">
      {itens.map((l, i) => (
        <li
          key={l.chave}
          className="min-w-0"
          draggable={!desativado}
          onDragStart={(e) => {
            arrastando.current = i;
            try {
              e.dataTransfer.setData("text/plain", String(i));
            } catch {
              /* Safari antigo */
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const de = arrastando.current;
            arrastando.current = null;
            if (de !== null && de !== i) onMudar(mover(itens, de, i));
          }}
        >
          <MiniaturaDoTemplate mini={l.mini} url={l.url} alt={`Lâmina ${i + 1}`}>
            <span className="absolute left-1 top-1 rounded bg-background/90 px-1.5 text-[11px] font-medium tabular-nums">{i + 1}</span>
            {onTirar && (
              <button type="button" className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/90" onClick={() => onTirar(i)} aria-label={`Tirar a lâmina ${i + 1}`} disabled={desativado}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </MiniaturaDoTemplate>
          <div className="mt-1 flex items-center justify-between">
            <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onMudar(mover(itens, i, i - 1))} disabled={desativado || i === 0} aria-label={`Lâmina ${i + 1} para trás`}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onMudar(mover(itens, i, i + 1))} disabled={desativado || i === itens.length - 1} aria-label={`Lâmina ${i + 1} para frente`}>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function AbaTemplates({ modeloImagemId, referencias = [], conversaId }: { modeloImagemId?: string | null; referencias?: ReferenciaParaCombinar[]; conversaId?: string | null }) {
  const { clientId, catalogo, atualizarCusto, marca } = useMesa();
  const marcaId = marca && !marca.principal ? marca.id : null;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [parte, setParte] = useEstadoDaTela<Parte>(`estilo:templates:parte:${clientId}`, "templates", { validar: (v) => v === "templates" || v === "carrosseis" || v === "combinar" });
  const [arquivados, setArquivados] = useEstadoDaTela<boolean>(`estilo:templates:arquivados:${clientId}`, false, { validar: (v) => typeof v === "boolean" });
  const [aberto, setAberto] = useEstadoDaTela<string>(`estilo:templates:aberto:${clientId}`, "", { validar: (v) => typeof v === "string" });
  const chave = chaveDosTemplates(clientId, marcaId, arquivados);
  const consulta = useQuery({
    queryKey: chave,
    queryFn: async () => normalizarEstadoDosTemplates(await chamarTemplates("templates_estado", clientId, marcaId, { arquivados })),
    staleTime: 60_000,
    placeholderData: (anterior) => anterior,
  });
  const estado: EstadoDosTemplates | null = consulta.data || null;
  const guardar = (d: any) => {
    const n = normalizarEstadoDosTemplates(d);
    queryClient.setQueryData(chave, n);
    void queryClient.invalidateQueries({ queryKey: ["estilo-templates", clientId] });
  };
  const [ocupado, setOcupado] = useState<string | null>(null);
  const direto = async (acao: string, corpo: Record<string, unknown>, rotulo: string) => {
    setOcupado(acao);
    try {
      guardar(await chamarTemplates(acao, clientId, marcaId, { arquivados, ...corpo }));
      return true;
    } catch (e) {
      avisarErro(e, rotulo);
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const gerador = modeloImagemId ? catalogo.find((m) => m.id === modeloImagemId) || padraoPara(catalogo, "imagem") : padraoPara(catalogo, "imagem");
  const leitor = padraoPara(catalogo, "leitura");
  const diretor = padraoPara(catalogo, "diretor_arte");
  const todos = estado ? estado.templates : [];
  const templates = todos.filter((t) => t.tipo === "template");
  const carrosseis = todos.filter((t) => t.tipo === "referencia_carrossel");
  const atual = todos.find((t) => t.id === aberto) || null;

  // ------------------------------------------------------------ detalhe
  const [gostoTexto, setGostoTexto] = useState("");
  const [gostoQuem, setGostoQuem] = useState<"cliente" | "dono">("cliente");
  const [ordem, setOrdem] = useState<string[] | null>(null);
  useEffect(() => setOrdem(null), [aberto]);

  const detalhe = (t: TemplateNaTela) => {
    const laminas = t.laminas.map((l) => ({ ...l, chave: l.id }));
    const ordenadas = ordem ? ordem.map((id) => laminas.find((l) => l.id === id)).filter((x): x is (typeof laminas)[number] => !!x) : laminas;
    const mudouOrdem = !!ordem && ordem.join(",") !== laminas.map((l) => l.id).join(",");
    const versao = t.versoes.find((v) => v.numero === t.versao_atual);
    const testes = t.testes.filter((x) => x.status !== "descartado");
    return (
      <div className="space-y-5" data-detalhe-do-template={t.id}>
        <div className="flex min-w-0 items-center">
          <button type="button" className={juntar(botao.icone, "mr-1")} onClick={() => setAberto("")} aria-label="Voltar para a lista">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold">{t.nome}</p>
            <p className={juntar(texto.auxiliar, "truncate")}>
              {rotuloDoTipo(t)} · v{t.versao_atual}
              {t.status === "arquivado" ? " · arquivado" : ""}
            </p>
          </div>
          {t.status === "ativo" && (
            <BotaoComCusto
              rotulo="Testar"
              titulo="Imagem de teste do template"
              descricao="Gera 1 imagem com o gerador do Estúdio."
              partes={() => (gerador ? [{ modeloId: gerador.id, tipo: "imagem", imagens: 1, qualidade: "media" }] : [])}
              executar={() => chamarTemplates("template_teste_gerar", clientId, marcaId, { id: t.id, quantos: 1, modelo_imagem_id: modeloImagemId || undefined, arquivados })}
              aoConcluir={(d) => {
                guardar(d);
                atualizarCusto();
                if (d && Array.isArray(d.avisos) && d.avisos.length) toast.info(d.avisos.join(" "));
              }}
              className="ml-2"
            />
          )}
          <button
            type="button"
            className={juntar(botao.icone, "ml-1")}
            disabled={!!ocupado}
            onClick={() => void direto("template_arquivar", { id: t.id, arquivar: t.status === "ativo" }, "Não foi possível mudar")}
            aria-label={t.status === "ativo" ? "Arquivar template" : "Desarquivar template"}
            title={t.status === "ativo" ? "Arquivar" : "Desarquivar"}
          >
            {t.status === "ativo" ? <Archive className="h-4 w-4" aria-hidden="true" /> : <ArchiveRestore className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>

        {t.tipo === "referencia_carrossel" ? (
          <section>
            <div className="mb-2 flex items-center">
              <h3 className={juntar(texto.rotulo, "flex-1")}>Lâminas na ordem</h3>
              {mudouOrdem && (
                <>
                  <button type="button" className={juntar(botao.discreto, "mr-1 h-8")} onClick={() => setOrdem(null)}>
                    Desfazer
                  </button>
                  <button
                    type="button"
                    className={juntar(botao.primario, "h-8")}
                    disabled={!!ocupado}
                    onClick={async () => {
                      if (await direto("referencia_carrossel_reordenar", { id: t.id, ordem }, "Não foi possível guardar a ordem")) {
                        setOrdem(null);
                        toast.success("Ordem guardada", { description: "Virou uma versão nova." });
                      }
                    }}
                  >
                    Guardar ordem
                  </button>
                </>
              )}
            </div>
            <LaminasOrdenaveis itens={ordenadas} onMudar={(l) => setOrdem(l.map((x) => x.id))} desativado={!!ocupado || t.status !== "ativo"} />
            {ordenadas.some((l) => l.partes && Object.keys(l.partes).length) && (
              <details className="mt-2 rounded-md bg-muted/40 px-3 py-2">
                <summary className="cursor-pointer text-[12px] text-muted-foreground">Partes de cada lâmina</summary>
                <ol className="mt-1 space-y-1 text-[12px] leading-5">
                  {ordenadas.map((l, i) => (
                    <li key={l.id} className="[overflow-wrap:anywhere]">
                      <span className="font-medium">{i + 1}.</span>{" "}
                      {PARTES_DA_LAMINA.filter((p) => l.partes && l.partes[p])
                        .map((p) => `${ROTULOS_DAS_PARTES[p]}: ${l.partes![p]}`)
                        .join("; ")}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        ) : (
          <PreviaDoTemplate corpo={t.corpo} deOnde={versao ? versao.de_onde : []} />
        )}

        {t.ancoras.length > 0 && (
          <section>
            <h3 className={juntar(texto.rotulo, "mb-2")}>Âncoras</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {t.ancoras.map((a) => (
                <div key={a.id} className="min-w-0">
                  <MiniaturaDoTemplate mini={a.mini} url={a.url} alt={a.nome}>
                    <button type="button" className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/90" disabled={!!ocupado} onClick={() => void direto("template_ancora_tirar", { id: t.id, ancora_id: a.id }, "Não foi possível tirar")} aria-label={`Tirar ${a.nome} do template`}>
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </MiniaturaDoTemplate>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{a.papel === "geral" ? a.nome : `${a.papel} · ${a.nome}`}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center">
            <h3 className={texto.rotulo}>Gostos</h3>
            <AjudaRecolhida rotulo="O que são os gostos">Quem gostou ou não deste template, com a frase e a data. O agente usa isso ao combinar.</AjudaRecolhida>
          </div>
          <div className="flex min-w-0 flex-wrap items-center">
            <SeletorCompacto rotulo="Quem" opcoes={[{ valor: "cliente", rotulo: "Cliente" }, { valor: "dono", rotulo: "Dono" }]} valor={gostoQuem} onEscolher={(v) => setGostoQuem(v as "cliente" | "dono")} className="mb-1 mr-2" />
            <input value={gostoTexto} onChange={(e) => setGostoTexto(e.target.value)} maxLength={300} placeholder="gostou: ... ou não gostou: ..." aria-label="O que foi de gosto" className={juntar(campo, "mb-1 mr-2 w-auto min-w-0 flex-1")} />
            <button
              type="button"
              className={juntar(botao.secundario, "mb-1")}
              disabled={!gostoTexto.trim() || !!ocupado}
              onClick={async () => {
                if (await direto("template_gosto", { id: t.id, texto: gostoTexto.trim(), quem: gostoQuem }, "Não foi possível registrar")) setGostoTexto("");
              }}
            >
              Registrar
            </button>
          </div>
          {t.gostos.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {t.gostos.map((g) => (
                <li key={g.id} className="flex min-w-0 items-start text-[12.5px]">
                  {g.tipo === "gostou" ? <ThumbsUp className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-label="Gostou" /> : <ThumbsDown className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Não gostou" />}
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="text-muted-foreground">{g.quem === "dono" ? "Dono" : "Cliente"}: </span>
                    {g.texto}
                  </span>
                  <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{quando(g.em)}</span>
                  <button type="button" className={juntar(botao.icone, "-my-1 ml-1 h-7 w-7")} onClick={() => void direto("template_gosto_apagar", { id: t.id, gosto_id: g.id }, "Não foi possível apagar")} aria-label="Apagar gosto">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {testes.length > 0 && (
          <section>
            <h3 className={juntar(texto.rotulo, "mb-2")}>Testes</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {testes.map((x) => (
                <div key={x.id} className="min-w-0">
                  <MiniaturaDoTemplate mini={x.mini} url={x.url} alt={x.tema || "Teste do template"} />
                  {x.status === "aprovado" ? (
                    <p className="mt-1 inline-flex items-center text-[12px] text-primary">
                      <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Virou âncora
                    </p>
                  ) : (
                    <div className="mt-1 flex">
                      <button type="button" className={juntar(botao.primario, "mr-1.5 h-8 flex-1 px-2 text-[12px]")} disabled={!!ocupado} onClick={() => void direto("template_teste_aprovar", { id: t.id, teste_id: x.id }, "Não foi possível aprovar")}>
                        Aprovar
                      </button>
                      <button type="button" className={juntar(botao.secundario, "h-8 px-2 text-[12px]")} disabled={!!ocupado} onClick={() => void direto("template_teste_descartar", { id: t.id, teste_id: x.id }, "Não foi possível descartar")}>
                        Descartar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {t.versoes.length > 1 && (
          <section>
            <h3 className={juntar(texto.rotulo, "mb-2")}>Versões</h3>
            <ul className="divide-y divide-border rounded-md border border-border">
              {t.versoes.map((v) => (
                <li key={v.numero} className="flex min-w-0 items-center px-3 py-2 text-[12.5px]">
                  <span className="mr-2 shrink-0 font-medium tabular-nums">v{v.numero}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={v.nota}>
                    {v.nota}
                  </span>
                  <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{quando(v.criado_em)}</span>
                  {v.numero === t.versao_atual ? (
                    <span className="ml-2 inline-flex shrink-0 items-center text-[11.5px] text-primary">
                      <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Atual
                    </span>
                  ) : (
                    <button type="button" className={juntar(botao.barra, "ml-2")} disabled={!!ocupado} onClick={() => void direto("template_versao_voltar", { id: t.id, numero: v.numero }, "Não foi possível voltar")}>
                      <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Voltar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  };

  const grade = (lista: TemplateNaTela[], vazio: ReactNode) =>
    !lista.length ? (
      vazio
    ) : (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-lista-de-templates="">
        {lista.map((t) => (
          <button key={t.id} type="button" className="min-w-0 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => setAberto(t.id)} aria-label={`Abrir ${t.nome}`}>
            <MiniaturaDoTemplate mini={capaDoTemplate(t)} url={(t.laminas[0] || t.ancoras[0] || t.testes[0] || { url: "" }).url} alt={t.nome}>
              {!capaDoTemplate(t) && <Layers className="absolute left-1/2 top-1/2 -ml-3 -mt-3 h-6 w-6 text-muted-foreground" aria-hidden="true" />}
            </MiniaturaDoTemplate>
            <p className="mt-1 truncate text-[12.5px] font-medium">{t.nome}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {rotuloDoTipo(t)} · v{t.versao_atual}
              {t.status === "arquivado" ? " · arquivado" : ""}
            </p>
          </button>
        ))}
      </div>
    );

  // ------------------------------------------------------------ nova referência de carrossel
  const [novas, setNovas] = useState<Array<AnexoParaEnviar & { chave: string }>>([]);
  const [nomeNovo, setNomeNovo] = useEstadoDaTela<string>(`estilo:templates:nome-carrossel:${clientId}`, "", { validar: (v) => typeof v === "string" });
  const [escopoNovo, setEscopoNovo] = useState<"cliente" | "agencia">("cliente");
  const escolher = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => novas.forEach((a) => URL.revokeObjectURL(a.previa)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const anexar = async (arquivos: File[]) => {
    const vagas = 12 - novas.length;
    const prontos: Array<AnexoParaEnviar & { chave: string }> = [];
    for (const f of arquivos.slice(0, Math.max(0, vagas))) {
      try {
        const a = await prepararAnexo(f);
        prontos.push({ ...a, chave: a.previa });
      } catch (e) {
        toast.error("Lâmina não entrou", { description: textoDoErro(e) });
      }
    }
    if (prontos.length) setNovas((l) => l.concat(prontos));
  };
  const novaReferencia = (
    <section
      className="space-y-2"
      data-nova-referencia=""
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void anexar(imagensDe(e.dataTransfer ? e.dataTransfer.files : null));
      }}
    >
      <div className="flex min-w-0 items-center">
        <h3 className={texto.rotulo}>Nova referência de carrossel</h3>
        <AjudaRecolhida rotulo="Como funciona a referência de carrossel">
          Mande as lâminas na ordem (ou um print com elas lado a lado). Escolhida no Estúdio, a lâmina 1 segue a 1, a 2 segue a 2. Com número diferente, capa segue capa, miolo segue miolo e o fechamento segue o fechamento. A letra, as cores e a logo continuam as do cliente.
        </AjudaRecolhida>
        <span className="flex-1" />
        <button type="button" className={juntar(botao.icone)} onClick={() => escolher.current?.click()} aria-label="Escolher as lâminas" title="Escolher as lâminas">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          ref={escolher}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            void anexar(imagensDe(e.target.files));
            e.target.value = "";
          }}
        />
      </div>
      {novas.length > 0 ? (
        <>
          <LaminasOrdenaveis
            itens={novas.map((a) => ({ ...a, mini: a.previa, url: a.previa }))}
            onMudar={(l) => setNovas(l.map((x) => novas.find((y) => y.chave === x.chave)!).filter(Boolean))}
            onTirar={(i) => {
              URL.revokeObjectURL(novas[i].previa);
              setNovas((l) => l.filter((_, k) => k !== i));
            }}
          />
          <div className="flex min-w-0 flex-wrap items-center">
            <input value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} maxLength={80} placeholder="Nome" aria-label="Nome da referência de carrossel" className={juntar(campo, "mb-1 mr-2 w-auto min-w-0 flex-1")} />
            <SeletorCompacto rotulo="De quem" opcoes={[{ valor: "cliente", rotulo: "Cliente" }, { valor: "agencia", rotulo: "Agência" }]} valor={escopoNovo} onEscolher={(v) => setEscopoNovo(v as "cliente" | "agencia")} className="mb-1 mr-2" />
            <BotaoComCusto
              rotulo="Guardar"
              titulo="Guardar a referência de carrossel"
              descricao="Lê a sequência e as partes de cada lâmina."
              partes={() => (leitor ? [{ modeloId: leitor.id, tipo: "texto", tokensEntrada: 1_500 * Math.max(1, novas.length), tokensSaida: 3_000, vezes: novas.length === 1 ? 2 : 1 }] : [])}
              className="mb-1"
              executar={() =>
                chamarTemplates("referencia_carrossel_criar", clientId, marcaId, {
                  nome: nomeNovo.trim() || undefined,
                  escopo: escopoNovo,
                  laminas: novas.map((a) => ({ nome: a.nome, mime: a.mime, base64: a.base64 })),
                  arquivados,
                })
              }
              aoConcluir={(d) => {
                guardar(d);
                atualizarCusto();
                novas.forEach((a) => URL.revokeObjectURL(a.previa));
                setNovas([]);
                setNomeNovo("");
                if (d && d.criado_id) setAberto(String(d.criado_id));
              }}
            />
          </div>
        </>
      ) : (
        <p className={texto.auxiliar}>Arraste as lâminas aqui, na ordem.</p>
      )}
    </section>
  );

  // ------------------------------------------------------------ combinar
  const [fontes, setFontes] = useEstadoDaTela<string[]>(`estilo:templates:fontes:${clientId}`, [], { validar: (v) => Array.isArray(v) });
  const [objetivo, setObjetivo] = useEstadoDaTela<string>(`estilo:templates:objetivo:${clientId}`, "", { validar: (v) => typeof v === "string" });
  const [formato, setFormato] = useEstadoDaTela<string>(`estilo:templates:formato:${clientId}`, "carrossel", { validar: (v) => typeof v === "string" && FORMATOS_DO_TEMPLATE.indexOf(v as never) >= 0 });
  const [resultado, setResultado] = useState<{ mensagem_id: string | null; resposta: string; acao: AcaoDoAgente | null } | null>(null);
  const [pedirAoDono, setPedirAoDono] = useState<{ motivo: string; fontes: Array<{ apelido: string; nome: string }> } | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const opcoesDeFonte = [
    ...templates.filter((t) => t.status === "ativo").map((t) => ({ chave: `template:${t.id}`, nome: t.nome, mini: capaDoTemplate(t), url: "", detalhe: rotuloDoTipo(t) })),
    ...referencias.map((r) => ({ chave: `referencia:${r.id}`, nome: r.nome, mini: r.url, url: r.url, detalhe: "referência" })),
  ];
  const escolhidas = fontes.filter((f) => opcoesDeFonte.some((o) => o.chave === f)).slice(0, 3);
  const alternar = (chaveDaFonte: string) =>
    setFontes((l) => (l.indexOf(chaveDaFonte) >= 0 ? l.filter((x) => x !== chaveDaFonte) : l.concat([chaveDaFonte]).slice(-3)));
  const pedidoDeCombinacao = (comEscolhas: boolean) =>
    chamarTemplates("template_combinar", clientId, marcaId, {
      fontes: escolhidas.map((f) => ({ tipo: f.split(":")[0], id: f.split(":")[1] })),
      objetivo: objetivo.trim() || undefined,
      formato,
      conversa_id: conversaId || undefined,
      ...(comEscolhas ? { escolhas } : {}),
    });
  const aoCombinar = (d: any) => {
    atualizarCusto();
    if (d && d.pedir_ao_dono) {
      setResultado(null);
      setPedirAoDono({ motivo: String(d.motivo || ""), fontes: Array.isArray(d.fontes) ? d.fontes : [] });
      return;
    }
    setPedirAoDono(null);
    const acao = d && Array.isArray(d.anexos) ? d.anexos.map(acaoDoAnexo).find(Boolean) || null : null;
    setResultado({ mensagem_id: d && d.mensagem_id ? String(d.mensagem_id) : null, resposta: String((d && d.resposta) || ""), acao });
    void queryClient.invalidateQueries({ queryKey: ["estilo-do-cliente", clientId] });
  };
  const partesDaCombinacao = () => (diretor ? [{ modeloId: diretor.id, tipo: "texto" as const, tokensEntrada: 6_000, tokensSaida: 3_500 }] : []);

  const combinar = (
    <div className="space-y-4" data-combinar="">
      <section>
        <div className="mb-2 flex items-center">
          <h3 className={texto.rotulo}>Fontes ({escolhidas.length} de 3)</h3>
          <AjudaRecolhida rotulo="Como funciona a combinação">
            Escolha 2 ou 3: um template aprovado e uma referência nova, ou dois templates. O Jev escolhe o melhor de cada parte (layout, tipografia, cor, tratamento, elementos, capa, CTA) para este cliente, o diretor de arte monta o template e você confirma. A letra, as cores e a logo continuam as do cliente.
          </AjudaRecolhida>
        </div>
        {!opcoesDeFonte.length ? (
          <EstadoVazio compacto titulo="Nada para combinar ainda" descricao="Crie um template ou mande referências na conversa." />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {opcoesDeFonte.map((o) => {
              const sim = escolhidas.indexOf(o.chave) >= 0;
              return (
                <button key={o.chave} type="button" className={juntar("min-w-0 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary", sim ? "ring-2 ring-primary" : "")} onClick={() => alternar(o.chave)} aria-pressed={sim} aria-label={`${sim ? "Tirar" : "Escolher"} ${o.nome}`}>
                  <MiniaturaDoTemplate mini={o.mini} url={o.url} alt={o.nome}>
                    {sim && (
                      <span className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </MiniaturaDoTemplate>
                  <p className="mt-1 truncate text-[11.5px]">{o.nome}</p>
                  <p className="truncate text-[10.5px] text-muted-foreground">{o.detalhe}</p>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <div className="flex min-w-0 flex-wrap items-center">
        <SeletorCompacto rotulo="Formato" opcoes={FORMATOS_DO_TEMPLATE.map((f) => ({ valor: f, rotulo: ROTULOS_DOS_FORMATOS[f] }))} valor={formato} onEscolher={setFormato} className="mb-1 mr-2" />
        <input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} maxLength={300} placeholder="Objetivo (opcional)" aria-label="Objetivo da combinação" className={juntar(campo, "mb-1 mr-2 w-auto min-w-0 flex-1")} />
        <BotaoComCusto
          rotulo="Combinar"
          titulo="Combinar as fontes"
          descricao="O Jev escolhe o melhor de cada parte e o diretor de arte monta o template."
          partes={partesDaCombinacao}
          disabled={escolhidas.length < 2}
          className="mb-1"
          executar={() => pedidoDeCombinacao(false)}
          aoConcluir={aoCombinar}
        />
      </div>
      {pedirAoDono && (
        <section className="space-y-2" data-pedir-ao-dono="">
          <p className="text-[12.5px] text-muted-foreground">{pedirAoDono.motivo}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DIMENSOES_DA_COMBINACAO.map((d) => (
              <div key={d} className="flex min-w-0 items-center">
                <span className="mr-2 w-32 shrink-0 truncate text-[12px]">{ROTULOS_DAS_DIMENSOES[d]}</span>
                <SeletorCompacto
                  rotulo={ROTULOS_DAS_DIMENSOES[d]}
                  modo="lista"
                  opcoes={[...pedirAoDono.fontes.map((f) => ({ valor: f.apelido, rotulo: f.nome })), { valor: "combinar", rotulo: "Combinar" }]}
                  valor={escolhas[d] || ""}
                  onEscolher={(v) => setEscolhas((x) => ({ ...x, [d]: v }))}
                  className="min-w-0 flex-1"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <BotaoComCusto rotulo="Montar com estas escolhas" titulo="Montar o template" partes={partesDaCombinacao} disabled={!Object.keys(escolhas).length} executar={() => pedidoDeCombinacao(true)} aoConcluir={aoCombinar} />
          </div>
        </section>
      )}
      {resultado && (
        <section className="space-y-2" data-resultado-da-combinacao="">
          {resultado.resposta && <p className="text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{resultado.resposta}</p>}
          {resultado.acao && <PropostasDaAcao acao={resultado.acao} />}
          {resultado.acao && resultado.mensagem_id && (
            <CartaoDeAcao
              acao={resultado.acao}
              titulo="Gravar o template combinado"
              observacao="Sem custo. Dá para desfazer."
              onPedido={(p) => chamarAcaoDoAgente("agente-estilo", String(resultado.mensagem_id), resultado.acao!.id, p, { client_id: clientId })}
              onFeito={(p) => {
                if (p === "descartar") return;
                void queryClient.invalidateQueries({ queryKey: ["estilo-templates", clientId] });
              }}
            />
          )}
        </section>
      )}
    </div>
  );

  const conteudo = !estado ? (
    <p className="flex items-center text-[12px] text-muted-foreground">
      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Carregando...
    </p>
  ) : atual && parte !== "combinar" ? (
    detalhe(atual)
  ) : parte === "templates" ? (
    grade(templates, <EstadoVazio compacto titulo="Nenhum template ainda" descricao="Peça na conversa: monte um template de carrossel a partir destas artes." />)
  ) : parte === "carrosseis" ? (
    <div className="space-y-5">
      {novaReferencia}
      {grade(carrosseis, null)}
    </div>
  ) : (
    combinar
  );

  return (
    <div className="space-y-4" data-aba-templates="">
      <div className="flex min-w-0 items-center">
        <SeletorCompacto
          rotulo="Parte dos templates"
          opcoes={[
            { valor: "templates", rotulo: "Templates", contador: templates.length || null },
            { valor: "carrosseis", rotulo: "Carrosséis", contador: carrosseis.length || null },
            { valor: "combinar", rotulo: "Combinar" },
          ]}
          valor={parte}
          onEscolher={(v) => {
            setParte(v as Parte);
            setAberto("");
          }}
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          className={juntar(botao.barra, "ml-2", arquivados ? "text-primary" : "")}
          onClick={() => setArquivados((x) => !x)}
          aria-pressed={arquivados}
          aria-label="Mostrar arquivados"
          title="Mostrar arquivados"
        >
          <Archive className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {estado && estado.aviso && <p className="rounded-md bg-muted/60 px-3 py-2 text-[11.5px] text-muted-foreground">{estado.aviso}</p>}
      {consulta.isError && !estado && <p className="text-[12px] text-muted-foreground">Não foi possível ler os templates agora.</p>}
      {conteudo}
    </div>
  );
}

/** As propostas que um cartão de template carrega (conversa e combinação). */
export function PropostasDaAcao({ acao }: { acao: AcaoDoAgente }) {
  const ctx = (acao.contexto || {}) as Record<string, any>;
  const lista: Array<{ nome: string; corpo: CorpoDoTemplate; de_onde?: DeOnde[] }> = [];
  if (ctx.propostas && typeof ctx.propostas === "object") for (const k of Object.keys(ctx.propostas)) lista.push(ctx.propostas[k]);
  else if (ctx.proposta_de_template) lista.push(ctx.proposta_de_template);
  if (!lista.length) return null;
  return (
    <div className="space-y-2">
      {lista.map((p, i) => (
        <div key={i} className="mr-6 rounded-lg border border-border p-3" data-proposta-de-template="">
          <p className={juntar(texto.rotulo, "mb-2")}>{lista.length > 1 ? `Variação ${i + 1}: ${p.nome}` : p.nome}</p>
          <PreviaDoTemplate corpo={p.corpo} deOnde={p.de_onde || []} />
        </div>
      ))}
      {typeof ctx.coerencia === "number" && <p className="text-[11px] text-muted-foreground">Coerência do conjunto: {Math.round(ctx.coerencia * 100)}%</p>}
    </div>
  );
}

