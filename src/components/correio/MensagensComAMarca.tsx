import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, juntar, superficie, texto } from "@/components/sistema";

/**
 * Ateliê de Cor no Correio (19/11/2026): cada e-mail sai com o texto puro e com a
 * mesma mensagem em HTML nas cores da marca (kit do cliente, ou a cor da
 * Aparência, ou um tema neutro), legível no modo escuro. Aqui a pessoa vê como
 * a mensagem chega. A prévia vem da própria função (produto-correio previa_html),
 * o mesmo HTML do envio, num iframe sem script.
 */

type Previa = { html: string; marca: string; origem: "kit" | "aparencia" | "neutro" };

const ORIGEM: Record<Previa["origem"], string> = {
  kit: "Cores do kit da marca",
  aparencia: "Cor escolhida em Aparência",
  neutro: "Tema neutro (escolha a cor da empresa em Aparência)",
};

async function lerPrevia(caixaId: string): Promise<Previa> {
  const { data, error } = await supabase.functions.invoke("produto-correio", { body: { acao: "previa_html", caixa_id: caixaId } });
  if (error) throw error;
  return data as Previa;
}

export default function MensagensComAMarca({ caixaId }: { caixaId: string | null }) {
  const [escuro, setEscuro] = useState(false);
  const previa = useQuery({ queryKey: ["correio", "previa-html", caixaId], queryFn: () => lerPrevia(caixaId!), enabled: !!caixaId, staleTime: 300_000 });
  const html = useMemo(() => {
    const h = previa.data?.html || "";
    // Na prévia, o modo escuro vira regra fixa; no claro, o iframe não segue o tema do aparelho.
    return escuro ? h.replace("@media (prefers-color-scheme: dark) {", "@media all {") : h.replace(":root { color-scheme: light dark;", ":root { color-scheme: light;");
  }, [previa.data, escuro]);

  return (
    <section className="min-w-0 rounded-lg bg-card p-6" aria-label="Mensagens com a sua marca" data-mensagens-com-a-marca="">
      <div className="flex min-w-0 items-start">
        <span className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary" aria-hidden="true"><Palette className="h-[18px] w-[18px]" /></span>
        <span className="min-w-0 flex-1">
          <h2 className={texto.tituloSecao}>Mensagens com a sua marca</h2>
          <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>Cada e-mail sai com o texto puro e também nas cores da empresa, legível no modo escuro do Gmail, Outlook e Apple Mail.</p>
        </span>
      </div>
      {!caixaId ? (
        <p className={juntar(texto.auxiliar, "mt-4")}>Ligue uma caixa ao correio para ver a prévia.</p>
      ) : previa.isLoading ? (
        <div className="mt-4"><Carregando linhas={3} rotulo="Montando a prévia" /></div>
      ) : previa.isError || !previa.data ? (
        <p className={juntar(texto.auxiliar, "mt-4")}>Não deu para montar a prévia agora.</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center">
            <span className={juntar(texto.auxiliar, "mr-3")}>{ORIGEM[previa.data.origem]}</span>
            <span className="inline-flex rounded-full bg-muted p-0.5" role="group" aria-label="Tema da prévia">
              <button type="button" aria-pressed={!escuro} onClick={() => setEscuro(false)} className={juntar("rounded-full px-3 py-1 text-[12px]", !escuro ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>Claro</button>
              <button type="button" aria-pressed={escuro} onClick={() => setEscuro(true)} className={juntar("ml-0.5 rounded-full px-3 py-1 text-[12px]", escuro ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>Escuro</button>
            </span>
          </div>
          <iframe title={escuro ? "Mensagem no modo escuro" : "Mensagem no modo claro"} sandbox="" srcDoc={html} className={juntar(superficie.painel, "h-[320px] w-full")} />
        </div>
      )}
    </section>
  );
}
