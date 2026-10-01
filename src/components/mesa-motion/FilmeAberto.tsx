import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Archive, ArchiveRestore, Clapperboard, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import BotaoComIcone from "@/components/sistema/BotaoComIcone";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import MenuMais from "@/components/sistema/MenuMais";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { modeloDoPapel } from "@/lib/mesa/api";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";
import { TAMANHOS_DO_MOTION, type TipoDeFilme } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { chamarMotion, CHAVES, type Filme, nomePadraoDoFilme, useFilme, useFilmeDaUrl, useFilmes, useGuardarFilme } from "./motionApi";
import PoucosCliques from "./PoucosCliques";

/**
 * Barra do filme aberto (Mesa Motion): o select do filme, "Novo filme" (janela
 * com nome e tipo) e o "..." (Renomear, Arquivar). Cada etapa recebe o filme
 * já lido.
 *
 * - Lembra o último filme por cliente e marca: sem ?filme=, abre o lembrado
 *   (se está na lista) ou o mais recente. "Nenhum" escolhido no select é
 *   respeitado (não reabre sozinho).
 * - Filme de outro cliente (ou de outra marca) no endereço sai dele: o
 *   conteúdo nunca mostra o filme de um com o cabeçalho de outro.
 * - Escolher um filme no select leva à etapa dele (o servidor grava a etapa;
 *   ela anda até Stills e pula para Render ao montar, então um filme em
 *   construção abre em Stills).
 */

const NENHUM = "nenhum";

const TIPOS: Array<{ valor: TipoDeFilme; rotulo: string }> = [
  { valor: "apresentacao", rotulo: "Apresentação em motion" },
  { valor: "filme_marca", rotulo: "Filme da marca" },
];

/** Quem está com a barra montada abre o filme (o Desfazer do arquivar chega depois da troca de etapa). */
const abridor: { atual: ((id: string) => void) | null } = { atual: null };

function JanelaDoNome({ aberta, titulo, inicial, rotuloDoBotao, indo, onFechar, onEnviar, children }: { aberta: boolean; titulo: string; inicial: string; rotuloDoBotao: string; indo: boolean; onFechar: () => void; onEnviar: (nome: string) => void; children?: ReactNode }) {
  const [nome, setNome] = useState(inicial);
  const padrao = useRef(inicial);
  // Ao abrir, o nome já preenchido; se o padrão muda (outro tipo) e a pessoa não mexeu, acompanha.
  useEffect(() => {
    if (!aberta) return;
    setNome(inicial);
    padrao.current = inicial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta]);
  useEffect(() => {
    setNome((n) => (n === padrao.current ? inicial : n));
    padrao.current = inicial;
  }, [inicial]);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!indo && nome.trim()) onEnviar(nome.trim());
  };
  return (
    <JanelaCentral aberta={aberta} onMudar={(v) => !v && onFechar()} titulo={titulo} icone={<Clapperboard className="h-4 w-4" />} largura="sm" descricaoOculta={titulo}>
      <form onSubmit={enviar} className="min-w-0 space-y-4" data-janela-do-filme="">
        {children}
        <label className="block min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Nome</span>
          <input className={campo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} aria-label="Nome do filme" autoFocus />
        </label>
        <div className="flex min-w-0 justify-end">
          <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={onFechar}>
            Cancelar
          </button>
          <button type="submit" className={botao.primario} disabled={indo || !nome.trim()}>
            {indo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {rotuloDoBotao}
          </button>
        </div>
      </form>
    </JanelaCentral>
  );
}

export function ComFilme({ children, irPara }: { children: (filme: Filme, links: Record<string, string>) => ReactNode; irPara: IrPara }) {
  const { clientId, clientName } = useMesa();
  const { marca } = useMarcaDaMesa();
  const marcaId = marca ? marca.id : null;
  const [filmeId, mudarFilmeNaUrl] = useFilmeDaUrl();
  const filmes = useFilmes(clientId, marcaId);
  const aberto = useFilme(filmeId);
  const avisarErro = useAvisarErro();
  const qc = useQueryClient();
  const guardar = useGuardarFilme();
  const [lembrado, setLembrado] = useEstadoDaTela<string>(`mesa-motion:filme:${clientId}:${marcaId || "sem-marca"}`, "");
  const [janela, setJanela] = useState<null | "novo" | "renomear">(null);
  const [tipo, setTipo] = useState<TipoDeFilme>("apresentacao");
  const [indo, setIndo] = useState(false);

  const lista = filmes.data ? filmes.data.lista.filter((f) => !f.arquivado_em) : [];
  const nomes = lista.map((f) => f.nome);
  const filme = aberto.data && aberto.data.filme && aberto.data.filme.id === filmeId ? aberto.data.filme : null;
  const deOutroDono = !!filme && (filme.client_id !== clientId || (!!marcaId && !!filme.marca_id && filme.marca_id !== marcaId));
  const doDono = filme && !deOutroDono ? filme : null;

  // O que a pessoa acabou de pedir vale mais que o endereço ainda velho: a troca do endereço
  // chega numa pintura depois, e o filme que acabou de carregar não pode voltar a ser o lembrado
  // (nem reabrir) depois do "Nenhum".
  const filmeDaUrl = useRef<string | null>(filmeId);
  filmeDaUrl.current = filmeId;
  const pedido = useRef<{ id: string | null } | null>(null);
  if (pedido.current && pedido.current.id === filmeId) pedido.current = null;
  const filmeQueVale = () => (pedido.current ? pedido.current.id : filmeDaUrl.current);
  const nenhumEscolhido = useRef(lembrado === NENHUM);
  nenhumEscolhido.current = lembrado === NENHUM;
  const setFilmeId = (id: string | null) => {
    pedido.current = { id };
    mudarFilmeNaUrl(id);
  };

  // Dono: filme de outro cliente ou marca sai do endereço; o do dono vira o lembrado.
  useEffect(() => {
    if (!filme || filmeQueVale() !== filme.id) return;
    if (deOutroDono) setFilmeId(null);
    else if (lembrado !== filme.id) {
      nenhumEscolhido.current = false;
      setLembrado(filme.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filme ? filme.id : null, deOutroDono]);

  // Abertura sozinha: só com a lista lida (sem recarga), o lembrado se está nela, senão o mais recente.
  const listaPronta = !!filmes.data && !filmes.isFetching && !filmes.isError && !filmes.data.indisponivel;
  const alvo = !filmeId && listaPronta && lembrado !== NENHUM ? (lembrado && lista.some((f) => f.id === lembrado) ? lembrado : lista.length ? lista[0].id : null) : null;
  useEffect(() => {
    if (alvo && filmeQueVale() === null && !nenhumEscolhido.current) setFilmeId(alvo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

  const abrirRef = useRef(setFilmeId);
  abrirRef.current = setFilmeId;
  useEffect(() => {
    const abrir = (id: string) => abrirRef.current(id);
    abridor.atual = abrir;
    return () => {
      if (abridor.atual === abrir) abridor.atual = null;
    };
  }, []);

  const invalidarLista = () => void qc.invalidateQueries({ queryKey: CHAVES.filmes(clientId, marcaId) });

  const criar = async (t: TipoDeFilme, nome: string) => {
    setIndo(true);
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_criar", { client_id: clientId, nome: nome.trim() || undefined, tipo: t, marca_id: marcaId || undefined });
      guardar(d.filme);
      invalidarLista();
      setJanela(null);
      setFilmeId(d.filme.id);
    } catch (e) {
      avisarErro(e, "O filme não foi criado");
    } finally {
      setIndo(false);
    }
  };

  const renomear = async (nome: string) => {
    if (!doDono) return;
    setIndo(true);
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: doDono.id, nome });
      guardar(d.filme);
      setJanela(null);
    } catch (e) {
      avisarErro(e, "O nome não foi salvo");
    } finally {
      setIndo(false);
    }
  };

  const desarquivar = async (id: string, reabrir: boolean) => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_arquivar", { filme_id: id, arquivar: false });
      guardar(d.filme);
      invalidarLista();
      if (reabrir) {
        setLembrado(id);
        if (abridor.atual) abridor.atual(id);
      }
    } catch (e) {
      avisarErro(e, "O filme não voltou");
    }
  };

  const arquivar = async () => {
    if (!doDono) return;
    const { id, nome } = doDono;
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_arquivar", { filme_id: id, arquivar: true });
      guardar(d.filme);
      // Sem isto o filme_ler continuaria abrindo o arquivado e toda gravação voltaria 409.
      setFilmeId(null);
      invalidarLista();
      toast.success(`"${nome}" arquivado`, { duration: 9000, action: { label: "Desfazer", onClick: () => void desarquivar(id, true) } });
    } catch (e) {
      avisarErro(e, "O filme não foi arquivado");
    }
  };

  const escolher = (id: string) => {
    if (!id) {
      // "Nenhum" é escolha: a barra não reabre sozinha.
      nenhumEscolhido.current = true;
      setLembrado(NENHUM);
      setFilmeId(null);
      return;
    }
    const f = lista.find((x) => x.id === id);
    // Uma escrita só no endereço (etapa e filme juntos).
    pedido.current = { id };
    if (f) irPara(f.etapa, { filme: id });
    else setFilmeId(id);
  };

  const abrirNovo = (t: TipoDeFilme = "apresentacao") => {
    setTipo(t);
    setJanela("novo");
  };
  const nomeNovo = nomePadraoDoFilme(tipo, clientName || "", marca ? marca.nome : null, nomes);
  const indisponivel = !!(filmes.data && filmes.data.indisponivel);

  return (
    <div className="min-w-0 space-y-6" data-filme-aberto={filmeId || ""}>
      <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Filme aberto">
        <select
          value={filmeId || ""}
          onChange={(e) => escolher(e.target.value)}
          className={juntar(campo, "mb-2 mr-2 w-auto min-w-0 max-w-full flex-1 sm:min-w-[220px] sm:flex-none")}
          aria-label="Escolher o filme"
          disabled={filmes.isLoading || filmes.isError}
        >
          <option value="">{lista.length ? "Escolha um filme" : "Nenhum filme ainda"}</option>
          {filme && !lista.some((f) => f.id === filme.id) && !deOutroDono && (
            <option value={filme.id}>
              {filme.nome}
              {filme.arquivado_em ? " (arquivado)" : ""}
            </option>
          )}
          {lista.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome} · {f.tipo === "filme_marca" ? "filme da marca" : "motion"}
            </option>
          ))}
        </select>
        <BotaoComIcone icone={<Plus className="h-3.5 w-3.5" />} rotulo="Novo filme" className="mb-2 mr-1" onClick={() => abrirNovo()} disabled={indisponivel} data-novo-filme="" />
        {doDono && !doDono.arquivado_em && <PoucosCliques filme={doDono} />}
        {doDono && (
          <MenuMais
            rotulo="Mais do filme"
            className="mb-2"
            itens={
              doDono.arquivado_em
                ? [{ rotulo: "Desarquivar", icone: <ArchiveRestore className="h-4 w-4" />, aoEscolher: () => void desarquivar(doDono.id, false) }]
                : [
                    { rotulo: "Renomear", icone: <Pencil className="h-4 w-4" />, aoEscolher: () => setJanela("renomear") },
                    { rotulo: "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => void arquivar(), perigo: true },
                  ]
            }
          />
        )}
      </div>
      {indisponivel && <p className={juntar(texto.auxiliar, "text-warning")}>{filmes.data!.aviso}</p>}
      {!filmeId && filmes.isError && <EstadoDeErro titulo="A lista de filmes não carregou." acao={<button type="button" className={botao.secundario} onClick={() => void filmes.refetch()}>Tentar de novo</button>} />}
      {!filmeId && !filmes.isError && (filmes.isLoading || !!alvo) && <Carregando forma="aba" rotulo="Abrindo o filme" />}
      {!filmeId && !filmes.isError && !filmes.isLoading && !alvo && (
        <EstadoVazio
          icone={<Clapperboard className="h-5 w-5" />}
          titulo="Escolha ou crie um filme"
          descricao="Apresentação da empresa em motion ou filme cinematográfico da marca."
          acao={
            indisponivel ? undefined : (
              <div className="flex flex-wrap justify-center">
                <button type="button" className={juntar(botao.primario, "m-1")} disabled={indo} onClick={() => void criar("apresentacao", nomePadraoDoFilme("apresentacao", clientName || "", null, nomes))} data-criar-filme="apresentacao">
                  {indo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  Apresentação em motion
                </button>
                <button type="button" className={juntar(botao.secundario, "m-1")} disabled={indo} onClick={() => void criar("filme_marca", nomePadraoDoFilme("filme_marca", clientName || "", marca ? marca.nome : null, nomes))} data-criar-filme="filme_marca">
                  Filme da marca
                </button>
              </div>
            )
          }
        />
      )}
      {filmeId && aberto.isLoading && <Carregando forma="aba" rotulo="Abrindo o filme" />}
      {filmeId && aberto.isError && <EstadoDeErro titulo="O filme não abriu." descricao="Tente de novo ou escolha outro filme." acao={<button type="button" className={botao.secundario} onClick={() => void aberto.refetch()}>Tentar de novo</button>} />}
      {doDono && aberto.data && children(doDono, aberto.data.links)}

      <JanelaDoNome aberta={janela === "novo"} titulo="Novo filme" inicial={nomeNovo} rotuloDoBotao="Criar" indo={indo} onFechar={() => setJanela(null)} onEnviar={(n) => void criar(tipo, n)}>
        <div className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Tipo</span>
          <SeletorCompacto opcoes={TIPOS} valor={tipo} onEscolher={(v) => setTipo(v as TipoDeFilme)} rotulo="Tipo do filme" larguraTotal listaQuandoNaoCabe />
        </div>
      </JanelaDoNome>
      <JanelaDoNome aberta={janela === "renomear"} titulo="Renomear o filme" inicial={doDono ? doDono.nome : ""} rotuloDoBotao="Salvar" indo={indo} onFechar={() => setJanela(null)} onEnviar={(n) => void renomear(n)} />
    </div>
  );
}

/** Modelo escolhido na hora (padrão do papel motion, trocável) e o custo antes. */
export function useModeloDaAcao(chave: string) {
  const { catalogo, clientId } = useMesa();
  const [escolhido, setEscolhido] = useEstadoDaTela<string>(`mesa-motion:modelo:${chave}:${clientId}`, "");
  const modelo = modeloDoPapel(catalogo, "motion", escolhido || null);
  return { modelo, escolhido, setEscolhido, catalogo };
}

export function ModeloDaAcao({ chave, alvo }: { chave: string; alvo: keyof typeof TAMANHOS_DO_MOTION }) {
  const { modelo, setEscolhido, catalogo } = useModeloDaAcao(chave);
  const t = TAMANHOS_DO_MOTION[alvo];
  return (
    <div className="flex min-w-0 flex-wrap items-end" data-modelo-da-acao={chave}>
      <div className="mr-3 min-w-[220px] flex-1 sm:max-w-[320px]">
        <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modelo ? modelo.id : ""} onChange={setEscolhido} rotulo="Modelo" />
      </div>
      <span className="mb-2 shrink-0">{modelo && <EstimativaInline partes={[{ modeloId: modelo.id, tipo: "texto", tokensEntrada: t.entrada, tokensSaida: t.saida }]} />}</span>
    </div>
  );
}
