import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Loader2, Palette, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { botao, JanelaCentral, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { ajustesDoItem, ANCORAS, AJUSTES_PADRAO, rotuloDaVariacao, soOQueMuda, variacoesDeCor, type AjustesDoMockup, type AjustesProprios, type TipoDeFundoDaCena } from "@/lib/mockups/ajustes";
import { rotuloDaCategoria, type MockupDoCatalogo } from "@/lib/mockups/catalogo";
import type { EscolhasDoDesign, LogoCarregada } from "@/lib/mockups/designDoSlot";
import { fundoDosAjustes, ROTULOS_DO_FUNDO, type FundoPedido } from "@/lib/mockups/fundoDaCena";
import { paraBlob, renderizarMockup } from "@/lib/mockups/renderizar";

/**
 * Ajustar um mockup (frente MCK, rodada 2): cor, variações lado a lado, posição, tamanho, giro,
 * versão da logo, padrão, luz e fundo da cena. O que muda aqui vale só para este mockup; "Usar em
 * todos" leva para o geral. A prévia é a mesma conta do lote (WebGL), na versão de trabalho.
 */
export default function AjustesDoMockup({
  mockup,
  geral,
  proprios,
  cores,
  logos,
  textura,
  montarEscolhas,
  escolhido,
  onSalvar,
  onUsarEmTodos,
  onAlternarEscolha,
  onBaixar,
  onFechar,
}: {
  mockup: MockupDoCatalogo | null;
  geral: AjustesDoMockup;
  proprios: AjustesProprios | undefined;
  cores: string[];
  logos: LogoCarregada[];
  textura: FundoPedido["textura"];
  montarEscolhas: (a: AjustesDoMockup) => EscolhasDoDesign;
  escolhido: boolean;
  onSalvar: (proprios: AjustesProprios) => void;
  onUsarEmTodos: (a: AjustesDoMockup) => void;
  /** Escolher este mockup, já com os ajustes próprios novos (o estado da tela ainda não os tem). */
  onAlternarEscolha: (proprios: AjustesProprios) => void;
  onBaixar: (a: AjustesDoMockup) => void;
  onFechar: () => void;
}) {
  const [rascunho, setRascunho] = useState<AjustesDoMockup>(AJUSTES_PADRAO);
  const [montando, setMontando] = useState(false);
  const [variacoes, setVariacoes] = useState<Array<{ fundo: number; segunda: number; url: string }> | null>(null);
  const [gerandoVariacoes, setGerandoVariacoes] = useState(false);
  const tela = useRef<HTMLCanvasElement>(null);
  const versao = useRef(0);

  // Abre com o que vale hoje para este mockup (o geral com os ajustes dele por cima).
  useEffect(() => {
    if (mockup) setRascunho(ajustesDoItem(geral, proprios));
    setVariacoes(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockup && mockup.id]);

  const cenaDe = (a: AjustesDoMockup) => ({ luz: a.luz, brilho: a.brilho, fundo: fundoDosAjustes(a, cores, textura) });

  // Prévia: redesenha 120 ms depois do último ajuste.
  useEffect(() => {
    if (!mockup || !tela.current) return;
    const minha = ++versao.current;
    const t = setTimeout(async () => {
      setMontando(true);
      try {
        const r = await renderizarMockup(mockup, "trabalho", logos, montarEscolhas(rascunho), undefined, cenaDe(rascunho));
        if (versao.current !== minha || !tela.current) return;
        const alvo = tela.current;
        alvo.width = r.canvas.width;
        alvo.height = r.canvas.height;
        const ctx = alvo.getContext("2d");
        if (ctx) ctx.drawImage(r.canvas, 0, 0);
      } catch (e) {
        toast.error(`${mockup.nome}: ${textoDoErro(e, "a prévia não abriu.")}`);
      } finally {
        if (versao.current === minha) setMontando(false);
      }
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockup, rascunho, logos, montarEscolhas]);

  // As miniaturas das variações vivem só enquanto a janela está aberta.
  useEffect(
    () => () => {
      if (variacoes) variacoes.forEach((v) => URL.revokeObjectURL(v.url));
    },
    [variacoes],
  );

  const verVariacoes = async () => {
    if (!mockup) return;
    setGerandoVariacoes(true);
    const lista: Array<{ fundo: number; segunda: number; url: string }> = [];
    try {
      for (const v of variacoesDeCor(cores.length, 8)) {
        const a = { ...rascunho, fundo: v.fundo, segunda: v.segunda };
        const r = await renderizarMockup(mockup, "trabalho", logos, montarEscolhas(a), undefined, cenaDe(a));
        const mini = document.createElement("canvas");
        const f = Math.min(1, 360 / Math.max(r.canvas.width, r.canvas.height));
        mini.width = Math.max(1, Math.round(r.canvas.width * f));
        mini.height = Math.max(1, Math.round(r.canvas.height * f));
        const ctx = mini.getContext("2d");
        if (ctx) ctx.drawImage(r.canvas, 0, 0, mini.width, mini.height);
        lista.push({ ...v, url: URL.createObjectURL(await paraBlob(mini, "image/jpeg", 0.82)) });
      }
      setVariacoes(lista);
    } catch (e) {
      lista.forEach((v) => URL.revokeObjectURL(v.url));
      toast.error(textoDoErro(e, "As variações não foram montadas."));
    } finally {
      setGerandoVariacoes(false);
    }
  };

  const mudar = (parte: Partial<AjustesDoMockup>) => setRascunho((a) => ({ ...a, ...parte }));
  const temFundo = !!(mockup && mockup.fundoTrocavel);
  const mudou = useMemo(() => Object.keys(soOQueMuda(geral, rascunho)).length, [geral, rascunho]);
  const papeis = mockup ? mockup.slots.map((s) => s.papel) : [];
  const temArte = papeis.indexOf("arte") >= 0 || papeis.indexOf("verso") >= 0;

  // As camadas de trabalho ficam: o lote usa as mesmas e cuida de soltar (EstudioDeMockups).
  const fechar = () => onFechar();

  return (
    <JanelaCentral
      aberta={!!mockup}
      onFechar={fechar}
      largura="tela"
      titulo={mockup ? mockup.nome : ""}
      descricao={mockup ? `${rotuloDaCategoria(mockup.categoria)}${mockup.fonte === "ia" ? " · feito com IA" : ""}${temFundo ? " · fundo trocável" : ""}${mudou ? ` · ${mudou} ajuste${mudou > 1 ? "s" : ""} só dele` : ""}` : undefined}
      ajuda="O que você muda aqui vale só para este mockup. Usar em todos leva estes ajustes para o lote inteiro. A logo e a foto entram pelo código; a IA nunca redesenha a marca."
      rodape={
        mockup ? (
          <span className="flex min-w-0 flex-wrap items-center justify-end">
            <button type="button" className={juntar(botao.discreto, "mb-1 mr-2")} onClick={() => setRascunho(geral)}>
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden /> Voltar ao geral
            </button>
            <button type="button" className={juntar(botao.secundario, "mb-1 mr-2")} onClick={() => onUsarEmTodos(rascunho)}>
              Usar em todos
            </button>
            <button type="button" className={juntar(botao.secundario, "mb-1 mr-2")} onClick={() => onBaixar(rascunho)}>
              <Download className="mr-1.5 h-4 w-4" aria-hidden /> PNG em alta
            </button>
            <button
              type="button"
              className={juntar(botao.primario, "mb-1")}
              onClick={() => {
                const p = soOQueMuda(geral, rascunho);
                onSalvar(p);
                if (!escolhido) onAlternarEscolha(p);
                fechar();
              }}
            >
              <Check className="mr-1.5 h-4 w-4" aria-hidden /> {escolhido ? "Salvar ajustes" : "Salvar e escolher"}
            </button>
          </span>
        ) : null
      }
    >
      {mockup ? (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <div className="relative min-w-0 overflow-hidden rounded-md bg-muted">
              <canvas ref={tela} className="block h-auto w-full" aria-label={`Prévia de ${mockup.nome}`} />
              {montando ? (
                <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/80">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                </span>
              ) : null}
            </div>
            {temArte && cores.length > 1 ? (
              <div className="mt-4 min-w-0">
                <div className="mb-2 flex min-w-0 items-center">
                  <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>Variações de cor</span>
                  <button type="button" className={botao.secundario} disabled={gerandoVariacoes} onClick={() => void verVariacoes()}>
                    {gerandoVariacoes ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Palette className="mr-1.5 h-4 w-4" aria-hidden />}
                    {variacoes ? "Montar de novo" : "Ver variações"}
                  </button>
                </div>
                {variacoes ? (
                  <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                    {variacoes.map((v) => {
                      const atual = v.fundo === rascunho.fundo && v.segunda === rascunho.segunda;
                      return (
                        <button
                          key={`${v.fundo}-${v.segunda}`}
                          type="button"
                          aria-pressed={atual}
                          aria-label={rotuloDaVariacao(cores, v)}
                          title={rotuloDaVariacao(cores, v)}
                          onClick={() => mudar({ fundo: v.fundo, segunda: v.segunda })}
                          className={juntar("block min-w-0 overflow-hidden rounded-md bg-muted", atual && "ring-2 ring-primary")}
                        >
                          <img src={v.url} alt="" className="block h-auto w-full" />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="grid min-w-0 content-start gap-5">
            {temArte ? (
              <div className="grid min-w-0 gap-3">
                <Cores rotulo="Cor de fundo" cores={cores} valor={rascunho.fundo} onEscolher={(i) => mudar({ fundo: i })} />
                {papeis.indexOf("verso") >= 0 ? <Cores rotulo="Segunda cor (verso)" cores={cores} valor={rascunho.segunda} onEscolher={(i) => mudar({ segunda: i })} /> : null}
                <Escolha
                  rotulo="Arte"
                  valor={rascunho.modo}
                  opcoes={[
                    { id: "logo", rotulo: "Logo" },
                    { id: "padrao", rotulo: "Padrão repetido" },
                  ]}
                  onEscolher={(v) => mudar({ modo: v as AjustesDoMockup["modo"] })}
                />
              </div>
            ) : null}

            <Escolha
              rotulo="Versão da logo"
              valor={rascunho.variante}
              opcoes={[
                { id: "auto", rotulo: "Automática" },
                { id: "original", rotulo: "Do kit" },
                { id: "branca", rotulo: "Branca" },
                { id: "preta", rotulo: "Preta" },
              ]}
              onEscolher={(v) => mudar({ variante: v as AjustesDoMockup["variante"] })}
            />

            <div className="grid min-w-0 gap-3">
              <span className={texto.rotulo}>Posição da logo</span>
              <div className="flex min-w-0 items-start">
                <div role="group" aria-label="Posição rápida" className="mr-4 grid shrink-0 grid-cols-3 gap-1">
                  {ANCORAS.map((p) => {
                    const ligado = rascunho.posicaoX === p.x && rascunho.posicaoY === p.y;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-label={p.rotulo}
                        aria-pressed={ligado}
                        title={p.rotulo}
                        onClick={() => mudar({ posicaoX: p.x, posicaoY: p.y })}
                        className={juntar("toque-compacto h-7 w-7 rounded border border-border", ligado ? "bg-primary" : "bg-transparent hover:bg-muted")}
                      />
                    );
                  })}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="grid min-w-0 gap-2">
                    <Faixa rotulo="Horizontal" min={-1} max={1} passo={0.05} valor={rascunho.posicaoX} mostrar={(v) => `${Math.round(v * 100)}`} onMudar={(v) => mudar({ posicaoX: v })} />
                    <Faixa rotulo="Vertical" min={-1} max={1} passo={0.05} valor={rascunho.posicaoY} mostrar={(v) => `${Math.round(v * 100)}`} onMudar={(v) => mudar({ posicaoY: v })} />
                  </div>
                </div>
              </div>
              <Faixa rotulo="Tamanho" min={0} max={1} passo={0.05} valor={rascunho.escala} mostrar={(v) => (v === 0 ? "Automático" : `${Math.round(v * 100)}%`)} onMudar={(v) => mudar({ escala: v })} />
              <Faixa rotulo="Giro" min={-180} max={180} passo={1} valor={rascunho.rotacao} mostrar={(v) => `${Math.round(v)}°`} onMudar={(v) => mudar({ rotacao: v })} />
            </div>

            <div className="grid min-w-0 gap-2">
              <span className={texto.rotulo}>Luz da cena</span>
              <Faixa rotulo="Sombra e brilho" min={0} max={1.5} passo={0.05} valor={rascunho.luz} mostrar={(v) => (v === 1 ? "Como no mockup" : v === 0 ? "Chapado" : `${Math.round(v * 100)}%`)} onMudar={(v) => mudar({ luz: v })} />
              <Faixa rotulo="Brilho da marca" min={0.6} max={1.4} passo={0.02} valor={rascunho.brilho} mostrar={(v) => `${Math.round(v * 100)}%`} onMudar={(v) => mudar({ brilho: v })} />
            </div>

            {temFundo ? (
              <div className="grid min-w-0 gap-3">
                <Escolha
                  rotulo="Fundo da cena"
                  valor={rascunho.fundoCena}
                  opcoes={(Object.keys(ROTULOS_DO_FUNDO) as TipoDeFundoDaCena[]).map((id) => ({ id, rotulo: ROTULOS_DO_FUNDO[id] }))}
                  onEscolher={(v) => mudar({ fundoCena: v as TipoDeFundoDaCena })}
                />
                {rascunho.fundoCena !== "original" ? <Cores rotulo="Cor do fundo da cena" cores={cores} valor={rascunho.corDoFundoCena} onEscolher={(i) => mudar({ corDoFundoCena: i })} /> : null}
                {rascunho.fundoCena === "textura" && !textura ? <p className={texto.auxiliar}>Escolha uma textura no geral para usar aqui.</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </JanelaCentral>
  );
}

function Cores({ rotulo, cores, valor, onEscolher }: { rotulo: string; cores: string[]; valor: number; onEscolher: (i: number) => void }) {
  return (
    <div role="group" aria-label={rotulo} className="grid min-w-0">
      <span className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</span>
      <div className="flex flex-wrap">
        {cores.map((c, i) => (
          <button
            key={`${c}-${i}`}
            type="button"
            aria-pressed={valor % cores.length === i}
            aria-label={`${rotulo}: ${c}`}
            onClick={() => onEscolher(i)}
            className={juntar("toque-compacto mb-1 mr-1.5 h-7 w-7 rounded-full border border-border", valor % cores.length === i && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

function Escolha({ rotulo, valor, opcoes, onEscolher }: { rotulo: string; valor: string; opcoes: Array<{ id: string; rotulo: string }>; onEscolher: (v: string) => void }) {
  return (
    <div role="group" aria-label={rotulo} className="grid min-w-0">
      <span className={juntar(texto.rotulo, "mb-1.5")}>{rotulo}</span>
      <div className="flex flex-wrap">
        {opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={valor === o.id}
            onClick={() => onEscolher(o.id)}
            className={juntar(botao.secundario, "mb-1.5 mr-1.5 h-8 px-3 text-[12px]", valor === o.id && "border-primary bg-primary/10 text-foreground")}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Faixa({ rotulo, min, max, passo, valor, mostrar, onMudar }: { rotulo: string; min: number; max: number; passo: number; valor: number; mostrar: (v: number) => string; onMudar: (v: number) => void }) {
  return (
    <label className="grid min-w-0">
      <span className="flex min-w-0 items-center">
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{rotulo}</span>
        <span className={juntar(texto.auxiliar, "tabular-nums")}>{mostrar(valor)}</span>
      </span>
      <input type="range" min={min} max={max} step={passo} value={valor} onChange={(e) => onMudar(Number(e.target.value))} />
    </label>
  );
}
