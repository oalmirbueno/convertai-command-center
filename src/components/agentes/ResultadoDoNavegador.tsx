import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { type CartaoDaTarefa, cartaoDaTarefa, DEFINICOES_DOS_CASOS, dolares, nomeDoModelo, type TarefaDoNavegador } from "@/lib/agentes/navegadorApi";
import { fonteDoCartao } from "@/lib/agentes/insumosDoNavegador";

/**
 * O cartão do resultado de uma tarefa do navegador do agente (frente CUS, 01/10/2026): o resumo, a fonte
 * (a página lida), os prints e o que cada ação trouxe, em linguagem da equipe. Com `insumo`, um clique leva
 * a coleta para a mesa de origem (proposta, direção do site, pesquisa da identidade, biblioteca de anúncios);
 * a mesa grava pelo caminho de sempre, com Desfazer ou versão.
 */

export interface InsumoDoNavegador {
  /** Rótulo do botão (padrão: o insumo da ação, como "Pôr no bloco Mercado"). */
  rotulo?: string;
  /** Leva para a mesa; devolve a frase do aviso de sucesso. */
  aoUsar: (c: CartaoDaTarefa) => Promise<string | void>;
}

type Obj = Record<string, unknown>;
const lst = (v: unknown) => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function Link({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline [overflow-wrap:anywhere]">
      {url.replace(/^https?:\/\//, "")}
    </a>
  );
}

function Cores({ cores }: { cores: string[] }) {
  if (!cores.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center">
      {cores.slice(0, 8).map((c) => (
        <span key={c} className="mb-1 mr-2 inline-flex items-center">
          <span className="mr-1 inline-block h-3 w-3 rounded-sm border border-border" style={{ backgroundColor: c }} aria-hidden="true" />
          <span className={texto.auxiliar}>{c}</span>
        </span>
      ))}
    </span>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 py-1">
      <dt className={texto.rotulo}>{rotulo}</dt>
      <dd className={juntar(texto.corpo, "min-w-0 [overflow-wrap:anywhere]")}>{children}</dd>
    </div>
  );
}

/** O miolo do cartão, por ação. */
function CorpoDoCartao({ c }: { c: CartaoDaTarefa }) {
  const r = c.resultado as Obj;
  const caso = c.tarefa.caso;
  const dados = lst(r.dados).map((d) => d as Obj);
  const avisos = lst(r.avisos).map(str).filter(Boolean);
  return (
    <dl className="min-w-0">
      {caso === "conferir_post" && <Linha rotulo="No ar?">{r.no_ar === true ? "Sim" : r.no_ar === false ? "Não" : "Não deu para conferir"}. {str(r.motivo)}</Linha>}
      {caso === "conferir_site" && (
        <>
          <Linha rotulo="Velocidade">
            {(() => {
              const t = (r.tempos || {}) as Obj;
              const s = (v: unknown) => (typeof v === "number" ? `${(v / 1000).toFixed(1).replace(".", ",")} s` : "?");
              return `Primeiro byte em ${typeof t.ttfb_ms === "number" ? `${t.ttfb_ms} ms` : "?"}, carregou em ${s(t.load_ms || t.total_ms)}${typeof t.peso_kb === "number" ? `, ${(Number(t.peso_kb) / 1024).toFixed(1).replace(".", ",")} MB` : ""}.`;
            })()}
          </Linha>
          <Linha rotulo="Links">
            {(() => {
              const l = (r.links || {}) as Obj;
              const q = lst(l.quebrados).map((x) => x as Obj);
              return (
                <>
                  {q.length} quebrado(s) de {str(l.conferidos) || "0"} conferido(s) do próprio site; {str(l.externos) || "0"} externo(s) não conferido(s).
                  {q.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">
                      {q.slice(0, 20).map((x) => (
                        <li key={str(x.url)}>
                          {x.status === null ? "sem resposta" : str(x.status)}: <Link url={str(x.url)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              );
            })()}
          </Linha>
        </>
      )}
      {(caso === "coleta_publica" || caso === "perfil_publico") && dados.length > 0 && (
        <Linha rotulo="O que achou">
          <ul className={juntar(lista.aberta, "min-w-0")}>
            {dados.slice(0, 20).map((d, i) => (
              <li key={i} className="py-0.5">
                <span className="font-medium">{str(d.item)}:</span> {str(d.valor)}
                {str(d.fonte) && /^https?:\/\//.test(str(d.fonte)) ? (
                  <span className={juntar(texto.auxiliar, "ml-1")}>
                    (<Link url={str(d.fonte)} />)
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Linha>
      )}
      {caso === "perfil_publico" && str(r.tom) && <Linha rotulo="Tom">{str(r.tom)}</Linha>}
      {caso === "perfil_publico" && lst(r.formatos).length > 0 && <Linha rotulo="Formatos">{lst(r.formatos).map(str).join(", ")}</Linha>}
      {caso === "capturar_referencia" && (
        <>
          {lst(r.notas).length > 0 && (
            <Linha rotulo="Notas de estilo">
              <ul className="list-disc pl-5">
                {lst(r.notas).map((n, i) => (
                  <li key={i}>
                    <span className="font-medium">{str((n as Obj).aspecto)}:</span> {str((n as Obj).nota)}
                  </li>
                ))}
              </ul>
            </Linha>
          )}
          {lst(r.levar).length > 0 && <Linha rotulo="Levar">{lst(r.levar).map(str).join("; ")}</Linha>}
          {lst(r.evitar).length > 0 && <Linha rotulo="Evitar">{lst(r.evitar).map(str).join("; ")}</Linha>}
          {(() => {
            const e = (r.estilo || {}) as Obj;
            const cores = lst(e.cores).map((x) => str((x as Obj).hex)).filter(Boolean);
            const fontes = lst(e.fontes).map((x) => str((x as Obj).familia)).filter(Boolean);
            return cores.length || fontes.length ? (
              <Linha rotulo="Lido do código da página">
                <Cores cores={cores} />
                {fontes.length > 0 && <span className={juntar(texto.auxiliar, "block")}>Fontes: {fontes.join(", ")}</span>}
              </Linha>
            ) : null;
          })()}
        </>
      )}
      {caso === "concorrentes_visuais" &&
        lst(r.concorrentes).map((x, i) => {
          const o = x as Obj;
          const cores = (lst(o.cores).length ? lst(o.cores) : lst(o.cores_do_codigo)).map(str);
          return (
            <Linha key={i} rotulo={str(o.nome) || str(o.dominio)}>
              {str(o.comunica) && <span className="block">{str(o.comunica)}</span>}
              {str(o.logo) && <span className={juntar(texto.auxiliar, "block")}>Logo: {str(o.logo)}</span>}
              <Cores cores={cores} />
              {(str(o.tipografia) || lst(o.fontes_do_codigo).length > 0) && <span className={juntar(texto.auxiliar, "block")}>Tipografia: {str(o.tipografia) || lst(o.fontes_do_codigo).map(str).join(", ")}</span>}
              {str(o.site) && <Link url={str(o.site)} />}
            </Linha>
          );
        })}
      {avisos.length > 0 && (
        <Linha rotulo="Avisos">
          <ul className="list-disc pl-5">
            {avisos.slice(0, 20).map((a, i) => (
              <li key={i} className={texto.auxiliar}>
                {a}
              </li>
            ))}
          </ul>
        </Linha>
      )}
    </dl>
  );
}

export default function ResultadoDoNavegador({ tarefa, onFechar, insumo }: { tarefa: TarefaDoNavegador | null; onFechar: () => void; insumo?: InsumoDoNavegador }) {
  const q = useQuery({ queryKey: ["navegador-do-agente", "cartao", tarefa ? tarefa.id : ""], enabled: !!tarefa, staleTime: 5 * 60_000, retry: false, queryFn: () => cartaoDaTarefa((tarefa as TarefaDoNavegador).id) });
  const [usando, setUsando] = useState(false);
  const def = tarefa ? DEFINICOES_DOS_CASOS[tarefa.caso] : null;
  const c = q.data;
  const r = (c && c.resultado) || {};
  const rotuloDoInsumo = insumo ? insumo.rotulo || (def && def.insumo) || "Usar na mesa" : "";

  const usar = async () => {
    if (!c || !insumo) return;
    setUsando(true);
    try {
      const frase = await insumo.aoUsar(c);
      // "" = a mesa já avisou (com o Desfazer dela).
      if (frase !== "") toast.success(frase || "Levado para a mesa");
      onFechar();
    } catch (e) {
      toast.error("Não deu para levar para a mesa", { description: textoDoErro(e) });
    } finally {
      setUsando(false);
    }
  };

  return (
    <JanelaCentral
      aberta={!!tarefa}
      onMudar={(v) => { if (!v && !usando) onFechar(); }}
      largura="lg"
      icone={<FileText className="h-4 w-4" />}
      titulo={tarefa ? tarefa.titulo : "Resultado"}
      descricao={c ? [str((r as Obj).resumo).slice(0, 160), c.tarefa.modelo_id ? `${nomeDoModelo(null, c.tarefa.modelo_id)}, ${dolares(Number((r as Obj).custo_usd) || 0)}` : "sem modelo"].filter(Boolean).join(" · ") : undefined}
      ajuda="O que o navegador do agente leu, com a página de onde veio e os prints. Nada aqui foi inventado: o que não achou fica em Avisos. O botão leva a coleta para a mesa de origem; a mesa grava como sempre e dá para desfazer."
      rodape={
        <>
          <button type="button" className={juntar(botao.discreto, insumo ? "mr-2" : "")} onClick={onFechar} disabled={usando}>
            Fechar
          </button>
          {insumo && (
            <button type="button" className={botao.primario} onClick={() => void usar()} disabled={!c || usando} data-usar-insumo="">
              {usando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
              {rotuloDoInsumo}
            </button>
          )}
        </>
      }
    >
      {q.isLoading ? (
        <Carregando rotulo="Abrindo o resultado" linhas={3} />
      ) : q.isError ? (
        <EstadoDeErro titulo="Não deu para abrir o resultado." descricao={textoDoErro(q.error)} />
      ) : c ? (
        <div className="min-w-0 space-y-4" data-cartao-do-navegador={c.tarefa.caso}>
          <p className={texto.corpo}>{str((r as Obj).resumo) || "Sem resumo."}</p>
          <p className={texto.auxiliar}>
            Fonte: <Link url={fonteDoCartao(c)} />
            {lst((r as Obj).fontes).length > 1 ? ` e mais ${lst((r as Obj).fontes).length - 1}` : ""}
          </p>
          {c.imagens.length > 0 && (
            <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              {c.imagens.map((i) => (
                <li key={i.storage_path} className="min-w-0">
                  <p className={juntar(texto.rotulo, "mb-1 truncate")}>{i.rotulo}</p>
                  {i.url ? (
                    <a href={i.url} target="_blank" rel="noreferrer" className="block max-h-72 overflow-hidden rounded-md border border-border">
                      <img src={i.url} alt={i.rotulo} className="w-full" loading="lazy" />
                    </a>
                  ) : (
                    <p className={texto.auxiliar}>Print indisponível.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <CorpoDoCartao c={c} />
        </div>
      ) : null}
    </JanelaCentral>
  );
}
