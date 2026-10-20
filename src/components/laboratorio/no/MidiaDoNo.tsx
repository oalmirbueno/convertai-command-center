import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Images, Loader2, Play, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { JanelaCentral, botao, juntar, texto } from "@/components/sistema";
import { novoId, type NoDoLab } from "@/lib/laboratorio/nos";
import { caminhoDeEntrada, type MidiaDoCliente } from "@/lib/laboratorio/api";
import { enderecosAssinados } from "@/lib/laboratorio/arquivos";
import { useAcoesDoQuadro } from "./contexto";
import { useFontesDoCliente } from "./GerarComIA";

/**
 * O nó Mídia mostra a mídia de verdade: a foto ocupa o nó inteiro (cover,
 * proporção real, cantos do cartão), várias viram carrossel (grade quando
 * expandido) e vídeo enviado (mp4, mov, webm) toca no nó, com capa. Dá para
 * enviar direto (global/laboratorio/<projeto>/entradas, como os documentos)
 * ou escolher da biblioteca do cliente (fontes_do_cliente.midias).
 *
 * Guarda em dados.midias [{ id, tipo, url, path, nome }] e espelha as fotos
 * com caminho em dados.imagens, que é o que a função lê hoje.
 */

export interface MidiaDoNoItem {
  id: string;
  tipo: "imagem" | "video";
  url: string;
  path: string;
  nome: string;
  /** Capa do vídeo (da biblioteca). */
  capa?: string;
}

const VIDEO = /\.(mp4|mov|webm|m4v)$/i;
/** Até 100 MB por arquivo (vídeo maior vai pelo Workspace). */
const MAX_BYTES = 100 * 1024 * 1024;

/** dados.midias, ou as imagens antigas (dados.imagens) quando ainda não há midias. */
export function midiasDe(dados: Record<string, unknown>): MidiaDoNoItem[] {
  const lista = Array.isArray(dados.midias) ? dados.midias : null;
  if (lista)
    return lista
      .filter((x) => !!x && typeof x === "object")
      .map((x: any) => ({ id: String(x.id || x.path || x.url || ""), tipo: x.tipo === "video" ? "video" : "imagem", url: typeof x.url === "string" ? x.url : "", path: typeof x.path === "string" ? x.path : "", nome: String(x.nome || ""), ...(typeof x.capa === "string" && x.capa ? { capa: x.capa } : {}) }));
  return (Array.isArray(dados.imagens) ? dados.imagens : [])
    .filter((x) => !!x && typeof x === "object")
    .map((x: any) => ({ id: String(x.path || x.url || ""), tipo: "imagem" as const, url: typeof x.url === "string" ? x.url : "", path: typeof x.path === "string" ? x.path : "", nome: String(x.nome || "") }));
}

/** O que vai para os dados: midias e o espelho das fotos com caminho em imagens. */
export function dadosDasMidias(lista: MidiaDoNoItem[]): Record<string, unknown> {
  return {
    midias: lista.map((m) => ({ id: m.id, tipo: m.tipo, url: m.url, path: m.path, nome: m.nome, ...(m.capa ? { capa: m.capa } : {}) })),
    imagens: lista.filter((m) => m.tipo === "imagem" && (m.path || m.url)).map((m) => ({ path: m.path, url: m.url, nome: m.nome, bucket: "workspace" })),
  };
}

/** Endereço de cada mídia: a url que veio; sem url, assina o caminho no workspace. */
function useEnderecos(lista: MidiaDoNoItem[]): string[] {
  const chave = lista.map((m) => m.url || m.path).join("|");
  const [assinados, setAssinados] = useState<Record<string, string>>({});
  useEffect(() => {
    const faltam = lista.filter((m) => !m.url && m.path).map((m) => m.path);
    if (!faltam.length) return;
    let vivo = true;
    enderecosAssinados(faltam)
      .then((r) => {
        if (vivo) setAssinados(r);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return lista.map((m) => m.url || assinados[m.path] || "");
}

function Peca({ m, url, cheia }: { m: MidiaDoNoItem; url: string; cheia: boolean }) {
  if (m.tipo === "video")
    return url ? (
      <video
        src={m.capa ? url : `${url}#t=0.1`}
        poster={m.capa || undefined}
        controls
        playsInline
        preload="metadata"
        className={juntar("nodrag block w-full bg-black object-cover", cheia ? "max-h-[420px]" : "h-full")}
        data-video-do-no=""
      >
        <track kind="captions" />
      </video>
    ) : (
      <span className="flex h-40 items-center justify-center bg-muted text-muted-foreground">
        <Play className="h-6 w-6" aria-hidden="true" />
      </span>
    );
  return url ? (
    <img src={url} alt={m.nome || "Mídia"} className={juntar("block w-full object-cover", cheia ? "h-auto max-h-[420px]" : "h-full")} loading="lazy" data-foto-do-no="" />
  ) : (
    <span className="block h-40 bg-muted" />
  );
}

/** Biblioteca do cliente: abas Imagens e Vídeos, escolha várias e adicione. */
function BibliotecaDoCliente({ aberta, clientId, onFechar, onEscolher }: { aberta: boolean; clientId: string | null; onFechar: () => void; onEscolher: (m: MidiaDoCliente[]) => void }) {
  const fontes = useFontesDoCliente(clientId, aberta);
  const [aba, setAba] = useState<"imagem" | "video">("imagem");
  const [marcados, setMarcados] = useState<Record<string, MidiaDoCliente>>({});
  const todas = fontes.data ? fontes.data.midias : [];
  const lista = todas.filter((m) => m.tipo === aba);
  const total = Object.keys(marcados).length;
  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={() => {
        setMarcados({});
        onFechar();
      }}
      titulo="Biblioteca do cliente"
      icone={<Images className="h-4 w-4" />}
      largura="lg"
      abaixoDoTitulo={
        <div role="tablist" aria-label="Tipo de mídia" className="flex min-w-0 items-center">
          {(["imagem", "video"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={aba === t} className={juntar(botao.barra, "mr-1", aba === t && "bg-muted text-foreground")} onClick={() => setAba(t)}>
              {t === "imagem" ? "Imagens" : "Vídeos"} ({todas.filter((m) => m.tipo === t).length})
            </button>
          ))}
        </div>
      }
      rodape={
        <>
          <button type="button" className={botao.discreto} onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className={botao.primario}
            disabled={!total}
            onClick={() => {
              onEscolher(Object.keys(marcados).map((k) => marcados[k]));
              setMarcados({});
            }}
            data-adicionar-midias=""
          >
            {total ? `Adicionar ${total}` : "Adicionar"}
          </button>
        </>
      }
      data-biblioteca-do-cliente=""
    >
      {fontes.isLoading ? (
        <p className={texto.auxiliar}>Lendo a biblioteca do cliente…</p>
      ) : fontes.isError ? (
        <p role="alert" className={juntar(texto.auxiliar, "text-destructive")}>
          Não deu para ler a biblioteca do cliente agora.
        </p>
      ) : !lista.length ? (
        <p className={texto.auxiliar}>{aba === "imagem" ? "Nenhuma imagem na biblioteca deste cliente." : "Nenhum vídeo na biblioteca deste cliente."}</p>
      ) : (
        <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4" role="tabpanel">
          {lista.map((m) => {
            const marcado = !!marcados[m.id];
            return (
              <button
                key={m.id}
                type="button"
                className={juntar("relative block w-full overflow-hidden rounded-md bg-muted", marcado && "ring-2 ring-primary")}
                style={{ paddingTop: "100%" }}
                onClick={() =>
                  setMarcados((x) => {
                    const n = { ...x };
                    if (n[m.id]) delete n[m.id];
                    else n[m.id] = m;
                    return n;
                  })
                }
                aria-pressed={marcado}
                aria-label={m.nome || (m.tipo === "video" ? "Vídeo" : "Imagem")}
                title={m.nome}
                data-midia-da-biblioteca={m.id}
              >
                <img src={m.miniatura_url || m.url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                {m.tipo === "video" ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white">
                      <Play className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </JanelaCentral>
  );
}

export default function MidiaDoNo({ no, expandido }: { no: NoDoLab; expandido: boolean }) {
  const a = useAcoesDoQuadro();
  const lista = midiasDe(no.dados);
  const urls = useEnderecos(lista);
  const [atual, setAtual] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [biblioteca, setBiblioteca] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const clientId = (typeof no.dados.client_id === "string" && no.dados.client_id) || a.clienteId || null;
  const i = Math.min(atual, Math.max(0, lista.length - 1));
  const mudar = (nova: MidiaDoNoItem[]) => a.mudarDados(no.id, dadosDasMidias(nova));

  const enviar = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setEnviando(true);
    const novos: MidiaDoNoItem[] = [];
    try {
      for (let k = 0; k < files.length; k += 1) {
        const f = files[k];
        const video = (f.type || "").indexOf("video/") === 0 || VIDEO.test(f.name);
        if (!video && (f.type || "").indexOf("image/") !== 0) {
          toast.warning(`${f.name} não é foto nem vídeo`);
          continue;
        }
        if (f.size > MAX_BYTES) {
          toast.warning(`${f.name} passa de 100 MB`, { description: "Envie pelo Workspace." });
          continue;
        }
        const id = novoId("m");
        const caminho = caminhoDeEntrada(a.projetoId, id, f.name);
        const { error } = await supabase.storage.from("workspace").upload(caminho, f, { contentType: f.type || undefined, upsert: false });
        if (error) throw error;
        novos.push({ id, tipo: video ? "video" : "imagem", url: "", path: caminho, nome: f.name });
      }
      if (novos.length) {
        mudar(lista.concat(novos));
        setAtual(lista.length);
      }
    } catch (e) {
      toast.error("Não deu para enviar a mídia", { description: (e as Error)?.message || "Tente de novo." });
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const tirar = (k: number) => {
    mudar(lista.filter((_, j) => j !== k));
    setAtual(Math.max(0, k - 1));
  };

  return (
    <div className="min-w-0" data-midia-do-no={no.id} data-quantas-midias={lista.length}>
      <div className="flex min-w-0 items-center px-3 pb-2">
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{lista.length ? `${lista.length} ${lista.length === 1 ? "mídia" : "mídias"}` : "Foto ou vídeo"}</span>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => setBiblioteca(true)} aria-label="Escolher da biblioteca do cliente" title="Escolher da biblioteca do cliente">
          <Images className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => entrada.current && entrada.current.click()} aria-label="Enviar foto ou vídeo" title="Enviar foto ou vídeo (mp4, mov, webm)" disabled={enviando}>
          {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        <input ref={entrada} type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm,.mov,.mp4,.webm" className="hidden" onChange={(e) => void enviar(e.target.files)} data-entrada-de-midia="" />
      </div>

      {!lista.length ? (
        <button
          type="button"
          className="mx-3 mb-3 flex h-36 w-[calc(100%-24px)] flex-col items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          onClick={() => entrada.current && entrada.current.click()}
        >
          <ImagePlus className="mb-1 h-5 w-5" aria-hidden="true" />
          <span className="text-[12px]">Enviar foto ou vídeo</span>
        </button>
      ) : expandido && lista.length > 1 ? (
        <div className="grid min-w-0 grid-cols-2 gap-1 overflow-hidden rounded-b-xl" data-grade-de-midias="">
          {lista.map((m, k) => (
            <div key={`${m.id}-${k}`} className="group/m relative h-36 overflow-hidden bg-muted">
              <Peca m={m} url={urls[k]} cheia={false} />
              <button type="button" className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover/m:opacity-100" onClick={() => tirar(k)} aria-label={`Tirar ${m.nome || "a mídia"}`} title="Tirar">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        // A mídia ocupa o nó inteiro: de ponta a ponta, proporção real, cantos do cartão embaixo.
        <div className="group/m relative min-w-0 overflow-hidden rounded-b-xl bg-black" data-midia-cheia="">
          <Peca m={lista[i]} url={urls[i]} cheia />
          <button type="button" className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover/m:opacity-100" onClick={() => tirar(i)} aria-label={`Tirar ${lista[i].nome || "a mídia"}`} title="Tirar">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {lista.length > 1 ? (
            <>
              <button type="button" className="absolute left-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white" onClick={() => setAtual((i - 1 + lista.length) % lista.length)} aria-label="Mídia anterior" title="Mídia anterior">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white" onClick={() => setAtual((i + 1) % lista.length)} aria-label="Próxima mídia" title="Próxima mídia">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2" aria-label={`Mídia ${i + 1} de ${lista.length}`} role="img" data-pontos-do-carrossel="">
                {lista.map((_, k) => (
                  <span key={k} className={juntar("mx-0.5 inline-block h-1.5 w-1.5 rounded-full", k === i ? "bg-white" : "bg-white/50")} />
                ))}
              </span>
            </>
          ) : null}
        </div>
      )}

      {biblioteca ? (
        <BibliotecaDoCliente
          aberta
          clientId={clientId}
          onFechar={() => setBiblioteca(false)}
          onEscolher={(ms) => {
            setBiblioteca(false);
            const novos: MidiaDoNoItem[] = ms.filter((m) => !lista.some((x) => x.id === m.id)).map((m) => ({ id: m.id, tipo: m.tipo, url: m.url, path: "", nome: m.nome, ...(m.miniatura_url ? { capa: m.miniatura_url } : {}) }));
            if (novos.length) {
              mudar(lista.concat(novos));
              setAtual(lista.length);
            }
          }}
        />
      ) : null}
    </div>
  );
}
