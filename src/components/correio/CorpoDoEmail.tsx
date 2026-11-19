import { useEffect, useRef, useState } from "react";

/**
 * O e-mail exatamente como foi enviado: o HTML original (já limpo no servidor) num iframe sandbox.
 * Duas travas: o servidor tira script e evento; o iframe não deixa nada rodar (sem allow-scripts) e
 * abre os links numa aba nova. A altura acompanha o conteúdo, para a leitura rolar junto com a tela.
 */
export default function CorpoDoEmail({ html, titulo }: { html: string; titulo: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(240);

  const documento = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:; media-src *;">
<base target="_blank">
<style>html,body{margin:0;padding:0;background:#fff;color:#14181f;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}
body{padding:4px 2px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#0a7d3e}</style>
</head><body>${html}</body></html>`;

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let observador: ResizeObserver | null = null;
    const medir = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return;
        const h = Math.max(doc.body.scrollHeight, doc.documentElement ? doc.documentElement.scrollHeight : 0);
        if (h > 0) setAltura(Math.min(h + 8, 20000));
      } catch {
        /* sem acesso: fica a altura padrão, com rolagem dentro */
      }
    };
    const carregou = () => {
      medir();
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body && typeof ResizeObserver !== "undefined") {
          observador = new ResizeObserver(medir);
          observador.observe(doc.body);
        }
        // Imagens que chegam depois mudam a altura.
        if (doc) for (const img of Array.from(doc.images)) img.addEventListener("load", medir);
      } catch {
        /* idem */
      }
    };
    iframe.addEventListener("load", carregou);
    return () => {
      iframe.removeEventListener("load", carregou);
      if (observador) observador.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title={`Conteúdo do e-mail: ${titulo}`}
      srcDoc={documento}
      // Sem allow-scripts: nada do remetente roda. allow-same-origin só para medir a altura.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="block w-full rounded-2xl border-0 bg-white"
      style={{ height: altura }}
      data-corpo-html=""
    />
  );
}
