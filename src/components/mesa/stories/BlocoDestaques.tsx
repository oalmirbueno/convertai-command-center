import { Star } from "lucide-react";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, espaco, etiqueta, juntar, lista as listaDoSistema, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { ImagemDaMesa } from "../MesaContexto";
import GeradorDeDestaques from "../instagram/GeradorDeDestaques";
import SugestaoDeDestaques, { useSugestaoDeDestaques } from "../instagram/SugestaoDeDestaques";
import { marcaDaAba, useAtualizarPainel, usePainelDoInstagram } from "../instagram/instagramApi";
import { noFuso } from "../instagram/calendario-da-grade";
import { destaquesLimpos, type DestaqueProposto } from "../../../../supabase/functions/mesa-instagram/modulos/conhecimento-perfil-instagram";
import PreviaDoStory from "./PreviaDoStory";
import type { MarcaDosStories } from "./marcaDosStories";
import { diaCurto, SITUACOES, type DestaqueDoPerfil, type Story } from "./storiesApi";

/**
 * Bloco Destaques: por destaque do perfil, os stories marcados para ele (a
 * equipe salva no destaque depois de publicado) e, ao lado, as capas: a
 * sugestão e o gerador da aba Redes, os mesmos componentes e a mesma lista
 * guardada (mexer aqui muda lá).
 */

const LARGURA_DA_MINIATURA = 72;

function StoriesDoDestaque({ stories, marca, onAbrir }: { stories: Story[]; marca: MarcaDosStories; onAbrir: (s: Story) => void }) {
  if (!stories.length) return <p className={juntar(texto.auxiliar, "mt-1")}>Nenhum story marcado</p>;
  return (
    <ol className="mt-2 flex min-w-0 overflow-x-auto overscroll-x-contain pb-1" aria-label="Stories marcados">
      {stories.map((s) => (
        <li key={s.id} className="mr-2 shrink-0" style={{ width: LARGURA_DA_MINIATURA }}>
          <button type="button" className="block w-full rounded-md" onClick={() => onAbrir(s)} aria-label={`Abrir o story ${s.ordem}`}>
            <PreviaDoStory story={s} largura={LARGURA_DA_MINIATURA} paleta={marca.paleta} familia={marca.familia} foto={marca.foto(s.fundo.imagem_id)} semSelo />
          </button>
          <p className={juntar(texto.etiqueta, "mt-1 truncate text-muted-foreground")}>{s.horario ? `${diaCurto(noFuso(s.horario).dia)}` : "sem dia"}</p>
          <span className={juntar(etiqueta, "max-w-full truncate", SITUACOES[s.situacao].tom)}>{s.situacao === "publicado" ? "Salvar" : SITUACOES[s.situacao].rotulo}</span>
        </li>
      ))}
    </ol>
  );
}

export default function BlocoDestaques({
  clientId,
  clientName,
  destaques,
  stories,
  marca,
  onAbrir,
  onPedirAoAgente,
}: {
  clientId: string;
  clientName: string;
  destaques: DestaqueDoPerfil[];
  stories: Story[];
  marca: MarcaDosStories;
  onAbrir: (s: Story) => void;
  onPedirAoAgente: (texto: string) => void;
}) {
  // A mesma conta e a mesma lista que a aba Redes guarda (por cliente e marca).
  const escopo = `${clientId}:${marcaDaAba(clientId)}`;
  const [contaGuardada] = useEstadoDaTela<string | null>(`mesa:instagram:conta:${escopo}`, null);
  const ig = usePainelDoInstagram(clientId, contaGuardada);
  const atualizarIg = useAtualizarPainel(clientId, contaGuardada);
  const dados = ig.data || null;
  const contaId = dados ? dados.conta_id : contaGuardada;
  const [listaDeDestaques, setListaDeDestaques] = useEstadoDaTela<DestaqueProposto[]>(`mesa:instagram:destaques:${escopo}:${contaGuardada || "principal"}`, [], { validar: (v) => Array.isArray(v) });
  const sugestao = useSugestaoDeDestaques({
    clientId,
    escopo: `${escopo}:${contaId || "principal"}`,
    contaId,
    lista: listaDeDestaques,
    capas: dados ? dados.capas : [],
    pronto: !!dados,
    onUsar: (l) => setListaDeDestaques(destaquesLimpos(l)),
  });

  const ids = destaques.map((d) => d.id);
  const marcados = stories.filter((s) => !!s.destaque_id);
  const semDestaqueConhecido = marcados.filter((s) => ids.indexOf(String(s.destaque_id)) < 0);
  const porData = (a: Story, b: Story) => String(a.horario || "").localeCompare(String(b.horario || ""));

  return (
    <div className={juntar(espaco.colunas, "lg:grid-cols-2")} data-bloco-dos-stories="destaques">
      <Secao
        className="min-w-0"
        titulo="Stories por destaque"
        recolher={`mesa:stories:por-destaque:${clientId}`}
        descricao={`${marcados.length} marcados`}
        ajuda="Cada story pode ir para um destaque depois de publicado (escolha no editor). A API do Instagram não salva em destaque: quando aparecer Salvar, a equipe guarda pelo app."
      >
        {!destaques.length && !semDestaqueConhecido.length ? (
          <EstadoVazio compacto titulo="Nenhum destaque no perfil" descricao="Crie as capas ao lado" />
        ) : (
          <ul className={juntar(listaDoSistema.aberta, listaDoSistema.divisoria)}>
            {destaques.map((d) => (
              <li key={d.id} className="min-w-0 px-2 py-3" data-destaque={d.nome}>
                <div className="flex min-w-0 items-center">
                  <span className="mr-2.5 block h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border">
                    {d.caminho ? <ImagemDaMesa caminho={d.caminho} alt={`Capa ${d.nome}`} className="h-full w-full" /> : <Star className="m-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                  </span>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{d.nome}</span>
                </div>
                <StoriesDoDestaque stories={marcados.filter((s) => s.destaque_id === d.id).sort(porData)} marca={marca} onAbrir={onAbrir} />
              </li>
            ))}
            {semDestaqueConhecido.length ? (
              <li className="min-w-0 px-2 py-3">
                <span className={juntar(texto.corpo, "font-medium")}>Destaque fora da lista</span>
                <StoriesDoDestaque stories={semDestaqueConhecido.sort(porData)} marca={marca} onAbrir={onAbrir} />
              </li>
            ) : null}
          </ul>
        )}
      </Secao>

      <Secao className="min-w-0" titulo="Capas" recolher={`mesa:stories:capas:${clientId}`} descricao={dados ? `${dados.capas.length} prontas` : undefined}>
        <div className="min-w-0 space-y-3">
          {ig.isLoading ? <Carregando rotulo="Lendo os destaques" /> : null}
          {ig.isError && !dados ? (
            <EstadoDeErro
              titulo="Não foi possível ler os destaques."
              descricao={textoDoErro(ig.error)}
              acao={
                <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void ig.refetch()}>
                  Tentar de novo
                </button>
              }
            />
          ) : null}
          {dados ? (
            <>
              <SugestaoDeDestaques sugestao={sugestao} lista={listaDeDestaques} onUsar={(l) => setListaDeDestaques(destaquesLimpos(l))} />
              <GeradorDeDestaques
                contaId={contaId}
                paleta={dados.kit.paleta}
                logo={dados.kit.logo}
                capas={dados.capas}
                lista={listaDeDestaques}
                onLista={setListaDeDestaques}
                onNovaCapa={(c) => atualizarIg.mudar((p) => ({ ...p, capas: p.capas.filter((x) => x.id !== c.id).concat([c]) }))}
                onArquivada={(id) => atualizarIg.mudar((p) => ({ ...p, capas: p.capas.filter((x) => x.id !== id) }))}
                onPedirAoAgente={() => onPedirAoAgente("Proponha os destaques do perfil (nome curto e ícone de cada um) e quais stories da semana vão para cada um.")}
                nomeDoCliente={clientName}
                escopo={`${escopo}:${contaId || "principal"}`}
              />
            </>
          ) : null}
        </div>
      </Secao>
    </div>
  );
}
