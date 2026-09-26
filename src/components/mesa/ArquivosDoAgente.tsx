import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, FileText, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { extensaoDoAnexo, MAX_ANEXOS } from "./mesaV4Api";
import type { ControleDeAnexos } from "./AnexosDoPedido";
import {
  arquivosParaOEnvio,
  lerArquivosDoAgente,
  MAX_ARQUIVOS_NO_ZIP,
  MAX_BYTES_DO_ZIP,
  tamanhoLegivel,
  type ArquivoLidoNaTela,
  type ArquivoNaoLidoNaTela,
} from "./leituraDeArquivos";

/**
 * Arquivos do agente do Mês: imagens seguem como anexo de imagem (sobem em
 * pedidos/, como antes); o resto (texto, PDF, Word, planilha, apresentação e
 * ZIP) é lido aqui no navegador e vai como texto no pedido. A lista mostra o
 * que foi lido (com tamanho) e o que não deu para ler, com o motivo.
 */
export function useArquivosDoAgente(anexos: ControleDeAnexos) {
  const [lidos, setLidos] = useState<ArquivoLidoNaTela[]>([]);
  const [naoLidos, setNaoLidos] = useState<ArquivoNaoLidoNaTela[]>([]);
  const [lendo, setLendo] = useState(0);
  const vivo = useRef(true);
  const atuais = useRef<ArquivoLidoNaTela[]>([]);
  atuais.current = lidos;
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const adicionar = (entrada: FileList | File[] | null | undefined) => {
    const todos = entrada ? (Array.prototype.slice.call(entrada) as File[]) : [];
    if (!todos.length) return;
    const imagens = todos.filter((f) => !!extensaoDoAnexo(f));
    const outros = todos.filter((f) => !extensaoDoAnexo(f));
    if (imagens.length) anexos.adicionar(imagens);
    if (!outros.length) return;
    setLendo((n) => n + outros.length);
    const jaUsados = atuais.current.reduce((n, a) => n + a.caracteres, 0);
    lerArquivosDoAgente(outros, jaUsados)
      .then((r) => {
        if (!vivo.current) return;
        if (r.lidos.length) setLidos((l) => l.concat(r.lidos));
        if (r.naoLidos.length) setNaoLidos((l) => l.concat(r.naoLidos));
        if (r.imagens.length) {
          const vagas = MAX_ANEXOS - anexos.lista.length - imagens.length;
          if (vagas > 0) anexos.adicionar(r.imagens.slice(0, vagas));
          const sobram = r.imagens.slice(Math.max(0, vagas));
          if (sobram.length) {
            setNaoLidos((l) => l.concat(sobram.map((f, i) => ({ id: `img-${Date.now()}-${i}`, nome: f.name, motivo: `Até ${MAX_ANEXOS} imagens por pedido.`, tamanho: f.size, origem: null }))));
          }
        }
      })
      .catch(() => {
        if (vivo.current) toast.error("Não deu para ler os arquivos", { description: "Tente de novo ou mande em PDF." });
      })
      .then(() => {
        if (vivo.current) setLendo((n) => Math.max(0, n - outros.length));
      });
  };

  const remover = (id: string) => {
    setLidos((l) => l.filter((a) => a.id !== id));
    setNaoLidos((l) => l.filter((a) => a.id !== id));
  };

  /** Tira do campo só o que foi no pedido (o anexado enquanto o agente trabalhava fica). */
  const tirarEnviados = (ids: string[]) => {
    setLidos((l) => l.filter((a) => ids.indexOf(a.id) < 0));
    setNaoLidos((l) => l.filter((a) => ids.indexOf(a.id) < 0));
  };

  return {
    lidos,
    naoLidos,
    lendo: lendo > 0,
    adicionar,
    remover,
    tirarEnviados,
    /** O corpo do pedido e os ids que foram nele. */
    paraOEnvio: () => ({ corpo: arquivosParaOEnvio(lidos, naoLidos), ids: lidos.map((a) => a.id).concat(naoLidos.map((a) => a.id)) }),
    caracteres: lidos.reduce((n, a) => n + a.caracteres, 0),
    /** Controle com o mesmo formato do de imagens, para a zona de arrastar e colar. */
    comoAnexos: (): ControleDeAnexos => ({ ...anexos, adicionar }),
  };
}

export type ControleDeArquivos = ReturnType<typeof useArquivosDoAgente>;

/** Clipe que aceita imagens, documentos e ZIP. */
export function BotaoDeAnexarArquivos({ arquivos, anexos, className = "" }: { arquivos: ControleDeArquivos; anexos: ControleDeAnexos; className?: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const total = anexos.lista.length + arquivos.lidos.length;
  return (
    <>
      <button
        type="button"
        onClick={() => entrada.current && entrada.current.click()}
        aria-label="Anexar arquivos"
        title={`Imagens, PDF, Word, planilha, apresentação, texto ou ZIP (até ${tamanhoLegivel(MAX_BYTES_DO_ZIP)} e ${MAX_ARQUIVOS_NO_ZIP} arquivos)`}
        className={`inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 text-muted-foreground transition-colors hover:text-foreground ${className}`}
      >
        {arquivos.lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        {total > 0 && <span className="ml-1 text-[11px] tabular-nums">{total}</span>}
      </button>
      <input
        ref={entrada}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,.txt,.md,.csv,.tsv,.json,.xml,.html,.htm,.yaml,.yml,.srt,.vtt,.pdf,.docx,.xlsx,.pptx,.zip,.doc,.xls,.ppt"
        className="hidden"
        data-testid="entrada-de-anexos"
        onChange={(e) => {
          arquivos.adicionar(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** Resumo em uma linha e, ao abrir, cada arquivo lido (tamanho e caracteres) e cada não lido (motivo). */
export function ListaDeArquivos({ arquivos }: { arquivos: ControleDeArquivos }) {
  const [aberta, setAberta] = useState(false);
  const { lidos, naoLidos, lendo } = arquivos;
  if (!lidos.length && !naoLidos.length && !lendo) return null;
  const partes: string[] = [];
  if (lidos.length) partes.push(`${lidos.length} ${lidos.length === 1 ? "arquivo lido" : "arquivos lidos"} · ${arquivos.caracteres.toLocaleString("pt-BR")} caracteres`);
  if (naoLidos.length) partes.push(`${naoLidos.length} não ${naoLidos.length === 1 ? "lido" : "lidos"}`);
  if (lendo) partes.push("lendo…");
  return (
    <div className="mb-1.5 min-w-0" data-arquivos-lidos={lidos.length} data-arquivos-nao-lidos={naoLidos.length}>
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="flex w-full min-w-0 items-center rounded-md bg-muted px-2 py-1 text-left text-[11.5px]"
      >
        <FileText className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">{partes.join(" · ")}</span>
        <ChevronDown className={`ml-1 h-3 w-3 shrink-0 text-muted-foreground transition-transform ${aberta ? "rotate-180" : ""}`} />
      </button>
      {aberta && (
        <ul className="mt-1 divide-y divide-border" aria-label="Arquivos do pedido">
          {lidos.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center py-1 text-[11.5px]">
              <FileText className="mr-1.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={a.origem ? `${a.origem} / ${a.nome}` : a.nome}>
                {a.nome}
                <span className="text-muted-foreground"> · {tamanhoLegivel(a.tamanho || a.caracteres)} · {a.caracteres.toLocaleString("pt-BR")} caracteres{a.cortado ? " (cortado no limite)" : ""}</span>
              </span>
              <button type="button" onClick={() => arquivos.remover(a.id)} aria-label={`Tirar ${a.nome}`} className="ml-1 shrink-0 text-muted-foreground hover:text-foreground" data-compacto="">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {naoLidos.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center py-1 text-[11.5px]">
              <AlertCircle className="mr-1.5 h-3 w-3 shrink-0 text-destructive" />
              <span className="min-w-0 flex-1 truncate" title={a.motivo}>
                {a.nome}
                <span className="text-muted-foreground"> · {a.motivo}</span>
              </span>
              <button type="button" onClick={() => arquivos.remover(a.id)} aria-label={`Tirar ${a.nome}`} className="ml-1 shrink-0 text-muted-foreground hover:text-foreground" data-compacto="">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
