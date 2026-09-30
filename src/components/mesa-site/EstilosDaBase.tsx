import { useMemo, useState } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import CampoDeBusca from "@/components/sistema/CampoDeBusca";
import { EstadoDeErro, Carregando } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { useBaseDaTela } from "@/lib/uiux/carregar";
import { presetDeEstilo } from "../../../supabase/functions/_shared/site-biblioteca";
import { rotuloDoAtributo } from "../../../supabase/functions/_shared/site-metodo";
import { casaComBusca, conflitaComProduto, estilosAtivos, estilosDoProduto, modoDoEstilo, produtoPorId, type EstiloParaConsulta } from "../../../supabase/functions/_shared/uiux/consultas";
import { PRESET_DO_ESTILO } from "../../../supabase/functions/_shared/uiux/mapeamentos";
import { PreviaDoPreset } from "./PreviaDoPreset";

const ROTULO_DO_MODO = { claro: "claro", escuro: "escuro", os_dois: "claro ou escuro" } as const;

/**
 * Os 50 estilos ativos da base UI UX Pro Max (frente UXM), ao lado dos 11
 * presets da casa. No topo, os que combinam com o tipo de produto da marca
 * (principal e secundários, com o selo "recomendado"); depois os demais, com
 * busca. A miniatura usa sempre o destaque da MARCA (nunca a cor da base), o
 * preset da casa ligado ao estilo e o DNA do próprio estilo (é o DNA que vai
 * para o site ao escolher: estilos com o mesmo preset ficam diferentes). A
 * base carrega sob demanda.
 */
export default function EstilosDaBase({
  destaque,
  nome,
  produtoNo,
  escolhido,
  ocupado,
  onEscolher,
}: {
  destaque: string;
  nome: string;
  produtoNo: string | null;
  escolhido: string | null;
  ocupado: boolean;
  onEscolher: (id: string) => void;
}) {
  const { base, erro, tentarDeNovo } = useBaseDaTela(true);
  const [busca, setBusca] = useState("");
  const dados = useMemo(() => {
    if (!base) return null;
    const produto = produtoNo ? produtoPorId(base.base, produtoNo) : null;
    const recomendados = estilosDoProduto(base.base, produto);
    const ids = recomendados.principais.concat(recomendados.secundarios);
    const todos = estilosAtivos(base.base);
    return { produto, recomendados, topo: ids.map((id) => todos.filter((e) => e.id === id)[0]).filter((e): e is EstiloParaConsulta => !!e), resto: todos.filter((e) => ids.indexOf(e.id) < 0) };
  }, [base, produtoNo]);

  if (erro) return <EstadoDeErro titulo="Os estilos da base não abriram" descricao={erro} acao={<button type="button" className={botao.secundario} onClick={tentarDeNovo}>Tentar de novo</button>} />;
  if (!base || !dados) return <Carregando forma="grade" rotulo="Carregando os estilos da base" />;
  const pt = base.pt;
  const rotuloDoProduto = dados.produto ? pt.rotuloDoProduto(dados.produto.no, dados.produto.nome) : null;
  const filtrar = (l: EstiloParaConsulta[]) =>
    busca.trim() ? l.filter((e) => casaComBusca(`${pt.rotuloDoEstilo(e.id, e.nome)} ${e.nome} ${e.palavras} ${e.melhorPara} ${(pt.ESTILO_EM_PORTUGUES[e.id] || { resumo: "" }).resumo}`, busca)) : l;

  const cartao = (e: EstiloParaConsulta, selo: string | null) => {
    const lig = PRESET_DO_ESTILO[e.id];
    const preset = lig ? presetDeEstilo(lig.preset) : null;
    const ptEstilo = pt.ESTILO_EM_PORTUGUES[e.id];
    const ligado = e.id === escolhido;
    const alerta = conflitaComProduto(e, dados.produto);
    const dna = lig && lig.dna.length ? lig.dna.map(rotuloDoAtributo).join(", ") : "";
    return (
      <button
        key={e.id}
        type="button"
        role="radio"
        aria-checked={ligado}
        disabled={ocupado}
        onClick={() => onEscolher(e.id)}
        title={`${e.nome}. Preset da casa ligado: ${preset ? preset.rotulo : "nenhum"}${dna ? `. DNA: ${dna}` : ""}`}
        className={juntar("min-w-0 rounded-md p-1 text-left transition-colors", ligado ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-muted")}
        data-estilo-da-base={e.id}
      >
        {preset ? <PreviaDoPreset p={preset} destaque={destaque} nome={nome} dna={lig ? lig.dna : null} /> : null}
        <span className="mt-1.5 flex min-w-0 items-center px-1">
          <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{pt.rotuloDoEstilo(e.id, e.nome)}</span>
          {ligado ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> : <span className={juntar(etiqueta, "bg-muted")}>{ROTULO_DO_MODO[modoDoEstilo(e)]}</span>}
        </span>
        {selo && <span className={juntar(etiqueta, "ml-1 mt-1 inline-block bg-primary/15 text-primary")} data-recomendado="">{selo}</span>}
        {ptEstilo && <span className={juntar(texto.auxiliar, "block truncate px-1")}>{ptEstilo.resumo}</span>}
        {dna && <span className={juntar(texto.auxiliar, "block truncate px-1")} data-dna-do-estilo="">DNA: {dna}</span>}
        {alerta && ptEstilo && (
          <span className={juntar(texto.auxiliar, "flex min-w-0 items-center px-1 text-warning")} data-nao-usar-para="">
            <CircleAlert className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">Não usar para: {ptEstilo.evitar}</span>
          </span>
        )}
      </button>
    );
  };

  const topo = filtrar(dados.topo);
  const resto = filtrar(dados.resto);
  return (
    <div className="min-w-0 space-y-3" data-estilos-da-base="">
      <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar estilo (ex.: minimalista, escuro, vidro)" rotulo="Buscar estilo da base" className="max-w-sm" />
      {rotuloDoProduto && topo.length > 0 && (
        <div className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1.5 block")}>Combinam com {rotuloDoProduto}</span>
          <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label={`Estilos que combinam com ${rotuloDoProduto}`}>
            {topo.map((e) => cartao(e, dados.recomendados.principais.indexOf(e.id) >= 0 ? "recomendado" : "combina"))}
          </div>
        </div>
      )}
      {!rotuloDoProduto && <p className={texto.auxiliar}>Escolha o tipo de produto para ver os estilos que combinam.</p>}
      <div className="min-w-0">
        <span className={juntar(texto.rotulo, "mb-1.5 block")}>{rotuloDoProduto ? "Outros estilos" : "Todos os estilos"} · {resto.length}</span>
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label="Estilos da base">
          {resto.map((e) => cartao(e, null))}
        </div>
        {!topo.length && !resto.length && <p className={texto.auxiliar}>Nenhum estilo com essa busca.</p>}
      </div>
      {ocupado && (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Salvando o estilo
        </p>
      )}
    </div>
  );
}
