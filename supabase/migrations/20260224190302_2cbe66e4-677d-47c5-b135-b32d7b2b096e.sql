-- Fix files FK to cascade on project delete
ALTER TABLE public.files DROP CONSTRAINT files_project_id_fkey;
ALTER TABLE public.files ADD CONSTRAINT files_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

-- Fix briefings FK to cascade on project delete
ALTER TABLE public.briefings DROP CONSTRAINT briefings_project_id_fkey;
ALTER TABLE public.briefings ADD CONSTRAINT briefings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

-- Fix client_requests FK to cascade on project delete
ALTER TABLE public.client_requests DROP CONSTRAINT client_requests_project_id_fkey;
ALTER TABLE public.client_requests ADD CONSTRAINT client_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;