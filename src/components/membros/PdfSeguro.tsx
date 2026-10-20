import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";

const LIMITE = 64 * 1024 * 1024;
async function lerPdf(url: string, signal: AbortSignal) {
  const r = await fetch(url, { signal, cache: "no-store" });
  if (!r.ok || !r.body) throw Error("arquivo");
  if (Number(r.headers.get("content-length")) > LIMITE) throw Error("tamanho");
  const leitor = r.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    while (true) {
      const { value, done } = await leitor.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > LIMITE) {
        await leitor.cancel();
        throw Error("tamanho");
      }
      partes.push(value);
    }
  } finally {
    leitor.releaseLock();
  }
  const bytes = new Uint8Array(tamanho);
  let inicio = 0;
  for (const parte of partes) {
    bytes.set(parte, inicio);
    inicio += parte.length;
  }
  return bytes;
}
export default function PdfSeguro({
  url,
  titulo,
}: {
  url: string;
  titulo: string;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pagina, setPagina] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [largura, setLargura] = useState(640);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [renderizando, setRenderizando] = useState(false);
  const folha = useRef<HTMLCanvasElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(200, el.clientWidth - 16));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let ativo = true;
    const cancelador = new AbortController();
    let documento: PDFDocumentProxy | undefined;
    let tarefa:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setDoc(null);
    setErro("");
    setPagina(1);
    void (async () => {
      try {
        const [pdfjs, data] = await Promise.all([
          import("pdfjs-dist"),
          lerPdf(url, cancelador.signal),
        ]);
        if (!ativo) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
        tarefa = pdfjs.getDocument({
          data,
          useSystemFonts: true,
        });
        documento = await tarefa.promise;
        if (ativo) setDoc(documento);
        else await tarefa.destroy();
      } catch (e) {
        if (ativo)
          setErro(
            e instanceof Error && e.message === "tamanho"
              ? "Este PDF excede o limite de leitura de 64 MB. Baixe o arquivo se o download estiver liberado."
              : "Não foi possível abrir o PDF. Renove o acesso ao arquivo e tente novamente.",
          );
      }
    })();
    return () => {
      ativo = false;
      cancelador.abort();
      void tarefa?.destroy().catch(() => {});
    };
  }, [url]);
  useEffect(() => {
    if (!doc || !folha.current) return;
    let ativo = true;
    let tarefa: RenderTask | undefined;
    setRenderizando(true);
    setErro("");
    void (async () => {
      try {
        const p = await doc.getPage(pagina);
        if (!ativo || !folha.current) return;
        const base = p.getViewport({ scale: 1 });
        const escala = Math.min(1.5, largura / base.width) * zoom;
        const viewport = p.getViewport({ scale: escala });
        const tela = folha.current;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        tela.width = Math.ceil(viewport.width * dpr);
        tela.height = Math.ceil(viewport.height * dpr);
        tela.style.width = `${viewport.width}px`;
        tela.style.height = `${viewport.height}px`;
        tarefa = p.render({
          canvas: tela,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
          background: "#fff",
        });
        await tarefa.promise;
        const t = await p.getTextContent();
        if (ativo)
          setTexto(t.items.map((i) => ("str" in i ? i.str : "")).join(" "));
      } catch (e) {
        if (
          ativo &&
          !(e instanceof Error && e.name === "RenderingCancelledException")
        )
          setErro(
            "Não foi possível desenhar esta página. Tente voltar à página anterior.",
          );
      } finally {
        if (ativo) setRenderizando(false);
      }
    })();
    return () => {
      ativo = false;
      tarefa?.cancel();
    };
  }, [doc, pagina, zoom, largura]);
  return (
    <section className="membros-pdf" aria-label={`Leitor de PDF: ${titulo}`}>
      <div className="membros-pdf-barra">
        <div className="flex items-center gap-1">
          <button
            className="membros-acao"
            aria-label="Página anterior"
            disabled={!doc || pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <label className="flex items-center text-[12px] gap-2">
            Página{" "}
            <input
              aria-label="Número da página"
              type="number"
              min={1}
              max={doc?.numPages || 1}
              value={pagina}
              onChange={(e) =>
                setPagina(
                  Math.max(
                    1,
                    Math.min(doc?.numPages || 1, Number(e.target.value) || 1),
                  ),
                )
              }
              className="w-12 rounded bg-muted px-2 py-1"
            />
            de {doc?.numPages || "…"}
          </label>
          <button
            className="membros-acao"
            aria-label="Próxima página"
            disabled={!doc || pagina >= doc.numPages}
            onClick={() => setPagina((p) => p + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="membros-acao"
            aria-label="Reduzir PDF"
            disabled={zoom <= 0.6}
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
          >
            <Minus size={15} />
          </button>
          <span className="text-[11px] tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="membros-acao"
            aria-label="Ampliar PDF"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
          >
            <Plus size={15} />
          </button>
          <button
            className="membros-acao"
            aria-label="Ajustar PDF à largura"
            onClick={() => setZoom(1)}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      {erro && (
        <p role="alert" className="text-[13px] p-4">
          {erro}
        </p>
      )}
      {!doc && !erro && (
        <p role="status" className="p-4 text-[13px]">
          Abrindo PDF…
        </p>
      )}
      <div ref={caixa} className="membros-pdf-pagina" aria-busy={renderizando}>
        <canvas
          ref={folha}
          aria-label={`Página ${pagina} de ${doc?.numPages || 1} de ${titulo}`}
        />
      </div>
      {texto && (
        <details className="text-[12px] p-3">
          <summary className="cursor-pointer">Ler o texto desta página</summary>
          <p className="pt-3 leading-6 whitespace-pre-wrap">{texto}</p>
        </details>
      )}
    </section>
  );
}
