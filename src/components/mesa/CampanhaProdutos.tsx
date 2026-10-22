import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Pencil, Plus, Star, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import type { Campanha, ProdutoDaCampanha } from "./mesaV4Api";
import { campanhaSalvar, normalizarBriefing, normalizarImagensDaCampanha, subirFotoDoProduto, trocarCampanhaNoCache } from "./campanhasApi";

/**
 * Produtos da campanha (22/10/2026, dono: "colocar produto pra vender: eu subo a imagem do produto, coloco nome
 * etc."): foto (enviada ou uma das imagens da campanha, do acervo), nome, preço, preço promocional, link e
 * destaque. O produto entra no briefing e nas peças: a foto real vai INTEIRA como referência ao gerador (fiel,
 * sem colagem) e o preço só aparece se a equipe informar. Sem custo (campanha_salvar).
 */

const vazio = (): ProdutoDaCampanha => ({ nome: "", por_que: "" });

function FotoDoProduto({ p, tamanho = "h-14 w-14" }: { p: ProdutoDaCampanha; tamanho?: string }) {
  if (p.caminho) return <ImagemDaMesa caminho={p.caminho} alt={`Foto de ${p.nome}`} className={juntar(tamanho, "shrink-0 rounded-md")} />;
  if (p.imagem_id) return <span className={juntar(tamanho, "flex shrink-0 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground")}>acervo</span>;
  return <span className={juntar(tamanho, "flex shrink-0 items-center justify-center rounded-md bg-muted")} aria-hidden="true"><ImagePlus className="h-4 w-4 text-muted-foreground" /></span>;
}

export default function CampanhaProdutos({ campanha }: { campanha: Campanha }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const briefing = normalizarBriefing(campanha.briefing);
  const produtos = briefing.produtos;
  const [editando, setEditando] = useState<number | null>(null);
  const [rascunho, setRascunho] = useState<ProdutoDaCampanha>(vazio);
  const [salvando, setSalvando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  const imagensDaCampanha = normalizarImagensDaCampanha(campanha.imagens);

  const gravar = async (lista: ProdutoDaCampanha[]) => {
    setSalvando(true);
    try {
      const r = await campanhaSalvar({ campanhaId: campanha.id, briefing: { ...briefing, produtos: lista } });
      if (r && r.campanha) trocarCampanhaNoCache(qc, clientId, r.campanha);
      setEditando(null);
    } catch (e) {
      toast.error("Produtos não salvos", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const abrir = (i: number | null) => {
    setRascunho(i === null ? vazio() : { ...produtos[i] });
    setEditando(i === null ? -1 : i);
  };

  const salvarRascunho = () => {
    if (!rascunho.nome.trim()) return;
    const lista = produtos.slice();
    const limpo = { ...rascunho, nome: rascunho.nome.trim() };
    if (editando !== null && editando >= 0) lista[editando] = limpo;
    else lista.push(limpo);
    // Um destaque só: marcar um tira o dos outros.
    void gravar(limpo.destaque ? lista.map((p) => (p === limpo ? p : { ...p, destaque: false })) : lista);
  };

  const subir = async (f: File | undefined) => {
    if (!f) return;
    setSalvando(true);
    try {
      const caminho = await subirFotoDoProduto(clientId, campanha.id, f);
      setRascunho((r) => ({ ...r, caminho, imagem_id: undefined }));
    } catch (e) {
      toast.error("A foto não subiu", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-w-0" data-produtos-da-campanha="">
      {produtos.length === 0 && editando === null && <p className={texto.auxiliar}>Nenhum produto ainda.</p>}
      <ul className="min-w-0 space-y-2" aria-label="Produtos da campanha">
        {produtos.map((p, i) => (
          <li key={`${p.nome}-${i}`} className="flex min-w-0 items-center" data-produto={p.nome}>
            <FotoDoProduto p={p} />
            <span className="ml-3 min-w-0 flex-1">
              <span className="flex min-w-0 items-center text-[13px] font-medium">
                <span className="truncate">{p.nome}</span>
                {p.destaque && <Star className="ml-1 h-3.5 w-3.5 shrink-0 text-warning" aria-label="Em destaque" />}
              </span>
              <span className={juntar(texto.auxiliar, "block truncate")}>
                {[p.preco ? `de ${p.preco}` : "", p.preco_promocional ? `por ${p.preco_promocional}` : "", p.link ? "com link" : ""].filter(Boolean).join(" · ") || "sem preço informado"}
              </span>
            </span>
            <button type="button" className={botao.icone} onClick={() => abrir(i)} aria-label={`Editar ${p.nome}`} title={`Editar ${p.nome}`} disabled={salvando}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={botao.icone} onClick={() => void gravar(produtos.filter((_, k) => k !== i))} aria-label={`Tirar ${p.nome}`} title={`Tirar ${p.nome} da campanha`} disabled={salvando}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      {editando !== null ? (
        <div className="mt-3 min-w-0 space-y-2.5 rounded-md bg-muted/50 p-3" data-editor-do-produto="">
          <div className="flex min-w-0 items-center">
            <FotoDoProduto p={rascunho} />
            <input ref={arquivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void subir(e.target.files ? e.target.files[0] : undefined)} data-testid="foto-do-produto" />
            <button type="button" className={juntar(botao.icone, "ml-2")} onClick={() => arquivo.current && arquivo.current.click()} disabled={salvando} aria-label="Enviar a foto do produto" title="Enviar a foto do produto (vai como referência ao gerador, fiel e sem colagem)">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
            </button>
            {imagensDaCampanha.length > 0 && (
              <select
                className="ml-2 h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[12px]"
                value={rascunho.imagem_id || ""}
                onChange={(e) => setRascunho((r) => ({ ...r, imagem_id: e.target.value || undefined, caminho: e.target.value ? undefined : r.caminho }))}
                aria-label="Foto do acervo (imagens da campanha)"
              >
                <option value="">Foto do acervo…</option>
                {imagensDaCampanha.map((im, k) => <option key={im.imagem_id} value={im.imagem_id}>{`Imagem ${k + 1}${im.nota ? `: ${im.nota.slice(0, 30)}` : ""}`}</option>)}
              </select>
            )}
          </div>
          <Input value={rascunho.nome} onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))} placeholder="Nome (ex.: Elixir de desempenho)" aria-label="Nome do produto" className="h-8 text-[13px]" />
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Input value={rascunho.preco || ""} onChange={(e) => setRascunho((r) => ({ ...r, preco: e.target.value }))} placeholder="Preço (R$ 129)" aria-label="Preço" className="h-8 text-[13px]" />
            <Input value={rascunho.preco_promocional || ""} onChange={(e) => setRascunho((r) => ({ ...r, preco_promocional: e.target.value }))} placeholder="Promocional (R$ 89)" aria-label="Preço promocional" className="h-8 text-[13px]" />
          </div>
          <Input value={rascunho.link || ""} onChange={(e) => setRascunho((r) => ({ ...r, link: e.target.value }))} placeholder="Link (https://…)" aria-label="Link do produto" className="h-8 text-[13px]" />
          <Input value={rascunho.por_que} onChange={(e) => setRascunho((r) => ({ ...r, por_que: e.target.value }))} placeholder="Por que este produto nesta campanha" aria-label="Por que o produto" className="h-8 text-[13px]" />
          <div className="flex min-w-0 items-center">
            <label className="mr-auto inline-flex items-center text-[12px]">
              <input type="checkbox" className="mr-1.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={!!rascunho.destaque} onChange={(e) => setRascunho((r) => ({ ...r, destaque: e.target.checked }))} />
              Destaque da campanha
            </label>
            <button type="button" className={botao.icone} onClick={() => setEditando(null)} disabled={salvando} aria-label="Cancelar" title="Cancelar">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={juntar(botao.icone, "text-primary hover:text-primary")} onClick={salvarRascunho} disabled={salvando || !rascunho.nome.trim()} aria-label="Salvar o produto" title="Salvar o produto">
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={juntar(botao.icone, "mt-2 text-primary hover:text-primary")} onClick={() => abrir(null)} aria-label="Adicionar produto" title="Adicionar produto (foto, nome, preço e link)">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
