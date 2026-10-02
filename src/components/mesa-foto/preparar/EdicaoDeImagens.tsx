import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, Copy, Eraser, ImageOff, Loader2, Square, SunMedium, Wand2 } from "lucide-react";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { ImagemDaMesa, useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import ComparadorAntesDepois from "@/components/comparar/ComparadorAntesDepois";
import { botao, foco, juntar, texto } from "@/components/sistema/estilos";
import { padraoPara } from "@/lib/mesa/api";
import AcoesProDaFoto from "../AcoesProDaFoto";
import { acrescentarFotos, invalidarFotos, partesDoPreparo, prepararFoto, useFotos, useKits, type FotoDoAcervo, type ModoDePreparo } from "../fotoApi";
import { ehEditada } from "../seletores/seletores";
import { EDICOES_RAPIDAS, mudarAtivaDaFoto, podeFicarComODepois, trocarNaLista } from "./preparo";

/**
 * Editar imagens (Preparar imagens, 02/10/2026): as imagens escolhidas numa
 * fila à esquerda, a aberta no meio e as edições à direita. Cada edição grava
 * uma versão nova no acervo (derivada da aberta) e abre o antes e depois:
 * "Ficar com o depois" arquiva o antes (Desfazer volta), "Manter os dois"
 * guarda as duas. Nada é apagado de verdade.
 */

const ICONES: Record<string, ReactNode> = {
  fundo_transparente: <ImageOff className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />,
  fundo_branco: <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />,
  luz_cor: <SunMedium className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />,
  limpar: <Eraser className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />,
};

export function AntesEDepois({ antes, depois, podeArquivar, motivo, onFicar, onManter, ocupado }: { antes: FotoDoAcervo; depois: FotoDoAcervo; podeArquivar: boolean; motivo: string | null; onFicar: () => void; onManter: () => void; ocupado: boolean }) {
  const a = useUrlDaMesa(antes.storage_path, antes.storage_bucket);
  const d = useUrlDaMesa(depois.storage_path, depois.storage_bucket);
  const proporcao = depois.altura && depois.largura ? depois.altura / depois.largura : antes.altura && antes.largura ? antes.altura / antes.largura : 1;
  return (
    <div className="min-w-0" data-antes-e-depois={`${antes.id}:${depois.id}`}>
      <div className="mx-auto w-full max-w-[520px]">
        {a.data && d.data ? (
          <ComparadorAntesDepois tipo="imagem" antes={{ src: a.data, rotulo: "Antes" }} depois={{ src: d.data, rotulo: "Depois" }} proporcao={proporcao} rotulo={`Antes e depois de ${antes.nome}`} />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted" aria-busy="true">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        )}
      </div>
      <p className={juntar(texto.auxiliar, "mt-2 text-center")}>O depois já está salvo no acervo como editada.</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-center">
        <button type="button" className={juntar(botao.primario, "mb-1 mr-2")} onClick={onFicar} disabled={!podeArquivar || ocupado} title={motivo || "Arquiva o antes (Desfazer volta)"} data-ficar-com-o-depois="">
          {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />} Ficar com o depois
        </button>
        <button type="button" className={juntar(botao.secundario, "mb-1")} onClick={onManter} disabled={ocupado} data-manter-os-dois="">
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> Manter os dois
        </button>
      </div>
      {!podeArquivar && motivo && <p className={juntar(texto.auxiliar, "mt-1 text-center")}>{motivo}</p>}
    </div>
  );
}

export default function EdicaoDeImagens({ ids, onIds, onVoltar }: { ids: string[]; onIds: (ids: string[]) => void; onVoltar: () => void }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotos = useFotos(clientId).data || [];
  const kits = useKits(clientId).data || [];
  const [atualId, setAtualId] = useState<string | null>(ids[0] || null);
  const [comparar, setComparar] = useState<{ antes: string; depois: string } | null>(null);
  const [cenario, setCenario] = useState("");
  const [pedido, setPedido] = useState("");
  const [trabalhando, setTrabalhando] = useState<string | null>(null);
  const [arquivando, setArquivando] = useState(false);
  const padrao = padraoPara(catalogo, "imagem");
  const modeloId = padrao ? padrao.id : "";
  useEffect(() => {
    if (!atualId || ids.indexOf(atualId) < 0) setAtualId(ids[0] || null);
  }, [ids, atualId]);
  const atual = atualId ? fotos.find((f) => f.id === atualId) || null : null;
  const antes = comparar ? fotos.find((f) => f.id === comparar.antes) || null : null;
  const depois = comparar ? fotos.find((f) => f.id === comparar.depois) || null : null;

  const aoNova = (nova: FotoDoAcervo | null, de: string) => {
    if (!nova) return;
    acrescentarFotos(queryClient, clientId, [nova]);
    invalidarFotos(queryClient, clientId);
    setComparar({ antes: de, depois: nova.id });
  };

  const editar = (modo: ModoDePreparo, rotulo: string, extra: { cenario?: string; instrucao?: string } = {}, icone: ReactNode | null = null, primario = false) =>
    atual ? (
      <BotaoComCusto
        key={`${modo}-${rotulo}`}
        rotulo={
          <>
            {icone}
            {rotulo}
          </>
        }
        titulo={`${rotulo}: versão nova`}
        descricao="Sai uma versão nova no acervo, ligada à original. O original não muda."
        variant={primario ? "default" : "outline"}
        className="mb-1.5 mr-1.5 h-8 text-[12px]"
        disabled={!!trabalhando || !modeloId || (modo === "cenario" && !(extra.cenario || "").trim()) || (extra.instrucao !== undefined && !extra.instrucao.trim())}
        partes={() => partesDoPreparo(modeloId, "alta")}
        executar={async () => {
          setTrabalhando(modo);
          try {
            return await prepararFoto({ clientId, imagemId: atual.id, modo, areas: [], cenario: extra.cenario || "", instrucao: extra.instrucao || "" });
          } finally {
            setTrabalhando(null);
          }
        }}
        aoConcluir={(data) => aoNova(data && data.imagem ? data.imagem : null, atual.id)}
      />
    ) : null;

  const ficarComODepois = async () => {
    if (!comparar) return;
    const { antes: a, depois: d } = comparar;
    setArquivando(true);
    try {
      await mudarAtivaDaFoto(clientId, a, false);
      invalidarFotos(queryClient, clientId);
      onIds(trocarNaLista(ids, a, d));
      setAtualId(d);
      setComparar(null);
      toast.success("Ficou só o depois", {
        description: "O antes foi arquivado (não apagado).",
        action: {
          label: "Desfazer",
          onClick: () =>
            void mudarAtivaDaFoto(clientId, a, true)
              .then(() => invalidarFotos(queryClient, clientId))
              .catch((e) => avisarErro(e, "Não voltou")),
        },
      });
    } catch (e) {
      avisarErro(e, "O antes não foi arquivado");
    } finally {
      setArquivando(false);
    }
  };

  const manterOsDois = () => {
    if (!comparar) return;
    const { antes: a, depois: d } = comparar;
    const i = ids.indexOf(a);
    onIds(ids.indexOf(d) >= 0 ? ids : i >= 0 ? ids.slice(0, i + 1).concat([d], ids.slice(i + 1)) : ids.concat([d]));
    setAtualId(d);
    setComparar(null);
  };

  const pode = comparar ? podeFicarComODepois(comparar.antes, kits) : { ok: false, motivo: null };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row" data-edicao-de-imagens="">
      <div className="mb-3 flex min-w-0 shrink-0 items-start lg:mb-0 lg:mr-4 lg:w-[92px] lg:flex-col">
        <button type="button" className={juntar(botao.discreto, "mb-2 mr-2 h-8 px-2 text-[12px]")} onClick={onVoltar}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Voltar
        </button>
        <ul className="flex min-w-0 overflow-x-auto scrollbar-hidden lg:flex-col lg:overflow-y-auto" aria-label="Imagens em edição">
          {ids.map((id) => {
            const f = fotos.find((x) => x.id === id);
            if (!f) return null;
            return (
              <li key={id} className="mb-2 mr-2 shrink-0 lg:mr-0">
                <button
                  type="button"
                  onClick={() => {
                    setAtualId(id);
                    setComparar(null);
                  }}
                  aria-pressed={id === atualId}
                  aria-label={f.nome}
                  className={juntar("block h-[72px] w-[72px] overflow-hidden rounded-md border-2", id === atualId ? "border-primary" : "border-transparent", foco)}
                  data-em-edicao={id}
                >
                  <MiniaturaDoStorage bucket={f.storage_bucket} caminho={f.storage_path} alt={f.nome} largura={160} className="h-full w-full" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-hidden">
        {comparar && antes && depois ? (
          <AntesEDepois antes={antes} depois={depois} podeArquivar={pode.ok} motivo={pode.motivo} onFicar={() => void ficarComODepois()} onManter={manterOsDois} ocupado={arquivando} />
        ) : atual ? (
          <div className="mx-auto w-full max-w-[520px]">
            <ImagemDaMesa caminho={atual.storage_path} bucket={atual.storage_bucket} alt={atual.nome} className="max-h-[60vh] w-full rounded-md !object-contain" />
            <p className={juntar(texto.auxiliar, "mt-2 truncate text-center")}>
              {atual.nome}
              {ehEditada(atual) ? " · editada" : ""}
            </p>
          </div>
        ) : (
          <p className={texto.auxiliar}>Escolha uma imagem na fila.</p>
        )}
      </div>

      {atual && !comparar && (
        <aside className="mt-4 min-w-0 shrink-0 lg:ml-4 lg:mt-0 lg:w-[300px] lg:overflow-y-auto scrollbar-hidden" aria-label="Edições" data-edicoes="">
          <p className={juntar(texto.rotulo, "mb-2")}>Um clique</p>
          <div className="flex min-w-0 flex-wrap">{EDICOES_RAPIDAS.map((e, i) => editar(e.modo, e.rotulo, {}, ICONES[e.modo] || null, i === 0))}</div>
          <p className={juntar(texto.rotulo, "mb-1.5 mt-3")}>Trocar o cenário</p>
          <input value={cenario} onChange={(e) => setCenario(e.target.value)} placeholder="Ex.: bancada de mármore com luz de janela" aria-label="Cenário novo" className="mb-1.5 h-8 w-full min-w-0 rounded-md border border-border bg-transparent px-2 text-[13px]" />
          {editar("cenario", "Trocar cenário", { cenario }, <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />)}
          <p className={juntar(texto.rotulo, "mb-1.5 mt-3")}>Ajuste pelo pedido</p>
          <input value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: mais quente e com menos reflexo" aria-label="Ajuste pedido" className="mb-1.5 h-8 w-full min-w-0 rounded-md border border-border bg-transparent px-2 text-[13px]" />
          {editar("luz_cor", "Ajustar", { instrucao: pedido }, <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />)}
          <p className={juntar(texto.rotulo, "mb-1.5 mt-3")}>Ampliar e recorte pro</p>
          <AcoesProDaFoto foto={atual} onPronta={(nova) => aoNova(nova, atual.id)} />
        </aside>
      )}
    </div>
  );
}
