import { useState } from "react";
import { CalendarHeart } from "lucide-react";
import { JanelaCentral, foco, juntar, texto } from "@/components/sistema";
import { diaVisivelAoCliente, ehHoje, nomeDoDia } from "@/lib/diaPrioritario";
import { useDiaDoCliente } from "@/lib/diaPrioritarioApi";
import VideoDoDiaPrioritario from "./VideoDoDiaPrioritario";

/**
 * "Seu Dia Prioritário" na área do cliente (12/10/2026). Compacto, no verde da marca, sem pop-up:
 * o dia confirmado em destaque, o que é o benefício, o convite para trazer dúvidas e ideias e o
 * lembrete de que o acompanhamento segue a semana toda. No próprio dia, um destaque discreto.
 * Sem dia confirmado: um estado neutro, nunca um dia inventado.
 */

export function ComoFuncionaODia({ aberta, onFechar, dia }: { aberta: boolean; onFechar: () => void; dia: number | null }) {
  return (
    <JanelaCentral aberta={aberta} onFechar={onFechar} titulo="Como funciona o Dia Prioritário" largura="md">
      <div className="space-y-3 text-[14px] leading-6 text-foreground">
        <p>
          {dia ? `Toda ${nomeDoDia(dia)}` : "Um dia útil fixo por semana"} a Aceleriq dedica uma atenção estratégica especial ao seu negócio.
        </p>
        <div>
          <p className={texto.rotulo}>Nesse dia podemos</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-5 text-muted-foreground">
            <li>conversar com você, inclusive por ligação, quando fizer sentido;</li>
            <li>revisar resultados, campanhas e conteúdos;</li>
            <li>organizar pendências e combinar os próximos passos;</li>
            <li>alinhar prioridades e oportunidades;</li>
            <li>combinar gravações e fotos, quando fazem parte do seu plano e foram combinadas antes.</li>
          </ul>
        </div>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Aproveite para trazer dúvidas, ideias e sugestões. Não é uma reunião obrigatória: se não houver necessidade de conversa, o trabalho segue normalmente.
        </p>
        <p className="text-[13px] leading-5 text-muted-foreground">
          Seu negócio continua sendo acompanhado durante toda a semana. Os recados de segunda, quarta e sexta, as campanhas, as entregas e os seus canais de atendimento seguem como sempre, e urgências são tratadas quando acontecem.
        </p>
      </div>
    </JanelaCentral>
  );
}

/**
 * `recorrente`: o cliente tem contrato mensal vigente. Sem isso e sem dia confirmado, o cartão não aparece (avulso não recebe o benefício).
 * `compacto` (23/10/2026, dono: "tem cliente que não está aparecendo o Dia Prioritário"): no celular o cartão ficava
 * recolhido em "Mais detalhes" e o cliente nunca via o próprio dia. Agora, recolhido, ele vira uma linha só, sempre à vista.
 */
export default function CartaoDoDiaPrioritario({ clientId, recorrente, agora, compacto = false }: { clientId: string | null | undefined; recorrente: boolean; agora?: Date; compacto?: boolean }) {
  const { data, isLoading, isError } = useDiaDoCliente(clientId);
  const [comoFunciona, setComoFunciona] = useState(false);
  if (!clientId || isLoading || isError) return null;
  const dia = diaVisivelAoCliente(data);
  if (!dia && !recorrente) return null;
  const hoje = dia ? ehHoje(dia, agora ?? new Date()) : false;

  if (compacto) {
    return (
      <section
        aria-label="Seu Dia Prioritário"
        data-dia-prioritario={dia ? String(dia) : "sem-dia"}
        data-hoje={hoje ? "sim" : undefined}
        data-compacto=""
        className={juntar("flex min-w-0 items-center rounded-lg border px-3 py-2", hoje ? "border-primary/50 bg-primary/[0.08]" : "border-primary/25 bg-primary/[0.04]")}
      >
        <CalendarHeart className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[13px] leading-5 text-foreground">
          {hoje ? (
            <strong className="font-semibold text-primary">Hoje é seu Dia Prioritário!</strong>
          ) : dia ? (
            <>Seu Dia Prioritário: toda <strong className="font-semibold text-primary">{nomeDoDia(dia)}</strong></>
          ) : (
            "Seu Dia Prioritário está sendo organizado."
          )}
        </p>
        <button type="button" onClick={() => setComoFunciona(true)} className={juntar("ml-2 h-9 shrink-0 rounded-md px-2 text-[12px] font-medium text-primary", foco)}>
          Como funciona
        </button>
        <ComoFuncionaODia aberta={comoFunciona} onFechar={() => setComoFunciona(false)} dia={dia} />
      </section>
    );
  }

  return (
    <section
      aria-label="Seu Dia Prioritário"
      data-dia-prioritario={dia ? String(dia) : "sem-dia"}
      data-hoje={hoje ? "sim" : undefined}
      className={juntar(
        "min-w-0 rounded-lg border px-4 py-3 transition-colors",
        hoje ? "border-primary/50 bg-primary/[0.08]" : "border-primary/25 bg-primary/[0.04]",
      )}
    >
      <div className="flex min-w-0 items-start">
        <span className="mr-3 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <CalendarHeart className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center">
            <h2 className="mr-2 text-[15px] font-semibold text-foreground">Seu Dia Prioritário</h2>
            {hoje && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">Hoje é seu Dia Prioritário!</span>}
          </div>
          {dia ? (
            <>
              <p className="mt-1 text-[14px] leading-5 text-foreground">
                Seu Dia Prioritário é toda <strong className="font-semibold text-primary">{nomeDoDia(dia)}</strong>.
              </p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Um momento especial para falarmos de resultados, ideias e próximos passos.</p>
              <p className="text-[13px] leading-5 text-muted-foreground">Traga suas dúvidas, necessidades e sugestões.</p>
              <p className="text-[13px] leading-5 text-muted-foreground">Seu negócio segue acompanhado durante toda a semana.</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Estamos organizando o seu Dia Prioritário.</p>
              <p className="text-[13px] leading-5 text-muted-foreground">Enquanto isso, o acompanhamento segue normalmente.</p>
            </>
          )}
          <button
            type="button"
            onClick={() => setComoFunciona(true)}
            className={juntar("mt-1 text-[12px] font-medium text-primary underline-offset-2 hover:underline", foco)}
          >
            Entenda como funciona
          </button>
          <VideoDoDiaPrioritario className="mt-2 sm:max-w-sm" />
        </div>
      </div>
      <ComoFuncionaODia aberta={comoFunciona} onFechar={() => setComoFunciona(false)} dia={dia} />
    </section>
  );
}
