create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  player_id text unique not null,
  wallet text unique,
  name text unique not null,
  wins integer default 0,
  losses integer default 0,
  current_streak integer default 0,
  best_streak integer default 0,
  total_won bigint default 0,
  xp integer default 0,
  level integer default 1,
  achievements text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists rooms (
  id text primary key,
  wager bigint not null,
  status text not null default 'waiting',
  creator text not null,
  joiner text,
  creator_choice text,
  joiner_choice text,
  creator_assigned text,
  joiner_assigned text,
  winner text,
  result text,
  demo boolean default false,
  created_at timestamptz default now()
);

create table if not exists matches (
  id text primary key,
  winner text not null,
  loser text,
  prize bigint not null,
  result text not null,
  demo boolean default false,
  created_at timestamptz default now()
);

create table if not exists messages (
  id bigint primary key,
  wallet text not null,
  message text not null,
  created_at timestamptz default now()
);

alter table players enable row level security;
alter table rooms enable row level security;
alter table matches enable row level security;
alter table messages enable row level security;

create policy "players read all" on players for select using (true);
create policy "players insert all" on players for insert with check (true);
create policy "players update all" on players for update using (true);

create policy "rooms read all" on rooms for select using (true);
create policy "rooms insert all" on rooms for insert with check (true);
create policy "rooms update all" on rooms for update using (true);

create policy "matches read all" on matches for select using (true);
create policy "matches insert all" on matches for insert with check (true);

create policy "messages read all" on messages for select using (true);
create policy "messages insert all" on messages for insert with check (true);
