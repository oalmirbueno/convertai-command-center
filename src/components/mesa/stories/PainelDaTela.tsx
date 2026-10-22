import { useState } from "react";
import { AlertTriangle, Copy, Download, ImagePlus, Loader2, Pencil, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { BotaoComCusto } from "../Custo";
import { useMesa } from "../MesaContexto";
import { copiarTexto } from "../instagram/instagramApi";
import { noFuso } from "../instagram/calendario-da-grade";
import { IconeDoAdesivo, SeloDoCaminho } from "./PreviaDoStory";
import { baixarArteDoStory } from "./arteDoStory";
import { estadoDoCartao } from "./CartoesDaSequencia";
import type { MarcaDosStories } from "./marcaDosStories";
import {
  ajustarImagemDoStory,
  filaDoStory,
  gerarImagensDosStories,
  imagemDesatualizada,
  imagemDoStory,
  instrucaoDoTextoNovo,
  partesDaEstimativaDosStories,
  partesDeUmaImagem,
  refazerImagemDoStory,
  registrarImagemDoStory,
  roteiroDoAdesivo,
  ROTULO_DO_ADESIVO,
  ROTULO_DO_PAPEL,
  temImagemGerada,
  type CampanhaDoPedido,
  type LaminasDoTrabalho,
  type Story,
} from "./storiesApi";

/**
 * A tela escolhida, ao lado do celular (21/10/2026): o papel na estrutura, o
 * texto, a cena da imagem, o adesivo com o roteiro exato e o que dá para fazer
 * com a imagem do gerador: gerar, refazer (versão nova, mesmo texto), ajustar
 * com um pedido curto e, quando o texto mudou depois, trocar o texto na
 * imagem. Tudo com o custo antes (BotaoComCusto). Nada colado por cima.
 */
export default function PainelDaTela({
  clientId,
  story: s,
  titulo,
  campanha,
  marca,
  marcaId,
  laminas,
  onEditar,
  onMudou,
  onReler,
}: {
  clientId: string;
  story: Story;
  /** Título da sequência (vai ao pedido do gerador). */
  titulo: string;
  campanha: CampanhaDoPedido | null;
  marca: MarcaDosStories;
  marcaId: string | null;
  laminas?: Record<string, LaminasDoTrabalho>;
  onEditar: (s: Story) => void;
  onMudou: (s: Story[]) => void;
  onReler: () => void;
}) {
  const { catalogo } = useMesa();
  const [pedido, setPedido] = useState("");
  const [baixando, setBaixando] = useState(false);
  const papel = s.fundo.papel ? ROTULO_DO_PAPEL[s.fundo.papel] || s.fundo.papel : "Story";
  const fila = filaDoStory(s, laminas);
  const gerando = fila === "fila" || fila === "rodando";
  const imagem = imagemDoStory(s, laminas);
  const desatualizada = imagemDesatualizada(s);
  const travado = !!s.publicacao_id || s.situacao === "publicado" || s.situacao === "agendado" || s.situacao === "postar_pelo_app";
  const estado = estadoDoCartao(s, laminas);
  const app = s.caminho === "pelo_app";
  const roteiro = roteiroDoAdesivo(s);

  const baixar = async () => {
    setBaixando(true);
    try {
      await baixarArteDoStory(s, marca, imagem ? imagem.caminho : null);
    } catch (e) {
      toast.error("Não deu para baixar a arte", { description: textoDoErro(e) });
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="min-w-0" data-painel-da-tela={s.id}>
      <div className="flex min-w-0 items-center">
        <span className={juntar(texto.tituloSecao, "min-w-0 truncate")}>
          {s.ordem}. {papel}
        </span>
        <span className={juntar(etiqueta, "ml-2", estado.tom)}>{estado.rotulo}</span>
        <span className="flex-1" />
        <button type="button" className={botao.icone} onClick={() => onEditar(s)} aria-label={`Editar o story ${s.ordem}`} title="Editar texto, adesivo e horário">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={botao.icone} onClick={() => void baixar()} disabled={baixando} aria-label={`Baixar a arte do story ${s.ordem}`} title="Baixar a arte">
          {baixando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <p className={juntar(texto.auxiliar, "mt-0.5")}>
        {s.horario ? `${noFuso(s.horario).hora}` : "Sem horário"} · {s.adesivo.tipo === "nenhum" ? "sem adesivo" : ROTULO_DO_ADESIVO[s.adesivo.tipo]}
      </p>

      <dl className="mt-4 space-y-3">
        <div className="min-w-0">
          <dt className={texto.rotulo}>Texto na tela</dt>
          <dd className={juntar(texto.corpo, "mt-0.5 whitespace-pre-line")}>{s.texto_na_tela || "Sem texto"}</dd>
        </div>
        {s.fundo.cena ? (
          <div className="min-w-0">
            <dt className={texto.rotulo}>Cena da imagem</dt>
            <dd className={juntar(texto.corpo, "mt-0.5 text-muted-foreground")}>{s.fundo.cena}</dd>
          </div>
        ) : null}
        <div className="min-w-0">
          <dt className={juntar(texto.rotulo, "flex items-center")}>
            <IconeDoAdesivo tipo={s.adesivo.tipo} className="mr-1.5 h-3.5 w-3.5" />
            Adesivo
            <SeloDoCaminho adesivo={s.adesivo} className="ml-2" />
          </dt>
          {app && roteiro ? (
            <dd className="mt-1 flex min-w-0 items-start rounded-md bg-muted/50 px-3 py-2" data-roteiro-do-adesivo="">
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
            </dd>
          ) : (
            <dd className={juntar(texto.auxiliar, "mt-0.5")}>Sem adesivo: o painel publica sozinho no horário.</dd>
          )}
        </div>
      </dl>

      <div className="mt-5 border-t border-border pt-4" data-imagem-da-tela="">
        <p className={juntar(texto.rotulo, "flex items-center")}>
          <ImagePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Imagem do gerador
          {imagem ? <span className="ml-1.5 tabular-nums">v{imagem.versao}</span> : null}
        </p>

        {travado ? (
          <p className={juntar(texto.auxiliar, "mt-1")}>Na Agenda: para mudar a imagem, desfaça o agendamento.</p>
        ) : !temImagemGerada(s) ? (
          <div className="mt-2 min-w-0">
            <p className={texto.auxiliar}>Sai do gerador do Estúdio em 9:16, com o texto integrado.</p>
            <BotaoComCusto
              rotulo={
                <>
                  <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Gerar a imagem
                </>
              }
              titulo="Imagem do story"
              descricao="Gerar a imagem desta tela pelo gerador do Estúdio"
              partes={() => partesDaEstimativaDosStories(catalogo, 1, { comPlano: false, comImagens: true })}
              executar={async () => {
                const r = await gerarImagensDosStories({ clientId, titulo, stories: [s], campanha, marcaId });
                onMudou(r.stories);
                onReler();
                if (r.avisos.length) toast.message("Imagem pedida com avisos", { description: r.avisos.join(" ") });
                return { custo_usd: r.custo_usd };
              }}
              className="mt-2"
            />
          </div>
        ) : gerando ? (
          <p className={juntar(texto.auxiliar, "mt-1 flex items-center")} aria-live="polite">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {fila === "fila" ? "Na fila do gerador" : "Gerando a imagem"}
          </p>
        ) : (
          <div className="mt-2 min-w-0 space-y-3">
            {desatualizada ? (
              <div className="min-w-0">
                <p className={juntar(texto.auxiliar, "flex items-start text-warning")}>
                  <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />O texto mudou depois da imagem. A arte antiga não vai para a agenda.
                </p>
                <BotaoComCusto
                  rotulo="Trocar o texto na imagem"
                  titulo="Texto na imagem"
                  descricao="O gerador reescreve o texto dentro da imagem; o resto fica igual"
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
            <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1 [&>*]:mr-2">
              <BotaoComCusto
                rotulo={
                  <>
                    <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Refazer
                  </>
                }
                titulo="Refazer a imagem"
                descricao="Uma versão nova desta tela, com o mesmo texto"
                partes={() => partesDeUmaImagem(catalogo)}
                executar={async () => {
                  await refazerImagemDoStory(s, marcaId);
                  onReler();
                  return { custo_usd: 0 };
                }}
                variant="outline"
              />
            </div>
            <div className="min-w-0">
              <label className={texto.rotulo} htmlFor={`ajuste-${s.id}`}>
                Ajustar com um pedido curto
              </label>
              <div className="mt-1 flex min-w-0 items-center">
                <input
                  id={`ajuste-${s.id}`}
                  className={juntar(campo, "mr-2 min-w-0 flex-1")}
                  value={pedido}
                  onChange={(e) => setPedido(e.target.value)}
                  placeholder="Ex.: fundo mais claro, produto maior"
                  maxLength={300}
                />
                <BotaoComCusto
                  rotulo="Ajustar"
                  titulo="Ajustar a imagem"
                  descricao="O gerador edita esta imagem com o seu pedido"
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
      </div>
    </div>
  );
}
