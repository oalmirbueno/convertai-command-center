import { lazy, Suspense, useRef, useState } from "react";
import { Film, Images, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import type { FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import { subirVideos } from "@/components/mesa-videos/videosApi";
import { subirQuadro } from "@/lib/mesa-videos/quadros";
import { SelecaoDaBancada } from "./BancadaDaPauta";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { imagemParaAMesa } from "./imagemParaAMesa";
import { idCurto, type PapelDaReferencia, type ReferenciaDoVideo } from "./composicaoDoVideo";
import { PAPEIS_DA_REFERENCIA, ROTULO_DO_PAPEL } from "../../../supabase/functions/mesa-videos/modulos/composicao-no-pedido";

const CURTO: Record<PapelDaReferencia, string> = { antes: "Antes", depois: "Depois", movimento: "Movimento", produto: "Produto" };

const SeletorDeFotos = lazy(() => import("@/components/mesa-foto/SeletorDeFotos"));

/**
 * Referências do vídeo da pauta (27/10/2026): subir ou escolher do acervo imagens e vídeos marcando o papel.
 * Antes e depois viram a cena de transformação; produto entra na cena sem imagem; estilo de movimento vai no
 * prompt. O papel escolhido vale para o próximo que entrar e muda em cada um. Tudo vai para a pasta do cliente
 * no bucket mesa (de onde o gerador assina o link).
 */
export default function ReferenciasDoVideo({ clientId, referencias, fotos, onMudar }: { clientId: string; referencias: ReferenciaDoVideo[]; fotos: FotoDoAcervo[]; onMudar: (r: ReferenciaDoVideo[]) => void }) {
  const [papel, setPapel] = useState<PapelDaReferencia>(referencias.some((r) => r.papel === "antes") && !referencias.some((r) => r.papel === "depois") ? "depois" : "antes");
  const [escolhendo, setEscolhendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  // Antes e depois são um de cada: o novo troca o anterior do mesmo papel.
  const acrescentar = (novas: ReferenciaDoVideo[]) => {
    let lista = referencias.slice();
    for (const n of novas) {
      if (n.papel === "antes" || n.papel === "depois") lista = lista.filter((r) => r.papel !== n.papel);
      lista.push(n);
    }
    onMudar(lista.slice(-8));
    // Depois do antes, o natural é o depois.
    if (novas.some((n) => n.papel === "antes") && !lista.some((r) => r.papel === "depois")) setPapel("depois");
  };

  const usarDoAcervo = async (ids: string[]) => {
    setOcupado(true);
    try {
      const novas: ReferenciaDoVideo[] = [];
      for (const id of ids.slice(0, 4)) {
        const f = fotos.find((x) => x.id === id && x.client_id === clientId);
        if (!f) continue;
        const caminho = await imagemParaAMesa(clientId, { bucket: f.storage_bucket, caminho: f.storage_path, nome: f.nome });
        novas.push({ id: idCurto("r"), papel, tipo: "imagem", nome: f.nome, bucket: "mesa", caminho });
      }
      acrescentar(novas);
      setEscolhendo(false);
    } catch (e) {
      toast.error("A referência não entrou", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };

  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos || !arquivos.length) return;
    setOcupado(true);
    try {
      const novas: ReferenciaDoVideo[] = [];
      for (const a of Array.from(arquivos).slice(0, 4)) {
        if (a.type.indexOf("image/") === 0) {
          if (a.size > 20 * 1024 * 1024) throw new Error(`${a.name}: use uma imagem de até 20 MB.`);
          const caminho = await subirQuadro(clientId, a, a.name);
          novas.push({ id: idCurto("r"), papel, tipo: "imagem", nome: a.name, bucket: "mesa", caminho });
        } else if (a.type.indexOf("video/") === 0) {
          const r = await subirVideos(clientId, [a], () => undefined);
          const v = r.registrados[0];
          if (!v) throw new Error((r.recusados[0] && r.recusados[0].motivo) || r.aviso || `${a.name} não subiu.`);
          // Vídeo de referência só ensina o movimento (o motor não recebe vídeo como quadro).
          novas.push({ id: idCurto("r"), papel: papel === "antes" || papel === "depois" || papel === "produto" ? "movimento" : papel, tipo: "video", nome: a.name, bucket: v.storage_bucket || "mesa", caminho: v.storage_path });
        } else throw new Error(`${a.name}: use imagem ou vídeo.`);
      }
      acrescentar(novas);
    } catch (e) {
      toast.error("A referência não subiu", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  return (
    <div className="min-w-0" data-referencias-do-video={referencias.length}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <SeletorCompacto rotulo="Papel da próxima referência" opcoes={PAPEIS_DA_REFERENCIA.map((p) => ({ valor: p, rotulo: CURTO[p] }))} valor={papel} onEscolher={(v) => setPapel(v as PapelDaReferencia)} />
        <span className="ml-auto flex shrink-0 items-center">
          {ocupado && <Loader2 className="mr-1 h-4 w-4 animate-spin text-muted-foreground" aria-label="Carregando a referência" />}
          <button type="button" className={botao.icone} onClick={() => setEscolhendo(true)} disabled={ocupado} aria-label="Escolher do acervo" title={`Escolher do acervo como ${ROTULO_DO_PAPEL[papel].toLowerCase()}`}>
            <Images className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={botao.icone} onClick={() => entrada.current && entrada.current.click()} disabled={ocupado} aria-label="Enviar imagem ou vídeo" title={`Enviar imagem ou vídeo como ${ROTULO_DO_PAPEL[papel].toLowerCase()}`}>
            <Upload className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
        <input ref={entrada} type="file" className="hidden" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => void enviar(e.target.files)} aria-label="Arquivo de referência" />
      </div>
      {referencias.length > 0 && (
        <ul className="mt-2 min-w-0 space-y-1" aria-label="Referências do vídeo">
          {referencias.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center" data-referencia={r.papel}>
              <span className="relative mr-2 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                {r.tipo === "imagem" ? <MiniaturaDoStorage bucket={r.bucket} caminho={r.caminho} alt="" largura={96} className="absolute inset-0 h-full w-full" /> : <Film className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              </span>
              <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")} title={r.nome}>{r.nome}</span>
              <select
                aria-label={`Papel de ${r.nome}`}
                className={juntar(campo, "ml-1 h-8 w-auto max-w-[150px] px-2 text-[12px]")}
                value={r.papel}
                onChange={(e) => onMudar(referencias.map((x) => (x.id === r.id ? { ...x, papel: e.target.value as PapelDaReferencia } : x)))}
              >
                {PAPEIS_DA_REFERENCIA.filter((p) => r.tipo === "imagem" || p === "movimento").map((p) => (
                  <option key={p} value={p}>{ROTULO_DO_PAPEL[p]}</option>
                ))}
              </select>
              <button type="button" className={botao.icone} onClick={() => onMudar(referencias.filter((x) => x.id !== r.id))} aria-label={`Tirar ${r.nome}`} title="Tirar a referência">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {escolhendo && (
        <SelecaoDaBancada>
          <Suspense fallback={<p role="status">Lendo as fotos…</p>}>
            <SeletorDeFotos fotos={fotos.filter((f) => !f.referencia_web)} titulo={`Referência: ${ROTULO_DO_PAPEL[papel]}`} multiplas={papel === "produto" || papel === "movimento"} onFechar={() => setEscolhendo(false)} onUsar={(ids) => void usarDoAcervo(ids)} />
          </Suspense>
        </SelecaoDaBancada>
      )}
    </div>
  );
}
