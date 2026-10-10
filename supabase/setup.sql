-- =============================================================================
-- Library Pro — Complete Supabase Setup (single-file)
-- =============================================================================
-- Run this ONE file in the Supabase SQL Editor on a fresh project to provision:
--   • All tables (categories, books, students, book_issues, fines, user_roles)
--   • Enum type public.app_role
--   • RLS enabled + admin-only policies (via public.has_role)
--   • Helper RPCs: has_role, has_any_admin, bootstrap_admin
--   • Private storage bucket `library-images` (admin-only access)
--   • Keep-alive health check RPC with a locked rate-limit counter
--   • All required GRANTs for the Data API (anon / authenticated / service_role)
--   • Book fields used by ISBN lookup and Excel/CSV import (no extra import tables)
--
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE / DROP-IF-EXISTS
-- guards, so applying it to a partially-migrated project will heal it.
--
-- First admin: after running this file, sign up in the app; the first signed-in
-- user can call public.bootstrap_admin() to claim the admin role (the app does
-- this automatically on the auth page).
-- ISBN metadata is fetched in the browser from Open Library / Google Books;
-- saving imports uses the same admin-only books/categories policies below.
-- Imports add rows; this script does not seed books or deduplicate ISBNs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 2. Roles enum
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. Core tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  descr  TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS public.books (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT '',
  isbn       TEXT DEFAULT '',
  cat_id     INT REFERENCES public.categories(id),
  pub_year   INT DEFAULT 2024,
  qty        INT DEFAULT 1,
  available  INT DEFAULT 1,
  cover_url  TEXT DEFAULT ''
);
ALTER TABLE public.books      ADD COLUMN IF NOT EXISTS cover_url TEXT DEFAULT '';
ALTER TABLE public.books      ADD COLUMN IF NOT EXISTS author    TEXT NOT NULL DEFAULT '';
ALTER TABLE public.books      ADD COLUMN IF NOT EXISTS isbn      TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS public.students (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  student_id  TEXT UNIQUE NOT NULL,
  email       TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  image_url   TEXT DEFAULT '',
  address     TEXT DEFAULT ''
);
ALTER TABLE public.students   ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS public.book_issues (
  id           SERIAL PRIMARY KEY,
  book_id      INT REFERENCES public.books(id),
  student_id   INT REFERENCES public.students(id),
  issue_date   DATE DEFAULT CURRENT_DATE,
  due_date     DATE NOT NULL,
  return_date  DATE,
  status       TEXT DEFAULT 'Issued'
);
ALTER TABLE public.book_issues ADD COLUMN IF NOT EXISTS return_date DATE;

CREATE TABLE IF NOT EXISTS public.fines (
  id          SERIAL PRIMARY KEY,
  issue_id    INT REFERENCES public.book_issues(id),
  student_id  INT REFERENCES public.students(id),
  amount      NUMERIC DEFAULT 0,
  status      TEXT DEFAULT 'Unpaid'
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        public.app_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- -----------------------------------------------------------------------------
-- 4. GRANTs (Data API access — required in addition to RLS)
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.books       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.book_issues TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fines       TO authenticated;
GRANT SELECT                          ON public.user_roles TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE categories_id_seq  TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE books_id_seq       TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE students_id_seq    TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE book_issues_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE fines_id_seq       TO authenticated;

GRANT ALL ON public.categories,  public.books, public.students,
             public.book_issues, public.fines, public.user_roles TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles  ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 6. Security-definer role check (must exist before policies reference it)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Policies — admin-only for all library tables, self-read for user_roles
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "auth all"                 ON public.categories;
DROP POLICY IF EXISTS "auth all"                 ON public.books;
DROP POLICY IF EXISTS "auth all"                 ON public.students;
DROP POLICY IF EXISTS "auth all"                 ON public.book_issues;
DROP POLICY IF EXISTS "auth all"                 ON public.fines;
DROP POLICY IF EXISTS "Admins manage categories" ON public.categories;
DROP POLICY IF EXISTS "Admins manage books"      ON public.books;
DROP POLICY IF EXISTS "Admins manage students"   ON public.students;
DROP POLICY IF EXISTS "Admins manage issues"     ON public.book_issues;
DROP POLICY IF EXISTS "Admins manage fines"      ON public.fines;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;

CREATE POLICY "Admins manage categories" ON public.categories  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage books"      ON public.books       FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage students"   ON public.students    FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage issues"     ON public.book_issues FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage fines"      ON public.fines       FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 8. Bootstrap RPCs — first signed-in user can claim admin
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_any_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin'::public.app_role)
$$;
GRANT EXECUTE ON FUNCTION public.has_any_admin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.bootstrap_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin'::public.app_role) THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (uid, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin() TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Storage bucket (private) + admin-only policy
--    Files are read through signed URLs created by signed-in admins.
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('library-images', 'library-images', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Admins manage library-images" ON storage.objects;
DROP POLICY IF EXISTS "Public read library-images"   ON storage.objects;

CREATE POLICY "Admins manage library-images"
  ON storage.objects FOR ALL TO authenticated
  USING      (bucket_id = 'library-images' AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (bucket_id = 'library-images' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- -----------------------------------------------------------------------------
-- 10. Keep-alive / health check (GET /api/public/health)
--     One locked counter row; 10 checks per hour, then 1-hour block.
--     Never touches library data. Callable by anon only.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.health_check_limits (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  window_started_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_count      smallint NOT NULL DEFAULT 0 CHECK (request_count BETWEEN 0 AND 10),
  blocked_until      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at         timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT ALL ON public.health_check_limits TO service_role;
REVOKE ALL ON public.health_check_limits FROM anon, authenticated;
ALTER TABLE public.health_check_limits ENABLE ROW LEVEL SECURITY;
INSERT INTO public.health_check_limits (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'health_check_executor') THEN
    CREATE ROLE health_check_executor NOLOGIN NOINHERIT;
  END IF;
END$$;
GRANT health_check_executor TO postgres;
GRANT USAGE ON SCHEMA public TO health_check_executor;
GRANT SELECT, UPDATE ON public.health_check_limits TO health_check_executor;

DROP POLICY IF EXISTS "Health executor manages counter"   ON public.health_check_limits;
DROP POLICY IF EXISTS "Deny direct public counter access" ON public.health_check_limits;
CREATE POLICY "Health executor manages counter" ON public.health_check_limits
  FOR ALL TO health_check_executor USING (id = 1) WITH CHECK (id = 1);
CREATE POLICY "Deny direct public counter access" ON public.health_check_limits
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.check_keep_alive()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '2s'
SET lock_timeout = '500ms'
AS $fn$
DECLARE
  state public.health_check_limits%ROWTYPE;
  probe_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO STRICT state FROM public.health_check_limits WHERE id = 1 FOR UPDATE;
  probe_time := clock_timestamp();
  IF state.blocked_until IS NOT NULL AND state.blocked_until > probe_time THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after',
      greatest(1, ceil(extract(epoch FROM state.blocked_until - probe_time))::integer));
  END IF;
  IF state.blocked_until IS NOT NULL OR state.window_started_at + interval '1 hour' <= probe_time THEN
    UPDATE public.health_check_limits
      SET window_started_at = probe_time, request_count = 1, blocked_until = NULL, updated_at = probe_time
      WHERE id = 1;
    RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
  END IF;
  IF state.request_count >= 10 THEN
    UPDATE public.health_check_limits
      SET blocked_until = probe_time + interval '1 hour', updated_at = probe_time WHERE id = 1;
    RETURN jsonb_build_object('allowed', false, 'retry_after', 3600);
  END IF;
  UPDATE public.health_check_limits
    SET request_count = request_count + 1, updated_at = probe_time WHERE id = 1;
  RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
END;
$fn$;

GRANT CREATE ON SCHEMA public TO health_check_executor;
ALTER FUNCTION public.check_keep_alive() OWNER TO health_check_executor;
REVOKE CREATE ON SCHEMA public FROM health_check_executor;
REVOKE ALL ON FUNCTION public.check_keep_alive() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.check_keep_alive() TO anon;

-- -----------------------------------------------------------------------------
-- Default book categories for school & college libraries (skips existing names)
-- -----------------------------------------------------------------------------
INSERT INTO public.categories (name, descr)
SELECT v.name, v.descr FROM (VALUES
  ('Reference & Encyclopedias', 'Dictionaries, encyclopedias, atlases, almanacs'),
  ('General Knowledge', 'Quiz, facts, current affairs'),
  ('Textbooks', 'Prescribed course and class textbooks'),
  ('Mathematics', 'Algebra, geometry, calculus, statistics'),
  ('Physics', 'Mechanics, optics, electricity, modern physics'),
  ('Chemistry', 'Organic, inorganic and physical chemistry'),
  ('Biology', 'Botany, zoology, human biology'),
  ('Environmental Science', 'Ecology, climate, conservation'),
  ('Computer Science', 'Programming, IT, networking, data science'),
  ('Engineering & Technology', 'Mechanical, electrical, civil, electronics'),
  ('Medical & Health Sciences', 'Anatomy, nursing, pharmacy, public health'),
  ('Agriculture', 'Crop science, horticulture, animal husbandry'),
  ('Astronomy & Space', 'Stars, planets and space exploration'),
  ('History', 'World, regional and national history'),
  ('Geography', 'Physical and human geography, maps'),
  ('Political Science', 'Government, civics, international relations'),
  ('Economics', 'Micro, macro and development economics'),
  ('Sociology', 'Society, culture and social issues'),
  ('Psychology', 'Behaviour, mind and mental health'),
  ('Philosophy', 'Logic, ethics, schools of thought'),
  ('Religion & Ethics', 'Religious studies and moral education'),
  ('Law', 'Legal studies, constitution, rights'),
  ('Business & Commerce', 'Management, marketing, entrepreneurship'),
  ('Accounting & Finance', 'Bookkeeping, banking, finance'),
  ('Education & Teaching', 'Pedagogy, teacher training'),
  ('English Language', 'Grammar, vocabulary, writing skills'),
  ('Bangla Language & Literature', 'Bangla grammar, poetry and prose'),
  ('Foreign Languages', 'Arabic, French, Chinese and other languages'),
  ('Literature & Classics', 'Classic and modern literary works'),
  ('Fiction & Novels', 'Novels and short stories'),
  ('Poetry & Drama', 'Poems, plays and drama'),
  ('Children''s Books', 'Picture books and early readers'),
  ('Young Adult', 'Books for teenage readers'),
  ('Comics & Graphic Novels', 'Comics, manga, graphic novels'),
  ('Biography & Autobiography', 'Lives and memoirs of notable people'),
  ('Arts & Music', 'Fine arts, design, music'),
  ('Sports & Physical Education', 'Sports, fitness, health education'),
  ('Self-Help & Personal Development', 'Motivation, study skills, careers'),
  ('Competitive Exams & Admission', 'Admission tests, job exams, guides'),
  ('Journals & Magazines', 'Periodicals and research journals'),
  ('Research & Thesis', 'Dissertations, theses, research papers'),
  ('Miscellaneous', 'Books that fit no other category')
) AS v(name, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c WHERE lower(c.name) = lower(v.name)
);

-- =============================================================================
-- Done. Verify with:
--   select public.has_any_admin();
--   select public.check_keep_alive();
-- =============================================================================
