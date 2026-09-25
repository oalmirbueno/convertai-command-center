import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Images, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { textoDoErro } from "@/lib/mesa/api";
import { invalidarAcervo } from "./contextoDoCliente";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import SeletorDoAcervo, { useAcervo, type ImagemDoAcervo } from "./SeletorDoAcervo";
import { subirOriginais } from "@/components/mesa-foto/fotoApi";
import type { Campanha, ImagemDaCampanha, PapelDaImagemDaCampanha } from "./mesaV4Api";
import {
  campanhaSalvar,
  MAX_IMAGENS_CAMPANHA,
  normalizarImagensDaCampanha,
  PAPEIS_DA_IMAGEM,
  trocarCampanhaNoCache,
} from "./campanhasApi";

/**
 * Imagens da campanha (pedido do dono, 25/09): a equipe escolhe no acervo do
 * cliente (cliente_imagens, inclusive as feitas na Mesa Foto) ou sobe novas do
 * computador (entram no acervo pela Mesa Foto, origem mesa_foto), e diz o
 * papel de cada uma (produto herói, apoio, ambiente) e por que usar. O plano
 * de imagens e as peças do mês usam esta lista.
 */

/** Imagem mostrada na tela: do acervo em cache ou recém enviada (antes de o acervo reler). */
export interface ImagemVista {
  id: string;
  nome: string;
  storage_bucket: string;
  storage_path: string;
}

/** Miniatura quadrada de uma imagem do acervo pelo id. */
export function MiniaturaDaImagem({ imagem, className = "" }: { imagem: ImagemVista | null; className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden rounded-md border border-border bg-secondary ${className}`} style={{ paddingBottom: "100%" }}>
      {imagem ? (
        <ImagemDaMesa caminho={imagem.storage_path} bucket={imagem.storage_bucket || "mesa"} alt={imagem.nome} className="absolute inset-0 h-full w-full" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-1 text-center text-[10px] text-muted-foreground">fora do acervo</span>
      )}
    </div>
  );
}

/** Busca a imagem pelo id no acervo em cache e nas recém enviadas. */
export function useImagensVistas(extras: Record<string, ImagemVista> = {}) {
  const acervo = useAcervo();
  const lista = acervo.data || [];
  return (id: string | null | undefined): ImagemVista | null => {
    if (!id) return null;
    if (extras[id]) return extras[id];
    const achada = lista.filter((i) => i.id === id)[0];
    return achada ? { id: achada.id, nome: achada.nome, storage_bucket: achada.storage_bucket, storage_path: achada.storage_path } : null;
  };
}

const naoPublicavel = (i: ImagemDoAcervo) => (i.tags || []).some((t) => t === "nao_publicar" || t === "referencia_web");

function CartaoDaImagem({
  imagem,
  vista,
  onMudar,
  onTirar,
  desabilitado,
}: {
  imagem: ImagemDaCampanha;
  vista: ImagemVista | null;
  onMudar: (nova: ImagemDaCampanha) => void;
  onTirar: () => void;
  desabilitado?: boolean;
}) {
  const [nota, setNota] = useState(imagem.nota);
  useEffect(() => setNota(imagem.nota), [imagem.nota]);
  const gravarNota = () => {
    const limpa = nota.trim().slice(0, 400);
    if (limpa !== imagem.nota) onMudar({ ...imagem, nota: limpa });
  };
  return (
    <li className="flex min-w-0 rounded-lg border border-border bg-background p-2">
      <div className="mr-2.5 w-20 shrink-0 sm:w-24">
        <MiniaturaDaImagem imagem={vista} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start">
          <p className="mr-1 min-w-0 flex-1 truncate text-[12px] font-medium" title={vista ? vista.nome : imagem.imagem_id}>
            {vista ? vista.nome : "Imagem do acervo"}
          </p>
          <button
            type="button"
            onClick={onTirar}
            disabled={desabilitado}
            aria-label={`Tirar ${vista ? vista.nome : "a imagem"} da campanha`}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap" role="group" aria-label="Papel da imagem">
          {PAPEIS_DA_IMAGEM.map((p) => (
            <button
              key={p.valor}
              type="button"
              title={p.dica}
              aria-pressed={imagem.papel === p.valor}
              disabled={desabilitado}
              onClick={() => (imagem.papel === p.valor ? undefined : onMudar({ ...imagem, papel: p.valor as PapelDaImagemDaCampanha }))}
              className={`mb-1 mr-1 rounded-full border px-2 py-0.5 text-[10.5px] transition-colors ${
                imagem.papel === p.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        <Input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onBlur={gravarNota}
          onKeyDown={(e) => {
            if (e.key === "Enter") gravarNota();
          }}
          disabled={desabilitado}
          placeholder="Por que usar esta imagem? (ex.: mostra o kit inteiro, luz boa)"
          aria-label={`Por que usar ${vista ? vista.nome : "esta imagem"}`}
          className="mt-0.5 h-8 text-[12px]"
        />
      </div>
    </li>
  );
}

/**
 * Lista controlada: quem usa guarda (o formulário na memória, o detalhe no
 * banco pela ação campanha_salvar).
 */
export default function CampanhaImagens({
  valor,
  onChange,
  desabilitado,
  vazio = "Nenhuma imagem ainda. Escolha no acervo ou envie do computador: o agente analisa e diz qual vai em cada peça.",
}: {
  valor: ImagemDaCampanha[];
  onChange: (lista: ImagemDaCampanha[]) => void;
  desabilitado?: boolean;
  vazio?: string;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [acervoAberto, setAcervoAberto] = useState(false);
  const [envio, setEnvio] = useState<{ feitos: number; total: number } | null>(null);
  const [enviadas, setEnviadas] = useState<Record<string, ImagemVista>>({});
  const entrada = useRef<HTMLInputElement>(null);
  const achar = useImagensVistas(enviadas);
  const cheia = valor.length >= MAX_IMAGENS_CAMPANHA;
  // O último valor, para o envio (que termina depois) não trabalhar com a lista velha.
  const atual = useRef(valor);
  atual.current = valor;

  const papelDaNova = (lista: ImagemDaCampanha[]): PapelDaImagemDaCampanha => (lista.some((i) => i.papel === "heroi") ? "apoio" : "heroi");

  const alternarDoAcervo = (i: ImagemDoAcervo) => {
    const lista = atual.current;
    if (lista.some((x) => x.imagem_id === i.id)) {
      onChange(lista.filter((x) => x.imagem_id !== i.id));
      return;
    }
    if (naoPublicavel(i)) {
      toast.warning("Esta é uma referência da internet", { description: "Serve só para a Mesa Foto copiar o produto; não entra em peça publicada." });
      return;
    }
    if (lista.length >= MAX_IMAGENS_CAMPANHA) {
      toast.warning(`Até ${MAX_IMAGENS_CAMPANHA} imagens por campanha`);
      return;
    }
    onChange(normalizarImagensDaCampanha(lista.concat([{ imagem_id: i.id, papel: papelDaNova(lista), nota: "" }])));
  };

  const enviar = async (arquivos: File[]) => {
    const livres = MAX_IMAGENS_CAMPANHA - atual.current.length;
    if (!arquivos.length || livres <= 0) return;
    const lote = arquivos.slice(0, livres);
    if (arquivos.length > livres) toast.warning(`Só ${livres} imagem(ns) cabem na campanha (até ${MAX_IMAGENS_CAMPANHA}).`);
    setEnvio({ feitos: 0, total: lote.length });
    try {
      const r = await subirOriginais(clientId, lote, (feitos, total) => setEnvio({ feitos, total }));
      if (r.registradas.length) {
        const novas: Record<string, ImagemVista> = {};
        r.registradas.forEach((f) => {
          novas[f.id] = { id: f.id, nome: f.nome, storage_bucket: f.storage_bucket || "mesa", storage_path: f.storage_path };
        });
        setEnviadas((m) => ({ ...m, ...novas }));
        let lista = atual.current;
        r.registradas.forEach((f) => {
          if (!lista.some((x) => x.imagem_id === f.id)) lista = lista.concat([{ imagem_id: f.id, papel: papelDaNova(lista), nota: "" }]);
        });
        onChange(normalizarImagensDaCampanha(lista));
        invalidarAcervo(queryClient, clientId);
        void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "acervo", clientId] });
      }
      if (r.recusadas.length) {
        toast.warning(`${r.recusadas.length} imagem(ns) não entraram`, { description: r.recusadas.map((x) => `${x.nome}: ${x.motivo}`).join("; ").slice(0, 300) });
      }
    } catch (e) {
      toast.error("Imagens não enviadas", { description: textoDoErro(e) });
    } finally {
      setEnvio(null);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const ocupado = !!desabilitado || envio !== null;

  return (
    <div className="min-w-0 space-y-3">
      {valor.length > 0 ? (
        <ul className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2" aria-label="Imagens da campanha">
          {valor.map((img) => (
            <CartaoDaImagem
              key={img.imagem_id}
              imagem={img}
              vista={achar(img.imagem_id)}
              desabilitado={!!desabilitado}
              onMudar={(nova) => onChange(atual.current.map((x) => (x.imagem_id === nova.imagem_id ? nova : x)))}
              onTirar={() => onChange(atual.current.filter((x) => x.imagem_id !== img.imagem_id))}
            />
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{vazio}</p>
      )}

      <div className="flex min-w-0 flex-wrap items-center">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mb-1 mr-1.5 h-8"
          aria-expanded={acervoAberto}
          disabled={ocupado && !acervoAberto}
          onClick={() => setAcervoAberto((v) => !v)}
        >
          <Images className="mr-1.5 h-3.5 w-3.5" /> {acervoAberto ? "Fechar o acervo" : "Escolher no acervo"}
        </Button>
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" disabled={ocupado || cheia} onClick={() => entrada.current && entrada.current.click()}>
          <Upload className="mr-1.5 h-3.5 w-3.5" /> Enviar do computador
        </Button>
        <input
          ref={entrada}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          aria-label="Enviar imagens da campanha"
          onChange={(e) => void enviar(Array.prototype.slice.call(e.target.files || []) as File[])}
        />
        <span className="mb-1 text-[11.5px] text-muted-foreground">
          {envio ? (
            <>
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
              Enviando {envio.feitos} de {envio.total}…
            </>
          ) : (
            `${valor.length} de ${MAX_IMAGENS_CAMPANHA}`
          )}
        </span>
      </div>

      {acervoAberto && (
        <SeletorDoAcervo
          titulo="Imagens do acervo para a campanha"
          escolhidas={valor.map((v) => v.imagem_id)}
          onEscolher={alternarDoAcervo}
          onFechar={() => setAcervoAberto(false)}
        />
      )}
    </div>
  );
}

/**
 * No detalhe: a lista vive no banco (campanha_salvar). As gravações seguem em
 * fila e a última vence; se falhar, a tela volta ao que está gravado.
 */
export function ImagensDaCampanhaSalvas({ campanha, onSalvando }: { campanha: Campanha; onSalvando?: (n: number) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [lista, setLista] = useState<ImagemDaCampanha[]>(() => normalizarImagensDaCampanha(campanha.imagens));
  const salvas = useRef<ImagemDaCampanha[]>(lista);
  const pedida = useRef<ImagemDaCampanha[] | null>(null);
  const fila = useRef<Promise<void>>(Promise.resolve());
  const pendentes = useRef(0);

  useEffect(() => {
    const doBanco = normalizarImagensDaCampanha(campanha.imagens);
    // Resposta de outra ação (agente, plano) traz a campanha nova: só vale se não há gravação na fila.
    if (pendentes.current === 0) {
      setLista(doBanco);
      salvas.current = doBanco;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campanha.id, JSON.stringify(campanha.imagens || [])]);

  const mudar = (nova: ImagemDaCampanha[]) => {
    setLista(nova);
    pedida.current = nova;
    pendentes.current += 1;
    if (onSalvando) onSalvando(pendentes.current);
    fila.current = fila.current.then(async () => {
      try {
        const r = await campanhaSalvar({ campanhaId: campanha.id, imagens: nova });
        salvas.current = nova;
        if (r && r.recusadas && r.recusadas.length) {
          toast.warning(`${r.recusadas.length} imagem(ns) não entraram`, { description: "Não estão mais no acervo do cliente ou são referência da internet." });
        }
        if (pedida.current === nova && r && r.campanha) {
          const gravadas = normalizarImagensDaCampanha(r.campanha.imagens);
          salvas.current = gravadas;
          setLista(gravadas);
          trocarCampanhaNoCache(queryClient, clientId, r.campanha);
        }
      } catch (e) {
        toast.error("Imagens não salvas", { description: textoDoErro(e) });
        if (pedida.current === nova) setLista(salvas.current);
      } finally {
        pendentes.current -= 1;
        if (onSalvando) onSalvando(pendentes.current);
      }
    });
  };

  return <CampanhaImagens valor={lista} onChange={mudar} />;
}
