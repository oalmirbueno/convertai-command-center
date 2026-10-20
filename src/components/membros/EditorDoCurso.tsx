import { AjudaRecolhida } from "@/components/sistema";
import { useState, type FormEvent, type ReactNode } from "react";
import { Plus, ArrowUp, ArrowDown, Layers, FileText } from "lucide-react";
import {
  enviarMaterial,
  salvarLinha,
  type DadosAdmin,
} from "@/lib/membros/api";
import { ordenar } from "@/lib/membros/aprendizado";
import type { Material, Modulo } from "@/lib/membros/modelo";
import { versionarConteudo } from "@/lib/membros/editorial";
import VersoesDoConteudo from "./VersoesDoConteudo";
const campo =
  "w-full min-h-11 rounded-lg bg-muted px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
function Campo({ nome, children }: { nome: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 text-[12px] min-w-0">
      <span>{nome}</span>
      {children}
    </label>
  );
}
type Props = {
  dados: DadosAdmin;
  agir: (acao: () => Promise<void>) => Promise<void>;
};
export default function EditorDoCurso({ dados, agir }: Props) {
  const [produto, setProduto] = useState(dados.produtos[0]?.id || "");
  const [selecao, setSelecao] = useState("");
  const [tipo, setTipo] = useState<"material" | "modulo">("material");
  const materiais = dados.materiais.filter((m) => m.produto_id === produto);
  const modulos = (dados.modulos || []).filter((m) => m.produto_id === produto);
  function novo(t: "material" | "modulo") {
    setTipo(t);
    setSelecao("");
  }
  async function mover(
    id: string,
    direcao: number,
    t: "modulos" | "materiais",
  ) {
    const ids = (t === "modulos" ? modulos : materiais).map((m) => m.id);
    const i = ids.indexOf(id),
      j = i + direcao;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await ordenar(produto, ids, t);
  }
  return (
    <section className="space-y-5" aria-label="Organizar curso">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="min-w-0 flex-1 max-w-md">
          <Campo nome="Curso ou produto">
            <select
              className={campo}
              value={produto}
              onChange={(e) => {
                setProduto(e.target.value);
                setSelecao("");
              }}
            >
              <option value="">Escolha um produto</option>
              {dados.produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.titulo}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <button
          className="membros-acao border border-border"
          disabled={!produto}
          onClick={() => novo("modulo")}
        >
          <Layers size={16} />
          Novo módulo
        </button>
        <button
          className="membros-acao bg-primary text-primary-foreground"
          disabled={!produto}
          onClick={() => novo("material")}
        >
          <Plus size={16} />
          Nova aula ou material
        </button>
      </div>
      {produto && (
        <div className="membros-editor-curso">
          <nav className="membros-editor-lista" aria-label="Estrutura do curso">
            <h2 className="text-[14px] font-semibold mb-3">
              Módulos e conteúdo
            </h2>
            {modulos.map((m, i) => (
              <div key={m.id} className="membros-editor-item">
                <button
                  className="membros-acao text-left flex-1 min-w-0"
                  aria-current={selecao === m.id ? "page" : undefined}
                  onClick={() => {
                    setTipo("modulo");
                    setSelecao(m.id);
                  }}
                >
                  <Layers size={15} className="shrink-0" />
                  <span className="break-words">
                    {m.titulo}
                    <small className="block text-muted-foreground">
                      {m.estado}
                    </small>
                  </span>
                </button>
                <div className="flex">
                  <button
                    className="membros-acao"
                    aria-label={`Subir módulo ${m.titulo}`}
                    disabled={i === 0}
                    onClick={() => void agir(() => mover(m.id, -1, "modulos"))}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="membros-acao"
                    aria-label={`Descer módulo ${m.titulo}`}
                    disabled={i === modulos.length - 1}
                    onClick={() => void agir(() => mover(m.id, 1, "modulos"))}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              </div>
            ))}
            {materiais.map((m, i) => (
              <div key={m.id} className="membros-editor-item">
                <button
                  className="membros-acao text-left flex-1 min-w-0"
                  aria-current={selecao === m.id ? "page" : undefined}
                  onClick={() => {
                    setTipo("material");
                    setSelecao(m.id);
                  }}
                >
                  <FileText size={15} className="shrink-0" />
                  <span className="break-words">
                    {m.aula_id ? "↳ " : ""}
                    {m.titulo}
                    <small className="block text-muted-foreground">
                      {modulos.find((g) => g.id === m.modulo_id)?.titulo ||
                        "Sem módulo"}{" "}
                      · {m.estado || "publicado"}
                    </small>
                  </span>
                </button>
                <div className="flex">
                  <button
                    className="membros-acao"
                    aria-label={`Subir ${m.titulo}`}
                    disabled={i === 0}
                    onClick={() =>
                      void agir(() => mover(m.id, -1, "materiais"))
                    }
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="membros-acao"
                    aria-label={`Descer ${m.titulo}`}
                    disabled={i === materiais.length - 1}
                    onClick={() => void agir(() => mover(m.id, 1, "materiais"))}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              </div>
            ))}
            {!materiais.length && !modulos.length && (
              <p className="text-[13px] text-muted-foreground">
                Comece com um módulo ou uma aula.
              </p>
            )}
          </nav>
          <div className="membros-editor-formulario">
            {tipo === "modulo" ? (
              <FormModulo
                key={`${produto}-${selecao}`}
                produto={produto}
                modulo={modulos.find((m) => m.id === selecao)}
                ordem={modulos.length}
                agir={agir}
              />
            ) : (
              <FormMaterial
                key={`${produto}-${selecao}`}
                produto={produto}
                material={materiais.find((m) => m.id === selecao)}
                materiais={materiais}
                modulos={modulos}
                agir={agir}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
function FormModulo({
  produto,
  modulo,
  ordem,
  agir,
}: {
  produto: string;
  modulo?: Modulo;
  ordem: number;
  agir: Props["agir"];
}) {
  const [v, setV] = useState({
    id: modulo?.id || crypto.randomUUID(),
    titulo: modulo?.titulo || "",
    descricao: modulo?.descricao || "",
    estado: modulo?.estado || "rascunho",
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void agir(() =>
          salvarLinha("membros_modulos", {
            ...v,
            produto_id: produto,
            ordem: modulo?.ordem ?? ordem,
          }),
        );
      }}
    >
      <h2 className="text-[17px] font-semibold">
        {modulo ? "Editar módulo" : "Novo módulo"}
      </h2>
      <Campo nome="Nome do módulo">
        <input
          required
          maxLength={180}
          className={campo}
          value={v.titulo}
          onChange={(e) => setV({ ...v, titulo: e.target.value })}
        />
      </Campo>
      <Campo nome="Descrição">
        <textarea
          className={campo}
          maxLength={4000}
          value={v.descricao}
          onChange={(e) => setV({ ...v, descricao: e.target.value })}
        />
      </Campo>
      <Campo nome="Visibilidade">
        <select
          className={campo}
          value={v.estado}
          onChange={(e) =>
            setV({ ...v, estado: e.target.value as typeof v.estado })
          }
        >
          <option value="rascunho">Rascunho</option>
          <option value="publicado">Publicado</option>
          <option value="arquivado">Arquivado</option>
        </select>
      </Campo>
      <AjudaRecolhida rotulo="Mais informações">
        As aulas e os complementos de um módulo em rascunho ou arquivado ficam
        ocultos para membros.
      </AjudaRecolhida>
      <button className="membros-acao bg-primary text-primary-foreground">
        Salvar módulo
      </button>
    </form>
  );
}
function FormMaterial({
  produto,
  material,
  materiais,
  modulos,
  agir,
}: {
  produto: string;
  material?: Material;
  materiais: Material[];
  modulos: Modulo[];
  agir: Props["agir"];
}) {
  const [v, setV] = useState({
    id: material?.id || crypto.randomUUID(),
    titulo: material?.titulo || "",
    tipo: material?.tipo || "video",
    texto: material?.texto || "",
    permite_download: material?.permite_download || false,
    modulo_id: material?.modulo_id || "",
    aula_id: material?.aula_id || "",
    estado: material?.estado || "rascunho",
  });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const pais = materiais.filter(
    (m) =>
      m.id !== v.id &&
      !m.aula_id &&
      ["video", "audio", "texto"].includes(m.tipo),
  );
  async function salvar(e: FormEvent) {
    e.preventDefault();
    await agir(async () => {
      if (v.tipo !== "texto" && !arquivo && !material?.arquivo)
        throw Error("Escolha um arquivo para esta aula ou material.");
      const caminho =
        v.tipo === "texto"
          ? null
          : arquivo
            ? await enviarMaterial(produto, v.id, arquivo)
            : material?.arquivo;
      const revisao = {
        ...v,
        produto_id: produto,
        modulo_id: v.modulo_id || null,
        aula_id: v.aula_id || null,
        arquivo: caminho,
        ordem: material?.ordem ?? materiais.length,
      };
      if (!material)
        await salvarLinha("membros_materiais", {
          ...revisao,
          estado: "rascunho",
        });
      await versionarConteudo(v.id, "rascunhar", revisao);
    });
  }
  return (
    <>
      <form onSubmit={(e) => void salvar(e)} className="space-y-4">
        <h2 className="text-[17px] font-semibold">
          {material ? "Editar aula ou material" : "Nova aula ou material"}
        </h2>
        <Campo nome="Título">
          <input
            required
            maxLength={180}
            className={campo}
            value={v.titulo}
            onChange={(e) => setV({ ...v, titulo: e.target.value })}
          />
        </Campo>
        <div className="grid sm:grid-cols-2 gap-4">
          <Campo nome="Tipo de conteúdo">
            <select
              className={campo}
              value={v.tipo}
              onChange={(e) =>
                setV({ ...v, tipo: e.target.value as typeof v.tipo })
              }
            >
              <option value="video">Vídeo</option>
              <option value="audio">Áudio</option>
              <option value="texto">Texto ou guia</option>
              <option value="pdf">PDF</option>
              <option value="arquivo">Arquivo ou kit</option>
            </select>
          </Campo>
          <Campo nome="Visibilidade">
            <select
              className={campo}
              value={v.estado}
              onChange={(e) =>
                setV({ ...v, estado: e.target.value as typeof v.estado })
              }
            >
              <option value="rascunho">Rascunho</option>
              <option value="publicado">Publicado</option>
              <option value="arquivado">Arquivado</option>
            </select>
          </Campo>
          <Campo nome="Módulo">
            <select
              className={campo}
              value={v.modulo_id}
              onChange={(e) => setV({ ...v, modulo_id: e.target.value })}
            >
              <option value="">Sem módulo</option>
              {modulos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.titulo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo nome="Complemento de uma aula">
            <select
              className={campo}
              value={v.aula_id}
              onChange={(e) => {
                const pai = pais.find((m) => m.id === e.target.value);
                setV({
                  ...v,
                  aula_id: e.target.value,
                  modulo_id: pai?.modulo_id || v.modulo_id,
                });
              }}
            >
              <option value="">Conteúdo independente</option>
              {pais.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.titulo}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <Campo
          nome={
            v.tipo === "texto"
              ? "Conteúdo do guia"
              : "Descrição e orientações da aula"
          }
        >
          <textarea
            className={`${campo} min-h-40`}
            maxLength={50000}
            required={v.tipo === "texto"}
            value={v.texto}
            onChange={(e) => setV({ ...v, texto: e.target.value })}
          />
        </Campo>
        {v.tipo !== "texto" && (
          <Campo
            nome={
              material?.arquivo ? "Substituir arquivo (opcional)" : "Arquivo"
            }
          >
            <input
              className={campo}
              type="file"
              required={!material?.arquivo}
              accept={
                v.tipo === "video"
                  ? "video/mp4,video/webm"
                  : v.tipo === "audio"
                    ? "audio/*"
                    : v.tipo === "pdf"
                      ? "application/pdf"
                      : undefined
              }
              onChange={(e) => setArquivo(e.target.files?.[0] || null)}
            />
            {material?.arquivo && (
              <small className="block text-muted-foreground break-all">
                Atual: {material.arquivo.split("/").at(-1)}
              </small>
            )}
          </Campo>
        )}
        <label className="flex gap-2 items-center min-h-11 text-[13px]">
          <input
            type="checkbox"
            checked={v.permite_download}
            onChange={(e) => setV({ ...v, permite_download: e.target.checked })}
          />
          Permitir baixar este arquivo
        </label>
        <button className="membros-acao bg-primary text-primary-foreground">
          Salvar nova versão
        </button>
      </form>
      <VersoesDoConteudo material={v.id} agir={agir} />
    </>
  );
}
