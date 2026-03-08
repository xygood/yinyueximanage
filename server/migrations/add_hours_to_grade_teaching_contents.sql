-- 年级学时模板：总学时/理论学时/实践学时，全年级共用（执行前请确认表中尚无这些列）
ALTER TABLE grade_teaching_contents ADD COLUMN required_hours INT NULL COMMENT '总学时，全年级共用';
ALTER TABLE grade_teaching_contents ADD COLUMN theory_hours INT NULL COMMENT '理论学时，全年级共用';
ALTER TABLE grade_teaching_contents ADD COLUMN practice_hours INT NULL COMMENT '实践学时，全年级共用';
