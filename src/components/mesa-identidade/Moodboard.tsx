import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ImagePlus, Library, Link2, Loader2, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useReferenciasDoCliente } from "@/components/mesa/contextoDoCliente";
import Secao from "@/components/sistema/Secao";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { linhaDaMarca } from "../../../supabase/functions/_shared/heranca-da-marca";
import { chamarIdentidade } from "./identidadeApi";
import { Pastilha, useProjetoDaMesa } from "./Comuns";

/** Um quadro do moodboard: imagem do painel (bucket e caminho) ou da web (url), sempre com a fonte. */
export type ItemDoMoodboard = {
  id: string;
  titulo: string;
  nota: string;
  origem: "contexto" | "acervo" | "web" | "upload" | "link";
  imagem?: { bucket: string; caminho: string } | null;
  url?: string | null;
  fonte_url?: string | null;
  fonte_nome?: string | null;
  licenca?: string | null;
  autor?: string | null;
};

type ItemDaWeb = { id: string | null; titulo: string; imagem_url: string; miniatura_url: string | null; fonte_url: string | null; fonte_nome: string | null; licenca_rotulo: string; autor: string | null };

export const MAX_DO_MOODBOARD = 36;

const urlSegura = (s: string) => (/^https:\/\/[^\s"'<>]+$/i.test(s.trim()) ? s.trim().slice(0, 600) : "");
const novoId = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/** Lista guardada em forma segura (o que não serve sai). */
export function itensDoMoodboard(v: unknown): ItemDoMoodboard[] {
  const lista = Array.isArray(v) ? v : [];
  const saida: ItemDoMoodboard[] = [];
  for (const b of lista) {
    const o = (b && typeof b === "object" ? b : {}) as Record<string, any>;
    const imagem = o.imagem && typeof o.imagem.caminho === "string" && typeof o.imagem.bucket === "string" ? { bucket: String(o.imagem.bucket).slice(0, 40), caminho: String(o.imagem.caminho).slice(0, 400) } : null;
    const url = typeof o.url === "string" ? urlSegura(o.url) : "";
    if (!imagem && !url) continue;
    saida.push({
      id: String(o.id || novoId()).slice(0, 40),
      titulo: String(o.titulo || "").slice(0, 120),
      nota: String(o.nota || "").slice(0, 300),
      origem: ["contexto", "acervo", "web", "upload", "link"].indexOf(o.origem) >= 0 ? o.origem : "link",
      imagem,
      url: url || null,
      fonte_url: typeof o.fonte_url === "string" ? urlSegura(o.fonte_url) || null : null,
      fonte_nome: typeof o.fonte_nome === "string" ? o.fonte_nome.slice(0, 120) : null,
      licenca: typeof o.licenca === "string" ? o.licenca.slice(0, 60) : null,
      autor: typeof o.autor === "string" ? o.autor.slice(0, 120) : null,
    });
  }
  return saida.slice(0, MAX_DO_MOODBOARD);
}

function Quadro({ item, onTirar, onNota }: { item: ItemDoMoodboard; onTirar?: () => void; onNota?: (nota: string) => void }) {
  const doPainel = useUrlDaMesa(item.url ? null : item.imagem ? item.imagem.caminho : null, item.imagem ? item.imagem.bucket : "mesa");
  const src = item.url || doPainel.data || null;
  return (
    <figure className="min-w-0" data-quadro-do-moodboard={item.origem}>
      <span className="relative block w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "75%" }}>
        {src ? <img src={src} alt={item.titulo || "Referência"} loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" /> : null}
        {onTirar && (
          <button type="button" className={juntar(botao.icone, "absolute right-1 top-1 bg-background/90")} aria-label={`Tirar ${item.titulo || "a referência"}`} onClick={onTirar}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </span>
      <figcaption className="mt-1 min-w-0">
        <span className="flex min-w-0 items-center">
          <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{item.titulo || "Sem título"}</span>
          {item.fonte_url && (
            <a href={item.fonte_url} target="_blank" rel="noopener noreferrer" className={botao.icone} aria-label={`Fonte de ${item.titulo || "a referência"}`} title={item.fonte_nome || "Fonte"}>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </span>
        <span className="flex min-w-0 flex-wrap items-center">
          <Pastilha>{item.origem === "web" ? item.fonte_nome || "web" : item.origem === "acervo" ? "acervo" : item.origem === "contexto" ? "contexto" : item.origem === "upload" ? "enviada" : "link"}</Pastilha>
          {item.licenca && <span className={juntar(texto.etiqueta, "ml-1 truncate text-muted-foreground")}>{item.licenca}</span>}
        </span>
        {onNota && <input className={juntar(campo, "mt-1 h-8 text-[12px]")} defaultValue={item.nota} maxLength={300} placeholder="O que ela ensina" aria-label="Nota da referência" onBlur={(e) => e.target.value !== item.nota && onNota(e.target.value)} />}
      </figcaption>
    </figure>
  );
}

/**
 * Moodboard da Pesquisa (IDV2): referências do acervo do cliente (Contexto e
 * fotos), da web (Openverse, com fonte, autor e licença) e enviadas pela
 * equipe, em grade. Cada quadro guarda de onde veio. Imagem da web fica como
 * link (nada é copiado sem licença); a nota diz o que ela ensina.
 */
export default function Moodboard() {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const itens = useMemo(() => itensDoMoodboard(projeto.dados.pesquisa && projeto.dados.pesquisa.moodboard), [projeto.dados.pesquisa]);
  const [aberto, setAberto] = useState<"acervo" | "web" | "link" | null>(null);
  const [busca, setBusca] = useState("");
  const [link, setLink] = useState({ url: "", titulo: "", fonte: "" });
  const [achados, setAchados] = useState<ItemDaWeb[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement | null>(null);
  const marcaDaRegra = projeto.marca_id ? { id: projeto.marca_id, principal: false } : marca ? { id: marca.id, principal: !!marca.principal } : null;

  const gravar = async (lista: ItemDoMoodboard[], frase?: string) => {
    try {
      await salvarParte("pesquisa", { moodboard: lista.slice(0, MAX_DO_MOODBOARD) });
      if (frase) toast.success(frase);
    } catch (e) {
      avisarErro(e, "O moodboard não foi salvo");
    }
  };
  const acrescentar = (novos: ItemDoMoodboard[]) => {
    const livres = MAX_DO_MOODBOARD - itens.length;
    if (livres <= 0) {
      toast.info(`O moodboard já tem ${MAX_DO_MOODBOARD} quadros.`);
      return;
    }
    const semRepetir = novos.filter((n) => !itens.some((i) => (n.url && i.url === n.url) || (n.imagem && i.imagem && i.imagem.caminho === n.imagem.caminho)));
    if (!semRepetir.length) {
      toast.info("Essa referência já está no moodboard.");
      return;
    }
    void gravar(itens.concat(semRepetir.slice(0, livres)), semRepetir.length === 1 ? "Referência no moodboard" : `${semRepetir.length} referências no moodboard`);
  };

  // Acervo: referências do Contexto e fotos do acervo, pela regra da marca.
  const refs = useReferenciasDoCliente(aberto === "acervo" ? clientId : "");
  const fotos = useQuery({
    queryKey: ["mesa-identidade", "acervo-do-moodboard", clientId, marcaDaRegra ? marcaDaRegra.id : "cliente"],
    enabled: aberto === "acervo",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cliente_imagens").select("id, nome, storage_bucket, storage_path, tags, descricao").eq("client_id", clientId).eq("ativa", true).order("criado_em", { ascending: false }).limit(60);
      if (error) throw error;
      return ((data || []) as Array<{ id: string; nome: string; storage_bucket: string; storage_path: string; tags: string[] | null; descricao: string | null }>).filter((f) => {
        const marcas = (f.tags || []).filter((t) => t.indexOf("marca:") === 0).map((t) => t.slice(6));
        if (!marcaDaRegra) return true;
        if (marcaDaRegra.principal) return !marcas.length || marcas.indexOf(marcaDaRegra.id) >= 0;
        return marcas.indexOf(marcaDaRegra.id) >= 0;
      });
    },
  });
  const doAcervo: ItemDoMoodboard[] = useMemo(() => {
    const deRefs: ItemDoMoodboard[] = (refs.data || [])
      .filter((r) => r.ativa && r.imagem && linhaDaMarca(r.marca_id, marcaDaRegra))
      .slice(0, 30)
      .map((r) => ({ id: `ctx-${r.id}`, titulo: r.nome || "Referência do contexto", nota: (r.leitura || "").slice(0, 300), origem: "contexto" as const, imagem: r.imagem, url: null, fonte_url: r.url_origem && /^https:/i.test(r.url_origem) ? r.url_origem : null, fonte_nome: r.origem === "pinterest" ? "Pinterest" : "Contexto", licenca: null, autor: null }));
    const deFotos: ItemDoMoodboard[] = (fotos.data || []).slice(0, 30).map((f) => ({ id: `ac-${f.id}`, titulo: f.nome, nota: (f.descricao || "").slice(0, 300), origem: "acervo" as const, imagem: { bucket: f.storage_bucket, caminho: f.storage_path }, url: null, fonte_url: null, fonte_nome: "Acervo do cliente", licenca: null, autor: null }));
    return deRefs.concat(deFotos);
  }, [refs.data, fotos.data, marcaDaRegra ? marcaDaRegra.id : ""]);

  const buscar = async () => {
    if (busca.trim().length < 2) return;
    setBuscando(true);
    try {
      const r = await chamarIdentidade<{ itens: ItemDaWeb[] }>("moodboard_web", { projeto_id: projeto.id, busca: busca.trim() });
      setAchados(r.itens || []);
      if (!r.itens || !r.itens.length) toast.info("Nada achado com essas palavras. Tente em inglês.");
    } catch (e) {
      avisarErro(e, "A busca não respondeu");
    } finally {
      setBuscando(false);
    }
  };

  const enviar = async (f: File) => {
    if (!/\.(png|jpe?g|webp)$/i.test(f.name)) {
      toast.error("Envie PNG, JPG ou WEBP.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("A imagem passou de 10 MB.");
      return;
    }
    setEnviando(true);
    try {
      const { enviarImagemDeApoio } = await import("./arquivosDaMarca");
      const caminho = await enviarImagemDeApoio(clientId, projeto.id, f, "moodboard");
      acrescentar([{ id: novoId(), titulo: f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 80), nota: "", origem: "upload", imagem: { bucket: "mesa", caminho }, url: null }]);
    } catch (e) {
      avisarErro(e, "A imagem não foi enviada");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Secao
      titulo="Moodboard"
      divisoria
      descricao={`${itens.length} quadros`}
      recolher={`mesa-identidade:${projeto.id}:pesquisa:moodboard`}
      ajuda="Junte imagens que mostram o clima da marca: do acervo do cliente, da web (com fonte e licença) ou enviadas. A imagem da web fica como link; a nota diz o que cada uma ensina. O moodboard entra na estratégia, no conceito e na apresentação."
      acao={
        <>
          <button type="button" className={juntar(aberto === "acervo" ? botao.secundario : botao.discreto, "m-1 h-8")} onClick={() => setAberto(aberto === "acervo" ? null : "acervo")}>
            <Library className="mr-1.5 h-3.5 w-3.5" /> Do acervo
          </button>
          <button type="button" className={juntar(aberto === "web" ? botao.secundario : botao.discreto, "m-1 h-8")} onClick={() => setAberto(aberto === "web" ? null : "web")}>
            <Search className="mr-1.5 h-3.5 w-3.5" /> Da web
          </button>
          <button type="button" className={juntar(aberto === "link" ? botao.secundario : botao.discreto, "m-1 h-8")} onClick={() => setAberto(aberto === "link" ? null : "link")}>
            <Link2 className="mr-1.5 h-3.5 w-3.5" /> Link
          </button>
          <input ref={entrada} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) void enviar(f); e.target.value = ""; }} />
          <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={enviando} onClick={() => entrada.current && entrada.current.click()} aria-label="Enviar imagem para o moodboard">
            {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          </button>
        </>
      }
    >
      {aberto && (
        <div className="mb-5 min-w-0 border-b border-border pb-5" data-moodboard-fonte={aberto}>
          <div className="mb-3 flex min-w-0 items-center">
            <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>{aberto === "acervo" ? "Toque para trazer ao moodboard" : aberto === "web" ? "Busca no Openverse (imagens abertas)" : "Imagem por link (https)"}</span>
            <button type="button" className={botao.icone} aria-label="Fechar" onClick={() => setAberto(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {aberto === "web" && (
            <div className="mb-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
              <input className={campo} value={busca} maxLength={200} placeholder="Ex.: rustic bakery texture, warm light" onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }} aria-label="Palavras da busca" />
              <button type="button" className={botao.secundario} disabled={buscando || busca.trim().length < 2} onClick={() => void buscar()}>
                {buscando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />} Buscar
              </button>
            </div>
          )}
          {aberto === "link" && (
            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input className={campo} value={link.url} placeholder="https://... (endereço da imagem)" aria-label="Endereço da imagem" onChange={(e) => setLink({ ...link, url: e.target.value })} />
              <input className={campo} value={link.titulo} placeholder="Título" aria-label="Título" maxLength={120} onChange={(e) => setLink({ ...link, titulo: e.target.value })} />
              <input className={campo} value={link.fonte} placeholder="Página de origem (https)" aria-label="Página de origem" onChange={(e) => setLink({ ...link, fonte: e.target.value })} />
              <button
                type="button"
                className={botao.secundario}
                disabled={!urlSegura(link.url)}
                onClick={() => {
                  acrescentar([{ id: novoId(), titulo: link.titulo.trim() || "Referência", nota: "", origem: "link", url: urlSegura(link.url), fonte_url: urlSegura(link.fonte) || urlSegura(link.url), fonte_nome: null }]);
                  setLink({ url: "", titulo: "", fonte: "" });
                }}
              >
                Guardar
              </button>
            </div>
          )}
          {(aberto === "acervo" || aberto === "web") && (
            <div className="grid min-w-0 grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">
              {(aberto === "acervo" ? doAcervo : (achados || []).map((a, i) => ({ id: `w-${a.id || i}`, titulo: a.titulo, nota: "", origem: "web" as const, url: a.miniatura_url || a.imagem_url, fonte_url: a.fonte_url, fonte_nome: a.fonte_nome, licenca: a.licenca_rotulo, autor: a.autor }))).map((it) => (
                <button key={it.id} type="button" className="min-w-0 text-left" onClick={() => acrescentar([{ ...it, id: novoId() }])} aria-label={`Trazer ${it.titulo} ao moodboard`}>
                  <Quadro item={it} />
                </button>
              ))}
            </div>
          )}
          {aberto === "acervo" && !doAcervo.length && (refs.isLoading || fotos.isLoading) && <Carregando forma="grade" linhas={6} rotulo="Lendo o acervo" />}
          {aberto === "acervo" && !refs.isLoading && !fotos.isLoading && !doAcervo.length && <p className={texto.auxiliar}>O acervo desta marca não tem imagem ainda.</p>}
        </div>
      )}
      {itens.length > 0 ? (
        <div className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4" data-grade-do-moodboard="">
          {itens.map((it) => (
            <Quadro key={it.id} item={it} onTirar={() => void gravar(itens.filter((x) => x.id !== it.id))} onNota={(nota) => void gravar(itens.map((x) => (x.id === it.id ? { ...x, nota: nota.slice(0, 300) } : x)))} />
          ))}
        </div>
      ) : (
        <p className={texto.auxiliar}>Nenhum quadro ainda. Traga do acervo, busque na web ou envie.</p>
      )}
    </Secao>
  );
}
