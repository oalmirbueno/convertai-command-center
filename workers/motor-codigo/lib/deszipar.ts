/**
 * Abrir um zip (a importação de site, Gravyx 19/10/2026), escrito à mão com o
 * zlib do Node, como o zip.ts: sem dependência, igual no Windows e no Linux.
 * Lê o diretório central (tamanhos de verdade mesmo com descritor de dados),
 * só "guardado" (0) e "deflate" (8), sem ZIP64 e sem senha. Defesa contra
 * zip bomba: o teto de bytes descomprimidos vale por arquivo e no total, e o
 * inflate para no teto. Caminho é só texto aqui: quem decide se é seguro é a
 * análise da importação (normalizarCaminho), e nada é escrito em disco.
 */
import { inflateRawSync } from "node:zlib";

export type EntradaDoZip = { caminho: string; bytes: Uint8Array };

export class ErroDoZip extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDoZip";
  }
}

const FIM_DO_DIRETORIO = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function deszipar(zip: Uint8Array, tetos: { arquivoBytes: number; totalBytes: number; arquivos: number }): EntradaDoZip[] {
  const b = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  // O fim do diretório central: nos últimos 22 + 65535 bytes (comentário do zip).
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b.readUInt32LE(i) === FIM_DO_DIRETORIO) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ErroDoZip("o arquivo não é um zip válido");
  const total = b.readUInt16LE(fim + 10);
  const tamanhoDoCentral = b.readUInt32LE(fim + 12);
  const inicioDoCentral = b.readUInt32LE(fim + 16);
  if (total === 0xffff || inicioDoCentral === 0xffffffff) throw new ErroDoZip("zip64 não é aceito: comprima de novo com menos de 4 GB");
  if (total > tetos.arquivos * 4) throw new ErroDoZip(`o zip tem ${total} entradas; o máximo é ${tetos.arquivos}`);
  if (inicioDoCentral + tamanhoDoCentral > b.length) throw new ErroDoZip("o zip está cortado (diretório central fora do arquivo)");
  const saida: EntradaDoZip[] = [];
  let somado = 0;
  let p = inicioDoCentral;
  for (let n = 0; n < total; n++) {
    if (b.readUInt32LE(p) !== CENTRAL) throw new ErroDoZip("o zip está corrompido (diretório central)");
    const flags = b.readUInt16LE(p + 8);
    const metodo = b.readUInt16LE(p + 10);
    const comprimido = b.readUInt32LE(p + 20);
    const descomprimido = b.readUInt32LE(p + 24);
    const tamNome = b.readUInt16LE(p + 28);
    const tamExtra = b.readUInt16LE(p + 30);
    const tamComentario = b.readUInt16LE(p + 32);
    const atributos = b.readUInt32LE(p + 38);
    const local = b.readUInt32LE(p + 42);
    const nome = b.subarray(p + 46, p + 46 + tamNome).toString(flags & 0x0800 ? "utf8" : "latin1");
    p += 46 + tamNome + tamExtra + tamComentario;
    if (nome.charAt(nome.length - 1) === "/" || nome.charAt(nome.length - 1) === "\\") continue;
    // Link simbólico (unix 0120000) não entra: nada aponta para fora do projeto.
    if (((atributos >>> 16) & 0o170000) === 0o120000) continue;
    if (flags & 0x0001) throw new ErroDoZip(`o zip tem senha (${nome}): exporte sem senha`);
    if (descomprimido > tetos.arquivoBytes) throw new ErroDoZip(`${nome} passa do limite por arquivo`);
    somado += descomprimido;
    if (somado > tetos.totalBytes) throw new ErroDoZip("o zip aberto passa do limite total do site");
    if (saida.length >= tetos.arquivos) throw new ErroDoZip(`o zip tem mais de ${tetos.arquivos} arquivos`);
    if (b.readUInt32LE(local) !== LOCAL) throw new ErroDoZip(`o zip está corrompido (${nome})`);
    const inicio = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const corpo = b.subarray(inicio, inicio + comprimido);
    let bytes: Buffer;
    if (metodo === 0) bytes = Buffer.from(corpo);
    else if (metodo === 8) {
      try {
        bytes = inflateRawSync(corpo, { maxOutputLength: Math.max(1, descomprimido) });
      } catch {
        throw new ErroDoZip(`${nome} não abriu (deflate inválido ou maior que o declarado)`);
      }
    } else throw new ErroDoZip(`${nome} usa uma compressão que o motor não abre (método ${metodo})`);
    if (bytes.length !== descomprimido) throw new ErroDoZip(`${nome} não bate com o tamanho declarado no zip`);
    saida.push({ caminho: nome, bytes: new Uint8Array(bytes) });
  }
  return saida;
}
