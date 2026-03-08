-- 为 grade_teaching_contents 表添加 remark_items 列（教学日历 Word 导入方案：年级模板同时存备注）
-- 若表已存在且无此列，执行本文件即可。
-- MySQL（执行前请确认表中尚无 remark_items 列，否则会报错 Duplicate column）:
ALTER TABLE grade_teaching_contents
  ADD COLUMN remark_items JSON DEFAULT NULL COMMENT '备注列表，与 content_items 同序';

