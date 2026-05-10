create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null default '',
  role text not null default 'member',
  plan text not null default 'beta',
  account_status text not null default 'active',
  billing_status text not null default 'beta',
  password_hash text,
  google_id text unique,
  auth_provider text not null default 'email',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.users
  add column if not exists billing_status text not null default 'beta',
  add column if not exists last_login_at timestamptz;

create table if not exists public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  avatar_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_workspaces (
  user_id uuid primary key references public.users(id) on delete cascade,
  telegram_source_id text,
  selected_group_count integer not null default 0,
  selected_groups jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_email
  on public.users(email);
create index if not exists idx_users_google_id
  on public.users(google_id);
