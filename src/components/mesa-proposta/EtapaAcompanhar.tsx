import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CopyPlus, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useConfirm } from "@/components/shared/confirmDialog";
import Secao from "@/components/sistema/Secao";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataCurta, textoDoTotal } from "../../../supabase/functions/_shared/proposta-modelo";
import { ehNivel, normalizarPagamento, ROTULO_DO_NIVEL, ROTULO_DO_PAGAMENTO } from "../../../supabase/functions/_shared/proposta-comercial";
import { gerarContratoDoAceite, resumoDoRastreio, tempoLegivel, useEventos, type Proposta } from "./propostaApi";
import SeloDaProposta from "./SeloDaProposta";
import FollowupDaProposta from "./FollowupDaProposta";
import DuplicarProposta from "./DuplicarProposta";
import { useIrParaEtapa } from "./navegacaoDaProposta";

/**
 * Etapa 5, Acompanhar (frente PRS, 30/09): o que acontece depois do envio,
 * num lugar só. Antes ficava embaixo do Enviar, misturado com o link.
 * - Situação: aberturas, tempo de leitura e o aceite (nome, data, pacote e
 *   forma de pagamento), com a ação do momento: Gerar contrato (aceita),
 *   Duplicar (recusada) ou renovar a validade (vencida).
 * - Follow-up: o lembrete com a mensagem pronta (quem manda é a pessoa).
 * - Linha do tempo: tudo o que aconteceu com a proposta.
 * O rastreio não mostra número falso enquanto lê.
 */

const NOME_DO_EVENTO: Record<string, string> = {
  criada: "Criada",
  gerada: "Escrita pelo estrategista",
  pesquisada: "Mercado pesquisado",
  editada: "Editada depois do envio",
  revisada: "Revisada",
  enviada: "Link gerado",
  email_enviado: "E-mail enviado",
  aberta: "Aberta pelo cliente",
  aceita: "Aceita",
  recusada: "Recusada",
  expirada: "Expirou",
  arquivada: "Arquivada",
  restaurada: "Versão restaurada",
  contrato_pedido: "Contrato pedido",
  contrato_pendente: "Contrato aguardando a mesa de contratos",
  duplicada: "Criada como cópia",
  followup: "Follow-up feito",
  pacotes_montados: "Pacotes montados",
  anexo: "Anexo",
  preenchida: "Prévia do preenchimento",
};

export default function EtapaAcompanhar({ proposta, onAbrir }: { proposta: Proposta | null; onAbrir?: (id: string) => void }) {
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmar = useConfirm();
  const irPara = useIrParaEtapa();
  const eventos = useEventos(proposta ? proposta.id : null);
  const [gerandoContrato, setGerandoContrato] = useState(false);
  const [duplicando, setDuplicando] = useState(false);

  if (!proposta) return <EstadoVazio titulo="Nenhuma proposta aberta." descricao="Crie ou abra uma pelo seletor da proposta." />;
  const lendoEventos = eventos.isLoading;
  const erroNosEventos = eventos.isError && !eventos.data;
  const r = resumoDoRastreio(eventos.data || []);
  const opcaoAceita = proposta.pagamento_aceito ? normalizarPagamento(proposta.pagamento).opcoes.find((o) => o.id === proposta.pagamento_aceito) : null;
  const formaAceita = opcaoAceita ? ROTULO_DO_PAGAMENTO[opcaoAceita.tipo] : null;
  const status = proposta.status_efetivo;

  const gerarContrato = async () => {
    const ok = await confirmar({ title: "Gerar o contrato desta proposta?", description: "O contrato nasce em rascunho na mesa de contratos, com os valores e os itens aceitos. Nada vai ao cliente sem você.", confirmLabel: "Gerar contrato" });
    if (!ok) return;
    setGerandoContrato(true);
    try {
      const c = await gerarContratoDoAceite(proposta.id);
      void qc.invalidateQueries({ queryKey: ["mesa-proposta", "eventos", proposta.id] });
      toast.success(c.jaExistia ? "O contrato desta proposta já existia." : "Contrato em rascunho. Abra em Contratos.", { description: c.pergunta || undefined });
    } catch (e) {
      avisarErro(e, "O contrato não foi gerado");
    } finally {
      setGerandoContrato(false);
    }
  };

  const aceite = {
    rotulo: "Aceite",
    valor: proposta.aceite && proposta.aceite.nome ? (ehNivel(proposta.pacote_aceito) ? proposta.pacotes.nomes[proposta.pacote_aceito] || ROTULO_DO_NIVEL[proposta.pacote_aceito] : "Aceita") : "Não",
    apoio: proposta.aceite && proposta.aceite.nome ? `${proposta.aceite.nome}${proposta.aceita_em ? `, ${dataCurta(proposta.aceita_em.slice(0, 10))}` : ""}${formaAceita ? `, ${formaAceita}` : ""}` : undefined,
  };

  // A ação do momento, pelo status do dia.
  const acao =
    status === "aceita" ? (
      <button type="button" className={botao.primario} onClick={() => void gerarContrato()} disabled={gerandoContrato}>
        <FileSignature className="mr-1.5 h-4 w-4" />
        {gerandoContrato ? "Gerando..." : "Gerar contrato"}
      </button>
    ) : status === "rascunho" ? (
      <button type="button" className={botao.primario} onClick={() => irPara("envio")}>
        Ir para Enviar
        <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
      </button>
    ) : status === "recusada" ? (
      <button type="button" className={botao.secundario} onClick={() => setDuplicando(true)}>
        <CopyPlus className="mr-1.5 h-4 w-4" />
        Duplicar para refazer
      </button>
    ) : status === "expirada" ? (
      <button type="button" className={botao.secundario} onClick={() => irPara("contexto", "investimento")}>
        Renovar a validade
      </button>
    ) : undefined;
  const linha =
    status === "rascunho"
      ? "Ainda não enviada."
      : status === "aceita"
        ? "Aceita. O próximo passo é o contrato."
        : status === "recusada"
          ? "Recusada. Dá para duplicar e mandar outra versão."
          : status === "expirada"
            ? "Venceu. Com a validade nova, envie de novo."
            : r.ultima
              ? `Última abertura em ${dataCurta(r.ultima.slice(0, 10))}.`
              : "Enviada e ainda não aberta.";

  return (
    <div className="min-w-0 space-y-6" data-etapa-proposta="acompanhar">
      <Secao
        titulo="Situação"
        recolher={false}
        descricao={
          <span className="inline-flex items-center">
            <SeloDaProposta status={status} />
            <span className="ml-2">
              {textoDoTotal(proposta.totais)} · até {dataCurta(proposta.validade_ate) || "sem data"}
            </span>
          </span>
        }
        ajuda="Aberturas e tempo de leitura vêm da página do cliente. O aceite traz o nome, a data, o pacote e a forma de pagamento escolhidos. Aceita: Gerar contrato cria o contrato em rascunho na mesa de contratos (nada vai ao cliente sem você)."
        acao={acao}
      >
        <p className={juntar(texto.corpo, "mb-4")}>{linha}</p>
        <FaixaDeNumeros
          colunas={erroNosEventos ? 1 : 3}
          semMoldura
          itens={
            erroNosEventos
              ? [aceite]
              : [
                  { rotulo: "Aberturas", valor: lendoEventos ? "..." : String(r.aberturas) },
                  { rotulo: "Tempo de leitura", valor: lendoEventos ? "..." : tempoLegivel(r.segundos), apoio: !lendoEventos && r.maior ? `maior: ${tempoLegivel(r.maior)}` : undefined },
                  aceite,
                ]
          }
        />
      </Secao>

      <FollowupDaProposta proposta={proposta} />

      <Secao titulo="Linha do tempo" divisoria descricao={lendoEventos || erroNosEventos ? undefined : `${(eventos.data || []).length} registro(s)`}>
        {lendoEventos ? (
          <Carregando forma="lista" linhas={3} rotulo="Lendo o rastreio" />
        ) : erroNosEventos ? (
          <EstadoDeErro
            titulo="O rastreio não foi lido agora."
            acao={
              <button type="button" className={botao.secundario} onClick={() => void eventos.refetch()}>
                Tentar de novo
              </button>
            }
          />
        ) : (eventos.data || []).length ? (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Linha do tempo da proposta">
            {(eventos.data || []).slice(0, 30).map((e) => (
              <li key={e.id} className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {NOME_DO_EVENTO[e.tipo] || e.tipo}
                  {e.tipo === "aberta" && e.segundos ? ` · ${tempoLegivel(e.segundos)}` : ""}
                </span>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{new Date(e.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={texto.auxiliar}>Nada registrado ainda.</p>
        )}
      </Secao>
      {duplicando && <DuplicarProposta proposta={proposta} aberta={duplicando} onAberta={setDuplicando} onAbrir={onAbrir} />}
    </div>
  );
}
