import { CampoDeFormulario, GrupoDeCampos, SeletorCompacto, campo } from "@/components/sistema";
import { dinheiro, nomeDoMes, proximoMes, type EstadoDoGanho } from "@/lib/comercial";

/**
 * 05/11/2026 (dono: "cliente deu metade de entrada e ali soma tudo; a mensalidade, se começa nesse mês ou no próximo").
 * Os mesmos campos ao fechar pelo quadro, ao fechar pela ficha do lead e ao corrigir um ganho que já existe.
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
  const falta = Number.isFinite(recebido) ? Math.max(0, entrada - recebido) : entrada;
  return (
    <GrupoDeCampos colunas={2}>
      {entrada > 0 && (
        <CampoDeFormulario rotulo={`Entrada de ${dinheiro(entrada)}`} largo>
          <SeletorCompacto
            opcoes={[{ valor: "avista", rotulo: "À vista" }, { valor: "parcelada", rotulo: "Parcelada" }]}
            valor={estado.entrada}
            onEscolher={(v) => mudar({ entrada: v as EstadoDoGanho["entrada"] })}
            rotulo="Como vem a entrada"
          />
        </CampoDeFormulario>
      )}
      {entrada > 0 && estado.entrada === "parcelada" && (
        <>
          <CampoDeFormulario rotulo="Já entrou (R$)" obrigatorio>
            <input inputMode="decimal" value={estado.recebido} onChange={(e) => mudar({ recebido: e.target.value })} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="O resto em (vezes)" obrigatorio apoio={`Falta ${dinheiro(falta)}`}>
            <input type="number" min="1" max="36" value={estado.parcelas} onChange={(e) => mudar({ parcelas: e.target.value })} className={campo} />
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
