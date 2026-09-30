import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, CheckCircle2, Circle, CircleAlert, CircleSlash, Loader2, Wrench } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { CREDITO_DA_BASE, useBaseDaTela } from "@/lib/uiux/carregar";
import type { TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { mapaDoSite, secaoDaBiblioteca, secoesDoMapa } from "../../../supabase/functions/_shared/site-biblioteca";
import { rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo";
import { lerBaseDeDesign } from "../../../supabase/functions/_shared/uiux/consultas";
import { type AvisoDeUx, type ItemDoChecklistDeUx, itensDoChecklist, pendenciasGraves, type ProvaDoAgente } from "../../../supabase/functions/_shared/uiux/checklist-de-ux";
import { CHAVES, chamarMotor, type LinhaDoSite, useSalvarSite } from "./siteApi";

const GRUPOS: Array<{ id: ItemDoChecklistDeUx["severidade"]; rotulo: string; aberto: boolean }> = [
  { id: "critica", rotulo: "Crítica", aberto: true },
  { id: "alta", rotulo: "Alta", aberto: true },
  { id: "media", rotulo: "Média", aberto: false },
  { id: "baixa", rotulo: "Baixa", aberto: false },
];

/**
 * O checklist das 109 regras de UX da web da base UI UX Pro Max (frente UXM),
 * pelo último trabalho do motor: o que o código conferiu no HTML e no CSS do
 * build, a prova que o agente deixou (.aceleriq/ux) e as marcações da equipe.
 * As regras e os textos em português carregam sob demanda (useBaseDaTela); o
 * checklist em si é código leve, sem dado da base (checklist-de-ux.ts), para
 * nenhum pedaço da tela prender a base de forma fixa. Devolve também as
 * pendências graves para o checklist de lançamento (item não obrigatório).
 */
export function useChecklistDeUx(site: LinhaDoSite, trabalhos: TrabalhoDoMotor[]): { itens: ItemDoChecklistDeUx[] | null; graves: number | null } {
  const { base } = useBaseDaTela(true);
  const ultimo = trabalhos.find((t) => t.estado === "feito" && (Array.isArray(t.resultado.qa) || !!t.resultado.build)) || null;
  const avisos = ultimo && Array.isArray(ultimo.resultado.ux) ? (ultimo.resultado.ux as AvisoDeUx[]) : [];
  const agente = ultimo && Array.isArray(ultimo.resultado.ux_agente) ? (ultimo.resultado.ux_agente as ProvaDoAgente[]) : [];
  const revisado = !!ultimo && Array.isArray(ultimo.resultado.ux);
  // As páginas que a revisão leu (worker novo) e quantas o mapa tem: regra de página só fica ok com todas lidas.
  const paginas = ultimo && Array.isArray(ultimo.resultado.ux_paginas) ? (ultimo.resultado.ux_paginas as unknown[]).map((x) => String(x)) : null;
  const paginasDoSite = mapaDoSite(site).paginas.length;
  const marcas = lerBaseDeDesign(site.direcao ? site.direcao.base_de_design : null).ux;
  const chave = JSON.stringify(marcas);
  return useMemo(() => {
    if (!base || !base.base.ux) return { itens: null, graves: null };
    const itens = itensDoChecklist(base.base.ux, { avisos, revisado, agente, marcas, paginas, paginasDoSite }, base.pt);
    return { itens, graves: pendenciasGraves(itens) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, ultimo ? ultimo.id : null, chave, paginasDoSite]);
}

const icone = (i: ItemDoChecklistDeUx) =>
  i.estado === "ok" ? (
    <CheckCircle2 className="mr-2 h-4 w-4 shrink-0 text-primary" aria-label="Conferida" />
  ) : i.estado === "falhou" ? (
    <CircleAlert className="mr-2 h-4 w-4 shrink-0 text-warning" aria-label="Falhou" />
  ) : i.estado === "nao_se_aplica" ? (
    <CircleSlash className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Não se aplica" />
  ) : (
    <Circle className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Pendente" />
  );

export default function ChecklistDeUx({ site, itens, onIrPara }: { site: LinhaDoSite; itens: ItemDoChecklistDeUx[] | null; onIrPara: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const qc = useQueryClient();
  const [abertos, setAbertos] = useState<Record<string, boolean>>(() => GRUPOS.reduce((o: Record<string, boolean>, g) => ((o[g.id] = g.aberto), o), {}));
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [pedido, setPedido] = useState<{ item: ItemDoChecklistDeUx; secao: string; custo: number | null; teto: number | null; carregando: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const secoes = secoesDoMapa(mapaDoSite(site));

  const marcar = async (i: ItemDoChecklistDeUx, estado: "ok" | "nao_se_aplica" | null) => {
    setMarcando(i.no);
    try {
      await salvarSite("ux_marcar", { site_id: site.id, regra: i.no, estado });
    } catch (e) {
      avisarErro(e, "A marcação não foi salva");
    } finally {
      setMarcando(null);
    }
  };

  const abrirPedido = async (i: ItemDoChecklistDeUx) => {
    const secao = i.secao && secoes.indexOf(i.secao) >= 0 ? i.secao : secoes[0] || "";
    setPedido({ item: i, secao, custo: null, teto: null, carregando: true });
    try {
      const d = await chamarMotor<{ estimativa_usd: number; teto_sugerido_usd: number }>("estimar", { client_id: clientId, tipo: "ajustar", secoes: [secao] });
      setPedido((p) => (p ? { ...p, custo: d.estimativa_usd, teto: d.teto_sugerido_usd, carregando: false } : p));
    } catch (e) {
      setPedido((p) => (p ? { ...p, carregando: false } : p));
      avisarErro(e, "O custo não foi estimado");
    }
  };

  const confirmarPedido = async () => {
    if (!pedido || !pedido.secao) return;
    setEnviando(true);
    try {
      await chamarMotor("pedir", {
        client_id: clientId,
        site_id: site.id,
        tipo: "ajustar",
        secao: pedido.secao,
        teto_usd: pedido.teto || undefined,
        instrucao: `Pela regra ${pedido.item.regra} (${pedido.item.titulo}): ${pedido.item.corrigir}${pedido.item.exemplo ? ` Exemplo: ${pedido.item.exemplo}` : ""}${pedido.item.detalhe ? ` O que falhou: ${pedido.item.detalhe}` : ""}`.slice(0, 1400),
      });
      void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
      setPedido(null);
      onIrPara("construcao");
    } catch (e) {
      avisarErro(e, "O ajuste não entrou na fila");
    } finally {
      setEnviando(false);
    }
  };

  const falhas = itens ? itens.filter((i) => i.estado === "falhou").length : 0;
  const pendentes = itens ? itens.filter((i) => i.estado === "pendente").length : 0;
  return (
    <Secao
      titulo="Regras de UX"
      descricao={itens ? `${itens.length} regras · ${falhas} falha(s) · ${pendentes} a conferir` : "Carregando"}
      ajuda={`As 109 regras de UX da web da base, por severidade. Cerca de 20 são conferidas pelo código no HTML e no CSS do build; as de layout vivo (rolagem lateral, alvo de toque, texto que estoura) o agente do motor confere e deixa a prova; o resto você marca. Cada regra traz como corrigir e o exemplo de código; "Pedir ao motor" monta um ajuste da seção com a regra citada, com o custo antes. É aviso: nada trava a publicação. ${CREDITO_DA_BASE}`}
      recolher="mesa-site:revisao:ux"
    >
      {!itens && <Carregando forma="lista" rotulo="Carregando as regras de UX" />}
      {itens &&
        GRUPOS.map((g) => {
          const doGrupo = itens.filter((i) => i.severidade === g.id).sort((a, b) => ["falhou", "pendente", "ok", "nao_se_aplica"].indexOf(a.estado) - ["falhou", "pendente", "ok", "nao_se_aplica"].indexOf(b.estado));
          if (!doGrupo.length) return null;
          const aberto = !!abertos[g.id];
          const comFalha = doGrupo.filter((i) => i.estado === "falhou").length;
          return (
            <div key={g.id} className="min-w-0" data-grupo-de-severidade={g.id}>
              <button type="button" className={juntar(botao.discreto, "px-0")} aria-expanded={aberto} onClick={() => setAbertos((o) => ({ ...o, [g.id]: !aberto }))}>
                {aberto ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
                {g.rotulo} · {doGrupo.length}
                {comFalha > 0 && <span className={juntar(etiqueta, "ml-2 bg-warning/15 text-warning")}>{comFalha} falha(s)</span>}
              </button>
              {aberto && (
                <ul className={juntar(lista.aberta, lista.divisoria)}>
                  {doGrupo.map((i) => {
                    const expandido = detalhe === i.no;
                    return (
                      <li key={i.no} className="min-w-0" data-regra-de-ux={i.no} data-estado={i.estado}>
                        <div className={lista.linha}>
                          {icone(i)}
                          <span className="mr-2 min-w-0 flex-1">
                            <span className={juntar(texto.corpo, "block truncate")}>{i.titulo}</span>
                            <span className={juntar(texto.auxiliar, "block truncate")}>
                              {i.origem}
                              {i.detalhe ? ` · ${i.detalhe}` : ""}
                            </span>
                          </span>
                          <button type="button" className={juntar(botao.discreto, "shrink-0")} aria-expanded={expandido} onClick={() => setDetalhe(expandido ? null : i.no)}>
                            Como corrigir
                          </button>
                          {(i.modo === "manual" || i.modo === "agente" || i.modo === "nao_se_aplica") && i.estado !== "falhou" && (
                            <button type="button" className={juntar(botao.discreto, "shrink-0")} disabled={marcando === i.no} onClick={() => void marcar(i, i.estado === "ok" ? null : "ok")} data-marcar-ok={i.no}>
                              {marcando === i.no ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                              {i.estado === "ok" ? "Desmarcar" : "Ok"}
                            </button>
                          )}
                          {i.estado !== "nao_se_aplica" && i.estado !== "falhou" && (
                            <button type="button" className={juntar(botao.discreto, "shrink-0")} disabled={marcando === i.no} onClick={() => void marcar(i, "nao_se_aplica")}>
                              Não se aplica
                            </button>
                          )}
                          {i.estado === "falhou" && (
                            <button type="button" className={juntar(botao.secundario, "shrink-0")} onClick={() => void abrirPedido(i)} data-pedir-ao-motor={i.no}>
                              <Wrench className="mr-1 h-3.5 w-3.5" />
                              Pedir ao motor
                            </button>
                          )}
                        </div>
                        {expandido && (
                          <div className="ml-6 min-w-0 space-y-1 pb-2" data-como-corrigir={i.no}>
                            <p className={juntar(texto.corpo, "whitespace-normal")}>{i.corrigir}</p>
                            {i.exemplo && <code className="block whitespace-pre-wrap rounded-md bg-muted px-2 py-1.5 text-[12px]">{i.exemplo}</code>}
                            <span className={texto.auxiliar}>{i.regra}</span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      <JanelaCentral
        aberta={!!pedido}
        onFechar={() => setPedido(null)}
        titulo="Pedir ao motor"
        descricao={pedido ? pedido.item.titulo : undefined}
        ajuda="O motor ajusta uma seção por passada, com a regra citada na instrução, prévia ao vivo e Parar. O custo é a estimativa do catálogo; o teto aborta se passar."
        largura="sm"
        rodape={
          <div className="flex w-full items-center justify-end">
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setPedido(null)} disabled={enviando}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} onClick={() => void confirmarPedido()} disabled={enviando || !pedido || !pedido.secao || pedido.carregando} data-confirmar-pedido="">
              {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Confirmar
            </button>
          </div>
        }
      >
        {pedido && (
          <div className="min-w-0 space-y-3">
            <label className="grid min-w-0">
              <span className={juntar(texto.rotulo, "mb-1.5")}>Seção</span>
              <select className={campo} value={pedido.secao} onChange={(e) => setPedido({ ...pedido, secao: e.target.value })} aria-label="Seção que o motor ajusta">
                {secoes.map((uid) => (
                  <option key={uid} value={uid}>
                    {rotuloDaSecao(uid) || (secaoDaBiblioteca(uid) || { rotulo: uid }).rotulo}
                  </option>
                ))}
              </select>
            </label>
            <p className={juntar(texto.corpo, "whitespace-normal")}>{pedido.item.corrigir}</p>
            <p className={texto.auxiliar}>{pedido.carregando ? "Estimando o custo" : pedido.custo !== null ? `Custo previsto ${usd(pedido.custo)} · teto ${usd(pedido.teto || 0)}` : "Sem estimativa"}</p>
          </div>
        )}
      </JanelaCentral>
    </Secao>
  );
}
