import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { JanelaCentral, botao, juntar, superficie, texto } from "@/components/sistema";
import { avaliarGastoAgora, registrarTrava } from "@/lib/cfo/dadosDoCFO";
import { reais, type AvaliacaoDoGasto, type GastoProposto } from "../../../supabase/functions/agente-cfo/modulos/cfo-calculos";

/**
 * A TRAVA do CFO nas despesas (frente CFO, 30/09). Dono: "me trava quando um
 * gasto passa do limite: aviso forte, com confirmação explícita".
 *
 * A regra é código (avaliarGasto, a mesma da função agente-cfo), relida na
 * hora do lançamento:
 * - cabe com folga: lança sem perguntar;
 * - cabe, mas aperta: lança e avisa;
 * - passa do limite: abre a janela no centro com os números e só lança se o
 *   dono marcar "entendi" e clicar "Lançar mesmo assim". A decisão fica em
 *   cfo_eventos (o CFO cobra depois: "você passou do limite N vezes").
 * Se a conferência falhar (rede, banco), o lançamento segue e a tela avisa:
 * a trava protege, não impede o dono de registrar o que já gastou.
 */

type Pedido = {
  gasto: GastoProposto;
  avaliacao: AvaliacaoDoGasto;
  resolver: (lancar: boolean) => void;
};

export function useTravaDeGasto(origem: "caixa" | "custos_fixos"): { pedirLiberacao: (gasto: GastoProposto) => Promise<boolean>; janela: ReactNode } {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [entendi, setEntendi] = useState(false);
  const resolvido = useRef(false);

  const pedirLiberacao = async (gasto: GastoProposto): Promise<boolean> => {
    if (!user?.id || !(Number(gasto.valor) > 0)) return true;
    let avaliacao: AvaliacaoDoGasto;
    try {
      avaliacao = (await avaliarGastoAgora(qc, user.id, gasto)).avaliacao;
    } catch (e) {
      toast.warning(`Não consegui conferir o limite do CFO agora (${e instanceof Error ? e.message : "erro"}). Lancei sem a trava.`);
      return true;
    }
    if (avaliacao.foraDaTrava || avaliacao.nivel === "livre") return true;
    if (avaliacao.nivel === "atencao") {
      toast.warning(`${avaliacao.titulo}. ${avaliacao.motivo}`);
      return true;
    }
    resolvido.current = false;
    setEntendi(false);
    return await new Promise<boolean>((resolver) => setPedido({ gasto, avaliacao, resolver }));
  };

  const decidir = (lancar: boolean) => {
    const p = pedido;
    if (!p || resolvido.current) return;
    resolvido.current = true;
    setPedido(null);
    if (user?.id) {
      void registrarTrava({
        avaliacao: p.avaliacao,
        decisao: lancar ? "lancou" : "desistiu",
        origem,
        descricao: p.gasto.descricao,
        recorrente: p.gasto.recorrente === true,
        userId: user.id,
      }).then((erro) => {
        if (erro) toast.error(`A decisão não ficou registrada no CFO: ${erro}`);
      });
    }
    p.resolver(lancar);
  };

  const a = pedido?.avaliacao;
  const janela = (
    <JanelaCentral
      aberta={!!pedido}
      onFechar={() => decidir(false)}
      titulo={a ? a.titulo : "Este gasto passa do limite"}
      icone={<ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />}
      descricao={a ? `Limite de ${a.rotuloDoMes}` : undefined}
      ajuda="O limite é a conta do CFO: o quanto dá para gastar a mais sem o caixa livre ficar abaixo de meio mês de estrutura nos próximos 3 meses, mesmo entrando 15% a menos. Custo que se repete conta todo mês."
      largura="sm"
      fecharNoFundo={false}
      data-trava-do-cfo=""
      rodape={
        <div className="flex min-w-0 flex-wrap items-center justify-end [&>*+*]:ml-2">
          <button type="button" onClick={() => decidir(false)} className={botao.secundario} data-nao-lancar="">
            Não lançar
          </button>
          <button type="button" onClick={() => decidir(true)} disabled={!entendi} className={botao.perigo} data-lancar-mesmo-assim="">
            Lançar mesmo assim
          </button>
        </div>
      }
    >
      {a && (
        <div className="min-w-0 space-y-3">
          <dl className={juntar(superficie.poco, "grid min-w-0 grid-cols-3 gap-x-3 p-3")}>
            <div className="min-w-0">
              <dt className={texto.rotulo}>Gasto</dt>
              <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-foreground">{reais(a.valor)}</dd>
            </div>
            <div className="min-w-0">
              <dt className={texto.rotulo}>Limite</dt>
              <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-foreground">{reais(a.limite)}</dd>
            </div>
            <div className="min-w-0">
              <dt className={texto.rotulo}>Passa</dt>
              <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-destructive">{reais(a.excesso)}</dd>
            </div>
          </dl>
          <p className={texto.corpo}>{a.motivo}</p>
          {a.folegoDepois !== null && (
            <p className={texto.auxiliar}>Fôlego depois do gasto: {String(a.folegoDepois).replace(".", ",")} mês(es) de estrutura no caixa livre.</p>
          )}
          <label className="flex min-w-0 cursor-pointer items-start text-[13px] leading-5 text-foreground">
            <input type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} className="mr-2 mt-0.5 h-4 w-4 shrink-0" data-entendi="" />
            <span className="min-w-0">Entendi que este gasto passa do limite do CFO e quero lançar mesmo assim.</span>
          </label>
        </div>
      )}
    </JanelaCentral>
  );

  return { pedirLiberacao, janela };
}
