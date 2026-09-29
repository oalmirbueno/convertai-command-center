import { useState } from "react";
import { Images, Loader2, X } from "lucide-react";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { ImagemDaMesa } from "./MesaContexto";
import { BotaoDeAnexar, type ControleDeAnexos } from "./AnexosDoPedido";
import SeletorDoAcervo, { type ImagemDoAcervo } from "./SeletorDoAcervo";
import {
  DICA_DO_PAPEL_DO_ANEXO,
  MAX_ANEXOS,
  PAPEIS_DO_ANEXO,
  ROTULO_DO_PAPEL_DO_ANEXO,
  type AnexoPedido,
  type PapelPedidoDoAnexo,
} from "../../../supabase/functions/estudio-arte/anexos-do-ajuste";

/**
 * Imagens anexadas no "Ajustar" da lâmina e na conversa com o diretor (frente
 * RO, fase 2, 29/09). Pedido do dono: "o agente do ajustar lâmina poderia
 * receber imagens e evoluir ainda mais, para não ficar só texto".
 *
 * Colar (Ctrl+V), arrastar, escolher do acervo, câmera ou galeria no celular
 * (o botão abre o seletor de arquivos do aparelho). Várias imagens, com
 * miniatura e o X de tirar. Cada uma tem o papel (Automático: o agente decide
 * pelo texto do pedido), num seletor pequeno, sem caixa. O "?" explica.
 */

export interface AnexoComPapel {
  /** id na tela (upload) ou "acervo:<id>". */
  id: string;
  nome: string;
  papel: PapelPedidoDoAnexo;
  caminho: string | null;
  imagem_id: string | null;
  bucket?: string | null;
  previa?: string | null;
  estado: "subindo" | "pronto" | "erro";
}

/** O estado dos papéis e das imagens do acervo, junto do controle de upload (useAnexos). */
export function usePapeisDosAnexos() {
  const [papeis, setPapeis] = useState<Record<string, PapelPedidoDoAnexo>>({});
  const [doAcervo, setDoAcervo] = useState<ImagemDoAcervo[]>([]);
  return {
    papeis,
    doAcervo,
    trocarPapel: (id: string, papel: PapelPedidoDoAnexo) => setPapeis((p) => ({ ...p, [id]: papel })),
    escolherDoAcervo: (i: ImagemDoAcervo) => setDoAcervo((l) => (l.some((x) => x.id === i.id) ? l : l.concat([i]))),
    tirarDoAcervo: (id: string) => setDoAcervo((l) => l.filter((x) => x.id !== id)),
    limpar: () => {
      setPapeis({});
      setDoAcervo([]);
    },
  };
}
export type PapeisDosAnexos = ReturnType<typeof usePapeisDosAnexos>;

/** As imagens (upload e acervo) com o papel, na ordem em que aparecem. */
export function anexosComPapel(controle: ControleDeAnexos, p: PapeisDosAnexos): AnexoComPapel[] {
  const enviados: AnexoComPapel[] = controle.lista.map((a) => ({ id: a.id, nome: a.nome, papel: p.papeis[a.id] || "auto", caminho: a.caminho, imagem_id: null, previa: a.previa, estado: a.estado }));
  const acervo: AnexoComPapel[] = p.doAcervo.map((i) => ({ id: `acervo:${i.id}`, nome: i.nome || "foto do acervo", papel: p.papeis[`acervo:${i.id}`] || "auto", caminho: i.storage_path, imagem_id: i.id, bucket: i.storage_bucket || "mesa", estado: "pronto" }));
  return enviados.concat(acervo).slice(0, MAX_ANEXOS);
}

/** O que vai no corpo (ajustar_card.anexos ou conversar.imagens): só as prontas. */
export function corpoDosAnexos(lista: AnexoComPapel[]): AnexoPedido[] {
  return lista
    .filter((a) => a.estado === "pronto" && (a.imagem_id || a.caminho))
    .map((a) => (a.imagem_id ? { imagem_id: a.imagem_id, nome: a.nome, papel: a.papel } : { caminho: a.caminho, nome: a.nome, papel: a.papel }));
}

export const AJUDA_DOS_PAPEIS =
  "Cada imagem tem um papel. Automático: o agente decide pelo que você escreveu. " +
  PAPEIS_DO_ANEXO.map((p) => `${ROTULO_DO_PAPEL_DO_ANEXO[p]}: ${DICA_DO_PAPEL_DO_ANEXO[p]}.`).join(" ") +
  " Imagem cortada no envio é recusada antes de gastar, com o motivo.";

export default function AnexosComPapel({
  controle,
  papeis,
  desabilitado = false,
}: {
  controle: ControleDeAnexos;
  papeis: PapeisDosAnexos;
  desabilitado?: boolean;
}) {
  const [acervoAberto, setAcervoAberto] = useState(false);
  const lista = anexosComPapel(controle, papeis);
  const cheio = lista.length >= MAX_ANEXOS;
  return (
    <div className="min-w-0" data-anexos-com-papel={lista.length}>
      <div className="flex min-w-0 flex-wrap items-center">
        <BotaoDeAnexar anexos={controle} className="mb-1 mr-1.5" />
        <button
          type="button"
          onClick={() => setAcervoAberto((a) => !a)}
          disabled={desabilitado || cheio}
          aria-expanded={acervoAberto}
          className="mb-1 mr-1.5 inline-flex h-8 items-center rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Escolher do acervo do cliente"
        >
          <Images className="mr-1 h-4 w-4" /> Do acervo
        </button>
        <AjudaRecolhida className="mb-1" rotulo="O papel de cada imagem" titulo="Imagens no pedido">
          {AJUDA_DOS_PAPEIS}
        </AjudaRecolhida>
      </div>
      {lista.length > 0 && (
        <ul className="mt-1 flex min-w-0 flex-wrap" aria-label="Imagens anexadas ao pedido">
          {lista.map((a) => (
            <li key={a.id} className="mb-1.5 mr-2 w-20 min-w-0" data-anexo={a.id} data-papel={a.papel}>
              <span className={`relative block h-14 w-20 overflow-hidden rounded-md border bg-secondary ${a.estado === "erro" ? "border-destructive" : "border-border"}`}>
                {a.previa ? <img src={a.previa} alt={a.nome} className="h-full w-full object-cover" /> : a.caminho ? <ImagemDaMesa caminho={a.caminho} bucket={a.bucket || "mesa"} alt={a.nome} className="h-full w-full" /> : null}
                {a.estado === "subindo" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => (a.imagem_id ? papeis.tirarDoAcervo(a.imagem_id) : controle.remover(a.id))}
                  aria-label={`Tirar ${a.nome}`}
                  title="Tirar"
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
              <select
                value={a.papel}
                onChange={(e) => papeis.trocarPapel(a.id, e.target.value as PapelPedidoDoAnexo)}
                aria-label={`Papel de ${a.nome}`}
                title={a.papel === "auto" ? "O agente decide pelo pedido" : DICA_DO_PAPEL_DO_ANEXO[a.papel]}
                className="mt-0.5 h-7 w-full min-w-0 bg-transparent text-[11px] text-muted-foreground focus:text-foreground"
              >
                <option value="auto">Automático</option>
                {PAPEIS_DO_ANEXO.map((p) => (
                  <option key={p} value={p}>{ROTULO_DO_PAPEL_DO_ANEXO[p]}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      {acervoAberto && (
        <SeletorDoAcervo
          titulo="Imagem para o pedido"
          escolhidas={papeis.doAcervo.map((i) => i.id)}
          onEscolher={(i) => {
            papeis.escolherDoAcervo(i);
            setAcervoAberto(false);
          }}
          onFechar={() => setAcervoAberto(false)}
        />
      )}
    </div>
  );
}
