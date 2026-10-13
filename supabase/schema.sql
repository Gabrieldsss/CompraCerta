-- CompraCerta — esquema do banco no Supabase (PostgreSQL)
--
-- Como usar: Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
-- Pode ser executado de novo sem apagar dados.
--
-- Modelo: cada aparelho entra como usuário anônimo
-- (Authentication → Sign In / Providers → "Allow anonymous sign-ins" ligado).
-- As regras RLS garantem que cada usuário só lê e grava os próprios dados.
-- Compras finalizadas só podem ser inseridas e lidas: não há UPDATE nem DELETE (histórico imutável).
-- Os IDs são gerados no aparelho (texto), para o app funcionar offline e sincronizar depois.

-- ---------------------------------------------------------------- Tabelas

create table if not exists public.produtos (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id            text not null check (char_length(id) between 1 and 64),
  nome          text not null check (char_length(nome) between 1 and 80),
  unidade       text not null default '' check (char_length(unidade) <= 10),
  categoria     text not null default 'Outros' check (char_length(categoria) <= 30),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.compras (
  user_id                    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id                         text not null check (char_length(id) between 1 and 64),
  nome                       text not null default '' check (char_length(nome) <= 80),
  criada_em                  timestamptz,
  finalizada_em              timestamptz not null,
  total_real_centavos        bigint not null check (total_real_centavos >= 0),
  total_estimado_centavos    bigint check (total_estimado_centavos >= 0),
  quantidade_itens           integer not null check (quantidade_itens > 0),
  quantidade_itens_pegos     integer not null check (quantidade_itens_pegos >= 0),
  quantidade_itens_sem_preco integer not null check (quantidade_itens_sem_preco >= 0),
  possui_itens_sem_preco     boolean not null,
  recebida_em                timestamptz not null default now(),
  primary key (user_id, id)
);

-- Cópia dos itens no momento da compra (não muda se o catálogo mudar).
create table if not exists public.compra_itens (
  user_id                   uuid not null,
  compra_id                 text not null,
  posicao                   integer not null check (posicao >= 0),
  produto_id                text not null,
  nome_produto              text not null check (char_length(nome_produto) between 1 and 80),
  unidade                   text not null default '',
  categoria                 text not null default 'Outros',
  quantidade                numeric(10, 3) not null check (quantidade > 0),
  preco_unitario_centavos   bigint check (preco_unitario_centavos >= 0), -- nulo = preço não informado
  subtotal_centavos         bigint check (subtotal_centavos >= 0),
  pego                      boolean not null default false,
  preco_referencia_centavos bigint check (preco_referencia_centavos >= 0),
  data_preco_referencia     timestamptz,
  primary key (user_id, compra_id, posicao),
  foreign key (user_id, compra_id) references public.compras (user_id, id) on delete cascade
);

create index if not exists compra_itens_produto_idx on public.compra_itens (user_id, produto_id);

-- Lista atual (rascunho) e preferências: uma linha por usuário.
create table if not exists public.listas_atuais (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  lista         jsonb not null,
  preferencias  jsonb not null default '{}'::jsonb,
  atualizada_em timestamptz not null default now(),
  constraint lista_tamanho check (octet_length(lista::text) < 500000)
);

-- ---------------------------------------------------------------- Segurança (RLS)

alter table public.produtos      enable row level security;
alter table public.compras       enable row level security;
alter table public.compra_itens  enable row level security;
alter table public.listas_atuais enable row level security;

-- Sem login (papel "anon") não há acesso a nada.
revoke all on public.produtos, public.compras, public.compra_itens, public.listas_atuais from anon;
-- Histórico imutável também no nível de permissão.
revoke update, delete on public.compras, public.compra_itens from authenticated;

drop policy if exists produtos_do_usuario on public.produtos;
create policy produtos_do_usuario on public.produtos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists compras_ler on public.compras;
create policy compras_ler on public.compras
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists compras_inserir on public.compras;
create policy compras_inserir on public.compras
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists compra_itens_ler on public.compra_itens;
create policy compra_itens_ler on public.compra_itens
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists compra_itens_inserir on public.compra_itens;
create policy compra_itens_inserir on public.compra_itens
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists lista_do_usuario on public.listas_atuais;
create policy lista_do_usuario on public.listas_atuais
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- Registrar compra

-- Grava cabeçalho e itens juntos (tudo ou nada). Chamar de novo com a mesma
-- compra não duplica nada: útil quando o envio é repetido depois de ficar offline.
create or replace function public.registrar_compra(p_compra jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.';
  end if;
  if jsonb_typeof(p_compra -> 'itens') <> 'array' or jsonb_array_length(p_compra -> 'itens') = 0 then
    raise exception 'Compra sem itens.';
  end if;

  insert into public.compras (
    user_id, id, nome, criada_em, finalizada_em, total_real_centavos, total_estimado_centavos,
    quantidade_itens, quantidade_itens_pegos, quantidade_itens_sem_preco, possui_itens_sem_preco)
  values (
    v_uid,
    p_compra ->> 'id',
    coalesce(p_compra ->> 'nome', ''),
    (p_compra ->> 'criadaEm')::timestamptz,
    (p_compra ->> 'finalizadaEm')::timestamptz,
    (p_compra ->> 'totalRealCentavos')::bigint,
    (p_compra ->> 'totalEstimadoCentavos')::bigint,
    (p_compra ->> 'quantidadeItens')::integer,
    (p_compra ->> 'quantidadeItensPegos')::integer,
    coalesce((p_compra ->> 'quantidadeItensSemPreco')::integer, 0),
    coalesce((p_compra ->> 'possuiItensSemPreco')::boolean, false))
  on conflict (user_id, id) do nothing;

  if not found then
    return false; -- já estava registrada
  end if;

  insert into public.compra_itens (
    user_id, compra_id, posicao, produto_id, nome_produto, unidade, categoria, quantidade,
    preco_unitario_centavos, subtotal_centavos, pego, preco_referencia_centavos, data_preco_referencia)
  select
    v_uid,
    p_compra ->> 'id',
    (i.ordem - 1)::integer,
    i.item ->> 'produtoId',
    i.item ->> 'nomeProdutoSnapshot',
    coalesce(i.item ->> 'unidade', ''),
    coalesce(i.item ->> 'categoria', 'Outros'),
    (i.item ->> 'quantidade')::numeric,
    (i.item ->> 'precoUnitarioRealCentavos')::bigint,
    (i.item ->> 'subtotalCentavos')::bigint,
    coalesce((i.item ->> 'pego')::boolean, false),
    (i.item ->> 'precoReferenciaCentavos')::bigint,
    (i.item ->> 'dataPrecoReferencia')::timestamptz
  from jsonb_array_elements(p_compra -> 'itens') with ordinality as i (item, ordem);

  return true;
end;
$$;

revoke execute on function public.registrar_compra(jsonb) from public, anon;
grant execute on function public.registrar_compra(jsonb) to authenticated;

-- ---------------------------------------------------------------- Conferência
-- O resultado deve listar as 4 tabelas, todas com rls_ligado = true.
select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('produtos', 'compras', 'compra_itens', 'listas_atuais')
order by 1;
