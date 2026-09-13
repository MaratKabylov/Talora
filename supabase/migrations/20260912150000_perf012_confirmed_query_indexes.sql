-- PERF-012: indexes selected from the 10.09.2026 staging EXPLAIN and write-gate evidence.
-- The measured staging tables are small, so ordinary CREATE INDEX keeps this migration
-- transactional. Re-run the verification plans after deployment before removing any
-- older prefix index.

create index if not exists perf012_candidate_applications_company_created_id
  on public.candidate_applications (company_id, created_at desc, id asc);

create index if not exists perf012_candidate_applications_company_job_created_id
  on public.candidate_applications (company_id, job_id, created_at desc, id asc);

create index if not exists perf012_candidate_applications_company_job_fit_id
  on public.candidate_applications (company_id, job_id, fit_score desc nulls last, id asc);

create index if not exists perf012_employee_participants_assessment_created_id
  on public.employee_assessment_participants
  (employee_assessment_id, created_at desc, id asc);

create index if not exists perf012_employee_participants_company_assessment_fit_id
  on public.employee_assessment_participants
  (company_id, employee_assessment_id, fit_score desc nulls last, id asc);

create index if not exists perf012_test_sections_version_order_id
  on public.test_sections (test_version_id, order_index asc, id asc);

create index if not exists perf012_questions_section_order_id
  on public.questions (section_id, order_index asc, id asc);

create index if not exists perf012_answer_options_question_order_id
  on public.answer_options (question_id, order_index asc, id asc);
