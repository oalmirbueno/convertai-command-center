import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Globe, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import {
  blocoDoTipo,
  comBloco,
  dataCurta,
  normalizarConteudo,
  ROTULO_DO_BLOCO,
  type Bloco,
  type ConteudoDaProposta,
  type DadosDoBloco,
  type TipoDeBloco,
} from "../../../supabase/functions/_shared/proposta-modelo";
import PropostaDocumento from "./PropostaDocumento";
import AvisoDaAgencia from "./AvisoDaAgencia";
import { aplicarNaLista, chamarProposta, type Proposta } from "./propostaApi";

/**
 * Etapa 2, Rascunho: gerar com o estrategista (custo antes, pesquisa de
 * mercado na web ligada), editar bloco a bloco e ver a página do cliente ao
 * lado, ao vivo. Listas se editam uma por linha; pares como "Título | texto".
 * O mercado só aceita o que veio com fonte (dá para tirar, não para escrever
 * número sem fonte). Provas e quem somos vêm dos dados da agência.
 */

const linhas = (v: string[]) => v.join("\n");
const deLinhas = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const pares = (v: Array<{ a: string; b: string }>) => v.map((x) => (x.b ? `${x.a} | ${x.b}` : x.a)).join("\n");
const dePares = (s: string) =>
  deLinhas(s).map((l) => {
    const i = l.indexOf("|");
    return i < 0 ? { a: l, b: "" } : { a: l.slice(0, i).trim(), b: l.slice(i + 1).trim() };
  });

function Area({ rotulo, valor, onMudar, altura = "min-h-[88px]", dica }: { rotulo: string; valor: string; onMudar: (v: string) => void; altura?: string; dica?: string }) {
  return (
    <CampoDeFormulario rotulo={rotulo} apoio={dica}>
      <textarea value={valor} onChange={(e) => onMudar(e.target.value)} className={juntar(campoTexto, altura)} />
    </CampoDeFormulario>
  );
}

function Linha({ rotulo, valor, onMudar }: { rotulo: string; valor: string; onMudar: (v: string) => void }) {
  return (
    <CampoDeFormulario rotulo={rotulo}>
      <input value={valor} onChange={(e) => onMudar(e.target.value)} className={campo} />
    </CampoDeFormulario>
  );
}

/** Os campos de um bloco. `mudar` recebe os dados novos inteiros. */
function CamposDoBloco({ b, mudar }: { b: Bloco; mudar: (dados: Record<string, unknown>) => void }) {
  const d = b.dados as Record<string, unknown>;
  const m = (campoMudado: Record<string, unknown>) => mudar({ ...d, ...campoMudado });
  switch (b.tipo) {
    case "capa": {
      const x = b.dados as DadosDoBloco["capa"];
      return (
        <>
          <Linha rotulo="Headline" valor={x.headline} onMudar={(v) => m({ headline: v })} />
          <Linha rotulo="Subtítulo" valor={x.subtitulo} onMudar={(v) => m({ subtitulo: v })} />
          <Linha rotulo="Projeto" valor={x.projeto} onMudar={(v) => m({ projeto: v })} />
        </>
      );
    }
    case "desafio": {
      const x = b.dados as DadosDoBloco["desafio"];
      return (
        <>
          <Area rotulo="Texto" valor={x.texto} onMudar={(v) => m({ texto: v })} altura="min-h-[120px]" />
          <Area rotulo="Palavras do cliente" dica="Uma fala por linha" valor={linhas(x.palavras_do_cliente)} onMudar={(v) => m({ palavras_do_cliente: deLinhas(v) })} />
          <Area rotulo="Compromisso" valor={x.compromisso} onMudar={(v) => m({ compromisso: v })} />
        </>
      );
    }
    case "diagnostico": {
      const x = b.dados as DadosDoBloco["diagnostico"];
      return (
        <Area
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
          <Area rotulo="Resumo" valor={x.resumo} onMudar={(v) => m({ resumo: v })} />
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
          <Area rotulo="Texto" valor={x.texto} onMudar={(v) => m({ texto: v })} />
          <Area rotulo="Frentes" dica="Título | texto, uma por linha" valor={pares(x.frentes.map((f) => ({ a: f.titulo, b: f.texto })))} onMudar={(v) => m({ frentes: dePares(v).map((p) => ({ titulo: p.a, texto: p.b })) })} />
        </>
      );
    }
    case "entregaveis": {
      const x = b.dados as DadosDoBloco["entregaveis"];
      return (
        <>
          <Area rotulo="O que recebe" dica="Nome | detalhe, um por linha" altura="min-h-[120px]" valor={pares(x.itens.map((i) => ({ a: i.nome, b: i.detalhe })))} onMudar={(v) => m({ itens: dePares(v).map((p) => ({ nome: p.a, detalhe: p.b })) })} />
          <Area rotulo="Não inclui" dica="Um por linha" valor={linhas(x.nao_inclui)} onMudar={(v) => m({ nao_inclui: deLinhas(v) })} />
        </>
      );
    }
    case "processo": {
      const x = b.dados as DadosDoBloco["processo"];
      return <Area rotulo="Etapas" dica="Título | texto, uma por linha, na ordem" altura="min-h-[120px]" valor={pares(x.etapas.map((e) => ({ a: e.titulo, b: e.texto })))} onMudar={(v) => m({ etapas: dePares(v).map((p) => ({ titulo: p.a, texto: p.b })) })} />;
    }
    case "cronograma": {
      const x = b.dados as DadosDoBloco["cronograma"];
      return (
        <>
          <Area rotulo="Marcos" dica="Quando | marco, um por linha" valor={pares(x.marcos.map((mm) => ({ a: mm.quando, b: mm.titulo })))} onMudar={(v) => m({ marcos: dePares(v).map((p) => (p.b ? { quando: p.a, titulo: p.b } : { quando: "", titulo: p.a })) })} />
          <Area rotulo="Observação" valor={x.observacao} onMudar={(v) => m({ observacao: v })} />
        </>
      );
    }
    case "investimento": {
      const x = b.dados as DadosDoBloco["investimento"];
      return (
        <>
          <Area rotulo="Intangíveis" dica="Um por linha; o valor sai dos itens do Contexto" valor={linhas(x.intangiveis)} onMudar={(v) => m({ intangiveis: deLinhas(v) })} />
          <Area rotulo="Condições" valor={x.condicoes} onMudar={(v) => m({ condicoes: v })} />
          <Linha rotulo="Observação" valor={x.observacao} onMudar={(v) => m({ observacao: v })} />
        </>
      );
    }
    case "provas": {
      const x = b.dados as DadosDoBloco["provas"];
      return <p className={texto.auxiliar}>{x.cases.length || x.depoimentos.length ? `${x.cases.length} case(s) e ${x.depoimentos.length} depoimento(s) dos dados da agência.` : "Sem case real cadastrado nos dados da agência."}</p>;
    }
    case "quem_somos": {
      const x = b.dados as DadosDoBloco["quem_somos"];
      return <Area rotulo="Texto" valor={x.texto} onMudar={(v) => m({ texto: v })} />;
    }
    case "proximos_passos": {
      const x = b.dados as DadosDoBloco["proximos_passos"];
      return (
        <>
          <Area rotulo="Passos" dica="Um por linha" valor={linhas(x.passos)} onMudar={(v) => m({ passos: deLinhas(v) })} />
          <Linha rotulo="Chamada" valor={x.chamada} onMudar={(v) => m({ chamada: v })} />
        </>
      );
    }
    default:
      return null;
  }
}

function EditorDoBloco({ b, chave, emFoco, onFoco, mudar }: { b: Bloco; chave: string; emFoco: boolean; onFoco: () => void; mudar: (m: Partial<Pick<Bloco, "titulo" | "visivel" | "dados">>) => void }) {
  const [recolhido, setRecolhido] = useRecolhido(chave, true);
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
        {b.tipo !== "capa" && (
          <button type="button" className={botao.icone} aria-label={b.visivel ? `Ocultar ${b.titulo}` : `Mostrar ${b.titulo}`} aria-pressed={!b.visivel} onClick={() => mudar({ visivel: !b.visivel })}>
            {b.visivel ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        )}
      </div>
      {!recolhido && (
        <div className="mt-3 min-w-0 space-y-3 pb-2">
          {b.tipo !== "capa" && <Linha rotulo="Título da página" valor={b.titulo} onMudar={(v) => mudar({ titulo: v })} />}
          <CamposDoBloco b={b} mudar={(dados) => mudar({ dados: dados as Bloco["dados"] })} />
        </div>
      )}
    </li>
  );
}

export default function EtapaRascunho({ proposta, modeloId, onModelo }: { proposta: Proposta | null; modeloId: string; onModelo: (id: string) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [pesquisar, setPesquisar] = useEstadoDaTela<boolean>("mesa-proposta:pesquisar", true, { validar: (v) => typeof v === "boolean" });
  const chave = proposta ? `mesa-proposta:rascunho:${proposta.id}:${proposta.versao}` : "mesa-proposta:rascunho:nenhuma";
  const [rascunho, setRascunho, esquecer] = useEstadoDaTela<{ titulo: string; conteudo: ConteudoDaProposta } | null>(chave, null, { esperaMs: 400 });
  const [emFoco, setEmFoco] = useState<TipoDeBloco | null>(null);
  const [salvando, setSalvando] = useState(false);
  const previa = useRef<HTMLDivElement | null>(null);

  const atual = useMemo(() => {
    if (!proposta) return null;
    if (rascunho && rascunho.conteudo) return { titulo: rascunho.titulo || proposta.titulo, conteudo: normalizarConteudo(rascunho.conteudo) };
    return { titulo: proposta.titulo, conteudo: proposta.conteudo };
  }, [proposta, rascunho]);
  const mudou = !!proposta && !!atual && (atual.titulo !== proposta.titulo || JSON.stringify(atual.conteudo) !== JSON.stringify(proposta.conteudo));

  useEffect(() => {
    if (!emFoco || !previa.current) return;
    const alvo = previa.current.querySelector(`[data-bloco="${emFoco}"]`) as HTMLElement | null;
    if (alvo && typeof alvo.scrollIntoView === "function") alvo.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [emFoco]);

  if (!proposta || !atual) return <EstadoVazio titulo="Nenhuma proposta aberta." descricao="Crie ou abra uma no Contexto." />;
  const aceita = proposta.status === "aceita";

  const mudarBloco = (tipo: TipoDeBloco, m: Partial<Pick<Bloco, "titulo" | "visivel" | "dados">>) => {
    setRascunho({ titulo: atual.titulo, conteudo: comBloco(atual.conteudo, tipo, m) });
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const d = await chamarProposta<any>("salvar", { proposta_id: proposta.id, versao_base: proposta.versao, titulo: atual.titulo, conteudo: atual.conteudo });
      esquecer();
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      toast.success(proposta.status !== "rascunho" ? "Salvo. A proposta voltou para rascunho: envie de novo para o cliente ver." : "Rascunho salvo.");
    } catch (e) {
      avisarErro(e, "O rascunho não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  const depoisDaIa = (d: any) => {
    esquecer();
    aplicarNaLista(qc, mesa.clientId, d && d.proposta);
    const tiradas = d && Array.isArray(d.tiradas) ? d.tiradas.length : 0;
    const perguntas = d && Array.isArray(d.perguntas) ? d.perguntas.length : 0;
    if (tiradas) toast.warning(`${tiradas} número(s) saíram por falta de fonte.`, { description: "Veja na Revisão." });
    if (perguntas) toast.info(`O estrategista tem ${perguntas} pergunta(s).`, { description: "Estão no Contexto." });
  };

  return (
    <div className="min-w-0 space-y-6" data-etapa-proposta="rascunho">
      <Secao
        titulo="Escrever"
        recolher={false}
        descricao={`Nº ${proposta.numero} · versão ${proposta.versao}${mudou ? " · não salvo" : ""}`}
        ajuda="O estrategista lê o contexto, a reunião, os arquivos e os itens, pesquisa o mercado na web (cada número com fonte e data) e escreve os blocos. Número sem fonte sai e vira pergunta. Gerar de novo guarda a versão anterior."
        acao={
          <>
            {mudou && (
              <button type="button" className={botao.discreto} onClick={() => esquecer()}>
                Descartar
              </button>
            )}
            <button type="button" className={mudou ? botao.primario : botao.secundario} onClick={() => void salvar()} disabled={!mudou || salvando || aceita}>
              {salvando ? "Salvando..." : "Salvar"}
            </button>
          </>
        }
      >
        <div className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)]">
          <CampoDeFormulario rotulo="Título da proposta">
            <input value={atual.titulo} onChange={(e) => setRascunho({ titulo: e.target.value, conteudo: atual.conteudo })} maxLength={120} className={campo} disabled={aceita} />
          </CampoDeFormulario>
          <SeletorDeModelo catalogo={mesa.catalogo} tipo="texto" valor={modeloId} onChange={onModelo} rotulo="Modelo de IA" />
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2">
          <label className={juntar(texto.corpo, "inline-flex items-center")}>
            <input type="checkbox" className="mr-2" checked={pesquisar} onChange={(e) => setPesquisar(e.target.checked)} />
            <Globe className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Pesquisa de mercado na web
          </label>
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-4 w-4" />
                {blocoDoTipo(proposta.conteudo, "capa").dados.headline ? "Gerar de novo" : "Gerar proposta"}
              </>
            }
            titulo="Gerar a proposta"
            disabled={aceita || mudou || !modeloId}
            partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 14000, tokensSaida: 6000, buscasWeb: pesquisar ? 5 : 0 }]}
            executar={() => chamarProposta("gerar", { proposta_id: proposta.id, modelo_id: modeloId || undefined, pesquisar })}
            aoConcluir={(d) => depoisDaIa(d)}
          />
          <BotaoComCusto
            rotulo="Só o mercado"
            titulo="Pesquisar o mercado"
            variant="outline"
            disabled={aceita || mudou || !modeloId}
            partes={() => [{ modeloId, tipo: "texto", tokensEntrada: 6000, tokensSaida: 2500, buscasWeb: 5 }]}
            executar={() => chamarProposta("pesquisar", { proposta_id: proposta.id, modelo_id: modeloId || undefined })}
            aoConcluir={(d) => depoisDaIa(d)}
          />
        </div>
        {mudou && <p className={texto.auxiliar}>Salve ou descarte a edição antes de gerar.</p>}
        <AvisoDaAgencia />
      </Secao>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0" aria-label="Blocos da proposta">
          <h3 className={juntar(texto.tituloSecao, "mb-2")}>Blocos</h3>
          <ul className="min-w-0 space-y-3">
            {atual.conteudo.blocos.map((b) => (
              <EditorDoBloco key={b.tipo} b={b} chave={`mesa-proposta:bloco:${mesa.clientId}:${b.tipo}`} emFoco={emFoco === b.tipo} onFoco={() => setEmFoco(b.tipo)} mudar={(m) => !aceita && mudarBloco(b.tipo, m)} />
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
              dados={{ numero: proposta.numero, titulo: atual.titulo, conteudo: atual.conteudo, itens: proposta.itens, validade_ate: proposta.validade_ate, data: (proposta.enviada_em || proposta.atualizado_em || "").slice(0, 10) || null }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
