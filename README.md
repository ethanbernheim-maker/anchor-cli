# mybot-notes-cli

A local-first CLI for reading and writing text files stored in a Supabase `public.files` table. Uses email/password auth with RLS so each user only sees their own files.

## Prerequisites

- Node.js >= 18
- A Supabase project with the following table and RLS enabled:

```sql
create table public.files (
  path        text primary key,
  content     text not null default '',
  owner_id    uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS
alter table public.files enable row level security;

create policy "owner access" on public.files
  for all using (owner_id = auth.uid());

-- Auto-update updated_at on every write
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger files_updated_at
  before update on public.files
  for each row execute procedure public.set_updated_at();
```

## Install

```bash
npm install
npm link        # makes `mybot` available globally on your PATH
```

## Configure

Copy the example env file to your home directory config folder and fill in your credentials:

```bash
mkdir -p ~/.mybot
cp .env.example ~/.mybot/.env
# edit ~/.mybot/.env with your real values
```

The CLI loads config **only** from `~/.mybot/.env` — never from the repo directory.

## Usage

### Get a file

Fetches the file content and prints it to stdout. Uses a local cache at `~/.mybot/files/` and only downloads from Supabase when the remote `updated_at` timestamp differs from the cached value.

```bash
mybot get ideas.md
mybot get notes/todo.txt
```

### Put a file

Reads content from stdin, upserts it to Supabase, then updates the local cache.

```bash
printf "hello world\n" | mybot put test/cli.md
cat my-local-file.md | mybot put ideas.md
echo "updated content" | mybot put notes/todo.txt
```

On success, prints a single confirmation line to stdout:

```
PUT ok test/cli.md bytes=12 updated_at=2024-01-15T10:30:00.000Z
```

## Local mirror

All files are mirrored at:

```
~/.mybot/files/<path>
```

Metadata (timestamps and byte counts) is stored at:

```
~/.mybot/index.json
```

The CLI compares `updated_at` timestamps before downloading — if your local copy is current, no network fetch is made for the content.

## Limits

- Maximum file size: **500 KB** per file (enforced on both get and put)
- Paths must not contain `.`, `..`, empty segments, or leading slashes

## Debug output

Debug logs go to stderr so they never pollute stdout pipelines:

```
MYBOT GET local-hit ideas.md       # served from local cache
MYBOT GET remote-refresh ideas.md  # downloaded from Supabase
MYBOT PUT test/cli.md bytes=12 updated_at=2024-01-15T10:30:00.000Z
```
