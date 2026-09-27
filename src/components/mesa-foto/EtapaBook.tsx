import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BookImage, Check, Download, Images, Library, Loader2, Maximize2, MessageSquare, Plus, Search, Send, Sparkles, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar } from "@/components/mesa/Ampliar";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { imagensDoColar } from "@/components/mesa/EstudioFotos";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeQualidade } from "@/components/mesa/Seletores";
import { padraoPara, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto, useAcoesDeUso } from "./AcoesDeUso";
import AcoesProDaFoto from "./AcoesProDaFoto";
import { MiniaturaDaFoto, Moldura, Pilulas } from "./Comuns";
import { AjudaRecolhida, BarraDeAcoes, CampoDeEscolha, CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, Painel, Secao, SeletorCompacto, botao, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import { ImagemDaBiblioteca } from "./EtapaBiblioteca";
import { ZonaDeEnvio } from "./EtapaAcervo";
import SeletorDeFotos from "./SeletorDeFotos";
import SeletorLateral, { type ItemDoSeletor } from "./SeletorLateral";
import { AtalhosDaFoto, MenuDeUso } from "./UsoDaFoto";
import { useClones } from "./clonesApi";
import { acrescentarFotos, classeDaFoto, invalidarFotos, semearUrl, subirOriginais, useBiblioteca, useFotos, useKits, type FotoDoAcervo, type ItemDaBiblioteca } from "./fotoApi";
import { chaveDoAndamento, emParalelo, marcarAndamento, useAndamentos, usePersonas, usePrecoNoServidor } from "./modelosApi";
import {
  chaveDosBooks,
  criarBook,
  conversarNoBook,
  FORMATOS_DO_BOOK,
  gerarNoBook,
  guardarBookNaLista,
  MAX_ESTILO_POR_FOTO,
  moverNaSelecao,
  mudarBookAberto,
  novoIdDePedido,
  partesDoBook,
  partesDoDiretorDoBook,
  pedidoDaBiblioteca,
  salvarBook,
  TIPOS_DO_ASSUNTO,
  useBookAberto,
  useBooks,
  type Book,
  type BookAberto,
  type PedidoDoBook,
  type TipoDoAssunto,
} from "./bookApi";

/**
 * Book (pedido do dono, 26/09): "dentro da Mesa Foto, uma área de BOOK: um
 * estúdio fotográfico. Pegar as referências, trabalhar em cima de cada
 * produto ('quero o produto desse jeito') ou da pessoa; já ter um arsenal de
 * prompts lateral; colocar o prompt no agente, ele gera; selecionar as
 * imagens que eu quero; embaixo, mais referências; fazer um book completo
 * profissional, tanto do produto quanto da pessoa".
 *
 * Tela: à esquerda o arsenal de prompts da biblioteca (filtrado pelo
 * assunto, com as miniaturas); no centro o assunto, a conversa com o diretor
 * que monta os pedidos, a fila de pedidos (gerar em lote, custo antes), os
 * resultados para escolher e, embaixo, as referências; à direita o book final
 * em ordem (baixar em alta, uma a uma; aprovação; Arquivos).
 *
 * Reaproveita o que já existe: a biblioteca, o diretor (as mesmas regras da
 * casa), a identidade do kit, da persona e do clone (a variação do clone é a
 * mesma função da aba Clones, com a autorização). Sem laço de correção: gera
 * uma vez, a equipe escolhe. Nada escurece a foto; toda foto é marcada como
 * gerada.
 */



/** Grava partes do book: muda o cache na hora e manda à função; se ela recusar, relê. */
function useGravarBook(aberto: BookAberto) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  return (campos: Partial<Pick<Book, "pedidos" | "referencias" | "selecao" | "status" | "nome">>) => {
    mudarBookAberto(queryClient, aberto.book.id, (b) => ({ ...b, book: { ...b.book, ...campos } }));
    salvarBook(aberto.book.id, campos)
      .then((b) => {
        if (b) guardarBookNaLista(queryClient, clientId, b);
      })
      .catch((e) => {
        avisarErro(e, "Book não gravado");
        void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "book", aberto.book.id] });
      });
  };
}

// ------------------------------------------------------------------ lote fora da tela

async function rodarPedidos(p: { queryClient: QueryClient; clientId: string; bookId: string; pedidos: PedidoDoBook[]; qualidade: Qualidade; atualizar: () => void }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  const avisos: string[] = [];
  const rodada = String(Date.now());
  const itens = p.pedidos.map((pedido, i) => ({ pedido, chave: chaveDoAndamento(p.bookId, "book", rodada, String(i)) }));
  itens.forEach((x) => marcarAndamento(x.chave, { estado: "gerando", erro: "" }));
  await emParalelo(itens, 2, async ({ pedido, chave }) => {
    try {
      const r = await gerarNoBook({ bookId: p.bookId, pedido, qualidade: p.qualidade });
      if (r.imagem) {
        const nova = r.imagem;
        // Aparece na hora, com a URL da resposta (sem esperar a releitura do book).
        semearUrl(p.queryClient, nova.storage_bucket, nova.storage_path, r.url);
        mudarBookAberto(p.queryClient, p.bookId, (b) => ({ ...b, resultados: [nova].concat(b.resultados.filter((x) => x.id !== nova.id)) }));
        acrescentarFotos(p.queryClient, p.clientId, [nova]);
      }
      r.avisos.forEach((a) => {
        if (avisos.indexOf(a) < 0) avisos.push(a);
      });
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(chave, { estado: "falhou", erro: `${pedido.titulo}: ${textoDoErro(e)}` });
    }
  });
  invalidarFotos(p.queryClient, p.clientId);
  p.atualizar();
  if (feitas) toast.success(`${feitas} ${feitas === 1 ? "foto pronta" : "fotos prontas"} no book`, { description: `Custo real: ${usd(custo)}.${falhas ? ` ${falhas} não saiu.` : ""}${avisos.length ? ` ${avisos[0]}` : ""}` });
  else if (falhas) toast.error("Nenhuma foto saiu", { description: "Veja o erro na fila e tente de novo." });
}

// ------------------------------------------------------------------ novo book

function NovoBook({ onCriado, onCancelar }: { onCriado: (b: Book) => void; onCancelar: () => void }) {
  const { clientId } = useMesa();
  const avisarErro = useAvisarErro();
  const [tipo, setTipo] = useEstadoDaTela<TipoDoAssunto>(`mesa-foto:book:novo-tipo:${clientId}`, "produto", { validar: (v) => TIPOS_DO_ASSUNTO.some((t) => t.valor === v) });
  const [assuntoId, setAssuntoId] = useState<string | null>(null);
  const [nome, setNome] = useEstadoDaTela(`mesa-foto:book:novo-nome:${clientId}`, "");
  const [criando, setCriando] = useState(false);
  const [escolhendoFoto, setEscolhendoFoto] = useState(false);
  const kits = useKits(clientId);
  const personas = usePersonas(clientId, tipo === "persona");
  const clones = useClones(clientId, tipo === "clone");
  const fotos = useFotos(clientId);
  const opcoes: { id: string; nome: string; nota: string }[] =
    tipo === "produto"
      ? (kits.data || []).filter((k) => k.id && k.tipo !== "pessoa" && k.status !== "arquivado").map((k) => ({ id: String(k.id), nome: k.nome, nota: k.status === "confirmado" ? "confirmado" : "rascunho" }))
      : tipo === "persona"
        ? (personas.data || []).filter((p) => p.status !== "arquivada").map((p) => ({ id: p.id, nome: p.nome, nota: p.ancora_imagem_id ? (p.client_id ? "do cliente" : "da agência") : "sem âncora" }))
        : tipo === "clone"
          ? (clones.data || []).filter((c) => c.status !== "arquivada").map((c) => ({ id: c.id, nome: c.nome, nota: c.autorizacao_valida.ok ? "autorizado" : "autorização inválida" }))
          : [];
  const carregandoOpcoes = tipo === "produto" ? kits.isLoading : tipo === "persona" ? personas.isLoading : tipo === "clone" ? clones.isLoading : false;
  const fotoEscolhida = tipo === "foto" && assuntoId ? (fotos.data || []).find((f) => f.id === assuntoId) || null : null;
  const criar = async () => {
    if (!assuntoId || criando) return;
    setCriando(true);
    try {
      const r = await criarBook(clientId, { tipo, id: assuntoId }, nome);
      if (!r.book) throw new Error("A função não devolveu o book criado.");
      toast.success(`${r.book.nome} criado`, { description: "Escolha prompts no arsenal, converse com o diretor e gere as fotos. O custo aparece antes." });
      setNome("");
      onCriado(r.book);
    } catch (e) {
      avisarErro(e, "Book não criado");
    } finally {
      setCriando(false);
    }
  };
  return (
    <Secao titulo="Novo book" ajuda="Um book é um ensaio completo de UM assunto: o produto ou a pessoa sai fiel às fotos de identidade, com as referências só como estilo. Criar não gasta; o custo aparece antes de cada geração." data-novo-book="">
      <CampoDeEscolha rotulo="Assunto">
        <Pilulas
          rotulo="Assunto do book"
          opcoes={TIPOS_DO_ASSUNTO.map((t) => ({ valor: t.valor, rotulo: t.rotulo, dica: t.dica }))}
          valor={tipo}
          onEscolher={(t) => {
            setTipo(t);
            setAssuntoId(null);
          }}
        />
      </CampoDeEscolha>
      {tipo === "foto" ? (
        <div className="mt-2 min-w-0">
          {fotoEscolhida ? (
            <div className="flex min-w-0 items-center">
              <span className="mr-2 block w-16 shrink-0">
                <MiniaturaDaFoto foto={fotoEscolhida} />
              </span>
              <span className="mr-2 min-w-0 truncate text-[13px] font-medium">{fotoEscolhida.nome}</span>
              <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setEscolhendoFoto(true)}>
                Trocar
              </button>
            </div>
          ) : (
            <button type="button" className={juntar(botao.secundario, "h-8 text-[12px]")} onClick={() => setEscolhendoFoto(true)}>
              <Images className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Escolher a foto do acervo
            </button>
          )}
          {escolhendoFoto && (
            <div className="mt-2">
              <SeletorDeFotos
                fotos={(fotos.data || []).filter((f) => !f.referencia_web)}
                titulo="Foto do assunto"
                multiplas={false}
                onUsar={(ids) => {
                  setAssuntoId(ids[0] || null);
                  setEscolhendoFoto(false);
                }}
                onFechar={() => setEscolhendoFoto(false)}
              />
            </div>
          )}
          <p className={juntar(texto.auxiliar, "mt-1.5")}>Pessoa real entra pelo Clone, com a autorização.</p>
        </div>
      ) : carregandoOpcoes ? (
        <Carregando forma="lista" linhas={2} className="mt-2" rotulo="Lendo as opções" />
      ) : opcoes.length === 0 ? (
        <EstadoVazio
          compacto
          className="mt-2"
          titulo={tipo === "produto" ? "Nenhum produto identificado ainda." : tipo === "persona" ? "Nenhuma persona ainda." : "Nenhum clone ainda."}
          descricao={tipo === "produto" ? "Identifique em Fotos." : tipo === "persona" ? "Crie em Modelos." : "Crie em Clones, com a autorização."}
        />
      ) : (
        <ul className="mt-2 grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Escolha o assunto">
          {opcoes.map((o) => (
            <li key={o.id} className="min-w-0">
              <button
                type="button"
                aria-pressed={assuntoId === o.id}
                onClick={() => setAssuntoId(o.id)}
                className={juntar("flex w-full min-w-0 items-center rounded-md border px-2.5 py-2 text-left", assuntoId === o.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40", foco)}
              >
                <span className="mr-auto min-w-0 truncate text-[13px] font-medium">{o.nome}</span>
                <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{o.nota}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <GrupoDeCampos className="mt-4">
        <CampoDeFormulario rotulo="Nome do book (opcional)">
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Book do Mouse M720" aria-label="Nome do book" className="h-9 text-[13px]" />
        </CampoDeFormulario>
      </GrupoDeCampos>
      <BarraDeAcoes className="mt-4 border-t border-border pt-3" inicio="Criar não gasta.">
        <button type="button" className={botao.discreto} onClick={onCancelar}>
          Cancelar
        </button>
        <button type="button" className={botao.primario} disabled={!assuntoId || criando} onClick={() => void criar()}>
          {criando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Criar book
        </button>
      </BarraDeAcoes>
    </Secao>
  );
}

// ------------------------------------------------------------------ arsenal de prompts

const PASSO_DO_ARSENAL = 24;

/** Os prompts da biblioteca que servem ao assunto, com a miniatura: pôr na fila ou mandar ao diretor. */
function ArsenalDePrompts({ aberto, paraODiretor, onParaODiretor }: { aberto: BookAberto; paraODiretor: string[]; onParaODiretor: (ids: string[]) => void }) {
  const { clientId } = useMesa();
  const biblioteca = useBiblioteca(clientId);
  const gravar = useGravarBook(aberto);
  const [busca, setBusca] = useEstadoDaTela(`mesa-foto:book:busca:${aberto.book.id}`, "");
  const [so, setSo] = useEstadoDaTela<"assunto" | "todos">(`mesa-foto:book:filtro:${aberto.book.id}`, "assunto", { validar: (v) => v === "assunto" || v === "todos" });
  const [quantos, setQuantos] = useState(PASSO_DO_ARSENAL);
  const categorias = aberto.assunto.categorias;
  const prompts = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (biblioteca.data || []).filter((i) => {
      if (i.tipo !== "prompt") return false;
      if (so === "assunto" && categorias.length && categorias.indexOf(i.categoria) < 0) return false;
      if (termo && `${i.titulo} ${i.prompt_pt} ${i.tags.join(" ")}`.toLowerCase().indexOf(termo) < 0) return false;
      return true;
    });
  }, [biblioteca.data, busca, so, categorias]);
  const porNaFila = (item: ItemDaBiblioteca) => {
    const p = pedidoDaBiblioteca(item);
    if (!p) return;
    gravar({ pedidos: aberto.book.pedidos.concat([p]) });
    toast.message("Na fila", { description: item.titulo });
  };
  const visiveis = prompts.slice(0, Math.min(80, quantos));
  return (
    <Secao
      nivel={3}
      titulo={
        <span className="inline-flex items-center">
          <Library className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Arsenal de prompts
        </span>
      }
      descricao={`${prompts.length} ${prompts.length === 1 ? "prompt" : "prompts"}`}
      ajuda="Os prompts da biblioteca que servem ao assunto. Pôr na fila vira um pedido; mandar ao diretor entra na próxima conversa dele."
      aria-label="Arsenal de prompts"
      data-arsenal-de-prompts=""
    >
      <div className="relative mb-2 min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar prompt" aria-label="Buscar prompt" className="h-9 pl-8 text-[13px]" />
      </div>
      <SeletorCompacto
        rotulo="Quais prompts"
        opcoes={[
          { valor: "assunto", rotulo: aberto.assunto.tipo === "produto" || aberto.assunto.tipo === "foto" ? "Do produto" : "Da pessoa" },
          { valor: "todos", rotulo: "Todos" },
        ]}
        valor={so}
        onEscolher={(v) => setSo(v as "assunto" | "todos")}
        larguraTotal
      />
      {biblioteca.isLoading && <Carregando forma="lista" linhas={4} className="mt-2" rotulo="Lendo a biblioteca" />}
      {biblioteca.isSuccess && prompts.length === 0 && <EstadoVazio compacto className="mt-2" titulo="Nenhum prompt aqui." descricao={busca ? "Tente outra busca." : "Veja em Todos."} />}
      <ul className="mt-2 min-w-0 divide-y divide-border" aria-label="Prompts da biblioteca">
        {visiveis.map((i) => {
          const marcado = paraODiretor.indexOf(i.id) >= 0;
          return (
            <li key={i.id} className={juntar("flex min-w-0 items-start rounded-md px-1 py-1.5", marcado && "bg-primary/5")} data-prompt-do-arsenal={i.id}>
              <span className="relative mr-2 block h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                <ImagemDaBiblioteca item={i} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium" title={i.titulo}>
                  {i.titulo}
                </span>
                <span className="mt-0.5 flex flex-wrap">
                  <button type="button" className={juntar("mr-2 rounded text-[11px] font-medium text-primary hover:underline", foco)} onClick={() => porNaFila(i)}>
                    Pôr na fila
                  </button>
                  <button type="button" aria-pressed={marcado} className={juntar("rounded text-[11px] text-muted-foreground hover:text-foreground", foco)} onClick={() => onParaODiretor(marcado ? paraODiretor.filter((x) => x !== i.id) : paraODiretor.concat([i.id]).slice(-8))}>
                    {marcado ? "tirar do diretor" : "mandar ao diretor"}
                  </button>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {prompts.length > visiveis.length && visiveis.length < 80 && (
        <button type="button" className={juntar(botao.discreto, "mt-1 h-8 w-full")} onClick={() => setQuantos(quantos + PASSO_DO_ARSENAL)}>
          Mostrar mais ({prompts.length - visiveis.length})
        </button>
      )}
    </Secao>
  );
}

// ------------------------------------------------------------------ diretor

function DiretorDoBook({ aberto, paraODiretor, onLimpar }: { aberto: BookAberto; paraODiretor: string[]; onLimpar: () => void }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const biblioteca = useBiblioteca(clientId);
  // Rascunho do pedido ao diretor: fica lembrado por book (sair e voltar não perde).
  const [mensagem, setMensagem] = useEstadoDaTela(`mesa-foto:book:diretor:${aberto.book.id}`, "");
  const [quantidade, setQuantidade] = useState(4);
  const escolhidos = (biblioteca.data || []).filter((i) => paraODiretor.indexOf(i.id) >= 0);
  const ultima = aberto.book.conversa.filter((m) => m.papel === "diretor").pop() || null;
  return (
    <Secao
      nivel={3}
      titulo={
        <span className="inline-flex items-center">
          <MessageSquare className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Diretor do book
        </span>
      }
      ajuda="Diga ao diretor como quer o assunto, ou ponha prompts do arsenal na fila. Ele lê o contexto do cliente, o assunto, os prompts escolhidos e as referências e monta os pedidos (texto, não gera imagem)."
      data-diretor-do-book=""
    >
      {ultima && <p className={juntar(superficie.poco, "mb-2 px-3 py-2 text-[13px] leading-5 [overflow-wrap:anywhere]")}>{ultima.texto}</p>}
      <Textarea
        value={mensagem}
        onChange={(e) => setMensagem(e.target.value)}
        rows={2}
        placeholder={aberto.assunto.tipo === "produto" || aberto.assunto.tipo === "foto" ? "Ex.: quero o produto na bancada de travertino com luz de fim de tarde, e um close da textura" : "Ex.: book da pessoa no trabalho, retrato editorial e um corpo inteiro na rua"}
        aria-label="Pedido ao diretor do book"
        className="text-[13px]"
      />
      {escolhidos.length > 0 && (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
          {escolhidos.map((i) => (
            <span key={i.id} className="mb-1 mr-1 inline-flex max-w-full items-center rounded-full border border-primary/30 px-2 py-px text-[11px] text-primary">
              <span className="truncate">{i.titulo}</span>
            </span>
          ))}
          <button type="button" className={juntar("mb-1 rounded text-[11px] text-muted-foreground hover:text-foreground", foco)} onClick={onLimpar}>
            limpar
          </button>
        </div>
      )}
      <div className="mt-2 flex min-w-0 flex-wrap items-center">
        <span className={juntar(texto.rotulo, "mb-1.5 mr-2")}>Pedidos</span>
        <SeletorCompacto rotulo="Quantos pedidos o diretor monta" opcoes={[2, 4, 6, 8].map((n) => ({ valor: String(n), rotulo: String(n) }))} valor={String(quantidade)} onEscolher={(v) => setQuantidade(Number(v))} className="mb-1.5 mr-2" />
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Montar os pedidos
            </>
          }
          titulo="Pedidos do diretor"
          descricao="O diretor lê o contexto do cliente, o assunto, os prompts escolhidos e as referências e monta os pedidos de foto (texto, não gera imagem). Eles entram na fila para você revisar."
          className="mb-1.5 ml-auto h-9 text-[13px]"
          disabled={!mensagem.trim() && !escolhidos.length}
          partes={() => partesDoDiretorDoBook(padraoPara(catalogo, "diretor_arte"))}
          executar={() => conversarNoBook({ bookId: aberto.book.id, mensagem, promptIds: paraODiretor, quantidade })}
          aoConcluir={(data) => {
            if (!data) return;
            const novos = (data.pedidos || []) as PedidoDoBook[];
            mudarBookAberto(queryClient, aberto.book.id, (b) => ({ ...b, book: { ...b.book, conversa: data.conversa || b.book.conversa, pedidos: b.book.pedidos.concat(novos) } }));
            salvarBook(aberto.book.id, { pedidos: aberto.book.pedidos.concat(novos) }).catch(() => undefined);
            setMensagem("");
            onLimpar();
            if (data.avisos && data.avisos.length) toast.message("Diretor", { description: data.avisos.join(" ") });
          }}
        />
      </div>
    </Secao>
  );
}

// ------------------------------------------------------------------ fila de pedidos

function FilaDePedidos({ aberto }: { aberto: BookAberto }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const andamentos = useAndamentos();
  const gravar = useGravarBook(aberto);
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [livre, setLivre] = useEstadoDaTela(`mesa-foto:book:pedido-livre:${aberto.book.id}`, "");
  const pedidos = aberto.book.pedidos;
  const ids = marcados === null ? pedidos.map((p) => p.id) : marcados.filter((id) => pedidos.some((p) => p.id === id));
  const escolhidos = pedidos.filter((p) => ids.indexOf(p.id) >= 0);
  const chaves = Object.keys(andamentos).filter((k) => k.indexOf(`${aberto.book.id}|book|`) === 0);
  const gerando = chaves.filter((k) => andamentos[k].estado === "gerando").length;
  const falhas = chaves.filter((k) => andamentos[k].estado === "falhou").map((k) => andamentos[k].erro);
  const refs = (aberto.assunto.tipo === "clone" ? 6 : aberto.assunto.tipo === "produto" ? 4 : 2) + Math.min(MAX_ESTILO_POR_FOTO, aberto.book.referencias.length);
  const servidor = usePrecoNoServidor(clientId, "book_gerar", { book_id: aberto.book.id, quantidade: Math.max(1, escolhidos.length), qualidade }, escolhidos.length > 0);
  const mudar = (id: string, campos: Partial<PedidoDoBook>) => gravar({ pedidos: pedidos.map((p) => (p.id === id ? { ...p, ...campos } : p)) });
  const tirar = (id: string) => gravar({ pedidos: pedidos.filter((p) => p.id !== id) });
  const somarLivre = () => {
    const t = livre.trim();
    if (!t) return;
    gravar({ pedidos: pedidos.concat([{ id: novoIdDePedido(), titulo: t.slice(0, 60), prompt: t, formato: "4:5", origem: { tipo: "livre", id: null }, referencias: [] }]) });
    setLivre("");
  };
  const alternar = (id: string) => setMarcados(ids.indexOf(id) >= 0 ? ids.filter((x) => x !== id) : ids.concat([id]));
  return (
    <Secao
      nivel={3}
      divisoria
      titulo="Fila de pedidos"
      descricao={`${escolhidos.length} de ${pedidos.length} marcados`}
      ajuda="Uma foto por pedido. Aparece aqui assim que sai e fica salva mesmo se você sair da aba."
      data-fila-do-book=""
    >
      {pedidos.length === 0 ? (
        <EstadoVazio compacto titulo="Fila vazia." descricao="Ponha prompts do arsenal, peça ao diretor ou escreva um pedido abaixo." />
      ) : (
        <ul className="min-w-0 divide-y divide-border" aria-label="Pedidos do book">
          {pedidos.map((p) => {
            const marcado = ids.indexOf(p.id) >= 0;
            return (
              <li key={p.id} className={juntar("min-w-0 py-2.5", !marcado && "opacity-70")} data-pedido-do-book={p.id}>
                <div className="flex min-w-0 items-center">
                  <input type="checkbox" checked={marcado} onChange={() => alternar(p.id)} className="mr-2 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" aria-label={`Gerar ${p.titulo}`} />
                  <Input value={p.titulo} onChange={(e) => mudar(p.id, { titulo: e.target.value })} aria-label="Título do pedido" className="mr-1.5 h-8 min-w-0 flex-1 text-[13px] font-medium" />
                  <span className="mr-1 hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{p.origem.tipo === "biblioteca" ? "biblioteca" : p.origem.tipo === "diretor" ? "diretor" : "livre"}</span>
                  <button type="button" aria-label={`Tirar ${p.titulo}`} className={botao.icone} onClick={() => tirar(p.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Textarea value={p.prompt} onChange={(e) => mudar(p.id, { prompt: e.target.value })} rows={2} aria-label={`Prompt de ${p.titulo}`} className="mt-1.5 text-[13px]" />
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
                  <Pilulas rotulo={`Formato de ${p.titulo}`} opcoes={FORMATOS_DO_BOOK.map((f) => ({ valor: f, rotulo: f }))} valor={p.formato} onEscolher={(f) => mudar(p.id, { formato: f })} />
                </div>
                {aberto.referencias.length > 0 && (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center text-[11px]">
                    <span className="mb-1 mr-1.5 text-muted-foreground">Estilo:</span>
                    {aberto.referencias.map((r) => {
                      const usa = p.referencias.indexOf(r.id) >= 0;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          aria-pressed={usa}
                          className={juntar("mb-1 mr-1 max-w-[140px] truncate rounded-full border px-2 py-px", usa ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground", foco)}
                          onClick={() => mudar(p.id, { referencias: usa ? p.referencias.filter((x) => x !== r.id) : p.referencias.concat([r.id]).slice(-MAX_ESTILO_POR_FOTO) })}
                        >
                          {r.titulo}
                        </button>
                      );
                    })}
                    {p.referencias.length === 0 && <span className="mb-1 text-muted-foreground">(sem escolha: as {Math.min(MAX_ESTILO_POR_FOTO, aberto.referencias.length)} primeiras)</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex min-w-0 items-center">
        <Input
          value={livre}
          onChange={(e) => setLivre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") somarLivre();
          }}
          placeholder="Escreva um pedido (ex.: o produto de cima, sobre linho, sombra de janela)"
          aria-label="Pedido livre do book"
          className="mr-1.5 h-9 min-w-0 flex-1 text-[13px]"
        />
        <button type="button" className={juntar(botao.secundario, "px-2.5 sm:px-3.5")} onClick={somarLivre} disabled={!livre.trim()} aria-label="Pôr o pedido na fila">
          <Plus className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" /> <span className="hidden sm:inline">Pôr na fila</span>
        </button>
      </div>
      <div className="mt-3 grid min-w-0 grid-cols-1 items-end gap-3 border-t border-border pt-3 sm:grid-cols-[220px_minmax(0,1fr)]">
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
        <div className="flex min-w-0 flex-wrap items-center justify-end">
          {gerando > 0 && (
            <span className="mb-1.5 mr-2 inline-flex items-center text-[12px] text-muted-foreground" role="status">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> gerando {gerando}
            </span>
          )}
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {escolhidos.length} {escolhidos.length === 1 ? "foto" : "fotos"}
              </>
            }
            titulo="Fotos do book"
            descricao={`Uma foto por pedido; aparece aqui assim que sai e fica salva mesmo se você sair da aba.${typeof servidor.data === "number" ? ` Pela função: ~${usd(servidor.data)}.` : ""}`}
            className="mb-1.5 h-9 text-[13px]"
            disabled={!escolhidos.length || gerando > 0 || aberto.book.status === "arquivado"}
            fecharAoConfirmar
            partes={() => partesDoBook(padraoPara(catalogo, "imagem") ? padraoPara(catalogo, "imagem")!.id : null, qualidade, refs, escolhidos.length)}
            executar={() => {
              void rodarPedidos({ queryClient, clientId, bookId: aberto.book.id, pedidos: escolhidos, qualidade, atualizar: atualizarCusto });
              return Promise.resolve({});
            }}
          />
        </div>
      </div>
      {falhas.slice(0, 3).map((e, i) => (
        <p key={`${i}-${e}`} className="text-[12px] text-destructive [overflow-wrap:anywhere]" role="alert">
          {e}
        </p>
      ))}
    </Secao>
  );
}

// ------------------------------------------------------------------ resultados

function ResultadosDoBook({ aberto }: { aberto: BookAberto }) {
  const queryClient = useQueryClient();
  const andamentos = useAndamentos();
  const gravar = useGravarBook(aberto);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const gerando = Object.keys(andamentos).filter((k) => k.indexOf(`${aberto.book.id}|book|`) === 0 && andamentos[k].estado === "gerando").length;
  const selecao = aberto.book.selecao;
  const noBook = (id: string) => selecao.indexOf(id) >= 0;
  const alternar = (id: string) => gravar({ selecao: noBook(id) ? selecao.filter((x) => x !== id) : selecao.concat([id]) });
  const mudou = (f: FotoDoAcervo) => mudarBookAberto(queryClient, aberto.book.id, (b) => ({ ...b, resultados: b.resultados.map((x) => (x.id === f.id ? f : x)) }));
  const fotoAberta = aberta ? aberto.resultados.find((f) => f.id === aberta) || null : null;
  if (!aberto.resultados.length && !gerando) return null;
  return (
    <Secao nivel={3} divisoria titulo={`Resultados · ${aberto.resultados.length}`} descricao={`${selecao.length} no book`} ajuda="Marque as que vão para o book. A ordem do book fica no Book final." data-resultados-do-book="">
      {fotoAberta && (
        <div className="mb-3 grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-primary/40 p-3 sm:grid-cols-[160px_minmax(0,1fr)]" data-resultado-aberto={fotoAberta.id}>
          <Moldura proporcao={fotoAberta.largura && fotoAberta.altura ? fotoAberta.largura / fotoAberta.altura : 0.8} className="border border-border">
            <ImagemDaMesa caminho={fotoAberta.storage_path} bucket={fotoAberta.storage_bucket || "mesa"} alt={fotoAberta.nome} className="h-full w-full !object-contain" />
          </Moldura>
          <div className="min-w-0 space-y-1.5">
            <div className="flex min-w-0 items-start">
              <p className="mr-auto truncate text-[13px] font-semibold">{fotoAberta.nome}</p>
              <button type="button" aria-label="Fechar o resultado" className={botao.icone} onClick={() => setAberta(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-w-0 flex-wrap items-center">
              <Button type="button" size="sm" variant={noBook(fotoAberta.id) ? "default" : "outline"} className="mb-1.5 mr-1.5 h-8 text-[12px]" onClick={() => alternar(fotoAberta.id)}>
                <BookImage className="mr-1.5 h-3.5 w-3.5" /> {noBook(fotoAberta.id) ? "No book" : "Pôr no book"}
              </Button>
              <AprovarFoto foto={fotoAberta} onMudou={mudou} />
              <MenuDeUso foto={fotoAberta} rotulo="Usar" variante="outline" className="mb-1.5" />
            </div>
            <div className="flex min-w-0 flex-wrap items-center">
              <AtalhosDaFoto foto={fotoAberta} />
            </div>
            <p className={juntar(texto.rotulo, "mb-1.5")}>Ampliar e tirar fundo (pro)</p>
            <AcoesProDaFoto
              foto={fotoAberta}
              onPronta={(nova) => {
                // A versão ampliada entra nos resultados (tag do book herdada ou não, ela é do book).
                mudarBookAberto(queryClient, aberto.book.id, (b) => ({ ...b, resultados: [nova].concat(b.resultados.filter((x) => x.id !== nova.id)) }));
                if (noBook(fotoAberta.id)) gravar({ selecao: selecao.map((x) => (x === fotoAberta.id ? nova.id : x)) });
                setAberta(nova.id);
              }}
            />
          </div>
        </div>
      )}
      <ul className="grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-5" aria-label="Resultados do book">
        {Array.from({ length: gerando }, (_x, i) => (
          <li key={`gerando-${i}`} className="min-w-0 rounded-lg border border-dashed border-primary/40 p-1" data-resultado-gerando="">
            <Moldura proporcao={1} className="animate-pulse">
              <span className="flex h-full w-full flex-col items-center justify-center text-[11px] text-muted-foreground">
                <Loader2 className="mb-1 h-4 w-4 animate-spin text-primary" /> gerando
              </span>
            </Moldura>
          </li>
        ))}
        {aberto.resultados.map((f, i) => (
          <li key={f.id} className={juntar("relative min-w-0 rounded-lg border p-1", noBook(f.id) ? "border-primary" : "border-transparent")} data-resultado-do-book={f.id}>
            <div className="relative">
              <button type="button" className={juntar("block w-full rounded-lg", foco)} onClick={() => setAberta(f.id)} aria-label={`Abrir ${f.nome}`}>
                <MiniaturaDaFoto foto={f} />
              </button>
              <button type="button" onClick={() => setAmpliada(i)} aria-label={`Ver grande ${f.nome}`} className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm">
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              aria-pressed={noBook(f.id)}
              onClick={() => alternar(f.id)}
              className={juntar("mt-1 flex h-7 w-full items-center justify-center rounded-md border px-1 text-[11px] font-medium", noBook(f.id) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground", foco)}
            >
              {noBook(f.id) ? (
                <>
                  <Check className="mr-0.5 h-3 w-3" /> no book
                </>
              ) : (
                "pôr no book"
              )}
            </button>
          </li>
        ))}
      </ul>
      <Ampliar
        imagens={aberto.resultados.map((f) => ({ caminho: f.storage_path, bucket: f.storage_bucket || "mesa", titulo: f.nome, legenda: "Imagem gerada por IA.", proporcao: f.largura && f.altura ? f.largura / f.altura : undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </Secao>
  );
}

// ------------------------------------------------------------------ referências (embaixo)

function ReferenciasDoBook({ aberto }: { aberto: BookAberto }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const gravar = useGravarBook(aberto);
  const fotos = useFotos(clientId);
  const biblioteca = useBiblioteca(clientId);
  const [modo, setModo] = useState<"nenhum" | "acervo" | "biblioteca">("nenhum");
  const [andamento, setAndamento] = useState<string | null>(null);
  const refs = aberto.book.referencias;
  const somar = (novas: { tipo: "acervo" | "biblioteca"; id: string }[]) => {
    const lista = refs.slice();
    novas.forEach((n) => {
      if (!lista.some((r) => r.id === n.id)) lista.push(n);
    });
    gravar({ referencias: lista.slice(0, 12) });
    // A leitura do book traz o título e a URL de cada referência nova.
    window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "book", aberto.book.id] }), 800);
  };
  const subir = async (arquivos: File[]) => {
    if (!arquivos.length || andamento) return;
    setAndamento("Subindo referências");
    try {
      const r = await subirOriginais(clientId, arquivos.slice(0, 6), (feitos, total) => setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando"));
      acrescentarFotos(queryClient, clientId, r.registradas);
      invalidarFotos(queryClient, clientId);
      somar(r.registradas.map((f) => ({ tipo: "acervo" as const, id: f.id })));
    } catch (e) {
      avisarErro(e, "Referências não subiram");
    } finally {
      setAndamento(null);
    }
  };
  // Ctrl+V com imagem na aba: vira referência (colar texto segue normal).
  const subirRef = useRef(subir);
  subirRef.current = subir;
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const imagens = imagensDoColar(e.clipboardData);
      if (!imagens.length || (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA"))) return;
      e.preventDefault();
      void subirRef.current(imagens);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, []);
  const refsDaBiblioteca = (biblioteca.data || []).filter((i) => i.tipo === "referencia" || !!(i.storage_path || i.imagem_url || i.miniatura_url));
  return (
    <Secao
      nivel={3}
      divisoria
      titulo={`Referências · ${refs.length}`}
      descricao={`Só como estilo; até ${MAX_ESTILO_POR_FOTO} por foto`}
      ajuda="Solte, cole (Ctrl+V) ou escolha. A referência dá luz, cenário, paleta e clima; o assunto sai sempre das fotos de identidade."
      acao={
        <>
          <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} aria-pressed={modo === "acervo"} onClick={() => setModo(modo === "acervo" ? "nenhum" : "acervo")}>
            <Images className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Do acervo
          </button>
          <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} aria-pressed={modo === "biblioteca"} onClick={() => setModo(modo === "biblioteca" ? "nenhum" : "biblioteca")}>
            <Library className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Da biblioteca
          </button>
        </>
      }
      data-referencias-do-book=""
    >
      {aberto.referencias.length > 0 && (
        <ul className="mb-2 grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-6 xl:grid-cols-8" aria-label="Referências do book">
          {aberto.referencias.map((r) => (
            <li key={r.id} className="relative min-w-0" data-referencia-do-book={r.id}>
              <Moldura proporcao={1} className="border border-border">
                {r.storage_path ? (
                  <ImagemDaMesa caminho={r.storage_path} alt={r.titulo} className="h-full w-full" />
                ) : r.url ? (
                  <img src={r.url} alt={r.titulo} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">sem imagem</span>
                )}
              </Moldura>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={r.titulo}>
                {r.titulo}
              </p>
              <button type="button" aria-label={`Tirar a referência ${r.titulo}`} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground" onClick={() => gravar({ referencias: refs.filter((x) => x.id !== r.id) })}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ZonaDeEnvio compacta onArquivos={(a) => void subir(a)} andamento={andamento} />
      {modo === "acervo" && (
        <div className="mt-2">
          <SeletorDeFotos
            fotos={fotos.data || []}
            titulo="Referências do acervo (só estilo)"
            jaEscolhidas={refs.filter((r) => r.tipo === "acervo").map((r) => r.id)}
            onUsar={(ids) => {
              somar(ids.map((id) => ({ tipo: "acervo" as const, id })));
              setModo("nenhum");
            }}
            onFechar={() => setModo("nenhum")}
          />
        </div>
      )}
      {modo === "biblioteca" && (
        <ul className={juntar(superficie.poco, "mt-2 grid min-w-0 grid-cols-4 gap-1.5 p-2 sm:grid-cols-6 xl:grid-cols-8")} aria-label="Referências da biblioteca">
          {refsDaBiblioteca.slice(0, 48).map((i) => {
            const ja = refs.some((r) => r.id === i.id);
            return (
              <li key={i.id} className="min-w-0">
                <button type="button" disabled={ja} className={juntar("block w-full rounded-lg border p-0.5 text-left", ja ? "border-primary" : "border-transparent hover:border-border", foco)} onClick={() => somar([{ tipo: "biblioteca", id: i.id }])} aria-label={`Usar ${i.titulo} como referência`}>
                  <Moldura proporcao={1}>
                    <ImagemDaBiblioteca item={i} />
                  </Moldura>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{i.titulo}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}

// ------------------------------------------------------------------ book final

function BookFinal({ aberto }: { aberto: BookAberto }) {
  const gravar = useGravarBook(aberto);
  const { baixar, enviar, baixando, enviando } = useAcoesDeUso();
  const fotos = aberto.book.selecao.map((id) => aberto.resultados.find((f) => f.id === id)).filter((f): f is FotoDoAcervo => !!f);
  const semAprovar = fotos.filter((f) => classeDaFoto(f) === "gerada" && !f.aprovada).length;
  return (
    <Painel
      as="section"
      aria-label="Book final"
      data-book-final=""
      titulo={
        <span className="inline-flex items-center">
          <BookImage className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Book final · {fotos.length}
        </span>
      }
      descricao={aberto.book.status === "entregue" ? "entregue" : "em ordem"}
      rodape={
        fotos.length > 0 ? (
          <>
            {semAprovar > 0 && <p className={juntar(texto.auxiliar, "mr-auto w-full sm:w-auto")}>{semAprovar} sem a aprovação da equipe.</p>}
            <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" disabled={!!baixando} onClick={() => void baixar(fotos)} title="Uma a uma, no tamanho original">
              {baixando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              {baixando ? `Baixando ${baixando.feitos} de ${baixando.total}` : "Baixar o book (sem ZIP)"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" disabled={!!enviando} onClick={() => void enviar(fotos, "aprovacao")}>
              {enviando === "aprovacao" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />} Mandar para aprovação
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" disabled={!!enviando} onClick={() => void enviar(fotos, "arquivos")}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Arquivos
            </Button>
            {aberto.book.status !== "entregue" && (
              <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" onClick={() => gravar({ status: "entregue" })}>
                <Check className="mr-1.5 h-3.5 w-3.5" /> Marcar entregue
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {fotos.length === 0 ? (
        <p className={texto.auxiliar}>Marque "pôr no book" nos resultados. A ordem daqui é a do book.</p>
      ) : (
        <ol className="min-w-0 divide-y divide-border" aria-label="Fotos do book em ordem">
          {fotos.map((f, i) => (
            <li key={f.id} className="flex min-w-0 items-center py-1.5" data-foto-do-book={f.id}>
              <span className="mr-1.5 w-4 shrink-0 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="mr-2 block w-10 shrink-0">
                <MiniaturaDaFoto foto={f} selo={false} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{f.nome}</span>
                <span className={`text-[11px] ${f.aprovada ? "text-success" : "text-muted-foreground"}`}>{f.aprovada ? "aprovada" : "a aprovar"}</span>
              </span>
              <button type="button" aria-label={`Subir ${f.nome}`} className={juntar(botao.icone, "h-7 w-7 disabled:opacity-40")} disabled={i === 0} onClick={() => gravar({ selecao: moverNaSelecao(aberto.book.selecao, f.id, -1) })}>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label={`Descer ${f.nome}`} className={juntar(botao.icone, "h-7 w-7 disabled:opacity-40")} disabled={i === fotos.length - 1} onClick={() => gravar({ selecao: moverNaSelecao(aberto.book.selecao, f.id, 1) })}>
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label={`Baixar ${f.nome}`} title="Original, sem ZIP" className={juntar(botao.icone, "h-7 w-7")} disabled={!!baixando} onClick={() => void baixar([f])}>
                <Download className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label={`Tirar ${f.nome} do book`} className={juntar(botao.icone, "h-7 w-7")} onClick={() => gravar({ selecao: aberto.book.selecao.filter((x) => x !== f.id) })}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </Painel>
  );
}

// ------------------------------------------------------------------ book aberto

/**
 * O book aberto (sistema de design, 26/09): sem caixa em volta de caixa. No
 * computador, a coluna da esquerda tem o seletor dos books e, embaixo, o
 * arsenal; no meio, o assunto e o estúdio (diretor, fila, resultados,
 * referências); o book final vai à direita na tela grande. No celular a
 * ordem é: books, estúdio, arsenal, book final.
 */
function BookAbertoNaTela({ id, seletor }: { id: string; seletor: ReactNode }) {
  const q = useBookAberto(id);
  const { clientId } = useMesa();
  const [paraODiretor, setParaODiretor] = useEstadoDaTela<string[]>(`mesa-foto:book:para-o-diretor:${id}`, [], { validar: (v) => Array.isArray(v) });
  const grade = "grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] min-[1800px]:grid-cols-[260px_minmax(0,1fr)_300px]";
  if (q.isError && !q.data) {
    return (
      <div className={grade}>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">{seletor}</div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <EstadoDeErro
            titulo="Não foi possível abrir o book."
            descricao={textoDoErro(q.error)}
            acao={
              <button type="button" className={botao.secundario} onClick={() => void q.refetch()}>
                Tentar de novo
              </button>
            }
          />
        </div>
      </div>
    );
  }
  const aberto = q.data || null;
  const a = aberto ? aberto.assunto : null;
  return (
    <div className={grade} data-book-aberto={aberto ? aberto.book.id : undefined} data-cliente={clientId}>
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{seletor}</div>
      <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        {!aberto || !a ? (
          <Carregando forma="aba" rotulo="Abrindo o book" />
        ) : (
          <div className="min-w-0 space-y-6">
            <section className="flex min-w-0 items-center" aria-label="Assunto do book">
              <span className="relative mr-3 block h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                {a.capa_url ? <img src={a.capa_url} alt={a.nome} className="h-full w-full object-cover" loading="lazy" /> : <BookImage className="m-4 h-6 w-6 text-muted-foreground" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center">
                  <h2 className={juntar(texto.tituloPagina, "min-w-0 truncate text-[18px]")}>{aberto.book.nome}</h2>
                  <AjudaRecolhida className="ml-1.5">Estúdio fotográfico de UM assunto: o arsenal de prompts fica à esquerda, o diretor monta os pedidos, você gera com o custo antes, marca as boas e fecha o book em ordem (baixar em alta, aprovação e Arquivos).</AjudaRecolhida>
                </div>
                <p className={juntar(texto.auxiliar, "truncate")}>
                  {TIPOS_DO_ASSUNTO.find((t) => t.valor === a.tipo)?.rotulo}: {a.nome}
                  {a.detalhe ? ` · ${a.detalhe}` : ""}
                  {aberto.book.custo_usd ? ` · ${usd(aberto.book.custo_usd)} gasto` : ""}
                </p>
                {a.aviso && <p className="text-[12px] font-medium text-warning [overflow-wrap:anywhere]">{a.aviso}</p>}
              </div>
            </section>
            <DiretorDoBook aberto={aberto} paraODiretor={paraODiretor} onLimpar={() => setParaODiretor([])} />
            <FilaDePedidos aberto={aberto} />
            <ResultadosDoBook aberto={aberto} />
            <ReferenciasDoBook aberto={aberto} />
            <div className="min-[1800px]:hidden">
              <BookFinal aberto={aberto} />
            </div>
          </div>
        )}
      </div>
      {aberto && (
        <div className="min-w-0 border-t border-border pt-5 lg:col-start-1 lg:row-start-2 lg:border-t-0 lg:pt-0">
          <ArsenalDePrompts aberto={aberto} paraODiretor={paraODiretor} onParaODiretor={setParaODiretor} />
        </div>
      )}
      {aberto && (
        <div className="hidden min-w-0 min-[1800px]:col-start-3 min-[1800px]:row-span-2 min-[1800px]:row-start-1 min-[1800px]:block">
          <BookFinal aberto={aberto} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ etapa

export default function EtapaBook() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const booksQ = useBooks(clientId);
  const books = useMemo(() => booksQ.data || [], [booksQ.data]);
  // O book aberto e o "novo book" aberto ficam lembrados por cliente (sair e voltar não perde).
  const [escolhido, setEscolhido] = useEstadoDaTela<string | null>(`mesa-foto:book:aberto:${clientId}`, null, { validar: (v) => v === null || typeof v === "string" });
  const [novo, setNovo] = useEstadoDaTela<boolean>(`mesa-foto:book:novo:${clientId}`, false, { validar: (v) => typeof v === "boolean" });
  const aberto = books.find((b) => b.id === escolhido) || (novo ? null : books[0] || null);
  const itens: ItemDoSeletor[] = books.map((b) => ({
    id: b.id,
    nome: b.nome,
    miniatura: (
      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
        <BookImage className="h-4 w-4" />
      </span>
    ),
    estado: { rotulo: b.status === "entregue" ? "entregue" : `${b.selecao.length} no book`, ponto: b.status === "entregue" ? "bg-success" : "bg-primary" },
    nota: TIPOS_DO_ASSUNTO.find((t) => t.valor === b.assunto.tipo)?.rotulo.toLowerCase() || null,
  }));
  const semTabela = booksQ.isError && /migration 05|foto_books/i.test(textoDoErro(booksQ.error));
  const seletor = booksQ.isLoading ? (
    <Carregando forma="lista" linhas={3} rotulo="Lendo os books" />
  ) : (
    <SeletorLateral
      titulo="Books"
      itens={itens}
      escolhido={aberto ? aberto.id : null}
      onEscolher={(id) => {
        setNovo(false);
        setEscolhido(id);
      }}
      onNovo={() => setNovo(true)}
      novoRotulo="Novo book"
      novoAberto={novo}
      vazio="Nenhum book ainda."
      ajuda="Estúdio fotográfico de UM assunto: o arsenal de prompts, o diretor que monta os pedidos, gerar com o custo antes, marcar as boas e fechar o book em ordem (baixar em alta, aprovação e Arquivos)."
    />
  );
  return (
    <div className="min-w-0 space-y-4 pb-6">
      {booksQ.isError && (
        <EstadoDeErro
          titulo="Não foi possível ler os books."
          descricao={semTabela ? "O Book precisa da migration 05 (docs/mesa-foto/migrations/05_book.sql) no banco." : textoDoErro(booksQ.error)}
          acao={
            <button type="button" className={botao.secundario} onClick={() => void booksQ.refetch()}>
              Tentar de novo
            </button>
          }
        />
      )}
      {novo || !aberto ? (
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
          <div className="min-w-0">{seletor}</div>
          <div className="min-w-0">
            {novo || booksQ.isSuccess ? (
              <NovoBook
                onCancelar={() => setNovo(false)}
                onCriado={(b) => {
                  guardarBookNaLista(queryClient, clientId, b);
                  setEscolhido(b.id);
                  setNovo(false);
                  void queryClient.invalidateQueries({ queryKey: chaveDosBooks(clientId) });
                }}
              />
            ) : booksQ.isLoading ? (
              <Carregando forma="aba" rotulo="Lendo os books" />
            ) : null}
          </div>
        </div>
      ) : (
        <BookAbertoNaTela key={aberto.id} id={aberto.id} seletor={seletor} />
      )}
    </div>
  );
}
