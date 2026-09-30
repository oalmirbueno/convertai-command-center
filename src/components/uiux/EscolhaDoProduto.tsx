import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import CampoDeBusca from "@/components/sistema/CampoDeBusca";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { CREDITO_DA_BASE, useBaseDaTela } from "@/lib/uiux/carregar";
import { casaComBusca } from "../../../supabase/functions/_shared/uiux/consultas";

/**
 * O tipo de produto da marca, escolhido numa lista com busca (frente UXM):
 * os 192 tipos da base UI UX Pro Max com o rótulo em português. É o caminho
 * sem o Jev ("escolha à mão") e o jeito de trocar o que o Jev sugeriu. Os
 * sugeridos (com a probabilidade) vêm primeiro. Abre no centro (JanelaCentral).
 */
export default function EscolhaDoProduto({
  aberta,
  onFechar,
  atual,
  sugeridos = [],
  onEscolher,
}: {
  aberta: boolean;
  onFechar: () => void;
  atual: string | null;
  sugeridos?: Array<{ id: string; prob: number }>;
  onEscolher: (no: string) => void;
}) {
  const { base, erro, tentarDeNovo } = useBaseDaTela(aberta);
  const [busca, setBusca] = useState("");
  const produtos = useMemo(() => {
    if (!base) return [];
    return base.base.produtos.map((p) => ({ no: p.no, rotulo: base.pt.rotuloDoProduto(p.no, p.nome), nome: p.nome })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  }, [base]);
  const filtrados = busca.trim() ? produtos.filter((p) => casaComBusca(`${p.rotulo} ${p.nome}`, busca)) : produtos;
  const doJev = sugeridos.map((s) => ({ ...s, p: produtos.filter((x) => x.no === s.id)[0] })).filter((s) => !!s.p);
  const linha = (p: { no: string; rotulo: string; nome: string }, extra?: string) => (
    <li key={`${extra || ""}${p.no}`}>
      <button type="button" className={juntar(lista.linha, "w-full text-left", p.no === atual && lista.destaque)} onClick={() => onEscolher(p.no)} data-produto={p.no}>
        <span className="mr-2 min-w-0 flex-1">
          <span className={juntar(texto.corpo, "block truncate")}>{p.rotulo}</span>
          <span className={juntar(texto.auxiliar, "block truncate")}>{p.nome}</span>
        </span>
        {extra && <span className={juntar(etiqueta, "mr-2 bg-muted")}>{extra}</span>}
        {p.no === atual && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Atual" />}
      </button>
    </li>
  );
  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      titulo="Tipo de produto"
      descricao={base ? `${filtrados.length} de ${produtos.length}` : undefined}
      ajuda={`O tipo de produto liga a marca às recomendações da base: estilos que combinam, padrão de página, paleta de referência do setor e pares de fontes. ${CREDITO_DA_BASE}`}
      largura="md"
      abaixoDoTitulo={<CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar (ex.: clínica, advocacia, padaria)" rotulo="Buscar tipo de produto" />}
      data-escolha-do-produto=""
    >
      {erro && <EstadoDeErro titulo="A lista não abriu" descricao={erro} acao={<button type="button" className={botao.secundario} onClick={tentarDeNovo}>Tentar de novo</button>} />}
      {!erro && !base && <Carregando forma="lista" rotulo="Carregando os tipos de produto" />}
      {base && doJev.length > 0 && !busca.trim() && (
        <div className="mb-3 min-w-0">
          <span className={juntar(texto.rotulo, "block")}>Sugeridos pelo Jev</span>
          <ul className={juntar(lista.aberta, lista.divisoria)}>{doJev.map((s) => linha(s.p!, `${Math.round(s.prob * 100)}%`))}</ul>
        </div>
      )}
      {base && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Tipos de produto">
          {filtrados.map((p) => linha(p))}
        </ul>
      )}
      {base && !filtrados.length && <p className={texto.auxiliar}>Nenhum tipo com essa busca.</p>}
    </JanelaCentral>
  );
}
