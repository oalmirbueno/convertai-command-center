import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bold, Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { chamarFuncao, ErroDaMesa, textoDoErro, usd } from "@/lib/mesa/api";
import { useMesa } from "../MesaContexto";
import { gravarTrabalhoNoCache, type TrabalhoGravado } from "../estudioUtil";
import type { CardDaDirecao, Trabalho } from "../useItensDoMes";
import { alternarNegrito, trechosEmNegrito } from "../../../../supabase/functions/estudio-arte/modulos/destaques-do-texto";

/**
 * O texto da lâmina dentro do Template (23/10, dono: "quebrar linhas e aparece na lâmina, selecionar a
 * palavra pra ficar em negrito, e a IA já destaca as melhores palavras"). Enter quebra a linha (linha vazia
 * vira parágrafo); o B e o Ctrl+B põem ou tiram o negrito do trecho selecionado (**trecho**). Salvar grava o
 * texto da lâmina, o mesmo da ferramenta Lâmina, sem custo. "Destacar" pede ao Jev as palavras mais fortes
 * (custo antes).
 */
export default function EditorDoTextoDaLamina({ trabalho, card, total, travado, onMudou }: {
  trabalho: Trabalho; card: CardDaDirecao; total: number; travado: boolean; onMudou: () => void;
}) {
  const mesa = useMesa(), cache = useQueryClient();
  const salvo = card.texto_exato || "";
  const [valor, setValor] = useState(salvo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [custo, setCusto] = useState<{ todas: boolean; usd: number } | null>(null);
  const [destacando, setDestacando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  // O texto que chega de fora (gerador, ferramenta Lâmina, Destacar) entra no campo se não há edição pendente.
  const ultimoSalvo = useRef(salvo);
  useEffect(() => {
    if (ultimoSalvo.current === salvo) return;
    setValor((v) => (v === ultimoSalvo.current ? salvo : v));
    ultimoSalvo.current = salvo;
  }, [salvo]);
  const mudou = valor.trim() !== salvo.trim();

  const negrito = () => {
    const el = campo.current;
    const r = alternarNegrito(valor, el ? el.selectionStart : valor.length, el ? el.selectionEnd : valor.length);
    setValor(r.texto);
    // A seleção volta ao mesmo trecho, para dar para tirar o negrito no mesmo clique.
    requestAnimationFrame(() => { if (campo.current) { campo.current.focus(); campo.current.setSelectionRange(r.inicio, r.fim); } });
  };

  const salvar = async () => {
    if (!valor.trim() || !mudou) return;
    setSalvando(true); setErro("");
    try {
      const r = await chamarFuncao<{ trabalho?: TrabalhoGravado }>("estudio-arte", { acao: "configurar", trabalho_id: trabalho.id, card: { ordem: card.ordem, texto_exato: valor.replace(/\r/g, "") } });
      if (r && r.trabalho) gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
      ultimoSalvo.current = valor.replace(/\r/g, "").trim();
      onMudou();
    } catch (e) { setErro(textoDoErro(e)); } finally { setSalvando(false); }
  };

  const corpoDoDestaque = (todas: boolean) => ({ acao: "template_destaques", trabalho_id: trabalho.id, ordem: card.ordem, todas });
  const pedirCusto = async (todas: boolean) => {
    setErro("");
    if (mudou) { setErro("Salve o texto antes de destacar."); return; }
    try {
      await chamarFuncao("estudio-arte", corpoDoDestaque(todas));
      setErro("O servidor não pediu a confirmação do custo.");
    } catch (e) {
      if (e instanceof ErroDaMesa && e.codigo === "confirmar_custo") setCusto({ todas, usd: Number((e.detalhes || {}).custo_estimado_usd) || 0 });
      else setErro(textoDoErro(e));
    }
  };
  const destacar = async () => {
    if (!custo) return;
    setDestacando(true); setErro("");
    try {
      const r = await chamarFuncao<{ trabalho: TrabalhoGravado; laminas: Array<{ ordem: number; destaques: string[] }>; custo_usd: number }>("estudio-arte", { ...corpoDoDestaque(custo.todas), confirmado: true });
      gravarTrabalhoNoCache(cache, mesa.clientId, r.trabalho);
      const feitos = r.laminas.filter((l) => l.destaques.length).length;
      toast.success(feitos ? `Destaques em ${feitos} lâmina(s)` : "Nada forte o bastante para destacar", { description: `Custo ${usd(Number(r.custo_usd) || 0)}. Ajuste à mão com o B.` });
      setCusto(null);
      mesa.atualizarCusto?.();
      onMudou();
    } catch (e) { setErro(textoDoErro(e)); } finally { setDestacando(false); }
  };

  const destaques = trechosEmNegrito(valor);
  return (
    <div className="space-y-2" data-editor-do-texto="">
      <div className="flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>Texto da lâmina</span>
        <button type="button" className={juntar(botao.icone, "font-bold")} disabled={travado} onMouseDown={(e) => e.preventDefault()} onClick={negrito} aria-label="Negrito no trecho selecionado" title="Negrito no trecho selecionado (Ctrl+B)"><Bold className="h-4 w-4" aria-hidden="true" /></button>
        <AjudaRecolhida className="ml-1" rotulo="Como formatar o texto">Enter quebra a linha; uma linha vazia separa parágrafos. Selecione palavras e use o B (ou Ctrl+B) para pôr ou tirar o negrito. O texto é o mesmo da ferramenta Lâmina.</AjudaRecolhida>
      </div>
      <Textarea ref={campo} aria-label="Texto da lâmina no template" value={valor} rows={6} maxLength={1200} disabled={travado || salvando} className="text-[13px]"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) { e.preventDefault(); negrito(); } }} />
      <div className="flex min-w-0 flex-wrap items-center">
        <span className={juntar(texto.auxiliar, "mb-1 mr-auto min-w-0 truncate")} data-destaques-do-texto={destaques.length}>{destaques.length ? `Negrito: ${destaques.join(" · ")}` : "Sem negrito"}</span>
        {mudou && <button type="button" className="mb-1 mr-2 text-[12px] text-muted-foreground hover:underline" disabled={salvando} onClick={() => setValor(salvo)}>Desfazer</button>}
        {mudou && <Button size="sm" className="mb-1" disabled={travado || salvando || !valor.trim()} onClick={() => void salvar()}>{salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}Salvar texto</Button>}
      </div>
      {custo ? (
        <div className="flex flex-wrap items-center" role="status">
          <Button size="sm" className="mb-1 mr-2" disabled={travado || destacando} onClick={() => void destacar()}>{destacando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Confirmar {usd(custo.usd)}</Button>
          <Button size="sm" variant="ghost" className="mb-1" disabled={destacando} onClick={() => setCusto(null)}>Cancelar</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center">
          <Button size="sm" variant="outline" className="mb-1 mr-2" disabled={travado} onClick={() => void pedirCusto(false)}><Sparkles className="mr-1.5 h-3.5 w-3.5" />Destacar as melhores palavras</Button>
          {total > 1 && <Button size="sm" variant="ghost" className="mb-1" disabled={travado} onClick={() => void pedirCusto(true)}>Em todas as lâminas</Button>}
        </div>
      )}
      {erro && <p role="alert" className="text-[12px] text-destructive">{erro}</p>}
    </div>
  );
}
