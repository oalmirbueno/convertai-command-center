/**
 * Um trabalho do motor do começo ao fim (construir, ajustar, desfazer,
 * revisar, publicar, zip). Tudo o que a tela vê sai daqui como evento
 * resumido (no máximo 1 por segundo) e como campos do trabalho (estado,
 * custo, prévia, commit, zip, resultado).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { criarLimitador, type EventoResumido, type ModeloDoMotor } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { type PacoteDoSite, promptDaSecao, revisarHtml, rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo.ts";
import { criarApiDaVercel, garantirProjeto as garantirProjetoVercel, ligarDominio, publicarArquivos, vercelLigada } from "../../../supabase/functions/_shared/publicacao-vercel.ts";
import type { Fila, LinhaDaFila } from "./fila.ts";
import { arquivosMudados, atualizarCasca, commitar, commitAtual, construirSite, escreverPacote, garantirProjeto, instalarSePrecisar, pastaDoProjeto, voltarCommits } from "./projeto.ts";
import { garantirPrevia } from "./previa.ts";
import { rodarPassada, subirOpencode } from "./opencode.ts";
import { abrirMedidor, type Medidor } from "./medidor.ts";
import { ziparProjeto } from "./zip.ts";

/** A primeira linha útil do erro de build, sem as cores do terminal. */
export function resumoDoBuild(log: string): string {
  const limpo = String(log || "").replace(/\u001b\[[0-9;]*m/g, "");
  const linhas = limpo.split("\n").map((l) => l.trim());
  const linha = linhas.find((l) => /\[[A-Z_]+\]|is not exported|Cannot find|Error:/.test(l) && !/^at /.test(l) && !/^error during build/i.test(l) && !/^Build failed with/i.test(l));
  return (linha || "build falhou").replace(/[\u2500-\u257f]/g, "").slice(0, 200);
}

export type ConfigDoWorker = { pastaProjetos: string; prazoPorPassadaMs: number; comPrevia: boolean };

type Estado = { custo: number; tabela: number; tokensEntrada: number; tokensSaida: number; tokensCache: number };

export async function executarTrabalho(t: LinhaDaFila, fila: Fila, cfg: ConfigDoWorker): Promise<{ estado: string; custo: number }> {
  const limitador = criarLimitador();
  const soltar = async () => {
    const ev = limitador.soltar(Date.now());
    if (ev) await fila.evento(t, ev);
  };
  const relogio = setInterval(() => void soltar(), 1000);
  const avisar = async (ev: EventoResumido) => {
    limitador.adicionar(ev);
    await soltar();
  };
  const gasto: Estado = { custo: 0, tabela: 0, tokensEntrada: 0, tokensSaida: 0, tokensCache: 0 };
  let medidor: Medidor | null = null;
  const pedido = t.pedido || {};
  const pacote = (pedido.pacote || {}) as Record<string, unknown>;
  const modelo = (pedido.modelo || null) as ModeloDoMotor | null;
  const pasta = pastaDoProjeto(cfg.pastaProjetos, t.projeto);
  const resultado: Record<string, unknown> = {};
  let estadoFinal = "feito";
  let erro: string | null = null;
  const deveParar = async () => (await fila.estado(t.id)) === "parando";
  let commitInicial: string | null = null;

  try {
    await avisar({ tipo: "estado", resumo: "O motor pegou o trabalho" });
    const novo = await garantirProjeto(pasta);
    if (novo) await avisar({ tipo: "passo", resumo: "Projeto criado do modelo da casa" });
    // SIT2: casca da casa mais nova (multipágina, integrações, SEO) entra antes do trabalho, num commit próprio.
    if (t.tipo !== "zip" && t.tipo !== "desfazer") {
      const casca = await atualizarCasca(pasta);
      if (casca) await avisar({ tipo: "passo", resumo: `Casca da casa atualizada (v${casca})` });
    }
    const anterior = await commitAtual(pasta);
    commitInicial = anterior;
    await fila.atualizar(t.id, { commit_anterior: anterior });

    if (t.tipo === "desfazer") {
      const alvo = (pedido.alvo || {}) as { commit?: string | null; commit_anterior?: string | null; voltar_para?: boolean };
      if (alvo.voltar_para) {
        // Voltar para a versão: reverte tudo o que veio depois do commit do trabalho escolhido.
        if (!alvo.commit_anterior) throw new Error("a versão escolhida não tem commit");
        if (anterior.indexOf(alvo.commit_anterior) === 0 || alvo.commit_anterior.indexOf(anterior) === 0) {
          await avisar({ tipo: "passo", resumo: "O código já está nesta versão" });
        } else {
          const c = await voltarCommits(pasta, alvo.commit_anterior, anterior);
          await avisar({ tipo: "commit", resumo: c.novo ? `Voltou para a versão ${alvo.commit_anterior.slice(0, 8)} (commit ${c.commit.slice(0, 8)})` : "Nada a voltar", dados: { commit: c.commit } });
          await fila.atualizar(t.id, { commit: c.commit });
        }
      } else {
        if (!alvo.commit || !alvo.commit_anterior) throw new Error("o trabalho a desfazer não tem commit");
        const c = await voltarCommits(pasta, alvo.commit_anterior, alvo.commit);
        await avisar({ tipo: "commit", resumo: c.novo ? `Desfeito (commit ${c.commit.slice(0, 8)})` : "Nada a desfazer", dados: { commit: c.commit } });
        await fila.atualizar(t.id, { commit: c.commit });
      }
    }

    if (t.tipo === "construir" || t.tipo === "ajustar") {
      if (!modelo) throw new Error("trabalho sem modelo");
      const avisos = await escreverPacote(pasta, pacote, fila);
      for (const a of avisos) await avisar({ tipo: "aviso", resumo: a });
      const base = await commitar(pasta, "Pacote do cliente");
      if (base.novo) await avisar({ tipo: "commit", resumo: "Pacote do cliente no projeto", dados: { commit: base.commit } });
      if (await instalarSePrecisar(pasta)) await avisar({ tipo: "passo", resumo: "Dependências instaladas" });
      if (cfg.comPrevia) {
        const pv = await garantirPrevia(t.projeto, pasta);
        await fila.atualizar(t.id, { preview_url: pv.url, preview_expira_em: new Date(Date.now() + 60 * 60_000).toISOString() });
        await avisar({ tipo: "previa", resumo: pv.publica ? "Prévia ao vivo aberta" : "Prévia só nesta máquina", dados: { url: pv.url, publica: pv.publica, aviso: pv.aviso } });
      }
      medidor = modelo.provedor === "openrouter" ? await abrirMedidor() : null;
      const servidor = await subirOpencode(pasta, modelo, medidor ? medidor.url : null);
      const custoReal = medidor ? medidor.total : undefined;
      try {
        const passos = t.tipo === "construir" ? ((pedido.secoes as string[]) || []) : [String(pedido.secao || "")];
        const feitas: string[] = [];
        const falhas: Array<{ secao: string; motivo: string }> = [];
        for (const secao of passos) {
          if (await deveParar()) {
            estadoFinal = "parado";
            break;
          }
          await avisar({ tipo: "passo", resumo: `${t.tipo === "construir" ? "Construindo" : "Ajustando"} ${rotuloDaSecao(secao)}` });
          const antesDaSecao = await commitAtual(pasta);
          const texto = promptDaSecao(pacote as unknown as PacoteDoSite, secao, t.tipo === "ajustar" ? t.instrucao : t.instrucao && !/^Construir /.test(t.instrucao) ? t.instrucao : null);
          const r = await rodarPassada(servidor, {
            titulo: `${t.tipo} ${secao}`,
            pedido: texto,
            modelo,
            tetoUsd: t.teto_usd,
            jaGasto: gasto.custo,
            prazoMs: cfg.prazoPorPassadaMs,
            aoEvento: (ev) => limitador.adicionar(ev),
            aoCusto: (total) => limitador.custo(total),
            deveParar,
            custoReal,
          });
          gasto.tabela += r.custo.custo_usd;
          gasto.custo = Math.max(gasto.tabela, medidor ? medidor.total() : 0);
          gasto.tokensEntrada += r.custo.tokens_entrada;
          gasto.tokensSaida += r.custo.tokens_saida;
          gasto.tokensCache += r.custo.tokens_cache;
          await fila.atualizar(t.id, { custo_usd: Math.round(gasto.custo * 1e6) / 1e6 });
          let c = await commitar(pasta, `${t.tipo === "construir" ? "Seção" : "Ajuste"}: ${rotuloDaSecao(secao)}`);
          if (c.novo) {
            // O site tem de continuar construindo. Seção que quebra o build volta (Desfazer do passo),
            // com o motivo à vista; não há laço de correção: a equipe pede de novo.
            const b = await construirSite(pasta);
            if (!b.ok) {
              const motivoDoBuild = resumoDoBuild(b.log);
              c = await voltarCommits(pasta, antesDaSecao, c.commit);
              await avisar({ tipo: "aviso", resumo: `A seção ${rotuloDaSecao(secao)} quebrou o build e foi desfeita: ${motivoDoBuild}` });
              falhas.push({ secao, motivo: motivoDoBuild });
            } else {
              await avisar({ tipo: "commit", resumo: `Commit da seção ${rotuloDaSecao(secao)}`, dados: { commit: c.commit, custo_usd: gasto.custo } });
              feitas.push(secao);
            }
          }
          await fila.atualizar(t.id, { commit: c.commit });
          if (r.motivo === "teto") {
            estadoFinal = "parado";
            await avisar({ tipo: "aviso", resumo: `Parou no teto de US$ ${t.teto_usd.toFixed(2)}` });
            break;
          }
          if (r.motivo === "parado") {
            estadoFinal = "parado";
            break;
          }
          if (r.motivo === "prazo") await avisar({ tipo: "aviso", resumo: `A seção ${rotuloDaSecao(secao)} passou do prazo e foi encerrada` });
          if (r.motivo === "erro") await avisar({ tipo: "erro", resumo: `A seção ${rotuloDaSecao(secao)} falhou: ${r.erro || "sem detalhe"}` });
        }
        resultado.secoes = feitas;
        if (falhas.length) resultado.secoes_desfeitas = falhas;
      } finally {
        servidor.fechar();
        if (medidor) {
          gasto.custo = Math.max(gasto.tabela, medidor.total());
          resultado.custo_real_usd = medidor.total();
          resultado.custo_tabela_usd = Math.round(gasto.tabela * 1e6) / 1e6;
          resultado.chamadas_ao_modelo = medidor.chamadas();
          await medidor.fechar();
        }
      }
    }

    // SIT2: revisar e publicar também levam o pacote novo (SEO e integrações mudam sem passar pelo agente).
    if ((t.tipo === "revisar" || t.tipo === "publicar") && Object.keys(pacote).length) {
      const avisos = await escreverPacote(pasta, pacote, fila);
      for (const a of avisos) await avisar({ tipo: "aviso", resumo: a });
      const base = await commitar(pasta, "Pacote do cliente");
      if (base.novo) await avisar({ tipo: "commit", resumo: "Pacote do cliente no projeto (SEO e integrações)", dados: { commit: base.commit } });
      await fila.atualizar(t.id, { commit: base.commit });
    }

    if (t.tipo === "revisar" || t.tipo === "construir" || t.tipo === "ajustar" || t.tipo === "desfazer" || t.tipo === "publicar") {
      await instalarSePrecisar(pasta);
      const b = await construirSite(pasta);
      if (!b.ok) {
        resultado.build = { ok: false, log: b.log.slice(-1200) };
        await avisar({ tipo: "aviso", resumo: "O build falhou; a revisão não rodou" });
      } else {
        const html = readFileSync(join(pasta, "dist", "index.html"), "utf8");
        const qa = revisarHtml(html);
        resultado.qa = qa;
        resultado.build = { ok: true };
        await avisar({ tipo: "passo", resumo: qa.length ? `Revisão: ${qa.length} aviso(s)` : "Revisão sem avisos" });
      }
      if (t.tipo === "publicar") {
        if (!b.ok) throw new Error("o build falhou; nada foi publicado");
        const publicado = await publicarNaVercel(pasta, t, pacote);
        Object.assign(resultado, publicado);
        if (t.referencia_id) await fila.mesclarPublicacao(t.referencia_id, { projeto_vercel: publicado.projeto_vercel, deploy_url: publicado.deploy_url, publicado_em: new Date().toISOString(), config: null });
        await avisar({ tipo: "passo", resumo: `Publicado: ${publicado.deploy_url}` });
      }
    }

    // Zip do código (cópia de segurança e "Baixar o site") depois de toda mudança.
    if (t.tipo !== "revisar" && t.tipo !== "publicar") {
      const commit = await commitAtual(pasta);
      const bytes = ziparProjeto(pasta, t.projeto);
      const caminho = `${t.client_id}/site/${t.referencia_id || t.projeto}/codigo/${t.projeto}-${commit.slice(0, 8)}.zip`;
      await fila.subir("mesa", caminho, bytes, "application/zip");
      await fila.atualizar(t.id, { zip_path: caminho });
      await avisar({ tipo: "passo", resumo: `Código guardado (${Math.max(1, Math.round(bytes.length / 1024))} KB)` });
    }
  } catch (e) {
    estadoFinal = "falhou";
    erro = e instanceof Error ? e.message.slice(0, 500) : "falha no trabalho";
    await avisar({ tipo: "erro", resumo: `Não deu certo: ${erro}`.slice(0, 300) });
  } finally {
    clearInterval(relogio);
  }

  // O custo real vai para a carteira (mesmo se parou ou falhou no meio: o gasto aconteceu).
  let usoId: string | null = null;
  if (gasto.custo > 0 && modelo) {
    try {
      usoId = await fila.registrarUso(t, { modeloId: modelo.id, provedor: modelo.provedor, tokensEntrada: gasto.tokensEntrada, tokensSaida: gasto.tokensSaida, tokensCache: gasto.tokensCache, custoUsd: gasto.custo, fonte: resultado.custo_real_usd ? "provedor" : "tabela" });
    } catch (e) {
      erro = `${erro ? `${erro}; ` : ""}custo não registrado na carteira: ${e instanceof Error ? e.message : "erro"}`.slice(0, 500);
    }
  }
  resultado.tokens = { entrada: gasto.tokensEntrada, saida: gasto.tokensSaida, cache: gasto.tokensCache };
  // SIT2: o que este trabalho mudou no código (comparar versões na tela).
  try {
    const inicio = commitInicial;
    const fim = await commitAtual(pasta);
    if (inicio && fim && inicio !== fim) resultado.arquivos = await arquivosMudados(pasta, inicio, fim);
  } catch (e) {
    resultado.arquivos_erro = e instanceof Error ? e.message.slice(0, 200) : "diff indisponível";
  }
  await fila.atualizar(t.id, {
    estado: estadoFinal,
    custo_usd: Math.round(gasto.custo * 1e6) / 1e6,
    custo_fonte: gasto.custo > 0 ? (resultado.custo_real_usd ? "provedor" : "tabela") : null,
    uso_id: usoId && /^[0-9a-f-]{36}$/.test(usoId) ? usoId : null,
    resultado,
    erro,
    terminado_em: new Date().toISOString(),
  });
  // Evento final direto (fora do limitador): a tela fecha o trabalho com ele.
  await new Promise((r) => setTimeout(r, 1000));
  const sobra = limitador.soltar(Date.now() + 1000);
  if (sobra) await fila.evento(t, sobra);
  // Gancho do documento de entrega (frente DOC): o evento "fim" leva o resumo e as provas do trabalho.
  let commitFinal: string | null = null;
  try {
    commitFinal = await commitAtual(pasta);
  } catch {
    commitFinal = null;
  }
  await fila.evento(t, {
    tipo: "fim",
    resumo: estadoFinal === "feito" ? `Pronto. Custo US$ ${gasto.custo.toFixed(4)}` : estadoFinal === "parado" ? `Parado. Custo até aqui US$ ${gasto.custo.toFixed(4)}` : `Não deu certo. Custo US$ ${gasto.custo.toFixed(4)}`,
    dados: {
      custo_usd: gasto.custo,
      estado: estadoFinal,
      entrega: { tipo: t.tipo, projeto: t.projeto, commit: commitFinal, secoes: resultado.secoes || [], avisos_de_revisao: Array.isArray(resultado.qa) ? (resultado.qa as unknown[]).length : null, build_ok: resultado.build ? (resultado.build as { ok?: boolean }).ok !== false : null, publicado: resultado.deploy_url || null },
    },
  });
  return { estado: estadoFinal, custo: gasto.custo };
}

/** Deploy estático do dist/ na Vercel e o domínio do cliente (só com a chave no ambiente). */
async function publicarNaVercel(pasta: string, t: LinhaDaFila, pacote: Record<string, unknown>) {
  const token = process.env.VERCEL_TOKEN || "";
  if (!vercelLigada(token)) throw new Error("publicação desligada: falta VERCEL_TOKEN no worker");
  const api = criarApiDaVercel({ token, teamId: process.env.VERCEL_TEAM_ID || null, fetch });
  const dist = join(pasta, "dist");
  const arquivos: Array<{ caminho: string; bytes: Uint8Array; sha: string }> = [];
  (function andar(d: string) {
    for (const n of readdirSync(d)) {
      const c = join(d, n);
      if (statSync(c).isDirectory()) andar(c);
      else {
        const bytes = new Uint8Array(readFileSync(c));
        arquivos.push({ caminho: relative(dist, c).split(sep).join("/"), bytes, sha: createHash("sha1").update(bytes).digest("hex") });
      }
    }
  })(dist);
  const projeto = await garantirProjetoVercel(api, t.projeto);
  const deploy = await publicarArquivos(api, projeto, arquivos);
  const dominio = typeof pacote.dominio === "string" ? pacote.dominio : null;
  let verificacao: unknown = null;
  if (dominio) {
    const www = dominio.startsWith("www.") ? null : `www.${dominio}`;
    const d = await ligarDominio(api, projeto.id, dominio, www);
    verificacao = d.verification;
  }
  return { projeto_vercel: projeto.id, deploy_url: deploy.url, deploy_id: deploy.id, dominio, verificacao };
}
