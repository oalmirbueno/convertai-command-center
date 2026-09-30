import { ArrowRight, Check, ImageIcon, Loader2 } from "lucide-react";
import Secao from "@/components/sistema/Secao";
import { PreencherComIA } from "@/components/sistema";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import Painel from "@/components/sistema/Painel";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { pecaPorId } from "../../../supabase/functions/_shared/cena-hf";
import { renderDaCena } from "../../../supabase/functions/_shared/motion-metodo";
import { ComFilme } from "./FilmeAberto";
import CenaNaFila from "./CenaNaFila";
import EditorDaCena from "./EditorDaCena";
import { type Filme, useFilaDoFilme } from "./motionApi";
import { useAcoesDaCena } from "./useAcoesDaCena";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 5: um still por cena para aprovar antes de animar. O still é o quadro
 * herói da própria cena em código (sem gerador de imagem, sem custo), tirado
 * pelo worker da agência. Plano de vídeo (filme da marca): aprova o prompt.
 */

function Conteudo({ filme, links, irPara }: { filme: Filme; links: Record<string, string>; irPara: IrPara }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const fila = useFilaDoFilme(filme.id);
  const a = useAcoesDaCena(filme);
  const formato = filme.formatos[0] || "9:16";
  const prints = Array.isArray(filme.insumos.prints) ? (filme.insumos.prints as Array<{ path: string; nome: string }>) : [];
  const hf = filme.cenas.filter((c) => c.tipo_plano === "hf");
  const aprovadas = filme.cenas.filter((c) => c.still_aprovado).length;

  const pedirTodos = async () => {
    for (const c of hf) if (!renderDaCena(filme, c, "still", formato)) await a.pedir(c.id, "still");
  };

  if (!filme.cenas.length) return <EstadoVazio icone={<ImageIcon className="h-5 w-5" />} titulo="Escolha um storyboard antes" acao={<button type="button" className={botao.secundario} onClick={() => irPara("storyboards")}>Abrir os storyboards</button>} />;
  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Stills"
        descricao={`${aprovadas} de ${filme.cenas.length} aprovados · ${formato}`}
        ajuda="O still é o quadro principal da cena, feito pelo mesmo código que anima (a logo e as fotos entram pelo código). Aprove antes de animar: mudar agora é barato."
        acao={
          <button type="button" className={botao.secundario} onClick={() => void pedirTodos()} disabled={!!a.ocupado}>
            Pedir os stills que faltam
          </button>
        }
      >
        {fila.data && fila.data.worker.situacao !== "ligado" && <p className={juntar(texto.auxiliar, "text-warning")}>A máquina da agência (worker de render) não está ligada: os pedidos esperam na fila.</p>}
      </Secao>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        {filme.cenas.map((c, i) => (
          <Painel
            key={c.id}
            recolher={false}
            titulo={`${i + 1}. ${c.titulo}`}
            descricao={`${c.tipo_plano === "gerado" ? "Plano gerado" : c.tipo_plano === "real" ? "Material real" : c.modo === "sob_medida" ? "Sob medida" : (pecaPorId(c.peca) || { rotulo: "" }).rotulo} · ${c.duracao_s} s`}
            acao={
              c.still_aprovado ? (
                <span className="inline-flex items-center text-[12px] text-primary">
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Aprovado
                </span>
              ) : (
                <button type="button" className={botao.secundario} disabled={c.tipo_plano === "hf" && !renderDaCena(filme, c, "still", formato)} onClick={() => void a.salvarCena({ id: c.id, still_aprovado: true })}>
                  Aprovar
                </button>
              )
            }
          >
            <div className="min-w-0 space-y-3" data-cena={c.id}>
              {c.ideia && <p className={texto.auxiliar}>{c.ideia}</p>}
              {c.tipo_plano === "hf" ? (
                <>
                  <CenaNaFila filme={filme} links={links} fila={fila.data} cena={c} modo="still" formato={formato} onCancelar={(id) => void a.cancelar(id)} compacta />
                  <button type="button" className={botao.secundario} disabled={a.ocupado === `${c.id}:still`} onClick={() => void a.pedir(c.id, "still")}>
                    {a.ocupado === `${c.id}:still` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    {renderDaCena(filme, c, "still", formato) ? "Tirar outro still" : "Tirar o still"}
                  </button>
                  <Secao titulo="Textos da cena" nivel={3} recolher={`mesa-motion:cena:${c.id}`} recolhidaDeInicio>
                    <EditorDaCena filme={filme} cena={c} prints={prints} />
                  </Secao>
                </>
              ) : (
                <div className="min-w-0 space-y-2">
                  <span className="flex min-w-0 items-center justify-between">
                    <span className={texto.rotulo}>{c.tipo_plano === "gerado" ? "Prompt do plano (Mesa Vídeos)" : "Material real"}</span>
                    {c.tipo_plano === "gerado" && (
                      <PreencherComIA
                        papel="motion"
                        clientId={clientId}
                        marcaId={marca ? marca.id : null}
                        compacto
                        campos={[{ chave: "prompt", rotulo: "Prompt do plano", tipo: "texto_longo", valorAtual: c.prompt, maximo: 900, dica: "Cena concreta de câmera em português, sem texto na imagem e sem logo (a logo entra pelo código). Nada de pessoa real sem autorização." }]}
                        contexto={`Plano ${i + 1} do filme da marca "${filme.nome}": ${c.titulo}. Ideia: ${c.ideia || "-"}. Câmera: ${c.camera || "-"}.`}
                        onAplicar={(v) => a.salvarCena({ id: c.id, prompt: String(v.prompt || ""), still_aprovado: false })}
                        onDesfazer={(v) => a.salvarCena({ id: c.id, prompt: String(v.prompt || ""), still_aprovado: false })}
                      />
                    )}
                  </span>
                  {c.tipo_plano === "gerado" ? (
                    <textarea key={c.prompt} className={campoTexto} defaultValue={c.prompt} maxLength={900} onBlur={(e) => e.target.value !== c.prompt && void a.salvarCena({ id: c.id, prompt: e.target.value, still_aprovado: false })} aria-label="Prompt do plano" />
                  ) : (
                    <p className={texto.corpo}>{c.arquivo ? "Vídeo escolhido." : "Escolha o vídeo do acervo na Construção."}</p>
                  )}
                  {c.camera && <p className={texto.auxiliar}>Câmera: {c.camera}</p>}
                </div>
              )}
            </div>
          </Painel>
        ))}
      </div>
      <button type="button" className={botao.primario} onClick={() => irPara("construcao")}>
        Seguir para a construção
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function EtapaStills({ irPara }: { irPara: IrPara }) {
  return <ComFilme>{(filme, links) => <Conteudo key={filme.id} filme={filme} links={links} irPara={irPara} />}</ComFilme>;
}
