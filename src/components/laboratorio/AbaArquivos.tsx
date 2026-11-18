import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, ChevronRight, Download, ExternalLink, FileText, Folder, FolderOpen, HardDrive } from "lucide-react";
import { Carregando, EstadoDeErro, botao, espaco, juntar, lista, texto } from "@/components/sistema";
import { CirculoDoIcone, ZonaVazia, botaoEmCirculo, pastelDe, tom } from "./visual";
import { textoDoErro } from "@/lib/mesa/api";
import { ehImagemDoWorkspace, enderecoParaBaixar, enderecosAssinados, lerFilhas, lerPastaRaiz, NOME_DA_PASTA_RAIZ, type ItemDoWorkspace } from "@/lib/laboratorio/arquivos";

/**
 * Arquivos do Laboratório: o workspace global em "Laboratório" (Livres e
 * uma pasta por cliente, dentro delas uma por projeto). Miniaturas, abrir e
 * baixar; a organização completa continua na página Workspace.
 */
export default function AbaArquivos() {
  const raiz = useQuery({ queryKey: ["laboratorio", "arquivos", "raiz"], queryFn: lerPastaRaiz });
  const [caminho, setCaminho] = useState<ItemDoWorkspace[]>([]);
  const pasta = caminho.length ? caminho[caminho.length - 1] : raiz.data || null;
  const filhas = useQuery({ queryKey: ["laboratorio", "arquivos", pasta ? pasta.id : ""], queryFn: () => lerFilhas((pasta as ItemDoWorkspace).id), enabled: !!pasta });
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({});

  const itens = filhas.data || [];
  useEffect(() => {
    const caminhos = itens.filter((i) => i.tipo === "file" && (i.thumb_path || ehImagemDoWorkspace(i))).map((i) => i.thumb_path || i.storage_path).filter(Boolean);
    if (!caminhos.length) return;
    let vivo = true;
    enderecosAssinados(caminhos)
      .then((r) => {
        if (vivo) setMiniaturas((m) => ({ ...m, ...r }));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [itens]);

  const abrir = async (i: ItemDoWorkspace, baixar: boolean) => {
    if (!i.storage_path) return;
    try {
      const url = baixar ? await enderecoParaBaixar(i.storage_path, i.nome) : (await enderecosAssinados([i.storage_path]))[i.storage_path];
      if (url) window.open(url, "_blank", "noopener");
      else toast.error("Arquivo não encontrado");
    } catch (e) {
      toast.error("Não deu para abrir", { description: textoDoErro(e) });
    }
  };

  // v4 (15/11/2026): o caminho numa faixa em pílula com a pasta num círculo; pastas viram ladrilhos pastel
  // (ícone em círculo, nome e a seta de abrir) e os arquivos uma lista limpa com miniatura quadrada de 44 px.
  const cabecalho = (
    <div className="flex min-w-0 items-center rounded-full bg-card p-1.5 shadow-card">
      <CirculoDoIcone tinta tamanho="sm" className="mr-2.5 h-9 w-9">
        <FolderOpen className="h-4 w-4" />
      </CirculoDoIcone>
      <nav aria-label="Caminho" className="flex min-w-0 flex-1 items-center overflow-hidden">
        <button type="button" className={juntar(texto.corpo, "shrink-0 text-[15px] font-semibold hover:underline")} onClick={() => setCaminho([])}>
          {NOME_DA_PASTA_RAIZ}
        </button>
        {caminho.map((p, i) => (
          <span key={p.id} className="flex min-w-0 items-center">
            <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <button type="button" className={juntar(texto.corpo, "min-w-0 truncate hover:underline")} onClick={() => setCaminho(caminho.slice(0, i + 1))}>
              {p.nome}
            </button>
          </span>
        ))}
      </nav>
      <Link to="/workspace" className={juntar(botaoEmCirculo, "ml-2")} aria-label="Abrir o Workspace" title="Abrir o Workspace (todas as pastas)">
        <HardDrive className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );

  if (raiz.isLoading) return <Carregando forma="lista" rotulo="Lendo os arquivos" />;
  if (raiz.isError) return <EstadoDeErro titulo="Não deu para ler os arquivos" descricao={textoDoErro(raiz.error)} />;
  if (!raiz.data)
    return (
      <div className={espaco.pagina} data-aba-arquivos="">
        {cabecalho}
        <ZonaVazia icone={<FolderOpen className="h-5 w-5" />} titulo="Nada gerado ainda" descricao="O que o Laboratório gerar aparece aqui, em Livres ou na pasta do cliente." className="py-16" />
      </div>
    );

  const pastas = itens.filter((i) => i.tipo === "folder");
  const arquivos = itens.filter((i) => i.tipo !== "folder");

  return (
    <div className={espaco.pagina} data-aba-arquivos="">
      {cabecalho}
      {filhas.isLoading ? (
        <Carregando forma="lista" rotulo="Lendo a pasta" />
      ) : !itens.length ? (
        <ZonaVazia icone={<Folder className="h-5 w-5" />} titulo="Pasta vazia" className="py-16" />
      ) : (
        <>
          {pastas.length ? (
            <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="Pastas">
              {pastas.map((i) => {
                const cor = pastelDe(i.nome);
                return (
                  <li key={i.id} className="min-w-0" data-item-do-workspace={i.tipo}>
                    <button type="button" className="group flex h-[116px] w-full min-w-0 flex-col rounded-[22px] p-3 text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none" style={{ backgroundColor: tom(cor, 0.16) }} onClick={() => setCaminho(caminho.concat(i))}>
                      <span className="flex items-start justify-between">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-card" style={{ color: cor }} aria-hidden="true">
                          <Folder className="h-5 w-5" />
                        </span>
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-card text-foreground transition-colors group-hover:bg-foreground group-hover:text-background" aria-hidden="true">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </span>
                      </span>
                      <span className="mt-auto block min-w-0 truncate text-[15px] font-semibold leading-5 text-foreground">{i.nome}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {arquivos.length ? (
            <ul className={juntar(lista.aberta, "space-y-0.5")} aria-label="Arquivos">
              {arquivos.map((i) => {
                const mini = miniaturas[i.thumb_path || i.storage_path];
                return (
                  <li key={i.id} className={juntar(lista.linha, "py-2")} data-item-do-workspace={i.tipo}>
                    <span className="mr-3 flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-muted">
                      {mini ? <img src={mini} alt="" width={44} height={44} className="h-full w-full object-cover" loading="lazy" /> : <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate font-medium")}>{i.nome}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>{i.atualizado ? new Date(i.atualizado).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    </span>
                    <button type="button" className={juntar(botao.icone, "h-9 w-9")} onClick={() => void abrir(i, true)} aria-label={`Baixar ${i.nome}`} title="Baixar">
                      <Download className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" className={juntar(botaoEmCirculo, "ml-1")} onClick={() => void abrir(i, false)} aria-label={`Abrir ${i.nome}`} title="Abrir">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
