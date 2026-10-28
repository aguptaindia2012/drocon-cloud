-- ============================================================================
-- 136. Attendance approval workflow
-- ----------------------------------------------------------------------------
-- Employees self-submit attendance (My Space); a manager/admin approves it.
-- Only APPROVED attendance counts in payroll/reports. Existing rows and
-- HR-grid-entered rows default to 'approved' (back-compatible); self-submitted
-- rows are 'pending' until approved.
-- Additive & idempotent.
-- ============================================================================
alter table public.hr_attendance add column if not exists approval_status   text not null default 'approved';
alter table public.hr_attendance add column if not exists assigned_approver  uuid references public.profiles(id);
alter table public.hr_attendance add column if not exists submitted_at       timestamptz;
alter table public.hr_attendance add column if not exists approved_by        uuid references public.profiles(id);
alter table public.hr_attendance add column if not exists approved_at        timestamptz;
alter table public.hr_attendance add column if not exists reject_note        text;

create index if not exists hr_attendance_pending_idx on public.hr_attendance(approval_status) where approval_status='pending';
comment on column public.hr_attendance.approval_status is 'pending | approved | rejected. Only approved counts in payroll/reports.';
