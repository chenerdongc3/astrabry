create type public.platform_enum as enum ('tiktok', 'instagram', 'twitter', 'xiaohongshu');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.managed_accounts (
  id text primary key,
  owner_id text not null,
  platform public.platform_enum not null,
  handle text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint uq_owner_platform_handle unique (owner_id, platform, handle)
);

create index ix_managed_accounts_owner_id
  on public.managed_accounts (owner_id);

create table public.account_credentials (
  id text primary key,
  account_id text not null references public.managed_accounts (id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  expires_at timestamptz not null,
  scopes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ck_token_expiry check (expires_at > created_at)
);

create unique index ux_account_credentials_account_id
  on public.account_credentials (account_id);

create table public.agent_sessions (
  id text primary key,
  account_id text not null references public.managed_accounts (id) on delete cascade,
  jwt text not null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default timezone('utc', now())
);

create index ix_agent_sessions_account_id
  on public.agent_sessions (account_id);

create index ix_agent_sessions_expires_at
  on public.agent_sessions (expires_at);

create table public.xhs_accounts (
  id text primary key,
  name text not null,
  xhs_id text not null,
  platform text not null default 'xiaohongshu',
  avatar text not null,
  post_count integer not null default 0 check (post_count >= 0),
  profile_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index ix_xhs_accounts_xhs_id
  on public.xhs_accounts (xhs_id);

create table public.xhs_notes (
  id text primary key,
  account_id text not null references public.xhs_accounts (id) on delete cascade,
  url text,
  title text not null,
  content text not null,
  likes integer not null default 0 check (likes >= 0),
  shares integer not null default 0 check (shares >= 0),
  comments integer not null default 0 check (comments >= 0),
  collects integer not null default 0 check (collects >= 0),
  views integer not null default 0 check (views >= 0),
  growth_rate double precision not null default 0,
  status text not null default 'low' check (status in ('viral', 'normal', 'low')),
  timestamp timestamptz not null default timezone('utc', now()),
  history jsonb not null default '[]'::jsonb,
  seo_keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index ix_xhs_notes_account_id
  on public.xhs_notes (account_id);

create index ix_xhs_notes_account_timestamp
  on public.xhs_notes (account_id, "timestamp" desc);

create trigger trg_xhs_accounts_set_updated_at
before update on public.xhs_accounts
for each row
execute function public.set_updated_at();

create trigger trg_xhs_notes_set_updated_at
before update on public.xhs_notes
for each row
execute function public.set_updated_at();
