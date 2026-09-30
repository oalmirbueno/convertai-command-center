import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario, GrupoDeCampos, botao, campo as estiloDoCampo, juntar, texto } from "@/components/sistema";
import { useProjects } from "@/hooks/useSupabaseData";
import { type PedidoDoDocumento, hojeEmSaoPaulo, inicioDoMesEmSaoPaulo } from "@/lib/documentos/registrarEntrega";
import { DEFINICOES_DE_DOCUMENTO, MODELOS_DE_DOCUMENTO, type ModeloDeDocumento, mesAnterior } from "../../../supabase/functions/_shared/documento-modelos";

/**
 * Começar um documento de entrega (frente BRF2, 30/09/2026): o modelo decide
 * o que perguntar. Mensal pede o mês; projeto, site e identidade pedem o
 * projeto; campanha pede o período. Nada é gerado aqui: abre o rascunho.
 *
 * Frente UXS: nasce preenchido no caso comum. Projeto único do cliente vem
 * escolhido (só depois que a lista de projetos chegou); o período vai do dia
 * 1 do mês até hoje, no horário de São Paulo. Sem projeto, o apoio leva a
 * criar um.
 */

export default function NovoDocumento({
  aberto,
  onFechar,
  clientId,
  marcaId,
  onComecar,
}: {
  aberto: boolean;
  onFechar: () => void;
  clientId: string;
  marcaId?: string | null;
  onComecar: (p: PedidoDoDocumento & { modelo: ModeloDeDocumento }) => void;
}) {
  const { data: projetos, isLoading: lendoProjetos } = useProjects();
  const [modelo, setModelo] = useState<ModeloDeDocumento>("mensal");
  const [mes, setMes] = useState(mesAnterior());
  const [projeto, setProjeto] = useState("");
  const [de, setDe] = useState(inicioDoMesEmSaoPaulo);
  const [ate, setAte] = useState(hojeEmSaoPaulo);
  const doCliente = useMemo(() => ((projetos as Array<{ id: string; name: string; client_id: string }> | undefined) || []).filter((p) => p.client_id === clientId), [projetos, clientId]);
  // O projeto guardado precisa ser deste cliente (trocar o cliente em Arquivos não leva o de outro).
  // Com um projeto só, ele vem escolhido; com dois ou mais, a pessoa escolhe.
  useEffect(() => {
    if (lendoProjetos) return;
    if (projeto && !doCliente.some((p) => p.id === projeto)) setProjeto("");
    else if (!projeto && doCliente.length === 1) setProjeto(doCliente[0].id);
  }, [doCliente, lendoProjetos]); // eslint-disable-line react-hooks/exhaustive-deps
  const tipo = DEFINICOES_DE_DOCUMENTO[modelo].tipoPadrao;
  const referencia = tipo === "mes_de_pautas" ? mes : tipo === "projeto" ? projeto : de && ate ? `${de}..${ate}` : "";
  const pronto = tipo === "mes_de_pautas" ? /^\d{4}-\d{2}$/.test(mes) : tipo === "projeto" ? !!projeto : !!de && !!ate && de <= ate;
  const semProjeto = !lendoProjetos && doCliente.length === 0;

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader className="text-left">
          <DialogTitle className={texto.tituloSecao}>Novo documento da entrega</DialogTitle>
          <DialogDescription className={texto.auxiliar}>Abre o rascunho com o que aconteceu. Sem custo.</DialogDescription>
        </DialogHeader>
        <GrupoDeCampos colunas={1}>
          <CampoDeFormulario rotulo="Modelo">
            <select className={estiloDoCampo} value={modelo} onChange={(e) => setModelo(e.target.value as ModeloDeDocumento)} aria-label="Modelo">
              {MODELOS_DE_DOCUMENTO.map((m) => <option key={m} value={m}>{DEFINICOES_DE_DOCUMENTO[m].nome}</option>)}
            </select>
          </CampoDeFormulario>
          {tipo === "mes_de_pautas" && (
            <CampoDeFormulario rotulo="Mês">
              <input type="month" className={estiloDoCampo} value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês" />
            </CampoDeFormulario>
          )}
          {tipo === "projeto" && (
            <div className="min-w-0">
              <CampoDeFormulario rotulo="Projeto" apoio={lendoProjetos ? "Carregando os projetos" : undefined}>
                <select className={estiloDoCampo} value={projeto} onChange={(e) => setProjeto(e.target.value)} disabled={lendoProjetos} aria-label="Projeto">
                  <option value="">Escolher...</option>
                  {doCliente.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </CampoDeFormulario>
              {semProjeto && (
                <p className={juntar(texto.auxiliar, "mt-1.5")}>
                  Este cliente ainda não tem projeto.{" "}
                  <Link to="/projetos" onClick={onFechar} className="font-medium text-primary hover:underline">
                    Criar projeto
                  </Link>
                </p>
              )}
            </div>
          )}
          {tipo === "periodo" && (
            <CampoDeFormulario rotulo="Período">
              <div className="flex min-w-0">
                <input type="date" className={estiloDoCampo} value={de} onChange={(e) => setDe(e.target.value)} aria-label="De" />
                <input type="date" className={`${estiloDoCampo} ml-2`} value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até" />
              </div>
            </CampoDeFormulario>
          )}
        </GrupoDeCampos>
        <DialogFooter className="[&>*+*]:mt-2 sm:[&>*+*]:mt-0">
          <button type="button" onClick={onFechar} className={botao.secundario}>Cancelar</button>
          <button type="button" disabled={!pronto} onClick={() => onComecar({ clientId, marcaId: marcaId ?? null, tipo, referencia, modelo })} className={botao.primario}>
            Abrir o rascunho
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
