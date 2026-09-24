import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Globe, Loader2, MoreHorizontal, Shuffle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import {
  chamarAds,
  chavesAds,
  CTAS_DO_META,
  formatoDe,
  LIMITE_DESCRICAO,
  LIMITE_TEXTO_VISIVEL,
  LIMITE_TITULO,
  mudarCriativo,
  partesDaCopy,
  rotuloDoCta,
  type CopyDoAnuncio,
  type CriativoAds,
} from "./adsApi";
import { Andamento, useAndamento } from "./Comuns";
import PacoteDaCopy from "./PacoteDaCopy";

/**
 * A copy do anúncio ao lado da arte: texto principal (o Meta mostra cerca de
 * 125 caracteres antes do "mais"), título até 40, descrição até 30 e o CTA
 * do Meta. Grava sozinha ao sair do campo (sem apagar o pacote gravado junto).
 * "Variar copy" pede variações rápidas; o pacote completo (PacoteDaCopy) traz
 * todos os estilos, títulos, descrições, CTAs, ganchos e a orientação ao
 * gestor, com "Usar" para trazer ao formulário. A prévia mostra o feed.
 */

const limpa = (c: CopyDoAnuncio): CopyDoAnuncio => ({
  texto_principal: c.texto_principal || "",
  texto_principal_longo: c.texto_principal_longo || "",
  titulo: c.titulo || "",
  descricao: c.descricao || "",
  cta_meta: c.cta_meta || "",
});

/** Contador de caracteres: passa do limite, fica em alerta. */
export function Contador({ atual, limite, rotulo }: { atual: number; limite: number; rotulo: string }) {
  const passou = atual > limite;
  return (
    <span className={`text-[11px] tabular-nums ${passou ? "font-medium text-warning" : "text-muted-foreground"}`} aria-label={`${rotulo}: ${atual} de ${limite}`} data-contador={rotulo}>
      {atual}/{limite}
      {passou ? " (corta no feed)" : ""}
    </span>
  );
}

/** Texto principal como aparece no feed: até o limite visível e o "... mais". */
export function textoVisivel(texto: string, limite = LIMITE_TEXTO_VISIVEL): { visivel: string; cortado: boolean } {
  const t = (texto || "").trim();
  if (t.length <= limite) return { visivel: t, cortado: false };
  const corte = t.slice(0, limite);
  const espaco = corte.lastIndexOf(" ");
  return { visivel: (espaco > limite * 0.6 ? corte.slice(0, espaco) : corte).trim(), cortado: true };
}

export function PreviaDoFeed({ copy, caminho, formato, nome }: { copy: CopyDoAnuncio; caminho: string | null; formato: string; nome: string }) {
  const f = formatoDe(formato);
  const { visivel, cortado } = textoVisivel(copy.texto_principal || "");
  // No feed, 9:16 aparece recortado em 4:5; o resto na própria proporção.
  const altura = f.valor === "stories_9x16" ? 125 : Math.round((f.altura / f.largura) * 100);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-foreground" aria-label="Prévia no feed">
      <div className="flex items-center px-3 py-2">
        <span className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-primary">
          {(nome || "?").trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold">{nome || "Cliente"}</span>
          <span className="flex items-center text-[11px] text-muted-foreground">Patrocinado <Globe className="ml-1 h-3 w-3" /></span>
        </span>
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="whitespace-pre-wrap px-3 pb-2 text-[12.5px] leading-snug [overflow-wrap:anywhere]">
        {visivel || <span className="text-muted-foreground">Texto principal</span>}
        {cortado && <span className="text-muted-foreground">… mais</span>}
      </p>
      <div className="relative w-full bg-secondary" style={{ paddingBottom: `${altura}%` }}>
        <div className="absolute inset-0">
          {caminho ? <ImagemDaMesa caminho={caminho} alt="Arte do anúncio" className="h-full w-full" /> : <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Arte ainda não gerada</div>}
        </div>
      </div>
      <div className="flex items-center bg-muted/60 px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold">{copy.titulo || <span className="font-normal text-muted-foreground">Título</span>}</span>
          {copy.descricao && <span className="block truncate text-[11px] text-muted-foreground">{copy.descricao}</span>}
        </span>
        <span className="ml-2 shrink-0 rounded-md bg-secondary px-2.5 py-1.5 text-[11.5px] font-medium">{rotuloDoCta(copy.cta_meta) || "CTA"}</span>
      </div>
    </div>
  );
}

export default function PainelDaCopy({ criativo, caminhoDaArte, nome }: { criativo: CriativoAds; caminhoDaArte: string | null; nome?: string }) {
  const { clientId, clientName, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [copy, setCopy] = useState<CopyDoAnuncio>(limpa(criativo.copy));
  const [salvando, setSalvando] = useState(false);
  const [pedido, setPedido] = useState("");
  const [variacoes, setVariacoes] = useState<CopyDoAnuncio[]>([]);
  const [desde, rodar] = useAndamento();
  const salvo = JSON.stringify(limpa(criativo.copy));

  useEffect(() => {
    setCopy(limpa(criativo.copy));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criativo.id, salvo]);
  useEffect(() => setVariacoes([]), [criativo.id]);

  const mudou = JSON.stringify(limpa(copy)) !== salvo;

  const salvar = async (silencioso = false) => {
    if (!mudou) return;
    setSalvando(true);
    try {
      // O pacote completo mora na mesma coluna: vai junto, intacto.
      const nova: CopyDoAnuncio = { ...criativo.copy, ...limpa(copy) };
      await mudarCriativo(criativo.id, { copy: nova });
      queryClient.setQueryData<CriativoAds[]>(chavesAds.criativos(clientId), (l) => (l || []).map((c) => (c.id === criativo.id ? { ...c, copy: nova } : c)));
      if (!silencioso) toast.success("Copy salva");
    } catch (e) {
      toast.error("Copy não salva", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const campo = (k: keyof CopyDoAnuncio, v: string) => setCopy((c) => ({ ...c, [k]: v }));
  const texto = copy.texto_principal || "";
  const titulo = copy.titulo || "";

  return (
    <div className="min-w-0 space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Copy do anúncio">
        <div className="flex items-center">
          <h3 className="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Copy do anúncio</h3>
          {salvando ? (
            <span className="inline-flex items-center text-[11px] text-muted-foreground"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> salvando</span>
          ) : mudou ? (
            <Button type="button" size="sm" className="h-7 px-2.5 text-[12px]" onClick={() => void salvar()}>Salvar copy</Button>
          ) : (
            <span className="inline-flex items-center text-[11px] text-muted-foreground"><Check className="mr-1 h-3 w-3 text-success" /> salva</span>
          )}
        </div>
        <label className="block">
          <span className="mb-1 flex items-center text-[11.5px] font-medium text-foreground/80">
            <span className="flex-1">Texto principal</span>
            <Contador atual={texto.length} limite={LIMITE_TEXTO_VISIVEL} rotulo="Texto principal" />
          </span>
          <Textarea aria-label="Texto principal" rows={4} className="text-[13px] leading-relaxed" value={texto} onChange={(e) => campo("texto_principal", e.target.value)} onBlur={() => void salvar(true)} />
          <span className="mt-1 block text-[11px] text-muted-foreground">Os primeiros {LIMITE_TEXTO_VISIVEL} caracteres aparecem sem o "mais": a promessa e o motivo para clicar vão aqui.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">Texto longo (opcional)</span>
          <Textarea aria-label="Texto principal longo" rows={3} className="text-[13px] leading-relaxed" value={copy.texto_principal_longo || ""} onChange={(e) => campo("texto_principal_longo", e.target.value)} onBlur={() => void salvar(true)} />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center text-[11.5px] font-medium text-foreground/80">
            <span className="flex-1">Título</span>
            <Contador atual={titulo.length} limite={LIMITE_TITULO} rotulo="Título" />
          </span>
          <Input aria-label="Título" className="h-9 text-[13px]" value={titulo} onChange={(e) => campo("titulo", e.target.value)} onBlur={() => void salvar(true)} />
        </label>
        <label className="block">
          <span className="mb-1 flex items-center text-[11.5px] font-medium text-foreground/80">
            <span className="flex-1">Descrição</span>
            <Contador atual={(copy.descricao || "").length} limite={LIMITE_DESCRICAO} rotulo="Descrição" />
          </span>
          <Input aria-label="Descrição" className="h-9 text-[13px]" value={copy.descricao || ""} onChange={(e) => campo("descricao", e.target.value)} onBlur={() => void salvar(true)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">Botão (CTA do Meta)</span>
          <select
            aria-label="CTA do Meta"
            value={copy.cta_meta || ""}
            onChange={(e) => setCopy((c) => ({ ...c, cta_meta: e.target.value }))}
            onBlur={() => void salvar(true)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
          >
            <option value="">Escolha o CTA</option>
            {CTAS_DO_META.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            {copy.cta_meta && !CTAS_DO_META.some((c) => c.valor === copy.cta_meta) && <option value={copy.cta_meta}>{copy.cta_meta}</option>}
          </select>
        </label>

        <div className="border-t border-border pt-3">
          <div className="flex min-w-0 items-center">
            <Input aria-label="Pedido para variar a copy" className="mr-2 h-9 min-w-0 flex-1 text-[12.5px]" value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Pedido opcional (tom, objeção, prova)" />
            <BotaoComCusto
              rotulo={<><Shuffle className="mr-1 h-3.5 w-3.5" /> Variar copy</>}
              titulo="Variar a copy"
              descricao="Variações de texto principal, título e CTA, conferidas pelo Jev (política e clareza)."
              variant="outline"
              className="h-9 shrink-0"
              partes={() => partesDaCopy(catalogo)}
              executar={() => rodar(() => chamarAds<any>("copy_variar", { criativo_id: criativo.id, pedido: pedido.trim() || undefined }))}
              aoConcluir={(data) => {
                const lista = Array.isArray(data?.variacoes) ? data.variacoes : Array.isArray(data) ? data : [];
                setVariacoes(lista.filter((v: unknown) => v && typeof v === "object"));
                setPedido("");
              }}
            />
          </div>
          <div className="mt-1"><Andamento desde={desde} rotulo="Escrevendo variações" /></div>
          {variacoes.length > 0 && (
            <ul className="mt-2 space-y-2" aria-label="Variações de copy">
              {variacoes.map((v, i) => (
                <li key={i} className="rounded-lg border border-border bg-background p-2.5">
                  <p className="whitespace-pre-wrap text-[12.5px] leading-snug [overflow-wrap:anywhere]">{v.texto_principal}</p>
                  {v.titulo && <p className="mt-1 text-[12px] font-semibold">{v.titulo}</p>}
                  <div className="mt-1.5 flex items-center">
                    <span className="flex-1 text-[11px] text-muted-foreground">{rotuloDoCta(v.cta_meta)}</span>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setCopy((c) => ({ ...c, ...limpaParcial(v) }))}>
                      Usar esta
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <PacoteDaCopy
        criativo={criativo}
        nome={nome || criativo.nome || "Criativo"}
        onUsar={(campos) => {
          setCopy((c) => ({ ...c, ...campos }));
          toast.info("Texto no formulário", { description: "Confira e salve a copy." });
        }}
      />

      <section aria-label="Como fica no feed">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Como fica no feed</h3>
        <PreviaDoFeed copy={copy} caminho={caminhoDaArte} formato={criativo.formato} nome={clientName} />
      </section>
    </div>
  );
}

/** Só os campos que a variação trouxe (não apaga o resto do formulário). */
function limpaParcial(v: CopyDoAnuncio): CopyDoAnuncio {
  const saida: CopyDoAnuncio = {};
  (["texto_principal", "texto_principal_longo", "titulo", "descricao", "cta_meta"] as (keyof CopyDoAnuncio)[]).forEach((k) => {
    if (typeof v[k] === "string" && (v[k] as string).trim()) saida[k] = v[k];
  });
  return saida;
}
