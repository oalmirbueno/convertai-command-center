import {
  contextoDaMarcaAberta,
  logosDaMarca,
  preenchido,
  valorDaMarca,
  type OrigemDoValor,
} from "../../../supabase/functions/_shared/heranca-da-marca";
import type { MarcaDoCliente } from "./marcas";

/**
 * Kit que vale na tela para a marca aberta no topo (frente MC, 29/09).
 *
 * Pedido do dono: "eu mudo para CME e ele já muda tudo certinho, completo,
 * igual quando a gente seleciona outro cliente". A regra é a mesma das
 * funções (supabase/functions/_shared/heranca-da-marca.ts): principal = o kit
 * do cliente com o que ela tiver por cima; outra marca = só o dela, vazio
 * fica vazio (nunca a paleta, a logo, o estilo ou o contexto da Acerbi na CME).
 *
 * `alvoDoKit` diz onde a edição grava: sem marca ou na principal, o kit do
 * cliente (cliente_kit_marca); em outra marca, a linha dela (cliente_marcas).
 * Assim a tela de Marca é uma só, com os mesmos campos, para as duas.
 */

export interface CorDoKitDaMarca {
  nome: string;
  hex: string;
  papel: string;
}

/** Mesmo formato de KitDoContexto (src/components/mesa/contextoDoCliente.ts), sem importar a tela. */
export interface KitEfetivo {
  client_id: string;
  paleta: CorDoKitDaMarca[] | null;
  logo_file_id: string | null;
  logo_path?: string | null;
  logo_alt_path?: string | null;
  logo_alt_file_id?: string | null;
  logo_tom?: string | null;
  logo_alt_tom?: string | null;
  estilo: string | null;
  regras: string | null;
  contexto: Record<string, any> | null;
  contexto_atualizado_em: string | null;
}

export type AlvoDoKit =
  | { tabela: "cliente_kit_marca"; clientId: string; marcaId: null; nome: null }
  | { tabela: "cliente_marcas"; clientId: string; marcaId: string; nome: string };

/** Onde a edição do kit grava com esta marca aberta. */
export function alvoDoKit(clientId: string, marca: Pick<MarcaDoCliente, "id" | "principal" | "nome" | "client_id"> | null): AlvoDoKit {
  if (marca && !marca.principal && marca.client_id === clientId) return { tabela: "cliente_marcas", clientId, marcaId: marca.id, nome: marca.nome };
  return { tabela: "cliente_kit_marca", clientId, marcaId: null, nome: null };
}

/** De onde veio cada campo do kit efetivo (a tela diz "da CME" ou "vazio na CME"). */
export type OrigemDoKit = Record<"paleta" | "logo" | "estilo" | "regras" | "tom" | "contexto", OrigemDoValor>;

/**
 * O kit efetivo da marca aberta e a origem de cada campo. Sem marca, o kit do
 * cliente como veio (mesmo objeto).
 */
export function kitDaMarcaAberta(kit: KitEfetivo | null | undefined, marca: MarcaDoCliente | null, clientId: string): { kit: KitEfetivo | null; origem: OrigemDoKit } {
  const cliente = kit || null;
  const origemDoCliente = (v: unknown): OrigemDoValor => (preenchido(v) ? "cliente" : "vazio");
  if (!marca) {
    return {
      kit: cliente,
      origem: {
        paleta: origemDoCliente(cliente && cliente.paleta),
        logo: origemDoCliente(cliente && (cliente.logo_path || cliente.logo_file_id)),
        estilo: origemDoCliente(cliente && cliente.estilo),
        regras: origemDoCliente(cliente && cliente.regras),
        tom: origemDoCliente(cliente && cliente.contexto && cliente.contexto.tom_de_voz),
        contexto: origemDoCliente(cliente && cliente.contexto),
      },
    };
  }
  const paleta = valorDaMarca("paleta", marca, Array.isArray(marca.paleta) ? (marca.paleta as CorDoKitDaMarca[]) : null, cliente && Array.isArray(cliente.paleta) ? cliente.paleta : null, [] as CorDoKitDaMarca[]);
  const estilo = valorDaMarca("estilo", marca, marca.estilo, cliente ? cliente.estilo : null, null as string | null);
  const regras = valorDaMarca("regras", marca, marca.regras, cliente ? cliente.regras : null, null as string | null);
  const logos = logosDaMarca(marca, marca, cliente);
  const contextoDoCliente = (cliente && cliente.contexto) || null;
  const contexto = contextoDaMarcaAberta(marca, marca.contexto, contextoDoCliente);
  const tom = valorDaMarca("tom", marca, marca.tom, contextoDoCliente ? (contextoDoCliente.tom_de_voz as string | null) : null, null as string | null);
  if (tom.valor) contexto.tom_de_voz = tom.valor;
  else delete contexto.tom_de_voz;
  const contextoDaPropria = preenchido(marca.contexto);
  const atualizadoDaMarca = marca.contexto && typeof marca.contexto.atualizado_em === "string" ? (marca.contexto.atualizado_em as string) : null;
  return {
    kit: {
      client_id: clientId,
      paleta: paleta.valor,
      logo_path: logos.logo_path,
      logo_file_id: logos.logo_file_id,
      logo_alt_path: logos.logo_alt_path,
      logo_alt_file_id: logos.logo_alt_file_id,
      logo_tom: logos.logo_tom,
      logo_alt_tom: logos.logo_alt_tom,
      estilo: estilo.valor,
      regras: regras.valor,
      contexto: preenchido(contexto) ? contexto : null,
      contexto_atualizado_em: marca.principal ? (atualizadoDaMarca || (cliente ? cliente.contexto_atualizado_em : null)) : atualizadoDaMarca,
    },
    origem: {
      paleta: paleta.origem,
      logo: preenchido(marca.logo_path) || preenchido(marca.logo_file_id) ? "marca" : logos.logo_path || logos.logo_file_id ? "cliente" : "vazio",
      estilo: estilo.origem,
      regras: regras.origem,
      tom: tom.origem,
      contexto: contextoDaPropria ? "marca" : preenchido(contexto) ? "cliente" : "vazio",
    },
  };
}
