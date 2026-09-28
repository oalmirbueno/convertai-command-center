import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, ExternalLink, Film, Link2, Loader2, ScrollText, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { textoDoErro } from "@/lib/mesa/api";
import { MiniaturaDaFoto } from "@/components/mesa-foto/Comuns";
import { useFotos, type FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { VIEW_DOS_ROTEIROS } from "../../../supabase/functions/_shared/roteiros-para-video";
import { AvisoDeAtivacao } from "./Comuns";
import type { IrPara } from "./MesaDeVideo";
import {
  chamarMesaVideos,
  chaveDosVinculos,
  fotoDaCenaNoAcervo,
  fotosParaVideo,
  useArquivosDeVideo,
  useHistorias,
  useRoteirosAprovados,
  useVinculos,
  type VinculoDeRoteiro,
} from "./videosApi";

/**
 * Base da Mesa Vídeos (frente E2, 26/09): o que vira vídeo. Cenas da História
 * do Canvas (a foto é o 1º quadro), roteiros aprovados da Mesa Roteiros
 * (ligados às cenas da História), pessoas (personagens e clones autorizados) e
 * produtos, pela regra grupoNaMesaDeVideos da Mesa Foto. "Gerar" leva a cena
 * para a etapa Gerar. Abrir só lê: nada é gerado nem gasto.
 */

type ParteDaBase = "cenas" | "roteiros" | "pessoas" | "produtos";
const PARTES: ParteDaBase[] = ["cenas", "roteiros", "pessoas", "produtos"];
const MAX_FOTOS_NA_GRADE = 60;
const GRADE = "grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 desk:grid-cols-7";

function GradeDeFotos({ fotos, vazio, onde }: { fotos: FotoDoAcervo[]; vazio: string; onde: string }) {
  if (!fotos.length) return <EstadoVazio compacto titulo="Nada aqui ainda." descricao={vazio} />;
  return (
    <>
      <div className={GRADE} data-grupo-do-acervo={onde}>
        {fotos.slice(0, MAX_FOTOS_NA_GRADE).map((f) => (
          <div key={f.id} className="min-w-0" title={f.nome}>
            <MiniaturaDaFoto foto={f} />
          </div>
        ))}
      </div>
      {fotos.length > MAX_FOTOS_NA_GRADE && <p className={juntar(texto.auxiliar, "mt-2")}>Mostrando {MAX_FOTOS_NA_GRADE} de {fotos.length}. O resto está na Mesa Foto.</p>}
    </>
  );
}

function Cenas({ irPara, fotosDeCena }: { irPara: IrPara; fotosDeCena: FotoDoAcervo[] }) {
  const { clientId } = useMesa();
  const historiasQ = useHistorias(clientId);
  const fotosQ = useFotos(clientId);
  // Fotos marcadas como cena na Mesa Foto (mesmo fora de uma História).
  const soltas = fotosDeCena.length ? (
    <Secao
      divisoria
      titulo="Fotos de cena"
      descricao={`${fotosDeCena.length}`}
      ajuda="Fotos marcadas como cena na Mesa Foto, dentro ou fora de uma História."
      recolher={`mesa-videos:fotos-de-cena:${clientId}`}
      resumo={`${fotosDeCena.length} ${fotosDeCena.length === 1 ? "foto" : "fotos"}`}
    >
      <GradeDeFotos fotos={fotosDeCena} onde="cena" vazio="" />
    </Secao>
  ) : null;
  const historias = (historiasQ.data && historiasQ.data.historias) || [];
  const linkDoCanvas = `/mesa-foto?client=${clientId}&etapa=canvas`;

  if (historiasQ.isLoading) return <Carregando forma="grade" linhas={6} rotulo="Lendo a História" />;
  if (historiasQ.data && !historiasQ.data.disponivel) {
    return <AvisoDeAtivacao>A História do Canvas ainda não está no banco (SQL V-01 da Mesa Foto). As cenas aparecem aqui quando ele for aplicado.</AvisoDeAtivacao>;
  }
  if (!historias.length) {
    return (
      <div className="space-y-6">
        <EstadoVazio
          icone={<Clapperboard className="h-5 w-5" />}
          titulo="Nenhuma história ainda"
          descricao="Marque os Resultados como cenas no Canvas da Mesa Foto."
          acao={
            <Link to={linkDoCanvas} className={botao.secundario}>
              Abrir o Canvas <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          }
        />
        {soltas}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {historias.map((h, i) => (
        <Secao
          key={h.canvas_id}
          divisoria={i > 0}
          titulo={h.nome}
          descricao={`${h.cenas.length} ${h.cenas.length === 1 ? "cena" : "cenas"}`}
          ajuda={h.sinopse || "O mesmo Canvas da Mesa Foto: a foto de cada cena é o primeiro quadro do vídeo."}
          recolher={`mesa-videos:historia:${h.canvas_id}:${clientId}`}
          resumo={`${h.cenas.length} ${h.cenas.length === 1 ? "cena" : "cenas"}`}
          acao={
            <Link to={linkDoCanvas} className={botao.discreto} aria-label="Abrir no Canvas">
              <ExternalLink className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Canvas</span>
            </Link>
          }
        >
          <ol className={GRADE} aria-label={`Cenas de ${h.nome}`}>
            {h.cenas.map((c) => {
              const foto = fotoDaCenaNoAcervo(c, fotosQ.data || []);
              return (
                <li key={`${c.canvas_id}:${c.no_id}`} className="min-w-0" data-cena-da-historia={c.no_id}>
                  <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "125%" }}>
                    {foto && <MiniaturaDoStorage bucket={foto.storage_bucket} caminho={foto.storage_path} alt={`Cena ${c.numero}`} className="absolute inset-0 h-full w-full" />}
                  </div>
                  <div className="mt-1.5 flex min-w-0 items-center">
                    <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium" title={c.acao || undefined}>
                      {c.numero}. {c.titulo || "Cena"}
                    </p>
                    <button
                      type="button"
                      className={juntar(botao.icone, "ml-1 h-7 w-7 text-primary disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-40")}
                      disabled={!foto}
                      aria-label={foto ? `Gerar vídeo da cena ${c.numero}` : `Cena ${c.numero} sem foto ainda`}
                      title={foto ? "Gerar vídeo desta cena" : "A cena ainda não tem foto"}
                      onClick={() => irPara("gerar", { origem: `cena:${c.canvas_id}:${c.no_id}` })}
                    >
                      <Film className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </Secao>
      ))}
      {soltas}
    </div>
  );
}

function Roteiros({ irPara }: { irPara: IrPara }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const roteirosQ = useRoteirosAprovados(clientId);
  const historiasQ = useHistorias(clientId);
  const vinculosQ = useVinculos(clientId);
  const arquivosQ = useArquivosDeVideo(clientId);
  const roteiros = (roteirosQ.data && roteirosQ.data.roteiros) || [];
  const [escolhido, setEscolhido] = useEstadoDaTela<string>(`mesa-videos:base:roteiro:${clientId}`, "");
  const [salvando, setSalvando] = useState<string | null>(null);
  const roteiro = roteiros.find((r) => r.id === escolhido) || roteiros[0] || null;
  const cenasDoCanvas = useMemo(
    () =>
      ((historiasQ.data && historiasQ.data.historias) || []).reduce(
        (lista, h) => lista.concat(h.cenas.map((c) => ({ chave: `${c.canvas_id}|${c.no_id}`, canvas_id: c.canvas_id, no_id: c.no_id, rotulo: `${h.nome} · ${c.numero}. ${c.titulo || "Cena"}` }))),
        [] as { chave: string; canvas_id: string; no_id: string; rotulo: string }[],
      ),
    [historiasQ.data],
  );
  const vinculos = (vinculosQ.data && vinculosQ.data.itens) || [];
  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];
  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chaveDosVinculos(clientId) });

  const ligar = async (cenaRef: string, chave: string) => {
    const alvo = cenasDoCanvas.find((c) => c.chave === chave);
    if (!alvo || !roteiro) return;
    setSalvando(cenaRef);
    try {
      await chamarMesaVideos({ acao: "vinculo_salvar", client_id: clientId, roteiro_id: roteiro.id, cena_ref: cenaRef, canvas_id: alvo.canvas_id, no_id: alvo.no_id });
      recarregar();
    } catch (e) {
      toast.error("Não foi possível ligar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setSalvando(null);
    }
  };

  const desligar = async (v: VinculoDeRoteiro) => {
    setSalvando(v.cena_ref);
    try {
      await chamarMesaVideos({ acao: "vinculo_remover", vinculo_id: v.id });
      recarregar();
      toast.success("Ligação removida", {
        action: {
          label: "Desfazer",
          onClick: () => {
            void chamarMesaVideos({ acao: "vinculo_salvar", client_id: clientId, roteiro_id: v.roteiro_id, cena_ref: v.cena_ref, canvas_id: v.canvas_id, no_id: v.no_id }).then(recarregar, (e) =>
              toast.error("Não foi possível refazer", { description: textoDoErro(e) }),
            );
          },
        },
      });
    } catch (e) {
      toast.error("Não foi possível remover", { description: textoDoErro(e) });
    } finally {
      setSalvando(null);
    }
  };

  if (roteirosQ.isLoading) return <Carregando linhas={4} rotulo="Lendo os roteiros" />;
  if (roteirosQ.data && !roteirosQ.data.disponivel) {
    return <AvisoDeAtivacao>A Mesa Roteiros ainda não publicou os roteiros aprovados (view {VIEW_DOS_ROTEIROS}). Dá para gerar pelas cenas da História.</AvisoDeAtivacao>;
  }
  if (!roteiro) {
    return (
      <EstadoVazio
        icone={<ScrollText className="h-5 w-5" />}
        titulo="Nenhum roteiro aprovado"
        descricao="Aprove um roteiro na Mesa Roteiros."
        acao={
          <Link to={`/mesa-roteiros?client=${clientId}`} className={botao.secundario}>
            Abrir a Mesa Roteiros
          </Link>
        }
      />
    );
  }

  return (
    <Secao
      titulo={roteiro.titulo}
      descricao={`${roteiro.cenas.length} ${roteiro.cenas.length === 1 ? "cena" : "cenas"}`}
      ajuda="Ligue cada cena do roteiro à cena da História que vai virar vídeo. Cena sem foto também gera: o texto da cena é a base."
      acao={
        roteiros.length > 1 ? (
          <SeletorCompacto
            rotulo="Roteiro aprovado"
            icone={<ScrollText className="h-3.5 w-3.5" />}
            modo="lista"
            opcoes={roteiros.map((r) => ({ valor: r.id, rotulo: r.titulo }))}
            valor={roteiro.id}
            onEscolher={setEscolhido}
          />
        ) : undefined
      }
    >
      {vinculosQ.data && !vinculosQ.data.disponivel && <AvisoDeAtivacao>As ligações de roteiro e cena ainda não foram ativadas no banco (SQL V2-01).</AvisoDeAtivacao>}
      {roteiro.cenas.length ? (
        <ol className="divide-y divide-border" aria-label={`Cenas de ${roteiro.titulo}`}>
          {roteiro.cenas.map((c) => {
            const ligados = vinculos.filter((v) => v.roteiro_id === roteiro.id && v.cena_ref === c.ref);
            const takes = arquivos.filter((a) => a.roteiro_id === roteiro.id && a.cena_ref === c.ref && a.estado !== "arquivado");
            const livres = cenasDoCanvas.filter((x) => !ligados.some((v) => v.canvas_id === x.canvas_id && v.no_id === x.no_id));
            return (
              <li key={c.ref} className="grid min-w-0 gap-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center" data-cena-do-roteiro={c.ref}>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">
                    {c.ordem}. {c.titulo || "Cena"}
                  </p>
                  <p className={juntar(texto.auxiliar, "truncate")} title={c.fala || undefined}>
                    {takes.length ? `${takes.length} ${takes.length === 1 ? "take" : "takes"}` : c.fala || "Sem fala"}
                  </p>
                </div>
                <div className="min-w-0">
                  {ligados.map((v) => {
                    const x = cenasDoCanvas.find((k) => k.canvas_id === v.canvas_id && k.no_id === v.no_id);
                    return (
                      <p key={v.id} className="mb-1 flex min-w-0 items-center rounded-md bg-muted/50 px-2 py-1 text-[12px]">
                        <Link2 className="mr-1.5 h-3 w-3 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{x ? x.rotulo : "Cena que saiu da História"}</span>
                        <button type="button" className={juntar(botao.icone, "ml-1 h-6 w-6")} aria-label="Remover ligação" onClick={() => void desligar(v)}>
                          <X className="h-3 w-3" />
                        </button>
                      </p>
                    );
                  })}
                  {livres.length > 0 && (
                    <div className="flex min-w-0 items-center">
                      <select className={campo} value="" onChange={(e) => e.target.value && void ligar(c.ref, e.target.value)} aria-label={`Ligar a cena ${c.ordem} a uma cena da História`} disabled={salvando === c.ref}>
                        <option value="">Ligar a uma cena da História</option>
                        {livres.map((x) => (
                          <option key={x.chave} value={x.chave}>
                            {x.rotulo}
                          </option>
                        ))}
                      </select>
                      {salvando === c.ref && <Loader2 className="ml-1.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
                    </div>
                  )}
                </div>
                <button type="button" className={juntar(botao.secundario, "h-8 justify-self-start px-2.5 text-[12.5px]")} onClick={() => irPara("gerar", { origem: `roteiro:${roteiro.id}:${c.ref}` })}>
                  <Film className="mr-1.5 h-3.5 w-3.5" />
                  Gerar
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <EstadoVazio compacto titulo="Este roteiro não tem cenas." />
      )}
    </Secao>
  );
}

export default function EtapaBase({ irPara }: { irPara: IrPara }) {
  const { clientId } = useMesa();
  const fotosQ = useFotos(clientId);
  const [parte, setParte] = useEstadoDaTela<ParteDaBase>(`mesa-videos:base:parte:${clientId}`, "cenas", { validar: (v) => PARTES.indexOf(v as ParteDaBase) >= 0 });
  const grupos = useMemo(() => fotosParaVideo((fotosQ.data || []) as FotoDoAcervo[]), [fotosQ.data]);
  const pessoas = (grupos.personagem || []).length + (grupos.clone || []).length;

  return (
    <div className="min-w-0 space-y-6 pb-6">
      <SeletorCompacto
        rotulo="Parte da base"
        larguraTotal
        className="sm:w-auto"
        valor={parte}
        onEscolher={(v) => setParte(v as ParteDaBase)}
        opcoes={[
          { valor: "cenas", rotulo: "Cenas" },
          { valor: "roteiros", rotulo: "Roteiros" },
          { valor: "pessoas", rotulo: "Pessoas", contador: fotosQ.data && pessoas ? pessoas : null },
          { valor: "produtos", rotulo: "Produtos", contador: fotosQ.data && (grupos.produto || []).length ? (grupos.produto || []).length : null },
        ]}
      />
      {parte === "cenas" && <Cenas irPara={irPara} fotosDeCena={grupos.cena || []} />}
      {parte === "roteiros" && <Roteiros irPara={irPara} />}
      {parte === "pessoas" &&
        (fotosQ.isLoading ? (
          <Carregando forma="grade" linhas={6} rotulo="Lendo as fotos" />
        ) : (
          <div className="space-y-6">
            <Secao
              titulo="Personagens"
              descricao={`${(grupos.personagem || []).length}`}
              ajuda="Personagens criadas na Mesa Foto (Modelos ou Canvas)."
              recolher={`mesa-videos:personagens:${clientId}`}
              resumo={`${(grupos.personagem || []).length}`}
            >
              <GradeDeFotos fotos={grupos.personagem || []} onde="personagem" vazio="Crie na aba Modelos ou no Canvas da Mesa Foto." />
            </Secao>
            <Secao
              divisoria
              titulo="Clones"
              descricao={`${(grupos.clone || []).length}`}
              ajuda="Clone de pessoa real só com autorização registrada (Mesa Foto, Clones)."
              recolher={`mesa-videos:clones:${clientId}`}
              resumo={`${(grupos.clone || []).length}`}
            >
              <GradeDeFotos fotos={grupos.clone || []} onde="clone" vazio="Nenhum clone autorizado." />
            </Secao>
          </div>
        ))}
      {parte === "produtos" &&
        (fotosQ.isLoading ? (
          <Carregando forma="grade" linhas={6} rotulo="Lendo as fotos" />
        ) : (
          <Secao titulo="Produtos" descricao={`${(grupos.produto || []).length}`} ajuda="Fotos de produto da Mesa Foto. Artes, logos e carrosséis ficam fora.">
            <GradeDeFotos fotos={grupos.produto || []} onde="produto" vazio="Suba e identifique na Mesa Foto." />
          </Secao>
        ))}
    </div>
  );
}
