import { useState, type ReactNode } from "react";
import { Clapperboard, Loader2, Plus } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { EstimativaInline } from "@/components/mesa/Custo";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { modeloDoPapel } from "@/lib/mesa/api";
import { TIPOS_DE_FILME, TAMANHOS_DO_MOTION, type TipoDeFilme } from "../../../supabase/functions/_shared/motion-metodo";
import { chamarMotion, CHAVES, type Filme, useFilme, useFilmeDaUrl, useFilmes, useGuardarFilme } from "./motionApi";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Barra do filme aberto (Mesa Motion): escolhe o filme do cliente (e da marca
 * aberta) ou cria um novo (apresentação em motion ou filme da marca). Cada
 * etapa recebe o filme já lido; sem filme, a lista e o "Novo filme".
 */
export function ComFilme({ children }: { children: (filme: Filme, links: Record<string, string>) => ReactNode }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const [filmeId, setFilmeId] = useFilmeDaUrl();
  const filmes = useFilmes(clientId, marca ? marca.id : null);
  const aberto = useFilme(filmeId);
  const avisarErro = useAvisarErro();
  const qc = useQueryClient();
  const guardar = useGuardarFilme();
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoDeFilme>("apresentacao");
  const [criando, setCriando] = useState(false);

  const criar = async () => {
    setCriando(true);
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_criar", { client_id: clientId, nome: nome.trim() || undefined, tipo, marca_id: marca ? marca.id : undefined });
      guardar(d.filme);
      void qc.invalidateQueries({ queryKey: CHAVES.filmes(clientId, marca ? marca.id : null) });
      setFilmeId(d.filme.id);
      setNome("");
    } catch (e) {
      avisarErro(e, "O filme não foi criado");
    } finally {
      setCriando(false);
    }
  };

  const lista = filmes.data ? filmes.data.lista.filter((f) => !f.arquivado_em) : [];
  return (
    <div className="min-w-0 space-y-6" data-filme-aberto={filmeId || ""}>
      <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="Filme aberto">
        <select
          value={filmeId || ""}
          onChange={(e) => setFilmeId(e.target.value || null)}
          className={juntar(campo, "mb-2 mr-3 w-auto min-w-[220px] max-w-full flex-1 sm:flex-none")}
          aria-label="Escolher o filme"
          disabled={filmes.isLoading}
        >
          <option value="">{lista.length ? "Escolha um filme" : "Nenhum filme ainda"}</option>
          {lista.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome} · {f.tipo === "filme_marca" ? "filme da marca" : "motion"}
            </option>
          ))}
        </select>
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Nome do filme novo" className={juntar(campo, "mb-2 mr-3 w-auto min-w-[180px] flex-1 sm:flex-none")} aria-label="Nome do filme novo" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoDeFilme)} className={juntar(campo, "mb-2 mr-3 w-auto")} aria-label="Tipo do filme">
          {TIPOS_DE_FILME.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.rotulo}
            </option>
          ))}
        </select>
        <button type="button" className={juntar(botao.secundario, "mb-2")} onClick={() => void criar()} disabled={criando} data-novo-filme="">
          {criando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
          Novo filme
        </button>
      </div>
      {filmes.data && filmes.data.indisponivel && <p className={juntar(texto.auxiliar, "text-warning")}>{filmes.data.aviso}</p>}
      {!filmeId && !filmes.isLoading && <EstadoVazio icone={<Clapperboard className="h-5 w-5" />} titulo="Escolha ou crie um filme" descricao="Apresentação da empresa em motion ou filme cinematográfico da marca." />}
      {filmeId && aberto.isLoading && <Carregando forma="aba" rotulo="Abrindo o filme" />}
      {filmeId && aberto.isError && <p className={juntar(texto.auxiliar, "text-destructive")}>O filme não abriu. Recarregue a página.</p>}
      {aberto.data && aberto.data.filme && children(aberto.data.filme, aberto.data.links)}
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
