import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Eye, GripVertical, ImagePlus, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import NavegadorDePastas, { type ImagemEscolhida } from "../NavegadorDePastas";
import { ImagemDaMesa, useMesa } from "../MesaContexto";
import { estadoNoCalendario } from "../../../../supabase/functions/_shared/calendario-da-grade";
import { avisosDaSequencia } from "../../../../supabase/functions/_shared/instagram-do-cliente";
import DetalheDoPost, { bucketDoItem, TOM_DO_CALENDARIO } from "./DetalheDoPost";
import PainelDeMudancas from "./PainelDeMudancas";
import type { ItemDaGradeNaAba } from "./instagramApi";
import { dataCurtaOuSem, type Planejamento } from "./usePlanejamento";

/**
 * Grade e simulador (rodada 3, 28/09: "liberdade total"). Os posts que vão ao
 * ar (Agenda, Estúdio, Mesa Foto) e as artes postas só na simulação, na ordem
 * de ir ao ar, que é a ordem das datas: arrastar, as setas ou mudar a data no
 * post mudam a ordem, e a prévia e o calendário mudam junto. Travado só o que
 * já está agendado na Meta ou publicado, com o motivo. Tudo vira antes e
 * depois; o Confirmar agenda em lote pelo "Publicar em".
 */

const ROTULO_DA_ORIGEM: Record<ItemDaGradeNaAba["origem"], string> = { arte: "Estúdio", foto: "Mesa Foto", agenda: "Agenda", simulado: "Só simulação" };
const ROTULO_DO_FORMATO: Record<string, string> = { carrossel: "Carrossel", estatico: "Estático", foto: "Fotos", reel: "Reels", outro: "Post" };

/** Onde está a imagem escolhida no navegador de pastas (para virar post simulado). */
async function imagemEscolhida(clientId: string, e: ImagemEscolhida): Promise<{ bucket: string; caminho: string } | null> {
  const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (e.origem === "acervo") {
    const { data } = await db.from("cliente_imagens").select("client_id, storage_bucket, storage_path").eq("id", e.id).maybeSingle();
    return data && data.client_id === clientId && data.storage_path ? { bucket: String(data.storage_bucket || "mesa"), caminho: String(data.storage_path) } : null;
  }
  if (e.origem === "workspace") {
    const { data } = await db.from("workspace_nodes").select("client_id, storage_path").eq("id", e.id).maybeSingle();
    return data && data.client_id === clientId && data.storage_path ? { bucket: "workspace", caminho: String(data.storage_path) } : null;
  }
  const { data } = await db.from("files").select("client_id, storage_bucket, storage_path").eq("id", e.id).maybeSingle();
  return data && data.client_id === clientId && data.storage_bucket && data.storage_path ? { bucket: String(data.storage_bucket), caminho: String(data.storage_path) } : null;
}

export default function PlanoDaGrade({
  plano,
  podePublicar,
  onVerNaPrevia,
  onMudou,
}: {
  plano: Planejamento;
  podePublicar: boolean;
  onVerNaPrevia: () => void;
  onMudou: () => void;
}) {
  const { clientId } = useMesa();
  const [arrastado, setArrastado] = useState<string | null>(null);
  const [aberto, setAberto] = useState<ItemDaGradeNaAba | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [datasRecolhidas, setDatasRecolhidas] = useRecolhido(`mesa:instagram:grade-datas:${clientId}`, false);
  const lista = plano.ordenados;
  const dentro = plano.naSimulacao;
  const avisos = avisosDaSequencia(dentro);

  const adicionar = async (e: ImagemEscolhida) => {
    try {
      const onde = await imagemEscolhida(clientId, e);
      if (!onde) throw new Error("Não achei a imagem escolhida.");
      plano.adicionarSimulado({ ...onde, nome: e.nome });
      setEscolhendo(false);
    } catch (err) {
      toast.error("Não deu para pôr na simulação", { description: textoDoErro(err) });
    }
  };

  return (
    <div className="min-w-0 space-y-3" data-plano-da-grade="">
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <p className={juntar(texto.auxiliar, "mr-2 leading-5")}>
          {dentro.length} de {lista.length} na simulação. A ordem é a das datas: o 1º sai primeiro.
        </p>
        <span className="flex items-center [&>*]:ml-1.5">
          <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} onClick={() => setEscolhendo(true)}>
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Pôr arte
          </button>
          <button type="button" className={juntar(botao.primario, "h-8 px-2.5 text-[12px]")} onClick={onVerNaPrevia}>
            <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Ver na prévia
          </button>
        </span>
      </div>

      {!lista.length && (
        <p className={juntar(texto.auxiliar, "leading-5")}>
          Nenhum post pronto para ir ao ar. Os aprovados ou prontos da Agenda, do Estúdio e os posts de fotos da Mesa Foto aparecem aqui para simular; dá também para pôr uma arte do acervo.
        </p>
      )}

      <ol className="min-w-0 space-y-1.5" aria-label="Posts na ordem de ir ao ar">
        {lista.map((item, i) => {
          const trava = plano.travaDoItem(item);
          const noPlano = plano.fora.indexOf(item.id) < 0;
          const estado = estadoNoCalendario(item);
          const proposta = plano.rascunho[item.id];
          return (
            <li
              key={item.id}
              className={juntar("flex min-w-0 items-center rounded-md border bg-card px-2 py-1.5", arrastado === item.id ? "border-primary opacity-60" : "border-border", noPlano ? "" : "opacity-60")}
              draggable={!trava}
              onDragStart={(e) => {
                try {
                  e.dataTransfer.setData("text/plain", item.id);
                  e.dataTransfer.effectAllowed = "move";
                } catch {
                  /* sem dataTransfer: fica o id guardado */
                }
                setArrastado(item.id);
              }}
              onDragEnd={() => setArrastado(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (arrastado && arrastado !== item.id) plano.moverPorId(arrastado, item.id);
                setArrastado(null);
              }}
              data-item-da-grade={item.id}
            >
              {trava ? <Lock className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" aria-label={trava} /> : <GripVertical className="mr-1 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />}
              <input type="checkbox" className="mr-2 h-4 w-4 shrink-0 accent-primary" checked={noPlano} onChange={(e) => plano.naSimulacaoOuNao(item.id, e.target.checked)} aria-label={`${item.titulo} entra na simulação`} />
              <span className="mr-2 w-6 shrink-0 text-right text-[12px] font-medium tabular-nums text-muted-foreground">{i + 1}º</span>
              <button type="button" onClick={() => setAberto(item)} className="flex min-w-0 flex-1 items-center text-left" aria-label={`Abrir ${item.titulo}`}>
                <span className="relative mr-2 block h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
                  <ImagemDaMesa caminho={item.imagem ? item.imagem.caminho : null} bucket={bucketDoItem(item)} alt={item.titulo} className="absolute inset-0 h-full w-full" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium leading-4 text-foreground" title={item.titulo}>
                    {item.titulo}
                  </span>
                  <span className="block truncate text-[11.5px] leading-4 text-muted-foreground">
                    {ROTULO_DO_FORMATO[item.formato] || "Post"} · {ROTULO_DA_ORIGEM[item.origem]} · {proposta ? <strong className="text-primary">{dataCurtaOuSem(item.data)} (proposta)</strong> : dataCurtaOuSem(item.data)}
                  </span>
                </span>
                <span className={juntar(etiqueta, "ml-2 hidden shrink-0 sm:inline-flex", TOM_DO_CALENDARIO[estado.tom])} title={trava || undefined}>
                  {estado.rotulo}
                </span>
              </button>
              <span className="ml-1 flex shrink-0 items-center">
                <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => i > 0 && plano.moverPorId(item.id, lista[i - 1].id)} disabled={!!trava || i === 0} aria-label={`Pôr ${item.titulo} antes`}>
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => i < lista.length - 1 && plano.moverPorId(item.id, lista[i + 1].id)} disabled={!!trava || i >= lista.length - 1} aria-label={`Pôr ${item.titulo} depois`}>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      {avisos.map((a) => (
        <p key={a} className="flex items-start text-[12px] leading-4 text-warning">
          <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {a}
        </p>
      ))}

      <div className="min-w-0 rounded-md border border-border px-3 py-2" data-trocas-de-data="">
        <TituloRecolhivel
          titulo="Datas e agendamento"
          recolhido={datasRecolhidas}
          onAlternar={() => setDatasRecolhidas(!datasRecolhidas)}
          resumo={plano.mudancas.length + plano.pendentes.length ? `${plano.mudancas.length + plano.pendentes.length} para confirmar` : "tudo em ordem"}
        />
        {!datasRecolhidas && (
          <div className="mt-2 min-w-0">
            <PainelDeMudancas plano={plano} podePublicar={podePublicar} />
          </div>
        )}
      </div>

      <DetalheDoPost item={aberto} plano={plano} onFechar={() => setAberto(null)} podePublicar={podePublicar} onMudou={onMudou} />
      <NavegadorDePastas
        aberto={escolhendo}
        onOpenChange={setEscolhendo}
        titulo="Pôr uma arte na simulação"
        descricao="Escolha uma imagem do acervo, do Workspace ou de Arquivos. Ela entra na grade simulada; para agendar, crie o post na Mesa Foto."
        onEscolher={(e) => void adicionar(e)}
      />
    </div>
  );
}
