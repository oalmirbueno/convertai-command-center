import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Film, Loader2, Music, Play, Star, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { Cartao, MiniaturaDaFoto, Vazio } from "@/components/mesa-foto/Comuns";
import { useFotos, type FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import type { GrupoDoAcervoDeVideo } from "@/components/mesa-foto/canvas/historia";
import { AvisoDeAtivacao, SeloDoTipo } from "./Comuns";
import {
  chaveDosArquivos,
  duracaoCurta,
  fotosParaVideo,
  subirVideos,
  tamanhoCurto,
  useArquivosDeVideo,
  type ArquivoDeVideo,
} from "./videosApi";

/**
 * Acervo da Mesa Vídeos: as fotos que servem a vídeo (vindas da Mesa Foto pelo
 * filtro grupoNaMesaDeVideos: cenas, personagens, clones e produtos; artes e
 * carrosséis ficam fora) e as gravações brutas subidas aqui. Abrir a etapa só
 * lê: nada é gerado nem gasto.
 */

const GRUPOS: { valor: GrupoDoAcervoDeVideo; rotulo: string; vazio: string }[] = [
  { valor: "cena", rotulo: "Cenas", vazio: "Nenhuma cena ainda. Marque um Resultado como cena no Canvas da Mesa Foto." },
  { valor: "personagem", rotulo: "Personagens", vazio: "Nenhuma personagem. Crie na aba Modelos ou no Canvas da Mesa Foto." },
  { valor: "clone", rotulo: "Clones", vazio: "Nenhum clone autorizado. Clone de pessoa real só com autorização (Mesa Foto, Clones)." },
  { valor: "produto", rotulo: "Produtos", vazio: "Nenhuma foto de produto. Suba e identifique na Mesa Foto." },
];

const MAX_FOTOS_NA_GRADE = 60;

function PlayerDoArquivo({ arquivo }: { arquivo: ArquivoDeVideo }) {
  const url = useUrlDaMesa(arquivo.storage_path, arquivo.storage_bucket);
  const audio = arquivo.tipo === "audio" || String(arquivo.mime || "").indexOf("audio/") === 0;
  if (url.isLoading) return <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true" />;
  if (!url.data) return <p className="text-[12px] text-muted-foreground">Não foi possível abrir o arquivo agora.</p>;
  return audio ? (
    <audio src={url.data} controls preload="metadata" className="w-full" />
  ) : (
    <video src={url.data} controls preload="metadata" playsInline className="max-h-[60vh] w-full rounded-lg bg-black object-contain" />
  );
}

export function LinhaDoArquivo({ arquivo, aberto, onAbrir }: { arquivo: ArquivoDeVideo; aberto: boolean; onAbrir: () => void }) {
  const audio = arquivo.tipo === "audio" || String(arquivo.mime || "").indexOf("audio/") === 0;
  const detalhes = [duracaoCurta(arquivo.duracao_s), arquivo.largura && arquivo.altura ? `${arquivo.largura}x${arquivo.altura}` : "", tamanhoCurto(arquivo.bytes)].filter(Boolean);
  return (
    <li className="min-w-0 py-1.5" data-arquivo-de-video={arquivo.id}>
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          onClick={onAbrir}
          aria-expanded={aberto}
          aria-label={`${aberto ? "Fechar" : "Ver"} ${arquivo.nome}`}
          className="mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
        >
          {audio ? <Music className="h-3.5 w-3.5" /> : aberto ? <Film className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center text-[12.5px] font-medium">
            {arquivo.melhor && <Star className="mr-1 h-3 w-3 shrink-0 fill-current text-warning" aria-label="Melhor take" />}
            <span className="truncate" title={arquivo.nome_original !== arquivo.nome ? `Original: ${arquivo.nome_original}` : undefined}>
              {arquivo.nome}
            </span>
          </p>
          <p className="flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
            <SeloDoTipo tipo={arquivo.tipo} />
            {arquivo.grupo && <span className="mr-1.5 truncate">{arquivo.grupo}</span>}
            {detalhes.length > 0 && <span>{detalhes.join(" · ")}</span>}
          </p>
        </div>
      </div>
      {aberto && (
        <div className="mt-2">
          <PlayerDoArquivo arquivo={arquivo} />
        </div>
      )}
    </li>
  );
}

export default function EtapaAcervo() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const fotosQ = useFotos(clientId);
  const arquivosQ = useArquivosDeVideo(clientId);
  const [grupo, setGrupo] = useState<GrupoDoAcervoDeVideo>("cena");
  const [aberto, setAberto] = useState<string | null>(null);
  const [subindo, setSubindo] = useState<{ feitos: number; total: number } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const grupos = useMemo(() => fotosParaVideo((fotosQ.data || []) as FotoDoAcervo[]), [fotosQ.data]);
  const fotosDoGrupo = grupos[grupo] || [];
  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];
  const degradado = !!(arquivosQ.data && arquivosQ.data.degradado);
  const ativos = arquivos.filter((a) => a.estado !== "arquivado");

  const enviar = async (lista: FileList | null) => {
    const arquivosNovos = lista ? Array.prototype.slice.call(lista) as File[] : [];
    if (!arquivosNovos.length) return;
    setSubindo({ feitos: 0, total: arquivosNovos.length });
    try {
      const r = await subirVideos(clientId, arquivosNovos, (feitos, total) => setSubindo({ feitos, total }));
      void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      const partes: string[] = [];
      if (r.registrados.length) partes.push(`${r.registrados.length} no acervo`);
      if (r.duplicados.length) partes.push(`${r.duplicados.length} já estavam (mesmo conteúdo)`);
      if (r.recusados.length) partes.push(`${r.recusados.length} não subiram: ${r.recusados.map((x) => `${x.nome} (${x.motivo})`).join("; ")}`);
      if (r.aviso) toast.warning("Subiu, falta registrar", { description: r.aviso, duration: 9000 });
      else toast.success("Gravações enviadas", { description: partes.join(". ") || "Nada novo." });
    } finally {
      setSubindo(null);
      if (entrada.current) entrada.current.value = "";
    }
  };

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <Cartao
        titulo="Fotos para vídeo"
        dica="Da Mesa Foto: cenas, personagens, clones autorizados e produtos. Artes, logos e carrosséis ficam fora."
      >
        <div role="tablist" aria-label="Grupos do acervo" className="mb-3 flex flex-wrap">
          {GRUPOS.map((g) => (
            <button
              key={g.valor}
              type="button"
              role="tab"
              aria-selected={grupo === g.valor}
              onClick={() => setGrupo(g.valor)}
              className={`mb-1 mr-1 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                grupo === g.valor ? "border-primary/50 bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.rotulo} <span className="text-muted-foreground">({(grupos[g.valor] || []).length})</span>
            </button>
          ))}
        </div>
        {fotosQ.isLoading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : fotosDoGrupo.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5" data-grupo-do-acervo={grupo}>
            {fotosDoGrupo.slice(0, MAX_FOTOS_NA_GRADE).map((f) => (
              <div key={f.id} className="min-w-0" title={f.nome}>
                <MiniaturaDaFoto foto={f} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">{(GRUPOS.find((g) => g.valor === grupo) || GRUPOS[0]).vazio}</p>
        )}
        {fotosDoGrupo.length > MAX_FOTOS_NA_GRADE && (
          <p className="mt-2 text-[11px] text-muted-foreground">Mostrando {MAX_FOTOS_NA_GRADE} de {fotosDoGrupo.length}. O resto está na Mesa Foto.</p>
        )}
      </Cartao>

      <Cartao
        titulo="Gravações e takes"
        dica="Gravações brutas do cliente. O arquivo original nunca muda; o nome e o grupo se ajustam na Edição."
        acao={
          <>
            <input
              ref={entrada}
              type="file"
              multiple
              accept="video/*,audio/*,.mov,.mp4,.mkv,.mts,.wav,.mp3,.m4a"
              className="hidden"
              aria-label="Escolher gravações"
              onChange={(e) => void enviar(e.target.files)}
            />
            <Button type="button" size="sm" className="h-8" disabled={!!subindo} onClick={() => entrada.current && entrada.current.click()}>
              {subindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
              {subindo ? `Subindo ${subindo.feitos} de ${subindo.total}` : "Subir gravações"}
            </Button>
          </>
        }
      >
        {degradado && <AvisoDeAtivacao>O acervo de vídeo ainda não foi ativado no banco (SQL V2-01). O que já subiu aparece pela pasta, sem nome, grupo nem organizador.</AvisoDeAtivacao>}
        {arquivosQ.isLoading ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" aria-busy="true" />
        ) : arquivosQ.isError ? (
          <p className="text-[12px] text-destructive">Não foi possível ler as gravações agora.</p>
        ) : ativos.length ? (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto" aria-label="Gravações do cliente">
            {ativos.map((a) => (
              <LinhaDoArquivo key={a.id} arquivo={a} aberto={aberto === a.id} onAbrir={() => setAberto(aberto === a.id ? null : a.id)} />
            ))}
          </ul>
        ) : (
          <Vazio titulo="Nenhuma gravação ainda">Suba os vídeos brutos (até 4 GB cada). A duração e o tamanho do quadro são lidos no seu navegador.</Vazio>
        )}
      </Cartao>
    </div>
  );
}
