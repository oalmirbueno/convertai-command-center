import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { AjudaRecolhida } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";

/**
 * "Adaptar conteúdo à copy" (frente R, 26/09). Pedido do dono: da referência
 * vem a estética (layout, hierarquia, luz, tratamento, composição); a imagem
 * transmite o texto da lâmina. Ligado por padrão, lembrado por trabalho
 * (direcao.adaptar_conteudo_a_copy; só false desliga). Desligado, a lâmina
 * copia também o conteúdo da referência, como antes. Grava pelo configurar,
 * sem custo; vale na próxima geração com referência.
 */

/** Ligado a menos que o trabalho diga false (igual ao servidor). */
export function adaptarLigado(direcao: unknown): boolean {
  return !(direcao && typeof direcao === "object" && (direcao as Record<string, unknown>).adaptar_conteudo_a_copy === false);
}

/** Corpo do configurar: true volta ao padrão (ligado). */
export function corpoDoAdaptar(ligado: boolean): Record<string, unknown> {
  return { conjunto: { adaptar_conteudo_a_copy: ligado } };
}

export const AJUDA_DO_ADAPTAR =
  "Ligado, a lâmina copia da referência só a estética: layout, hierarquia, luz, tratamento e composição. Se o assunto da referência não combina com o texto desta lâmina, ele é trocado por uma cena que transmite a mensagem, no mesmo enquadramento. Letra, cores e logo são sempre os da marca. Desligado, copia também o conteúdo da referência, como antes.";

export default function EstudioAdaptarConteudo({
  direcao,
  bloqueado = false,
  onSalvar,
}: {
  direcao: unknown;
  bloqueado?: boolean;
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
}) {
  const doTrabalho = adaptarLigado(direcao);
  const [ligado, setLigado] = useState(doTrabalho);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setLigado(doTrabalho), [doTrabalho]);

  const mudar = async (v: boolean) => {
    if (bloqueado || salvando) return;
    setLigado(v);
    setSalvando(true);
    try {
      await onSalvar(corpoDoAdaptar(v));
    } catch (e) {
      setLigado(!v);
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-w-0" data-controle="adaptar-conteudo" data-ligado={ligado ? "sim" : "nao"}>
      <div className="flex min-w-0 items-center">
        <Switch
          id="adaptar-conteudo-a-copy"
          checked={ligado}
          disabled={bloqueado || salvando}
          onCheckedChange={(v) => void mudar(v === true)}
          aria-label="Adaptar conteúdo à copy"
        />
        <label htmlFor="adaptar-conteudo-a-copy" className="ml-2 mr-1 min-w-0 truncate text-[12px] text-foreground">
          Adaptar conteúdo à copy
        </label>
        <AjudaRecolhida rotulo="O que faz Adaptar conteúdo à copy">{AJUDA_DO_ADAPTAR}</AjudaRecolhida>
        {salvando && <Loader2 className="ml-1 h-3 w-3 shrink-0 animate-spin" aria-label="Salvando" />}
      </div>
      <p className="mt-0.5 truncate text-[10.5px] leading-snug text-muted-foreground">
        {ligado ? "Estética da referência, conteúdo da sua copy." : "Copia também o conteúdo da referência."}
      </p>
    </div>
  );
}
