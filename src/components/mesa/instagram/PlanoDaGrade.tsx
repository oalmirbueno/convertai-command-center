import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Eye, GripVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "@/components/shared/confirmDialog";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { confirmarPublicacao, textoDoErro } from "@/lib/mesa/api";
import { ImagemDaMesa, useMesa } from "../MesaContexto";
import { dataEHoraCurta, JanelaDaPublicacao, type PecaParaPublicar, type PublicacaoParaPublicar } from "../PublicacaoDaPeca";
import { avisosDaSequencia, mover, ordemDoPlano, trocasDeData, type TrocaDeData } from "../../../../supabase/functions/_shared/instagram-do-cliente";
import { chamarInstagram, type ItemDaGradeNaAba } from "./instagramApi";

/**
 * Planejar a grade: os posts que vão ao ar (Agenda, Estúdio e posts de fotos
 * da Mesa Foto), na ordem de ir ao ar. Arrastar (ou as setas) intercala:
 * "posto este genérico antes daquele". A ordem fica guardada para a equipe.
 * Quando a ordem nova troca datas, a aba mostra o que muda e só aplica com
 * confirmação, pelo mesmo caminho do "Publicar em" (publica só com aprovação
 * do cliente e data confirmada). Cada post abre o "Publicar em" dele.
 */

const ROTULO_DA_ORIGEM: Record<ItemDaGradeNaAba["origem"], string> = { arte: "Estúdio", foto: "Mesa Foto", agenda: "Agenda" };

function Cartao({
  clientId,
  item,
  posicao,
  total,
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
  onMover: (de: number, para: number) => void;
  onPublicar: (item: ItemDaGradeNaAba) => void;
  arrastando: boolean;
  onArrastar: (i: number | null) => void;
  onSoltar: (i: number) => void;
}) {
  const data = item.data ? dataEHoraCurta(item.data) : null;
  return (
    <li
      className={juntar("w-[132px] shrink-0 rounded-md border bg-card p-1.5", arrastando ? "border-primary opacity-60" : "border-border")}
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
      <div className="relative w-full overflow-hidden rounded bg-muted" style={{ paddingBottom: "133.333%" }}>
        <ImagemDaMesa caminho={item.imagem ? item.imagem.caminho : null} bucket={item.imagem ? item.imagem.bucket : "mesa"} alt={item.titulo} className="absolute inset-0 h-full w-full" />
        <span className={juntar(etiqueta, "pointer-events-none absolute left-1 top-1 bg-background/90 text-foreground")}>{posicao + 1}º</span>
        <GripVertical className="absolute right-1 top-1 h-4 w-4 cursor-grab rounded bg-background/80 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mt-1 truncate text-[12px] font-medium leading-4 text-foreground" title={item.titulo}>
        {item.titulo}
      </p>
      <p className="truncate text-[11px] leading-4 text-muted-foreground">
        {ROTULO_DA_ORIGEM[item.origem]} · {data ? `${data}${item.data_confirmada ? "" : " (proposta)"}` : "sem data"}
      </p>
      <div className="mt-1 flex items-center justify-between">
        <span className="flex">
          <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onMover(posicao, posicao - 1)} disabled={posicao === 0} aria-label={`Pôr ${item.titulo} antes`}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onMover(posicao, posicao + 1)} disabled={posicao >= total - 1} aria-label={`Pôr ${item.titulo} depois`}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </span>
        {item.peca ? (
          <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => onPublicar(item)} aria-label={`Publicar em: ${item.titulo}`} title="Publicar em">
            <CalendarClock className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Link to={`/calendario?client=${encodeURIComponent(clientId)}`} className={juntar(botao.icone, "h-7 w-7")} aria-label={`Abrir ${item.titulo} na Agenda`} title="Abrir na Agenda">
            <CalendarClock className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </li>
  );
}

export default function PlanoDaGrade({
  itens,
  ordemSalva,
  contaId,
  podePublicar,
  onOrdem,
  onVerNaPrevia,
  onMudou,
}: {
  itens: ItemDaGradeNaAba[];
  ordemSalva: string[];
  contaId: string | null;
  podePublicar: boolean;
  /** A ordem nova (ids), para a prévia e a mini agenda mudarem na hora. */
  onOrdem: (ids: string[]) => void;
  onVerNaPrevia: () => void;
  onMudou: () => void;
}) {
  const { clientId } = useMesa();
  const confirmar = useConfirm();
  const queryClient = useQueryClient();
  const ordenados = useMemo(() => ordemDoPlano(itens, ordemSalva), [itens, ordemSalva]);
  const [arrastado, setArrastado] = useState<number | null>(null);
  const [aberto, setAberto] = useState<ItemDaGradeNaAba | null>(null);
  const [aplicando, setAplicando] = useState<{ feitos: number; total: number } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const espera = useRef<number | null>(null);

  // Datas de hoje (antes de reordenar) para calcular o que muda.
  const originais = useMemo(() => ordemDoPlano(itens, null), [itens]);
  const trocas: TrocaDeData[] = useMemo(() => {
    const porId: Record<string, ItemDaGradeNaAba> = {};
    for (const i of originais) porId[i.id] = i;
    return trocasDeData(ordenados.map((i) => porId[i.id] || i)).filter((t) => {
      const item = porId[t.id];
      return !!item && !!item.peca;
    });
  }, [ordenados, originais]);
  const avisos = useMemo(() => avisosDaSequencia(ordenados), [ordenados]);

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

  const aplicarDatas = async () => {
    const ok = await confirmar({
      title: `Trocar ${trocas.length} ${trocas.length === 1 ? "data" : "datas"}?`,
      description: "As datas ficam confirmadas na nova ordem. Cada post só vai ao ar depois da aprovação do cliente.",
      confirmLabel: "Trocar as datas",
    });
    if (!ok) return;
    const porId: Record<string, ItemDaGradeNaAba> = {};
    for (const i of itens) porId[i.id] = i;
    let feitos = 0;
    for (const t of trocas) {
      setAplicando({ feitos, total: trocas.length });
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
    if (feitos) toast.success(`${feitos} ${feitos === 1 ? "data trocada" : "datas trocadas"}`);
    void queryClient.invalidateQueries({ queryKey: ["editorial-calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "itens-do-mes"] });
    onMudou();
  };

  if (!itens.length) {
    return (
      <p className={juntar(texto.auxiliar, "leading-5")}>
        Nenhum post pronto para ir ao ar. Os aprovados ou prontos da Agenda, do Estúdio e os posts de fotos da Mesa Foto aparecem aqui.
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-2.5" data-plano-da-grade="">
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <p className={juntar(texto.auxiliar, "mr-2 leading-5")}>Ordem de ir ao ar (1º sai primeiro). Arraste ou use as setas para intercalar.</p>
        <span className="flex items-center">
          {guardando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Guardando a ordem" />}
          <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} onClick={onVerNaPrevia}>
            <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Ver na prévia
          </button>
        </span>
      </div>

      <ol className="-mx-1 flex min-w-0 overflow-x-auto px-1 pb-2 [&>li]:mr-2" aria-label="Posts na ordem de ir ao ar">
        {ordenados.map((item, i) => (
          <Cartao
            key={item.id}
            clientId={clientId}
            item={item}
            posicao={i}
            total={ordenados.length}
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

      {trocas.length > 0 && (
        <div className="min-w-0 rounded-md border border-primary/30 bg-primary/5 px-3 py-2" data-trocas-de-data="">
          <p className="text-[12.5px] font-medium text-foreground">Com esta ordem, as datas mudam assim:</p>
          <ul className="mt-1 space-y-0.5 text-[12px] leading-4 text-foreground">
            {trocas.map((t) => (
              <li key={t.id} className="min-w-0 truncate">
                {t.titulo}: {dataEHoraCurta(t.de)} para <strong>{dataEHoraCurta(t.para)}</strong>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center">
            {podePublicar ? (
              <button type="button" className={juntar(botao.primario, "h-8 px-3 text-[12.5px]")} onClick={() => void aplicarDatas()} disabled={!!aplicando}>
                {aplicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="mr-1.5 h-3.5 w-3.5" />}
                {aplicando ? `Trocando ${aplicando.feitos + 1} de ${aplicando.total}` : "Aplicar as novas datas"}
              </button>
            ) : (
              <p className={texto.auxiliar}>Só admin ou gestor troca as datas.</p>
            )}
          </div>
        </div>
      )}

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
