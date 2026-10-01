import { useMemo, useState } from "react";
import { Film, ImageIcon, Link2 } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { juntar, texto } from "@/components/sistema/estilos";
import { useFotos } from "../../fotoApi";
import { useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import type { MidiaDaCamada } from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";

/**
 * Trocar ou pôr mídia no Quadro pelo acervo (frente CNV, 30/09): as fotos do
 * acervo da marca aberta, os vídeos gerados e subidos (Mesa Vídeos) e o que
 * chega ao Quadro pelas ligações do Canvas. Só a pasta do cliente.
 */

type Aba = "ligadas" | "fotos" | "videos";

const ehVideo = (caminho: string) => /\.(mp4|mov|webm|m4v)$/i.test(caminho);

export default function EscolherMidia({
  aberta,
  clientId,
  ligadas,
  somente,
  onFechar,
  onEscolher,
}: {
  aberta: boolean;
  clientId: string;
  ligadas: MidiaDaCamada[];
  /** Só imagem (logo, foto) ou só vídeo; sem isso, os dois. */
  somente?: "imagem" | "video" | null;
  onFechar: () => void;
  onEscolher: (m: MidiaDaCamada) => void;
}) {
  const fotos = useFotos(aberta ? clientId : "");
  const videos = useArquivosDeVideo(aberta ? clientId : "");
  const [aba, setAba] = useState<Aba>(ligadas.length ? "ligadas" : somente === "video" ? "videos" : "fotos");
  const doCliente = (c: string) => c.indexOf(`${clientId}/`) === 0;
  const listaDeFotos = useMemo(
    () => (fotos.data || []).filter((f) => f.storage_path && doCliente(f.storage_path) && (f.storage_bucket || "mesa") === "mesa").slice(0, 120),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fotos.data, clientId],
  );
  const listaDeVideos = useMemo(
    () => ((videos.data && videos.data.arquivos) || []).filter((a) => a.estado !== "arquivado" && ehVideo(a.storage_path) && doCliente(a.storage_path)).slice(0, 80),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videos.data, clientId],
  );
  const opcoes = [
    { valor: "ligadas", rotulo: "Do Canvas", contador: ligadas.length },
    ...(somente !== "video" ? [{ valor: "fotos", rotulo: "Fotos", contador: listaDeFotos.length }] : []),
    ...(somente !== "imagem" ? [{ valor: "videos", rotulo: "Vídeos", contador: listaDeVideos.length }] : []),
  ];
  const escolher = (m: MidiaDaCamada) => {
    onEscolher(m);
    onFechar();
  };
  const Botao = ({ m, rotulo, video }: { m: MidiaDaCamada; rotulo: string; video: boolean }) => (
    <li className="min-w-0">
      <button type="button" onClick={() => escolher(m)} className="group block w-full min-w-0 text-left" data-midia-do-acervo={m.caminho}>
        <span className="relative block overflow-hidden rounded-md bg-muted" style={{ height: 112 }}>
          {video ? (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Film className="h-6 w-6" />
            </span>
          ) : (
            <MiniaturaDoStorage bucket={m.bucket} caminho={m.caminho} alt={rotulo} largura={240} className="h-full w-full" />
          )}
          <span className="absolute inset-0 rounded-md ring-primary group-hover:ring-2" />
        </span>
        <span className={juntar(texto.auxiliar, "mt-1 block truncate")}>{rotulo}</span>
      </button>
    </li>
  );
  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      titulo="Escolher mídia"
      icone={<ImageIcon className="h-4 w-4" />}
      ajuda="As fotos e os vídeos deste cliente (na marca aberta). O que está ligado ao Quadro no Canvas aparece em Do Canvas."
      largura="lg"
      abaixoDoTitulo={<SeletorCompacto rotulo="Origem da mídia" opcoes={opcoes} valor={aba} onEscolher={(v) => setAba(v as Aba)} />}
      data-escolher-midia=""
    >
      {aba === "ligadas" ? (
        ligadas.length ? (
          <ul className="grid min-w-0 grid-cols-3 gap-3 sm:grid-cols-4">
            {ligadas.filter((m) => !somente || (somente === "video") === ehVideo(m.caminho)).map((m) => (
              <Botao key={m.caminho} m={m} rotulo={m.nome} video={ehVideo(m.caminho)} />
            ))}
          </ul>
        ) : (
          <EstadoVazio icone={<Link2 className="h-5 w-5" />} titulo="Nada ligado ao Quadro" descricao="Ligue um Resultado ou um Vídeo ao Quadro no Canvas." />
        )
      ) : aba === "fotos" ? (
        listaDeFotos.length ? (
          <ul className="grid min-w-0 grid-cols-3 gap-3 sm:grid-cols-4">
            {listaDeFotos.map((f) => (
              <Botao key={f.id} m={{ bucket: "mesa", caminho: f.storage_path, nome: f.nome, imagem_id: f.id, arquivo_id: null }} rotulo={f.nome} video={false} />
            ))}
          </ul>
        ) : (
          <EstadoVazio icone={<ImageIcon className="h-5 w-5" />} titulo={fotos.isLoading ? "Lendo o acervo" : "Sem fotos no acervo"} descricao="Suba ou gere fotos na Mesa Foto." />
        )
      ) : listaDeVideos.length ? (
        <ul className="grid min-w-0 grid-cols-3 gap-3 sm:grid-cols-4">
          {listaDeVideos.map((v) => (
            <Botao key={v.id} m={{ bucket: "mesa", caminho: v.storage_path, nome: v.nome, imagem_id: null, arquivo_id: v.id }} rotulo={v.nome} video />
          ))}
        </ul>
      ) : (
        <EstadoVazio icone={<Film className="h-5 w-5" />} titulo={videos.isLoading ? "Lendo os vídeos" : "Sem vídeos"} descricao="Gere pelo cartão Vídeo ou suba na Mesa Vídeos." />
      )}
    </JanelaCentral>
  );
}
