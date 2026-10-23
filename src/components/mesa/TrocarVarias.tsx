import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ListRestart, Loader2 } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { useAvisarErro } from "./Custo";
import { CartaoDaAcaoNaAgenda } from "./AgenteDoMes";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import { chaves } from "./mesaV4Api";
import { acaoNaAgendaDaMensagem, nomeDoMes, proporRefazerEsteira, type AcaoNaAgenda } from "./planoDoMes";

/**
 * Trocar várias (24/10/2026; dono: "trocar conteúdos se eu quiser e não gostar da esteira que tem pronta"): refazer
 * a semana aberta ou o mês inteiro, todas ou só as não feitas. A lista sai pelo código (sem custo) com as peças
 * protegidas e o motivo de cada uma (arte pronta, post vinculado, publicação, aprovação, pedido do cliente); o
 * Confirmar e refazer mostra o custo antes e o Desfazer devolve as peças. O mesmo cartão do agente do Mês.
 */
export default function TrocarVarias({
  aberta,
  onMudar,
  mes,
  semana,
}: {
  aberta: boolean;
  onMudar: (v: boolean) => void;
  /** AAAA-MM-01 */
  mes: string;
  /** A segunda-feira da semana aberta na agenda (AAAA-MM-DD), quando há. */
  semana: string | null;
}) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [escopo, setEscopo] = useState<"semana" | "mes">(semana ? "semana" : "mes");
  const [soNaoFeitas, setSoNaoFeitas] = useState(true);
  const [orientacao, setOrientacao] = useState("");
  const [montando, setMontando] = useState(false);
  const [lista, setLista] = useState<{ mensagemId: string; acao: AcaoNaAgenda } | null>(null);
  const rotuloDaSemana = semana ? `Semana de ${semana.slice(8, 10)}/${semana.slice(5, 7)}` : "Semana";

  const montar = async () => {
    setMontando(true);
    try {
      const r = await proporRefazerEsteira({ clientId, mes, semana: escopo === "semana" ? semana : null, soNaoFeitas, orientacao, marcaId: marca ? marca.id : null });
      const acao = acaoNaAgendaDaMensagem([r.acao]);
      if (acao) setLista({ mensagemId: r.mensagem_id, acao });
      void qc.invalidateQueries({ queryKey: chaves.agente(clientId) });
    } catch (e) {
      avisarErro(e, "Não foi possível montar a lista");
    } finally {
      setMontando(false);
    }
  };

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={onMudar}
      titulo="Trocar várias"
      icone={<ListRestart className="h-4 w-4" />}
      descricao={`Refazer peças de ${nomeDoMes(mes)} com temas novos, nas mesmas datas e formatos.`}
      largura="lg"
      ajuda="Peças com arte pronta, post vinculado, publicação, aprovação ou pedido do cliente ficam como estão; a lista mostra quais e por quê. O refazer gera temas novos nas mesmas datas e formatos; as peças novas chegam no Agente do mês, prontas para gravar na agenda, e dá para desfazer."
      rodape={
        lista ? (
          <div className="flex min-w-0 justify-end">
            <button type="button" className={botao.discreto} onClick={() => setLista(null)}>Outra lista</button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center justify-end">
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => onMudar(false)}>Cancelar</button>
            <button type="button" className={botao.primario} onClick={() => void montar()} disabled={montando} data-montar-lista="">
              {montando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Montar a lista
            </button>
          </div>
        )
      }
      data-trocar-varias={lista ? "lista" : "escopo"}
    >
      {lista ? (
        <CartaoDaAcaoNaAgenda key={lista.mensagemId} mensagemId={lista.mensagemId} acao={lista.acao} semMoldura />
      ) : (
        <div className="min-w-0 space-y-4">
          <div className="min-w-0">
            <span className={juntar(texto.rotulo, "mb-1 block")}>O que refazer</span>
            <SeletorCompacto
              rotulo="O que refazer"
              valor={escopo}
              onEscolher={(v) => setEscopo(v === "semana" && semana ? "semana" : "mes")}
              opcoes={[
                ...(semana ? [{ valor: "semana", rotulo: rotuloDaSemana }] : []),
                { valor: "mes", rotulo: "Mês inteiro" },
              ]}
            />
          </div>
          <label className={juntar(texto.corpo, "flex min-w-0 items-center")}>
            <input type="checkbox" className="mr-2 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={soNaoFeitas} onChange={(e) => setSoNaoFeitas(e.target.checked)} />
            Só as não feitas (as que estão em produção ficam)
          </label>
          <label className="block min-w-0 space-y-1">
            <span className={texto.rotulo}>Orientação (opcional)</span>
            <input className={campo} value={orientacao} maxLength={1200} onChange={(e) => setOrientacao(e.target.value)} placeholder="Ex.: mais bastidor e menos dica" aria-label="Orientação para as peças novas" />
          </label>
        </div>
      )}
    </JanelaCentral>
  );
}
