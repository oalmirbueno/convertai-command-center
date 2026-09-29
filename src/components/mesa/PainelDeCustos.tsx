import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Download, Images, Layers, Loader2, ScanSearch, Wallet } from "lucide-react";
import { rotuloDoMes, textoDoErro, usd } from "@/lib/mesa/api";
import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import Secao from "@/components/sistema/Secao";
import { botao, campo, juntar } from "@/components/sistema/estilos";
import {
  agruparPorCliente,
  agruparPorMes,
  limitesDoPeriodo,
  mediasDe,
  paraCsv,
  PERIODOS,
  porUmDolar,
  quebraDoGasto,
  somarLinhas,
  useCustosDeProducao,
  type ChaveDoPeriodo,
  type Medias,
  type Totais,
} from "@/lib/mesa/custos";

/**
 * Custos de produção (admin e gestor; o cliente nunca vê). Visão da agência
 * e de cada cliente, por período: quantas peças saíram, quanto custou cada
 * uma em média e quanto US$ 1 compra de cada coisa. Números do banco
 * (src/lib/mesa/custos.ts); nada estimado.
 */

const CORES_DO_GASTO: Record<string, string> = {
  imagem: "bg-primary",
  planejamento: "bg-info",
  conferencia: "bg-warning",
  leitura: "bg-muted-foreground",
};

/** Quantidade com uma casa quando é pequena (0,4 carrossel), inteira quando é grande. */
export function quantidadeCurta(n: number | null): string {
  if (n === null || !isFinite(n)) return "sem base";
  if (n >= 10) return Math.floor(n).toLocaleString("pt-BR");
  return (Math.floor(n * 10) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

/** Frase "com US$ 1 você faz ..." só com o que tem base no período. */
export function fraseDoDolar(m: Medias): string | null {
  const partes: string[] = [];
  const junta = (valor: number | null, um: string, varios: string) => {
    const q = porUmDolar(valor);
    if (q === null) return;
    partes.push(`${quantidadeCurta(q)} ${q >= 0.95 && q < 1.05 ? um : varios}`);
  };
  junta(m.post, "post", "posts");
  junta(m.carrossel, "carrossel", "carrosséis");
  junta(m.imagem, "imagem", "imagens");
  junta(m.criativo, "criativo", "criativos");
  if (!partes.length) return null;
  const ultimo = partes.pop() as string;
  return `Com US$ 1 você faz ${partes.length ? `${partes.join(", ")} ou ${ultimo}` : ultimo}.`;
}

function baixarCsv(nome: string, conteudo: string) {
  try {
    const blob = new Blob([String.fromCharCode(0xfeff) + conteudo], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    /* navegador sem Blob: segue sem baixar */
  }
}

/** Uma média por peça, para a FaixaDeNumeros: o valor e, no apoio, quanto US$ 1 faz. */
function medio(rotulo: string, valor: number | null, base: string, unidade: string) {
  const q = porUmDolar(valor);
  return {
    rotulo,
    valor: valor === null ? "sem peça" : usd(valor),
    apoio: q === null ? base : `US$ 1 faz ${quantidadeCurta(q)} ${unidade} · ${base}`,
  };
}

function QuebraDoGasto({ totais }: { totais: Totais }) {
  const partes = quebraDoGasto(totais);
  const total = partes.reduce((s, p) => s + p.valor, 0);
  return (
    // Seção aberta (sem caixa), recolhível pelo título.
    <Secao titulo="Para onde foi o dinheiro" nivel={3} data-quebra-do-gasto="">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {total > 0 &&
          partes.map((p) =>
            p.valor > 0 ? <div key={p.chave} className={CORES_DO_GASTO[p.chave]} style={{ width: `${(p.valor / total) * 100}%` }} /> : null,
          )}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {partes.map((p) => (
          <li key={p.chave} className="flex min-w-0 items-start">
            <span className={`mr-2 mt-1.5 h-2 w-2 shrink-0 rounded-full ${CORES_DO_GASTO[p.chave]}`} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between">
                <span className="mr-2 truncate text-[13px] font-medium">{p.rotulo}</span>
                <span className="shrink-0 text-[13px] tabular-nums">
                  {usd(p.valor)} <span className="text-muted-foreground">· {p.pct}%</span>
                </span>
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">{p.detalhe}</span>
            </span>
          </li>
        ))}
      </ul>
    </Secao>
  );
}

const cel = "whitespace-nowrap px-3 py-2 text-right tabular-nums";
const celTitulo = "whitespace-nowrap px-3 py-2 text-right text-[12px] font-medium text-muted-foreground";

function TabelaPorCliente({ linhas, onEscolher }: { linhas: ReturnType<typeof agruparPorCliente>; onEscolher: (id: string) => void }) {
  if (!linhas.length) return null;
  return (
    // Tabela aberta (sem caixa), recolhível pelo título; a dica de uso fica no "?".
    // A região nomeada é só a tabela (os botões dela são os clientes).
    <Secao titulo="Por cliente" nivel={3} ajuda="Toque num cliente para ver só ele.">
      <section aria-label="Custos por cliente" className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left text-[12px] font-medium text-muted-foreground">Cliente</th>
              <th className={celTitulo}>Posts</th>
              <th className={celTitulo}>Carrosséis</th>
              <th className={celTitulo}>Criativos</th>
              <th className={celTitulo}>Imagens</th>
              <th className={celTitulo}>Gasto</th>
              <th className={celTitulo}>Por post</th>
              <th className={celTitulo}>Por carrossel</th>
              <th className={celTitulo}>Peça, tudo incluído</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((g) => {
              const m = mediasDe(g.totais);
              return (
                <tr key={g.client_id} className="border-b border-border last:border-b-0 hover:bg-muted/60">
                  <td className="max-w-[220px] px-3 py-2">
                    <button type="button" onClick={() => onEscolher(g.client_id)} className="block w-full truncate text-left font-medium hover:text-primary">
                      {g.nome}
                    </button>
                  </td>
                  <td className={cel}>{g.totais.posts}</td>
                  <td className={cel}>
                    {g.totais.carrosseis}
                    {g.totais.laminasCarrossel > 0 && <span className="text-muted-foreground"> ({g.totais.laminasCarrossel} lâm.)</span>}
                  </td>
                  <td className={cel}>{g.totais.criativos}</td>
                  <td className={cel}>{g.totais.imagensGeradas}</td>
                  <td className={`${cel} font-semibold`}>{usd(g.totais.gasto)}</td>
                  <td className={cel}>{m.post === null ? "·" : usd(m.post)}</td>
                  <td className={cel}>{m.carrossel === null ? "·" : usd(m.carrossel)}</td>
                  <td className={cel}>{m.pecaCheia === null ? "·" : usd(m.pecaCheia)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </Secao>
  );
}

function TabelaPorMes({ meses }: { meses: ReturnType<typeof agruparPorMes> }) {
  if (meses.length < 2) return null;
  return (
    <Secao titulo="Por mês" nivel={3}>
      <section aria-label="Custos por mês" className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead className="border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left text-[12px] font-medium text-muted-foreground">Mês</th>
              <th className={celTitulo}>Peças</th>
              <th className={celTitulo}>Imagens</th>
              <th className={celTitulo}>Gasto</th>
              <th className={celTitulo}>Peça, tudo incluído</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => {
              const pecas = m.totais.posts + m.totais.carrosseis + m.totais.criativos;
              const md = mediasDe(m.totais);
              return (
                <tr key={m.mes} className="border-b border-border last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2 font-medium first-letter:uppercase">{rotuloDoMes(m.mes)}</td>
                  <td className={cel}>{pecas}</td>
                  <td className={cel}>{m.totais.imagensGeradas}</td>
                  <td className={`${cel} font-semibold`}>{usd(m.totais.gasto)}</td>
                  <td className={cel}>{md.pecaCheia === null ? "·" : usd(md.pecaCheia)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </Secao>
  );
}

export default function PainelDeCustos({
  clientes,
  clienteInicial,
}: {
  clientes: { id: string; nome: string }[];
  /** Cliente aberto na Mesa: o painel começa filtrado nele. */
  clienteInicial?: string | null;
}) {
  const [periodo, setPeriodo] = useState<ChaveDoPeriodo>("mes");
  const [filtro, setFiltro] = useState<string>(clienteInicial || "");
  const { inicio, fim } = limitesDoPeriodo(periodo);
  const nomes = useMemo(() => {
    const n: Record<string, string> = {};
    for (const c of clientes) n[c.id] = c.nome;
    return n;
  }, [clientes]);
  const custos = useCustosDeProducao(inicio, fim, nomes);

  const todas = (custos.data && custos.data.linhas) || [];
  const linhas = filtro ? todas.filter((l) => l.client_id === filtro) : todas;
  const totais = somarLinhas(linhas);
  const medias = mediasDe(totais);
  const porCliente = agruparPorCliente(todas);
  const porMes = agruparPorMes(linhas);
  const frase = fraseDoDolar(medias);
  const pecas = totais.posts + totais.carrosseis + totais.criativos;
  const laminasPorCarrossel = totais.carrosseis > 0 ? totais.laminasCarrossel / totais.carrosseis : null;

  // Clientes do seletor: os da lista da Mesa e os que aparecem nos custos.
  const opcoes = useMemo(() => {
    const vistos: Record<string, boolean> = {};
    const saida: { id: string; nome: string }[] = [];
    for (const g of porCliente) {
      vistos[g.client_id] = true;
      saida.push({ id: g.client_id, nome: g.nome });
    }
    for (const c of clientes) if (!vistos[c.id]) saida.push(c);
    return saida.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [porCliente, clientes]);
  const nomeDoFiltro = filtro ? nomes[filtro] || (porCliente.find((g) => g.client_id === filtro) || { nome: "Cliente" }).nome : "";

  const exportar = () => {
    const sufixo = filtro ? `-${(nomeDoFiltro || "cliente").toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
    baixarCsv(`custos-mesa-${inicio}-a-${fim}${sufixo}.csv`, paraCsv(linhas));
  };

  return (
    <section aria-label="Custos de produção" className="min-w-0 space-y-4">
      {/* Cabeçalho do sistema: título, estado (quem está no filtro), o "?" com a explicação e as ações à direita. */}
      <CabecalhoDePagina
        nivel={2}
        titulo="Custos de produção"
        descricao={filtro ? nomeDoFiltro : "Todos os clientes"}
        ajuda={
          <>
            <span className="block">Quanto cada peça custou de IA, em dólar, direto da carteira.</span>
            <span className="mt-1.5 block">
              Gasto é o que a carteira de IA registrou no período. Peça é um trabalho do Estúdio com arte gerada, contado no mês em que foi criado; o custo
              dela soma tudo o que foi ligado a ela (direção, imagens, refações, correções e conferência). Planejamento do mês, leitura de referências e
              contexto só entram na peça com tudo incluído.
            </span>
          </>
        }
        acoes={
        <div className="flex min-w-0 flex-wrap items-center">
          <select
            aria-label="Cliente"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className={juntar(campo, "mb-1 mr-2 h-8 w-auto max-w-[220px] px-2")}
          >
            <option value="">Todos os clientes</option>
            {opcoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportar}
            disabled={!linhas.length}
            className={juntar(botao.secundario, "mb-1 h-8 px-2.5 text-[12px]")}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar CSV
          </button>
        </div>
        }
      />

      <div role="group" aria-label="Período" className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5 sm:inline-grid sm:grid-cols-5">
        {PERIODOS.map((p) => (
          <button
            key={p.chave}
            type="button"
            onClick={() => setPeriodo(p.chave)}
            aria-pressed={periodo === p.chave}
            className={`truncate rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
              periodo === p.chave ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {filtro && (
        <button type="button" onClick={() => setFiltro("")} className="inline-flex items-center text-[13px] text-primary hover:underline">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Ver todos os clientes
        </button>
      )}

      {custos.isLoading && (
        <div aria-busy="true" aria-label="Carregando custos" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {custos.isError && (
        <p className="rounded-md bg-destructive/10 p-3 text-[13px] text-destructive">
          Não consegui ler os custos. {textoDoErro(custos.error)}
        </p>
      )}

      {custos.data && (
        <>
          {/* Os quatro números numa faixa só (sem um cartão por número). */}
          <FaixaDeNumeros
            rotulo="Números do período"
            colunas={4}
            itens={[
              { rotulo: "Gasto no período", valor: usd(totais.gasto), apoio: `${totais.usos} chamadas de IA` },
              {
                rotulo: "Peças feitas",
                valor: String(pecas),
                apoio: `${totais.posts} posts, ${totais.carrosseis} carrosséis (${totais.laminasCarrossel} lâminas), ${totais.criativos} criativos`,
              },
              { rotulo: "Imagens geradas", valor: String(totais.imagensGeradas), apoio: `${totais.refacoes} refações, ${totais.automaticas} por correção automática` },
              { rotulo: "Conferências", valor: String(totais.conferencias), apoio: `${usd(totais.conferencia)} com Jev e leitura da arte` },
            ]}
          />

          {frase && (
            <p className="rounded-lg bg-primary/10 px-4 py-3 text-[14px] font-medium leading-snug text-foreground">{frase}</p>
          )}

          <section aria-label="Custo médio por peça" className="min-w-0">
            <Secao titulo="Quanto custa cada peça, em média" nivel={3}>
              <FaixaDeNumeros
                rotulo="Custo médio por peça"
                colunas={6}
                tamanho="compacto"
                itens={[
                  medio("Post", medias.post, `${totais.posts} no período`, "posts"),
                  medio(
                    "Carrossel",
                    medias.carrossel,
                    laminasPorCarrossel === null ? "0 no período" : `${totais.carrosseis} no período, ${quantidadeCurta(laminasPorCarrossel)} lâminas em média`,
                    "carrosséis",
                  ),
                  medio("Lâmina", medias.lamina, `${totais.laminas} lâminas de posts e carrosséis`, "lâminas"),
                  medio("Criativo de anúncio", medias.criativo, `${totais.criativos} no período`, "criativos"),
                  medio("Imagem gerada", medias.imagem, "inclui refações e correções", "imagens"),
                  medio("Peça, tudo incluído", medias.pecaCheia, "soma planejamento, leitura e conferência", "peças"),
                ]}
              />
            </Secao>
          </section>

          <QuebraDoGasto totais={totais} />

          {!filtro && <TabelaPorCliente linhas={porCliente} onEscolher={setFiltro} />}
          <TabelaPorMes meses={porMes} />

          {!todas.length && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">Nenhum gasto de IA neste período.</p>
          )}

          {/* A explicação do que conta como gasto e peça foi para o "?" do título; aqui fica só o estado. */}
          {(custos.data.origem === "direto" || (custos.isFetching && !custos.isLoading)) && (
            <p className="text-[12px] text-muted-foreground">
              {custos.data.origem === "direto" ? "Lido direto das tabelas: a função de custos do banco ainda não foi aplicada." : ""}
              {custos.isFetching && !custos.isLoading ? <Loader2 className="ml-1 inline h-3 w-3 animate-spin" aria-label="Atualizando" /> : null}
            </p>
          )}
        </>
      )}
    </section>
  );
}
