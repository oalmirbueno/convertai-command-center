import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Camera, Copy, Download, Loader2, Palette, Pencil, RefreshCw, Star, Wand2 } from "lucide-react";
import { toast } from "sonner";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { BotaoComCusto } from "../Custo";
import { useMesa } from "../MesaContexto";
import { copiarTexto } from "../instagram/instagramApi";
import { noFuso } from "../instagram/calendario-da-grade";
import { localParaIso } from "../../../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import { textoNativoPadrao } from "../../../../supabase/functions/mesa-stories/modulos/foto-natural-do-story";
import { IconeDoAdesivo, SeloDoCaminho } from "./PreviaDoStory";
import { baixarStory } from "./baixarStories";
import { estadoDoCartao } from "./CartoesDaSequencia";
import { ESTILOS_DO_TEXTO, ORDEM_DOS_ESTILOS, ROTULO_DA_POSICAO, type PosicaoDoTexto } from "./textoNativo";
import type { MarcaDosStories } from "./marcaDosStories";
import {
  ajustarImagemDoStory,
  capaDeDestaqueDoStory,
  chamarStories,
  filaDoStory,
  gerarFotoNatural,
  gerarImagensDosStories,
  imagemDesatualizada,
  imagemDoStory,
  instrucaoDoTextoNovo,
  normalizarStory,
  partesDaEstimativaDosStories,
  partesDeUmaImagem,
  refazerImagemDoStory,
  registrarImagemDoStory,
  roteiroDoAdesivo,
  ROTULO_DO_ADESIVO,
  ROTULO_DO_PAPEL,
  temImagemGerada,
  type CampanhaDoPedido,
  type DestaqueDoPerfil,
  type Fundo,
  type LaminasDoTrabalho,
  type Story,
} from "./storiesApi";

/**
 * A tela escolhida, ao lado do celular (21/10; organizada em 22/10/2026,
 * dono: "organize isso, melhore e deixe mais completos os stories"), em
 * seções: Texto (o texto nativo do Instagram, estilo, caixa e posição),
 * Imagem (Natural, a foto do momento; ou Destaque, a arte do designer),
 * Adesivo (o roteiro exato), Horário e Destaque (usar a tela como capa).
 * O custo aparece só no botão da ação. Nada colado por cima.
 */

function Bloco({ titulo, icone, children, acao }: { titulo: string; icone?: ReactNode; children: ReactNode; acao?: ReactNode }) {
  return (
    <section className="min-w-0 border-t border-border pt-3" data-secao-da-tela={titulo}>
      <div className="flex min-w-0 items-center">
        <h3 className={juntar(texto.rotulo, "flex min-w-0 flex-1 items-center truncate")}>
          {icone}
          {titulo}
        </h3>
        {acao}
      </div>
      <div className="mt-2 min-w-0">{children}</div>
    </section>
  );
}

export default function PainelDaTela({
  clientId,
  story: s,
  titulo,
  campanha,
  marca,
  marcaId,
  laminas,
  dia,
  emAndamento,
  onAndamento,
  onEditar,
  onMudou,
  onReler,
  onNovoDestaque,
}: {
  clientId: string;
  story: Story;
  /** Título da sequência (vai ao pedido do gerador). */
  titulo: string;
  campanha: CampanhaDoPedido | null;
  marca: MarcaDosStories;
  marcaId: string | null;
  laminas?: Record<string, LaminasDoTrabalho>;
  /** Dia da sequência (AAAA-MM-DD), para o horário. */
  dia: string | null;
  /** A foto natural desta tela está sendo gerada. */
  emAndamento?: boolean;
  onAndamento?: (id: string, andando: boolean) => void;
  onEditar: (s: Story) => void;
  onMudou: (s: Story[]) => void;
  onReler: () => void;
  onNovoDestaque?: (d: DestaqueDoPerfil) => void;
}) {
  const { catalogo } = useMesa();
  const [pedido, setPedido] = useState("");
  const [baixando, setBaixando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [hora, setHora] = useState(s.horario ? noFuso(s.horario).hora : "");
  const [nomeDoDestaque, setNomeDoDestaque] = useState("");
  useEffect(() => {
    setHora(s.horario ? noFuso(s.horario).hora : "");
    setPedido("");
    setNomeDoDestaque(((s.fundo.papel ? ROTULO_DO_PAPEL[s.fundo.papel] : "") || s.titulo || "Destaque").slice(0, 15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  const papel = s.fundo.papel ? ROTULO_DO_PAPEL[s.fundo.papel] || s.fundo.papel : "Story";
  const natural = s.fundo.tipo === "natural";
  const fila = filaDoStory(s, laminas);
  const gerando = !!emAndamento || fila === "fila" || fila === "rodando";
  const imagem = imagemDoStory(s, laminas);
  const desatualizada = imagemDesatualizada(s);
  const travado = !!s.publicacao_id || s.situacao === "publicado" || s.situacao === "agendado" || s.situacao === "postar_pelo_app";
  const estado = estadoDoCartao(s, laminas, emAndamento);
  const app = s.caminho === "pelo_app";
  const roteiro = roteiroDoAdesivo(s);
  const temImagem = natural ? !!s.fundo.caminho : !!imagem || !!s.file_id;

  /** Grava uma mudança do story pela função (o servidor guarda a foto e a lâmina). */
  const salvar = async (mudanca: Record<string, unknown>) => {
    setSalvando(true);
    try {
      const r = await chamarStories<{ story: unknown }>("salvar_story", clientId, { story: { id: s.id, ...mudanca } });
      onMudou([normalizarStory(r && r.story)]);
    } catch (e) {
      toast.error("Não deu para salvar", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  const mudarFundo = (m: Partial<Fundo>) => void salvar({ fundo: { ...s.fundo, ...m } });

  const trocarEstilo = (v: string) => {
    if (v === (natural ? "natural" : "destaque")) return;
    const base = { papel: s.fundo.papel, cena: s.fundo.cena, referencia_id: s.fundo.referencia_id || (s.fundo.tipo === "foto" ? s.fundo.imagem_id : undefined) };
    void salvar({ fundo: v === "natural" ? { tipo: "natural", ...base, ...textoNativoPadrao(s.fundo.papel, s.adesivo.tipo !== "nenhum") } : { tipo: "gerada", ...base } });
  };

  const baixar = async () => {
    setBaixando(true);
    try {
      await baixarStory(s, marca, laminas);
    } catch (e) {
      toast.error("Não deu para baixar", { description: textoDoErro(e) });
    } finally {
      setBaixando(false);
    }
  };

  const fotoNatural = async (p?: string) => {
    if (onAndamento) onAndamento(s.id, true);
    try {
      const r = await gerarFotoNatural(clientId, s, p);
      onMudou([r.story]);
      return { custo_usd: r.custo_usd };
    } finally {
      if (onAndamento) onAndamento(s.id, false);
    }
  };

  const estiloNativo = (s.fundo.estilo_texto as keyof typeof ESTILOS_DO_TEXTO) || "classico";
  const posicao = (s.fundo.posicao as PosicaoDoTexto) || "topo";

  return (
    <div className="min-w-0 space-y-4" data-painel-da-tela={s.id}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center">
          <span className={juntar(texto.tituloSecao, "min-w-0 truncate")}>
            {s.ordem}. {papel}
          </span>
          <span className={juntar(etiqueta, "ml-2", estado.tom)}>{estado.rotulo}</span>
          <span className="flex-1" />
          <button type="button" className={botao.icone} onClick={() => onEditar(s)} aria-label={`Editar o story ${s.ordem}`} title="Editar texto, adesivo e horário">
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={botao.icone} onClick={() => void baixar()} disabled={baixando || !temImagem} aria-label={`Baixar a arte do story ${s.ordem}`} title={temImagem ? "Baixar o PNG pronto para postar (1080 x 1920, com texto e adesivo)" : "Gere a imagem antes de baixar"}>
            {baixando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <Bloco titulo="Texto">
        <p className={juntar(texto.corpo, "whitespace-pre-line")}>{s.texto_na_tela || "Sem texto"}</p>
        {natural ? (
          <div className="mt-2 min-w-0 space-y-2" data-texto-nativo-controles="">
            <div className="flex min-w-0 flex-wrap" role="radiogroup" aria-label="Estilo do texto (como no Instagram)">
              {ORDEM_DOS_ESTILOS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={estiloNativo === e}
                  disabled={salvando || travado}
                  onClick={() => mudarFundo({ estilo_texto: e })}
                  className={juntar("mb-1 mr-1.5 inline-flex h-8 items-center rounded-md border px-2.5 text-[13px] transition-colors", estiloNativo === e ? "border-primary bg-primary/[0.08] text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                  style={{ fontFamily: ESTILOS_DO_TEXTO[e].familia, fontWeight: Math.min(800, ESTILOS_DO_TEXTO[e].peso), fontStyle: ESTILOS_DO_TEXTO[e].italico ? "italic" : "normal" }}
                >
                  {ESTILOS_DO_TEXTO[e].rotulo}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-2">
              <button
                type="button"
                className={juntar(botao.secundario, "h-8", s.fundo.caixa ? "border-primary" : "")}
                aria-pressed={s.fundo.caixa === true}
                disabled={salvando || travado}
                onClick={() => mudarFundo({ caixa: !s.fundo.caixa })}
              >
                Caixa de fundo
              </button>
              <SeletorCompacto
                rotulo="Posição do texto"
                valor={posicao}
                onEscolher={(v) => mudarFundo({ posicao: v })}
                opcoes={(["topo", "meio", "baixo"] as PosicaoDoTexto[]).map((p) => ({ valor: p, rotulo: ROTULO_DA_POSICAO[p] }))}
              />
            </div>
            {s.adesivo.tipo !== "nenhum" && posicao !== "topo" ? <p className={texto.auxiliar}>Com adesivo, o texto fica em cima para não cobrir o adesivo.</p> : null}
          </div>
        ) : null}
      </Bloco>

      <Bloco
        titulo="Imagem"
        icone={natural ? <Camera className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Palette className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
        acao={
          travado ? null : (
            <SeletorCompacto
              rotulo="Estilo da imagem"
              valor={natural ? "natural" : "destaque"}
              onEscolher={trocarEstilo}
              opcoes={[
                { valor: "natural", rotulo: "Natural" },
                { valor: "destaque", rotulo: "Destaque" },
              ]}
            />
          )
        }
      >
        <p className={texto.auxiliar}>
          {natural ? "Foto do momento, como tirada no celular; o texto é o do próprio Instagram." : "Arte de designer com a referência da campanha, para capa e oferta."}
        </p>
        {s.fundo.cena ? <p className={juntar(texto.corpo, "mt-1 text-muted-foreground")}>Cena: {s.fundo.cena}</p> : null}

        {travado ? (
          <p className={juntar(texto.auxiliar, "mt-2")}>Na Agenda: para mudar a imagem, desfaça o agendamento.</p>
        ) : gerando ? (
          <p className={juntar(texto.auxiliar, "mt-2 flex items-center")} aria-live="polite">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {fila === "fila" ? "Na fila do gerador" : natural ? "Gerando a foto" : "Gerando a imagem"}
          </p>
        ) : natural ? (
          <div className="mt-2 min-w-0 space-y-3">
            <BotaoComCusto
              rotulo={
                <>
                  {s.fundo.caminho ? <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  {s.fundo.caminho ? "Outra foto" : "Gerar a foto natural"}
                </>
              }
              titulo="Foto natural do story"
              descricao="Foto do momento pelo gerador da casa, sem texto dentro; fotos reais do cliente como referência"
              partes={() => partesDaEstimativaDosStories(catalogo, 1, { comPlano: false, comImagens: true, natural: true })}
              executar={() => fotoNatural()}
              variant={s.fundo.caminho ? "outline" : "default"}
            />
            {s.fundo.caminho ? (
              <div className="min-w-0">
                <label className={texto.rotulo} htmlFor={`ajuste-${s.id}`}>
                  Ajustar com um pedido curto
                </label>
                <div className="mt-1 flex min-w-0 items-center">
                  <input id={`ajuste-${s.id}`} className={juntar(campo, "mr-2 min-w-0 flex-1")} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: mais luz de janela, mesa com café" maxLength={300} />
                  <BotaoComCusto
                    rotulo="Ajustar"
                    titulo="Ajustar a foto"
                    descricao="Uma foto nova com o seu pedido"
                    partes={() => partesDaEstimativaDosStories(catalogo, 1, { comPlano: false, comImagens: true, natural: true })}
                    disabled={!pedido.trim()}
                    executar={async () => {
                      const r = await fotoNatural(pedido);
                      setPedido("");
                      return r;
                    }}
                    variant="outline"
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : !temImagemGerada(s) ? (
          <BotaoComCusto
            rotulo={
              <>
                <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Gerar a arte
              </>
            }
            titulo="Arte do story"
            descricao="Arte de designer pelo gerador do Estúdio, 9:16, com o texto integrado"
            partes={() => partesDaEstimativaDosStories(catalogo, 1, { comPlano: false, comImagens: true })}
            executar={async () => {
              const r = await gerarImagensDosStories({ clientId, titulo, stories: [s], campanha, marcaId });
              onMudou(r.stories);
              onReler();
              if (r.avisos.length) toast.message("Arte pedida com avisos", { description: r.avisos.join(" ") });
              return { custo_usd: r.custo_usd };
            }}
            className="mt-2"
          />
        ) : (
          <div className="mt-2 min-w-0 space-y-3">
            {desatualizada ? (
              <div className="min-w-0">
                <p className={juntar(texto.auxiliar, "flex items-start text-warning")}>
                  <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />O texto mudou depois da arte. A antiga não vai para a agenda.
                </p>
                <BotaoComCusto
                  rotulo="Trocar o texto na arte"
                  titulo="Texto na arte"
                  descricao="O gerador reescreve o texto dentro da arte; o resto fica igual"
                  partes={() => partesDeUmaImagem(catalogo)}
                  executar={async () => {
                    const r = await ajustarImagemDoStory(s, instrucaoDoTextoNovo(s.texto_na_tela));
                    onMudou([await registrarImagemDoStory(clientId, s, s.texto_na_tela)]);
                    onReler();
                    return r;
                  }}
                  variant="outline"
                  className="mt-2"
                />
              </div>
            ) : null}
            <BotaoComCusto
              rotulo={
                <>
                  <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Refazer
                </>
              }
              titulo="Refazer a arte"
              descricao="Uma versão nova desta tela, com o mesmo texto"
              partes={() => partesDeUmaImagem(catalogo)}
              executar={async () => {
                await refazerImagemDoStory(s, marcaId);
                onReler();
                return { custo_usd: 0 };
              }}
              variant="outline"
            />
            <div className="min-w-0">
              <label className={texto.rotulo} htmlFor={`ajuste-${s.id}`}>
                Ajustar com um pedido curto
              </label>
              <div className="mt-1 flex min-w-0 items-center">
                <input id={`ajuste-${s.id}`} className={juntar(campo, "mr-2 min-w-0 flex-1")} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: fundo mais claro, produto maior" maxLength={300} />
                <BotaoComCusto
                  rotulo="Ajustar"
                  titulo="Ajustar a arte"
                  descricao="O gerador edita esta arte com o seu pedido"
                  partes={() => partesDeUmaImagem(catalogo)}
                  disabled={!pedido.trim()}
                  executar={async () => {
                    const r = await ajustarImagemDoStory(s, pedido);
                    setPedido("");
                    onReler();
                    return r;
                  }}
                  variant="outline"
                />
              </div>
            </div>
          </div>
        )}
      </Bloco>

      <Bloco titulo="Adesivo" icone={<IconeDoAdesivo tipo={s.adesivo.tipo} className="mr-1.5 h-3.5 w-3.5" />} acao={<SeloDoCaminho adesivo={s.adesivo} />}>
        {app && roteiro ? (
          <div className="flex min-w-0 items-start rounded-md bg-muted/50 px-3 py-2" data-roteiro-do-adesivo="">
            <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1 [overflow-wrap:anywhere]")}>{roteiro}</span>
            <button
              type="button"
              className={botao.icone}
              aria-label={`Copiar o roteiro do adesivo do story ${s.ordem}`}
              title="Copiar o roteiro do adesivo"
              onClick={() => void copiarTexto(roteiro).then((ok) => (ok ? toast.success("Roteiro do adesivo copiado") : toast.error("Não deu para copiar")))}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className={texto.auxiliar}>{s.adesivo.tipo === "nenhum" ? "Sem adesivo: o painel publica sozinho no horário." : ROTULO_DO_ADESIVO[s.adesivo.tipo]}</p>
        )}
      </Bloco>

      <Bloco titulo="Horário">
        <div className="flex min-w-0 items-center">
          <input
            className={juntar(campo, "mr-2 w-[120px]")}
            type="time"
            value={hora}
            aria-label={`Horário do story ${s.ordem}`}
            disabled={travado || !dia}
            onChange={(e) => setHora(e.target.value)}
            onBlur={() => {
              const atual = s.horario ? noFuso(s.horario).hora : "";
              if (dia && hora !== atual) void salvar({ horario: hora ? localParaIso(dia, hora) : null });
            }}
          />
          <span className={texto.auxiliar}>{dia ? `no dia ${dia.split("-").reverse().join("/")}` : "sem dia"}</span>
          {salvando ? <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
        </div>
      </Bloco>

      <Bloco titulo="Destaque" icone={<Star className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}>
        <p className={texto.auxiliar}>O gerador desenha a capa no estilo Destaque, com esta tela como referência.</p>
        <div className="mt-2 flex min-w-0 items-center">
          <input className={juntar(campo, "mr-2 min-w-0 flex-1")} value={nomeDoDestaque} maxLength={15} onChange={(e) => setNomeDoDestaque(e.target.value)} aria-label="Nome do destaque" placeholder="Nome do destaque" />
          <BotaoComCusto
            rotulo="Usar como capa"
            titulo="Capa de destaque"
            descricao="Capa no estilo Destaque com esta tela como referência; entra nos destaques do perfil"
            partes={() => partesDaEstimativaDosStories(catalogo, 1, { comPlano: false, comImagens: true, natural: true })}
            disabled={!temImagem || !nomeDoDestaque.trim()}
            executar={async () => {
              const r = await capaDeDestaqueDoStory(clientId, s, { nome: nomeDoDestaque.trim(), paleta: marca.paleta });
              onMudou([r.story]);
              if (onNovoDestaque) onNovoDestaque(r.destaque);
              toast.success(`Capa "${r.destaque.nome}" pronta`, { description: "Está nos destaques do perfil e este story ficou marcado nela." });
              return { custo_usd: r.custo_usd };
            }}
            variant="outline"
          />
        </div>
      </Bloco>
    </div>
  );
}
