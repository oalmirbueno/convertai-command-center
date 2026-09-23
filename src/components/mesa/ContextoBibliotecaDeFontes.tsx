import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { textoDoErro } from "@/lib/mesa/api";
import { useUrlsAssinadas } from "./ContextoMiniatura";
import { useMesa } from "./MesaContexto";
import {
  caminhoDaFonteDaBiblioteca,
  chaveDasFontes,
  paresDaFonte,
  useBibliotecaDeFontes,
  useFontesDoCliente,
  useInvalidarContexto,
  type FonteDaBiblioteca,
  type FonteDoClienteLinha,
} from "./contextoDoCliente";

/**
 * Galeria da biblioteca de fontes da agência (fontes_biblioteca): busca,
 * filtro por categoria e a amostra de cada família, para escolher a fonte de
 * título e a de texto. Grava direto em cliente_fontes (RLS da equipe com
 * acesso ao cliente: inserir e apagar), trocando a linha antiga do papel.
 */

export type PapelDaEscolha = "titulo" | "texto";

const ROTULO_DO_PAPEL: Record<PapelDaEscolha, string> = { titulo: "Título", texto: "Texto" };
const POR_PAGINA = 24;

const semAcento = (t: string) =>
  (t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export interface TrocaDeFontes {
  inserir: {
    client_id: string;
    nome: string;
    papel: PapelDaEscolha;
    storage_path: string;
    amostra_path: string | null;
    biblioteca_id: string;
    origem: "biblioteca";
  }[];
  apagar: string[];
  /** Arquivos enviados (origem upload) que saem do Storage junto com a linha. */
  arquivosParaRemover: string[];
}

/**
 * O que muda em cliente_fontes para ficar com a escolha: a família nova entra
 * e a linha antiga daquele papel sai (qualquer origem). Papel sem mudança
 * não mexe em nada.
 */
export function planejarTrocaDeFontes(
  clientId: string,
  atuais: FonteDoClienteLinha[],
  escolha: Partial<Record<PapelDaEscolha, FonteDaBiblioteca>>,
): TrocaDeFontes {
  const plano: TrocaDeFontes = { inserir: [], apagar: [], arquivosParaRemover: [] };
  for (const papel of ["titulo", "texto"] as PapelDaEscolha[]) {
    const f = escolha[papel];
    if (!f) continue;
    const doPapel = atuais.filter((a) => a.papel === papel);
    if (doPapel.length === 1 && doPapel[0].biblioteca_id === f.id) continue;
    plano.inserir.push({
      client_id: clientId,
      nome: f.familia,
      papel,
      storage_path: caminhoDaFonteDaBiblioteca(f, papel),
      amostra_path: f.amostra_path,
      biblioteca_id: f.id,
      origem: "biblioteca",
    });
    for (const a of doPapel) {
      plano.apagar.push(a.id);
      if (a.origem === "upload") {
        if (a.storage_path) plano.arquivosParaRemover.push(a.storage_path);
        if (a.amostra_path) plano.arquivosParaRemover.push(a.amostra_path);
      }
    }
  }
  return plano;
}

/** Altura útil da janela (px), atualizada ao girar ou redimensionar (e com o teclado do celular). */
export function useAlturaDaJanela(): number {
  const ler = () => (typeof window === "undefined" ? 800 : window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 800);
  const [altura, setAltura] = useState(ler);
  useEffect(() => {
    const medir = () => setAltura(ler());
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, []);
  return altura;
}

/** Altura do pop-up: a janela menos uma margem, entre 320 e 900 px. */
export function alturaDoPopup(alturaDaJanela: number): number {
  const margem = alturaDaJanela < 600 ? 16 : 48;
  return Math.max(320, Math.min(900, Math.round(alturaDaJanela - margem)));
}

function CartaoDaFamilia({
  f,
  url,
  marcadoComo,
  sugerida,
  onEscolher,
}: {
  f: FonteDaBiblioteca;
  url: string | undefined;
  marcadoComo: PapelDaEscolha[];
  sugerida: boolean;
  onEscolher: () => void;
}) {
  const marcado = marcadoComo.length > 0;
  return (
    <button
      type="button"
      onClick={onEscolher}
      aria-pressed={marcado}
      title={f.familia}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors ${
        marcado ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/60"
      }`}
    >
      <span className="flex h-24 w-full items-center justify-center overflow-hidden border-b border-border bg-white px-3 sm:h-28">
        {f.amostra_path ? (
          url ? (
            <img src={url} alt={`Amostra da fonte ${f.familia}`} loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="block h-full w-full animate-pulse bg-neutral-100" aria-hidden="true" />
          )
        ) : (
          <span className="text-[11px] text-neutral-500">Sem amostra</span>
        )}
      </span>
      <span className="block min-w-0 px-2.5 pb-2 pt-1.5">
        <span className="flex min-w-0 items-center">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{f.familia}</span>
          {sugerida && !marcado && (
            <span className="ml-1.5 shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">par sugerido</span>
          )}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {[f.categoria, f.personalidade.slice(0, 2).join(", ")].filter(Boolean).join(" · ") || "Sem categoria"}
        </span>
      </span>
      {marcado && (
        <span className="absolute right-1.5 top-1.5 flex items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
          <Check className="mr-0.5 h-3 w-3" />
          {marcadoComo.map((p) => ROTULO_DO_PAPEL[p]).join(" e ")}
        </span>
      )}
    </button>
  );
}

export default function BibliotecaDeFontes({
  aberto,
  onOpenChange,
  papelInicial,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  papelInicial?: PapelDaEscolha;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const invalidar = useInvalidarContexto();
  const biblioteca = useBibliotecaDeFontes(aberto);
  const atuais = useFontesDoCliente(clientId);
  const [papel, setPapel] = useState<PapelDaEscolha>(papelInicial || "titulo");
  const [escolha, setEscolha] = useState<Partial<Record<PapelDaEscolha, FonteDaBiblioteca>>>({});
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("todas");
  const [limite, setLimite] = useState(POR_PAGINA);
  const [salvando, setSalvando] = useState(false);
  const alturaDaJanela = useAlturaDaJanela();
  const alturaMaxima = alturaDoPopup(alturaDaJanela);
  // Tela baixa (celular deitado, notebook com zoom): a descrição sai para a lista ter espaço.
  const baixa = alturaDaJanela < 620;

  const familias = useMemo(() => (biblioteca.data || []).filter((f) => f.suporta_portugues), [biblioteca.data]);

  // Ao abrir: parte do que o cliente já usa da biblioteca.
  useEffect(() => {
    if (!aberto) return;
    const inicial: Partial<Record<PapelDaEscolha, FonteDaBiblioteca>> = {};
    for (const p of ["titulo", "texto"] as PapelDaEscolha[]) {
      const linha = (atuais.data || []).find((a) => a.papel === p && a.biblioteca_id);
      const f = linha ? familias.find((x) => x.id === linha.biblioteca_id) : undefined;
      if (f) inicial[p] = f;
    }
    setEscolha(inicial);
    setPapel(papelInicial || (inicial.titulo ? "texto" : "titulo"));
    setBusca("");
    setCategoria("todas");
    setLimite(POR_PAGINA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, familias.length, atuais.data]);

  const categorias = useMemo(() => {
    const contagem: Record<string, number> = {};
    for (const f of familias) {
      const c = (f.categoria || "").trim();
      if (c) contagem[c] = (contagem[c] || 0) + 1;
    }
    return Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a] || a.localeCompare(b, "pt-BR"));
  }, [familias]);

  const outra = escolha[papel === "titulo" ? "texto" : "titulo"];
  const pares = paresDaFonte(outra);
  const termo = semAcento(busca.trim());

  const filtradas = useMemo(() => {
    const base = familias.filter((f) => {
      if (categoria !== "todas" && (f.categoria || "") !== categoria) return false;
      if (!termo) return true;
      return semAcento([f.familia, f.categoria || "", f.personalidade.join(" "), f.usos.join(" "), f.nichos.join(" ")].join(" ")).indexOf(termo) >= 0;
    });
    if (!pares.length) return base;
    // Pares sugeridos pela biblioteca para a fonte já escolhida vêm primeiro.
    const sugeridas = base.filter((f) => pares.indexOf(f.familia.toLowerCase()) >= 0);
    const demais = base.filter((f) => pares.indexOf(f.familia.toLowerCase()) < 0);
    return sugeridas.concat(demais);
  }, [familias, categoria, termo, pares]);

  const visiveis = filtradas.slice(0, limite);
  const amostras = useUrlsAssinadas("mesa", visiveis.map((f) => f.amostra_path || "").filter(Boolean));

  const plano = planejarTrocaDeFontes(clientId, atuais.data || [], escolha);
  const substituiEnviada = (atuais.data || []).filter(
    (a) => a.origem === "upload" && plano.apagar.indexOf(a.id) >= 0,
  );

  const escolher = (f: FonteDaBiblioteca) => {
    setEscolha((e) => ({ ...e, [papel]: f }));
    // Escolheu o título: passa para o texto, se ainda não tem.
    if (papel === "titulo" && !escolha.texto) setPapel("texto");
  };

  const salvar = async () => {
    if (!plano.inserir.length) {
      onOpenChange(false);
      return;
    }
    setSalvando(true);
    try {
      // Primeiro entra a nova; só depois sai a antiga (sem ficar sem fonte se falhar).
      const { error } = await (supabase as any).from("cliente_fontes").insert(plano.inserir);
      if (error) throw error;
      if (plano.apagar.length) {
        const { error: erroApagar } = await (supabase as any).from("cliente_fontes").delete().in("id", plano.apagar);
        if (erroApagar) throw erroApagar;
      }
      if (plano.arquivosParaRemover.length) {
        await supabase.storage.from("mesa").remove(plano.arquivosParaRemover).catch(() => null);
      }
      toast.success("Fontes da biblioteca definidas", {
        description: plano.inserir.map((l) => `${ROTULO_DO_PAPEL[l.papel]}: ${l.nome}`).join(". "),
      });
      void queryClient.invalidateQueries({ queryKey: chaveDasFontes(clientId) });
      invalidar(clientId);
      onOpenChange(false);
    } catch (e) {
      toast.error("Fontes não gravadas", { description: textoDoErro(e) });
      void queryClient.invalidateQueries({ queryKey: chaveDasFontes(clientId) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!salvando) onOpenChange(v); }}>
      <DialogContent
        // Cabe em qualquer tela (360 a 1920 px de largura, notebook de 768 px
        // de altura): a altura vem da janela medida, cabeçalho e rodapé ficam
        // fixos e só a lista rola por dentro.
        style={{ maxHeight: alturaMaxima, height: alturaMaxima }}
        className="flex w-[calc(100vw-16px)] max-w-5xl flex-col gap-0 overflow-hidden bg-background p-0 sm:w-[calc(100vw-48px)]"
      >
        <div className="shrink-0 space-y-2.5 border-b border-border px-3.5 pb-3 pt-3.5 sm:px-5 sm:pt-4">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-[15px] sm:text-lg">Biblioteca de fontes da agência</DialogTitle>
            <DialogDescription className={`text-[12px] sm:text-[12.5px] ${baixa ? "sr-only" : ""}`}>
              Escolha a fonte de título e a de texto. A amostra mostra a família com os acentos do português.
            </DialogDescription>
          </DialogHeader>

          <div role="tablist" aria-label="Qual fonte escolher" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            {(["titulo", "texto"] as PapelDaEscolha[]).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={papel === p}
                onClick={() => setPapel(p)}
                className={`min-w-0 rounded-lg px-2.5 py-1 text-left ${papel === p ? "bg-card shadow-sm" : "hover:bg-card/60"}`}
              >
                <span className="block text-[10.5px] uppercase tracking-wider text-muted-foreground">{ROTULO_DO_PAPEL[p]}</span>
                <span className={`block truncate text-[12.5px] font-medium ${escolha[p] ? "text-foreground" : "text-muted-foreground"}`}>
                  {escolha[p] ? escolha[p]!.familia : "Escolher na galeria"}
                </span>
              </button>
            ))}
          </div>

          <div className="flex min-w-0 items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setLimite(POR_PAGINA);
                }}
                placeholder="Buscar por nome, estilo, uso ou nicho"
                aria-label="Buscar fonte"
                className="h-9 pl-8"
              />
            </div>
            <p className="ml-2.5 shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
              {biblioteca.isLoading ? "Lendo..." : `${filtradas.length} de ${familias.length}`}
            </p>
          </div>

          {categorias.length > 0 && (
            <div className="-mx-1 flex min-w-0 overflow-x-auto px-1 pb-0.5" aria-label="Categorias">
              {["todas"].concat(categorias).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCategoria(c);
                    setLimite(POR_PAGINA);
                  }}
                  aria-pressed={categoria === c}
                  className={`mr-1.5 shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] capitalize ${
                    categoria === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c === "todas" ? "Todas" : c}
                </button>
              ))}
            </div>
          )}
        </div>

        <div data-lista-de-fontes className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3 sm:px-5">
          {biblioteca.isError && <p className="text-[12.5px] text-destructive">Não foi possível ler a biblioteca de fontes: {textoDoErro(biblioteca.error)}</p>}
          {biblioteca.isLoading && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[158px] animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          )}
          {biblioteca.data && filtradas.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
              {familias.length ? "Nenhuma família com essa busca." : "A biblioteca de fontes ainda está vazia."}
            </p>
          )}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {visiveis.map((f) => {
              const marcadoComo = (["titulo", "texto"] as PapelDaEscolha[]).filter((p) => escolha[p] && escolha[p]!.id === f.id);
              return (
                <CartaoDaFamilia
                  key={f.id}
                  f={f}
                  url={f.amostra_path ? (amostras.data || {})[f.amostra_path] : undefined}
                  marcadoComo={marcadoComo}
                  sugerida={pares.indexOf(f.familia.toLowerCase()) >= 0}
                  onEscolher={() => escolher(f)}
                />
              );
            })}
          </div>
          {filtradas.length > visiveis.length && (
            <div className="mt-3 flex justify-center">
              <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                Mostrar mais {Math.min(POR_PAGINA, filtradas.length - visiveis.length)}
              </Button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col border-t border-border bg-background px-3.5 py-2.5 sm:flex-row sm:items-center sm:px-5 sm:py-3">
          <p className="line-clamp-2 min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere] sm:mr-3">
            {substituiEnviada.length
              ? `Substitui a fonte enviada ${substituiEnviada.map((a) => a.nome).join(" e ")}.`
              : plano.inserir.length
                ? "A fonte antiga do mesmo papel sai do kit do cliente."
                : "Clique numa família para escolher a fonte do papel marcado acima."}
          </p>
          <div className="mt-2 flex justify-end sm:mt-0">
            <Button type="button" variant="ghost" className="mr-2 h-9" onClick={() => onOpenChange(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="button" className="h-9" onClick={() => void salvar()} disabled={salvando || plano.inserir.length === 0}>
              {salvando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Usar estas fontes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
