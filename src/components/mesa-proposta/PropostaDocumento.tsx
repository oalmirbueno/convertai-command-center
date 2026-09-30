import type { CSSProperties, ReactNode } from "react";
import "./proposta-documento.css";
import { MarcaAceleriq } from "@/components/publico/CascaPublica";
import {
  blocosParaMostrar,
  dataCurta,
  dominio,
  FUNDO_DO_BLOCO,
  reais,
  totaisDosItens,
  type Bloco,
  type ConteudoDaProposta,
  type DadosDoBloco,
  type FonteDoDado,
  type ItemDaProposta,
  type TipoDeBloco,
} from "../../../supabase/functions/_shared/proposta-modelo";
import {
  barrasDoCronograma,
  comparativoDosPacotes,
  corDoTextoSobre,
  normalizarPagamento,
  normalizarVisual,
  resumoDosPacotes,
  ROTULO_DO_NIVEL,
  textoDaOpcao,
  type NivelDoPacote,
  type TemaDaProposta,
} from "../../../supabase/functions/_shared/proposta-comercial";

/**
 * O documento da proposta: a mesma página na prévia da mesa e no link
 * público /proposta/:token. Vertical, legível no celular, identidade da
 * Aceleriq (logo e verde) e a logo do cliente na capa. Imprimir dá o PDF A4
 * vertical (uma página por bloco; o CSS esconde botões e aceite).
 *
 * Frente PRO2: quatro modelos visuais (Aceleriq, Claro, Editorial e Cores do
 * cliente, com a cor da marca na capa), três pacotes com comparativo,
 * formas de pagamento, cronograma em barras (semanas lidas do marco),
 * materiais anexados e âncoras para o índice do link.
 *
 * O preço sai só dos itens (totaisDosItens): o texto do bloco de
 * investimento traz intangíveis e condições; o valor é do código.
 */

export type DadosDoDocumento = {
  numero: string;
  titulo: string;
  conteudo: ConteudoDaProposta;
  itens: ItemDaProposta[];
  validade_ate: string | null;
  data: string | null;
  /** Frente PRO2 (tudo opcional: a proposta antiga desenha igual). */
  pacotes?: unknown;
  pagamento?: unknown;
  visual?: unknown;
  anexos?: Array<{ id: string; titulo: string; url?: string }>;
};

export type AgenciaDoDocumento = { nome: string; site?: string; email?: string; whatsapp?: string; instagram?: string };

/** Fundo de cada página no modelo visual escolhido. */
export function fundoNoTema(tipo: TipoDeBloco, tema: TemaDaProposta): "escuro" | "claro" {
  if (tema === "claro" || tema === "editorial") return "claro";
  return FUNDO_DO_BLOCO[tipo];
}

/** Itens do índice do link (os blocos que aparecem, menos a capa). */
export function itensDoIndice(conteudo: ConteudoDaProposta): Array<{ tipo: TipoDeBloco; titulo: string }> {
  return blocosParaMostrar(conteudo)
    .filter((b) => b.tipo !== "capa")
    .map((b) => ({ tipo: b.tipo, titulo: b.titulo }));
}

function Fonte({ f }: { f: FonteDoDado }) {
  return (
    <span className="pd-fonte">
      Fonte:{" "}
      <a href={f.url} target="_blank" rel="noopener noreferrer">
        {f.titulo || dominio(f.url)}
      </a>
      {f.data ? `, ${f.data.length === 7 ? f.data.split("-").reverse().join("/") : dataCurta(f.data)}` : ""}
    </span>
  );
}

function Topo({ escuro, numero, total }: { escuro: boolean; numero: number; total: number }) {
  return (
    <div className="pd-topo">
      {escuro ? (
        <MarcaAceleriq altura={22} />
      ) : (
        <span className="pd-marca-texto" aria-label="Aceleriq">
          Aceler<span>iq</span>
        </span>
      )}
      <span className="pd-pagina-numero">
        {String(numero).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
    </div>
  );
}

function Capa({ b, d, cliente, logoCliente }: { b: Bloco<"capa">; d: DadosDoDocumento; cliente: string; logoCliente?: string | null }) {
  return (
    <div className="pd-capa">
      {logoCliente ? (
        <span className="pd-capa-logo-cliente">
          <img src={logoCliente} alt={`Logo de ${cliente}`} />
        </span>
      ) : null}
      <span className="pd-rotulo">Proposta comercial</span>
      <h2 className="pd-headline">{b.dados.headline || d.titulo}</h2>
      {b.dados.subtitulo ? <p className="pd-sub">{b.dados.subtitulo}</p> : null}
      <div className="pd-capa-meta">
        <div>
          <span className="pd-meta-rotulo">Projeto</span>
          <span className="pd-meta-valor">{b.dados.projeto || d.titulo}</span>
        </div>
        <div>
          <span className="pd-meta-rotulo">Cliente</span>
          <span className="pd-meta-valor">{cliente}</span>
        </div>
        <div>
          <span className="pd-meta-rotulo">Proposta</span>
          <span className="pd-meta-valor">
            Nº {d.numero}
            {d.data ? <br /> : null}
            {d.data ? dataCurta(d.data) : null}
          </span>
        </div>
      </div>
      {d.validade_ate ? <p className="pd-pequeno">Válida até {dataCurta(d.validade_ate)}.</p> : null}
      <span className="pd-seta" aria-hidden="true">
        ⟶
      </span>
    </div>
  );
}

function Lista({ itens, numerada }: { itens: Array<{ titulo: string; texto?: string }>; numerada?: boolean }) {
  return (
    <ul className="pd-lista">
      {itens.map((it, i) => (
        <li key={`${it.titulo}-${i}`}>
          {numerada ? <span className="pd-bolinha">{i + 1}</span> : <span className="pd-check" aria-hidden="true" />}
          <span>
            <span className="pd-item-titulo">{it.titulo}</span>
            {it.texto ? <span className="pd-item-texto">{it.texto}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Cronograma({ x }: { x: DadosDoBloco["cronograma"] }) {
  const g = barrasDoCronograma(x.marcos);
  const comBarra = g.total_semanas > 0 && g.barras.some((b) => b.esquerda !== null);
  if (!comBarra) {
    return (
      <ul className="pd-lista pd-linha-do-tempo">
        {x.marcos.map((m, i) => (
          <li key={`${m.titulo}-${i}`}>
            <span>
              {m.quando ? <span className="pd-quando">{m.quando}</span> : null}
              <span className="pd-item-titulo">{m.titulo}</span>
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="pd-gantt" role="list" aria-label={`Cronograma em ${g.total_semanas} semanas`}>
      {g.barras.map((b, i) => (
        <div key={`${b.titulo}-${i}`} className="pd-gantt-linha" role="listitem">
          <span className="pd-gantt-rotulo">
            <span className="pd-item-titulo">{b.titulo}</span>
            {b.quando ? <span className="pd-quando">{b.quando}</span> : null}
          </span>
          <span className="pd-gantt-trilho" aria-hidden="true">
            {b.esquerda !== null ? <span className="pd-gantt-barra" style={{ left: `${b.esquerda}%`, width: `${b.largura}%` }} /> : null}
          </span>
        </div>
      ))}
      <div className="pd-gantt-escala" aria-hidden="true">
        <span>Semana 1</span>
        <span>Semana {g.total_semanas}</span>
      </div>
    </div>
  );
}

function Investimento({ x, itens, pacotes, pagamento, pacoteEscolhido }: { x: DadosDoBloco["investimento"]; itens: ItemDaProposta[]; pacotes?: unknown; pagamento?: unknown; pacoteEscolhido?: NivelDoPacote | null }) {
  const resumo = resumoDosPacotes(itens, pacotes);
  const opcoes = normalizarPagamento(pagamento).opcoes;
  const base = resumo.length ? (resumo.find((p) => (pacoteEscolhido ? p.nivel === pacoteEscolhido : p.destaque)) || resumo[1]) : null;
  const totaisBase = base ? base.totais : totaisDosItens(itens);
  const pagamentoTexto = (
    <div>
      <span className="pd-meta-rotulo">Pagamento</span>
      {opcoes.length ? (
        <ul className="pd-opcoes">
          {opcoes.map((op) => (
            <li key={op.id}>
              {textoDaOpcao(op, totaisBase)}
              {op.observacao ? <span className="pd-item-texto">{op.observacao}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pd-corpo">{x.condicoes || (opcoes.length ? "" : "Combinado no contrato.")}</p>
      {base && opcoes.length ? <p className="pd-pequeno">Valores do pacote {base.nome}.</p> : null}
      {x.observacao ? <p className="pd-pequeno">{x.observacao}</p> : null}
    </div>
  );

  if (resumo.length) {
    const linhas = comparativoDosPacotes(itens, pacotes);
    return (
      <>
        {x.intangiveis.length ? <Lista itens={x.intangiveis.map((i) => ({ titulo: i }))} /> : null}
        <div className="pd-pacotes">
          {resumo.map((p) => (
            <div key={p.nivel} className={`pd-pacote${p.destaque ? " pd-pacote-destaque" : ""}${pacoteEscolhido === p.nivel ? " pd-pacote-escolhido" : ""}`} data-pacote={p.nivel}>
              {p.destaque ? <span className="pd-selo">Recomendado</span> : null}
              <span className="pd-item-titulo">{p.nome}</span>
              {p.descricao ? <span className="pd-item-texto">{p.descricao}</span> : null}
              {p.totais.unico > 0 ? <span className="pd-valor-pacote">{reais(p.totais.unico)}</span> : null}
              {p.totais.mensal > 0 ? <span className={p.totais.unico > 0 ? "pd-valor-mensal-pacote" : "pd-valor-pacote"}>{`${reais(p.totais.mensal)} por mês`}</span> : null}
              <span className="pd-pequeno">{p.itens.length} {p.itens.length === 1 ? "item" : "itens"}</span>
            </div>
          ))}
        </div>
        <div className="pd-tabela-rola">
          <table className="pd-comparativo">
            <caption>O que cada pacote inclui</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                {resumo.map((p) => (
                  <th key={p.nivel} scope="col">
                    {p.nome}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id}>
                  <th scope="row">{l.nome}</th>
                  {resumo.map((p) => (
                    <td key={p.nivel}>{l.em[p.nivel] ? <span className="pd-sim" aria-label="inclui">✓</span> : <span className="pd-nao" aria-label="não inclui">–</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pd-total">
          <div>
            <span className="pd-meta-rotulo">Como escolher</span>
            <p className="pd-corpo">{`Os três pacotes somam o de baixo: o ${ROTULO_DO_NIVEL.completo.toLowerCase()} inclui tudo. Você escolhe no aceite.`}</p>
          </div>
          {pagamentoTexto}
        </div>
      </>
    );
  }

  const t = totaisDosItens(itens);
  const unicos = itens.filter((i) => i.recorrencia === "unico").map((i) => (i.quantidade > 1 ? `${i.quantidade} x ${i.nome}` : i.nome));
  const mensais = itens.filter((i) => i.recorrencia === "mensal").map((i) => (i.quantidade > 1 ? `${i.quantidade} x ${i.nome}` : i.nome));
  return (
    <>
      {x.intangiveis.length ? <Lista itens={x.intangiveis.map((i) => ({ titulo: i }))} /> : null}
      <div className="pd-total">
        <div>
          <span className="pd-meta-rotulo">Investimento</span>
          {t.unico > 0 ? <span className="pd-valor">{reais(t.unico)}</span> : null}
          {t.mensal > 0 ? <span className={t.unico > 0 ? "pd-valor-mensal" : "pd-valor"}>{`${reais(t.mensal)} por mês`}</span> : null}
          {!t.itens ? <span className="pd-valor-mensal">A definir</span> : null}
          {unicos.length || mensais.length ? (
            <p className="pd-incluido">
              {unicos.length ? `Inclui: ${unicos.join(", ")}.` : ""}
              {unicos.length && mensais.length ? " " : ""}
              {mensais.length ? `Mensal: ${mensais.join(", ")}.` : ""}
            </p>
          ) : null}
        </div>
        {pagamentoTexto}
      </div>
    </>
  );
}

function Conteudo({ b, d, aceite, pacoteEscolhido }: { b: Bloco; d: DadosDoDocumento; aceite?: ReactNode; pacoteEscolhido?: NivelDoPacote | null }) {
  switch (b.tipo) {
    case "desafio": {
      const x = b.dados as DadosDoBloco["desafio"];
      return (
        <>
          {x.texto ? <p className="pd-corpo">{x.texto}</p> : null}
          {x.palavras_do_cliente.map((p) => (
            <blockquote key={p} className="pd-citacao">
              “{p}”
            </blockquote>
          ))}
          {x.compromisso ? <div className="pd-compromisso">{x.compromisso}</div> : null}
        </>
      );
    }
    case "diagnostico": {
      const x = b.dados as DadosDoBloco["diagnostico"];
      return (
        <ul className="pd-lista">
          {x.achados.map((a, i) => (
            <li key={`${a.titulo}-${i}`}>
              <span className="pd-bolinha">{i + 1}</span>
              <span>
                <span className="pd-item-titulo">{a.titulo}</span>
                {a.texto ? <span className="pd-item-texto">{a.texto}</span> : null}
                {a.fonte ? <Fonte f={a.fonte} /> : null}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    case "mercado": {
      const x = b.dados as DadosDoBloco["mercado"];
      return (
        <>
          {x.resumo ? <p className="pd-corpo">{x.resumo}</p> : null}
          {x.dados.length ? (
            <div className="pd-grade pd-grade-2">
              {x.dados.map((dado, i) => (
                <div key={`${dado.valor}-${i}`} className="pd-cartao">
                  <span className="pd-numero">{dado.valor}</span>
                  <span className="pd-item-texto">{dado.rotulo}</span>
                  <Fonte f={dado.fonte} />
                </div>
              ))}
            </div>
          ) : null}
          {x.concorrentes.length ? (
            <div className="pd-tabela-rola">
              <table className="pd-comparativo pd-concorrencia">
                <caption>Concorrência</caption>
                <thead>
                  <tr>
                    <th scope="col">Quem</th>
                    <th scope="col">Faz bem</th>
                    <th scope="col">Oportunidade</th>
                  </tr>
                </thead>
                <tbody>
                  {x.concorrentes.map((c) => (
                    <tr key={c.nome}>
                      <th scope="row">
                        {c.nome}
                        <Fonte f={c.fonte} />
                      </th>
                      <td>{c.faz_bem}</td>
                      <td>{c.oportunidade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {x.faixa_de_preco ? (
            <div className="pd-cartao">
              <span className="pd-item-titulo">Faixa de preço no mercado</span>
              <span className="pd-item-texto">{x.faixa_de_preco.texto}</span>
              <Fonte f={x.faixa_de_preco.fonte} />
            </div>
          ) : null}
          {x.pesquisado_em ? <p className="pd-pequeno">Pesquisa feita em {dataCurta(x.pesquisado_em)}.</p> : null}
        </>
      );
    }
    case "solucao": {
      const x = b.dados as DadosDoBloco["solucao"];
      return (
        <>
          {x.texto ? <p className="pd-corpo">{x.texto}</p> : null}
          {x.frentes.length ? (
            <div className="pd-grade pd-grade-2">
              {x.frentes.map((f, i) => (
                <div key={`${f.titulo}-${i}`} className="pd-cartao">
                  <span className="pd-bolinha">{i + 1}</span>
                  <span className="pd-item-titulo">{f.titulo}</span>
                  <span className="pd-item-texto">{f.texto}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      );
    }
    case "entregaveis": {
      const x = b.dados as DadosDoBloco["entregaveis"];
      return (
        <>
          <Lista itens={x.itens.map((i) => ({ titulo: i.nome, texto: i.detalhe }))} />
          {x.nao_inclui.length ? <p className="pd-pequeno">Não inclui: {x.nao_inclui.join(" ")}</p> : null}
        </>
      );
    }
    case "processo": {
      const x = b.dados as DadosDoBloco["processo"];
      return <Lista numerada itens={x.etapas} />;
    }
    case "cronograma": {
      const x = b.dados as DadosDoBloco["cronograma"];
      return (
        <>
          <Cronograma x={x} />
          {x.observacao ? <p className="pd-pequeno">{x.observacao}</p> : null}
        </>
      );
    }
    case "investimento":
      return <Investimento x={b.dados as DadosDoBloco["investimento"]} itens={d.itens} pacotes={d.pacotes} pagamento={d.pagamento} pacoteEscolhido={pacoteEscolhido} />;
    case "provas": {
      const x = b.dados as DadosDoBloco["provas"];
      return (
        <>
          {x.cases.length ? (
            <div className="pd-grade pd-grade-2">
              {x.cases.map((c) => (
                <div key={c.titulo} className="pd-cartao">
                  <span className="pd-item-titulo">{c.titulo}</span>
                  {c.texto ? <span className="pd-item-texto">{c.texto}</span> : null}
                  {c.link ? (
                    <span className="pd-fonte">
                      <a href={c.link} target="_blank" rel="noopener noreferrer">
                        Ver o trabalho
                      </a>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {x.depoimentos.map((dep) => (
            <blockquote key={dep.nome} className="pd-citacao">
              “{dep.texto}”
              <span className="pd-fonte">{dep.nome}</span>
            </blockquote>
          ))}
        </>
      );
    }
    case "quem_somos": {
      const x = b.dados as DadosDoBloco["quem_somos"];
      return <p className="pd-corpo">{x.texto}</p>;
    }
    case "proximos_passos": {
      const x = b.dados as DadosDoBloco["proximos_passos"];
      return (
        <>
          <Lista numerada itens={x.passos.map((p) => ({ titulo: p }))} />
          {x.chamada ? <p className="pd-sub pd-destaque">{x.chamada}</p> : null}
          {aceite}
        </>
      );
    }
    default:
      return null;
  }
}

export default function PropostaDocumento({
  dados,
  cliente,
  logoCliente,
  aceite,
  previa = false,
  emFoco,
  animar = false,
  pacoteEscolhido = null,
}: {
  dados: DadosDoDocumento;
  cliente: string;
  logoCliente?: string | null;
  /** O formulário de aceite (só no link público), no fim dos próximos passos. */
  aceite?: ReactNode;
  previa?: boolean;
  /** Bloco que está sendo editado (a prévia marca). */
  emFoco?: TipoDeBloco | null;
  /** Link público: as páginas entram com um fade leve ao rolar (o link liga). */
  animar?: boolean;
  /** Pacote marcado no aceite (destaca no investimento). */
  pacoteEscolhido?: NivelDoPacote | null;
}) {
  const blocos = blocosParaMostrar(dados.conteudo);
  const visual = normalizarVisual(dados.visual);
  const cor = visual.cores[0] || "";
  const textoNaCor = cor ? corDoTextoSobre(cor) : "#ffffff";
  const estilo = (cor ? { "--pd-cliente": cor, "--pd-cliente-texto": textoNaCor } : {}) as CSSProperties;
  const anexos = (dados.anexos || []).filter((a) => a && a.titulo);
  const classe = ["pd", previa ? "pd-previa" : "", `pd-tema-${visual.tema}`, cor ? "pd-com-cor" : "", animar ? "pd-anima" : ""].filter(Boolean).join(" ");
  return (
    <div className={classe} style={estilo} data-proposta-documento="" data-tema={visual.tema}>
      {blocos.map((b, i) => {
        // Capa no tema "Cores do cliente": o fundo é a cor da marca; o topo segue o contraste.
        const capaNaCor = b.tipo === "capa" && visual.tema === "cliente" && !!cor;
        const escuro = capaNaCor ? textoNaCor === "#ffffff" : fundoNoTema(b.tipo, visual.tema) === "escuro";
        return (
          <section
            key={b.id}
            id={previa ? undefined : `pd-${b.tipo}`}
            className={`pd-pagina ${escuro ? "pd-escuro" : "pd-claro"}${capaNaCor ? " pd-capa-na-cor" : ""}${emFoco === b.tipo ? " pd-bloco-em-foco" : ""}${animar ? " pd-revela" : ""}`}
            data-bloco={b.tipo}
            aria-label={b.titulo}
          >
            <div className="pd-interno">
              <Topo escuro={escuro} numero={i + 1} total={blocos.length} />
              {b.tipo === "capa" ? (
                <Capa b={b as Bloco<"capa">} d={dados} cliente={cliente} logoCliente={logoCliente} />
              ) : (
                <>
                  <h2 className="pd-titulo">{b.titulo}</h2>
                  <Conteudo b={b} d={dados} aceite={aceite} pacoteEscolhido={pacoteEscolhido} />
                </>
              )}
            </div>
          </section>
        );
      })}
      {anexos.length ? (
        <section id={previa ? undefined : "pd-anexos"} className={`pd-pagina pd-claro${animar ? " pd-revela" : ""}`} data-bloco="anexos" aria-label="Materiais">
          <div className="pd-interno">
            <h2 className="pd-titulo">Materiais</h2>
            <ul className="pd-lista">
              {anexos.map((a) => (
                <li key={a.id}>
                  <span className="pd-check" aria-hidden="true" />
                  <span>
                    {a.url ? (
                      <a className="pd-item-titulo pd-link" href={a.url} target="_blank" rel="noopener noreferrer">
                        {a.titulo}
                      </a>
                    ) : (
                      <span className="pd-item-titulo">{a.titulo}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
      {aceite && !blocos.some((b) => b.tipo === "proximos_passos") ? (
        <section className="pd-pagina pd-escuro" data-bloco="aceite" aria-label="Aceite">
          <div className="pd-interno">{aceite}</div>
        </section>
      ) : null}
    </div>
  );
}
