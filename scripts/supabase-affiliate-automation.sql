create extension if not exists pgcrypto;

create table if not exists public.affiliate_automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  telegram_source_group_id text not null,
  telegram_source_group_name text,
  unknown_link_behavior text not null default 'keep',
  custom_footer text,
  remove_original_footer boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_automations_unknown_link_behavior_check
    check (unknown_link_behavior in ('keep', 'remove', 'ignore_message'))
);

create table if not exists public.affiliate_automation_destinations (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.affiliate_automations(id) on delete cascade,
  whatsapp_group_id text not null,
  whatsapp_group_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amazon_tag text,
  shopee_affiliate_id text,
  shopee_app_id text,
  shopee_secret text,
  default_sub_id text,
  amazon_enabled boolean not null default false,
  shopee_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_accounts_user_unique unique (user_id)
);

create table if not exists public.affiliate_messages_log (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references public.affiliate_automations(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  telegram_message_id text,
  original_message text not null,
  processed_message text,
  original_urls jsonb,
  converted_urls jsonb,
  status text not null,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint affiliate_messages_log_status_check
    check (status in ('received', 'processing', 'converted', 'ignored', 'sent', 'error'))
);

create table if not exists public.affiliate_conversion_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  automation_id uuid references public.affiliate_automations(id) on delete set null,
  marketplace text not null,
  original_url text not null,
  expanded_url text,
  affiliate_url text,
  status text not null,
  error_message text,
  created_at timestamptz not null default now(),
  constraint affiliate_conversion_logs_marketplace_check
    check (marketplace in ('amazon', 'shopee', 'unknown')),
  constraint affiliate_conversion_logs_status_check
    check (status in ('converted', 'ignored', 'error'))
);

create table if not exists public.affiliate_terms_acceptance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  terms_version text not null
);

create index if not exists idx_affiliate_automations_user_id
  on public.affiliate_automations(user_id);
create index if not exists idx_affiliate_automations_telegram_source_group_id
  on public.affiliate_automations(telegram_source_group_id);
create index if not exists idx_affiliate_automation_destinations_automation_id
  on public.affiliate_automation_destinations(automation_id);
create index if not exists idx_affiliate_accounts_user_id
  on public.affiliate_accounts(user_id);
create index if not exists idx_affiliate_messages_log_automation_id
  on public.affiliate_messages_log(automation_id);
create index if not exists idx_affiliate_messages_log_user_id
  on public.affiliate_messages_log(user_id);
create index if not exists idx_affiliate_conversion_logs_user_id
  on public.affiliate_conversion_logs(user_id);
create index if not exists idx_affiliate_conversion_logs_marketplace
  on public.affiliate_conversion_logs(marketplace);

