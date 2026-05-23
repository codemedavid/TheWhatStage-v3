-- supabase/migrations/20260608000000_payment_methods_embedded_at.sql
-- Add embedded_at so payment_methods matches the other RAG source tables
-- (knowledge_documents, knowledge_faqs, business_items, media_assets).
-- The embed-job worker writes this column on every successful index pass.

alter table public.payment_methods
  add column if not exists embedded_at timestamptz;
