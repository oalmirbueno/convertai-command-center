import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { botao, juntar, texto } from "@/components/sistema";
import { modelosAtivos, textoDoErro, usd } from "@/lib/mesa/api";
import { useCatalogo } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { carregarImagem, estimarCena, gerarCena, salvarAplicacao } from "@/lib/mockups/api";
import { rotuloDoTipoDeCena, TIPOS_DE_CENA, type TipoDeCena } from "@/lib/mockups/cenas";
import type { EscolhasDoDesign, LogoCarregada } from "@/lib/mockups/designDoSlot";
import { detectarAreaLisa, ordenarCantos, type Ponto } from "@/lib/mockups/homografia";
import { comporCena } from "@/lib/mockups/renderizar";

/**
 * Cenas sob medida para o negócio do cliente (fachada, sinalização, veículo, embalagem, papelaria,
 * vestuário, tela digital e redes): a IA desenha só a cena, com uma área lisa; a marca entra pelo
 * código, por homografia, nos 4 cantos achados ou marcados à mão. O gerador é escolhido na hora,
 * com o custo antes.
 */
export default function EditorDeCena({
  clientId,
  marcaId,
  logos,
  escolhas,
  onUsar,
}: {
  clientId: string;
  marcaId: string | null;
  logos: LogoCarregada[];
  escolhas: EscolhasDoDesign;
  onUsar: (r: { aplicacaoId: string; imagem: Blob; nome: string; caminho: string; cantos: Ponto[]; luz: number }) => void;
}) {
  const [tipo, setTipo] = useState<TipoDeCena>("fachada");
  const [pedido, setPedido] = useState("");
  const catalogo = useCatalogo();
  const geradores = useMemo(() => modelosAtivos(catalogo.data || [], "imagem"), [catalogo.data]);
  const [modeloId, setModeloId] = useState("");
  const [estimativa, setEstimativa] = useState<{ valor: number; modelo: string } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [cena, setCena] = useState<{ caminho: string; img: HTMLImageElement } | null>(null);
  const [cantos, setCantos] = useState<Ponto[] | null>(null);
  const [luz, setLuz] = useState(0.6);
  const [salvando, setSalvando] = useState(false);
  const tela = useRef<HTMLCanvasElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const arrastando = useRef<number | null>(null);

  useEffect(() => {
    let vivo = true;
    setEstimativa(null);
    estimarCena({ clientId, tipo, modeloId: modeloId || null })
      .then((e) => {
        if (!vivo) return;
        setEstimativa({ valor: e.estimativa_usd, modelo: e.modelo_nome });
        // O seletor mostra o gerador que a função vai usar (o padrão do papel, se nada foi escolhido).
        if (!modeloId && e.modelo_id) setModeloId(e.modelo_id);
      })
      .catch((e) => vivo && toast.error(textoDoErro(e, "Não foi possível estimar o custo da cena.")));
    return () => {
      vivo = false;
    };
  }, [clientId, tipo, modeloId]);

  const gerar = async () => {
    setConfirmar(false);
    setGerando(true);
    try {
      const r = await gerarCena({ clientId, marcaId, tipo, pedido, modeloId: modeloId || null });
      const img = await carregarImagem(r.caminho, "mesa");
      setCena({ caminho: r.caminho, img });
      toast.success(`Cena pronta (${usd(r.custo_usd)}).`);
    } catch (e) {
      toast.error(textoDoErro(e, "A cena não foi gerada."));
    } finally {
      setGerando(false);
    }
  };

  // Acha a área lisa quando a cena chega (a equipe ajusta se precisar).
  useEffect(() => {
    if (!cena) return;
    const { img } = cena;
    const c = document.createElement("canvas");
    const f = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.round(img.naturalWidth * f);
    c.height = Math.round(img.naturalHeight * f);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const achados = detectarAreaLisa({ largura: c.width, altura: c.height, pixels: ctx.getImageData(0, 0, c.width, c.height).data });
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    setCantos(
      achados
        ? achados.map((p) => ({ x: p.x / f, y: p.y / f }))
        : [
            { x: W * 0.3, y: H * 0.25 },
            { x: W * 0.7, y: H * 0.25 },
            { x: W * 0.7, y: H * 0.45 },
            { x: W * 0.3, y: H * 0.45 },
          ],
    );
    if (!achados) toast.info("Não achei a área lisa sozinho: arraste os 4 cantos até a placa ou a tela.");
  }, [cena]);

  /** Desenha a cena com a marca aplicada, na escala pedida. */
  const compor = useCallback(
    (escala: number): HTMLCanvasElement | null => (cena && cantos ? comporCena(cena.img, cantos, logos, escolhas, luz, escala) : null),
    [cena, cantos, logos, escolhas, luz],
  );

  // Prévia leve (até 900 px) a cada mudança de canto, luz ou kit.
  useEffect(() => {
    if (!cena || !cantos || !tela.current) return;
    const escala = Math.min(1, 900 / Math.max(cena.img.naturalWidth, cena.img.naturalHeight));
    const pronto = compor(escala);
    const alvo = tela.current;
    if (!pronto) return;
    alvo.width = pronto.width;
    alvo.height = pronto.height;
    const ctx = alvo.getContext("2d");
    if (ctx) ctx.drawImage(pronto, 0, 0);
  }, [cena, cantos, compor]);

  // Arrastar os cantos (mouse e toque; Safari 11 não tem Pointer Events).
  useEffect(() => {
    const mover = (x: number, y: number) => {
      const i = arrastando.current;
      const el = caixa.current;
      if (i === null || !el || !cena) return;
      const r = el.getBoundingClientRect();
      const px = ((x - r.left) / r.width) * cena.img.naturalWidth;
      const py = ((y - r.top) / r.height) * cena.img.naturalHeight;
      setCantos((atual) => (atual ? atual.map((p, k) => (k === i ? { x: Math.max(0, Math.min(cena.img.naturalWidth, px)), y: Math.max(0, Math.min(cena.img.naturalHeight, py)) } : p)) : atual));
    };
    const noMouse = (e: MouseEvent) => mover(e.clientX, e.clientY);
    const noToque = (e: TouchEvent) => {
      if (arrastando.current === null || !e.touches[0]) return;
      e.preventDefault();
      mover(e.touches[0].clientX, e.touches[0].clientY);
    };
    const soltar = () => {
      arrastando.current = null;
    };
    window.addEventListener("mousemove", noMouse);
    window.addEventListener("touchmove", noToque, { passive: false });
    window.addEventListener("mouseup", soltar);
    window.addEventListener("touchend", soltar);
    return () => {
      window.removeEventListener("mousemove", noMouse);
      window.removeEventListener("touchmove", noToque);
      window.removeEventListener("mouseup", soltar);
      window.removeEventListener("touchend", soltar);
    };
  }, [cena]);

  const usar = async () => {
    if (!cena || !cantos) return;
    setSalvando(true);
    try {
      const pronto = compor(1);
      if (!pronto) throw new Error("Cena indisponível");
      const blob = await new Promise<Blob>((ok, falha) => pronto.toBlob((b) => (b ? ok(b) : falha(new Error("Imagem não gerada"))), "image/png"));
      const ap = await salvarAplicacao({
        clientId,
        marcaId,
        origem: "cena",
        cenaCaminho: cena.caminho,
        config: { tipo, cantos: ordenarCantos(cantos), luz, fundo: escolhas.fundo, segunda: escolhas.segunda, escala: escolhas.escala },
      });
      onUsar({ aplicacaoId: ap.id, imagem: blob, nome: rotuloDoTipoDeCena(tipo), caminho: cena.caminho, cantos: ordenarCantos(cantos), luz });
      toast.success("Cena guardada nas escolhas.");
    } catch (e) {
      toast.error(textoDoErro(e, "A cena não foi guardada."));
    } finally {
      setSalvando(false);
    }
  };

  const W = cena ? cena.img.naturalWidth : 1;
  const H = cena ? cena.img.naturalHeight : 1;

  return (
    <div className="grid min-w-0 gap-5">
      <div role="group" aria-label="Tipo de cena" className="flex min-w-0 flex-wrap">
        {TIPOS_DE_CENA.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tipo === t.id}
            onClick={() => setTipo(t.id)}
            className={juntar(botao.secundario, "mb-2 mr-2 h-8 px-3 text-[12px]", tipo === t.id && "border-primary bg-primary/10 text-foreground")}
          >
            {t.rotulo}
          </button>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <SeletorDeModelo catalogo={geradores} tipo="imagem" rotulo="Gerador da cena" valor={modeloId} onChange={(id) => setModeloId(id)} />
        <p className={texto.auxiliar}>{estimativa ? `${estimativa.modelo} · cerca de ${usd(estimativa.valor)} por cena` : "Calculando o custo..."}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center">
        <input
          value={pedido}
          onChange={(e) => setPedido(e.target.value)}
          placeholder="Detalhe da cena (opcional)"
          aria-label="Detalhe da cena"
          maxLength={300}
          className="mb-2 mr-3 block h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-[13px]"
        />
        {confirmar ? (
          <span className="mb-2 inline-flex items-center">
            <span className={juntar(texto.auxiliar, "mr-2")}>{estimativa ? `Custa cerca de ${usd(estimativa.valor)}` : "Custo a confirmar"}</span>
            <button type="button" className={juntar(botao.primario, "mr-2")} onClick={() => void gerar()}>
              <Check className="mr-1.5 h-4 w-4" aria-hidden /> Confirmar
            </button>
            <button type="button" className={botao.discreto} onClick={() => setConfirmar(false)}>
              Cancelar
            </button>
          </span>
        ) : (
          <button type="button" className={juntar(botao.primario, "mb-2")} disabled={gerando || !estimativa} onClick={() => setConfirmar(true)}>
            {gerando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />}
            {gerando ? "Gerando a cena" : `Gerar cena${estimativa ? ` · ${usd(estimativa.valor)}` : ""}`}
          </button>
        )}
      </div>

      {cena && cantos ? (
        <div className="grid min-w-0 gap-3">
          <div ref={caixa} className="relative mx-auto w-full max-w-[900px] select-none">
            <canvas ref={tela} className="block h-auto w-full rounded-md" aria-label="Cena com a marca aplicada" />
            {cantos.map((p, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Canto ${i + 1} da área da marca`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  arrastando.current = i;
                }}
                onTouchStart={() => {
                  arrastando.current = i;
                }}
                className="toque-compacto absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-primary"
                style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
              />
            ))}
          </div>
          <div className="flex min-w-0 flex-wrap items-center">
            <label className={juntar(texto.rotulo, "mb-2 mr-4 inline-flex items-center")}>
              <span className="mr-2">Luz da cena</span>
              <input type="range" min={0} max={1} step={0.05} value={luz} onChange={(e) => setLuz(Number(e.target.value))} aria-label="Luz da cena sobre a marca" />
            </label>
            <button type="button" className={juntar(botao.secundario, "mb-2 mr-2")} onClick={() => setCena({ ...cena })}>
              <Wand2 className="mr-1.5 h-4 w-4" aria-hidden /> Achar a área de novo
            </button>
            <button type="button" className={juntar(botao.primario, "mb-2")} disabled={salvando} onClick={() => void usar()}>
              {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Check className="mr-1.5 h-4 w-4" aria-hidden />}
              Usar esta cena
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
