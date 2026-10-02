import { memo, useState, type ReactNode } from "react";
import { Copy, Search, SlidersHorizontal, X } from "lucide-react";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { filtroAtivo, filtrosLigados, OPCOES_DA_DURACAO, OPCOES_DA_ORIGEM, OPCOES_DO_TIPO, OPCOES_DO_USO, type FiltroDaBusca } from "@/lib/editor/busca";

/**
 * Busca com filtros do editor (02/10): um campo de busca e, recolhidos atrás
 * de "Filtros", tipo, origem, uso e duração, mais "Só repetidos". A Mídia e a
 * linha do tempo usam o mesmo filtro (buscaDoEditor.ts), e o agente também.
 */
function BuscaComFiltros({
  filtro,
  mudar,
  limpar,
  rotulo,
  comUso = true,
  contagem,
  extra,
}: {
  filtro: FiltroDaBusca;
  mudar: (f: Partial<FiltroDaBusca>) => void;
  limpar: () => void;
  /** Nome do campo para leitor de tela ("Buscar na mídia"). */
  rotulo: string;
  /** A linha do tempo não tem "usado ou não" (tudo nela está em uso). */
  comUso?: boolean;
  /** "3 de 12" ao lado do campo. */
  contagem?: string | null;
  /** Ação ao lado (ex.: escolher os achados). */
  extra?: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const ligados = filtrosLigados(filtro);
  const ativo = filtroAtivo(filtro);
  const escolha = <T extends string>(nome: string, valor: T, opcoes: { valor: T; rotulo: string }[], chave: keyof FiltroDaBusca) => (
    <select className={juntar(campo, "h-8 px-2 text-[12px]")} value={valor} onChange={(e) => mudar({ [chave]: e.target.value } as Partial<FiltroDaBusca>)} aria-label={nome}>
      {opcoes.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.rotulo}
        </option>
      ))}
    </select>
  );
  return (
    <div className="min-w-0" data-busca-com-filtros="">
      <div className="flex min-w-0 items-center gap-1">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            className={juntar(campo, "h-8 pl-7 pr-2 text-[12.5px]")}
            placeholder="Buscar por nome ou c3"
            value={filtro.texto}
            onChange={(e) => mudar({ texto: e.target.value })}
            aria-label={rotulo}
          />
        </label>
        <button
          type="button"
          className={juntar(botao.barra, "gap-1", (aberto || ligados > 0) && "text-foreground")}
          onClick={() => setAberto((x) => !x)}
          aria-expanded={aberto}
          aria-label={`Filtros${ligados ? ` (${ligados} ligados)` : ""}`}
          title="Filtros"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {ligados > 0 && <span className="tabular-nums">{ligados}</span>}
        </button>
        {ativo && (
          <button type="button" className={botao.icone} onClick={limpar} aria-label="Limpar a busca" title="Limpar a busca">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {extra}
      </div>
      {aberto && (
        <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5" data-filtros-abertos="">
          {escolha("Tipo", filtro.tipo, OPCOES_DO_TIPO, "tipo")}
          {escolha("Origem", filtro.origem, OPCOES_DA_ORIGEM, "origem")}
          {comUso && escolha("Uso", filtro.uso, OPCOES_DO_USO, "uso")}
          {escolha("Duração", filtro.duracao, OPCOES_DA_DURACAO, "duracao")}
          <button
            type="button"
            className={juntar(botao.barra, "col-span-2 justify-start gap-1.5 border border-border", filtro.duplicados && "border-primary/50 bg-primary/10 text-primary")}
            onClick={() => mudar({ duplicados: !filtro.duplicados })}
            aria-pressed={filtro.duplicados}
          >
            <Copy className="h-3.5 w-3.5" />
            Só repetidos
          </button>
        </div>
      )}
      {contagem && ativo && <p className={juntar(texto.auxiliar, "mt-1")} aria-live="polite">{contagem}</p>}
    </div>
  );
}

export default memo(BuscaComFiltros);
