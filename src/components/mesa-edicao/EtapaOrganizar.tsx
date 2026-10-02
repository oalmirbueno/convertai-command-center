import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, FolderSync, FolderTree, Loader2, Pencil, Star, X } from "lucide-react";
import MenuMais from "@/components/sistema/MenuMais";
import { toast } from "sonner";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { acaoDoAnexo, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import Secao from "@/components/sistema/Secao";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { AvisoDeAtivacao, SeloDoTipo } from "@/components/mesa-videos/Comuns";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";
import { chamarMesaVideos, chaveDosArquivos, duracaoCurta, naEntradaDaEdicao, useArquivosDeVideo, useRoteirosAprovados, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import {
  antesDoTratado,
  categoriaDoArquivo,
  modoDaEntrada,
  pastasNaTela,
  ruidoDaEntrada,
  type PastaNaTela,
} from "../../../supabase/functions/mesa-videos/modulos/organizador-da-entrada";
import {
  confirmarEspelhoNoWorkspace,
  desfazerEspelhoNoWorkspace,
  falasGuardadas,
  organizarEntrada,
  proporEspelhoNoWorkspace,
  type PlanoDoEspelhoNaTela,
  type ResultadoDaOrganizacao,
} from "@/lib/edicao/acoesDaEdicao";

/**
 * Organizar (Mesa Edição, frente E2; organizador inteligente em 02/10).
 *
 * "Organizar tudo" entende se a Entrada é UM vídeo (uma gravação longa: ganha
 * o nome do vídeo e as pastas Brutos, Exportados, Amostras e Antes e depois)
 * ou VÁRIOS clipes (junta as tomadas da mesma cena pelo roteiro, pelo nome,
 * pela fala e, na dúvida, pelo Jev; põe na ordem e sugere o melhor take). A
 * proposta segue o contrato comum: a lista exata, Confirmar ou Cancelar e
 * Desfazer. A lista mostra as pastas com as variantes de cada cena numa linha
 * só. "Arrumar no Workspace" põe a mesma organização no Workspace do cliente
 * (só move e renomeia o que já está lá). O arquivo original nunca muda.
 */

type Desfazer = Record<string, unknown>;
type RoteiroCurto = { id: string; titulo: string; cenas: { ref: string; ordem: number; titulo: string }[] };

async function editarArquivo(id: string, campos: Record<string, unknown>): Promise<{ arquivo: unknown; desfazer: Desfazer }> {
  return chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: id, campos });
}

function LinhaDoTake({ take, podeEditar, roteiros, variantes = 0, antes = null }: { take: ArquivoDeVideo; podeEditar: boolean; roteiros: RoteiroCurto[]; variantes?: number; antes?: string | null }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(take.nome);
  const [ocupado, setOcupado] = useState(false);
  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
  const roteiro = roteiros.find((r) => r.id === take.roteiro_id) || null;
  const ehBruto = categoriaDoArquivo(take) === "bruto";

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
            void mudar({ nome }, "Renomeado").then((ok) => ok && setEditando(false));
          }}
        >
          <input className={campo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} aria-label="Novo nome" autoFocus />
          <button type="submit" className={juntar(botao.icone, "ml-1 text-primary")} aria-label="Salvar nome" disabled={ocupado}>
            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button type="button" className={botao.icone} aria-label="Cancelar" onClick={() => setEditando(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center text-[13px] font-medium">
            <span className="truncate" title={take.nome_original !== take.nome ? `Original: ${take.nome_original}` : undefined}>
              {take.nome}
            </span>
            {variantes > 0 && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")} title="Variantes da mesma cena (formatos, amostra, still)">+{variantes}</span>}
          </p>
          <p className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
            <SeloDoTipo tipo={take.tipo} />
            {duracaoCurta(take.duracao_s) && <span className="mr-1.5 tabular-nums">{duracaoCurta(take.duracao_s)}</span>}
            {roteiro && <span className="mr-1.5 truncate">{roteiro.titulo}</span>}
            {antes && <span className="truncate">Antes: {antes}</span>}
          </p>
        </div>
      )}
      {!editando && podeEditar && (
        <div className="ml-1 flex shrink-0 items-center">
          {ehBruto && roteiros.length > 0 && (
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
          {/* 28/09 (dono: "menos poluído"): renomear e arquivar ficam no "..." da linha. */}
          <MenuMais
            rotulo={`Mais ações de ${take.nome}`}
            desativado={ocupado}
            itens={[
              { rotulo: "Renomear", icone: <Pencil className="h-3.5 w-3.5" />, aoEscolher: () => setEditando(true) },
              {
                rotulo: "Arquivar",
                icone: <Archive className="h-3.5 w-3.5" />,
                dica: take.melhor ? "O melhor take não arquiva: desmarque antes." : "Arquivar (não apaga o arquivo)",
                desativado: take.melhor,
                aoEscolher: () => void mudar({ estado: "arquivado" }, "Arquivado"),
              },
            ]}
          />
        </div>
      )}
    </li>
  );
}

/** Uma pasta (grupo "Pasta / Subpasta") com as variantes juntas; o nome vira o botão de recolher. */
function PastaDaEntrada({ pasta, roteiros, clientId, todos }: { pasta: PastaNaTela<ArquivoDeVideo>; roteiros: RoteiroCurto[]; clientId: string; todos: ArquivoDeVideo[] }) {
  const [recolhido, setRecolhido] = useRecolhido(`mesa-edicao:pasta:${pasta.caminho}:${clientId}`, false);
  return (
    <section aria-label={pasta.caminho} className="min-w-0" data-pasta={pasta.caminho} data-recolhido={recolhido ? "sim" : "nao"}>
      <TituloRecolhivel
        titulo={
          <>
            {pasta.caminho} <span className="font-normal tabular-nums text-muted-foreground">({pasta.total})</span>
          </>
        }
        recolhido={recolhido}
        onAlternar={() => setRecolhido(!recolhido)}
        resumo={`${pasta.total} ${pasta.total === 1 ? "arquivo" : "arquivos"}`}
      />
      {!recolhido && (
        <ul className="divide-y divide-border">
          {pasta.grupos.map((g) => {
            const antes = categoriaDoArquivo(g.principal) === "tratado" ? antesDoTratado(g.principal, todos) : null;
            return <LinhaDoTake key={g.chave} take={g.principal} podeEditar={!g.principal.so_no_storage} roteiros={roteiros} variantes={g.variantes.length - 1} antes={antes ? antes.nome : null} />;
          })}
        </ul>
      )}
    </section>
  );
}

/** Espelho no Workspace: prévia do que muda lá (só move e renomeia o que já está lá), Confirmar e Desfazer. */
function JanelaDoEspelho({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const { clientId } = useMesa();
  const [plano, setPlano] = useState<PlanoDoEspelhoNaTela | null>(null);
  const [lendo, setLendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  useEffect(() => {
    if (!aberta) return;
    let vivo = true;
    setLendo(true);
    proporEspelhoNoWorkspace(clientId)
      .then((r) => {
        if (vivo) setPlano(r.plano);
      })
      .catch((e) => {
        if (vivo) toast.error("Não foi possível ler o Workspace", { description: textoDoErro(e) });
      })
      .finally(() => {
        if (vivo) setLendo(false);
      });
    return () => {
      vivo = false;
    };
  }, [aberta, clientId]);

  const confirmar = async () => {
    if (!plano) return;
    setAplicando(true);
    try {
      const r = await confirmarEspelhoNoWorkspace(clientId, plano.grupos);
      onFechar();
      toast.success(`${r.movidos} ${r.movidos === 1 ? "vídeo arrumado" : "vídeos arrumados"} no Workspace`, {
        description: r.falhas.length ? `${r.falhas.length} ficaram como estavam: ${r.falhas[0].motivo}` : undefined,
        action: {
          label: "Desfazer",
          onClick: () => {
            void desfazerEspelhoNoWorkspace(clientId, r.registro).then(
              (d) => toast.success(`${d.restaurados} voltaram como estavam`),
              (e) => toast.error("Não foi possível desfazer", { description: textoDoErro(e) }),
            );
          },
        },
        duration: 12000,
      });
    } catch (e) {
      toast.error("Não foi possível arrumar o Workspace", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setAplicando(false);
    }
  };

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      largura="md"
      icone={<FolderSync className="h-4 w-4" />}
      titulo="Arrumar no Workspace"
      descricao={plano ? `${plano.pares.length} no Workspace · ${plano.so_na_mesa} só na Mesa` : undefined}
      ajuda="Põe no Workspace do cliente a mesma organização da Mesa: os vídeos que já estão lá vão para as mesmas pastas, dentro de Vídeos, com o mesmo nome. Nada é copiado nem apagado; o que só existe na Mesa fica só na Mesa. Dá para desfazer."
      rodape={
        <div className="flex w-full justify-end">
          <button type="button" className={botao.primario} disabled={!plano || !plano.grupos.length || aplicando} onClick={() => void confirmar()}>
            {aplicando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Confirmar
          </button>
        </div>
      }
    >
      {lendo ? (
        <Carregando linhas={3} rotulo="Lendo o Workspace" />
      ) : !plano || !plano.pares.length ? (
        <EstadoVazio compacto titulo="Nada para arrumar no Workspace." descricao="Nenhum vídeo da Mesa com pasta está no Workspace do cliente." />
      ) : (
        <ul className="divide-y divide-border" aria-label="O que muda no Workspace">
          {plano.pares.map((p) => (
            <li key={p.no_id} className="min-w-0 py-1.5">
              <p className="truncate text-[13px]">{p.de}</p>
              <p className={juntar(texto.auxiliar, "truncate")}>{p.para}</p>
            </li>
          ))}
        </ul>
      )}
    </JanelaCentral>
  );
}

export default function EtapaOrganizar({ irPara }: { irPara: IrPara }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const roteirosQ = useRoteirosAprovados(clientId);
  const [proposta, setProposta] = useState<{ mensagemId: string; acao: AcaoDoAgente } | null>(null);
  const [leitura, setLeitura] = useState<ResultadoDaOrganizacao | null>(null);
  const [propondo, setPropondo] = useState(false);
  const [arquivarRuido, setArquivarRuido] = useEstadoDaTela<boolean>(`mesa-edicao:organizar:ruido:${clientId}`, false, { validar: (v) => typeof v === "boolean" });
  const [espelho, setEspelho] = useState(false);
  const dados = arquivosQ.data;
  const arquivos = useMemo(() => ((dados && dados.arquivos) || []).filter((a) => naEntradaDaEdicao(a) && a.tipo !== "entrega"), [dados]);
  const degradado = !!(dados && dados.degradado);
  const roteiros = (roteirosQ.data && roteirosQ.data.roteiros) || [];
  const melhores = arquivos.filter((a) => a.melhor).length;
  const pastas = useMemo(() => pastasNaTela(arquivos), [arquivos]);
  const modo = useMemo(() => modoDaEntrada(arquivos), [arquivos]);
  const ruido = useMemo(() => ruidoDaEntrada(arquivos).length, [arquivos]);

  const propor = async () => {
    setPropondo(true);
    try {
      // A fala de cada take (Transcrição da Entrada, guardada neste navegador) ajuda a juntar as tomadas da mesma cena.
      const r = await organizarEntrada(clientId, { arquivarRuido, falas: falasGuardadas(clientId, arquivos) });
      setLeitura(r);
      const acao = acaoDoAnexo(r.acao);
      if (!r.mensagem_id || !acao) {
        setProposta(null);
        toast.success("Já está organizado", { description: r.leitura ? r.leitura.resumo : undefined });
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

  const comCenas = leitura && leitura.leitura && leitura.leitura.modo === "varios_clipes" ? ` em ${leitura.cenas.length} ${leitura.cenas.length === 1 ? "cena" : "cenas"}` : "";

  return (
    <div className="min-w-0 space-y-6 pb-6">
      <Secao
        titulo="Organizar"
        descricao={dados ? `${arquivos.length} ${arquivos.length === 1 ? "arquivo" : "arquivos"} · ${modo.resumo}${comCenas} · ${melhores} ${melhores === 1 ? "melhor" : "melhores"}` : undefined}
        ajuda="Entende se é um vídeo só ou vários clipes. Um vídeo: ganha o nome do vídeo e as pastas Brutos, Exportados, Amostras e Antes e depois. Clipes: junta as tomadas da mesma cena (pelo nome, pela fala e, na dúvida, pelo Jev), põe na ordem e sugere o melhor take. Você confere a lista e confirma; dá para desfazer. O arquivo original nunca muda."
        acao={
          <>
            {ruido > 0 && (
              <label className={juntar(texto.auxiliar, "mr-2 flex items-center")} title="Amostras e stills de cenas que já têm o vídeo final, e renders velhos do mesmo formato. Arquivar não apaga.">
                <input type="checkbox" className="mr-1.5" checked={arquivarRuido} onChange={(e) => setArquivarRuido(e.target.checked)} aria-label="Arquivar as sobras" />
                Arquivar {ruido} {ruido === 1 ? "sobra" : "sobras"}
              </label>
            )}
            <button type="button" className={botao.primario} onClick={() => void propor()} disabled={propondo || degradado || !arquivos.length} aria-label="Organizar tudo">
              {propondo ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <FolderTree className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">Organizar tudo</span>
            </button>
            {arquivos.length > 0 && (
              <button type="button" className={botao.secundario} onClick={() => irPara("editar")}>
                Editar
              </button>
            )}
            <MenuMais
              rotulo="Mais ações do Organizar"
              desativado={degradado || !arquivos.length}
              itens={[{ rotulo: "Arrumar no Workspace", icone: <FolderSync className="h-3.5 w-3.5" />, dica: "A mesma organização no Workspace do cliente", aoEscolher: () => setEspelho(true) }]}
            />
          </>
        }
      >
        {degradado && <AvisoDeAtivacao>O organizador precisa do acervo de vídeo no banco (SQL V2-01) e da função mesa-videos publicada.</AvisoDeAtivacao>}
        {proposta && (
          <div className="mb-4">
            <CartaoDeAcao
              acao={proposta.acao}
              titulo="Organizar a Entrada"
              onPedido={onPedido}
              onFeito={() => void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) })}
              observacao={leitura && leitura.jev && leitura.jev.respondidas ? `O Jev decidiu ${leitura.jev.respondidas} ${leitura.jev.respondidas === 1 ? "par" : "pares"} de clipes. Nada muda até confirmar, e dá para desfazer.` : "Sem custo. Nada muda até confirmar, e dá para desfazer."}
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
          <div className="space-y-4">
            {pastas.map((p) => (
              <PastaDaEntrada key={p.caminho} pasta={p} roteiros={roteiros} clientId={clientId} todos={arquivos} />
            ))}
          </div>
        )}
      </Secao>
      {espelho && <JanelaDoEspelho aberta onFechar={() => setEspelho(false)} />}
    </div>
  );
}
