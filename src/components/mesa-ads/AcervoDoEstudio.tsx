import { useState } from "react";
import { ArrowUpRight, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { juntar } from "@/components/sistema/estilos";
import { ehOMelhor, formatoDe, notaCurta, type CriativoAds, type PlanoAds } from "./adsApi";
import { capaDoTrabalho } from "./ArteDoCriativo";
import KitDeRecepcao from "./KitDeRecepcao";
import { situacaoDe, type SituacaoDoCriativo } from "./loteDoEstudio";

/**
 * Acervo do Estúdio Ads (frente AD4, pedido do dono em 28/09): os criativos e
 * as copies prontos, organizados por ângulo e formato, com o kit de recepção
 * de cada ângulo e a entrega em dois passos: entregar ao cliente (Documentos)
 * e enviar para a CONTA (o criativo fica "na conta": o agente sênior enxerga e
 * o "otimizar" usa como candidato para trocar o anúncio ruim).
 *
 * "Na conta" é o status do criativo (pronto, no ar ou pausado), sem SQL novo.
 * Tirar da conta volta a rascunho (nada é apagado).
 */

/** Status que contam como "na conta" (o agente da conta enxerga). */
export const STATUS_NA_CONTA = ["pronto", "no_ar", "pausado"];
export const estaNaConta = (c: CriativoAds) => STATUS_NA_CONTA.indexOf(c.status) >= 0;

/** Pode ir para a conta: tem arte pronta (pronto ou entregue) e ainda não está lá. */
export function podeIrParaAConta(c: CriativoAds, situacao: SituacaoDoCriativo): boolean {
  return !estaNaConta(c) && (situacao === "pronto" || situacao === "entregue");
}

interface GrupoDoAcervo {
  chave: string;
  plano: PlanoAds | null;
  anguloId: string | null;
  titulo: string;
  subtitulo: string;
  criativos: CriativoAds[];
}

function agruparPorAngulo(criativos: CriativoAds[], planos: PlanoAds[]): GrupoDoAcervo[] {
  const grupos: GrupoDoAcervo[] = [];
  for (const c of criativos) {
    const plano = planos.find((p) => p.id === c.plano_id) || null;
    const angulo = plano ? plano.angulos.find((a) => a.id === c.angulo_id) || null : null;
    const chave = `${c.plano_id || "-"}:${c.angulo_id || "-"}`;
    let g = grupos.find((x) => x.chave === chave);
    if (!g) {
      g = { chave, plano, anguloId: angulo ? angulo.id : null, titulo: angulo ? angulo.nome : "Sem ângulo", subtitulo: plano ? plano.nome : "Sem plano", criativos: [] };
      grupos.push(g);
    }
    g.criativos.push(c);
  }
  return grupos;
}

function SeloDaConta({ c }: { c: CriativoAds }) {
  if (c.status === "no_ar") return <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-success/10 px-2 text-[10.5px] font-medium text-success">No ar</span>;
  if (estaNaConta(c)) return <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-primary/15 px-2 text-[10.5px] font-medium text-primary">Na conta</span>;
  return null;
}

export default function AcervoDoEstudio({
  criativos,
  planos,
  trabalhoDe,
  situacao,
  onAbrir,
  onEnviar,
  onTirar,
  ocupados,
}: {
  criativos: CriativoAds[];
  planos: PlanoAds[];
  trabalhoDe: (c: CriativoAds) => Trabalho | null;
  situacao: (c: CriativoAds) => SituacaoDoCriativo;
  onAbrir: (id: string) => void;
  onEnviar: (lista: CriativoAds[]) => Promise<void>;
  onTirar: (lista: CriativoAds[]) => Promise<void>;
  ocupados: string[];
}) {
  const [armado, setArmado] = useState<string | null>(null);
  const grupos = agruparPorAngulo(criativos, planos);
  const naConta = criativos.filter(estaNaConta).length;
  const entregues = criativos.filter((c) => situacao(c) === "entregue").length;
  const aptos = criativos.filter((c) => podeIrParaAConta(c, situacao(c)));

  /** Enviar pede um segundo clique (muda o que o agente da conta pode subir). */
  const armarOuEnviar = (chave: string, lista: CriativoAds[]) => {
    if (armado !== chave) {
      setArmado(chave);
      window.setTimeout(() => setArmado((a) => (a === chave ? null : a)), 6000);
      return;
    }
    setArmado(null);
    void onEnviar(lista);
  };
  const enviando = (lista: CriativoAds[]) => lista.some((c) => ocupados.indexOf(c.id) >= 0);

  return (
    <div className="min-w-0 space-y-6" data-acervo-do-estudio="">
      {/* O título e o primário já estão no topo do Estúdio (a vista "Acervo" e o "Enviar para a conta"):
          aqui só a linha de estado, com o "?". */}
      <p className="flex min-w-0 items-center text-[12px] text-muted-foreground" data-estado-do-acervo="">
        <span className="min-w-0 truncate">
          {`${criativos.length} ${criativos.length === 1 ? "criativo" : "criativos"} em ${grupos.length} ${grupos.length === 1 ? "ângulo" : "ângulos"} · ${entregues} ${entregues === 1 ? "entregue" : "entregues"} ao cliente · ${naConta} na conta`}
          {!aptos.length && naConta > 0 ? " · tudo o que está pronto já está na conta" : ""}
        </span>
        <AjudaRecolhida className="ml-1.5 shrink-0" rotulo="Como o acervo funciona">
          Os criativos e as copies prontos por ângulo e formato, com o kit de recepção de cada ângulo. Entregar ao cliente põe em Documentos. Enviar para a conta deixa o criativo à mão do agente sênior de tráfego: no Otimizar, ele troca o anúncio que está ruim pelo melhor candidato daqui, sempre com o seu Confirmar. Tirar da conta volta a rascunho; nada é apagado.
        </AjudaRecolhida>
      </p>

      {grupos.map((g) => {
        const angulo = g.plano && g.anguloId ? g.plano.angulos.find((a) => a.id === g.anguloId) || null : null;
        const doGrupo = g.criativos.filter((c) => podeIrParaAConta(c, situacao(c)));
        const tiraveis = g.criativos.filter((c) => c.status === "pronto");
        const comCopy = g.criativos.filter((c) => !!(c.copy.texto_principal || c.copy.titulo)).length;
        const variacoes = g.criativos.reduce((n, c) => {
          const p = c.copy.pacote as { textos_principais?: unknown[] } | undefined;
          return n + (p && Array.isArray(p.textos_principais) ? p.textos_principais.length : 0);
        }, 0);
        return (
          <section key={g.chave} className="min-w-0 border-t border-border pt-4" aria-label={`Ângulo ${g.titulo}`} data-angulo-do-acervo={g.chave}>
            <CabecalhoDeSecao
              nivel={3}
              titulo={g.titulo}
              descricao={`${g.subtitulo} · ${g.criativos.length} ${g.criativos.length === 1 ? "formato" : "formatos"} · ${comCopy} com copy${variacoes ? ` · ${variacoes} variações no pacote` : ""}`}
              truncar
              acao={
                <>
                  {doGrupo.length > 0 && (
                    <Button type="button" size="sm" variant="outline" className="h-8" disabled={enviando(doGrupo)} onClick={() => armarOuEnviar(g.chave, doGrupo)}>
                      <Send className="mr-1 h-3.5 w-3.5" />
                      {armado === g.chave ? `Confirmar ${doGrupo.length}` : "Enviar para a conta"}
                    </Button>
                  )}
                  {tiraveis.length > 0 && doGrupo.length === 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-8 text-muted-foreground" disabled={enviando(tiraveis)} onClick={() => void onTirar(tiraveis)} title="Volta a rascunho: o agente da conta deixa de usar como candidato. Nada é apagado.">
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> Tirar da conta
                    </Button>
                  )}
                </>
              }
            />
            <ul className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label={`Criativos do ângulo ${g.titulo}`}>
              {g.criativos.map((c) => {
                const capa = capaDoTrabalho(trabalhoDe(c));
                const f = formatoDe(c.formato);
                const s = situacaoDe(situacao(c));
                const nota = notaCurta(c.copy.escolha ? c.copy.escolha.nota : null);
                return (
                  <li key={c.id} className="flex min-w-0 rounded-lg border border-border bg-card p-2" data-item-do-acervo={c.id}>
                    <span className="mr-2.5 block w-16 shrink-0">
                      <span className="relative block w-full overflow-hidden rounded-md bg-secondary" style={{ paddingBottom: `${Math.min(178, Math.round((f.altura / f.largura) * 100))}%` }}>
                        <span className="absolute inset-0">{capa ? <ImagemDaMesa caminho={capa} alt="" className="h-full w-full" /> : null}</span>
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center text-[12px] font-medium">
                        <span className="min-w-0 truncate">{f.rotulo}</span>
                        {ehOMelhor(c) && <span className="ml-1 shrink-0 text-[10.5px] text-primary">melhor</span>}
                        {nota && <span className="ml-1 shrink-0 text-[10.5px] tabular-nums text-muted-foreground" title="Nota do Jev da copy">{nota}</span>}
                      </span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center">
                        <span className={juntar("mb-0.5 mr-1 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium", s.tom)}>{s.rotulo}</span>
                        <SeloDaConta c={c} />
                      </span>
                      {(c.copy.titulo || c.copy.texto_principal) && (
                        <span className="mt-0.5 block min-w-0 text-[11.5px] leading-snug">
                          {c.copy.titulo && <span className="block truncate font-medium" title={c.copy.titulo}>{c.copy.titulo}</span>}
                          {c.copy.texto_principal && <span className="line-clamp-2 block text-muted-foreground [overflow-wrap:anywhere]">{c.copy.texto_principal}</span>}
                        </span>
                      )}
                      <button type="button" className="mt-1 inline-flex items-center text-[11.5px] font-medium text-primary hover:underline" onClick={() => onAbrir(c.id)}>
                        Abrir <ArrowUpRight className="ml-0.5 h-3 w-3" />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {g.plano && angulo && (
              <div className="mt-3 min-w-0">
                <KitDeRecepcao key={`${g.plano.id}:${angulo.id}`} plano={g.plano} angulo={angulo} compacto />
              </div>
            )}
          </section>
        );
      })}
      {!grupos.length && (
        <p className="text-[12px] text-muted-foreground">
          Nada no acervo ainda. <AjudaRecolhida rotulo="Como o acervo enche">Produza no Plano de teste e gere as artes aqui.</AjudaRecolhida>
        </p>
      )}
    </div>
  );
}
