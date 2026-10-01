import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import Secao from "@/components/sistema/Secao";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { ESTADOS_EM_ANDAMENTO, TIPOS_DO_GERADOR, useMotoresDaMesa, type MotorNaTela } from "@/lib/mesa-videos/api";
import { custoDoMotor, textoDoCusto } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { usePedidos } from "./videosApi";

/**
 * Situação do gerador (frente VGN, 30/09): o que falta para gerar, dito em
 * uma linha que recolhe. Antes a tela só dizia "precisa de chave" dentro do
 * seletor e o saldo curto aparecia depois do clique, como erro.
 * - Provedores: quantos motores estão prontos e o NOME da chave que falta
 *   (nunca o valor: a chave fica só no servidor).
 * - Carteira de IA do cliente contra o vídeo mais barato de 5 s pronto.
 * - Pedidos em andamento (o servidor confere a cada minuto).
 */

const ROTULO_DO_PROVEDOR: Record<string, string> = { fal: "fal.ai", runway: "Runway", higgsfield: "Higgsfield", heygen: "HeyGen" };

export interface ResumoDoProvedor {
  provedor: string;
  rotulo: string;
  prontos: number;
  total: number;
  faltam: string[];
}

/** Agrupa a lista da tela por provedor (a chave que falta vem do servidor, só o nome). */
export function resumoDosProvedores(lista: MotorNaTela[]): ResumoDoProvedor[] {
  const por: Record<string, ResumoDoProvedor> = {};
  lista
    .filter((x) => !x.motor.situacao && x.motor.provedor !== "painel")
    .forEach((x) => {
      const p = por[x.motor.provedor] || (por[x.motor.provedor] = { provedor: x.motor.provedor, rotulo: ROTULO_DO_PROVEDOR[x.motor.provedor] || x.motor.provedor, prontos: 0, total: 0, faltam: [] });
      p.total++;
      if (x.estado === "pronto") p.prontos++;
      (x.chave || "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .forEach((n) => p.faltam.indexOf(n) < 0 && p.faltam.push(n));
    });
  return Object.keys(por)
    .map((k) => por[k])
    .sort((a, b) => (a.provedor === "fal" ? -1 : b.provedor === "fal" ? 1 : a.rotulo < b.rotulo ? -1 : 1));
}

const dinheiro = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

export default function SituacaoDoGerador() {
  const { clientId, saldoUsd, podeRecarregar, abrirRecarga, isAdmin, abrirChaves } = useMesa();
  const motores = useMotoresDaMesa();
  const pedidosQ = usePedidos(clientId);
  const provedores = useMemo(() => resumoDosProvedores(motores.lista), [motores.lista]);
  const fal = provedores.find((p) => p.provedor === "fal") || null;
  const prontos = motores.lista.filter((x) => x.estado === "pronto" && x.motor.familia === "video");
  const maisBarato = prontos.reduce<{ rotulo: string; usd: number } | null>((m, x) => {
    const c = custoDoMotor(x.motor, { duracao_s: 5 });
    return c.usd !== null && (!m || c.usd < m.usd) ? { rotulo: x.motor.rotulo, usd: c.usd } : m;
  }, null);
  const emAndamento = ((pedidosQ.data && pedidosQ.data.itens) || []).filter((p) => TIPOS_DO_GERADOR.indexOf(p.tipo as string) >= 0 && ESTADOS_EM_ANDAMENTO.indexOf(p.estado as string) >= 0 && (p.estado as string) !== "parcial").length;
  const semChaveDoFal = !!fal && fal.faltam.length > 0;
  const saldoCurto = typeof saldoUsd === "number" && !!maisBarato && saldoUsd < maisBarato.usd;
  const conferindo = motores.carregando;
  const alerta = !conferindo && (semChaveDoFal || saldoCurto || motores.semFuncao);

  const resumo = conferindo
    ? "Conferindo os motores"
    : motores.semFuncao
      ? "Não deu para conferir as chaves agora"
      : semChaveDoFal
        ? `Falta a chave ${fal ? fal.faltam.join(" e ") : "FAL_KEY"} no servidor`
        : saldoCurto
          ? `Carteira do cliente com ${dinheiro(saldoUsd as number)}: não cobre um vídeo`
          : `${prontos.length} motores prontos${typeof saldoUsd === "number" ? ` · carteira ${dinheiro(saldoUsd)}` : ""}${emAndamento ? ` · ${emAndamento} gerando` : ""}`;

  return (
    <Secao
      divisoria
      titulo="Situação do gerador"
      descricao={resumo}
      resumo={resumo}
      recolher={`mesa-videos:situacao:${clientId}`}
      ajuda="O gerador de vídeo usa as chaves guardadas no servidor (nunca na tela) e cobra da carteira de IA do cliente só o que ficar pronto. O fal.ai liga Seedance, Veo, Kling, Wan, MiniMax, Luma, FLUX, LTX e a foto que fala com uma chave só (FAL_KEY). Runway, Higgsfield e HeyGen direto são opcionais e pedem a chave de cada um. Quem cuida da conta cadastra a chave em Supabase > Edge Functions > Secrets; a recarga da carteira é feita no cadastro do cliente."
      data-situacao-do-gerador=""
    >
      <ul className="space-y-1.5" aria-label="O que falta para gerar">
        {provedores.map((p) => (
          <li key={p.provedor} className="flex min-w-0 items-start text-[13px]" data-provedor={p.provedor}>
            {p.faltam.length ? <AlertTriangle className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" /> : <CheckCircle2 className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
            <span className="min-w-0 flex-1">
              <span className="font-medium">{p.rotulo}</span>
              <span className={texto.auxiliar}>
                {" "}
                · {p.prontos} de {p.total} {p.total === 1 ? "motor pronto" : "motores prontos"}
                {p.faltam.length ? ` · falta ${p.faltam.join(" e ")}${p.provedor === "fal" ? "" : " (opcional)"}` : ""}
              </span>
            </span>
          </li>
        ))}
        <li className="flex min-w-0 items-start text-[13px]" data-carteira="">
          {saldoCurto ? <AlertTriangle className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" /> : <CheckCircle2 className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
          <span className="min-w-0 flex-1">
            <span className="font-medium">Carteira de IA do cliente</span>
            <span className={texto.auxiliar}>
              {" "}
              · {typeof saldoUsd === "number" ? dinheiro(saldoUsd) : "lendo"}
              {maisBarato ? ` · o vídeo mais barato de 5 s (${maisBarato.rotulo}) custa ${textoDoCusto({ usd: maisBarato.usd, incerto: false })}` : ""}
              {saldoCurto ? ". Recarregue para gerar." : ""}
            </span>
          </span>
          {saldoCurto && podeRecarregar && (
            <button type="button" className={juntar(botao.discreto, "ml-2 h-7 shrink-0 px-2 text-[12px]")} onClick={abrirRecarga} data-recarregar="">
              Recarregar
            </button>
          )}
        </li>
        {emAndamento > 0 && (
          <li className={juntar(texto.auxiliar, "pl-5")} data-em-andamento="">
            {emAndamento} {emAndamento === 1 ? "pedido gerando" : "pedidos gerando"}: o servidor confere a cada minuto e guarda no acervo quando fica pronto.
          </li>
        )}
      </ul>
      {alerta && motores.semFuncao && <p className={juntar(texto.auxiliar, "mt-2")}>A função da Mesa Vídeos não respondeu. O servidor confere de novo ao gerar.</p>}
      {semChaveDoFal && isAdmin && (
        <button type="button" className={juntar(botao.discreto, "mt-2 h-7 px-2 text-[12px]")} onClick={abrirChaves}>
          Ver as chaves
        </button>
      )}
    </Secao>
  );
}
