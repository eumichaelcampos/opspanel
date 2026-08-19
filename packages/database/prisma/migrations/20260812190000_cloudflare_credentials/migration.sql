DO $$ BEGIN
  ALTER TYPE "UserSecretKind" ADD VALUE 'cloudflare_credentials';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
