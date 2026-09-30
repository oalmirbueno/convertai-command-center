import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { Carregando } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { CREDITO_DA_BASE, useBaseDaTela } from "@/lib/uiux/carregar";
import { presetDeEstilo } from "../../../supabase/functions/_shared/site-biblioteca";
import type { SugestaoDaBase as Sugestao } from "../../../supabase/functions/_shared/uiux/jev-da-base";

export type RespostaDaSugestao = {
  sugestao: Sugestao;
  pares_info?: Array<{ no: string; nome: string; titulo: string; texto: string }>;
  probabilidades?: Record<string, Record<string, number>>;
  sem_jev?: boolean;
  kit_tem_fontes?: boolean;
  aviso?: string | null;
  custo_usd?: number;
};

export type EscolhasDaSugestao = { produto: string | null; estilo: string | null; padrao: string | null; par: string | null; preset: string | null };

const pct = (p: number) => (p > 0 ? ` ${Math.round(p * 100)}%` : "");

/**
 * A sugestão da base (frente UXM): produto, estilo, padrão, par e preset numa
 * ida só ao Jev, com os 3 primeiros de cada e o primeiro já marcado. "Aplicar"
 * grava o que está marcado (tudo ou um a um, pela caixa de cada grupo); a
 * tela oferece o Desfazer. Trocar o produto refaz a política sem chamar o Jev.
 */
export default function SugestaoDaBase({
  aberta,
  onFechar,
  resposta,
  aplicando,
  recalculando,
  onTrocarProduto,
  onAplicar,
}: {
  aberta: boolean;
  onFechar: () => void;
  resposta: RespostaDaSugestao | null;
  aplicando: boolean;
  recalculando: boolean;
  onTrocarProduto: () => void;
  onAplicar: (e: EscolhasDaSugestao, marcados: Record<keyof EscolhasDaSugestao, boolean>) => void;
}) {
  const { base } = useBaseDaTela(aberta);
  const s = resposta ? resposta.sugestao : null;
  const inicial = (): EscolhasDaSugestao => ({
    produto: s && s.produto.escolhido ? s.produto.escolhido.id : null,
    estilo: s && s.estilos[0] ? s.estilos[0].id : null,
    padrao: s && s.padroes[0] ? s.padroes[0].id : null,
    par: s && s.pares && s.pares[0] ? s.pares[0].id : null,
    preset: s && s.preset ? s.preset.id : null,
  });
  const [escolha, setEscolha] = useState<EscolhasDaSugestao>(inicial);
  const [marcados, setMarcados] = useState<Record<keyof EscolhasDaSugestao, boolean>>({ produto: true, estilo: true, padrao: true, par: true, preset: false });
  useEffect(() => {
    setEscolha(inicial());
    // Resposta nova (sugestão ou produto trocado): volta ao primeiro de cada grupo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resposta]);

  const pt = base ? base.pt : null;
  const grupo = (chave: keyof EscolhasDaSugestao, titulo: string, opcoes: Array<{ id: string; rotulo: string; extra?: string }>, vazio: string) => (
    <div className="min-w-0 border-t border-border pt-3" data-grupo-da-sugestao={chave}>
      <label className="mb-1 flex items-center">
        <input type="checkbox" className="mr-2" checked={marcados[chave] && opcoes.length > 0} disabled={!opcoes.length} onChange={(e) => setMarcados((m) => ({ ...m, [chave]: e.target.checked }))} />
        <span className={texto.tituloSecao}>{titulo}</span>
      </label>
      {!opcoes.length && <p className={texto.auxiliar}>{vazio}</p>}
      <ul className={juntar(lista.aberta)} role="radiogroup" aria-label={titulo}>
        {opcoes.map((o) => (
          <li key={o.id}>
            <label className={juntar(lista.linha, "cursor-pointer", escolha[chave] === o.id && lista.destaque)}>
              <input type="radio" className="mr-2" name={`sugestao-${chave}`} checked={escolha[chave] === o.id} onChange={() => setEscolha((e) => ({ ...e, [chave]: o.id }))} />
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{o.rotulo}</span>
              {o.extra && <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{o.extra}</span>}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );

  const produtos = !s || !pt || !base ? [] : (s.produto.escolhido ? [s.produto.escolhido] : []).concat(s.produto.top.filter((t) => !s.produto.escolhido || t.id !== s.produto.escolhido.id)).slice(0, 3).map((t) => {
    const p = base.base.produtos.filter((x) => x.no === t.id)[0];
    return { id: t.id, rotulo: p ? pt.rotuloDoProduto(p.no, p.nome) : t.id, extra: pct(t.prob) };
  });
  const estilos = !s || !pt ? [] : s.estilos.map((e) => ({ id: e.id, rotulo: pt.rotuloDoEstilo(e.id), extra: `${e.principal ? "principal · " : e.secundario ? "combina · " : ""}nota ${e.nota.toFixed(2)}` }));
  const padroes = !s || !pt ? [] : s.padroes.map((p) => ({ id: p.id, rotulo: pt.rotuloDoPadrao(p.id), extra: `nota ${p.nota.toFixed(2)}` }));
  const infoDoPar = (no: string) => (resposta && resposta.pares_info ? resposta.pares_info.filter((x) => x.no === no)[0] : null);
  const pares = !s || !s.pares ? [] : s.pares.map((p) => {
    const i = infoDoPar(p.id);
    return { id: p.id, rotulo: i ? `${i.nome}: ${i.titulo} + ${i.texto}` : `Par ${p.id}`, extra: pct(p.prob) };
  });
  const preset = s && s.preset ? presetDeEstilo(s.preset.id) : null;

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      titulo="Sugestão da base de design"
      descricao={resposta ? (resposta.sem_jev ? "Escolha à mão: o Jev não respondeu" : `Custo ${usd(resposta.custo_usd || 0)}${resposta.sugestao.rerank ? " · refinado" : ""}`) : undefined}
      ajuda={`O Jev lê a marca, o briefing e as referências e escolhe nas listas completas da base: tipo de produto, estilo, padrão de página e par de fontes, mais o preset da casa. A política soma a probabilidade com o que a base recomenda para o produto. A paleta, as fontes e a logo da marca não mudam. ${CREDITO_DA_BASE}`}
      largura="lg"
      rodape={
        <div className="flex w-full items-center justify-end">
          <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={onFechar} disabled={aplicando}>
            Descartar
          </button>
          <button type="button" className={botao.primario} disabled={aplicando || !resposta} onClick={() => onAplicar(escolha, marcados)} data-aplicar-base="">
            {aplicando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Aplicar marcados
          </button>
        </div>
      }
      data-sugestao-da-base=""
    >
      {!resposta || !pt ? (
        <Carregando forma="lista" rotulo="Carregando a sugestão" />
      ) : (
        <div className="min-w-0 space-y-3">
          {resposta.aviso && <p className={juntar(texto.auxiliar, "whitespace-normal text-warning")}>{resposta.aviso}</p>}
          <div className="min-w-0" data-grupo-da-sugestao="produto">
            <div className="flex min-w-0 items-center">
              <label className="flex min-w-0 flex-1 items-center">
                <input type="checkbox" className="mr-2" checked={marcados.produto && !!escolha.produto} disabled={!escolha.produto} onChange={(e) => setMarcados((m) => ({ ...m, produto: e.target.checked }))} />
                <span className={texto.tituloSecao}>Tipo de produto</span>
              </label>
              <button type="button" className={botao.discreto} onClick={onTrocarProduto} disabled={recalculando}>
                {recalculando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Escolher na lista
              </button>
            </div>
            {!produtos.length && <p className={texto.auxiliar}>O Jev não teve certeza: escolha na lista.</p>}
            <ul className={lista.aberta} role="radiogroup" aria-label="Tipo de produto">
              {produtos.map((o) => (
                <li key={o.id}>
                  <label className={juntar(lista.linha, "cursor-pointer", escolha.produto === o.id && lista.destaque)}>
                    <input type="radio" className="mr-2" name="sugestao-produto" checked={escolha.produto === o.id} onChange={() => setEscolha((e) => ({ ...e, produto: o.id }))} />
                    <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{o.rotulo}</span>
                    {o.extra && <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{o.extra}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {grupo("estilo", "Estilo da base", estilos, "Sem estilo sugerido.")}
          {grupo("padrao", "Padrão de página", padroes, "Nenhum padrão serve para este tipo de site.")}
          {grupo("par", "Par de fontes", pares, resposta.kit_tem_fontes ? "A marca já tem fontes: a base não sugere outras." : "Sem par sugerido.")}
          {grupo("preset", "Preset da casa", preset ? [{ id: preset.id, rotulo: preset.rotulo, extra: s && s.preset ? pct(s.preset.prob) : "" }] : [], "Sem preset sugerido.")}
        </div>
      )}
    </JanelaCentral>
  );
}
