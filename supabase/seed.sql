-- 十二位姐妹占位种子（名字可后续替换 TODO）
INSERT INTO public.agents (slug, name, area, bot_id) VALUES
  ('sister-01', 'TODO-姐妹-01', 'area-01', NULL),
  ('sister-02', 'TODO-姐妹-02', 'area-02', NULL),
  ('sister-03', 'TODO-姐妹-03', 'area-03', NULL),
  ('sister-04', 'TODO-姐妹-04', 'area-04', NULL),
  ('sister-05', 'TODO-姐妹-05', 'area-05', NULL),
  ('sister-06', 'TODO-姐妹-06', 'area-06', NULL),
  ('sister-07', 'TODO-姐妹-07', 'area-07', NULL),
  ('sister-08', 'TODO-姐妹-08', 'area-08', NULL),
  ('sister-09', 'TODO-姐妹-09', 'area-09', NULL),
  ('sister-10', 'TODO-姐妹-10', 'area-10', NULL),
  ('sister-11', 'TODO-姐妹-11', 'area-11', NULL),
  ('sister-12', 'TODO-姐妹-12', 'area-12', NULL)
ON CONFLICT (slug) DO NOTHING;
