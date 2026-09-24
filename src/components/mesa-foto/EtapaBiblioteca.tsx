import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, Copy, Download, ExternalLink, ImageIcon, Loader2, Search, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ampliar, type ImagemAmpliavel } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara } from "@/lib/mesa/api";
import { Cartao, Moldura, Pilulas, Vazio } from "./Comuns";
import {
  buscarReferencias,
  CATEGORIAS_DA_BIBLIOTECA,
  chaveDaBiblioteca,
  gerarExemploDaBiblioteca,
  importarReferencia,
  partesDoExemplo,
  rotuloDaCategoriaDaBiblioteca,
  salvarNaBiblioteca,
  useBiblioteca,
  type ItemDaBiblioteca,
  type ReferenciaEncontrada,
} from "./fotoApi";

/**
 * Etapa Biblioteca: prompts e referências de imagem (estilo, composição, luz
 * e cenário) vindos de repositórios públicos, para guiar o Preparar e o
 * Ensaio. Cada prompt tem Copiar; cada referência mostra licença e autor,
 * sempre. "Buscar referências" consulta o Openverse pela função (com licença
 * e autor) e "Importar" traz para a biblioteca do cliente. "Salvar como meu"
 * copia um item da agência para o cliente.
 *
 * v2: cada prompt mostra uma imagem de exemplo do resultado (de banco
 * público, com licença e autor, ou gerada, com o selo "exemplo gerado").
 * Sem imagem, "Gerar exemplo" gera uma (paga, com o preço antes). Tudo em
 * miniatura compacta, com "ver grande" ao tocar.
 */

export async function copiarParaAreaDeTransferencia(texto: string): Promise<boolean> {
  try {
    const nav: any = typeof navigator !== "undefined" ? navigator : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      await nav.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* sem permissão: tenta o caminho antigo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

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
      <span className="block truncate text-[10px] text-muted-foreground" title={`${licenca} · ${autor}`} data-licenca="">
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

function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="mb-1 mr-1.5 h-7 px-2 text-[11.5px]"
      disabled={!texto}
      aria-label={rotulo}
      onClick={async () => {
        const ok = await copiarParaAreaDeTransferencia(texto);
        if (ok) {
          setCopiado(true);
          window.setTimeout(() => setCopiado(false), 1800);
        } else toast.error("Não foi possível copiar", { description: "Selecione o texto e copie com Ctrl+C." });
      }}
    >
      {copiado ? <Check className="mr-1 h-3.5 w-3.5 text-success" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {copiado ? "Copiado" : rotulo}
    </Button>
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
      <button type="button" onClick={onAmpliar} className="relative block w-16 shrink-0 cursor-zoom-in sm:w-20" aria-label={`Ver grande o exemplo de ${item.titulo}`} data-exemplo={item.exemplo_gerado ? "gerado" : "publico"}>
        <Moldura proporcao={1}>
          <ImagemDaBiblioteca item={item} />
        </Moldura>
        {item.exemplo_gerado && (
          <span className="pointer-events-none absolute bottom-1 left-1 rounded-full border border-primary/30 bg-card px-1 text-[9px] font-semibold text-primary" data-selo="exemplo-gerado">
            exemplo gerado
          </span>
        )}
      </button>
    );
  }
  return (
    <div className="flex w-16 shrink-0 flex-col items-center sm:w-20" data-exemplo="">
      <Moldura proporcao={1}>
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
        className="mt-1 h-auto w-full whitespace-normal px-1 py-1 text-[10.5px] leading-tight"
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

function CartaoDoPrompt({ item, onSalvar, salvando, onAmpliar }: { item: ItemDaBiblioteca; onSalvar: () => void; salvando: boolean; onAmpliar: () => void }) {
  const [ingles, setIngles] = useState(false);
  const texto = ingles ? item.prompt_en : item.prompt_pt || item.prompt_en;
  return (
    <li className="flex min-w-0 items-start rounded-xl border border-border bg-card p-3" data-prompt={item.id}>
      <ExemploDoPrompt item={item} onAmpliar={onAmpliar} />
      <div className="ml-3 min-w-0 flex-1 space-y-2">
        <div className="flex min-w-0 items-start">
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center text-[13px] font-semibold">
              {item.destaque && <Star className="mr-1 h-3.5 w-3.5 shrink-0 text-warning" aria-label="Destaque" />}
              <span className="truncate">{item.titulo}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {rotuloDaCategoriaDaBiblioteca(item.categoria)} · {item.client_id ? "deste cliente" : "da agência"}
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
        <p className="rounded-lg bg-muted px-2.5 py-2 font-mono text-[12px] leading-relaxed [overflow-wrap:anywhere]">{texto || "Sem texto"}</p>
        {item.negativo && (
          <p className="text-[11.5px] leading-snug [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">Evitar: </span>
            {item.negativo}
          </p>
        )}
        <LicencaEAutor item={item} />
        <div className="flex flex-wrap items-center">
          <BotaoCopiar texto={item.prompt_pt || item.prompt_en} rotulo="Copiar" />
          {item.prompt_en && item.prompt_pt && <BotaoCopiar texto={item.prompt_en} rotulo="Copiar em inglês" />}
          {item.negativo && <BotaoCopiar texto={item.negativo} rotulo="Copiar o evitar" />}
          {!item.client_id && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 h-7 px-2 text-[11.5px]" disabled={salvando} onClick={onSalvar}>
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
  return (
    <li className="min-w-0 rounded-lg border border-border bg-card p-1" data-referencia={item.id}>
      <button type="button" onClick={onAmpliar} className="block w-full cursor-zoom-in" aria-label={`Ver grande ${item.titulo}`}>
        <Moldura proporcao={1}>
          <ImagemDaBiblioteca item={item} />
        </Moldura>
      </button>
      <div className="space-y-0.5 px-0.5 pt-1">
        <p className="truncate text-[11px] font-medium" title={item.titulo}>
          {item.titulo}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {rotuloDaCategoriaDaBiblioteca(item.categoria)} · {item.client_id ? "deste cliente" : "da agência"}
        </p>
        {item.uso && <p className="truncate text-[10.5px] text-muted-foreground" title={item.uso}>Quando usar: {item.uso}</p>}
        <LicencaEAutor item={item} />
        {!item.client_id && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-[11.5px]" disabled={salvando} onClick={onSalvar}>
            {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="mr-1 h-3.5 w-3.5" />}
            Salvar como meu
          </Button>
        )}
      </div>
    </li>
  );
}

function BuscaPublica({ categoriaInicial }: { categoriaInicial: string }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<ReferenciaEncontrada[] | null>(null);
  const [categoria, setCategoria] = useState(categoriaInicial === "todas" ? "estilo" : categoriaInicial);
  const [importando, setImportando] = useState<string | null>(null);
  const [importadas, setImportadas] = useState<string[]>([]);

  const buscar = async () => {
    if (!q.trim() || buscando) return;
    setBuscando(true);
    try {
      setResultados(await buscarReferencias(q));
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
    <Cartao titulo="Buscar referências" dica="Imagens públicas do Openverse, com licença e autor. Referência guia clima, luz e composição; nunca é o assunto.">
      <form
        className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void buscar();
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: product photography soft light, food flat lay" aria-label="O que buscar" className="h-9" />
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label="Categoria ao importar">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIAS_DA_BIBLIOTECA.map((c) => (
              <SelectItem key={c.valor} value={c.valor}>
                {c.rotulo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" className="h-9 text-[12.5px]" disabled={!q.trim() || buscando}>
          {buscando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
          Buscar referências
        </Button>
      </form>
      {resultados && resultados.length === 0 && <p className="mt-3 text-[12px] text-muted-foreground">Nada encontrado. Tente em inglês ou com menos palavras.</p>}
      {resultados && resultados.length > 0 && (
        <ul className="mt-3 grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6" aria-label="Resultados da busca">

          {resultados.map((r) => {
            const ja = importadas.indexOf(r.chave) >= 0;
            return (
              <li key={r.chave} className="min-w-0 rounded-xl border border-border bg-background p-1.5">
                <Moldura proporcao={1}>
                  <img src={r.miniatura_url} alt={r.titulo} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                </Moldura>
                <p className="mt-1 truncate px-0.5 text-[11.5px] font-medium" title={r.titulo}>
                  {r.titulo}
                </p>
                <div className="px-0.5">
                  <LicencaEAutor item={r} />
                </div>
                <Button type="button" size="sm" variant={ja ? "ghost" : "outline"} className="mt-1 h-7 w-full text-[11.5px]" disabled={ja || importando === r.chave} onClick={() => void importar(r)}>
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

export default function EtapaBiblioteca() {
  const { clientId } = useMesa();
  const biblioteca = useBiblioteca(clientId);
  const { salvar, salvando } = useSalvarComoMeu();
  const [tipo, setTipo] = useState<TipoFiltro>("todos");
  const [categoria, setCategoria] = useState("todas");
  const [origem, setOrigem] = useState<OrigemFiltro>("todas");
  const [busca, setBusca] = useState("");
  const itens = useMemo(() => biblioteca.data || [], [biblioteca.data]);
  const filtrados = useMemo(() => filtrarBiblioteca(itens, tipo, categoria, origem, busca), [itens, tipo, categoria, origem, busca]);
  const prompts = filtrados.filter((i) => i.tipo === "prompt");
  const referencias = filtrados.filter((i) => i.tipo === "referencia");
  const [ampliada, setAmpliada] = useState<ItemDaBiblioteca | null>(null);

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <Cartao titulo="Biblioteca de prompts e referências" dica={'Para guiar o Preparar e o Ensaio em "Como guiar esta foto". Licença e autor sempre à vista.'}>
        <div className="space-y-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título, texto, tag ou autor" aria-label="Buscar na biblioteca" className="h-9 pl-8" />
          </div>
          <div className="flex min-w-0 flex-wrap">
            <Pilulas
              className="mr-3"
              rotulo="Tipo"
              opcoes={[
                { valor: "todos" as TipoFiltro, rotulo: "Tudo" },
                { valor: "prompt" as TipoFiltro, rotulo: "Prompts" },
                { valor: "referencia" as TipoFiltro, rotulo: "Referências" },
              ]}
              valor={tipo}
              onEscolher={setTipo}
            />
            <Pilulas className="mr-3" rotulo="Categoria" opcoes={[{ valor: "todas", rotulo: "Todas" }].concat(CATEGORIAS_DA_BIBLIOTECA)} valor={categoria} onEscolher={setCategoria} />
            <Pilulas
              rotulo="Origem"
              opcoes={[
                { valor: "todas" as OrigemFiltro, rotulo: "Agência e cliente" },
                { valor: "agencia" as OrigemFiltro, rotulo: "Da agência" },
                { valor: "cliente" as OrigemFiltro, rotulo: "Deste cliente" },
              ]}
              valor={origem}
              onEscolher={setOrigem}
            />
          </div>
        </div>
      </Cartao>

      {biblioteca.isLoading && (
        <p className="flex items-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo a biblioteca...
        </p>
      )}
      {biblioteca.isError && <AvisoDeErro erro={biblioteca.error} />}
      {biblioteca.isSuccess && itens.length === 0 && <Vazio titulo="A biblioteca ainda está vazia">Busque referências públicas abaixo e importe as que servirem.</Vazio>}
      {biblioteca.isSuccess && itens.length > 0 && filtrados.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-[12.5px] text-muted-foreground">Nada com esses filtros.</p>
      )}

      {prompts.length > 0 && (
        <section className="min-w-0 space-y-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Prompts · {prompts.length}</h2>
          <ul className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {prompts.map((i) => (
              <CartaoDoPrompt key={i.id} item={i} salvando={salvando === i.id} onSalvar={() => void salvar(i)} onAmpliar={() => setAmpliada(i)} />
            ))}
          </ul>
        </section>
      )}
      {referencias.length > 0 && (
        <section className="min-w-0 space-y-2">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Referências de imagem · {referencias.length}</h2>
          <ul className="grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {referencias.map((i) => (
              <CartaoDaReferencia key={i.id} item={i} salvando={salvando === i.id} onSalvar={() => void salvar(i)} onAmpliar={() => setAmpliada(i)} />
            ))}
          </ul>
        </section>
      )}

      <BuscaPublica categoriaInicial={categoria} />
      <Ampliar imagens={ampliada ? [ampliavelDoItem(ampliada)] : []} indice={ampliada ? 0 : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}
