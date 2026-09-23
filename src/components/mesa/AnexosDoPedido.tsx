import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";
import { ImagemDaMesa } from "./MesaContexto";
import { extensaoDoAnexo, MAX_ANEXOS, subirAnexo } from "./mesaV4Api";

/**
 * Imagens e prints anexados a um pedido (agente do mês e campanha). Cada
 * arquivo sobe na hora para mesa/<cliente>/pedidos/; o pedido leva só os
 * caminhos. Até 6, JPG, PNG ou WEBP. Arrastar e soltar, colar (Ctrl+V de um
 * print) ou o botão de clipe.
 */

export interface Anexo {
  id: string;
  nome: string;
  previa: string | null;
  caminho: string | null;
  estado: "subindo" | "pronto" | "erro";
}

const criarPrevia = (f: File): string | null => {
  try {
    return typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null;
  } catch {
    return null;
  }
};

const soltarPrevia = (p: string | null) => {
  try {
    if (p && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(p);
  } catch {
    /* nada a soltar */
  }
};

let sequencia = 0;

export function useAnexos(clientId: string) {
  const [lista, setLista] = useState<Anexo[]>([]);
  const vivo = useRef(true);
  const atual = useRef<Anexo[]>([]);
  atual.current = lista;

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      atual.current.forEach((a) => soltarPrevia(a.previa));
    };
  }, []);

  const adicionar = (arquivos: FileList | File[] | null | undefined) => {
    const todos = arquivos ? Array.prototype.slice.call(arquivos) as File[] : [];
    if (!todos.length) return;
    const aceitos = todos.filter((f) => !!extensaoDoAnexo(f));
    if (aceitos.length < todos.length) toast.error("Só imagens JPG, PNG ou WEBP.");
    const vagas = MAX_ANEXOS - atual.current.length;
    if (vagas <= 0) {
      toast.error(`Até ${MAX_ANEXOS} imagens por pedido.`);
      return;
    }
    if (aceitos.length > vagas) toast.error(`Até ${MAX_ANEXOS} imagens por pedido: entraram as primeiras ${vagas}.`);
    const novos: { anexo: Anexo; arquivo: File }[] = aceitos.slice(0, vagas).map((arquivo) => {
      sequencia += 1;
      return { arquivo, anexo: { id: `a${Date.now()}-${sequencia}`, nome: arquivo.name || "imagem", previa: criarPrevia(arquivo), caminho: null, estado: "subindo" } };
    });
    if (!novos.length) return;
    setLista((l) => l.concat(novos.map((n) => n.anexo)));
    novos.forEach(({ anexo, arquivo }) => {
      subirAnexo(clientId, arquivo)
        .then((caminho) => {
          if (!vivo.current) return;
          setLista((l) => l.map((a) => (a.id === anexo.id ? { ...a, caminho, estado: "pronto" } : a)));
        })
        .catch((e) => {
          if (!vivo.current) return;
          toast.error("A imagem não subiu", { description: textoDoErro(e) });
          setLista((l) => l.map((a) => (a.id === anexo.id ? { ...a, estado: "erro" } : a)));
        });
    });
  };

  const remover = (id: string) =>
    setLista((l) => {
      const alvo = l.find((a) => a.id === id);
      if (alvo) soltarPrevia(alvo.previa);
      return l.filter((a) => a.id !== id);
    });

  const limpar = () =>
    setLista((l) => {
      l.forEach((a) => soltarPrevia(a.previa));
      return [];
    });

  /**
   * Tira só os anexos que foram no pedido. O que a pessoa anexou enquanto o
   * agente trabalhava continua no campo para o próximo pedido.
   */
  const tirarEnviados = (enviados: string[]) =>
    setLista((l) =>
      l.filter((a) => {
        const foi = !!a.caminho && enviados.indexOf(a.caminho) >= 0;
        if (foi) soltarPrevia(a.previa);
        return !foi;
      }),
    );

  const caminhos = lista.filter((a) => a.estado === "pronto" && a.caminho).map((a) => a.caminho as string);
  const subindo = lista.some((a) => a.estado === "subindo");
  return { lista, adicionar, remover, limpar, tirarEnviados, caminhos, subindo, cheio: lista.length >= MAX_ANEXOS };
}

export type ControleDeAnexos = ReturnType<typeof useAnexos>;

/** Miniaturas removíveis dos anexos do pedido. */
export function MiniaturasDosAnexos({ anexos, tamanho = "h-14 w-14" }: { anexos: ControleDeAnexos; tamanho?: string }) {
  if (!anexos.lista.length) return null;
  return (
    <ul className="flex flex-wrap" aria-label="Imagens anexadas">
      {anexos.lista.map((a) => (
        <li key={a.id} className={`relative mb-1.5 mr-1.5 shrink-0 overflow-hidden rounded-lg border bg-secondary ${tamanho} ${a.estado === "erro" ? "border-destructive" : "border-border"}`}>
          {a.previa ? (
            <img src={a.previa} alt={a.nome} className="h-full w-full object-cover" />
          ) : a.caminho ? (
            <ImagemDaMesa caminho={a.caminho} alt={a.nome} className="h-full w-full" />
          ) : null}
          {a.estado === "subindo" && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="h-4 w-4 animate-spin text-foreground" />
            </span>
          )}
          <button
            type="button"
            onClick={() => anexos.remover(a.id)}
            aria-label={`Tirar ${a.nome}`}
            title="Tirar"
            className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm"
          >
            <X className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Botão de clipe que abre o seletor de arquivos. */
export function BotaoDeAnexar({ anexos, className = "" }: { anexos: ControleDeAnexos; className?: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => entrada.current && entrada.current.click()}
        disabled={anexos.cheio}
        aria-label="Anexar imagens"
        title={anexos.cheio ? `Até ${MAX_ANEXOS} imagens` : "Anexar imagens ou prints (JPG, PNG, WEBP)"}
        className={`inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-background px-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 ${className}`}
      >
        <ImagePlus className="h-4 w-4" />
        {anexos.lista.length > 0 && <span className="ml-1 text-[11px]">{anexos.lista.length}/{MAX_ANEXOS}</span>}
      </button>
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        data-testid="entrada-de-anexos"
        onChange={(e) => {
          anexos.adicionar(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

/**
 * Colar só vira anexo quando o que foi copiado é imagem de verdade (um print):
 * há arquivo na área de transferência e nenhum texto junto. Texto colado
 * (o ditado do Wispr Flow cola com Ctrl+V, e o Word cola texto com uma imagem
 * de brinde) segue o caminho normal do campo e nunca é interceptado.
 */
export function colagemEhImagem(dados: { files?: FileList | File[] | null; getData?: (tipo: string) => string } | null | undefined): boolean {
  if (!dados || !dados.files || !dados.files.length) return false;
  let texto = "";
  try {
    texto = dados.getData ? dados.getData("text/plain") || "" : "";
  } catch {
    texto = "";
  }
  return !texto.trim();
}

/** Área que aceita arrastar e soltar imagens (e colar prints). */
export function ZonaDeAnexos({ anexos, children, className = "" }: { anexos: ControleDeAnexos; children: ReactNode; className?: string }) {
  const [sobre, setSobre] = useState(false);
  const temArquivo = (e: DragEvent) => {
    const tipos = e.dataTransfer ? e.dataTransfer.types : null;
    if (!tipos) return false;
    for (let i = 0; i < tipos.length; i++) if (tipos[i] === "Files") return true;
    return false;
  };
  return (
    <div
      className={`relative ${className}`}
      onDragOver={(e) => {
        if (!temArquivo(e)) return;
        e.preventDefault();
        if (!sobre) setSobre(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setSobre(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setSobre(false);
        anexos.adicionar(e.dataTransfer.files);
      }}
      onPaste={(e) => {
        if (!colagemEhImagem(e.clipboardData)) return;
        e.preventDefault();
        anexos.adicionar(e.clipboardData.files);
      }}
    >
      {children}
      {sobre && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/90 text-[12.5px] font-medium text-foreground">
          Solte as imagens aqui
        </div>
      )}
    </div>
  );
}
