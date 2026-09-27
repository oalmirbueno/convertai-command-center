import { useState } from "react";
import { Loader2, Scissors, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import {
  type LaminaDoTexto,
  MAX_LAMINAS,
  precisaEnxugarNaGeracao,
  sugestaoDeDividirEmDuas,
  textoDoEnxuto,
} from "../../../supabase/functions/estudio-arte/texto-da-lamina";

/**
 * Texto da lâmina na geração (frente R5, 26/09; dono: "quando gerar a arte,
 * ele já refinar e encurtar o conteúdo, senão fica textão; ou divide em
 * partes"). Na ferramenta Lâmina, junto do Refinar texto:
 * - lâmina enxugada ao gerar: quantas palavras saíram e "Voltar ao original"
 *   (a próxima geração usa o texto de antes e não enxuga de novo);
 * - lâmina acima do limite: avisa que ao gerar o texto é enxugado (o custo da
 *   chamada curta já está no botão Gerar);
 * - lâmina que não cabe e tem mais de uma ideia: "Dividir em 2 lâminas", com
 *   a prévia das duas e a confirmação; o aviso depois traz o Desfazer.
 * Nada disso tem custo. Mesma regra do servidor (texto-da-lamina.ts).
 */

export const TEXTO_VAI_ENXUGAR = "Texto longo para a arte: ao gerar, ele é enxugado (o custo já está no Gerar).";
const DURACAO_DO_DESFAZER = 10000;

export default function EstudioTextoDaLamina({
  trabalhoId,
  card,
  total,
  capaComVersao,
  continuo = false,
  bloqueado = false,
  onMudou,
}: {
  trabalhoId: string;
  card: { ordem: number; funcao?: string; texto_exato?: string; blocos?: unknown; texto_na_geracao?: unknown };
  total: number;
  /** A capa já tem versão: o texto dela não muda na geração. */
  capaComVersao: boolean;
  /** Carrossel contínuo: a cena atravessa as lâminas, então não divide. */
  continuo?: boolean;
  bloqueado?: boolean;
  /** Depois de mudar a direção: relê o trabalho. */
  onMudou: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState<null | "voltar" | "dividir">(null);
  const lamina = card as unknown as LaminaDoTexto;
  const enxuto = textoDoEnxuto(lamina);
  const vaiEnxugar = !enxuto && precisaEnxugarNaGeracao({ card: lamina, total, capaComVersao });
  const sugestao = !continuo && total < MAX_LAMINAS ? sugestaoDeDividirEmDuas(lamina, total) : null;
  if (!enxuto && !vaiEnxugar && !sugestao) return null;

  const pedir = (operacao: string, extra: Record<string, unknown> = {}) =>
    chamarFuncao<any>("estudio-arte", { acao: "texto_da_lamina", trabalho_id: trabalhoId, ordem: card.ordem, operacao, ...extra });

  const voltar = async () => {
    setOcupado("voltar");
    try {
      await pedir("voltar_original");
      toast.success("Texto original de volta", { description: "A próxima geração usa este texto, sem enxugar." });
      onMudou();
    } catch (e) {
      toast.error("Texto não voltou", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const juntar = async () => {
    try {
      await pedir("juntar");
      toast.success("Lâminas juntas de novo");
      onMudou();
    } catch (e) {
      toast.error("Não foi possível desfazer", { description: textoDoErro(e) });
    }
  };

  const dividir = async () => {
    setOcupado("dividir");
    try {
      await pedir("dividir", { confirmado: true });
      setConfirmando(false);
      toast.success(`Lâmina ${card.ordem} dividida em 2`, {
        description: `A lâmina ${card.ordem + 1} é nova, com a segunda parte. Gere as duas.`,
        duration: DURACAO_DO_DESFAZER,
        action: { label: "Desfazer", onClick: () => void juntar() },
      });
      onMudou();
    } catch (e) {
      toast.error("Lâmina não dividida", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-1.5" data-texto-da-lamina={card.ordem}>
      {enxuto && (
        <p className="flex min-w-0 items-center text-[11.5px] leading-snug text-muted-foreground">
          <span className="min-w-0 flex-1">{enxuto}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-1 h-7 shrink-0 px-2 text-[11.5px]"
            disabled={bloqueado || !!ocupado}
            onClick={() => void voltar()}
          >
            {ocupado === "voltar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Undo2 className="mr-1 h-3 w-3" />}
            Voltar ao original
          </Button>
        </p>
      )}
      {vaiEnxugar && <p className="text-[11.5px] leading-snug text-muted-foreground">{TEXTO_VAI_ENXUGAR}</p>}
      {sugestao && !confirmando && (
        <p className="flex min-w-0 items-center text-[11.5px] leading-snug text-muted-foreground">
          <span className="min-w-0 flex-1">Não cabe numa lâmina só.</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-1 h-7 shrink-0 px-2 text-[11.5px]"
            disabled={bloqueado || !!ocupado}
            onClick={() => setConfirmando(true)}
          >
            <Scissors className="mr-1 h-3 w-3" /> Dividir em 2 lâminas
          </Button>
        </p>
      )}
      {sugestao && confirmando && (
        <div className="rounded-lg border border-border bg-background px-2.5 py-2" data-dividir-previa={card.ordem}>
          <p className="text-[11px] font-medium text-muted-foreground">Lâmina {card.ordem}</p>
          <p className="whitespace-pre-wrap text-[12px] leading-snug [overflow-wrap:anywhere]">{sugestao.primeira}</p>
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">Lâmina {card.ordem + 1} (nova)</p>
          <p className="whitespace-pre-wrap text-[12px] leading-snug [overflow-wrap:anywhere]">{sugestao.segunda}</p>
          <div className="mt-2 flex justify-end">
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => setConfirmando(false)} disabled={!!ocupado}>
              Cancelar
            </Button>
            <Button type="button" size="sm" className="ml-2 h-7 px-2.5 text-[11.5px]" onClick={() => void dividir()} disabled={bloqueado || !!ocupado}>
              {ocupado === "dividir" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Dividir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
