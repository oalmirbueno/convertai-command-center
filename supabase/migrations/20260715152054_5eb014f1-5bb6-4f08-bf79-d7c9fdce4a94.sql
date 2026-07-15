DROP POLICY IF EXISTS "workspace: linked approval read" ON storage.objects;

CREATE POLICY "workspace: linked approval read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'workspace'
  AND EXISTS (
    SELECT 1
    FROM public.files f
    WHERE f.storage_bucket = 'workspace'
      AND f.storage_path = storage.objects.name
      AND (
        f.client_id = auth.uid()
        OR public.is_staff(auth.uid())
      )
  )
);