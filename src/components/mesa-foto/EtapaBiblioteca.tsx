import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, CornerDownLeft, Download, ExternalLink, Filter, ImageIcon, ImageOff, Loader2, Package, Search, Sparkles, Star, Users, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Ampliar, type ImagemAmpliavel } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara, usd } from "@/lib/mesa/api";
import { Cartao, Moldura, Vazio, useMesaFoto } from "./Comuns";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { campo, juntar, superficie, texto as textoDoSistema } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import {
  buscarReferencias,
  chaveDaBiblioteca,
  estimarExemplosDaBiblioteca,
  gerarExemploDaBiblioteca,
  gerarProximoExemplo,
  limparExemplosDaBiblioteca,
  importarReferencia,
  partesDoExemplo,
  salvarNaBiblioteca,
  useBiblioteca,
  useKits,
  type EstimativaDosExemplos,
  type ItemDaBiblioteca,
  type LimpezaDaBiblioteca,
  type ReferenciaEncontrada,
} from "./fotoApi";
import {
  areaDoItem,
  buscasLivresDaArea,
  categoriaDaArea,
  ehAreaDoArsenal,
  produtosDosKits,
  promptDoItem,
  promptsDoCliente,
  relevante,
  rotuloDaArea,
  type AreaDoArsenal,
  type DadosDoPrompt,
  type ProdutoDoArsenal,
} from "./arsenalDaBiblioteca";
import { BotaoCopiarTexto, copiarParaAreaDeTransferencia, entregarPromptDoArsenal, IconeDaArea, ListaDoArsenal, ROLAGEM_DO_ARSENAL, SeletorDaArea } from "./PainelDoArsenal";
import EntradaDoArsenal from "./EntradaDoArsenal";


/**
 * Etapa Biblioteca, agora "Arsenal de prompts" (pedido do dono, 02/10, item
 * 9 da Mesa Foto): tudo organizado por área da foto (Produto, Modelo,
 * Cenário, Luz, Ângulo, Detalhe, Composição), com os prompts montados para
 * o produto do cliente (o molde com o produto já preenchido) e sem o que é
 * de outro segmento (frasco de vidro para uma ótica). A lógica é pura, em
 * arsenalDaBiblioteca.ts.
 *
 * - Cada lista rola por dentro, com altura limitada em qualquer largura: a
 *   busca e os resultados não empurram mais a página inteira.
 * - Prompt: Copiar (já preenchido), Copiar em inglês, Usar (entrega ao
 *   pedido aberto, PainelDoArsenal) e o exemplo do resultado (ou Gerar
 *   exemplo, pago, com o preço antes).
 * - Referência: só as que têm imagem; as sem imagem ficam atrás de "Sem
 *   imagem (n)". Licença e autor sempre à vista (regra do dono).
 * - Referências livres: Openverse por área (Modelo busca pessoas e
 *   retratos), com licença e autor; "Importar" traz para o cliente na
 *   categoria da área.
 *
 * Histórico: 25/09 exemplo maior com "ver grande"; 26/09 título, busca e
 * filtros numa linha, guardados por cliente.
 */

export { copiarParaAreaDeTransferencia };

/** Imagem de um item: do Storage (importada ou gerada) ou a URL pública da fonte; a miniatura quando houver. */
export function ImagemDaBiblioteca({ item }: { item: Pick<ItemDaBiblioteca, "storage_path" | "imagem_url" | "titulo"> & { miniatura_url?: string | null } }) {
  if (item.storage_path) return <ImagemDaMesa caminho={item.storage_path} alt={item.titulo} className="h-full w-full" />;
  const url = item.miniatura_url || item.imagem_url;
  if (url) return <img src={url} alt={item.titulo} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />;
  return <span className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">sem imagem</span>;
}

/** Tem imagem para mostrar (exemplo do prompt ou a referência). */
export const temImagem = (i: Pick<ItemDaBiblioteca, "storage_path" | "imagem_url" | "miniatura_url">) => !!(i.storage_path || i.imagem_url || i.miniatura_url);

/** O que o "ver grande" abre: a imagem cheia (Storage ou URL). */
export function ampliavelDoItem(i: ItemDaBiblioteca): ImagemAmpliavel {
  return {
    caminho: i.storage_path || i.imagem_url || i.miniatura_url || "",
    bucket: i.storage_path ? "mesa" : undefined,
    titulo: i.titulo,
    legenda: i.exemplo_gerado ? "Exemplo gerado por IA" : [i.licenca, i.autor].filter(Boolean).join(" · ") || undefined,
  };
}

/** Licença e autor, sempre à vista (regra do dono). Sem dado, diz que falta. */
export function LicencaEAutor({
  item,
  compacta = false,
}: {
  item: { licenca: string; autor: string; autor_url?: string; fonte_nome?: string; fonte_url?: string };
  compacta?: boolean;
}) {
  const licenca = item.licenca || "licença não informada";
  const autor = item.autor || "autor não informado";
  if (compacta) {
    return (
      <span className="block truncate text-[11px] text-muted-foreground" title={`${licenca} · ${autor}`} data-licenca="">
        {licenca} · {autor}
      </span>
    );
  }
  return (
    <p className="text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]" data-licenca="">
      <span className={item.licenca ? "font-medium text-foreground" : "text-warning"}>{licenca}</span> ·{" "}
      {item.autor_url ? (
        <a href={item.autor_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {autor}
        </a>
      ) : (
        autor
      )}
      {item.fonte_nome && (
        <>
          {" · "}
          {item.fonte_url ? (
            <a href={item.fonte_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline">
              {item.fonte_nome} <ExternalLink className="ml-0.5 h-3 w-3" />
            </a>
          ) : (
            item.fonte_nome
          )}
        </>
      )}
    </p>
  );
}

function useSalvarComoMeu() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [salvando, setSalvando] = useState<string | null>(null);
  const salvar = async (item: ItemDaBiblioteca) => {
    setSalvando(item.id);
    try {
      await salvarNaBiblioteca(clientId, item);
      toast.success("Salvo na biblioteca do cliente");
      void queryClient.invalidateQueries({ queryKey: chaveDaBiblioteca(clientId) });
    } catch (e) {
      avisarErro(e, "Não salvo");
    } finally {
      setSalvando(null);
    }
  };
  return { salvar, salvando };
}

/** A miniatura do exemplo do prompt; sem imagem, o botão "Gerar exemplo" com o preço. */
function ExemploDoPrompt({ item, onAmpliar }: { item: ItemDaBiblioteca; onAmpliar: () => void }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  if (temImagem(item)) {
    return (
      <button type="button" onClick={onAmpliar} className="relative block w-full shrink-0 cursor-zoom-in sm:w-40" aria-label={`Ver grande o exemplo de ${item.titulo}`} data-exemplo={item.exemplo_gerado ? "gerado" : "publico"}>
        <Moldura proporcao={4 / 3}>
          <ImagemDaBiblioteca item={item} />
        </Moldura>
        <span className="pointer-events-none absolute right-1 top-1 inline-flex items-center rounded-full border border-border bg-card px-1.5 py-px text-[11px] text-muted-foreground" aria-hidden="true">
          <ZoomIn className="mr-0.5 h-3 w-3" /> ver grande
        </span>
        {item.exemplo_gerado && (
          <span className="pointer-events-none absolute bottom-1 left-1 rounded-full border border-primary/30 bg-card px-1 text-[11px] font-semibold text-primary" data-selo="exemplo-gerado">
            exemplo gerado
          </span>
        )}
      </button>
    );
  }
  return (
    <div className="flex w-full shrink-0 flex-col items-center sm:w-40" data-exemplo="">
      <Moldura proporcao={4 / 3}>
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className="h-4 w-4" />
        </span>
      </Moldura>
      <BotaoComCusto
        rotulo={
          <>
            <Sparkles className="mr-1 h-3 w-3" /> Gerar exemplo
          </>
        }
        titulo="Exemplo gerado"
        descricao="Gera uma imagem de exemplo deste prompt (paga, uma vez). Fica marcada como exemplo gerado."
        variant="ghost"
        className="mt-1 h-auto w-full whitespace-normal px-1 py-1 text-[11px] leading-tight"
        partes={() => partesDoExemplo(catalogo)}
        executar={() => {
          const m = padraoPara(catalogo, "imagem");
          return gerarExemploDaBiblioteca(clientId, item.id, m ? m.id : null);
        }}
        aoConcluir={() => {
          void queryClient.invalidateQueries({ queryKey: chaveDaBiblioteca(clientId) });
        }}
      />
    </div>
  );
}

function CartaoDoPrompt({
  item,
  dados,
  onSalvar,
  salvando,
  onAmpliar,
  onUsar,
}: {
  item: ItemDaBiblioteca;
  dados: DadosDoPrompt;
  onSalvar: () => void;
  salvando: boolean;
  onAmpliar: () => void;
  onUsar: (texto: string) => void;
}) {
  const [ingles, setIngles] = useState(false);
  // O molde já preenchido com o produto escolhido (sem produto, fica como veio).
  const pt = promptDoItem(item, dados, false);
  const en = item.prompt_en ? promptDoItem(item, dados, true) : "";
  const texto = ingles ? en : pt;
  const area = areaDoItem(item);
  return (
    <li className={juntar(superficie.painel, "flex min-w-0 flex-col p-3 sm:flex-row sm:items-start")} data-prompt={item.id} data-area={area}>
      <ExemploDoPrompt item={item} onAmpliar={onAmpliar} />
      <div className="mt-2 min-w-0 flex-1 space-y-2 sm:ml-3 sm:mt-0">
        <div className="flex min-w-0 items-start">
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center text-[13px] font-semibold">
              {item.destaque && <Star className="mr-1 h-3.5 w-3.5 shrink-0 text-warning" aria-label="Destaque" />}
              <span className="truncate">{item.titulo}</span>
            </p>
            <p className="flex min-w-0 items-center text-[11px] text-muted-foreground">
              <IconeDaArea area={area} className="mr-1 h-3 w-3 shrink-0" />
              {rotuloDaArea(area)} · {item.client_id ? "deste cliente" : "da agência"}
            </p>
          </div>
          {item.prompt_en && item.prompt_pt && (
            <button type="button" onClick={() => setIngles(!ingles)} className="ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted" aria-pressed={ingles}>
              {ingles ? "Ver em português" : "Ver em inglês"}
            </button>
          )}
        </div>
        {item.uso && (
          <p className="text-[12px] leading-snug [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">Quando usar: </span>
            {item.uso}
          </p>
        )}
        <p className="rounded-md bg-muted/60 px-2.5 py-2 font-mono text-[12px] leading-relaxed [overflow-wrap:anywhere]" data-prompt-preenchido="">
          {texto || "Sem texto"}
        </p>
        {item.negativo && (
          <p className="text-[12px] leading-snug [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">Evitar: </span>
            {item.negativo}
          </p>
        )}
        <LicencaEAutor item={item} />
        <div className="flex flex-wrap items-center [&>*]:mb-1">
          <BotaoCopiarTexto texto={pt || en} rotulo="Copiar" />
          {item.prompt_en && item.prompt_pt && <BotaoCopiarTexto texto={en} rotulo="Copiar em inglês" />}
          {item.negativo && <BotaoCopiarTexto texto={item.negativo} rotulo="Copiar o evitar" />}
          <button
            type="button"
            disabled={!(pt || en)}
            onClick={() => onUsar(ingles ? en : pt || en)}
            aria-label={`Usar ${item.titulo}`}
            className="toque-compacto mr-1 inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[12px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            <CornerDownLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Usar
          </button>
          {!item.client_id && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]" disabled={salvando} onClick={onSalvar}>
              {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="mr-1 h-3.5 w-3.5" />}
              Salvar como meu
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function CartaoDaReferencia({ item, onSalvar, salvando, onAmpliar }: { item: ItemDaBiblioteca; onSalvar: () => void; salvando: boolean; onAmpliar: () => void }) {
  const area = areaDoItem(item);
  return (
    <li className={juntar(superficie.painel, "min-w-0 p-1")} data-referencia={item.id} data-area={area}>
      <button type="button" onClick={onAmpliar} className="relative block w-full cursor-zoom-in" aria-label={`Ver grande ${item.titulo}`}>
        <Moldura proporcao={4 / 5}>
          <ImagemDaBiblioteca item={item} />
        </Moldura>
        <span className="pointer-events-none absolute right-1 top-1 inline-flex items-center rounded-full border border-border bg-card px-1.5 py-px text-[11px] text-muted-foreground" aria-hidden="true">
          <ZoomIn className="h-3 w-3" />
        </span>
      </button>
      <div className="space-y-0.5 px-0.5 pt-1">
        <p className="truncate text-[11px] font-medium" title={item.titulo}>
          {item.titulo}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {rotuloDaArea(area)} · {item.client_id ? "deste cliente" : "da agência"}
        </p>
        {item.uso && <p className="truncate text-[11px] text-muted-foreground" title={item.uso}>Quando usar: {item.uso}</p>}
        <LicencaEAutor item={item} />
        {!item.client_id && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-[12px]" disabled={salvando} onClick={onSalvar}>
            {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="mr-1 h-3.5 w-3.5" />}
            Salvar como meu
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Referências livres (Openverse, sem chave): buscas prontas pela área (Modelo
 * busca pessoas e retratos) e busca livre. Os resultados rolam por dentro;
 * "Importar" grava no cliente na categoria da área, com licença e autor.
 */
function ReferenciasLivres({ area, produtos }: { area: AreaDoArsenal | "todas"; produtos: ProdutoDoArsenal[] }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ReferenciaEncontrada[] | null>(null);
  const [importando, setImportando] = useState<string | null>(null);
  const [importadas, setImportadas] = useState<string[]>([]);
  const sugestoes = useMemo(() => buscasLivresDaArea(area, produtos), [area, produtos]);
  const categoria = categoriaDaArea(area);

  const buscar = async (termo: string) => {
    const t = termo.trim();
    if (!t || buscando) return;
    setBuscando(true);
    try {
      setResultados(await buscarReferencias(t));
    } catch (e) {
      avisarErro(e, "Busca não feita");
    } finally {
      setBuscando(false);
    }
  };

  const importar = async (r: ReferenciaEncontrada) => {
    setImportando(r.chave);
    try {
      await importarReferencia(clientId, r, categoria);
      setImportadas((l) => l.concat([r.chave]));
      toast.success("Referência importada", { description: `${r.licenca || "Licença não informada"} · ${r.autor || "autor não informado"}` });
      void queryClient.invalidateQueries({ queryKey: chaveDaBiblioteca(clientId) });
    } catch (e) {
      avisarErro(e, "Referência não importada");
    } finally {
      setImportando(null);
    }
  };

  return (
    <Cartao titulo="Referências livres" dica="Imagens públicas do Openverse, com licença e autor. Referência guia clima, luz, pose e composição; nunca é o assunto. Importar grava no cliente, na área escolhida.">
      <div className="mb-2 flex min-w-0 flex-wrap items-center" data-buscas-da-area={area}>
        <IconeDaArea area={area} className="mb-1 mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {sugestoes.map((s) => (
          <button
            key={s}
            type="button"
            disabled={buscando}
            onClick={() => {
              setQ(s);
              void buscar(s);
            }}
            className="toque-compacto mb-1 mr-1 inline-flex h-7 shrink-0 items-center rounded-md border border-input px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            data-busca-sugerida={s}
          >
            {s}
          </button>
        ))}
      </div>
      <form
        className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void buscar(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: portrait natural light, wood table, flat lay" aria-label="O que buscar" className={campo} />
        <Button type="submit" size="sm" className="h-9 text-[13px]" disabled={!q.trim() || buscando}>
          {buscando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
          Buscar referências
        </Button>
      </form>
      {resultados && resultados.length === 0 && <p className="mt-3 text-[12px] text-muted-foreground">Nada encontrado. Tente em inglês ou com menos palavras.</p>}
      {resultados && resultados.length > 0 && (
        <ul className={juntar(ROLAGEM_DO_ARSENAL, "mt-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4")} aria-label="Resultados da busca" data-rolagem-do-arsenal="" data-resultados-livres="">
          {resultados.map((r) => {
            const ja = importadas.indexOf(r.chave) >= 0;
            return (
              <li key={r.chave} className="min-w-0 rounded-lg border border-border p-1.5">
                <Moldura proporcao={1}>
                  <img src={r.miniatura_url} alt={r.titulo} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                </Moldura>
                <p className="mt-1 truncate px-0.5 text-[12px] font-medium" title={r.titulo}>
                  {r.titulo}
                </p>
                <div className="px-0.5">
                  <LicencaEAutor item={r} />
                </div>
                <Button type="button" size="sm" variant={ja ? "ghost" : "outline"} className="mt-1 h-7 w-full text-[12px]" disabled={ja || importando === r.chave} onClick={() => void importar(r)}>
                  {importando === r.chave ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : ja ? <Check className="mr-1 h-3.5 w-3.5" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                  {ja ? "Importada" : "Importar"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Cartao>
  );
}

type TipoFiltro = "todos" | "prompt" | "referencia";
type OrigemFiltro = "todas" | "agencia" | "cliente";

export function filtrarBiblioteca(itens: ItemDaBiblioteca[], tipo: TipoFiltro, categoria: string, origem: OrigemFiltro, busca: string): ItemDaBiblioteca[] {
  const termo = busca.trim().toLowerCase();
  return itens.filter((i) => {
    if (tipo !== "todos" && i.tipo !== tipo) return false;
    if (categoria !== "todas" && i.categoria !== categoria) return false;
    if (origem === "agencia" && i.client_id) return false;
    if (origem === "cliente" && !i.client_id) return false;
    if (termo && `${i.titulo} ${i.prompt_pt} ${i.prompt_en} ${i.tags.join(" ")} ${i.autor} ${i.fonte_nome}`.toLowerCase().indexOf(termo) < 0) return false;
    return true;
  });
}

const TIPOS_DO_FILTRO: TipoFiltro[] = ["todos", "prompt", "referencia"];
const ORIGENS_DO_FILTRO: OrigemFiltro[] = ["todas", "agencia", "cliente"];

/** Alterna pequeno ("Sem imagem (3)", "Outros segmentos (5)"): mostra o que fica escondido por padrão. */
function Alternar({ ligado, onAlternar, icone, children }: { ligado: boolean; onAlternar: () => void; icone: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ligado}
      onClick={onAlternar}
      className={juntar(
        "toque-compacto mb-1 mr-1.5 inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[12px]",
        ligado ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icone}
      <span className="ml-1">{children}</span>
    </button>
  );
}

export default function EtapaBiblioteca({ onUsarPrompt }: { onUsarPrompt?: (texto: string) => void } = {}) {
  const { clientId, isAdmin } = useMesa();
  const { kitId } = useMesaFoto();
  const biblioteca = useBiblioteca(clientId);
  const kits = useKits(clientId);
  const { salvar, salvando } = useSalvarComoMeu();
  // Busca e filtros guardados por cliente (useEstadoDaTela): sair e voltar mantém.
  const [tipo, setTipo] = useEstadoDaTela<TipoFiltro>(`mesa-foto:biblioteca:tipo:${clientId}`, "todos", { validar: (v) => TIPOS_DO_FILTRO.indexOf(v as TipoFiltro) >= 0 });
  const [area, setArea] = useEstadoDaTela<AreaDoArsenal | "todas">(`mesa-foto:biblioteca:area:${clientId}`, "todas", { validar: (v) => v === "todas" || ehAreaDoArsenal(v) });
  const [origem, setOrigem] = useEstadoDaTela<OrigemFiltro>(`mesa-foto:biblioteca:origem:${clientId}`, "todas", { validar: (v) => ORIGENS_DO_FILTRO.indexOf(v as OrigemFiltro) >= 0 });
  const [busca, setBusca] = useEstadoDaTela(`mesa-foto:biblioteca:busca:${clientId}`, "");
  const [produtoEscolhido, setProdutoEscolhido] = useEstadoDaTela(`mesa-foto:biblioteca:produto:${clientId}`, "");
  const [verSemImagem, setVerSemImagem] = useState(false);
  const [verOutros, setVerOutros] = useState(false);
  const [ampliada, setAmpliada] = useState<ItemDaBiblioteca | null>(null);

  const itens = useMemo(() => biblioteca.data || [], [biblioteca.data]);
  const produtosDoCliente = useMemo(() => produtosDosKits(kits.data || []), [kits.data]);
  const nomeDoKitAberto = useMemo(() => {
    const k = (kits.data || []).find((x) => x.id === kitId && x.tipo !== "pessoa");
    return k ? produtosDosKits([k])[0]?.nome || "" : "";
  }, [kits.data, kitId]);
  // Produto que preenche os moldes: o escolhido, senão o kit aberto, senão o primeiro.
  const produto: ProdutoDoArsenal | null = useMemo(() => {
    const porNome = (n: string) => produtosDoCliente.find((p) => p.nome === n) || null;
    return porNome(produtoEscolhido) || porNome(nomeDoKitAberto) || produtosDoCliente[0] || null;
  }, [produtosDoCliente, produtoEscolhido, nomeDoKitAberto]);
  const produtos = useMemo(() => (produto ? [produto] : []), [produto]);
  const dados: DadosDoPrompt = useMemo(() => (produto ? { produto: produto.nome, tipo: produto.tipo, marca: produto.marca } : {}), [produto]);

  const filtrados = useMemo(() => filtrarBiblioteca(itens, tipo, "todas", origem, busca), [itens, tipo, origem, busca]);
  const doProduto = useMemo(() => filtrados.filter((i) => relevante(i, produtos)), [filtrados, produtos]);
  const foraDoProduto = filtrados.length - doProduto.length;
  const base = verOutros ? filtrados : doProduto;
  const contagem = useMemo(() => {
    const c: Partial<Record<AreaDoArsenal | "todas", number>> = { todas: base.length };
    for (const i of base) {
      const a = areaDoItem(i);
      c[a] = (c[a] || 0) + 1;
    }
    return c;
  }, [base]);
  const naArea = area === "todas" ? base : base.filter((i) => areaDoItem(i) === area);
  const prompts = naArea.filter((i) => i.tipo === "prompt");
  const todasAsReferencias = naArea.filter((i) => i.tipo === "referencia");
  const referenciasComImagem = todasAsReferencias.filter(temImagem);
  const semImagem = todasAsReferencias.length - referenciasComImagem.length;
  const referencias = verSemImagem ? todasAsReferencias : referenciasComImagem;
  const logica = useMemo(() => (tipo === "referencia" ? [] : promptsDoCliente([], produtos, { area })), [tipo, produtos, area]);
  const comFiltro = tipo !== "todos" || area !== "todas" || origem !== "todas" || !!busca.trim();
  const usar = (t: string) => {
    if (onUsarPrompt) onUsarPrompt(t);
    else void entregarPromptDoArsenal(clientId, t);
  };

  return (
    <div className="min-w-0 space-y-5 pb-6" data-arsenal-de-prompts="">
      {/* 02/10: foto que veio de um resultado (Book, Aprovar) para virar prompt do cliente. */}
      <EntradaDoArsenal />
      <div className="min-w-0">
        {/* Título, busca e filtros na mesma linha (quebra no celular). */}
        <div className="flex min-w-0 flex-wrap items-center" data-filtros-da-biblioteca="">
          <div className="mb-2 mr-3 flex min-w-0 items-center">
            <h2 className={textoDoSistema.tituloSecao}>Arsenal de prompts</h2>
            <AjudaRecolhida className="ml-1.5" rotulo="Sobre o arsenal">
              Prompts e referências por área da foto, montados para o produto do cliente. Copie, use no pedido ou guie o Preparar e o Ensaio em "Como guiar esta foto". Licença e autor sempre à vista.
            </AjudaRecolhida>
            {biblioteca.isSuccess && <span className={juntar(textoDoSistema.auxiliar, "ml-2 tabular-nums")}>{comFiltro || foraDoProduto ? `${naArea.length} de ${itens.length}` : itens.length}</span>}
          </div>
          <div className="mb-2 mr-2 min-w-0 flex-1 basis-[220px]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título, texto, tag ou autor" aria-label="Buscar na biblioteca" className={juntar(campo, "pl-8")} />
            </div>
          </div>
          <div className="mb-2 flex min-w-0 max-w-full flex-wrap items-center [&>*]:mb-0 [&>*+*]:ml-2">
            {produtosDoCliente.length > 0 && (
              <SeletorCompacto
                rotulo="Produto"
                modo="lista"
                icone={<Package className="h-4 w-4" />}
                opcoes={produtosDoCliente.map((p) => ({ valor: p.nome, rotulo: p.nome }))}
                valor={produto ? produto.nome : ""}
                onEscolher={setProdutoEscolhido}
              />
            )}
            <SeletorCompacto
              rotulo="Tipo"
              modo="lista"
              icone={<Filter className="h-4 w-4" />}
              opcoes={[
                { valor: "todos", rotulo: "Tudo" },
                { valor: "prompt", rotulo: "Prompts" },
                { valor: "referencia", rotulo: "Referências" },
              ]}
              valor={tipo}
              onEscolher={(v) => setTipo(v as TipoFiltro)}
            />
            <SeletorCompacto
              rotulo="Origem"
              modo="lista"
              icone={<Users className="h-4 w-4" />}
              opcoes={[
                { valor: "todas", rotulo: "Agência e cliente" },
                { valor: "agencia", rotulo: "Da agência" },
                { valor: "cliente", rotulo: "Deste cliente" },
              ]}
              valor={origem}
              onEscolher={(v) => setOrigem(v as OrigemFiltro)}
            />
          </div>
        </div>
        <SeletorDaArea valor={area} onEscolher={setArea} comTudo contagem={biblioteca.isSuccess ? contagem : undefined} />
        {(foraDoProduto > 0 || semImagem > 0) && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center">
            {semImagem > 0 && (
              <Alternar ligado={verSemImagem} onAlternar={() => setVerSemImagem(!verSemImagem)} icone={<ImageOff className="h-3.5 w-3.5" aria-hidden="true" />}>
                Sem imagem ({semImagem})
              </Alternar>
            )}
            {foraDoProduto > 0 && (
              <Alternar ligado={verOutros} onAlternar={() => setVerOutros(!verOutros)} icone={<Filter className="h-3.5 w-3.5" aria-hidden="true" />}>
                Outros segmentos ({foraDoProduto})
              </Alternar>
            )}
          </div>
        )}
      </div>

      {logica.length > 0 && (
        <GrupoDaBiblioteca rotulo={produto ? `Prompts para ${produto.nome}` : "Prompts de fotografia"} total={logica.length} chave={`mesa-foto:biblioteca:lista-logica:${clientId}`}>
          <ListaDoArsenal prompts={logica} onUsar={usar} rotulo="Prompts de fotografia do produto" />
        </GrupoDaBiblioteca>
      )}

      {biblioteca.isLoading && <Carregando forma="grade" linhas={6} rotulo="Lendo a biblioteca" />}
      {biblioteca.isError && <AvisoDeErro erro={biblioteca.error} />}
      {biblioteca.isSuccess && itens.length === 0 && <Vazio titulo="A biblioteca ainda está vazia">Os prompts acima já servem. Busque referências livres abaixo e importe as que servirem.</Vazio>}
      {biblioteca.isSuccess && itens.length > 0 && naArea.length === 0 && (
        <EstadoVazio
          compacto
          titulo="Nada com esses filtros."
          acao={
            <button
              type="button"
              className="text-[12px] font-medium text-primary hover:underline"
              onClick={() => {
                setTipo("todos");
                setArea("todas");
                setOrigem("todas");
                setBusca("");
              }}
            >
              Limpar filtros
            </button>
          }
        />
      )}

      {prompts.length > 0 && (
        <GrupoDaBiblioteca rotulo="Prompts da biblioteca" total={prompts.length} chave={`mesa-foto:biblioteca:lista-prompts:${clientId}`}>
          <ul className={juntar(ROLAGEM_DO_ARSENAL, "grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2")} data-rolagem-do-arsenal="" data-lista-de-prompts="">
            {prompts.map((i) => (
              <CartaoDoPrompt key={i.id} item={i} dados={dados} salvando={salvando === i.id} onSalvar={() => void salvar(i)} onAmpliar={() => setAmpliada(i)} onUsar={usar} />
            ))}
          </ul>
        </GrupoDaBiblioteca>
      )}
      {referencias.length > 0 && (
        <GrupoDaBiblioteca rotulo="Referências de imagem" total={referencias.length} chave={`mesa-foto:biblioteca:lista-referencias:${clientId}`}>
          <ul className={juntar(ROLAGEM_DO_ARSENAL, "grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5")} data-rolagem-do-arsenal="" data-lista-de-referencias="">
            {referencias.map((i) => (
              <CartaoDaReferencia key={i.id} item={i} salvando={salvando === i.id} onSalvar={() => void salvar(i)} onAmpliar={() => setAmpliada(i)} />
            ))}
          </ul>
        </GrupoDaBiblioteca>
      )}

      <div className="min-w-0 space-y-5">
        {isAdmin && <ExemplosDaBiblioteca />}
        <ReferenciasLivres area={area} produtos={produtos} />
      </div>
      <Ampliar imagens={ampliada ? [ampliavelDoItem(ampliada)] : []} indice={ampliada ? 0 : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}

/** Grupo da lista (Prompts, Referências): o título recolhe a lista e a contagem fica à vista. */
function GrupoDaBiblioteca({ rotulo, total, chave, children }: { rotulo: string; total: number; chave: string; children: ReactNode }) {
  const [recolhido, setRecolhido] = useRecolhido(chave);
  return (
    <section className="min-w-0" aria-label={rotulo} data-recolhido={recolhido ? "sim" : "nao"}>
      <h3 className={recolhido ? "" : "mb-2"}>
        <TituloRecolhivel
          titulo={
            <>
              {rotulo} <span className="font-normal tabular-nums text-muted-foreground">{total}</span>
            </>
          }
          recolhido={recolhido}
          onAlternar={() => setRecolhido(!recolhido)}
        />
      </h3>
      {!recolhido && children}
    </section>
  );
}

// ------------------------------------------------------------------ exemplos pelo próprio prompt (admin, 25/09)

/**
 * Pedido do dono (25/09): "as fotos da biblioteca de prompt não têm nada a ver
 * com o prompt". Os exemplos vieram do Openverse por busca de palavras. Aqui
 * o admin limpa esses exemplos (todos ou só os que o Jev diz que não batem) e
 * gera o exemplo de cada prompt com o PRÓPRIO prompt, uma imagem por chamada,
 * com o total à vista antes e a carteira do cliente aberto.
 */
export function ExemplosDaBiblioteca() {
  const { clientId, clientName, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [previa, setPrevia] = useState<LimpezaDaBiblioteca | null>(null);
  const [modo, setModo] = useState<"openverse" | "nao_batem">("openverse");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [estimativa, setEstimativa] = useState<EstimativaDosExemplos | null>(null);
  const [andamento, setAndamento] = useState<{ feitos: number; total: number; custo: number } | null>(null);
  const parar = useRef(false);
  const atualizar = () => void queryClient.invalidateQueries({ queryKey: chaveDaBiblioteca(clientId) });

  const verPrevia = async (m: "openverse" | "nao_batem") => {
    setOcupado("previa");
    setModo(m);
    try {
      const r = await limparExemplosDaBiblioteca({ modo: m, confirmar: false, clientId });
      setPrevia(r);
      if (r.custo_usd) atualizarCusto();
    } catch (e) {
      avisarErro(e, "Não deu para conferir os exemplos");
    } finally {
      setOcupado(null);
    }
  };
  const limpar = async (m: "openverse" | "nao_batem") => {
    setOcupado("limpar");
    try {
      const r = await limparExemplosDaBiblioteca({ modo: m, confirmar: true, clientId });
      toast.success(`${r.limpos} ${r.limpos === 1 ? "exemplo limpo" : "exemplos limpos"}`, { description: "Os prompts ficaram sem foto até gerar o exemplo pelo próprio prompt." });
      setPrevia(null);
      setEstimativa(null);
      atualizar();
      if (r.custo_usd) atualizarCusto();
    } catch (e) {
      avisarErro(e, "Exemplos não limpos");
    } finally {
      setOcupado(null);
    }
  };
  const calcular = async () => {
    setOcupado("estimar");
    try {
      setEstimativa(await estimarExemplosDaBiblioteca(clientId));
    } catch (e) {
      avisarErro(e, "Custo não calculado");
    } finally {
      setOcupado(null);
    }
  };
  const gerarTodos = async () => {
    if (!estimativa || !estimativa.pendentes) return {};
    parar.current = false;
    let feitos = 0;
    let custo = 0;
    const total = estimativa.pendentes;
    setAndamento({ feitos, total, custo });
    try {
      for (let volta = 0; volta < total + 2 && !parar.current; volta++) {
        const r = await gerarProximoExemplo(clientId);
        if (!r.item && r.acabou) break;
        feitos++;
        custo += r.custo_usd;
        setAndamento({ feitos, total, custo });
        if (r.acabou) break;
      }
      toast.success(`${feitos} ${feitos === 1 ? "exemplo gerado" : "exemplos gerados"}`, { description: `Custo real: ${usd(custo)}.` });
    } catch (e) {
      avisarErro(e, "A geração parou");
    } finally {
      setAndamento(null);
      setEstimativa(null);
      atualizar();
      atualizarCusto();
    }
    return {};
  };

  return (
    <Cartao
      titulo="Exemplos dos prompts (admin)"
      recolher={`mesa-foto:biblioteca:exemplos-admin:${clientId}`}
      resumo="limpar e gerar os exemplos"
      dica="As fotos do Openverse vieram por busca de palavras e não mostram a direção do prompt. Limpe e gere o exemplo de cada prompt com o próprio prompt."
    >
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0 space-y-2" data-limpar-openverse="">
          <p className="text-[12px] font-medium">1. Limpar os exemplos do Openverse</p>
          <div className="flex min-w-0 flex-wrap items-center">
            <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={!!ocupado} onClick={() => void verPrevia("openverse")}>
              {ocupado === "previa" && modo === "openverse" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />} Ver quantos são
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mb-1.5 mr-1.5 h-8 text-[12px]"
              disabled={!!ocupado}
              onClick={() => void verPrevia("nao_batem")}
              title="O Jev compara o título e a busca da foto com o prompt. Cobra centavos no cliente aberto."
            >
              {ocupado === "previa" && modo === "nao_batem" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />} Conferir quais não batem
            </Button>
          </div>
          {previa && (
            <div className="rounded-md bg-muted/50 p-2 text-[12px]" data-previa-da-limpeza="">
              <p>
                {previa.encontrados} {previa.encontrados === 1 ? "exemplo veio" : "exemplos vieram"} do Openverse
                {modo === "nao_batem" ? `; ${previa.a_limpar} não ${previa.a_limpar === 1 ? "bate" : "batem"} com o prompt` : ""}.
              </p>
              {modo === "nao_batem" && previa.itens.length > 0 && (
                <ul className="mt-1 text-[11.5px] text-muted-foreground lg:max-h-40 lg:overflow-y-auto lg:overscroll-contain">
                  {previa.itens.slice(0, 60).map((i) => (
                    <li key={i.id} className="truncate">
                      {i.titulo}
                      {i.bate != null ? ` (bate ${Math.round(i.bate * 100)}%)` : " (não conferido)"}
                    </li>
                  ))}
                </ul>
              )}
              {previa.aviso && <p className="mt-1 text-warning">{previa.aviso}</p>}
              <div className="mt-2 flex flex-wrap">
                {previa.encontrados > 0 && (
                  <Button type="button" size="sm" className="mb-1 mr-1.5 h-8 text-[12px]" disabled={!!ocupado} onClick={() => void limpar("openverse")}>
                    Limpar todos do Openverse ({previa.encontrados})
                  </Button>
                )}
                {modo === "nao_batem" && previa.a_limpar > 0 && (
                  <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" disabled={!!ocupado} onClick={() => void limpar("nao_batem")}>
                    Limpar só os que não batem ({previa.a_limpar})
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-2" data-gerar-exemplos="">
          <p className="text-[12px] font-medium">2. Gerar o exemplo com o próprio prompt</p>
          <p className="truncate text-[11.5px] text-muted-foreground" title="Uma imagem por prompt, no gerador mais barato de boa qualidade.">
            Cobra na carteira de {clientName || "o cliente aberto"}.
          </p>
          {!estimativa ? (
            <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" disabled={!!ocupado} onClick={() => void calcular()}>
              {ocupado === "estimar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Calcular o custo total
            </Button>
          ) : (
            <div className="rounded-md bg-muted/50 p-2 text-[12px]" data-estimativa-dos-exemplos="">
              <p>
                {estimativa.pendentes} {estimativa.pendentes === 1 ? "prompt sem exemplo" : "prompts sem exemplo"}: ~{usd(estimativa.total_usd || 0)} no total
                {estimativa.por_imagem_usd != null ? ` (~${usd(estimativa.por_imagem_usd)} cada)` : ""}, com {estimativa.rotulo || estimativa.modelo_imagem_id}.
              </p>
              {andamento ? (
                <div className="mt-2 flex flex-wrap items-center">
                  <span className="mr-2 inline-flex items-center">
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> {andamento.feitos} de {andamento.total} · {usd(andamento.custo)}
                  </span>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={() => (parar.current = true)}>
                    Parar
                  </Button>
                </div>
              ) : (
                estimativa.pendentes > 0 && (
                  <BotaoComCusto
                    rotulo={
                      <>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar os {estimativa.pendentes} exemplos
                      </>
                    }
                    titulo="Exemplos da biblioteca"
                    descricao="Uma imagem por chamada; o que sair fica salvo mesmo se parar no meio."
                    className="mt-2 h-8 text-[12px]"
                    fecharAoConfirmar
                    partes={() => [{ modeloId: estimativa.modelo_imagem_id || null, tipo: "imagem", imagens: 1, qualidade: "media", tokensEntrada: 200, vezes: estimativa.pendentes }]}
                    executar={() => gerarTodos()}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>
    </Cartao>
  );
}
