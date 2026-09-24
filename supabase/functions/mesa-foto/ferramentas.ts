/**
 * O que as áreas novas da Mesa Foto (modelos.ts e canvas.ts) recebem do
 * index.ts: banco, acesso, armazenamento e leituras já existentes. O index
 * monta este objeto uma vez e registra as ações; assim os arquivos novos não
 * importam o index (sem import circular) e o index não cresce.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ImagemEntrada, ModeloIa } from "../_shared/ia-motor.ts";
import type { KitFoto, RefDoKit } from "./calculos.ts";

export type Chamador = { userId: string; token: string; doChamador: SupabaseClient };

export type ImagemDoAcervoLida = {
  id: string;
  client_id: string;
  origem: string;
  storage_bucket: string;
  storage_path: string;
  nome: string;
  pasta: string | null;
  categoria: string | null;
  tags: string[] | null;
  descricao: string | null;
  ativa: boolean;
  derivada_de: string | null;
  gerada: boolean | null;
  modo: string | null;
  kit_id: string | null;
  sha256: string | null;
  largura: number | null;
  altura: number | null;
  aprovada: boolean | null;
  criado_em: string;
  atualizado_em: string;
};

export type KitLido = KitFoto & { id: string; client_id: string };
export type RefLida = RefDoKit & { imagem: ImagemDoAcervoLida };

export type ItemDaBibliotecaLido = {
  id: string;
  client_id: string | null;
  tipo: "prompt" | "referencia";
  categoria: string;
  titulo: string;
  prompt_pt: string | null;
  prompt_en: string | null;
  negativo: string | null;
  imagem_url: string | null;
  storage_path: string | null;
  fonte_nome: string | null;
  fonte_url: string | null;
  licenca: string | null;
  autor: string | null;
  tags: string[] | null;
  destaque: boolean;
};

export type FerramentasDaMesa = {
  servico: () => SupabaseClient;
  json: (body: unknown, status?: number) => Response;
  garantirAcesso: (ch: Chamador, clientId: string) => Promise<void>;
  baixar: (bucket: string, caminho: string, max?: number) => Promise<Uint8Array>;
  baixarReduzida: (bucket: string, caminho: string, lado: number, nome: string) => Promise<ImagemEntrada>;
  urlAssinada: (bucket: string, caminho: string, download?: string) => Promise<string | null>;
  salvarNoMesa: (caminho: string, bytes: Uint8Array, mime: string) => Promise<void>;
  emParalelo: <T, R>(itens: T[], n: number, fn: (x: T, i: number) => Promise<R>) => Promise<R[]>;
  lerImagens: (clientId: string, ids: string[]) => Promise<ImagemDoAcervoLida[]>;
  /** Kit (conferindo o acesso ao cliente dele) com as referências que ainda estão no acervo. */
  lerKitComRefs: (ch: Chamador, kitId: string) => Promise<{ kit: KitLido; refs: RefLida[] }>;
  lerItensDaBiblioteca: (clientId: string, ids: string[]) => Promise<ItemDaBibliotecaLido[]>;
  imagemDoItemDaBiblioteca: (clientId: string, item: ItemDaBibliotecaLido, lado?: number) => Promise<ImagemEntrada>;
  modeloDeTexto: (papel: "diretor_arte" | "leitura", pedido?: unknown) => Promise<ModeloIa>;
  camposImagem: string;
  timeoutTextoMs: number;
};
