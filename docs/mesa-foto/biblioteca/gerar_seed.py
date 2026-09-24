# -*- coding: utf-8 -*-
"""Gera seed.sql a partir de biblioteca.json (frente D, Mesa Foto).

Uso: python -B gerar_seed.py
Não aplica nada no banco: só escreve o arquivo seed.sql ao lado deste script.
"""
import json
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
ORIGEM = os.path.join(AQUI, "biblioteca.json")
DESTINO = os.path.join(AQUI, "seed.sql")
TAG = "$bib$"
COLUNAS = [
    ("titulo", "text"), ("categoria", "text"), ("prompt_pt", "text"), ("prompt_en", "text"),
    ("negativo", "text"), ("tags", "text[]"), ("fonte_nome", "text"), ("fonte_url", "text"),
    ("licenca", "text"), ("uso", "text"), ("destaque", "boolean"),
]
CATEGORIAS = {"produto", "alimento", "bebida", "cosmetico", "moda", "tecnologia",
              "pessoa", "ambiente", "estilo", "composicao", "luz"}


def main():
    with open(ORIGEM, encoding="utf-8") as f:
        doc = json.load(f)
    itens = doc["itens"]
    titulos = set()
    linhas = []
    for x in itens:
        assert x["categoria"] in CATEGORIAS, x["categoria"]
        assert x["titulo"] not in titulos, "titulo repetido: " + x["titulo"]
        titulos.add(x["titulo"])
        assert isinstance(x["tags"], list) and all(isinstance(t, str) for t in x["tags"])
        registro = {c: x.get(c) for c, _ in COLUNAS}
        registro["destaque"] = bool(x.get("destaque"))
        texto = json.dumps(registro, ensure_ascii=False)
        # O dollar-quote não pode aparecer dentro do conteúdo.
        assert TAG not in texto, x["titulo"]
        assert chr(0x2014) not in texto and chr(0x2013) not in texto, "travessão em " + x["titulo"]
        linhas.append(texto)
    destaques = sum(1 for x in itens if x.get("destaque"))
    json_sql = "[\n" + ",\n".join(linhas) + "\n]"
    cols = ",\n  ".join(f"{c} {t}" for c, t in COLUNAS)
    por_cat = {}
    for x in itens:
        por_cat[x["categoria"]] = por_cat.get(x["categoria"], 0) + 1
    resumo = ", ".join(f"{k} {v}" for k, v in sorted(por_cat.items()))

    sql = f"""-- Mesa Foto: semente da biblioteca de prompts da agência (frente D).
-- GERADO por docs/mesa-foto/biblioteca/gerar_seed.py a partir de biblioteca.json. Não editar à mão.
-- {len(itens)} prompts ({resumo}); {destaques} com destaque.
-- Idempotente: só insere o que ainda não existe com o mesmo titulo + tipo 'prompt' + client_id nulo.
-- Pré-requisito: tabela public.foto_biblioteca criada pela frente A.
-- A coluna opcional uso (text) é preenchida se existir; sem ela o bloco final não faz nada.

begin;

create temp table _foto_biblioteca_semente on commit drop as
select *
from jsonb_to_recordset({TAG}{json_sql}{TAG}::jsonb) as x(
  {cols}
);

insert into public.foto_biblioteca
  (client_id, tipo, categoria, titulo, prompt_pt, prompt_en, negativo,
   fonte_nome, fonte_url, licenca, autor, tags, destaque)
select
  null, 'prompt', s.categoria, s.titulo, s.prompt_pt, s.prompt_en, nullif(s.negativo, ''),
  s.fonte_nome, s.fonte_url, s.licenca, 'Aceleriq (curadoria)', coalesce(s.tags, '{{}}'::text[]),
  coalesce(s.destaque, false)
from _foto_biblioteca_semente s
where not exists (
  select 1
  from public.foto_biblioteca b
  where b.titulo = s.titulo
    and b.tipo = 'prompt'
    and b.client_id is null
);

do $uso$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'foto_biblioteca' and column_name = 'uso'
  ) then
    execute $upd$
      update public.foto_biblioteca b
         set uso = s.uso
        from _foto_biblioteca_semente s
       where b.titulo = s.titulo
         and b.tipo = 'prompt'
         and b.client_id is null
         and b.uso is null
    $upd$;
  end if;
end
$uso$;

commit;

-- Conferência (rodar depois):
-- select categoria, count(*), count(*) filter (where destaque) as destaques
--   from public.foto_biblioteca where tipo = 'prompt' and client_id is null group by 1 order by 1;
"""
    with open(DESTINO, "w", encoding="utf-8", newline="\n") as f:
        f.write(sql)
    print(f"seed.sql: {len(itens)} itens, {destaques} destaques, {os.path.getsize(DESTINO)} bytes")


if __name__ == "__main__":
    main()
