import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type ContextoDosContratos, type PayloadDoContrato } from "@/lib/contratos/api";
import { moedaBr } from "../../../supabase/functions/_shared/contrato-modelo";
import { ROTULO_DO_SERVICO, SERVICOS_DO_CONTRATO } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Criar contrato pelo modelo (frente CON, 30/09): cliente e serviços. O
 * quadro-resumo já nasce com o cadastro do cliente, os padrões do dono e o que
 * a agência usou por último; o que faltar aparece em Dados. Sem os dados da
 * agência, não cria e diz o que falta.
 *
 * Frente CON2: três jeitos de começar. Pelos serviços (como antes), do
 * cliente (serviços ativos da ficha, plano do Financeiro e ficha fiscal) ou
 * da proposta aceita (lista as aceitas do cliente).
 */

type Origem = "servicos" | "cliente" | "proposta";
type PropostaAceita = { id: string; numero: string; titulo: string; total_unico: number; total_mensal: number; aceita_em: string | null; contrato_id: string | null };
export default function NovoContrato({
  aberto,
  aoFechar,
  clientes,
  clienteInicial,
  aoCriar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  clientes: Array<{ id: string; nome: string }>;
  clienteInicial?: string | null;
  aoCriar: (p: PayloadDoContrato) => void;
}) {
  const [clientId, setClientId] = useState(clienteInicial || "");
  const [servicos, setServicos] = useState<string[]>([]);
  const [titulo, setTitulo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [origem, setOrigem] = useState<Origem>("servicos");
  const [propostaId, setPropostaId] = useState("");
  const propostas = useQuery({
    queryKey: CHAVES_DOS_CONTRATOS.propostas(clientId || "nenhum"),
    enabled: aberto && origem === "proposta" && !!clientId,
    queryFn: () => chamarContratos<{ propostas: PropostaAceita[] }>("propostas_aceitas", { client_id: clientId }),
  });
  const contexto = useQuery({ queryKey: CHAVES_DOS_CONTRATOS.contexto, enabled: aberto, queryFn: () => chamarContratos<ContextoDosContratos>("contexto") });
  useEffect(() => {
    if (aberto) {
      setClientId(clienteInicial || "");
      setServicos([]);
      setTitulo("");
      setOrigem("servicos");
      setPropostaId("");
    }
  }, [aberto, clienteInicial]);
  const agencia = contexto.data ? contexto.data.agencia : null;

  const criar = async () => {
    setOcupado(true);
    try {
      const p =
        origem === "cliente"
          ? await chamarContratos("gerar_do_cliente", { client_id: clientId, titulo: titulo.trim() || undefined })
          : origem === "proposta"
            ? await chamarContratos("gerar_do_aceite", { proposta_id: propostaId })
            : await chamarContratos("criar", { client_id: clientId, servicos, titulo: titulo.trim() || undefined });
      if (origem !== "servicos") {
        const linhas = (p.origem || []).concat(p.avisos || []).concat(p.pergunta ? [p.pergunta] : []);
        toast.success(p.ja_existia ? "Esta proposta já tinha contrato" : "Rascunho montado", { description: linhas.join(" ") || undefined, duration: 9000 });
      }
      aoCriar(p);
    } catch (e) {
      toast.error("O contrato não foi criado", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo contrato pelo modelo</DialogTitle>
          <DialogDescription>Escolha o cliente e os serviços. O resto se preenche em Dados, ou pelo agente.</DialogDescription>
        </DialogHeader>
        {agencia && !agencia.completa && (
          <p className={juntar(texto.corpo, "flex items-start text-warning")} role="alert">
            <AlertTriangle className="mr-1.5 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Faltam os dados da agência: {agencia.faltando.join(", ")}.{" "}
              <Link to="/config" className="underline" onClick={aoFechar}>
                Preencher
              </Link>
            </span>
          </p>
        )}
        <SeletorCompacto
          rotulo="Começar"
          opcoes={[
            { valor: "servicos", rotulo: "Pelos serviços" },
            { valor: "cliente", rotulo: "Do cliente" },
            { valor: "proposta", rotulo: "Da proposta" },
          ]}
          valor={origem}
          onEscolher={(v) => setOrigem(v as Origem)}
        />
        <GrupoDeCampos colunas={1}>
          <CampoDeFormulario rotulo="Cliente" obrigatorio>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={campo}>
              <option value="">Selecione o cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Título" apoio="Opcional.">
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} className={campo} placeholder="Ex.: Contrato de social media 2026" />
          </CampoDeFormulario>
        </GrupoDeCampos>
        {origem === "cliente" && <p className={texto.auxiliar}>Usa os serviços ativos da ficha, o plano do Financeiro e a ficha fiscal. O que faltar aparece em Dados.</p>}
        {origem === "proposta" && (
          <CampoDeFormulario rotulo="Proposta aceita" obrigatorio apoio={propostas.isLoading ? "Lendo as propostas..." : propostas.data && !propostas.data.propostas.length ? "Este cliente não tem proposta aceita." : undefined}>
            <select value={propostaId} onChange={(e) => setPropostaId(e.target.value)} className={campo} disabled={!clientId}>
              <option value="">Escolha a proposta</option>
              {(propostas.data ? propostas.data.propostas : []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.numero} · {x.titulo}
                  {x.total_mensal ? ` · ${moedaBr(Number(x.total_mensal))}/mês` : x.total_unico ? ` · ${moedaBr(Number(x.total_unico))}` : ""}
                  {x.contrato_id ? " · já tem contrato" : ""}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        )}
        {origem === "servicos" && (
        <fieldset className="min-w-0">
          <legend className={juntar(texto.rotulo, "mb-2")}>Serviços</legend>
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {SERVICOS_DO_CONTRATO.map((s) => (
              <label key={s} className={juntar(texto.corpo, "flex min-w-0 cursor-pointer items-center")}>
                <Checkbox checked={servicos.indexOf(s) >= 0} onCheckedChange={(v) => setServicos((l) => (v ? l.concat([s]) : l.filter((x) => x !== s)))} className="mr-2" />
                <span className="truncate">{ROTULO_DO_SERVICO[s]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        )}
        <DialogFooter>
          <button type="button" className={botao.secundario} onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="button" className={botao.primario} onClick={() => void criar()} disabled={ocupado || !clientId || (origem === "servicos" && !servicos.length) || (origem === "proposta" && !propostaId) || (!!agencia && !agencia.completa)}>
            {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Criar rascunho
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
