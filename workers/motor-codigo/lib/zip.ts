/**
 * Zip do código do site (cópia de segurança no Storage e "Baixar o site").
 * Escrito à mão com o zlib do Node (deflate + crc32), sem dependência: o
 * mesmo resultado no Windows da agência e num Linux.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

/** O que nunca vai no zip (dependências, build, histórico, prévia e os planos do método em .metodo). */
export const FORA_DO_ZIP = new Set(["node_modules", "dist", "dist-ssr", ".git", ".vite", ".opencode", "referencias", ".metodo"]);

export function arquivosDoProjeto(pasta: string): string[] {
  const saida: string[] = [];
  (function andar(atual: string) {
    for (const nome of readdirSync(atual)) {
      if (FORA_DO_ZIP.has(nome)) continue;
      const caminho = join(atual, nome);
      const st = statSync(caminho);
      if (st.isDirectory()) andar(caminho);
      else if (st.isFile()) saida.push(caminho);
    }
  })(pasta);
  return saida.sort();
}

/** Data e hora no formato do DOS (o zip guarda assim). */
function dataDos(d: Date): { hora: number; dia: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipar(entradas: Array<{ nome: string; bytes: Uint8Array }>, quando = new Date()): Uint8Array {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  const { hora, dia } = dataDos(quando);
  for (const e of entradas) {
    const nome = Buffer.from(e.nome.split(sep).join("/"), "utf8");
    const dados = Buffer.from(e.bytes);
    const comprimido = deflateRawSync(dados, { level: 9 });
    const usarDeflate = comprimido.length < dados.length;
    const corpo = usarDeflate ? comprimido : dados;
    const crc = crc32(dados) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(usarDeflate ? 8 : 0, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nome, corpo);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(usarDeflate ? 8 : 0, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(corpo.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);
    deslocamento += 30 + nome.length + corpo.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return new Uint8Array(Buffer.concat([...locais, diretorio, fim]));
}

/** O projeto inteiro (menos o que fica fora) num zip, com a pasta raiz com o nome do projeto. */
export function ziparProjeto(pasta: string, raiz: string): Uint8Array {
  return zipar(arquivosDoProjeto(pasta).map((c) => ({ nome: `${raiz}/${relative(pasta, c)}`, bytes: readFileSync(c) })));
}
