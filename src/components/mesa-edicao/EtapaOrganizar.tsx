import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, FolderTree, Loader2, Pencil, Star, X } from "lucide-react";
import { toast } from "sonner";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { acaoDoAnexo, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { AvisoDeAtivacao, SeloDoTipo } from "@/components/mesa-videos/Comuns";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";
import { chamarMesaVideos, chaveDosArquivos, duracaoCurta, naEntradaDaEdicao, useArquivosDeVideo, useRoteirosAprovados, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";

/**
 * Organizar (Mesa Edição, frente E2; antes a aba Edição da Mesa Vídeos): o
 * organizador de takes separa por roteiro, cena e tomada, propõe nomes no
 * padrão roteiro_c01_t01 e sugere o melhor take de cada cena (o último
 * gravado). A proposta segue o contrato comum: a lista exata, Confirmar ou
 * Cancelar e Desfazer. A equipe ajusta à mão (melhor, nome, cena, arquivar),
 * sempre com Desfazer. O arquivo original nunca muda.
 */

type Desfazer = Record<string, unknown>;
type RoteiroCurto = { id: string; titulo: string; cenas: { ref: string; ordem: number; titulo: string }[] };

async function editarArquivo(id: string, campos: Record<string, unknown>): Promise<{ arquivo: unknown; desfazer: Desfazer }> {
  return chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: id, campos });
}

function LinhaDoTake({ take, podeEditar, roteiros }: { take: ArquivoDeVideo; podeEditar: boolean; roteiros: RoteiroCurto[] }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(take.nome);
  const [ocupado, setOcupado] = useState(false);
  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
  const roteiro = roteiros.find((r) => r.id === take.roteiro_id) || null;

  const mudar = async (campos: Record<string, unknown>, titulo: string) => {
    setOcupado(true);
    try {
      const r = await editarArquivo(take.id, campos);
      recarregar();
      toast.success(titulo, {
        action: {
          label: "Desfazer",
          onClick: () => {
            void editarArquivo(take.id, r.desfazer).then(recarregar, (e) => toast.error("Não foi possível desfazer", { description: textoDoErro(e) }));
          },
        },
      });
      return true;
    } catch (e) {
      toast.error("Não foi possível mudar", { description: textoDoErro(e), duration: 9000 });
      return false;
    } finally {
      setOcupado(false);
    }
  };

  return (
    <li className="flex min-w-0 flex-wrap items-center py-2" data-take={take.id}>
      <button
        type="button"
        disabled={!podeEditar || ocupado}
        onClick={() => void mudar({ melhor: !take.melhor }, take.melhor ? "Deixou de ser o melhor take" : "Marcado como melhor take")}
        aria-pressed={take.melhor}
        aria-label={take.melhor ? `Desmarcar ${take.nome} como melhor` : `Marcar ${take.nome} como melhor`}
        className={juntar(botao.icone, "mr-1.5", take.melhor && "text-warning hover:text-warning")}
      >
        <Star className={juntar("h-3.5 w-3.5", take.melhor && "fill-current")} />
      </button>
      {editando ? (
        <form
          className="flex min-w-0 flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            void mudar({ nome }, "Take renomeado").then((ok) => ok && setEditando(false));
          }}
        >
          <input className={campo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} aria-label="Novo nome do take" autoFocus />
          <button type="submit" className={juntar(botao.icone, "ml-1 text-primary")} aria-label="Salvar nome" disabled={ocupado}>
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button type="button" className={botao.icone} aria-label="Cancelar" onClick={() => setEditando(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium" title={take.nome_original !== take.nome ? `Original: ${take.nome_original}` : undefined}>
            {take.nome}
          </p>
          <p className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
            <SeloDoTipo tipo={take.tipo} />
            {duracaoCurta(take.duracao_s) && <span className="mr-1.5 tabular-nums">{duracaoCurta(take.duracao_s)}</span>}
            {roteiro && <span className="mr-1.5 truncate">{roteiro.titulo}</span>}
          </p>
        </div>
      )}
      {!editando && podeEditar && (
        <div className="ml-1 flex shrink-0 items-center">
          {roteiros.length > 0 && (
            <select
              className={juntar(campo, "mr-1 h-8 w-[150px] px-2 text-[12px]")}
              value={take.roteiro_id && take.cena_ref ? `${take.roteiro_id}|${take.cena_ref}` : take.roteiro_id ? `${take.roteiro_id}|` : ""}
              disabled={ocupado}
              aria-label={`Cena do roteiro de ${take.nome}`}
              onChange={(e) => {
                const [r, c] = e.target.value.split("|");
                void mudar({ roteiro_id: r || null, cena_ref: c || null }, "Take ligado ao roteiro");
              }}
            >
              <option value="">Sem cena</option>
              {roteiros.map((r) =>
                r.cenas.map((c) => (
                  <option key={`${r.id}|${c.ref}`} value={`${r.id}|${c.ref}`}>
                    {r.titulo.slice(0, 18)} · cena {c.ordem}
                  </option>
                )),
              )}
            </select>
          )}
          <button type="button" className={botao.icone} aria-label={`Renomear ${take.nome}`} onClick={() => setEditando(true)} disabled={ocupado}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={botao.icone}
            aria-label={`Arquivar ${take.nome}`}
            title="Arquivar (não apaga o arquivo)"
            onClick={() => void mudar({ estado: "arquivado" }, "Take arquivado")}
            disabled={ocupado || take.melhor}
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

export default function EtapaOrganizar({ irPara }: { irPara: IrPara }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const roteirosQ = useRoteirosAprovados(clientId);
  const [proposta, setProposta] = useState<{ mensagemId: string; acao: AcaoDoAgente } | null>(null);
  const [propondo, setPropondo] = useState(false);
  const arquivos = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter((a) => naEntradaDaEdicao(a) && a.tipo !== "entrega");
  const degradado = !!(arquivosQ.data && arquivosQ.data.degradado);
  const roteiros = (roteirosQ.data && roteirosQ.data.roteiros) || [];
  const melhores = arquivos.filter((a) => a.melhor).length;
  const grupos = useMemo(() => {
    const m: Record<string, ArquivoDeVideo[]> = {};
    const ordem: string[] = [];
    arquivos.forEach((a) => {
      const g = a.grupo || "Sem grupo";
      if (!m[g]) {
        m[g] = [];
        ordem.push(g);
      }
      m[g].push(a);
    });
    ordem.sort((a, b) => (a === "Sem grupo" ? 1 : b === "Sem grupo" ? -1 : a.localeCompare(b, "pt-BR")));
    return ordem.map((g) => ({ grupo: g, takes: m[g].slice().sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")) }));
  }, [arquivos]);

  const propor = async () => {
    setPropondo(true);
    try {
      const r = await chamarMesaVideos<{ mensagem_id: string | null; acao: unknown }>({ acao: "takes_organizar_propor", client_id: clientId });
      const acao = acaoDoAnexo(r.acao);
      if (!r.mensagem_id || !acao) {
        setProposta(null);
        toast.success("Já está organizado", { description: "Nomes e grupos seguem o padrão por roteiro e cena." });
      } else setProposta({ mensagemId: r.mensagem_id, acao });
    } catch (e) {
      toast.error("Não foi possível propor", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setPropondo(false);
    }
  };

  const onPedido = (pedido: PedidoDaAcao): Promise<RespostaDaAcao> => {
    if (!proposta) return Promise.resolve({});
    const corpo: Record<string, unknown> = {
      acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente",
      mensagem_id: proposta.mensagemId,
      acao_id: proposta.acao.id,
    };
    if (pedido === "descartar") corpo.descartar = true;
    if (pedido === "parar") corpo.parar = true;
    return chamarMesaVideos<RespostaDaAcao>(corpo);
  };

  return (
    <div className="min-w-0 space-y-5 pb-6">
      <Secao
        titulo="Organizar"
        descricao={arquivosQ.data ? `${arquivos.length} ${arquivos.length === 1 ? "vídeo" : "vídeos"} · ${grupos.filter((g) => g.grupo !== "Sem grupo").length} grupos · ${melhores} ${melhores === 1 ? "melhor" : "melhores"}` : undefined}
        ajuda="Separa por roteiro, cena e tomada, propõe nomes no padrão roteiro_c01_t01 e sugere o melhor take de cada cena. Você confere a lista e confirma; dá para desfazer. O arquivo original nunca muda."
        acao={
          <>
            <button type="button" className={botao.primario} onClick={() => void propor()} disabled={propondo || degradado || !arquivos.length} aria-label="Organizar por roteiro e cena">
              {propondo ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <FolderTree className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">Organizar tudo</span>
            </button>
            {arquivos.length > 0 && (
              <button type="button" className={botao.secundario} onClick={() => irPara("editar")}>
                Editar
              </button>
            )}
          </>
        }
      >
        {degradado && <AvisoDeAtivacao>O organizador precisa do acervo de vídeo no banco (SQL V2-01) e da função mesa-videos publicada.</AvisoDeAtivacao>}
        {proposta && (
          <div className="mb-4">
            <CartaoDeAcao
              acao={proposta.acao}
              titulo="Organizar os takes"
              onPedido={onPedido}
              onFeito={() => void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) })}
              observacao="Sem custo. Nada muda até confirmar, e dá para desfazer."
            />
          </div>
        )}
        {arquivosQ.isLoading ? (
          <Carregando linhas={5} rotulo="Lendo os vídeos" />
        ) : !arquivos.length ? (
          <EstadoVazio
            icone={<FolderTree className="h-5 w-5" />}
            titulo="Nenhum vídeo ainda"
            descricao="Suba os vídeos na Entrada."
            acao={
              <button type="button" className={botao.secundario} onClick={() => irPara("entrada")}>
                Abrir a Entrada
              </button>
            }
          />
        ) : (
          <div className="space-y-5">
            {grupos.map((g) => (
              <section key={g.grupo} aria-label={g.grupo} className="min-w-0">
                <p className={texto.rotulo}>
                  {g.grupo} <span className="font-normal tabular-nums">({g.takes.length})</span>
                </p>
                <ul className="divide-y divide-border">
                  {g.takes.map((t) => (
                    <LinhaDoTake key={t.id} take={t} podeEditar={!t.so_no_storage} roteiros={roteiros} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Secao>
    </div>
  );
}
