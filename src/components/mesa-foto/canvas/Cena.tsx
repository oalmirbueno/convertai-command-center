import { Clapperboard, Film, X } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import {
  ENQUADRAMENTOS_DA_CENA,
  entradasDoGerar,
  fotoDaLigacao,
  nomeDoResultado,
  NOS_DE_VIDEO_EM_BREVE,
  PAPEIS_DA_LIGACAO,
  type Canvas,
  type CenaDoResultado,
  type DadosDoNo,
  type Ligacao,
  type NoDoCanvas,
  type PapelDaLigacao,
} from "../canvasApi";
import { BOTAO, CAMPO, Escolha, ROTULO, type Fontes } from "./comum";
import { cenaNova, cenasDaHistoria } from "./historia";

/**
 * Peças da cena no painel (sem React Flow): os campos da cena no Resultado e
 * o editor da ligação entre Resultados (papel e foto). Visual dos painéis
 * pretos do Canvas; textos curtos, sem travessão.
 */

const aprovadasDe = (f: Fontes) => f.fotos.filter((x) => x.aprovada).map((x) => x.id);

/** Fotos prontas de um Resultado, a mais nova primeiro (para escolher a da cena ou a da ligação). */
function FotosParaEscolher({ no, escolhida, onEscolher, rotulo }: { no: NoDoCanvas; escolhida: string | null; onEscolher: (id: string | null) => void; rotulo: string }) {
  const prontas = (no.dados.resultados || []).filter((r) => r.status === "gerada" && !!r.imagem_id).slice().reverse().slice(0, 12);
  if (!prontas.length) return <p className="text-[11px] text-zinc-400">Ainda sem foto. Gere a foto para escolher.</p>;
  return (
    <div className="flex min-w-0 flex-wrap" role="radiogroup" aria-label={rotulo}>
      <button type="button" role="radio" aria-checked={!escolhida} onClick={() => onEscolher(null)} className={`mb-1 mr-1 flex h-12 items-center rounded-lg border px-2 text-[10.5px] ${!escolhida ? "border-emerald-400 text-white" : "border-white/10 text-zinc-400 hover:text-white"}`} title="A foto da cena, senão a mais nova aprovada, senão a mais nova">
        Automática
      </button>
      {prontas.map((r) => (
        <button
          key={r.geracao_id}
          type="button"
          role="radio"
          aria-checked={escolhida === r.imagem_id}
          onClick={() => onEscolher(r.imagem_id)}
          className={`mb-1 mr-1 block shrink-0 overflow-hidden rounded-lg border ${escolhida === r.imagem_id ? "border-emerald-400 ring-1 ring-emerald-400" : "border-white/10"}`}
          style={{ width: 40, height: 48 }}
          aria-label="Usar esta foto"
        >
          <MiniaturaDoStorage bucket={r.storage_bucket} caminho={r.storage_path || r.url} alt="" largura={96} className="h-full w-full" />
        </button>
      ))}
    </div>
  );
}

/**
 * A cena no Resultado: marcar como cena da história, o que acontece, o
 * enquadramento, o lugar, a narrativa, a foto da cena e a semente fixa. A
 * animação aparece como "em breve" (reservado para a Mesa Vídeos).
 */
export function AjustesDaCena({ canvas, no, onMudar }: { canvas: Canvas; no: NoDoCanvas; onMudar: (dados: Partial<DadosDoNo>) => void }) {
  const cena = no.dados.cena || null;
  const historia = cenasDaHistoria(canvas);
  const minha = historia.find((h) => h.no.id === no.id) || null;
  const mudar = (m: Partial<CenaDoResultado>) => cena && onMudar({ cena: { ...cena, ...m } });
  if (!cena) {
    return (
      <div className="min-w-0 rounded-xl border border-white/10 bg-zinc-900/60 p-2.5" data-cena-do-resultado="nao">
        <p className="mb-1.5 flex items-center text-[12px] font-semibold">
          <Clapperboard className="mr-1.5 h-3.5 w-3.5 text-emerald-300" /> Cena da história
        </p>
        <p className="mb-2 text-[11px] leading-snug text-zinc-400">Marque para este Resultado entrar na História do quadro, com ação, enquadramento e narrativa. A mesma pessoa segue nas outras cenas.</p>
        <button type="button" className={BOTAO} onClick={() => onMudar({ cena: cenaNova(historia.length + 1) })} data-marcar-cena={no.id}>
          <Clapperboard className="mr-1 h-3.5 w-3.5" /> Esta é uma cena
        </button>
      </div>
    );
  }
  const pessoas = entradasDoGerar(canvas, no.id).filter((e) => e.entrada === "pessoa").length;
  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-emerald-400/30 bg-zinc-900/60 p-2.5" data-cena-do-resultado="sim">
      <div className="flex min-w-0 items-center">
        <p className="flex min-w-0 flex-1 items-center text-[12px] font-semibold">
          <Clapperboard className="mr-1.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
          <span className="truncate">
            Cena {minha ? minha.numero : cena.ordem} de {historia.length}
          </span>
        </p>
        <button type="button" className="text-[10.5px] text-zinc-400 hover:text-white" onClick={() => onMudar({ cena: null })} title="O Resultado continua no quadro">
          Tirar da história
        </button>
      </div>
      <input value={cena.titulo} onChange={(e) => mudar({ titulo: e.target.value })} placeholder="Título da cena (ex.: Ela chega em casa)" aria-label="Título da cena" className={CAMPO} />
      <textarea value={cena.acao} onChange={(e) => mudar({ acao: e.target.value })} rows={2} placeholder="O que acontece: ela abre a caixa e sorri ao ver o produto" aria-label="Ação da cena" className={CAMPO} />
      <div className="min-w-0">
        <p className={ROTULO}>Enquadramento</p>
        <Escolha rotulo="Enquadramento da cena" opcoes={ENQUADRAMENTOS_DA_CENA} valor={cena.enquadramento || "livre"} onEscolher={(v) => mudar({ enquadramento: v })} />
      </div>
      <input value={cena.cenario} onChange={(e) => mudar({ cenario: e.target.value })} placeholder="Lugar da cena (ex.: sala clara com janela)" aria-label="Lugar da cena" className={CAMPO} />
      <textarea value={cena.narrativa} onChange={(e) => mudar({ narrativa: e.target.value })} rows={2} placeholder="Narrativa: o texto que conta esta parte da história" aria-label="Narrativa da cena" className={CAMPO} />
      {pessoas > 0 && cena.enquadramento === "plano_geral" && <p className="text-[11px] text-amber-300">Plano geral deixa o rosto pequeno e a pessoa pode mudar. Para a foto-chave, prefira plano médio.</p>}
      {pessoas > 2 && <p className="text-[11px] text-amber-300">Mais de 2 pessoas na cena misturam os rostos. Se puder, divida em duas cenas.</p>}
      <div className="min-w-0">
        <p className={ROTULO}>Foto da cena na história</p>
        <FotosParaEscolher no={no} escolhida={cena.imagem_id} onEscolher={(id) => mudar({ imagem_id: id })} rotulo="Foto da cena" />
      </div>
      <label className="flex min-w-0 items-center text-[11px] text-zinc-400">
        <span className="mr-2 shrink-0">Semente fixa</span>
        <input
          inputMode="numeric"
          value={cena.seed === null ? "" : String(cena.seed)}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
            mudar({ seed: v ? Number(v) : null });
          }}
          placeholder="opcional"
          aria-label="Semente fixa da cena"
          className={`${CAMPO} h-7 w-28 py-0`}
        />
      </label>
      <div className="min-w-0 border-t border-white/10 pt-2">
        <p className={`${ROTULO} flex items-center`}>
          <Film className="mr-1 h-3 w-3" /> Vídeo da cena (Mesa Vídeos, em breve)
        </p>
        <div className="flex min-w-0 flex-wrap">
          {NOS_DE_VIDEO_EM_BREVE.map((v) => (
            <span key={v.chave} title={v.dica} className="mb-1 mr-1 inline-flex h-6 cursor-not-allowed items-center rounded-full border border-dashed border-white/20 px-2 text-[10.5px] text-zinc-500">
              {v.rotulo}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Ligação de um Resultado para outro: o papel (personagem, produto, cenário
 * ou estilo) e a foto que vai (automática ou escolhida).
 */
export function EditorDaLigacaoDeResultado({
  canvas,
  ligacao,
  fontes,
  onPapel,
  onFoto,
  onDesligar,
}: {
  canvas: Canvas;
  ligacao: Ligacao;
  fontes: Fontes;
  onPapel: (p: PapelDaLigacao) => void;
  onFoto: (id: string | null) => void;
  onDesligar?: () => void;
}) {
  const origem = canvas.nos.find((n) => n.id === ligacao.de) || null;
  if (!origem) return null;
  const foto = fotoDaLigacao(origem, ligacao.imagem_id, aprovadasDe(fontes));
  return (
    <div className="min-w-0 space-y-2" data-ligacao-de-resultado={ligacao.id}>
      <div className="flex min-w-0 items-center rounded-xl border border-white/10 bg-zinc-900/60 p-2">
        <span className="relative block shrink-0 overflow-hidden rounded-lg bg-zinc-900" style={{ width: 44, height: 52 }}>
          {foto ? <MiniaturaDoStorage bucket={foto.storage_bucket} caminho={foto.storage_path || foto.url} alt="" largura={120} className="h-full w-full" /> : null}
        </span>
        <div className="ml-2.5 min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold">De: {nomeDoResultado(canvas, origem)}</p>
          <p className={`truncate text-[11px] ${foto ? "text-zinc-400" : "text-amber-300"}`}>{foto ? "A foto desta cena entra aqui" : "Gere a foto dele antes"}</p>
        </div>
        {onDesligar && (
          <button type="button" onClick={onDesligar} aria-label="Desligar" className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="min-w-0">
        <p className={ROTULO}>Entra como</p>
        <Escolha rotulo="Papel da foto" opcoes={PAPEIS_DA_LIGACAO.map((p) => ({ valor: p.valor, rotulo: p.rotulo, dica: p.dica }))} valor={ligacao.papel || "personagem"} onEscolher={(v) => onPapel(v as PapelDaLigacao)} />
        <p className="text-[11px] text-zinc-400">{(PAPEIS_DA_LIGACAO.find((p) => p.valor === (ligacao.papel || "personagem")) || PAPEIS_DA_LIGACAO[0]).dica}</p>
      </div>
      <div className="min-w-0">
        <p className={ROTULO}>Qual foto</p>
        <FotosParaEscolher no={origem} escolhida={ligacao.imagem_id || null} onEscolher={onFoto} rotulo="Foto que entra" />
      </div>
      {ligacao.papel === "personagem" && <p className="text-[11px] leading-snug text-zinc-400">Se a pessoa veio de uma modelo, o rosto volta à âncora dela e esta foto dá só a roupa e o cabelo. Para a pessoa ficar para sempre, use Virar personagem na foto.</p>}
    </div>
  );
}
