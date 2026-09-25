import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { corpoDaLogo, ROTULO_DA_LOGO, type EscolhaDaLogo } from "./estudioUtil";

/**
 * Qual logo do kit a lâmina usa (dono, 26/09: "no Estúdio e na Mesa, escolher
 * no kit de marca, ali do lado, qual logo eu quero"). As logos vêm do kit da
 * marca do trabalho (estudio-arte "logos"; na Acerbi e na CME, só as da marca
 * aberta). "Automática" deixa o estúdio escolher a que contrasta com o fundo.
 * Na lâmina, "Do conjunto" segue a escolha do conjunto. Grava pelo
 * configurar, sem custo; vale na próxima geração. A logo é sempre desenhada
 * pelo gerador junto com a arte, no tamanho legível que o prompt fixa.
 */

interface LogoDoKit {
  id: "principal" | "alternativa";
  rotulo: string;
  url: string | null;
}

interface RespostaDasLogos {
  logos?: LogoDoKit[];
}

const XADREZ = {
  backgroundImage:
    "linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 4px 4px",
};

export const chaveDasLogosDoKit = (trabalhoId: string) => ["mesa", "logos-do-kit", trabalhoId];

export default function EstudioLogoDaLamina({
  trabalhoId,
  alvo,
  ordem,
  escolha,
  doConjunto,
  bloqueado = false,
  onSalvar,
  compacto = false,
}: {
  trabalhoId: string;
  alvo: "lamina" | "conjunto";
  /** Lâmina (quando o alvo é a lâmina). */
  ordem?: number;
  /** Escolha gravada: card.logo na lâmina (null = do conjunto) ou direcao.logo_escolhida no conjunto. */
  escolha: EscolhaDaLogo | null;
  /** A escolha do conjunto, para a lâmina mostrar o que herda. */
  doConjunto?: EscolhaDaLogo | null;
  bloqueado?: boolean;
  /** Grava pelo configurar (estudio-arte), sem custo. */
  onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
  compacto?: boolean;
}) {
  const [salvando, setSalvando] = useState(false);
  const q = useQuery({
    queryKey: chaveDasLogosDoKit(trabalhoId),
    queryFn: () => chamarFuncao<RespostaDasLogos>("estudio-arte", { acao: "logos", trabalho_id: trabalhoId }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const logos = (q.data && Array.isArray(q.data.logos) ? q.data.logos : []).filter((l) => l && (l.id === "principal" || l.id === "alternativa"));
  const atual: EscolhaDaLogo | null = alvo === "lamina" ? escolha : escolha || "auto";

  const opcoes: { valor: EscolhaDaLogo | null; rotulo: string; dica: string; url?: string | null }[] = [];
  if (alvo === "lamina") {
    opcoes.push({ valor: null, rotulo: "Do conjunto", dica: `Segue a do conjunto (${ROTULO_DA_LOGO[doConjunto || "auto"]})` });
  }
  opcoes.push({ valor: "auto", rotulo: "Auto", dica: "O estúdio escolhe a que contrasta melhor com o fundo" });
  for (const l of logos) opcoes.push({ valor: l.id, rotulo: l.rotulo || ROTULO_DA_LOGO[l.id], dica: `Usar a logo ${String(l.rotulo || l.id).toLowerCase()} do kit`, url: l.url });

  const escolher = async (v: EscolhaDaLogo | null) => {
    if (v === atual || bloqueado) return;
    setSalvando(true);
    try {
      await onSalvar(corpoDaLogo(alvo, v, ordem));
      toast.success(alvo === "lamina" ? `Logo da lâmina ${ordem}: ${v ? ROTULO_DA_LOGO[v] : "a do conjunto"}` : `Logo do conjunto: ${ROTULO_DA_LOGO[v || "auto"]}`, {
        description: "Vale na próxima geração: a logo é desenhada junto com a arte.",
      });
    } catch (e) {
      toast.error("Logo não salva", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  if (q.isLoading) {
    return (
      <span className="inline-flex items-center text-[11.5px] text-muted-foreground">
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> logos do kit…
      </span>
    );
  }
  if (q.isError) return <span className="text-[11.5px] text-muted-foreground" title={textoDoErro(q.error)}>logos do kit indisponíveis</span>;
  if (!logos.length) {
    return <span className="text-[11.5px] text-muted-foreground">Sem logo no kit desta marca: a arte sai sem logo.</span>;
  }

  const lado = compacto ? 24 : 36;
  return (
    <div role="radiogroup" aria-label={alvo === "lamina" ? `Logo da lâmina ${ordem}` : "Logo do conjunto"} className="flex min-w-0 flex-wrap items-center">
      {opcoes.map((o) => {
        const marcada = o.valor === atual;
        return (
          <button
            key={o.valor || "conjunto"}
            type="button"
            role="radio"
            aria-checked={marcada}
            title={o.dica}
            disabled={bloqueado || salvando}
            onClick={() => void escolher(o.valor)}
            className={`mb-1 mr-1.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11.5px] transition-colors disabled:opacity-50 ${
              marcada ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            {o.url ? (
              <span className="mr-1 inline-block shrink-0 overflow-hidden rounded border border-border" style={{ width: lado, height: lado, ...XADREZ }}>
                <img src={o.url} alt={o.rotulo} className="h-full w-full object-contain" />
              </span>
            ) : null}
            {o.rotulo}
          </button>
        );
      })}
      {salvando && <Loader2 className="mb-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Salvando a logo" />}
    </div>
  );
}
