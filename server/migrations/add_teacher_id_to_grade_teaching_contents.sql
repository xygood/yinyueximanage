-- 年级模板按教师区分：谁上传谁使用（同年级多位教师带小组课各用各的模板）
-- MySQL: 若表已有 remark_items 列，仅执行下面这一行即可
ALTER TABLE grade_teaching_contents
  ADD COLUMN teacher_id VARCHAR(50) DEFAULT NULL COMMENT '教师标识，谁上传谁使用；空为旧数据兼容';
