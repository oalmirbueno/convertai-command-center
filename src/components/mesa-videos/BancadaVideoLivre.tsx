import type { ReactNode } from "react";
import { Clapperboard, ImagePlus, ChevronDown, X } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { botao, campo, campoTexto } from "@/components/sistema/estilos";
import { EscolherImagem, SeletorDeCamera } from "./PecasDoGerador";
import type { MotorDeVideo } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import type { RascunhoLivre } from "./GeradorLivre";
import "./mesaVideo.css";

const IDEIAS = [
  { nome: "Destacar produto", texto: "Apresente o produto da referência com uma aproximação suave, luz natural e fundo organizado. Preserve a forma, a marca e as cores. Termine com o produto inteiro em destaque." },
  { nome: "Apresentar ambiente", texto: "Revele o ambiente da referência com movimento lento e contínuo, luz natural e perspectiva realista. Preserve a arquitetura e os objetos. Termine em uma visão ampla." },
  { nome: "Mostrar um serviço", texto: "Mostre um detalhe do serviço e revele o resultado com movimento suave. Use somente o contexto e as referências fornecidas, sem inventar depoimentos ou apresentar uma cena gerada como atendimento real." },
];

/** Apresentação simplificada exclusiva da Mesa Vídeos; geração e rascunho seguem no controlador existente. */
export default function BancadaVideoLivre({ r, mudar, motor, duracao, duracoes, resolucao, seletorMotor, diretor, gerar, seletorFotos, buscando, aoBuscar, copiando, resultado }: {
  r: RascunhoLivre; mudar: (v: Partial<RascunhoLivre>) => void; motor: MotorDeVideo | null;
  duracao: number; duracoes: number[]; resolucao: string;
  seletorMotor: ReactNode; diretor: ReactNode; gerar: ReactNode; seletorFotos: ReactNode;
  buscando: boolean; aoBuscar: () => void; copiando: boolean; resultado?: ReactNode;
}) {
  return <div className="video-livre" data-video-simples="">
    <div className="video-livre-grade">
      <section className="video-livre-base rounded-xl border bg-card p-4" aria-label="Base visual do vídeo">
        <header className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Imagem de partida</h3><button type="button" disabled={copiando} className={botao.discreto} onClick={aoBuscar}><ImagePlus className="mr-1.5 h-4 w-4" />Fotos e pastas</button></header>
        {buscando ? <div className="video-livre-selecao">{seletorFotos}</div> : <>
          <div className="video-livre-previa rounded-lg bg-muted/30">
            {r.inicial ? <MiniaturaDoStorage bucket="mesa" caminho={r.inicial} alt="Imagem de partida do vídeo" ajuste="contain" className="h-full w-full object-contain" /> : <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center"><Clapperboard className="h-10 w-10 text-primary" /><p className="text-sm font-medium">Uma foto ou uma ideia</p><p className="max-w-xs text-xs text-muted-foreground">Escolha uma imagem ou descreva o vídeo ao lado.</p><button type="button" className={botao.secundario} onClick={aoBuscar}>Escolher foto do cliente</button></div>}
          </div>
          <div className="mt-3"><EscolherImagem rotulo="Foto inicial ou arquivo" opcional valor={r.inicial} onEscolher={(inicial) => mudar({ inicial })} /></div>
          {copiando && <p role="status" className="mt-2 text-xs">Preparando a foto…</p>}
          {(motor?.cap.ultimo_quadro || !!motor?.cap.referencias || r.final || r.referencias.length > 0) && <details className="video-detalhes mt-3" open={r.final || r.referencias.length ? true : undefined}>
            <summary>Mais imagens <span className="text-muted-foreground">{r.referencias.length ? `· ${r.referencias.length} referências` : r.final ? "· final escolhido" : "opcional"}</span><ChevronDown className="h-4 w-4" /></summary>
            <div className="space-y-3 pt-3">
              {(motor?.cap.ultimo_quadro || r.final) && <EscolherImagem rotulo="Foto final" opcional valor={r.final} onEscolher={(final) => mudar({ final })} />}
              {r.referencias.map((path, i) => <div key={path} className="flex items-center justify-between text-xs"><span>Referência {i + 1}</span><button type="button" aria-label={`Remover referência ${i + 1}`} className={botao.icone} onClick={() => mudar({ referencias: r.referencias.filter((x) => x !== path) })}><X className="h-4 w-4" /></button></div>)}
              {!!motor?.cap.referencias && r.referencias.length < motor.cap.referencias && <EscolherImagem rotulo="Adicionar referência" opcional valor={null} onEscolher={(path) => path && mudar({ referencias: Array.from(new Set([...r.referencias, path])) })} />}
            </div>
          </details>}
        </>}
      </section>
      <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4" aria-label="Direção e opções do vídeo">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">O que você quer criar?</h3>{diretor}</div>
        <CampoDeFormulario rotulo="Descreva seu vídeo"><textarea className={`${campoTexto} min-h-[130px]`} maxLength={2400} value={r.prompt} onChange={(e) => mudar({ prompt: e.target.value })} placeholder="Ex.: aproxime devagar do produto, com luz natural e um fundo elegante." /></CampoDeFormulario>
        {!r.prompt.trim() && <div className="flex flex-wrap gap-2" aria-label="Ideias para começar">{IDEIAS.map((ideia) => <button type="button" key={ideia.nome} className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary" onClick={() => mudar({ prompt: ideia.texto })}>{ideia.nome}</button>)}</div>}
        <GrupoDeCampos colunas={2}>
          <CampoDeFormulario rotulo="Formato"><select className={campo} value={r.formato} onChange={(e) => mudar({ formato: e.target.value })}>{(motor?.formatos || ["9:16", "16:9", "1:1"]).map((f) => <option key={f} value={f}>{f === "9:16" ? "Vertical · 9:16" : f === "16:9" ? "Horizontal · 16:9" : f === "1:1" ? "Quadrado · 1:1" : f}</option>)}</select></CampoDeFormulario>
          <CampoDeFormulario rotulo="Duração"><select className={campo} value={duracao} onChange={(e) => mudar({ duracao: Number(e.target.value) })}>{duracoes.map((d) => <option key={d} value={d}>{d} segundos</option>)}</select></CampoDeFormulario>
        </GrupoDeCampos>
        <details className="video-detalhes"><summary>Modelo <span className="min-w-0 flex-1 truncate text-right text-muted-foreground" title={motor?.rotulo}>{motor?.rotulo || "Escolher"}</span><ChevronDown className="h-4 w-4" /></summary><div className="pt-3">{seletorMotor}</div></details>
        <details className="video-detalhes"><summary>Estilo e movimento <ChevronDown className="h-4 w-4" /></summary><div className="space-y-3 pt-3">
          <CampoDeFormulario rotulo="Acabamento"><select className={campo} value={r.acabamento || ""} onChange={(e) => mudar({ acabamento: e.target.value })}><option value="">Pela descrição</option>{["Natural e realista", "Comercial de produto", "Cinematográfico suave", "Catálogo com fundo limpo", "Documental de bastidores"].map((v) => <option key={v}>{v}</option>)}</select></CampoDeFormulario>
          {motor?.cap.camera ? <SeletorDeCamera valor={r.camera || ""} onEscolher={(camera) => mudar({ camera })} /> : <CampoDeFormulario rotulo="Movimento"><select className={campo} value={r.movimento || ""} onChange={(e) => mudar({ movimento: e.target.value })}><option value="">Pela descrição</option>{["Câmera fixa", "Aproximação lenta", "Deslocamento lateral suave", "Órbita lenta do produto", "Revelação do ambiente"].map((v) => <option key={v}>{v}</option>)}</select></CampoDeFormulario>}
        </div></details>
        {motor?.cap.audio && <details className="video-detalhes"><summary>Som e narração <span className="text-muted-foreground">{r.audio ? "ativados" : "opcional"}</span><ChevronDown className="h-4 w-4" /></summary><div className="space-y-3 pt-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.audio} onChange={(e) => mudar({ audio: e.target.checked })} />Gerar áudio com o vídeo</label>{r.audio && <CampoDeFormulario rotulo="Narração em português"><textarea className={campoTexto} rows={3} maxLength={600} value={r.narracao || ""} onChange={(e) => mudar({ narracao: e.target.value })} placeholder="Opcional: escreva a fala exata" /></CampoDeFormulario>}</div></details>}
        <details className="video-detalhes"><summary>Mais ajustes <span className="text-muted-foreground">{resolucao} · {r.variacoes} {r.variacoes > 1 ? "versões" : "versão"}</span><ChevronDown className="h-4 w-4" /></summary><div className="space-y-3 pt-3"><GrupoDeCampos colunas={2}>
          <CampoDeFormulario rotulo="Qualidade"><select className={campo} value={resolucao} onChange={(e) => mudar({ resolucao: e.target.value })}>{motor?.resolucoes.map((q) => <option key={q}>{q}</option>)}</select></CampoDeFormulario>
          <CampoDeFormulario rotulo="Variações"><select className={campo} value={r.variacoes} onChange={(e) => mudar({ variacoes: Number(e.target.value) })}>{[1,2,3,4].map((n) => <option key={n} value={n}>{n}</option>)}</select></CampoDeFormulario>
        </GrupoDeCampos><CampoDeFormulario rotulo="O que evitar"><input className={campo} value={r.negativo} maxLength={600} onChange={(e) => mudar({ negativo: e.target.value })} placeholder="Opcional" /></CampoDeFormulario></div></details>
      </section>
    </div>
    <footer className="video-livre-acao rounded-xl border bg-card p-3">{resultado}{gerar}</footer>
  </div>;
}
