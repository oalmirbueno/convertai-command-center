import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderSync, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { chamarFuncao, rotuloDaCategoria } from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { AvisoDeErro, useAvisarErro } from "./Custo";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import { Quadrado } from "./NavegadorDePastas";
import { invalidarAcervo, useAcervo } from "./contextoDoCliente";

/**
 * Fotos reais do cliente (acervo) em galeria compacta no Contexto: as
 * primeiras fotos ativas, cada uma abre maior com a descrição. Organizar e
 * editar continua no editor de Imagens (Detalhes).
 */

export function legendaDaFoto(i: { descricao: string | null; categoria: string | null; pasta: string | null }): string {
  const partes = [i.descricao && i.descricao.trim() ? i.descricao.trim() : "Sem descrição ainda."];
  const onde = [i.categoria ? rotuloDaCategoria(i.categoria) : null, i.pasta ? `pasta ${i.pasta}` : null].filter(Boolean).join(" · ");
  if (onde) partes.push(onde);
  return partes.join(" ");
}

export default function FotosDoCliente({ colunas = 6, onOrganizar }: { colunas?: 4 | 6; onOrganizar?: () => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const acervo = useAcervo(clientId);
  const [aberta, setAberta] = useState<number | null>(null);
  const [buscando, setBuscando] = useState(false);

  const ativas = useMemo(() => (acervo.data || []).filter((i) => i.ativa), [acervo.data]);
  const semDescricao = ativas.filter((i) => !(i.descricao && i.descricao.trim())).length;
  const naTela = colunas === 6 ? 11 : 7;
  const visiveis = ativas.slice(0, naTela);
  const resto = ativas.length - visiveis.length;

  const ampliaveis: ImagemAmpliavel[] = ativas.map((i) => ({
    caminho: i.storage_path,
    bucket: i.storage_bucket || "mesa",
    titulo: i.nome,
    legenda: legendaDaFoto(i),
  }));

  const buscar = async () => {
    setBuscando(true);
    try {
      const data = await chamarFuncao<{ novas?: number; total?: number }>("agente-contexto", { acao: "acervo_sincronizar", client_id: clientId });
      const novas = Number((data && data.novas) || 0);
      toast.success(novas ? `${novas} ${novas === 1 ? "imagem nova" : "imagens novas"} no acervo` : "O acervo já estava em dia");
      invalidarAcervo(queryClient, clientId);
    } catch (e) {
      avisarErro(e, "Imagens não buscadas");
    } finally {
      setBuscando(false);
    }
  };

  const grade = colunas === 6 ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-4";

  return (
    <div className="min-w-0">
      <div className="mb-2.5 flex min-w-0 flex-wrap items-center justify-between">
        <p className="mb-1 mr-2 min-w-0 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">
          {acervo.isLoading
            ? "Lendo o acervo..."
            : ativas.length
              ? `${ativas.length} ${ativas.length === 1 ? "foto ativa" : "fotos ativas"}${semDescricao ? `, ${semDescricao} sem descrição` : ", todas organizadas"}`
              : "Nenhuma foto real no acervo ainda."}
        </p>
        <div className="mb-1 flex items-center">
          <button
            type="button"
            onClick={() => void buscar()}
            disabled={buscando}
            className="mr-3 inline-flex items-center text-[11.5px] font-medium text-foreground hover:underline disabled:opacity-60"
          >
            {buscando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FolderSync className="mr-1 h-3.5 w-3.5" />}
            Buscar nas pastas
          </button>
          {onOrganizar && (
            <button type="button" onClick={onOrganizar} className="text-[11.5px] font-medium text-foreground hover:underline">
              Organizar
            </button>
          )}
        </div>
      </div>

      {acervo.isError && <AvisoDeErro erro={acervo.error} />}

      {acervo.isLoading ? (
        <div className={`grid gap-2 ${grade}`}>
          {Array.from({ length: colunas === 6 ? 6 : 4 }).map((_, i) => (
            <Quadrado key={i}>
              <span className="block h-full w-full animate-pulse bg-muted" />
            </Quadrado>
          ))}
        </div>
      ) : ativas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-[12.5px] text-muted-foreground">
          Clique em "Buscar nas pastas" para trazer as fotos do Workspace e de Arquivos.
        </p>
      ) : (
        <ul className={`grid gap-2 ${grade}`}>
          {visiveis.map((i, n) => (
            <li key={i.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setAberta(n)}
                title={i.descricao || i.nome}
                aria-label={`Ver maior: ${i.nome}`}
                className="block w-full rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Quadrado className="border border-border">
                  <MiniaturaDoStorage bucket={i.storage_bucket || "mesa"} caminho={i.storage_path} alt={i.nome} className="h-full w-full" />
                </Quadrado>
              </button>
            </li>
          ))}
          {resto > 0 && (
            <li className="min-w-0">
              <button
                type="button"
                onClick={() => (onOrganizar ? onOrganizar() : setAberta(visiveis.length))}
                className="block w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Ver as outras ${resto} fotos`}
              >
                <Quadrado className="border border-border">
                  <span className="flex h-full w-full flex-col items-center justify-center bg-muted text-foreground">
                    <span className="text-[15px] font-semibold">+{resto}</span>
                    <span className="text-[10.5px] text-muted-foreground">ver todas</span>
                  </span>
                </Quadrado>
              </button>
            </li>
          )}
        </ul>
      )}

      <Ampliar imagens={ampliaveis} indice={aberta} onFechar={() => setAberta(null)} />
    </div>
  );
}
