import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp, Eye, GripVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "@/components/shared/confirmDialog";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { confirmarPublicacao, textoDoErro } from "@/lib/mesa/api";
import { ImagemDaMesa, useMesa } from "../MesaContexto";
import { dataEHoraCurta, JanelaDaPublicacao, type PecaParaPublicar, type PublicacaoParaPublicar } from "../PublicacaoDaPeca";
import { amanhaAs, avisosDaSequencia, mover, mudancasDaSimulacao, ordemDoPlano } from "../../../../supabase/functions/_shared/instagram-do-cliente";
import { chamarInstagram, type ItemDaGradeNaAba } from "./instagramApi";

/**
 * Planejar a grade e simular o perfil (rodada 2, 28/09). Os posts que vão ao
 * ar (Agenda, Estúdio e posts de fotos da Mesa Foto) numa lista só, na ordem
 * de ir ao ar: marcar quais entram na simulação, arrastar ou usar as setas
 * para intercalar, e ver na prévia ao lado (Simulação). Só a data muda: as
 * datas que existem trocam de lugar na nova ordem e quem não tem data ganha
 * uma depois da última, no mesmo ritmo. Nada muda sem confirmação, e muda
 * pelo mesmo caminho do "Publicar em" (publica só com aprovação do cliente).
 */

const ROTULO_DA_ORIGEM: Record<ItemDaGradeNaAba["origem"], string> = { arte: "Estúdio", foto: "Mesa Foto", agenda: "Agenda" };
const ROTULO_DO_FORMATO: Record<string, string> = { carrossel: "Carrossel", estatico: "Estático", foto: "Fotos", reel: "Reels", outro: "Post" };

function Linha({
  clientId,
  item,
  posicao,
  total,
  noPlano,
  onNoPlano,
  onMover,
  onPublicar,
  arrastando,
  onArrastar,
  onSoltar,
}: {
  clientId: string;
  item: ItemDaGradeNaAba;
  posicao: number;
  total: number;
  noPlano: boolean;
  onNoPlano: (v: boolean) => void;
  onMover: (de: number, para: number) => void;
  onPublicar: (item: ItemDaGradeNaAba) => void;
  arrastando: boolean;
  onArrastar: (i: number | null) => void;
  onSoltar: (i: number) => void;
}) {
  const data = item.data ? dataEHoraCurta(item.data) : null;
  return (
    <li
      className={juntar("flex min-w-0 items-center rounded-md border bg-card px-2 py-1.5", arrastando ? "border-primary opacity-60" : "border-border", noPlano ? "" : "opacity-60")}
      draggable
      onDragStart={(e) => {
        try {
          e.dataTransfer.setData("text/plain", String(posicao));
          e.dataTransfer.effectAllowed = "move";
        } catch {
          /* navegador sem dataTransfer: fica o índice guardado */
        }
        onArrastar(posicao);
      }}
      onDragEnd={() => onArrastar(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onSoltar(posicao);
      }}
      data-item-da-grade={item.id}
    >
      <GripVertical className="mr-1 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
      <input type="checkbox" className="mr-2 h-4 w-4 shrink-0 accent-primary" checked={noPlano} onChange={(e) => onNoPlano(e.target.checked)} aria-label={`${item.titulo} entra na simulação`} />
      <span className="mr-2 w-6 shrink-0 text-right text-[12px] font-medium tabular-nums text-muted-foreground">{posicao + 1}º</span>
      <span className="relative mr-2 block h-12 w-9 shrink-0 overflow-hidden rounded bg-muted">
        <ImagemDaMesa caminho={item.imagem ? item.imagem.caminho : null} bucket={item.imagem ? item.imagem.bucket : "mesa"} alt={item.titulo} className="absolute inset-0 h-full w-full" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium leading-4 text-foreground" title={item.titulo}>
          {item.titulo}
        </span>
        <span className="block truncate text-[11.5px] leading-4 text-muted-foreground">
          {ROTULO_DO_FORMATO[item.formato] || "Post"} · {ROTULO_DA_ORIGEM[item.origem]} · {data ? `${data}${item.data_confirmada ? "" : " (proposta)"}` : "sem data"}
        </span>
      </span>
      <span className="ml-1 flex shrink-0 items-center">
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onMover(posicao, posicao - 1)} disabled={posicao === 0} aria-label={`Pôr ${item.titulo} antes`}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onMover(posicao, posicao + 1)} disabled={posicao >= total - 1} aria-label={`Pôr ${item.titulo} depois`}>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {item.peca ? (
          <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onPublicar(item)} aria-label={`Publicar em: ${item.titulo}`} title="Publicar em">
            <CalendarClock className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Link to={`/calendario?client=${encodeURIComponent(clientId)}`} className={juntar(botao.icone, "h-7 w-7")} aria-label={`Abrir ${item.titulo} na Agenda`} title="Abrir na Agenda">
            <CalendarClock className="h-3.5 w-3.5" />
          </Link>
        )}
      </span>
    </li>
  );
}

export default function PlanoDaGrade({
  itens,
  ordemSalva,
  foraDaSimulacao,
  onForaDaSimulacao,
  contaId,
  podePublicar,
  onOrdem,
  onVerNaPrevia,
  onMudou,
  horaPadrao = "11:30",
}: {
  itens: ItemDaGradeNaAba[];
  ordemSalva: string[];
  /** Ids que ficam fora da simulação (o resto entra). */
  foraDaSimulacao: string[];
  onForaDaSimulacao: (ids: string[]) => void;
  contaId: string | null;
  podePublicar: boolean;
  /** A ordem nova (ids), para a prévia e a mini agenda mudarem na hora. */
  onOrdem: (ids: string[]) => void;
  onVerNaPrevia: () => void;
  onMudou: () => void;
  horaPadrao?: string;
}) {
  const { clientId } = useMesa();
  const confirmar = useConfirm();
  const queryClient = useQueryClient();
  const ordenados = useMemo(() => ordemDoPlano(itens, ordemSalva), [itens, ordemSalva]);
  const escolhidos = useMemo(() => ordenados.filter((i) => foraDaSimulacao.indexOf(i.id) < 0), [ordenados, foraDaSimulacao]);
  const [arrastado, setArrastado] = useState<number | null>(null);
  const [aberto, setAberto] = useState<ItemDaGradeNaAba | null>(null);
  const [aplicando, setAplicando] = useState<{ feitos: number; total: number } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [datasRecolhidas, setDatasRecolhidas] = useRecolhido(`mesa:instagram:grade-datas:${clientId}`, false);
  const espera = useRef<number | null>(null);

  // Só o que tem peça do Estúdio ou da Mesa Foto muda de data por aqui.
  const mudancas = useMemo(() => {
    const comPeca = escolhidos.filter((i) => !!i.peca);
    return mudancasDaSimulacao(comPeca, amanhaAs(horaPadrao));
  }, [escolhidos, horaPadrao]);
  const avisos = useMemo(() => avisosDaSequencia(escolhidos), [escolhidos]);
  const semPeca = escolhidos.filter((i) => !i.peca).length;

  useEffect(
    () => () => {
      if (espera.current !== null) window.clearTimeout(espera.current);
    },
    [],
  );

  const guardar = (ids: string[]) => {
    onOrdem(ids);
    if (espera.current !== null) window.clearTimeout(espera.current);
    espera.current = window.setTimeout(async () => {
      setGuardando(true);
      try {
        await chamarInstagram("salvar_ordem", clientId, { ...(contaId ? { conta_id: contaId } : {}), ordem: ids });
      } catch (e) {
        toast.error("A ordem não ficou guardada", { description: textoDoErro(e) });
      } finally {
        setGuardando(false);
      }
    }, 700);
  };

  const moverItem = (de: number, para: number) => guardar(mover(ordenados, de, para).map((i) => i.id));
  const marcar = (id: string, dentro: boolean) => onForaDaSimulacao(dentro ? foraDaSimulacao.filter((x) => x !== id) : foraDaSimulacao.concat([id]));

  const aplicarDatas = async () => {
    const ok = await confirmar({
      title: `Mudar ${mudancas.length} ${mudancas.length === 1 ? "data" : "datas"}?`,
      description: "As datas ficam confirmadas na ordem da simulação. Cada post só vai ao ar depois da aprovação do cliente.",
      confirmLabel: "Mudar as datas",
    });
    if (!ok) return;
    const porId: Record<string, ItemDaGradeNaAba> = {};
    for (const i of itens) porId[i.id] = i;
    let feitos = 0;
    for (const t of mudancas) {
      setAplicando({ feitos, total: mudancas.length });
      const item = porId[t.id];
      if (!item || !item.peca) continue;
      try {
        await confirmarPublicacao(String(item.peca.id), t.para, !!item.peca.publicar_ao_aprovar);
        feitos++;
      } catch (e) {
        toast.error(`"${t.titulo}" não mudou`, { description: textoDoErro(e) });
        break;
      }
    }
    setAplicando(null);
    if (feitos) toast.success(`${feitos} ${feitos === 1 ? "data mudada" : "datas mudadas"}`);
    void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes"] });
    onMudou();
  };

  if (!itens.length) {
    return (
      <p className={juntar(texto.auxiliar, "leading-5")}>
        Nenhum post pronto para ir ao ar. Os aprovados ou prontos da Agenda, do Estúdio e os posts de fotos da Mesa Foto aparecem aqui para simular.
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-3" data-plano-da-grade="">
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <p className={juntar(texto.auxiliar, "mr-2 leading-5")}>
          {escolhidos.length} de {itens.length} na simulação. O 1º sai primeiro; arraste ou use as setas.
        </p>
        <span className="flex items-center">
          {guardando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Guardando a ordem" />}
          <button type="button" className={juntar(botao.primario, "h-8 px-2.5 text-[12px]")} onClick={onVerNaPrevia}>
            <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Ver na prévia
          </button>
        </span>
      </div>

      <ol className="min-w-0 space-y-1.5" aria-label="Posts na ordem de ir ao ar">
        {ordenados.map((item, i) => (
          <Linha
            key={item.id}
            clientId={clientId}
            item={item}
            posicao={i}
            total={ordenados.length}
            noPlano={foraDaSimulacao.indexOf(item.id) < 0}
            onNoPlano={(v) => marcar(item.id, v)}
            onMover={moverItem}
            onPublicar={setAberto}
            arrastando={arrastado === i}
            onArrastar={setArrastado}
            onSoltar={(para) => {
              if (arrastado !== null && arrastado !== para) moverItem(arrastado, para);
              setArrastado(null);
            }}
          />
        ))}
      </ol>

      {avisos.map((a) => (
        <p key={a} className="flex items-start text-[12px] leading-4 text-warning">
          <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {a}
        </p>
      ))}

      <div className="min-w-0 rounded-md border border-border px-3 py-2" data-trocas-de-data="">
        <TituloRecolhivel
          titulo="Datas da simulação"
          recolhido={datasRecolhidas}
          onAlternar={() => setDatasRecolhidas(!datasRecolhidas)}
          resumo={mudancas.length ? `${mudancas.length} para mudar` : "tudo em ordem"}
        />
        {!datasRecolhidas && (
          <div className="mt-2 min-w-0">
            {mudancas.length === 0 ? (
              <p className={texto.auxiliar}>As datas já estão na ordem da simulação.</p>
            ) : (
              <>
                <p className="text-[12.5px] font-medium text-foreground">Com esta ordem, as datas mudam assim:</p>
                <ul className="mt-1 space-y-0.5 text-[12px] leading-4 text-foreground">
                  {mudancas.map((t) => (
                    <li key={t.id} className="flex min-w-0">
                      <span className="mr-2 min-w-0 flex-1 truncate">{t.titulo}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{t.de ? dataEHoraCurta(t.de) : "sem data"}</span>
                      <span className="mx-1 shrink-0 text-muted-foreground">para</span>
                      <strong className="shrink-0 tabular-nums">{dataEHoraCurta(t.para)}</strong>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center">
                  {podePublicar ? (
                    <button type="button" className={juntar(botao.primario, "h-8 px-3 text-[12.5px]")} onClick={() => void aplicarDatas()} disabled={!!aplicando}>
                      {aplicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="mr-1.5 h-3.5 w-3.5" />}
                      {aplicando ? `Mudando ${aplicando.feitos + 1} de ${aplicando.total}` : "Aplicar as novas datas"}
                    </button>
                  ) : (
                    <p className={texto.auxiliar}>Só admin ou gestor muda as datas.</p>
                  )}
                </div>
              </>
            )}
            {semPeca > 0 && <p className={juntar(texto.auxiliar, "mt-1.5 leading-5")}>{semPeca} {semPeca === 1 ? "post da Agenda sem peça" : "posts da Agenda sem peça"} do Estúdio: a data desses muda na Agenda.</p>}
            <p className={juntar(etiqueta, "mt-2 bg-secondary text-muted-foreground")}>Publica só com aprovação do cliente e data confirmada</p>
          </div>
        )}
      </div>

      {aberto && aberto.peca && (
        <JanelaDaPublicacao
          aberta={!!aberto}
          onFechar={() => setAberto(null)}
          titulo={aberto.titulo}
          clientId={clientId}
          diaDaPeca={aberto.dia_da_peca}
          peca={aberto.peca as unknown as PecaParaPublicar}
          publicacao={(aberto.publicacao as unknown as PublicacaoParaPublicar) || null}
          podePublicar={podePublicar}
          onMudou={onMudou}
        />
      )}
    </div>
  );
}
