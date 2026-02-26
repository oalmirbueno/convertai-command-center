
-- Add milestone_id to tasks table to link tasks to milestones
ALTER TABLE public.tasks ADD COLUMN milestone_id uuid REFERENCES public.milestones(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX idx_tasks_milestone_id ON public.tasks(milestone_id);

-- Create function to auto-update milestone status based on task completion
CREATE OR REPLACE FUNCTION public.update_milestone_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _milestone_id uuid;
  _total_tasks int;
  _done_tasks int;
  _project_id uuid;
  _total_milestones int;
  _completed_milestones int;
  _in_progress_milestones int;
  _new_milestone_status text;
BEGIN
  -- Get the milestone_id (use NEW for INSERT/UPDATE, OLD for DELETE)
  _milestone_id := COALESCE(NEW.milestone_id, OLD.milestone_id);
  
  IF _milestone_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Count tasks in this milestone
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'done')
  INTO _total_tasks, _done_tasks
  FROM public.tasks
  WHERE milestone_id = _milestone_id;

  -- Determine new milestone status
  IF _total_tasks = 0 THEN
    _new_milestone_status := 'pending';
  ELSIF _done_tasks = _total_tasks THEN
    _new_milestone_status := 'completed';
  ELSIF _done_tasks > 0 THEN
    _new_milestone_status := 'in_progress';
  ELSE
    -- Check if any task is in progress/review/doing
    IF EXISTS (SELECT 1 FROM public.tasks WHERE milestone_id = _milestone_id AND status IN ('doing', 'review')) THEN
      _new_milestone_status := 'in_progress';
    ELSE
      _new_milestone_status := 'pending';
    END IF;
  END IF;

  -- Update milestone status
  UPDATE public.milestones SET status = _new_milestone_status WHERE id = _milestone_id;

  -- Now update project progress based on all milestones
  SELECT project_id INTO _project_id FROM public.milestones WHERE id = _milestone_id;
  
  IF _project_id IS NOT NULL THEN
    SELECT COUNT(*), 
           COUNT(*) FILTER (WHERE status = 'completed'),
           COUNT(*) FILTER (WHERE status = 'in_progress')
    INTO _total_milestones, _completed_milestones, _in_progress_milestones
    FROM public.milestones
    WHERE project_id = _project_id;

    IF _total_milestones > 0 THEN
      UPDATE public.projects 
      SET progress = LEAST(100, ROUND(
        (_completed_milestones * 100.0 + _in_progress_milestones * 50.0) / _total_milestones
      )::int)
      WHERE id = _project_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create triggers for auto-progress
CREATE TRIGGER trigger_task_milestone_progress
AFTER INSERT OR UPDATE OF status, milestone_id OR DELETE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.update_milestone_progress();
