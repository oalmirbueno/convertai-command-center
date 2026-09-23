import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { textoDoErro } from "@/lib/mesa/api";
import { pastaDaFoto, pastasDoAcervo, useArvoreDoWorkspace } from "@/lib/mesa/pastas";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { ExploradorDePastas } from "./NavegadorDePastas";

/**
 * Acervo de imagens reais do cliente (tabela cliente_imagens): o seletor abre
 * no próprio painel, sem janela, nas mesmas pastas do Workspace do cliente
 * (trilha, Voltar, abrir pasta), com filtro por categoria e busca (a busca
 * mostra os resultados de todas as pastas juntos). A miniatura usa a URL
 * assinada do bucket de cada imagem.
 */

export interface ImagemDoAcervo {
  id: string;
  storage_bucket: string;
  storage_path: string;
  nome: string;
  pasta: string | null;
  categoria: string | null;
  tags: string[] | null;
  descricao: string | null;
  origem?: string | null;
  workspace_node_id?: string | null;
}

export const ROTULO_DA_CATEGORIA: Record<string, string> = {
  ambiente: "Ambiente",
  produto: "Produto",
  pessoa: "Pessoas",
  antes_depois: "Antes e depois",
  equipe: "Equipe",
  detalhe: "Detalhes",
  fachada: "Fachada",
  logo: "Logo",
  arte: "Artes",
  outro: "Outras",
};

const ORDEM_DAS_CATEGORIAS = ["ambiente", "produto", "pessoa", "antes_depois", "equipe", "detalhe", "fachada", "arte", "logo", "outro"];
const LIMITE_NA_TELA = 120;

export function useAcervo(ativo = true) {
  const { clientId } = useMesa();
  return useQuery({
    queryKey: ["mesa", "acervo", clientId],
    enabled: ativo && !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<ImagemDoAcervo[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_imagens")
        .select("id, storage_bucket, storage_path, nome, pasta, categoria, tags, descricao, origem, workspace_node_id")
        .eq("client_id", clientId)
        .eq("ativa", true)
        .order("pasta", { ascending: true })
        .order("nome", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data || []) as ImagemDoAcervo[];
    },
  });
}

/** Texto sem acento e em minúsculas, para a busca. */
export function semAcento(t: string): string {
  return (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Foto do acervo em miniatura, com o nome embaixo (nunca por cima). */
export function FotoDoAcervo({ imagem, className = "" }: { imagem: ImagemDoAcervo; className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden rounded-md border border-border bg-secondary ${className}`} style={{ paddingBottom: "100%" }}>
      <ImagemDaMesa caminho={imagem.storage_path} bucket={imagem.storage_bucket || "mesa"} alt={imagem.nome} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

export default function SeletorDoAcervo({
  escolhidas = [],
  onEscolher,
  onFechar,
  titulo = "Acervo do cliente",
}: {
  escolhidas?: string[];
  onEscolher: (imagem: ImagemDoAcervo) => void;
  onFechar: () => void;
  titulo?: string;
}) {
  const { clientId } = useMesa();
  const acervo = useAcervo();
  const arvore = useArvoreDoWorkspace(clientId);
  const [busca, setBusca] = useState("");
  const [pastaAberta, setPastaAberta] = useState("");
  const [categoria, setCategoria] = useState<string>("todas");

  const lista = acervo.data || [];
  const categorias = useMemo(() => {
    const vistas: string[] = [];
    for (const i of lista) {
      const c = i.categoria || "outro";
      if (vistas.indexOf(c) < 0) vistas.push(c);
    }
    return vistas.sort((a, b) => {
      const ia = ORDEM_DAS_CATEGORIAS.indexOf(a);
      const ib = ORDEM_DAS_CATEGORIAS.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [lista]);

  const filtradas = useMemo(() => {
    const termos = semAcento(busca).split(" ").filter(Boolean);
    return lista.filter((i) => {
      if (categoria !== "todas" && (i.categoria || "outro") !== categoria) return false;
      if (!termos.length) return true;
      const alvo = semAcento([i.nome, i.pasta, i.descricao, i.categoria, (i.tags || []).join(" ")].join(" "));
      return termos.every((t) => alvo.indexOf(t) >= 0);
    });
  }, [lista, busca, categoria]);

  const buscando = semAcento(busca).trim().length > 0;
  const espelho = useMemo(() => pastasDoAcervo(arvore.data || [], lista), [arvore.data, lista]);

  const cartao = (i: ImagemDoAcervo) => {
    const marcada = escolhidas.indexOf(i.id) >= 0;
    return (
      <li key={i.id} className="min-w-0">
        <button
          type="button"
          onClick={() => onEscolher(i)}
          title={i.descricao || i.nome}
          aria-pressed={marcada}
          className={`block w-full rounded-lg p-0.5 text-left transition-colors ${marcada ? "bg-primary" : "hover:bg-primary/30"}`}
        >
          <FotoDoAcervo imagem={i} />
        </button>
        <p className="mt-1 flex items-start text-[10.5px] leading-tight text-muted-foreground">
          {marcada && <Check className="mr-0.5 h-3 w-3 shrink-0 text-primary" />}
          <span className="min-w-0 line-clamp-2 [overflow-wrap:anywhere]">{i.nome}</span>
        </p>
      </li>
    );
  };

  // Na busca: categoria, depois pasta.
  const grupos = useMemo(() => {
    const mapa: Record<string, Record<string, ImagemDoAcervo[]>> = {};
    for (const i of filtradas.slice(0, LIMITE_NA_TELA)) {
      const c = i.categoria || "outro";
      const p = i.pasta || "Sem pasta";
      if (!mapa[c]) mapa[c] = {};
      if (!mapa[c][p]) mapa[c][p] = [];
      mapa[c][p].push(i);
    }
    return categorias
      .filter((c) => !!mapa[c])
      .map((c) => ({ categoria: c, pastas: Object.keys(mapa[c]).sort().map((p) => ({ pasta: p, imagens: mapa[c][p] })) }));
  }, [filtradas, categorias]);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-semibold">{titulo}</p>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={onFechar} aria-label="Fechar o acervo">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, pasta, descrição ou tag" className="h-9 pl-8 text-[12.5px]" />
      </div>
      {categorias.length > 1 && (
        <div className="flex flex-wrap">
          {["todas"].concat(categorias).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoria(c)}
              className={`mb-1.5 mr-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                categoria === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "todas" ? "Todas" : ROTULO_DA_CATEGORIA[c] || c}
            </button>
          ))}
        </div>
      )}
      {!buscando && lista.length > 0 && (
        <ExploradorDePastas<ImagemDoAcervo>
          pastas={espelho.pastas}
          itens={filtradas}
          pastaDoItem={(i) => pastaDaFoto(i, espelho.pastaDoNo)}
          atual={pastaAberta}
          onAtual={setPastaAberta}
          raizNome="Pastas"
          semArvore
          alturaMax="420px"
          carregando={arvore.isLoading}
          vazio="Nenhuma foto nesta pasta."
          renderizarItens={(itens) => <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{itens.map(cartao)}</ul>}
        />
      )}
      <div className={`space-y-4 overflow-y-auto pr-1 ${buscando || lista.length === 0 ? "max-h-[420px]" : "hidden"}`}>
        {acervo.isLoading && (
          <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Lendo o acervo…</p>
        )}
        {acervo.isError && <p className="rounded-lg bg-destructive/10 p-2.5 text-[12px]">{textoDoErro(acervo.error)}</p>}
        {acervo.data && lista.length === 0 && (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            O acervo deste cliente está vazio. Sincronize as imagens das pastas na aba Contexto.
          </p>
        )}
        {acervo.data && lista.length > 0 && filtradas.length === 0 && (
          <p className="text-[12px] text-muted-foreground">Nenhuma imagem com essa busca.</p>
        )}
        {buscando && grupos.map((g) => (
          <section key={g.categoria} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{ROTULO_DA_CATEGORIA[g.categoria] || g.categoria}</p>
            {g.pastas.map((p) => (
              <div key={p.pasta} className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{p.pasta}</p>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{p.imagens.map(cartao)}</ul>
              </div>
            ))}
          </section>
        ))}
        {buscando && filtradas.length > LIMITE_NA_TELA && (
          <p className="text-[11.5px] text-muted-foreground">
            Mostrando {LIMITE_NA_TELA} de {filtradas.length}. Refine a busca para achar mais rápido.
          </p>
        )}
      </div>
    </div>
  );
}
