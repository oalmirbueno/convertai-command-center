import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CalendarDays, Check, ChevronDown, ChevronRight, ImagePlus, Shapes, Sparkles } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, etiqueta, foco, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useMesaFoto } from "./Comuns";
import {
  acharPeca,
  levarPecaAoCanvas,
  pedidoAoDiretorDaPeca,
  resumoDaDirecao,
  rotuloDaData,
  usePecasDeFoto,
  type PecaDeFoto,
  type PedidoDePeca,
} from "./pecasDeFoto";
import SeletorDeModelo from "./seletores/SeletorDeModelo";
import { dadosDaPessoa, type OpcaoDeModelo } from "./seletores/seletores";

// 02/10: Preparar imagens (catálogo de produtos, modelos e clones, editar com antes e depois) abre daqui.
const PrepararImagens = lazy(() => import("./preparar/PrepararImagens"));

/**
 * Esteira das peças de foto do mês, no topo da Mesa Foto (02/10/2026; dono:
 * "quando eu abrir, a esteira do que está pronto, como nos estúdios, já
 * puxando a direção de foto certa"). Uma faixa só, recolhível: cada peça com
 * a data, o título e o resumo da direção; a proposta que ainda não foi
 * gravada aparece com "não gravado". Tocar abre a peça numa janela central
 * com a direção inteira e dois caminhos: o diretor (o pedido fica no campo
 * dele, para revisar e mandar com o custo à vista) ou uma caixa nova no
 * Canvas, já montada. "Feita" fica marcada neste navegador.
 *
 * O endereço direto (?peca= ou ?task=) chega como `pedido`: a janela abre
 * sozinha quando a lista chega, e `onPedidoAtendido` limpa o pedido.
 */
export default function EsteiraDoMes({ mostrarFaixa = true, pedido = null, onPedidoAtendido }: { mostrarFaixa?: boolean; pedido?: PedidoDePeca | null; onPedidoAtendido?: () => void }) {
  const { clientId, marca } = useMesa();
  const { pedirAoDiretor, irPara, etapa } = useMesaFoto();
  const pecasQ = usePecasDeFoto(clientId, marca ? marca.id : null);
  const [aberta, setAberta] = useEstadoDaTela<boolean>(`mesa-foto:esteira-aberta:${clientId}`, true, { validar: (v) => typeof v === "boolean" });
  const [feitas, setFeitas] = useEstadoDaTela<string[]>(`mesa-foto:pecas-feitas:${clientId}`, [], { validar: (v) => Array.isArray(v) && v.every((x) => typeof x === "string") });
  const [vendo, setVendo] = useState<PecaDeFoto | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [preparoUsado, setPreparoUsado] = useState(false);

  const pecas = useMemo(() => {
    const lista = pecasQ.data || [];
    // Feitas vão para o fim (a ordem de dentro fica: gravadas primeiro, depois pela data).
    return lista.filter((p) => feitas.indexOf(p.chave) < 0).concat(lista.filter((p) => feitas.indexOf(p.chave) >= 0));
  }, [pecasQ.data, feitas]);
  const aFazer = pecas.filter((p) => feitas.indexOf(p.chave) < 0).length;

  // Endereço direto: abre a peça quando a lista chega (ou avisa que ela não está na esteira).
  useEffect(() => {
    if (!pedido || pecasQ.isLoading) return;
    const achada = acharPeca(pecasQ.data || [], pedido);
    if (achada) setVendo(achada);
    else if (pecasQ.isError) toast.info("Não deu para ler a esteira agora", { description: "Abra a peça pela faixa do topo quando ela carregar." });
    else toast.info("Essa peça não está na esteira", { description: "Ela não é de foto ou não cai neste mês nem no próximo." });
    if (onPedidoAtendido) onPedidoAtendido();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido, pecasQ.isLoading, pecasQ.data]);

  const alternarFeita = (p: PecaDeFoto) => setFeitas(feitas.indexOf(p.chave) >= 0 ? feitas.filter((x) => x !== p.chave) : feitas.concat([p.chave]).slice(-200));

  const comODiretor = (p: PecaDeFoto, modelo: OpcaoDeModelo | null) => {
    setVendo(null);
    if (pedirAoDiretor) pedirAoDiretor(pedidoAoDiretorDaPeca(p, modelo ? modelo.nome : null), { soRascunho: true });
    toast.success("Direção no campo do diretor", { description: "Revise o pedido e mande. O custo aparece antes de gerar." });
  };

  const noCanvas = (p: PecaDeFoto, modelo: OpcaoDeModelo | null) => {
    setVendo(null);
    levarPecaAoCanvas(clientId, p, modelo ? dadosDaPessoa(modelo) : null);
    if (etapa === "canvas") {
      try {
        window.dispatchEvent(new Event("mesa-foto:peca-levada"));
      } catch {
        /* navegador sem evento: a caixa entra ao reabrir o Canvas */
      }
    } else irPara("canvas");
  };

  const temLista = pecasQ.isSuccess && pecas.length > 0;
  const semPecas = pecasQ.isSuccess && pecas.length === 0;

  return (
    <>
      {mostrarFaixa && (
        <section className="mb-4 min-w-0 shrink-0" aria-label="Peças de foto do mês" data-esteira-do-mes="">
          <div className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={() => setAberta(!aberta)}
              aria-expanded={aberta}
              className={juntar("inline-flex min-w-0 items-center rounded text-[13px] font-semibold text-foreground", foco)}
              data-alternar-esteira=""
            >
              {aberta ? <ChevronDown className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <CalendarDays className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Peças do mês
            </button>
            {pecasQ.isSuccess && (
              <span className={juntar(etiqueta, "ml-2", aFazer ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")} data-pecas-a-fazer={aFazer}>
                {aFazer ? `${aFazer} para fazer` : semPecas ? "nenhuma" : "tudo feito"}
              </span>
            )}
            <AjudaRecolhida className="ml-1.5" rotulo="O que é a esteira?">
              As peças de foto do planejamento deste mês e do próximo, com a direção de foto de cada uma. Toque numa peça para gerar com o diretor ou montar no Canvas. Peça marcada como não gravado ainda não foi gravada na agenda. Preparar imagens junta produtos, modelos e clones e edita imagens com antes e depois.
            </AjudaRecolhida>
            <button
              type="button"
              className={juntar(botao.secundario, "ml-auto h-8 px-2.5 text-[12px]")}
              onClick={() => {
                setPreparoUsado(true);
                setPreparando(true);
              }}
              data-abrir-preparar-imagens=""
            >
              <ImagePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Preparar imagens
            </button>
          </div>
          {aberta && semPecas && <p className={juntar(texto.auxiliar, "mt-1.5")}>Nenhuma peça de foto no planejamento deste mês e do próximo.</p>}
          {aberta && temLista && (
            <ul className="mt-2 flex min-w-0 overflow-x-auto pb-1 scrollbar-hidden" data-lista-de-pecas="">
              {pecas.map((p) => {
                const feita = feitas.indexOf(p.chave) >= 0;
                return (
                  <li key={p.chave} className="mr-2 w-[220px] shrink-0">
                    <button
                      type="button"
                      onClick={() => setVendo(p)}
                      className={juntar(
                        "flex h-full w-full min-w-0 flex-col rounded-lg border border-border px-3 py-2 text-left transition-colors hover:border-primary/50",
                        feita && "opacity-60",
                        foco,
                      )}
                      data-peca={p.chave}
                      data-gravada={p.gravada ? "sim" : "nao"}
                    >
                      <span className="flex min-w-0 items-center">
                        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{rotuloDaData(p) || "sem data"}</span>
                        {!p.gravada && <span className={juntar(etiqueta, "ml-auto bg-warning/15 text-warning")}>não gravado</span>}
                        {feita && (
                          <span className={juntar(etiqueta, "ml-auto bg-primary/10 text-primary")}>
                            <Check className="mr-0.5 h-3 w-3" aria-hidden="true" /> feita
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] font-medium text-foreground">{p.titulo}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{resumoDaDirecao(p.foto)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {preparoUsado && (
        <Suspense fallback={null}>
          <PrepararImagens aberta={preparando} onFechar={() => setPreparando(false)} />
        </Suspense>
      )}
      <JanelaDaPeca clientId={clientId} peca={vendo} feita={!!vendo && feitas.indexOf(vendo.chave) >= 0} onFechar={() => setVendo(null)} onDiretor={comODiretor} onCanvas={noCanvas} onFeita={alternarFeita} />
    </>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 py-1.5">
      <dt className={juntar(texto.rotulo, "w-28 shrink-0 pt-0.5")}>{rotulo}</dt>
      <dd className={juntar(texto.corpo, "min-w-0 flex-1 [overflow-wrap:anywhere]")}>{children}</dd>
    </div>
  );
}

/** A peça aberta: a direção inteira e os dois caminhos (diretor ou Canvas). */
export function JanelaDaPeca({
  clientId,
  peca,
  feita,
  onFechar,
  onDiretor,
  onCanvas,
  onFeita,
}: {
  clientId: string;
  peca: PecaDeFoto | null;
  feita: boolean;
  onFechar: () => void;
  onDiretor: (p: PecaDeFoto, modelo: OpcaoDeModelo | null) => void;
  onCanvas: (p: PecaDeFoto, modelo: OpcaoDeModelo | null) => void;
  onFeita: (p: PecaDeFoto) => void;
}) {
  const f = peca ? peca.foto : null;
  // A pessoa da peça: modelo da IA ou clone (seletor de modelo); vazio segue a direção em palavras.
  const [modelo, setModelo] = useState<OpcaoDeModelo | null>(null);
  useEffect(() => setModelo(null), [peca ? peca.chave : ""]);
  return (
    <JanelaCentral
      aberta={!!peca}
      onFechar={onFechar}
      titulo={peca ? peca.titulo : "Peça do mês"}
      icone={<CalendarDays className="h-4 w-4 text-primary" />}
      descricao={peca ? `${rotuloDaData(peca) || "Sem data"}${peca.gravada ? "" : " · não gravado na agenda"}` : undefined}
      ajuda="A direção vem do planejamento do mês. Com o diretor, o pedido fica no campo dele para você revisar e mandar. No Canvas, entra uma caixa nova já montada."
      largura="md"
      data-janela-da-peca={peca ? peca.chave : ""}
      rodape={
        peca ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end">
            <button type="button" className={juntar(botao.discreto, "mb-1 mr-auto")} onClick={() => onFeita(peca)} aria-pressed={feita}>
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> {feita ? "Desmarcar feita" : "Marcar como feita"}
            </button>
            <button type="button" className={juntar(botao.secundario, "mb-1 ml-2")} onClick={() => onCanvas(peca, modelo)} data-peca-no-canvas="">
              <Shapes className="mr-1.5 h-4 w-4" aria-hidden="true" /> Montar no Canvas
            </button>
            <button type="button" className={juntar(botao.primario, "mb-1 ml-2")} onClick={() => onDiretor(peca, modelo)} data-peca-no-diretor="">
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" /> Gerar com o diretor
            </button>
          </div>
        ) : null
      }
    >
      {peca && f && (
        <dl className="min-w-0 divide-y divide-border" data-direcao-da-foto="">
          <Linha rotulo="Assunto">{f.assunto}</Linha>
          {f.objetivo && <Linha rotulo="Objetivo">{f.objetivo}</Linha>}
          <Linha rotulo="Fotos">
            {f.quantidade} {f.quantidade === 1 ? "foto" : "fotos"}
          </Linha>
          <Linha rotulo="Ângulos">{f.angulos.join(", ")}</Linha>
          <Linha rotulo="Cenário">{f.cenario || "A definir com o diretor"}</Linha>
          <Linha rotulo="Luz">{f.luz}</Linha>
          <Linha rotulo="Pessoa">{f.pessoa || "Sem pessoa"}</Linha>
          {f.texto_na_foto && <Linha rotulo="Texto na foto">{f.texto_na_foto}</Linha>}
          {f.referencias.length > 0 && <Linha rotulo="Referências">{f.referencias.join("; ")}</Linha>}
          {peca.tema && peca.tema !== peca.titulo && <Linha rotulo="Tema">{peca.tema}</Linha>}
        </dl>
      )}
      {peca && (
        <details className="mt-3 min-w-0" open={!!(f && f.pessoa)} data-pessoa-da-peca="">
          <summary className={juntar(texto.rotulo, "cursor-pointer select-none py-1")}>{modelo ? `Pessoa: ${modelo.nome}` : "Escolher a pessoa (modelo ou clone)"}</summary>
          <SeletorDeModelo className="mt-2" clientId={clientId} valor={modelo ? modelo.chave : null} onEscolher={setModelo} />
        </details>
      )}
    </JanelaCentral>
  );
}
