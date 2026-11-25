CREATE TABLE IF NOT EXISTS public.draft_topics (
  id text PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array' AND jsonb_array_length(candidates) BETWEEN 1 AND 500),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_hash text NOT NULL CHECK (owner_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS draft_topics_owner_idx ON public.draft_topics (owner_hash);
ALTER TABLE public.draft_topics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.draft_topics FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.draft_topics TO service_role;
