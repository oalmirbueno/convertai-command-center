import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderPlus, Loader2 } from "lucide-react";
import { Carregando, EstadoDeErro, EstadoVazio, botao, espaco, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { chaveDosProjetos, criarProjeto, listarProjetos } from "@/lib/laboratorio/api";
import EditorDoProjeto from "./EditorDoProjeto";
import { CartaoDeProjeto } from "./CartaoDeProjeto";
import { nomeDoCliente, type ClienteDoLab } from "./Seletores";

export default function AbaProjetos({
  projetoAberto,
  onAbrir,
  clienteId,
  clientes,
}: {
  projetoAberto: string | null;
  onAbrir: (id: string | null) => void;
  clienteId: string | null;
  clientes: ClienteDoLab[];
}) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: chaveDosProjetos, queryFn: listarProjetos, enabled: !projetoAberto });
  const [criando, setCriando] = useState(false);

  if (projetoAberto) return <EditorDoProjeto projetoId={projetoAberto} clientes={clientes} onVoltar={() => onAbrir(null)} />;

  const novo = async () => {
    setCriando(true);
    try {
      const p = await criarProjeto({ nome: "Projeto novo", client_id: clienteId });
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
      onAbrir(p.id);
    } catch (e) {
      toast.error("Não deu para criar o projeto", { description: textoDoErro(e) });
    } finally {
      setCriando(false);
    }
  };

  const ativos = (q.data || []).filter((p) => p.status === "ativo");
  return (
    <div className={espaco.pagina} data-aba-projetos="">
      <div className="flex min-w-0 items-center">
        <h2 className={juntar(texto.tituloSecao, "flex-1")}>Projetos</h2>
        <button type="button" className={botao.icone} onClick={() => void novo()} disabled={criando} aria-label="Novo projeto" title={`Novo projeto (${nomeDoCliente(clientes, clienteId)})`}>
          {criando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FolderPlus className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {q.isLoading ? (
        <Carregando forma="grade" rotulo="Lendo os projetos" />
      ) : q.isError ? (
        <EstadoDeErro titulo="Não deu para ler os projetos" descricao={textoDoErro(q.error)} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />
      ) : !ativos.length ? (
        <EstadoVazio titulo="Nenhum projeto ainda" descricao="Peça um na Início ou crie um vazio." acao={<button type="button" className={botao.secundario} onClick={() => void novo()}>Novo projeto</button>} />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ativos.map((p) => (
            <CartaoDeProjeto key={p.id} projeto={p} clientes={clientes} onAbrir={() => onAbrir(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
