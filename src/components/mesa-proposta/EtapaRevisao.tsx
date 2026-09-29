import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, History, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { conteudoSemNumeroInventado, dataCurta } from "../../../supabase/functions/_shared/proposta-modelo";
import { aplicarNaLista, chamarProposta, useVersoes, type ConferenciaDoDado, type Proposta } from "./propostaApi";

/**
 * Etapa 3, Revisão: o que falta (bloqueia o envio ou só avisa), número sem
 * origem no material (aviso, a equipe decide), a conferência de cada dado de
 * mercado contra o trecho da fonte (Jev), a revisão da proposta inteira
 * (Jev hoje; o conselho de agentes da frente CNS entra no mesmo botão), as
 * versões com Restaurar e "salvar como modelo". Tudo é aviso: sem laço.
 */

const VEREDITO: Record<ConferenciaDoDado["veredito"], string> = {
  confere: "confere com a fonte",
  contradiz: "a fonte diz outro número",
  nao_mostra: "a fonte não mostra isso",
  sem_trecho: "sem trecho da fonte para conferir",
  sem_conferencia: "não conferido",
};

const ORIGEM: Record<string, string> = {
  manual: "edição",
  agente: "estrategista",
  geracao: "geração",
  pesquisa: "pesquisa",
  restauracao: "restauração",
  envio: "envio",
};

/** Material do cliente que vale como origem de número (o mesmo critério do servidor, na parte que a tela vê). */
export function origemNaTela(p: Proposta): string {
  const ctx = p.contexto || {};
  return [ctx.notas || "", ctx.transcricao || "", (ctx.materiais || []).map((m) => m.texto).join("\n"), p.itens.map((i) => `${i.quantidade} ${i.valor_unitario}`).join(" ")].join("\n");
}

export default function EtapaRevisao({ proposta }: { proposta: Proposta | null }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const versoes = useVersoes(proposta ? proposta.id : null);
  const [revisando, setRevisando] = useState(false);
  const [revisao, setRevisao] = useState<{ avisos: string[]; notas: Record<string, number | null> } | null>(null);
  const [nomeDoModelo, setNomeDoModelo] = useState("");
  const [padrao, setPadrao] = useState(false);
  const [salvandoModelo, setSalvandoModelo] = useState(false);
  const semOrigem = useMemo(() => (proposta ? conteudoSemNumeroInventado(proposta.conteudo, origemNaTela(proposta)).tiradas : []), [proposta]);

  if (!proposta) return <EstadoVazio titulo="Nenhuma proposta aberta." descricao="Crie ou abra uma no Contexto." />;
  const conferencia = proposta.contexto.conferencia || [];
  const ultima = revisao || (proposta.contexto.revisao ? { avisos: proposta.contexto.revisao.avisos || [], notas: proposta.contexto.revisao.notas || {} } : null);

  const revisar = async () => {
    setRevisando(true);
    try {
      const d = await chamarProposta<any>("revisar", { proposta_id: proposta.id });
      setRevisao({ avisos: Array.isArray(d && d.avisos) ? d.avisos : [], notas: (d && d.notas) || {} });
      mesa.atualizarCusto();
    } catch (e) {
      avisarErro(e, "A revisão não rodou");
    } finally {
      setRevisando(false);
    }
  };

  const restaurar = async (v: number) => {
    try {
      const d = await chamarProposta<any>("versao_restaurar", { proposta_id: proposta.id, versao: v });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      toast.success(`Versão ${v} restaurada. A atual ficou no histórico.`);
    } catch (e) {
      avisarErro(e, "A versão não foi restaurada");
    }
  };

  const salvarModelo = async () => {
    setSalvandoModelo(true);
    try {
      await chamarProposta("modelo_salvar", { proposta_id: proposta.id, nome: nomeDoModelo.trim(), padrao });
      void qc.invalidateQueries({ queryKey: ["mesa-proposta", "modelos"] });
      setNomeDoModelo("");
      toast.success("Modelo salvo. Ele aparece em Nova proposta.");
    } catch (e) {
      avisarErro(e, "O modelo não foi salvo");
    } finally {
      setSalvandoModelo(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6" data-etapa-proposta="revisao">
      <Secao
        titulo="O que falta"
        descricao={proposta.pendencias.length ? `${proposta.pendencias.filter((p) => p.bloqueia).length} bloqueiam o envio` : "Nada pendente"}
      >
        {proposta.pendencias.length ? (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {proposta.pendencias.map((p) => (
              <li key={p.chave} className={lista.linha}>
                <AlertTriangle className={juntar("mr-2 h-4 w-4 shrink-0", p.bloqueia ? "text-destructive" : "text-warning")} aria-hidden="true" />
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{p.texto}</span>
                {p.bloqueia && <span className={juntar(texto.auxiliar, "ml-3 shrink-0")}>bloqueia</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={juntar(texto.corpo, "flex items-center")}>
            <CheckCircle2 className="mr-2 h-4 w-4 text-success" aria-hidden="true" /> Pronta para enviar.
          </p>
        )}
      </Secao>

      <Secao
        titulo="Números sem origem"
        divisoria
        descricao={semOrigem.length ? `${semOrigem.length} trecho(s)` : "Nenhum"}
        ajuda="Frases com número que não está nas notas, na transcrição, nos arquivos nem nos itens. Confirme com o cliente, ponha a fonte ou tire o número. É aviso: a decisão é da equipe."
      >
        {semOrigem.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {semOrigem.map((t) => (
              <li key={t} className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>
                {t}
              </li>
            ))}
          </ul>
        ) : (
          <p className={texto.auxiliar}>Todo número tem origem no material ou fonte.</p>
        )}
      </Secao>

      <Secao titulo="Fontes do mercado" divisoria descricao={conferencia.length ? `${conferencia.filter((c) => c.veredito === "confere").length} de ${conferencia.length} conferem` : "Sem dado de mercado"}>
        {conferencia.length ? (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {conferencia.map((c, i) => (
              <li key={`${c.url}-${i}`} className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {c.valor} · {c.rotulo}
                </span>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0", c.veredito === "contradiz" && "text-destructive", c.veredito === "confere" && "text-success")}>{VEREDITO[c.veredito] || c.veredito}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={texto.auxiliar}>Peça a pesquisa de mercado no Rascunho.</p>
        )}
      </Secao>

      <Secao
        titulo="Revisão da proposta"
        divisoria
        descricao={ultima ? `${ultima.avisos.length} aviso(s)` : undefined}
        ajuda="Clareza para quem lê no celular, promessa de resultado e se o desafio usa as palavras do cliente. É aviso, não bloqueia. O conselho de agentes entra aqui quando estiver no painel."
        acao={
          <button type="button" className={botao.secundario} onClick={() => void revisar()} disabled={revisando}>
            <ShieldCheck className="mr-1.5 h-4 w-4" />
            {revisando ? "Revisando..." : "Revisar"}
          </button>
        }
      >
        {ultima ? (
          ultima.avisos.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {ultima.avisos.map((a) => (
                <li key={a} className={texto.corpo}>
                  {a}
                </li>
              ))}
            </ul>
          ) : (
            <p className={juntar(texto.corpo, "flex items-center")}>
              <CheckCircle2 className="mr-2 h-4 w-4 text-success" aria-hidden="true" /> Sem aviso na última revisão.
            </p>
          )
        ) : (
          <p className={texto.auxiliar}>Ainda não revisada.</p>
        )}
      </Secao>

      <Secao titulo="Versões" divisoria descricao={`Atual: ${proposta.versao}`}>
        {(versoes.data || []).length ? (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {(versoes.data || []).map((v) => (
              <li key={v.versao} className={lista.linha}>
                <History className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className={juntar(texto.corpo, "shrink-0 tabular-nums")}>v{v.versao}</span>
                <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate")}>
                  {ORIGEM[v.origem] || v.origem}
                  {v.nota ? `: ${v.nota}` : ""}
                </span>
                <span className={juntar(texto.auxiliar, "ml-3 hidden shrink-0 sm:inline")}>{dataCurta(v.criado_em.slice(0, 10))}</span>
                <button type="button" className={juntar(botao.discreto, "ml-2 h-8 px-2 text-[12px]")} onClick={() => void restaurar(v.versao)} disabled={proposta.status === "aceita"}>
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={texto.auxiliar}>Sem versões anteriores.</p>
        )}
      </Secao>

      <Secao titulo="Salvar como modelo" divisoria ajuda="Guarda a estrutura, o processo, as condições e os próximos passos desta proposta (sem o texto do cliente) para as próximas.">
        <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <CampoDeFormulario rotulo="Nome do modelo">
            <input value={nomeDoModelo} onChange={(e) => setNomeDoModelo(e.target.value)} maxLength={80} className={campo} placeholder="Ex.: Identidade visual" />
          </CampoDeFormulario>
          <label className={juntar(texto.corpo, "inline-flex h-9 items-center")}>
            <input type="checkbox" className="mr-2" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} />
            Padrão
          </label>
          <button type="button" className={botao.secundario} onClick={() => void salvarModelo()} disabled={nomeDoModelo.trim().length < 3 || salvandoModelo}>
            {salvandoModelo ? "Salvando..." : "Salvar modelo"}
          </button>
        </div>
      </Secao>
    </div>
  );
}
