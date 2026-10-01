import { useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDaProva, type ProvaReal } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";

/**
 * Lista de provas com fonte (Insumos e BRAND.md): tirar, e pôr uma nova com
 * Enter. Os campos só se limpam depois que a gravação deu certo. Com o teto
 * cheio (12 em Insumos, 8 no BRAND) não entra mais nada, e prova repetida
 * (mesmo texto, do jeito que o servidor guarda) não entra.
 */
export default function ListaDeProvas({ provas, maximo, onMudar }: { provas: ProvaReal[]; maximo: number; onMudar: (novas: ProvaReal[]) => Promise<boolean> }) {
  const [nova, setNova] = useState({ texto: "", fonte: "" });
  const [indo, setIndo] = useState(false);
  const cheia = provas.length >= maximo;
  const repetida = !!nova.texto.trim() && provas.some((p) => textoDaProva(p.texto) === textoDaProva(nova.texto));
  const pode = !indo && !cheia && !repetida && !!nova.texto.trim() && !!nova.fonte.trim();

  const por = async (e: FormEvent) => {
    e.preventDefault();
    if (!pode) return;
    setIndo(true);
    const ok = await onMudar(provas.concat([{ texto: nova.texto.trim(), fonte: nova.fonte.trim() }]).slice(0, maximo)).catch(() => false);
    setIndo(false);
    if (ok) setNova({ texto: "", fonte: "" });
  };

  return (
    <div className="min-w-0" data-lista-de-provas="">
      {provas.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {provas.map((p, i) => (
            <li key={`${p.texto}-${i}`} className={lista.linha}>
              <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1")}>
                {p.texto} <span className={texto.auxiliar}>({p.fonte})</span>
              </span>
              <button type="button" className={botao.icone} aria-label="Tirar a prova" onClick={() => void onMudar(provas.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="mt-2 flex min-w-0 flex-wrap items-center" onSubmit={(e) => void por(e)}>
        <input className={juntar(campo, "mb-2 mr-2 min-w-[200px] flex-1")} placeholder="O fato (ex.: 120 lojas atendidas)" value={nova.texto} maxLength={240} disabled={cheia} onChange={(e) => setNova({ ...nova, texto: e.target.value })} aria-label="Prova" />
        <input className={juntar(campo, "mb-2 mr-2 min-w-[160px] flex-1")} placeholder="Fonte (relatório, print, contrato)" value={nova.fonte} maxLength={160} disabled={cheia} onChange={(e) => setNova({ ...nova, fonte: e.target.value })} aria-label="Fonte da prova" />
        <button type="submit" className={juntar(botao.secundario, "mb-2")} disabled={!pode} title={cheia ? `Até ${maximo} provas` : undefined}>
          {indo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
          Pôr a prova
        </button>
      </form>
      {repetida && <p className={juntar(texto.auxiliar, "text-warning")}>Esta prova já está na lista.</p>}
    </div>
  );
}
