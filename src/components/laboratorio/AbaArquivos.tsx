import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Download, ExternalLink, FileText, Folder, HardDrive } from "lucide-react";
import { Carregando, EstadoDeErro, EstadoVazio, botao, espaco, juntar, lista, texto } from "@/components/sistema";
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

  const cabecalho = (
    <div className="flex min-w-0 items-center">
      <nav aria-label="Caminho" className="flex min-w-0 flex-1 items-center overflow-hidden">
        <button type="button" className={juntar(texto.tituloSecao, "shrink-0 hover:underline")} onClick={() => setCaminho([])}>
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
      <Link to="/workspace" className={botao.icone} aria-label="Abrir o Workspace" title="Abrir o Workspace (todas as pastas)">
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
        <EstadoVazio titulo="Nada gerado ainda" descricao="O que o Laboratório gerar aparece aqui, em Livres ou na pasta do cliente." />
      </div>
    );

  return (
    <div className={espaco.pagina} data-aba-arquivos="">
      {cabecalho}
      {filhas.isLoading ? (
        <Carregando forma="lista" rotulo="Lendo a pasta" />
      ) : !itens.length ? (
        <EstadoVazio titulo="Pasta vazia" />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {itens.map((i) => {
            const mini = miniaturas[i.thumb_path || i.storage_path];
            return (
              <li key={i.id} className={lista.linha} data-item-do-workspace={i.tipo}>
                {i.tipo === "folder" ? (
                  <button type="button" className="flex min-w-0 flex-1 items-center text-left" onClick={() => setCaminho(caminho.concat(i))}>
                    <Folder className="mr-3 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{i.nome}</span>
                  </button>
                ) : (
                  <>
                    <span className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                      {mini ? <img src={mini} alt="" className="h-full w-full object-cover" loading="lazy" /> : <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate")}>{i.nome}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>{i.atualizado ? new Date(i.atualizado).toLocaleString("pt-BR") : ""}</span>
                    </span>
                    <button type="button" className={botao.icone} onClick={() => void abrir(i, false)} aria-label={`Abrir ${i.nome}`} title="Abrir">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" className={botao.icone} onClick={() => void abrir(i, true)} aria-label={`Baixar ${i.nome}`} title="Baixar">
                      <Download className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
