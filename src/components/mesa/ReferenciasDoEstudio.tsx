import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import type { CardDaDirecao, Trabalho } from "./useItensDoMes";

/**
 * Referências no Estúdio (aba do inspetor): as do cliente (ativas e já
 * lidas, com o papel identidade ou técnica) e o banco da agência
 * (referencias_globais, mais de 1.300, com busca, tags e páginas de 24). A
 * escolha vale para o conjunto ou só para a lâmina selecionada (sobrepõe as
 * do conjunto) e vai para o estúdio pelo "configurar", sem custo. Id do banco
 * da agência leva "g:".
 *
 * Clicar na imagem abre grande (Ampliar); o botão embaixo usa ou tira.
 */

export type AlvoDasReferencias = "conjunto" | "lamina";
type AbaDasReferencias = "cliente" | "banco";

interface RefDoCliente {
  id: string;
  papel: "identidade" | "tecnica" | null;
  origem: string | null;
  storage_path: string | null;
  leitura: string | null;
  tags: string[] | null;
}

interface RefGlobal {
  id: string;
  titulo: string | null;
  leitura: string | null;
  tags: string[] | null;
  storage_path: string | null;
}

const POR_PAGINA = 24;
const PREFIXO_GLOBAL = "g:";

const ROTULO_DO_PAPEL: Record<string, string> = { identidade: "identidade", tecnica: "técnica" };

const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.indexOf(x) >= 0);

/** Tira da busca o que quebra o filtro do PostgREST (vírgula, parênteses, curingas). */
function limparBusca(t: string): string {
  let saida = "";
  const proibidos = ",()*%{}\"\\:";
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    saida += proibidos.indexOf(c) >= 0 ? " " : c;
  }
  return saida.split(" ").filter(Boolean).join(" ").trim();
}

function useAtraso<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const id = window.setTimeout(() => setV(valor), ms);
    return () => window.clearTimeout(id);
  }, [valor, ms]);
  return v;
}

/** Referência: a imagem abre grande; o botão embaixo usa ou tira (sem nada por cima da imagem). */
function Miniatura({
  caminho,
  alt,
  marcada,
  onAmpliar,
  onAlternar,
  legenda,
}: {
  caminho: string | null;
  alt: string;
  marcada: boolean;
  onAmpliar: () => void;
  onAlternar: () => void;
  legenda?: string | null;
}) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onAmpliar}
        title={legenda || "Ver grande"}
        aria-label={`${alt}: ver grande`}
        className={`relative block w-full cursor-zoom-in overflow-hidden rounded-md border-2 bg-secondary transition-colors ${marcada ? "border-primary" : "border-transparent hover:border-primary/40"}`}
        style={{ paddingBottom: "125%" }}
      >
        <ImagemDaMesa caminho={caminho} alt={alt} className="absolute inset-0 h-full w-full" />
      </button>
      <button
        type="button"
        onClick={onAlternar}
        aria-pressed={marcada}
        className={`mt-1 flex h-8 w-full items-center justify-center rounded-md border text-[11.5px] font-medium transition-colors ${
          marcada ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`}
      >
        {marcada ? <><Check className="mr-1 h-3.5 w-3.5" /> Em uso</> : <><Plus className="mr-1 h-3.5 w-3.5" /> Usar</>}
      </button>
    </div>
  );
}

export default function ReferenciasDoEstudio({
  trabalho,
  cardSelecionado,
  alvo,
  onAlvo,
  aba,
  onAba,
  onAtualizar,
}: {
  trabalho: Trabalho;
  cardSelecionado: CardDaDirecao | null;
  alvo: AlvoDasReferencias;
  onAlvo: (a: AlvoDasReferencias) => void;
  aba: AbaDasReferencias;
  onAba: (a: AbaDasReferencias) => void;
  onAtualizar: () => void;
}) {
  const { clientId } = useMesa();
  const [busca, setBusca] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const [rascunho, setRascunho] = useState<string[] | null>(null);
  const [salvando, setSalvando] = useState(0);
  const [ampliada, setAmpliada] = useState<{ lista: ImagemAmpliavel[]; indice: number } | null>(null);
  const fila = useRef<Promise<void>>(Promise.resolve());
  const buscaAtrasada = useAtraso(limparBusca(busca), 350);

  const alvoReal: AlvoDasReferencias = alvo === "lamina" && cardSelecionado ? "lamina" : "conjunto";
  const doConjunto = trabalho.direcao?.referencias_ids || [];
  const daLamina = cardSelecionado?.referencias_ids || [];
  const atual = alvoReal === "lamina" ? daLamina : doConjunto;
  const escolhidas = rascunho || atual;

  // O banco já tem a escolha: o rascunho sai de cena.
  useEffect(() => {
    if (rascunho && iguais(rascunho, atual)) setRascunho(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual.join("|")]);
  useEffect(() => { setRascunho(null); }, [alvoReal, cardSelecionado?.ordem]);
  useEffect(() => { setPagina(0); }, [buscaAtrasada, tag]);

  const doCliente = useQuery({
    queryKey: ["mesa", "referencias", clientId, "estudio"],
    queryFn: async (): Promise<RefDoCliente[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_referencias")
        .select("id, papel, origem, storage_path, leitura, tags")
        .eq("client_id", clientId)
        .eq("ativa", true)
        .not("leitura", "is", null)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return (data || []) as RefDoCliente[];
    },
  });

  const tagsDoBanco = useQuery({
    queryKey: ["mesa", "refs-globais", "tags"],
    enabled: aba === "banco",
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as any).from("referencias_globais").select("tags").eq("ativa", true).limit(2000);
      if (error) throw error;
      const conta: Record<string, number> = {};
      for (const r of (data || []) as { tags: string[] | null }[]) {
        for (const t of r.tags || []) {
          const k = String(t || "").trim();
          if (k) conta[k] = (conta[k] || 0) + 1;
        }
      }
      return Object.keys(conta).sort((a, b) => conta[b] - conta[a]).slice(0, 18);
    },
  });

  const banco = useQuery({
    queryKey: ["mesa", "refs-globais", "pagina", buscaAtrasada, tag || "", pagina],
    enabled: aba === "banco",
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ lista: RefGlobal[]; total: number }> => {
      let q = (supabase as any)
        .from("referencias_globais")
        .select("id, titulo, leitura, tags, storage_path", { count: "exact" })
        .eq("ativa", true);
      if (buscaAtrasada) {
        const termo = `*${buscaAtrasada}*`;
        const partes = [`titulo.ilike.${termo}`, `leitura.ilike.${termo}`];
        if (buscaAtrasada.indexOf(" ") < 0) partes.push(`tags.cs.{${buscaAtrasada}}`);
        q = q.or(partes.join(","));
      }
      if (tag) q = q.contains("tags", [tag]);
      const { data, error, count } = await q
        .order("criado_em", { ascending: false })
        .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      if (error) throw error;
      return { lista: (data || []) as RefGlobal[], total: Number(count || 0) };
    },
  });

  // Miniaturas das escolhidas que vêm do banco da agência.
  const idsGlobais = escolhidas.filter((id) => id.indexOf(PREFIXO_GLOBAL) === 0).map((id) => id.slice(PREFIXO_GLOBAL.length));
  const globaisEscolhidas = useQuery({
    queryKey: ["mesa", "refs-globais", "escolhidas", idsGlobais.slice().sort().join(",")],
    enabled: idsGlobais.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<RefGlobal[]> => {
      const { data, error } = await (supabase as any)
        .from("referencias_globais")
        .select("id, titulo, leitura, tags, storage_path")
        .in("id", idsGlobais);
      if (error) throw error;
      return (data || []) as RefGlobal[];
    },
  });

  const miniaturaDe = (id: string): { caminho: string | null; nome: string } => {
    if (id.indexOf(PREFIXO_GLOBAL) === 0) {
      const g = (globaisEscolhidas.data || []).find((r) => r.id === id.slice(PREFIXO_GLOBAL.length));
      return { caminho: g ? g.storage_path : null, nome: (g && g.titulo) || "Banco da agência" };
    }
    const c = (doCliente.data || []).find((r) => r.id === id);
    return { caminho: c ? c.storage_path : null, nome: c && c.papel ? `Cliente, ${ROTULO_DO_PAPEL[c.papel] || c.papel}` : "Do cliente" };
  };

  /** Grava a lista inteira; as gravações seguem em fila, a última vence. */
  const gravar = (lista: string[]) => {
    setRascunho(lista);
    const alvoDaVez = alvoReal;
    const ordem = cardSelecionado ? cardSelecionado.ordem : null;
    setSalvando((n) => n + 1);
    fila.current = fila.current.then(async () => {
      try {
        await chamarFuncao("estudio-arte", {
          acao: "configurar",
          trabalho_id: trabalho.id,
          ...(alvoDaVez === "lamina" && ordem !== null
            ? { card: { ordem, referencias_ids: lista } }
            : { conjunto: { referencias_ids: lista } }),
        });
        onAtualizar();
      } catch (e) {
        setRascunho(null);
        toast.error("Referências não salvas", { description: textoDoErro(e) });
      } finally {
        setSalvando((n) => n - 1);
      }
    });
  };

  const alternar = (id: string) => {
    const tem = escolhidas.indexOf(id) >= 0;
    gravar(tem ? escolhidas.filter((x) => x !== id) : escolhidas.concat([id]));
  };

  const clientes = doCliente.data || [];
  const totalBanco = banco.data ? banco.data.total : 0;
  const paginas = Math.max(1, Math.ceil(totalBanco / POR_PAGINA));
  const listaDoBanco = banco.data ? banco.data.lista : [];

  const ampliar = (lista: { caminho: string | null; titulo?: string; legenda?: string | null }[], indice: number) => {
    const validas = lista.filter((l) => !!l.caminho);
    const alvoDoClique = lista[indice];
    const i = alvoDoClique ? validas.indexOf(alvoDoClique) : -1;
    if (i < 0) return;
    setAmpliada({ lista: validas.map((l) => ({ caminho: l.caminho as string, titulo: l.titulo, legenda: l.legenda || undefined })), indice: i });
  };

  const resumo = useMemo(() => {
    if (alvoReal === "lamina") {
      return daLamina.length
        ? `A lâmina ${cardSelecionado?.ordem} usa só estas, no lugar das do conjunto.`
        : `A lâmina ${cardSelecionado?.ordem} usa as do conjunto. Escolha aqui para ela ter as próprias.`;
    }
    return doConjunto.length
      ? "O diretor e o gerador priorizam estas em todas as lâminas."
      : "Nenhuma escolhida: o estúdio escolhe sozinho entre as do cliente.";
  }, [alvoReal, daLamina.length, doConjunto.length, cardSelecionado?.ordem]);

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-1">
        <button
          type="button"
          onClick={() => onAlvo("conjunto")}
          aria-pressed={alvoReal === "conjunto"}
          className={`h-8 min-w-0 truncate rounded-md px-2 text-[12px] transition-colors ${alvoReal === "conjunto" ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Conjunto ({doConjunto.length})
        </button>
        <button
          type="button"
          onClick={() => onAlvo("lamina")}
          disabled={!cardSelecionado}
          aria-pressed={alvoReal === "lamina"}
          className={`h-8 min-w-0 truncate rounded-md px-2 text-[12px] transition-colors disabled:opacity-50 ${alvoReal === "lamina" ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {cardSelecionado ? `Só a lâmina ${cardSelecionado.ordem} (${daLamina.length})` : "Só uma lâmina"}
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex min-w-0 items-start">
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">{resumo}</p>
          {salvando > 0 && <Loader2 className="ml-2 mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          {alvoReal === "lamina" && daLamina.length > 0 && (
            <Button type="button" size="sm" variant="ghost" className="ml-1 h-7 shrink-0 px-2 text-[11.5px]" onClick={() => gravar([])}>
              Usar as do conjunto
            </Button>
          )}
        </div>
        {escolhidas.length > 0 && (
          <ul className="grid grid-cols-5 gap-1.5">
            {escolhidas.map((id, i) => {
              const m = miniaturaDe(id);
              return (
                <li key={id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => ampliar(escolhidas.map((x) => { const mm = miniaturaDe(x); return { caminho: mm.caminho, titulo: mm.nome }; }), i)}
                    className="relative block w-full cursor-zoom-in overflow-hidden rounded-md border border-border bg-secondary"
                    style={{ paddingBottom: "125%" }}
                    aria-label={`${m.nome}: ver grande`}
                  >
                    <ImagemDaMesa caminho={m.caminho} alt={m.nome} className="absolute inset-0 h-full w-full" />
                  </button>
                  <button
                    type="button"
                    onClick={() => alternar(id)}
                    className="mt-1 flex h-7 w-full items-center justify-center rounded-md border border-border bg-background text-[10.5px] text-muted-foreground hover:text-destructive"
                    aria-label="Tirar esta referência"
                    title="Tirar"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex border-b border-border">
        {([
          { valor: "cliente", rotulo: `Do cliente (${clientes.length})` },
          { valor: "banco", rotulo: `Agência${banco.data ? ` (${totalBanco.toLocaleString("pt-BR")})` : ""}` },
        ] as { valor: AbaDasReferencias; rotulo: string }[]).map((a) => (
          <button
            key={a.valor}
            type="button"
            onClick={() => onAba(a.valor)}
            className={`-mb-px mr-4 h-9 border-b-2 text-[12.5px] transition-colors ${aba === a.valor ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === "cliente" && (
        <div className="space-y-3">
          {doCliente.isLoading && <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Lendo as referências…</p>}
          {doCliente.isError && <p className="rounded-lg bg-destructive/10 p-2.5 text-[12px]">{textoDoErro(doCliente.error)}</p>}
          {doCliente.data && clientes.length === 0 && (
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Nenhuma referência do cliente com leitura. Traga e leia referências na aba Contexto, ou escolha no banco da agência.
            </p>
          )}
          <ul className="grid grid-cols-3 gap-2.5">
            {clientes.map((r, i) => (
              <li key={r.id} className="min-w-0">
                <Miniatura
                  caminho={r.storage_path}
                  alt="Referência do cliente"
                  legenda={r.leitura}
                  marcada={escolhidas.indexOf(r.id) >= 0}
                  onAmpliar={() => ampliar(clientes.map((c) => ({ caminho: c.storage_path, titulo: `Cliente, ${ROTULO_DO_PAPEL[c.papel || "tecnica"] || c.papel}`, legenda: c.leitura })), i)}
                  onAlternar={() => alternar(r.id)}
                />
                <span className={`mt-1 inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${r.papel === "identidade" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"}`}>
                  {ROTULO_DO_PAPEL[r.papel || "tecnica"] || r.papel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {aba === "banco" && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no título, na leitura ou nas tags" className="h-9 pl-8 text-[12.5px]" />
          </div>
          {(tagsDoBanco.data || []).length > 0 && (
            <div className="flex flex-wrap">
              {(tagsDoBanco.data || []).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTag(tag === t ? null : t)}
                  className={`mb-1.5 mr-1.5 max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    tag === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {banco.isLoading && <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Buscando…</p>}
          {banco.isError && <p className="rounded-lg bg-destructive/10 p-2.5 text-[12px]">{textoDoErro(banco.error)}</p>}
          {banco.data && listaDoBanco.length === 0 && <p className="text-[12px] text-muted-foreground">Nada encontrado com essa busca.</p>}
          <ul className={`grid grid-cols-3 gap-2.5 ${banco.isFetching && !banco.isLoading ? "opacity-70" : ""}`}>
            {listaDoBanco.map((r, i) => {
              const id = PREFIXO_GLOBAL + r.id;
              return (
                <li key={r.id} className="min-w-0">
                  <Miniatura
                    caminho={r.storage_path}
                    alt={r.titulo || "Referência do banco"}
                    legenda={r.leitura || r.titulo}
                    marcada={escolhidas.indexOf(id) >= 0}
                    onAmpliar={() => ampliar(listaDoBanco.map((g) => ({ caminho: g.storage_path, titulo: g.titulo || "Banco da agência", legenda: g.leitura })), i)}
                    onAlternar={() => alternar(id)}
                  />
                </li>
              );
            })}
          </ul>
          {totalBanco > POR_PAGINA && (
            <div className="flex items-center justify-between pt-1">
              <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(0, p - 1))} aria-label="Página anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-[12px] text-muted-foreground">Página {pagina + 1} de {paginas}</span>
              <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <Ampliar imagens={ampliada ? ampliada.lista : []} indice={ampliada ? ampliada.indice : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}
