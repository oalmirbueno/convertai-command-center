import { Palette } from "lucide-react";
import { juntar, superficie } from "@/components/sistema/estilos";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import type { GuiaDeEstilo, PerfilDoModelo } from "./fotoApi";

/**
 * O guia de estilo da campanha: a DIREÇÃO que o diretor extraiu das
 * referências (paleta, luz, cenários, props, enquadramentos, clima), nunca
 * uma cópia de foto, marca ou pessoa. Usado na Campanha e no diretor.
 */

/** Cor em hex vira bolinha; nome de cor fica só em texto. */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  if (!valor) return null;
  return (
    <p className="text-[12px] leading-snug [overflow-wrap:anywhere]">
      <span className="text-muted-foreground">{rotulo}: </span>
      {valor}
    </p>
  );
}

/**
 * 28/09 (dono: "sem caixa dentro de caixa", "tudo recolhe"): o guia é um poço
 * (dentro da sugestão do diretor não vira outro cartão). Com `recolher` (chave
 * da tela), o título recolhe o guia e deixa o resumo à vista.
 */
export function GuiaDeEstiloNaTela({ guia, modelo, compacto = false, recolher }: { guia: GuiaDeEstilo | null; modelo?: PerfilDoModelo | null; compacto?: boolean; recolher?: string }) {
  const [recolhidoGuardado, setRecolhido] = useRecolhido(recolher || "mesa-foto:guia-de-estilo:sem-chave");
  const recolhido = !!recolher && recolhidoGuardado;
  if (!guia && !modelo) return null;
  const titulo = (
    <span className="inline-flex min-w-0 items-center">
      <Palette className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> Guia de estilo
    </span>
  );
  return (
    <div className={juntar(superficie.poco, "min-w-0 space-y-1.5 p-2.5")} data-guia-de-estilo="" data-recolhido={recolher ? (recolhido ? "sim" : "nao") : undefined}>
      {recolher ? (
        <TituloRecolhivel titulo={titulo} recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={guia && guia.resumo ? guia.resumo : undefined} />
      ) : (
        <p className="flex items-center text-[12px] font-medium text-muted-foreground">{titulo}</p>
      )}
      {recolhido ? null : <>
      {guia && guia.resumo && <p className="text-[12px] leading-snug [overflow-wrap:anywhere]">{guia.resumo}</p>}
      {guia && guia.paleta.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center" aria-label="Paleta">
          {guia.paleta.map((c) => (
            <span key={c} className="mb-1 mr-1 inline-flex max-w-full items-center rounded-full border border-border px-1.5 py-px text-[11px]">
              {HEX.test(c) && <span className="mr-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: c }} />}
              <span className="truncate">{c}</span>
            </span>
          ))}
        </div>
      )}
      {guia && <Linha rotulo="Luz" valor={guia.luz} />}
      {guia && <Linha rotulo="Clima" valor={guia.clima} />}
      {guia && <Linha rotulo="Cenários" valor={guia.cenarios.join(", ")} />}
      {guia && !compacto && <Linha rotulo="Props" valor={guia.props.join(", ")} />}
      {guia && !compacto && <Linha rotulo="Enquadramentos" valor={guia.enquadramentos.join(", ")} />}
      {guia && !compacto && <Linha rotulo="Evitar" valor={guia.evitar.join(", ")} />}
      {modelo && <Linha rotulo="Modelo sintético" valor={[modelo.perfil, modelo.idade_aprox && `${modelo.idade_aprox} anos`, modelo.estilo].filter(Boolean).join(", ")} />}
      </>}
    </div>
  );
}
