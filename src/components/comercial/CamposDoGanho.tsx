import { CampoDeFormulario, GrupoDeCampos, SeletorCompacto, campo } from "@/components/sistema";
import { dinheiro, nomeDoMes, proximoMes, type EstadoDoGanho } from "@/lib/comercial";

/**
 * 05/11/2026 (dono: "entrou a entrada e o restante fica dividido em quantas vezes; a mensalidade, se começa nesse mês ou
 * no próximo"). Os mesmos campos ao fechar e ao corrigir um ganho que já existe.
 */
export default function CamposDoGanho({ entrada, mensalidade, mes, estado, onMudar }: {
  entrada: number;
  mensalidade: number;
  /** Mês de referência das opções (AAAA-MM-01). */
  mes: string;
  estado: EstadoDoGanho;
  onMudar: (estado: EstadoDoGanho) => void;
}) {
  if (!(entrada > 0) && !(mensalidade > 0)) return null;
  const mudar = (parte: Partial<EstadoDoGanho>) => onMudar({ ...estado, ...parte });
  const recebido = Number(String(estado.recebido).replace(",", "."));
  const vezes = Number(estado.parcelas) || 1;
  const falta = Number.isFinite(recebido) ? Math.max(0, entrada - recebido) : entrada;
  const faltam = recebido > 0 ? vezes - 1 : vezes;
  const resumo = faltam >= 1 && falta > 0 ? `${recebido > 0 ? `${dinheiro(recebido)} agora + ` : ""}${faltam}x de ${dinheiro(falta / faltam)}` : undefined;
  return (
    <GrupoDeCampos colunas={2}>
      {entrada > 0 && (
        <CampoDeFormulario rotulo={`Pagamento de ${dinheiro(entrada)}`} largo apoio={estado.entrada === "avista" ? "Entra no Financeiro como recebido hoje." : undefined}>
          <SeletorCompacto
            opcoes={[{ valor: "avista", rotulo: "À vista" }, { valor: "parcelada", rotulo: "Parcelado" }]}
            valor={estado.entrada}
            onEscolher={(v) => mudar({ entrada: v as EstadoDoGanho["entrada"] })}
            rotulo="Como vem o pagamento"
          />
        </CampoDeFormulario>
      )}
      {entrada > 0 && estado.entrada === "parcelada" && (
        <>
          <CampoDeFormulario rotulo="Em quantas vezes" obrigatorio apoio={resumo}>
            <input
              type="number"
              min="1"
              max="36"
              value={estado.parcelas}
              onChange={(e) => {
                const n = Number(e.target.value);
                // A entrada acompanha a divisão; continua editável para quando for diferente.
                mudar({ parcelas: e.target.value, ...(n >= 1 ? { recebido: String(Math.round((entrada / n) * 100) / 100) } : {}) });
              }}
              className={campo}
            />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Já entrou (R$)" obrigatorio apoio="Zero se ainda não pagou nada.">
            <input inputMode="decimal" value={estado.recebido} onChange={(e) => mudar({ recebido: e.target.value })} className={campo} />
          </CampoDeFormulario>
        </>
      )}
      {mensalidade > 0 && (
        <CampoDeFormulario rotulo={`Mensalidade de ${dinheiro(mensalidade)} começa em`} largo>
          <SeletorCompacto
            opcoes={[
              { valor: "este", rotulo: `Este mês (${nomeDoMes(mes)})` },
              { valor: "proximo", rotulo: `Próximo mês (${nomeDoMes(proximoMes(mes))})` },
            ]}
            valor={estado.inicio}
            onEscolher={(v) => mudar({ inicio: v as EstadoDoGanho["inicio"] })}
            rotulo="Quando a mensalidade começa"
          />
        </CampoDeFormulario>
      )}
    </GrupoDeCampos>
  );
}
