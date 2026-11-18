import { supabase } from "@/integrations/supabase/client";

/**
 * Assinatura de arquivos em lote (10/11/2026).
 *
 * O que aconteceu: cada miniatura e cada original pedia a sua URL assinada numa chamada separada ao
 * Storage, e cada chamada ocupa uma conexão do banco. Uma tela com centenas de arquivos (Workspace,
 * Arquivos) disparava mais de 600 chamadas por minuto; às 16h51 o banco ficou sem conexões ("remaining
 * connection slots are reserved") e o painel inteiro parou por mais de dez minutos. Às 12h29 do mesmo
 * dia tinha acontecido igual.
 *
 * O que muda: os pedidos de assinatura entram numa fila e saem juntos, numa chamada só por bucket (até
 * 100 arquivos por chamada) e no máximo duas chamadas ao mesmo tempo. O primeiro pedido sai na hora;
 * enquanto ele está no ar, os que chegam esperam e vão juntos no próximo lote. Ninguém espera um
 * relógio, e a carga no banco deixa de crescer com o número de arquivos na tela.
 *
 * Nada muda para quem chama: a mesma URL assinada, o mesmo erro quando o arquivo não pode ser lido.
 */

export type LinhaAssinada = { path: string | null; signedUrl?: string | null; error?: string | null };

type Pedido = { caminho: string; um: boolean; ok: (l: LinhaAssinada) => void; falha: (e: unknown) => void };
type Fila = { bucket: string; expira: number; pedidos: Pedido[] };

const MAX_EM_VOO = 2;
const MAX_POR_LOTE = 100;

const filas = new Map<string, Fila>();
let emVoo = 0;
let agendado = false;

async function assinarNoStorage(bucket: string, caminhos: string[], expira: number, sozinho: boolean): Promise<LinhaAssinada[]> {
  const cliente = supabase.storage.from(bucket) as any;
  // Um arquivo só, pedido sozinho: a chamada de sempre (o mesmo custo, e a mesma resposta de erro do Storage).
  if (sozinho && caminhos.length === 1 && typeof cliente.createSignedUrl === "function") {
    const { data, error } = await cliente.createSignedUrl(caminhos[0], expira);
    if (error) throw error;
    return [{ path: caminhos[0], signedUrl: data?.signedUrl ?? null, error: null }];
  }
  const { data, error } = await cliente.createSignedUrls(caminhos, expira);
  if (error) throw error;
  return (data || []) as LinhaAssinada[];
}

function despachar() {
  while (emVoo < MAX_EM_VOO && filas.size > 0) {
    const [chave, fila] = filas.entries().next().value as [string, Fila];
    // Tira até 100 caminhos diferentes; pedidos repetidos do mesmo caminho dividem a mesma resposta.
    const caminhos: string[] = [];
    const doLote: Pedido[] = [];
    const resto: Pedido[] = [];
    for (const p of fila.pedidos) {
      if (caminhos.indexOf(p.caminho) >= 0) doLote.push(p);
      else if (caminhos.length < MAX_POR_LOTE) { caminhos.push(p.caminho); doLote.push(p); }
      else resto.push(p);
    }
    if (resto.length) fila.pedidos = resto;
    else filas.delete(chave);

    emVoo += 1;
    assinarNoStorage(fila.bucket, caminhos, fila.expira, doLote.every((p) => p.um))
      .then((linhas) => {
        for (const p of doLote) {
          const i = caminhos.indexOf(p.caminho);
          const pelaOrdem = linhas[i];
          const linha = pelaOrdem && (pelaOrdem.path === p.caminho || pelaOrdem.path == null) ? pelaOrdem : linhas.find((l) => l.path === p.caminho);
          p.ok(linha ? { ...linha, path: p.caminho } : { path: p.caminho, signedUrl: null, error: "URL indisponível" });
        }
      })
      .catch((erro) => { for (const p of doLote) p.falha(erro); })
      .then(() => { emVoo -= 1; despachar(); });
  }
}

function agendar() {
  if (agendado) return;
  agendado = true;
  // No fim do passo atual: todos os pedidos feitos no mesmo instante (uma grade montando) saem juntos.
  void Promise.resolve().then(() => { agendado = false; despachar(); });
}

/** A URL assinada de um arquivo. Rejeita só quando a chamada inteira falha; arquivo sem acesso volta com `error`. */
export function assinarCaminho(bucket: string, caminho: string, expira = 3600, um = true): Promise<LinhaAssinada> {
  return new Promise<LinhaAssinada>((ok, falha) => {
    const chave = `${bucket}|${expira}`;
    const fila = filas.get(chave);
    if (fila) fila.pedidos.push({ caminho, um, ok, falha });
    else filas.set(chave, { bucket, expira, pedidos: [{ caminho, um, ok, falha }] });
    agendar();
  });
}

/** Vários arquivos do mesmo bucket: as linhas voltam na ordem pedida. */
export function assinarCaminhos(bucket: string, caminhos: string[], expira = 3600): Promise<LinhaAssinada[]> {
  return Promise.all(caminhos.map((c) => assinarCaminho(bucket, c, expira, false)));
}

/** Só para testes: esvazia as filas. */
export function __zerarAssinaturasEmLoteParaTeste() {
  filas.clear();
  emVoo = 0;
  agendado = false;
}
