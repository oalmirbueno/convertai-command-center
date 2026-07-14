DROP POLICY IF EXISTS "mcp-files: linked client read" ON storage.objects;

CREATE POLICY "mcp-files: linked client read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'mcp-files'
  AND EXISTS (
    SELECT 1
    FROM public.files f
    WHERE f.storage_bucket = 'mcp-files'
      AND f.storage_path = storage.objects.name
      AND (
        f.client_id = auth.uid()
        OR public.is_staff(auth.uid())
      )
  )
);