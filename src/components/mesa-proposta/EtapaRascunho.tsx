import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Palette, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { PreencherComIA } from "@/components/sistema";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, campo, campoTexto, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { gravarEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import {
  blocoDoTipo,
  blocoVazio,
  comBloco,
  dataCurta,
  ehTipoDeBloco,
  normalizarConteudo,
  ROTULO_DO_BLOCO,
  ROTULO_DO_STATUS,
  type Bloco,
  type ConteudoDaProposta,
  type DadosDoBloco,
  type TipoDeBloco,
} from "../../../supabase/functions/_shared/proposta-modelo";
import {
  aplicarValoresNoConteudo,
  blocoDasProvas,
  camposDoBloco,
  mesclarPorChaves,
  normalizarVisual,
  provaPodeEntrar,
  TEMAS_DA_PROPOSTA,
  tiraOLink,
  type CampoDoBloco,
  type TemaDaProposta,
  type VisualDaProposta,
} from "../../../supabase/functions/_shared/proposta-comercial";
import { contextoDoUpsell } from "../../../supabase/functions/mesa-proposta/modulos/proposta-upsell";
import PropostaDocumento from "./PropostaDocumento";
// Frente MOD (30/09): coleta de dados públicos de concorrentes pelo navegador do agente (pronta e desligada).
import { BotaoDoNavegador, TarefasDoNavegador } from "@/components/agentes/NavegadorDoAgente";
import AvisoDaAgencia from "./AvisoDaAgencia";
import PreviaDoPreenchimento from "./PreviaDoPreenchimento";
import AnexosDaProposta from "./AnexosDaProposta";
import { aplicarNaLista, chamarProposta, useProvas, type Proposta } from "./propostaApi";
import { AvisoDeMudanca, BarraDoSalvar, useRascunhoComBase, type SecaoSuja } from "./edicaoDaProposta";
import { rolarAte, useConfirmarTirarOLink, useFocoDeChegada } from "./navegacaoDaProposta";
import { AjustesDaIA, useAjustesDaGeracao } from "./GeracaoDaProposta";
import ProximoPasso from "./ProximoPasso";

/**
 * Etapa 2, Rascunho: gerar com o estrategista (custo antes, pesquisa de
 * mercado na web ligada), editar bloco a bloco e ver a página do cliente ao
 * lado, ao vivo. Listas se editam uma por linha; pares como "Título | texto".
 * O mercado só aceita o que veio com fonte (dá para tirar, não para escrever
 * número sem fonte). Provas vêm da biblioteca (só o autorizado) e quem somos,
 * dos dados da agência.
 *
 * Frente PRO2: "Preencher tudo" com prévia campo a campo (fontes escolhidas:
 * reunião, briefing, contexto e o site do cliente), "Preencher com IA" em
 * cada bloco e em cada campo (peça comum da frente PIA), 3 headlines para a
 * capa, reescrever um bloco no tom da marca e o modelo visual da proposta.
 * Nada é gravado sem a pessoa ver; tudo tem Desfazer.
 *
 * Frente UXS (30/09): um Salvar só, na barra do pé, que leva os blocos e o
 * modelo visual juntos. O rascunho fica no navegador pela proposta (sem a
 * versão na chave): versão nova não apaga o que foi digitado, e a linha "A
 * proposta mudou" aparece só se o texto mudou no banco. Os anexos moram aqui,
 * embaixo do Modelo visual. Numa proposta enviada, gravar pergunta antes.
 *
 * Frente PRS (30/09), "completa e confusa": eram quatro botões de gerar lado a
 * lado (Preencher tudo, Gerar de novo, Só o mercado e o Sugerir do upsell),
 * mais quatro caixas de fonte, o site e o seletor de modelo abertos no topo.
 * Agora há um botão só: "Gerar o rascunho" quando ainda não há texto (grava
 * direto: não há o que perder) e "Gerar de novo" depois, que sempre mostra a
 * prévia campo a campo antes de gravar. Gravar direto sem prévia e pesquisar
 * só o mercado continuam em "Ajustes da IA", junto do modelo e das fontes
 * (recolhido). Os blocos e a prévia vêm logo embaixo; o modelo visual e os
 * anexos, depois deles. A etapa termina em "Seguir para Revisar".
 */

const linhas = (v: string[]) => v.join("\n");
const deLinhas = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const pares = (v: Array<{ a: string; b: string }>) => v.map((x) => (x.b ? `${x.a} | ${x.b}` : x.a)).join("\n");
const dePares = (s: string) =>
  deLinhas(s).map((l) => {
    const i = l.indexOf("|");
    return i < 0 ? { a: l, b: "" } : { a: l.slice(0, i).trim(), b: l.slice(i + 1).trim() };
  });

/** O que os campos precisam para o "Preencher com IA" (sem passar por cada componente). */
type IaDoRascunho = {
  clientId: string;
  marcaId: string | null;
  contexto: string;
  desligado: boolean;
  campos: (b: Bloco) => CampoDoBloco[];
  aplicar: (valores: Record<string, unknown>) => void;
};
const ContextoDaIa = createContext<IaDoRascunho | null>(null);

/** O campo com o botão pequeno do "Preencher com IA" ao lado. */
function ComIA({ b, chave, children }: { b: Bloco; chave: string; children: ReactNode }) {
  const ia = useContext(ContextoDaIa);
  const campo = ia ? ia.campos(b).find((c) => c.chave === chave) : null;
  if (!ia || !campo || ia.desligado) return <>{children}</>;
  return (
    <div className="flex min-w-0 items-end">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="mb-0.5 ml-1 shrink-0">
        <PreencherComIA
          papel="proposta"
          clientId={ia.clientId}
          marcaId={ia.marcaId}
          campos={[campo]}
          contexto={ia.contexto}
          fontes={["contexto", "briefing", "dossie", "arquivos"]}
          compacto
          onAplicar={(valores) => ia.aplicar(valores)}
          onDesfazer={(anteriores) => ia.aplicar(anteriores)}
        />
      </div>
    </div>
  );
}

function Area({ b, chave, rotulo, valor, onMudar, altura = "min-h-[88px]", dica }: { b: Bloco; chave?: string; rotulo: string; valor: string; onMudar: (v: string) => void; altura?: string; dica?: string }) {
  const corpo = (
    <CampoDeFormulario rotulo={rotulo} apoio={dica}>
      <textarea value={valor} onChange={(e) => onMudar(e.target.value)} className={juntar(campoTexto, altura)} />
    </CampoDeFormulario>
  );
  return chave ? (
    <ComIA b={b} chave={chave}>
      {corpo}
    </ComIA>
  ) : (
    corpo
  );
}

function Linha({ b, chave, rotulo, valor, onMudar }: { b: Bloco; chave?: string; rotulo: string; valor: string; onMudar: (v: string) => void }) {
  const corpo = (
    <CampoDeFormulario rotulo={rotulo}>
      <input value={valor} onChange={(e) => onMudar(e.target.value)} className={campo} />
    </CampoDeFormulario>
  );
  return chave ? (
    <ComIA b={b} chave={chave}>
      {corpo}
    </ComIA>
  ) : (
    corpo
  );
}

/** Provas da biblioteca: só o que tem autorização registrada entra. */
function EscolhaDasProvas({ b, mudar }: { b: Bloco; mudar: (dados: Record<string, unknown>) => void }) {
  const provas = useProvas();
  const x = b.dados as DadosDoBloco["provas"];
  const vivas = (provas.data ? provas.data.lista : []).filter((p) => !p.arquivado);
  const escolhida = (p: (typeof vivas)[number]) => (p.tipo === "case" ? x.cases.some((c) => c.titulo === p.titulo) : x.depoimentos.some((d) => d.texto === p.texto));
  const alternar = (p: (typeof vivas)[number], sim: boolean) => {
    const atuais = vivas.filter((v) => (v.id === p.id ? sim : escolhida(v)));
    mudar(blocoDasProvas(atuais).dados);
  };
  if (!vivas.length) return <p className={texto.auxiliar}>{x.cases.length || x.depoimentos.length ? `${x.cases.length} case(s) e ${x.depoimentos.length} depoimento(s).` : "Sem case cadastrado. Cadastre na Biblioteca comercial (no ... da proposta)."}</p>;
  return (
    <ul className="min-w-0 space-y-1" aria-label="Provas da biblioteca">
      {vivas.map((p) => {
        const pode = provaPodeEntrar(p);
        return (
          <li key={p.id}>
            <label className={juntar(texto.corpo, "flex min-w-0 items-center", !pode && "text-muted-foreground")}>
              <input type="checkbox" className="mr-2 shrink-0" disabled={!pode} checked={pode && escolhida(p)} onChange={(e) => alternar(p, e.target.checked)} />
              <span className="min-w-0 flex-1 truncate">{p.tipo === "case" ? p.titulo : `${p.nome}: ${p.texto}`}</span>
              {!pode && <span className={juntar(etiqueta, "ml-2 shrink-0 text-warning")}>sem autorização</span>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Os campos de um bloco. `mudar` recebe os dados novos inteiros. */
/** Pedir ao navegador do agente os dados públicos de um concorrente (desligado até o dono testar o computer use). */
function ColetaDeConcorrentes() {
  const mesa = useMesa();
  return (
    <div className="min-w-0 pt-1">
      <BotaoDoNavegador caso="coleta_publica" clientId={mesa.clientId} origem="proposta" rotulo="Coletar dados de um concorrente" compacto />
      <TarefasDoNavegador clientId={mesa.clientId} origem="proposta" titulo="Coletas do navegador" />
    </div>
  );
}

function CamposDoBloco({ b, mudar }: { b: Bloco; mudar: (dados: Record<string, unknown>) => void }) {
  const d = b.dados as Record<string, unknown>;
  const m = (campoMudado: Record<string, unknown>) => mudar({ ...d, ...campoMudado });
  switch (b.tipo) {
    case "ja_tem": {
      // PRO3: serviços, plano e resultados vêm do painel ("Reler os dados de hoje"); a pessoa pode tirar ou ajustar.
      const x = b.dados as DadosDoBloco["ja_tem"];
      return (
        <>
          <Area b={b} chave="ja_tem.texto" rotulo="Abertura" valor={x.texto} onMudar={(v) => m({ texto: v })} />
          <Area b={b} rotulo="Serviços que já tem" dica="Um por linha" valor={linhas(x.servicos)} onMudar={(v) => m({ servicos: deLinhas(v) })} />
          <Linha b={b} rotulo="Plano atual" valor={x.plano} onMudar={(v) => m({ plano: v })} />
          <Area b={b} rotulo="Resultados reais" dica="Título | texto, um por linha (só o que o painel mediu)" valor={pares(x.resultados.map((r) => ({ a: r.titulo, b: r.texto })))} onMudar={(v) => m({ resultados: dePares(v).map((p) => ({ titulo: p.a, texto: p.b })) })} />
        </>
      );
    }
    case "capa": {
      const x = b.dados as DadosDoBloco["capa"];
      return (
        <>
          <Linha b={b} chave="capa.headline" rotulo="Headline" valor={x.headline} onMudar={(v) => m({ headline: v })} />
          <Linha b={b} chave="capa.subtitulo" rotulo="Subtítulo" valor={x.subtitulo} onMudar={(v) => m({ subtitulo: v })} />
          <Linha b={b} chave="capa.projeto" rotulo="Projeto" valor={x.projeto} onMudar={(v) => m({ projeto: v })} />
        </>
      );
    }
    case "desafio": {
      const x = b.dados as DadosDoBloco["desafio"];
      return (
        <>
          <Area b={b} chave="desafio.texto" rotulo="Texto" valor={x.texto} onMudar={(v) => m({ texto: v })} altura="min-h-[120px]" />
          <Area b={b} chave="desafio.palavras_do_cliente" rotulo="Palavras do cliente" dica="Uma fala por linha" valor={linhas(x.palavras_do_cliente)} onMudar={(v) => m({ palavras_do_cliente: deLinhas(v) })} />
          <Area b={b} chave="desafio.compromisso" rotulo="Compromisso" valor={x.compromisso} onMudar={(v) => m({ compromisso: v })} />
        </>
      );
    }
    case "diagnostico": {
      const x = b.dados as DadosDoBloco["diagnostico"];
      return (
        <Area
          b={b}
          chave="diagnostico.achados"
          rotulo="Achados"
          dica="Título | texto, um por linha (a fonte de cada um fica)"
          altura="min-h-[120px]"
          valor={pares(x.achados.map((a) => ({ a: a.titulo, b: a.texto })))}
          onMudar={(v) => m({ achados: dePares(v).map((p, i) => ({ titulo: p.a, texto: p.b, fonte: x.achados[i] ? x.achados[i].fonte : null })) })}
        />
      );
    }
    case "mercado": {
      const x = b.dados as DadosDoBloco["mercado"];
      return (
        <>
          <Area b={b} rotulo="Resumo" valor={x.resumo} onMudar={(v) => m({ resumo: v })} />
          <div className="min-w-0 space-y-1" aria-label="Dados com fonte">
            <span className={texto.rotulo}>Dados e concorrentes com fonte{x.pesquisado_em ? ` (pesquisa de ${dataCurta(x.pesquisado_em)})` : ""}</span>
            {!x.dados.length && !x.concorrentes.length && <p className={texto.auxiliar}>Nada com fonte ainda. Peça a pesquisa.</p>}
            {x.dados.map((dado, i) => (
              <div key={`d-${i}`} className="flex min-w-0 items-center">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {dado.valor} · {dado.rotulo}
                </span>
                <button type="button" className={botao.icone} aria-label={`Tirar ${dado.valor}`} onClick={() => m({ dados: x.dados.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {x.concorrentes.map((c, i) => (
              <div key={`c-${i}`} className="flex min-w-0 items-center">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{c.nome}</span>
                <button type="button" className={botao.icone} aria-label={`Tirar ${c.nome}`} onClick={() => m({ concorrentes: x.concorrentes.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <ColetaDeConcorrentes />
            {x.faixa_de_preco && (
              <div className="flex min-w-0 items-center">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>Faixa: {x.faixa_de_preco.texto}</span>
                <button type="button" className={botao.icone} aria-label="Tirar a faixa de preço" onClick={() => m({ faixa_de_preco: null })}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </>
      );
    }
    case "solucao": {
      const x = b.dados as DadosDoBloco["solucao"];
      return (
        <>
          <Area b={b} chave="solucao.texto" rotulo="Texto" valor={x.texto} onMudar={(v) => m({ texto: v })} />
          <Area b={b} chave="solucao.frentes" rotulo="Frentes" dica="Título | texto, uma por linha" valor={pares(x.frentes.map((f) => ({ a: f.titulo, b: f.texto })))} onMudar={(v) => m({ frentes: dePares(v).map((p) => ({ titulo: p.a, texto: p.b })) })} />
        </>
      );
    }
    case "entregaveis": {
      const x = b.dados as DadosDoBloco["entregaveis"];
      return (
        <>
          <Area b={b} chave="entregaveis.itens" rotulo="O que recebe" dica="Nome | detalhe, um por linha" altura="min-h-[120px]" valor={pares(x.itens.map((i) => ({ a: i.nome, b: i.detalhe })))} onMudar={(v) => m({ itens: dePares(v).map((p) => ({ nome: p.a, detalhe: p.b })) })} />
          <Area b={b} chave="entregaveis.nao_inclui" rotulo="Não inclui" dica="Um por linha" valor={linhas(x.nao_inclui)} onMudar={(v) => m({ nao_inclui: deLinhas(v) })} />
        </>
      );
    }
    case "processo": {
      const x = b.dados as DadosDoBloco["processo"];
      return <Area b={b} chave="processo.etapas" rotulo="Etapas" dica="Título | texto, uma por linha, na ordem" altura="min-h-[120px]" valor={pares(x.etapas.map((e) => ({ a: e.titulo, b: e.texto })))} onMudar={(v) => m({ etapas: dePares(v).map((p) => ({ titulo: p.a, texto: p.b })) })} />;
    }
    case "cronograma": {
      const x = b.dados as DadosDoBloco["cronograma"];
      return (
        <>
          <Area
            b={b}
            chave="cronograma.marcos"
            rotulo="Marcos"
            dica="Quando | marco, um por linha (semana 1, semanas 2 a 3 viram barras)"
            valor={pares(x.marcos.map((mm) => ({ a: mm.quando, b: mm.titulo })))}
            onMudar={(v) => m({ marcos: dePares(v).map((p) => (p.b ? { quando: p.a, titulo: p.b } : { quando: "", titulo: p.a })) })}
          />
          <Area b={b} chave="cronograma.observacao" rotulo="Observação" valor={x.observacao} onMudar={(v) => m({ observacao: v })} />
        </>
      );
    }
    case "investimento": {
      const x = b.dados as DadosDoBloco["investimento"];
      return (
        <>
          <Area b={b} chave="investimento.intangiveis" rotulo="Intangíveis" dica="Um por linha; o valor sai dos itens da Conversa" valor={linhas(x.intangiveis)} onMudar={(v) => m({ intangiveis: deLinhas(v) })} />
          <Area b={b} chave="investimento.condicoes" rotulo="Condições" valor={x.condicoes} onMudar={(v) => m({ condicoes: v })} />
          <Linha b={b} rotulo="Observação" valor={x.observacao} onMudar={(v) => m({ observacao: v })} />
        </>
      );
    }
    case "provas":
      return <EscolhaDasProvas b={b} mudar={mudar} />;
    case "quem_somos": {
      const x = b.dados as DadosDoBloco["quem_somos"];
      return <Area b={b} rotulo="Texto" valor={x.texto} onMudar={(v) => m({ texto: v })} />;
    }
    case "proximos_passos": {
      const x = b.dados as DadosDoBloco["proximos_passos"];
      return (
        <>
          <Area b={b} chave="proximos_passos.passos" rotulo="Passos" dica="Um por linha" valor={linhas(x.passos)} onMudar={(v) => m({ passos: deLinhas(v) })} />
          <Linha b={b} chave="proximos_passos.chamada" rotulo="Chamada" valor={x.chamada} onMudar={(v) => m({ chamada: v })} />
        </>
      );
    }
    default:
      return null;
  }
}

/** 3 headlines para a capa (a pessoa escolhe; nada é gravado sozinho). */
function TresHeadlines({ proposta, modeloId, desligado, onEscolher }: { proposta: Proposta; modeloId: string; desligado: boolean; onEscolher: (h: string) => void }) {
  const [opcoes, setOpcoes] = useState<string[]>([]);
  return (
    <div className="min-w-0" data-tres-headlines="">
      <BotaoComCusto
        rotulo={
          <>
            <Wand2 className="mr-1.5 h-4 w-4" />3 headlines
          </>
        }
        titulo="Gerar 3 headlines"
        variant="outline"
        disabled={desligado || !modeloId}
        partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 6000, tokensSaida: 400 }]}
        executar={() => chamarProposta("headlines", { proposta_id: proposta.id, modelo_id: modeloId || undefined })}
        aoConcluir={(d: any) => setOpcoes(d && Array.isArray(d.opcoes) ? d.opcoes : [])}
      />
      {opcoes.length > 0 && (
        <ul className="mt-2 min-w-0 space-y-1" aria-label="Headlines sugeridas">
          {opcoes.map((h) => (
            <li key={h}>
              <button
                type="button"
                className={juntar(botao.discreto, "h-auto w-full justify-start whitespace-normal py-1.5 text-left")}
                onClick={() => {
                  onEscolher(h);
                  setOpcoes([]);
                }}
              >
                {h}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reescrever o bloco no tom da marca: prévia e aplicar no rascunho. */
function TomDaMarca({ proposta, b, modeloId, desligado, conteudo, onAplicar }: { proposta: Proposta; b: Bloco; modeloId: string; desligado: boolean; conteudo: ConteudoDaProposta; onAplicar: (valores: Record<string, unknown>) => void }) {
  const [valores, setValores] = useState<Record<string, unknown> | null>(null);
  const proposto = useMemo(() => (valores ? aplicarValoresNoConteudo(conteudo, valores).conteudo : null), [valores, conteudo]);
  return (
    <div className="min-w-0" data-tom-da-marca={b.tipo}>
      {!valores && (
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-4 w-4" />
              Tom da marca
            </>
          }
          titulo={`Reescrever ${b.titulo} no tom da marca`}
          variant="outline"
          disabled={desligado || !modeloId}
          partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 6000, tokensSaida: 1500 }]}
          executar={() => chamarProposta("tom_da_marca", { proposta_id: proposta.id, bloco: b.tipo, dados: b.dados, modelo_id: modeloId || undefined })}
          aoConcluir={(d: any) => setValores(d && d.valores && typeof d.valores === "object" ? d.valores : null)}
        />
      )}
      {valores && proposto && (
        <div className="mt-2 min-w-0">
          <PreviaDoPreenchimento
            atual={conteudo}
            proposto={proposto}
            titulo="No tom da marca"
            onDescartar={() => setValores(null)}
            onAplicar={(chaves) => {
              const escolhidos: Record<string, unknown> = {};
              for (const k of chaves) if (k in valores) escolhidos[k] = valores[k];
              onAplicar(escolhidos);
              setValores(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** PRO3: relê serviços, plano e resultados do cliente (sem IA; grava uma versão nova, com Desfazer pela versão). */
function RelerORetrato({ proposta, onRelido }: { proposta: Proposta; onRelido: () => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmarTirar = useConfirmarTirarOLink();
  const [ocupado, setOcupado] = useState(false);
  const reler = async () => {
    // Reler grava o bloco: numa proposta enviada, tira o link do cliente.
    if (!(await confirmarTirar(proposta.status, ["conteudo"], "Reler"))) return;
    setOcupado(true);
    const versaoAntes = proposta.versao;
    try {
      const d = await chamarProposta<any>("upsell_atualizar", { proposta_id: proposta.id });
      onRelido();
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      const avisos: string[] = d && Array.isArray(d.avisos_upsell) ? d.avisos_upsell : [];
      toast.success("Dados de hoje no bloco.", {
        description: avisos.length ? avisos.join(" ") : undefined,
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            chamarProposta<any>("versao_restaurar", { proposta_id: proposta.id, versao: versaoAntes })
              .then((r) => aplicarNaLista(qc, mesa.clientId, r && r.proposta))
              .catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
    } catch (e) {
      avisarErro(e, "Os dados de hoje não foram lidos");
    } finally {
      setOcupado(false);
    }
  };
  return (
    <button type="button" className={botao.secundario} onClick={() => void reler()} disabled={ocupado} data-reler-retrato="">
      <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {ocupado ? "Lendo..." : "Reler os dados de hoje"}
    </button>
  );
}

function EditorDoBloco({
  b,
  chave,
  emFoco,
  onFoco,
  mudar,
  extra,
  abertoDeInicio = false,
}: {
  b: Bloco;
  chave: string;
  emFoco: boolean;
  onFoco: () => void;
  mudar: (m: Partial<Pick<Bloco, "titulo" | "visivel" | "dados">>) => void;
  extra?: ReactNode;
  /** PRO3: no upsell, "O que você já tem" e o "Próximo passo" começam abertos. */
  abertoDeInicio?: boolean;
}) {
  const [recolhido, setRecolhido] = useRecolhido(chave, !abertoDeInicio);
  const ia = useContext(ContextoDaIa);
  const campos = ia ? ia.campos(b) : [];
  return (
    <li className={juntar("min-w-0 border-t border-border pt-3", emFoco && "bg-primary/[0.04]")} data-editor-do-bloco={b.tipo} onFocusCapture={onFoco}>
      <div className="flex min-w-0 items-center">
        <TituloRecolhivel
          titulo={b.titulo}
          resumo={b.visivel ? ROTULO_DO_BLOCO[b.tipo] : `${ROTULO_DO_BLOCO[b.tipo]}, oculto`}
          recolhido={recolhido}
          onAlternar={() => {
            setRecolhido(!recolhido);
            onFoco();
          }}
          className="min-w-0 flex-1"
        />
        {ia && !ia.desligado && campos.length > 1 && (
          <PreencherComIA
            papel="proposta"
            clientId={ia.clientId}
            marcaId={ia.marcaId}
            campos={campos}
            contexto={ia.contexto}
            fontes={["contexto", "briefing", "dossie", "arquivos"]}
            rotulo="Preencher o bloco"
            compacto
            onAplicar={(valores) => ia.aplicar(valores)}
            onDesfazer={(anteriores) => ia.aplicar(anteriores)}
          />
        )}
        {b.tipo !== "capa" && (
          <button type="button" className={botao.icone} aria-label={b.visivel ? `Ocultar ${b.titulo}` : `Mostrar ${b.titulo}`} aria-pressed={!b.visivel} onClick={() => mudar({ visivel: !b.visivel })}>
            {b.visivel ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        )}
      </div>
      {!recolhido && (
        <div className="mt-3 min-w-0 space-y-3 pb-2">
          {b.tipo !== "capa" && <Linha b={b} rotulo="Título da página" valor={b.titulo} onMudar={(v) => mudar({ titulo: v })} />}
          <CamposDoBloco b={b} mudar={(dados) => mudar({ dados: dados as Bloco["dados"] })} />
          {extra}
        </div>
      )}
    </li>
  );
}

/** Modelo visual da proposta: tema e as cores do cliente (o Salvar é o da barra do pé). */
function ModeloVisual({ visual, mudou, onVisual }: { visual: VisualDaProposta; mudou: boolean; onVisual: (v: VisualDaProposta) => void }) {
  return (
    <Secao
      titulo="Modelo visual"
      divisoria
      recolhidaDeInicio
      descricao={`${(TEMAS_DA_PROPOSTA.find((t) => t.id === visual.tema) || TEMAS_DA_PROPOSTA[0]).nome}${mudou ? " · não salvo" : ""}`}
      ajuda="Escolha como a proposta aparece para o cliente e veja na prévia ao lado. Cores do cliente usa a paleta da marca aberta na capa e nos destaques; a logo do cliente entra na capa pelo código. O Salvar fica na barra do pé da etapa, junto com os blocos."
    >
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Modelos visuais">
        {TEMAS_DA_PROPOSTA.map((t) => {
          const semCor = t.id === "cliente" && !visual.cores.length;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={visual.tema === t.id}
              disabled={semCor}
              title={semCor ? "A marca do cliente não tem paleta cadastrada" : t.descricao}
              className={juntar("toque-compacto min-w-0 rounded-md border px-3 py-2 text-left", visual.tema === t.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted", semCor && "opacity-50")}
              onClick={() => onVisual(normalizarVisual({ ...visual, tema: t.id as TemaDaProposta }))}
            >
              <span className={juntar(texto.corpo, "block truncate font-medium")}>{t.nome}</span>
              <span className={juntar(texto.auxiliar, "block truncate")}>{t.descricao}</span>
            </button>
          );
        })}
      </div>
      {visual.cores.length > 0 && (
        <div className="mt-3 flex min-w-0 items-center">
          <Palette className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {visual.cores.map((c) => (
            <span key={c} className="mr-2 inline-block h-5 w-5 rounded-full border border-border" style={{ background: c }} title={c} />
          ))}
          <span className={texto.auxiliar}>Paleta da marca</span>
        </div>
      )}
    </Secao>
  );
}


type TextoDoRascunho = { titulo: string; conteudo: ConteudoDaProposta } | null;
const rascunhoValido = (v: unknown) => !!v && typeof v === "object" && "conteudo" in (v as Record<string, unknown>);
const rascunhoCanonico = (v: TextoDoRascunho) => (v ? { titulo: v.titulo || "", conteudo: normalizarConteudo(v.conteudo) } : null);

export default function EtapaRascunho({ proposta, modeloId, onModelo }: { proposta: Proposta | null; modeloId: string; onModelo: (id: string) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmarTirar = useConfirmarTirarOLink();
  const ajustes = useAjustesDaGeracao();
  // UXS: o rascunho fica pela proposta (sem a versão na chave) e compara com a base da edição.
  const doBanco = useMemo<TextoDoRascunho>(() => (proposta ? { titulo: proposta.titulo, conteudo: proposta.conteudo } : null), [proposta]);
  const rascunho = useRascunhoComBase<TextoDoRascunho>({
    chave: proposta ? `mesa-proposta:rascunho:${proposta.id}` : "mesa-proposta:rascunho:nenhuma",
    chaveAntiga: proposta ? `mesa-proposta:rascunho:${proposta.id}:${proposta.versao}` : null,
    doBanco,
    versao: proposta ? proposta.versao : 0,
    valido: rascunhoValido,
    canonico: rascunhoCanonico,
  });
  const setRascunho = rascunho.mudar;
  const esquecer = rascunho.esquecer;
  // O Desfazer do Preencher com IA chega depois: usa sempre o "mudar" mais novo.
  const mudarRef = useRef(setRascunho);
  mudarRef.current = setRascunho;

  // Chegou pelo "Resolver" da Revisão ou do Envio: o bloco já abre, em foco, e a tela rola até ele.
  const focoDeChegada = useFocoDeChegada();
  const blocoDeChegada: TipoDeBloco | null = focoDeChegada && ehTipoDeBloco(focoDeChegada) ? focoDeChegada : null;
  useState(() => {
    if (blocoDeChegada) gravarEstadoDaTela(`mesa-proposta:bloco:${mesa.clientId}:${blocoDeChegada}`, false);
    return null;
  });
  const [emFoco, setEmFoco] = useState<TipoDeBloco | null>(blocoDeChegada);
  useEffect(() => {
    if (blocoDeChegada) rolarAte(`[data-editor-do-bloco="${blocoDeChegada}"]`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [previaIa, setPreviaIa] = useState<{ proposto: ConteudoDaProposta; avisos: string[] } | null>(null);
  const [aplicando, setAplicando] = useState(false);
  // Modelo visual: também compara com a base da edição (versão nova só atualiza quando não há escolha pendente).
  const [visualBase, setVisualBase] = useState<{ versao: number; visual: VisualDaProposta }>(() => ({ versao: proposta ? proposta.versao : 0, visual: proposta ? proposta.visual : normalizarVisual({}) }));
  const [visual, setVisual] = useState<VisualDaProposta>(() => (proposta ? proposta.visual : normalizarVisual({})));
  const mudouVisual = JSON.stringify(visual) !== JSON.stringify(visualBase.visual);
  const previa = useRef<HTMLDivElement | null>(null);

  const atual = useMemo(() => {
    if (!proposta) return null;
    const v = rascunho.valor;
    if (v && v.conteudo) return { titulo: v.titulo || proposta.titulo, conteudo: normalizarConteudo(v.conteudo) };
    return { titulo: proposta.titulo, conteudo: proposta.conteudo };
  }, [proposta, rascunho.valor]);
  const mudou = !!proposta && rascunho.sujo;
  // O Desfazer do Preencher com IA chega depois: lê sempre o rascunho mais novo.
  const atualRef = useRef(atual);
  atualRef.current = atual;

  const recarregarVisual = (p: Proposta) => {
    setVisual(p.visual);
    setVisualBase({ versao: p.versao, visual: p.visual });
  };
  useEffect(() => {
    if (proposta && !mudouVisual && visualBase.versao !== proposta.versao) recarregarVisual(proposta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposta ? proposta.id : "", proposta ? proposta.versao : 0, mudouVisual]);

  useEffect(() => {
    if (!emFoco || !previa.current) return;
    const alvo = previa.current.querySelector(`[data-bloco="${emFoco}"]`) as HTMLElement | null;
    if (alvo && typeof alvo.scrollIntoView === "function") alvo.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [emFoco]);

  const aceita = !!proposta && proposta.status === "aceita";
  const ia = useMemo<IaDoRascunho | null>(
    () =>
      proposta
        ? {
            clientId: mesa.clientId,
            marcaId: proposta.marca_id,
            // PRO3: no upsell, o que o cliente já tem e os resultados reais entram no contexto (os números ganham fonte).
            // QA 30/09: a reunião e os materiais guardados na proposta também são fonte ("Palavras do cliente" e
            // "Desafio" voltavam vazios com a reunião colada). O servidor aceita até 3000 caracteres.
            contexto: [
              `Proposta comercial ${proposta.numero} (${proposta.titulo}). Itens: ${proposta.itens.map((i) => i.nome).join(", ") || "nenhum ainda"}. Regra: nunca invente número, preço, prazo, cliente atendido ou resultado.${proposta.upsell ? ` ${contextoDoUpsell(proposta.upsell, 2300)}` : ""}`,
              proposta.contexto.notas ? `Notas da reunião: ${proposta.contexto.notas}` : "",
              proposta.contexto.transcricao ? `Transcrição da reunião: ${proposta.contexto.transcricao}` : "",
              (proposta.contexto.materiais || []).length ? `Materiais: ${(proposta.contexto.materiais || []).map((m) => `${m.nome}: ${m.texto}`).join(" | ")}` : "",
            ].filter(Boolean).join("\n").slice(0, 3000),
            desligado: aceita,
            campos: camposDoBloco,
            aplicar: (valores) => {
              const a = atualRef.current;
              if (!a) return;
              mudarRef.current({ titulo: a.titulo, conteudo: aplicarValoresNoConteudo(a.conteudo, valores).conteudo });
            },
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposta ? proposta.id : "", proposta ? proposta.versao : 0, aceita, mesa.clientId],
  );

  if (!proposta || !atual) return <EstadoVazio titulo="Nenhuma proposta aberta." descricao="Crie ou abra uma pelo seletor da proposta." />;

  const mudarBloco = (tipo: TipoDeBloco, m: Partial<Pick<Bloco, "titulo" | "visivel" | "dados">>) => {
    setRascunho({ titulo: atual.titulo, conteudo: comBloco(atual.conteudo, tipo, m) });
  };

  // O que o Salvar único da barra leva: só o que mudou (texto e modelo visual).
  const camposDoTexto = () => {
    const c: Record<string, unknown> = {};
    if (atual.titulo !== proposta.titulo) c.titulo = atual.titulo;
    if (JSON.stringify(atual.conteudo) !== JSON.stringify(proposta.conteudo)) c.conteudo = atual.conteudo;
    return c;
  };
  const sujas: SecaoSuja[] = [];
  if (mudou) sujas.push({ rotulo: "Texto", chaves: Object.keys(camposDoTexto()), campos: camposDoTexto, depois: () => esquecer(), descartar: () => esquecer(), manter: rascunho.manter });
  if (mudouVisual) sujas.push({ rotulo: "Modelo visual", chaves: ["visual"], campos: () => ({ visual }), depois: recarregarVisual, descartar: () => recarregarVisual(proposta) });

  // Gerar e pesquisar gravam direto: numa proposta enviada, tiram o link (a frase vai na janela do custo).
  const avisoDoLink = tiraOLink(proposta.status, ["conteudo"]) ? `${ROTULO_DO_STATUS[proposta.status] || "Enviada"}: gravar tira o link atual do cliente` : "";

  const depoisDaIa = (d: any) => {
    esquecer();
    aplicarNaLista(qc, mesa.clientId, d && d.proposta);
    const tiradas = d && Array.isArray(d.tiradas) ? d.tiradas.length : 0;
    const perguntas = d && Array.isArray(d.perguntas) ? d.perguntas.length : 0;
    if (tiradas) toast.warning(`${tiradas} número(s) saíram por falta de fonte.`, { description: "Veja em Revisar." });
    if (perguntas) toast.info(`O estrategista tem ${perguntas} pergunta(s).`, { description: "Estão na Conversa." });
  };

  // Preencher tudo: aplica os campos escolhidos, grava e oferece o Desfazer (volta a versão de antes).
  const aplicarPreenchimento = async (chaves: string[]) => {
    if (!previaIa) return;
    if (!(await confirmarTirar(proposta.status, ["titulo", "conteudo"], "Aplicar"))) return;
    const voltouParaRascunho = proposta.status !== "rascunho";
    setAplicando(true);
    const versaoAntes = proposta.versao;
    try {
      const conteudo = mesclarPorChaves(atual.conteudo, previaIa.proposto, chaves);
      // aplicar_previa: o servidor leva as perguntas e a conferência do mercado (do evento da prévia) ao contexto.
      const d = await chamarProposta<any>("salvar", { proposta_id: proposta.id, versao_base: proposta.versao, titulo: atual.titulo, conteudo, aplicar_previa: true, chaves_aplicadas: chaves });
      esquecer();
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      setPreviaIa(null);
      // O Desfazer continua sendo a ação (ele devolve o texto, não o link).
      toast.success(`${chaves.length} campo(s) preenchido(s).`, {
        description: voltouParaRascunho ? "Envie de novo para o cliente ver." : undefined,
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            chamarProposta<any>("versao_restaurar", { proposta_id: proposta.id, versao: versaoAntes })
              .then((r) => aplicarNaLista(qc, mesa.clientId, r && r.proposta))
              .catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
    } catch (e) {
      avisarErro(e, "O preenchimento não foi aplicado");
    } finally {
      setAplicando(false);
    }
  };

  const jaEscrito = !!blocoDoTipo(proposta.conteudo, "capa").dados.headline;
  const pedidoDeGerar = () => ({ proposta_id: proposta.id, modelo_id: modeloId || undefined, ...ajustes.pedido() });
  // Gerar de novo: sempre com a prévia (nada é gravado sem a pessoa ver).
  const gerarComPrevia = (
    <BotaoComCusto
      rotulo={
        <>
          <Sparkles className="mr-1.5 h-4 w-4" />
          Gerar de novo
        </>
      }
      titulo="Gerar de novo (prévia)"
      descricao="Mostra o que vai mudar, campo a campo, antes de gravar"
      variant="outline"
      disabled={aceita || mudou || !modeloId || !ajustes.pronto}
      partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 14000, tokensSaida: 6000, buscasWeb: ajustes.buscasWeb }]}
      executar={() => chamarProposta("gerar", { ...pedidoDeGerar(), previa: true })}
      aoConcluir={(d: any) => {
        if (d && d.proposto) setPreviaIa({ proposto: normalizarConteudo(d.proposto), avisos: (Array.isArray(d.tiradas) ? d.tiradas.map((t: string) => `Saiu por falta de fonte: ${t}`) : []).concat(Array.isArray(d.perguntas) ? d.perguntas : []) });
      }}
    />
  );
  // Primeira escrita: grava direto (não há texto para perder; a versão anterior fica no histórico).
  const gerarDireto = (principal: boolean) => (
    <BotaoComCusto
      rotulo={
        principal ? (
          <>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Gerar o rascunho
          </>
        ) : (
          "Gerar e gravar sem prévia"
        )
      }
      titulo="Gerar a proposta"
      descricao={avisoDoLink || undefined}
      variant={principal ? "default" : "outline"}
      disabled={aceita || mudou || !modeloId || !ajustes.pronto}
      partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 14000, tokensSaida: 6000, buscasWeb: ajustes.buscasWeb }]}
      executar={() => chamarProposta("gerar", pedidoDeGerar())}
      aoConcluir={(d) => depoisDaIa(d)}
    />
  );

  return (
    <ContextoDaIa.Provider value={ia}>
      <div className="min-w-0 space-y-6" data-etapa-proposta="rascunho">
        <Secao
          titulo="Rascunho"
          recolher={false}
          descricao={`Nº ${proposta.numero} · versão ${proposta.versao}${mudou ? " · não salvo" : ""}`}
          ajuda="O estrategista lê a conversa, os arquivos, os itens e o que o painel sabe do cliente, pesquisa o mercado na web (cada número com fonte e data) e escreve os blocos. Número sem fonte sai e vira pergunta. Gerar o rascunho grava direto na primeira vez; depois, Gerar de novo mostra a prévia campo a campo antes de gravar. Em Ajustes da IA: o modelo, de onde ler, a pesquisa na web, gravar sem prévia e pesquisar só o mercado. Edite cada bloco à esquerda e veja a página do cliente à direita. O Salvar fica na barra do pé e leva os blocos e o modelo visual juntos."
        >
          {rascunho.conflito && <AvisoDeMudanca className="mb-2" onManter={rascunho.manter} onVerANova={() => esquecer()} />}
          <CampoDeFormulario rotulo="Título da proposta">
            <input value={atual.titulo} onChange={(e) => setRascunho({ titulo: e.target.value, conteudo: atual.conteudo })} maxLength={120} className={campo} disabled={aceita} />
          </CampoDeFormulario>
          {!aceita && (
            <div className="mt-3 flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2" data-gerar-da-proposta="">
              {/* PRO3: o estrategista sugere o upsell pelo que o cliente já tem e pelos resultados reais (prévia, modelo e custo antes). */}
              {proposta.upsell && ia && (
                <span data-sugerir-proximo-passo="">
                  <PreencherComIA
                    papel="proposta"
                    clientId={mesa.clientId}
                    marcaId={proposta.marca_id}
                    campos={camposDoBloco(blocoDoTipo(atual.conteudo, "solucao")).concat(camposDoBloco(blocoDoTipo(atual.conteudo, "ja_tem")), camposDoBloco(blocoDoTipo(atual.conteudo, "capa")).slice(0, 1))}
                    contexto={ia.contexto}
                    fontes={["contexto", "briefing", "dossie", "arquivos"]}
                    rotulo="Sugerir o próximo passo"
                    onAplicar={(valores) => ia.aplicar(valores)}
                    onDesfazer={(anteriores) => ia.aplicar(anteriores)}
                  />
                </span>
              )}
              {jaEscrito ? gerarComPrevia : gerarDireto(true)}
            </div>
          )}
          {!aceita && (
            <AjustesDaIA ajustes={ajustes} modeloId={modeloId} onModelo={onModelo} chave={`mesa-proposta:ajustes:${mesa.clientId}`}>
              <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2" aria-label="Outras gerações">
                {jaEscrito && gerarDireto(false)}
                <BotaoComCusto
                  rotulo="Só pesquisar o mercado"
                  titulo="Pesquisar o mercado"
                  descricao={avisoDoLink || undefined}
                  variant="outline"
                  disabled={mudou || !modeloId}
                  partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 6000, tokensSaida: 2500, buscasWeb: 5 }]}
                  executar={() => chamarProposta("pesquisar", { proposta_id: proposta.id, modelo_id: modeloId || undefined })}
                  aoConcluir={(d) => depoisDaIa(d)}
                />
              </div>
            </AjustesDaIA>
          )}
          {mudou && <p className={texto.auxiliar}>Salve ou descarte a edição antes de gerar.</p>}
          {previaIa && (
            <div className="mt-3">
              <PreviaDoPreenchimento atual={atual.conteudo} proposto={previaIa.proposto} titulo="O que a IA propõe" avisos={previaIa.avisos} aplicando={aplicando} onDescartar={() => setPreviaIa(null)} onAplicar={(chaves) => aplicarPreenchimento(chaves)} />
            </div>
          )}
          <AvisoDaAgencia />
        </Secao>

        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="min-w-0" aria-label="Blocos da proposta">
            <h3 className={juntar(texto.tituloSecao, "mb-2")}>Blocos</h3>
            <ul className="min-w-0 space-y-3">
              {/* PRO3: "O que você já tem" só no upsell (ou quando alguém já escreveu nele). */}
              {atual.conteudo.blocos.filter((b) => b.tipo !== "ja_tem" || !!proposta.upsell || !blocoVazio(b)).map((b) => (
                <EditorDoBloco
                  key={b.tipo}
                  b={b}
                  chave={`mesa-proposta:bloco:${mesa.clientId}:${b.tipo}`}
                  emFoco={emFoco === b.tipo}
                  onFoco={() => setEmFoco(b.tipo)}
                  mudar={(m) => !aceita && mudarBloco(b.tipo, m)}
                  abertoDeInicio={!!proposta.upsell && (b.tipo === "ja_tem" || b.tipo === "solucao")}
                  extra={
                    aceita ? null : (
                      <div className="flex min-w-0 flex-wrap [&>*]:mb-2 [&>*]:mr-2">
                        {b.tipo === "ja_tem" && proposta.upsell && <RelerORetrato proposta={proposta} onRelido={() => esquecer()} />}
                        {b.tipo === "capa" && <TresHeadlines proposta={proposta} modeloId={modeloId} desligado={aceita} onEscolher={(h) => mudarBloco("capa", { dados: { ...(b.dados as DadosDoBloco["capa"]), headline: h } })} />}
                        {camposDoBloco(b).length > 0 && <TomDaMarca proposta={proposta} b={b} modeloId={modeloId} desligado={aceita} conteudo={atual.conteudo} onAplicar={(valores) => ia && ia.aplicar(valores)} />}
                      </div>
                    )
                  }
                />
              ))}
            </ul>
          </section>
          <section className="min-w-0" aria-label="Prévia ao vivo">
            <h3 className={juntar(texto.tituloSecao, "mb-2")}>Prévia</h3>
            <div ref={previa} className="min-w-0 overflow-hidden rounded-lg border border-border">
              <PropostaDocumento
                previa
                emFoco={emFoco}
                cliente={mesa.clientName || "Cliente"}
                dados={{
                  numero: proposta.numero,
                  titulo: atual.titulo,
                  conteudo: atual.conteudo,
                  itens: proposta.itens,
                  validade_ate: proposta.validade_ate,
                  data: (proposta.enviada_em || proposta.atualizado_em || "").slice(0, 10) || null,
                  pacotes: proposta.pacotes,
                  pagamento: proposta.pagamento,
                  visual,
                  anexos: proposta.anexos.map((a) => ({ id: a.id, titulo: a.titulo, url: a.url })),
                }}
              />
            </div>
          </section>
        </div>
        <ModeloVisual visual={visual} mudou={mudouVisual} onVisual={setVisual} />

        {/* UXS: os anexos moram perto da prévia; gravam direto, então esperam o rascunho ser salvo. */}
        <AnexosDaProposta proposta={proposta} bloqueio={mudou || mudouVisual ? "Salve antes de anexar" : null} />

        <ProximoPasso etapa="rascunho" estado={!jaEscrito ? "Ainda sem texto: gere o rascunho acima" : undefined} />
        <BarraDoSalvar proposta={proposta} sujas={sujas} />
      </div>
    </ContextoDaIa.Provider>
  );
}
