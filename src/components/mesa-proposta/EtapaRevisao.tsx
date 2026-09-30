import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, History, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { conteudoSemNumeroInventado, dataCurta, dominio } from "../../../supabase/functions/_shared/proposta-modelo";
import { aplicarNaLista, chamarProposta, useVersoes, type ConferenciaDoDado, type Proposta } from "./propostaApi";
import { useConfirmarTirarOLink, useResolverPendencia } from "./navegacaoDaProposta";
import CompararVersoes from "./CompararVersoes";

/**
 * Etapa 3, Revisão: o que falta (bloqueia o envio ou só avisa), número sem
 * origem no material (aviso, a equipe decide), a conferência de cada dado de
 * mercado contra o trecho da fonte (Jev), a revisão da proposta inteira
 * (Jev hoje; o conselho de agentes da frente CNS entra no mesmo botão) e o
 * histórico com Comparar e Restaurar. Tudo é aviso: sem laço.
 *
 * Frente UXS (30/09): cada pendência tem "Resolver" (leva ao lugar que
 * conserta); cada fonte do mercado abre em um clique; Versões e Comparar
 * viraram o Histórico (recolhido); Restaurar tem Desfazer; "Salvar como
 * modelo" mora no menu do Envio.
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
  duplicacao: "cópia",
  preenchimento: "preenchimento",
  pacotes: "pacotes",
  margem: "margem",
  resumo: "resumo da reunião",
};

const URL_DA_FONTE = /^https?:\/\//i;
const pequeno = juntar(botao.discreto, "h-8 px-2 text-[12px]");

/** Material do cliente que vale como origem de número (o mesmo critério do servidor, na parte que a tela vê). */
export function origemNaTela(p: Proposta): string {
  const ctx = p.contexto || {};
  return [ctx.notas || "", ctx.transcricao || "", (ctx.materiais || []).map((m) => m.texto).join("\n"), p.itens.map((i) => `${i.quantidade} ${i.valor_unitario}`).join(" ")].join("\n");
}

export default function EtapaRevisao({ proposta }: { proposta: Proposta | null }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmarTirar = useConfirmarTirarOLink();
  const resolver = useResolverPendencia(proposta);
  const versoes = useVersoes(proposta ? proposta.id : null);
  const [revisando, setRevisando] = useState(false);
  const [revisao, setRevisao] = useState<{ avisos: string[]; notas: Record<string, number | null> } | null>(null);
  const [comparar, setComparar] = useState<number | null>(null);
  const semOrigem = useMemo(() => (proposta ? conteudoSemNumeroInventado(proposta.conteudo, origemNaTela(proposta)).tiradas : []), [proposta]);

  if (!proposta) return <EstadoVazio titulo="Nenhuma proposta aberta." descricao="Crie ou abra uma no Contexto." />;
  const conferencia = proposta.contexto.conferencia || [];
  const ultima = revisao || (proposta.contexto.revisao ? { avisos: proposta.contexto.revisao.avisos || [], notas: proposta.contexto.revisao.notas || {} } : null);
  const listaDeVersoes = versoes.data || [];
  // A versão escolhida sumiu da lista (restaurou, releu): a comparação zera.
  const escolhida = comparar !== null && listaDeVersoes.some((v) => v.versao === comparar) ? comparar : null;

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
    // Numa proposta enviada, restaurar tira o link do cliente: pergunta antes.
    if (!(await confirmarTirar(proposta.status, ["conteudo", "itens"], "Restaurar"))) return;
    const antes = proposta.versao;
    const voltouParaRascunho = proposta.status !== "rascunho";
    try {
      const d = await chamarProposta<any>("versao_restaurar", { proposta_id: proposta.id, versao: v });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      // Desfazer devolve o texto de antes; o link não volta (a proposta fica em rascunho).
      toast.success(`Versão ${v} restaurada. A atual ficou no histórico.`, {
        description: voltouParaRascunho ? "Voltou para rascunho: o link enviado parou de valer." : undefined,
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            chamarProposta<any>("versao_restaurar", { proposta_id: proposta.id, versao: antes })
              .then((r) => aplicarNaLista(qc, mesa.clientId, r && r.proposta))
              .catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
    } catch (e) {
      avisarErro(e, "A versão não foi restaurada");
    }
  };

  const bloqueiam = proposta.pendencias.filter((p) => p.bloqueia).length;
  return (
    <div className="min-w-0 space-y-6" data-etapa-proposta="revisao">
      <Secao titulo="O que falta" descricao={proposta.pendencias.length ? `${bloqueiam} bloqueiam o envio` : "Nada pendente"}>
        {proposta.pendencias.length ? (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="O que falta">
            {proposta.pendencias.map((p) => (
              <li key={p.chave} className={lista.linha}>
                <AlertTriangle className={juntar("mr-2 h-4 w-4 shrink-0", p.bloqueia ? "text-destructive" : "text-warning")} aria-hidden="true" />
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{p.texto}</span>
                {p.bloqueia && <span className={juntar(texto.auxiliar, "ml-3 hidden shrink-0 sm:inline")}>bloqueia</span>}
                {resolver && (
                  <button type="button" className={juntar(pequeno, "ml-2")} onClick={() => resolver(p.chave)} aria-label={`Resolver: ${p.texto}`}>
                    Resolver
                  </button>
                )}
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
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Fontes do mercado">
            {conferencia.map((c, i) => (
              <li key={`${c.url}-${i}`} className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {c.valor} · {c.rotulo}
                </span>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0", c.veredito === "contradiz" && "text-destructive", c.veredito === "confere" && "text-success")}>{VEREDITO[c.veredito] || c.veredito}</span>
                {/* A conferência mora no banco: a tela só abre endereço http(s). */}
                {URL_DA_FONTE.test(c.url || "") && (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className={juntar(botao.icone, "ml-1")} aria-label={`Abrir a fonte: ${c.rotulo}`} title={dominio(c.url)}>
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
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

      <Secao
        titulo="Histórico"
        divisoria
        recolhidaDeInicio
        descricao={versoes.data ? `Atual: v${proposta.versao} · ${listaDeVersoes.length} anteriores` : `Atual: v${proposta.versao}`}
        ajuda="Cada gravação guarda a versão de antes. Comparar mostra, logo abaixo da lista, o que mudou daquela versão até a atual, campo a campo e nos itens. Restaurar volta àquela versão (a atual fica no histórico) e tem Desfazer."
      >
        {versoes.isLoading ? (
          <Carregando forma="lista" linhas={3} rotulo="Lendo as versões" />
        ) : versoes.isError && !versoes.data ? (
          <EstadoDeErro
            titulo="As versões não foram lidas agora."
            acao={
              <button type="button" className={botao.secundario} onClick={() => void versoes.refetch()}>
                Tentar de novo
              </button>
            }
          />
        ) : listaDeVersoes.length ? (
          <>
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Versões anteriores">
              {listaDeVersoes.map((v) => (
                <li key={v.versao} className={juntar(lista.linha, escolhida === v.versao && lista.destaque)}>
                  <History className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className={juntar(texto.corpo, "shrink-0 tabular-nums")}>v{v.versao}</span>
                  <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate")}>
                    {ORIGEM[v.origem] || v.origem}
                    {v.nota ? `: ${v.nota}` : ""}
                  </span>
                  <span className={juntar(texto.auxiliar, "ml-3 hidden shrink-0 sm:inline")}>{dataCurta(v.criado_em.slice(0, 10))}</span>
                  <button type="button" className={juntar(pequeno, "ml-2")} aria-pressed={escolhida === v.versao} onClick={() => setComparar(escolhida === v.versao ? null : v.versao)} aria-label={`Comparar a v${v.versao} com a atual`}>
                    Comparar
                  </button>
                  <button type="button" className={pequeno} onClick={() => void restaurar(v.versao)} disabled={proposta.status === "aceita"} aria-label={`Restaurar a v${v.versao}`}>
                    Restaurar
                  </button>
                </li>
              ))}
            </ul>
            <CompararVersoes proposta={proposta} versao={escolhida} />
          </>
        ) : (
          <p className={texto.auxiliar}>Sem versões anteriores.</p>
        )}
      </Secao>
    </div>
  );
}
