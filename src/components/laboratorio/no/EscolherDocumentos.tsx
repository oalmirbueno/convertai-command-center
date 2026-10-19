import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { JanelaCentral, botao, juntar, texto } from "@/components/sistema";
import { ExploradorDePastas } from "@/components/mesa/NavegadorDePastas";
import { pastasDoWorkspace, RAIZ, useArvoreDoWorkspace, type NoDoWorkspace } from "@/lib/mesa/pastas";
import type { ArquivoDoNo } from "@/lib/laboratorio/nos";

/**
 * Escolher documentos que já estão no Workspace, com o mesmo explorador de
 * pastas das mesas (ExploradorDePastas + a árvore do Workspace do cliente).
 * Projeto livre (sem cliente): o Workspace global da agência.
 */

const POR_PAGINA = 1000;

/** Nós do Workspace global (pastas e arquivos), lidos em páginas como a árvore do cliente. */
function useWorkspaceGlobal(ativo: boolean) {
  return useQuery({
    queryKey: ["laboratorio", "workspace-global"],
    enabled: ativo,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<NoDoWorkspace[]> => {
      const saida: NoDoWorkspace[] = [];
      for (let pagina = 0; pagina < 5; pagina++) {
        const { data, error } = await (supabase as any)
          .from("workspace_nodes")
          .select("id, name, kind, mime, storage_path, parent_id")
          .eq("scope", "global")
          .order("name", { ascending: true })
          .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
        if (error) throw error;
        const lote = (data || []) as NoDoWorkspace[];
        for (const n of lote) saida.push(n);
        if (lote.length < POR_PAGINA) break;
      }
      return saida;
    },
  });
}

export default function EscolherDocumentos({
  aberta,
  clienteId,
  jaEscolhidos,
  onFechar,
  onEscolher,
}: {
  aberta: boolean;
  clienteId: string | null | undefined;
  jaEscolhidos: string[];
  onFechar: () => void;
  onEscolher: (arquivos: ArquivoDoNo[]) => void;
}) {
  const [doCliente, setDoCliente] = useState(true);
  const usarCliente = !!clienteId && doCliente;
  const arvore = useArvoreDoWorkspace(clienteId || "", aberta && usarCliente);
  const global = useWorkspaceGlobal(aberta && !usarCliente);
  const q = usarCliente ? arvore : global;
  const [marcados, setMarcados] = useState<Record<string, NoDoWorkspace>>({});

  const nos = useMemo(() => q.data || [], [q.data]);
  const arquivos = useMemo(() => nos.filter((n) => n.kind === "file" && !!n.storage_path), [nos]);
  const pastas = useMemo(() => pastasDoWorkspace(nos), [nos]);
  const total = Object.keys(marcados).length;

  const alternar = (n: NoDoWorkspace) =>
    setMarcados((m) => {
      const novo = { ...m };
      if (novo[n.id]) delete novo[n.id];
      else novo[n.id] = n;
      return novo;
    });

  const confirmar = () => {
    const lista = Object.keys(marcados).map((id) => {
      const n = marcados[id];
      return { id: n.id, nome: n.name || "Documento", url: "", tipo: n.mime || "", path: n.storage_path || "" };
    });
    setMarcados({});
    onEscolher(lista);
  };

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={() => {
        setMarcados({});
        onFechar();
      }}
      titulo="Documentos do Workspace"
      icone={<FileText className="h-4 w-4" />}
      largura="lg"
      abaixoDoTitulo={
        clienteId ? (
          <div className="flex min-w-0 items-center" role="group" aria-label="De onde">
            <button type="button" className={juntar(botao.barra, "mr-1", usarCliente && "bg-muted text-foreground")} aria-pressed={usarCliente} onClick={() => setDoCliente(true)}>
              Do cliente
            </button>
            <button type="button" className={juntar(botao.barra, !usarCliente && "bg-muted text-foreground")} aria-pressed={!usarCliente} onClick={() => setDoCliente(false)}>
              Da agência
            </button>
          </div>
        ) : undefined
      }
      rodape={
        <>
          <button type="button" className={botao.discreto} onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className={botao.primario} disabled={!total} onClick={confirmar} data-anexar-documentos="">
            {total ? `Anexar ${total}` : "Anexar"}
          </button>
        </>
      }
      data-escolher-documentos=""
    >
      <ExploradorDePastas<NoDoWorkspace>
        pastas={pastas}
        itens={arquivos}
        pastaDoItem={(n) => n.parent_id || RAIZ}
        raizNome={usarCliente ? "Workspace do cliente" : "Workspace"}
        carregando={q.isLoading}
        erro={q.isError ? "Não deu para ler o Workspace." : null}
        vazio="Nenhum arquivo nesta pasta."
        renderizarItens={(itens) => (
          <ul className="min-w-0" aria-label="Arquivos">
            {itens.map((n) => {
              const ja = jaEscolhidos.indexOf(n.id) >= 0;
              const marcado = !!marcados[n.id];
              return (
                <li key={n.id} className="min-w-0">
                  <button
                    type="button"
                    className={juntar("flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted", marcado && "bg-primary/10")}
                    onClick={() => alternar(n)}
                    disabled={ja}
                    aria-pressed={marcado}
                    title={ja ? `${n.name} (já anexado)` : n.name}
                  >
                    <FileText className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", ja && "text-muted-foreground")}>{n.name}</span>
                    {marcado || ja ? <Check className="ml-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      />
    </JanelaCentral>
  );
}
