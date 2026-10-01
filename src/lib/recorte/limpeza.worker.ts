/**
 * A conta do recorte limpo fora do fio principal (revisão IDR, 01/10).
 *
 * Limpar uma logo de 4096 px (até 12 MP) leva alguns segundos de CPU; na tela
 * isso travava o celular. A tela decodifica a logo (drawImage e getImageData,
 * que o Safari 11 tem), manda os pixels para cá (transferidos, sem cópia), e
 * recebe os pixels limpos para gravar o PNG. Só conta: sem canvas, sem rede.
 * O Vite empacota este arquivo (com o recorte-limpo dentro) como worker
 * clássico no build; em desenvolvimento ele roda como módulo.
 */

import { contaDaLimpeza, type PedidoDaLimpeza } from "./contaDaLimpeza";

const escopo = self as unknown as {
  onmessage: ((e: MessageEvent<PedidoDaLimpeza & { id: number }>) => void) | null;
  postMessage: (mensagem: unknown, transferir?: Transferable[]) => void;
};

escopo.onmessage = (e) => {
  const pedido = e.data;
  try {
    const r = contaDaLimpeza(pedido);
    const transferir: Transferable[] = [];
    if (r.data && r.data.buffer !== pedido.data.buffer) transferir.push(r.data.buffer);
    escopo.postMessage({ id: pedido.id, ...r }, transferir);
  } catch (err) {
    escopo.postMessage({ id: pedido.id, erro: err instanceof Error ? err.message : String(err) });
  }
};
