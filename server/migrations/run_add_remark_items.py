#!/usr/bin/env python3
"""
为 grade_teaching_contents 表添加 remark_items 列。
使用与 server 相同的 MYSQL_* 环境变量或默认配置。
用法: 在项目根目录执行  python server/migrations/run_add_remark_items.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def main():
    try:
        from sqlalchemy import create_engine, text
        from config import config
    except Exception as e:
        print("请从项目根目录执行，并确保 server 在 PYTHONPATH:", e)
        sys.exit(1)

    env = os.environ.get("FLASK_ENV", "development")
    cfg = config.get(env, config["default"])
    uri = getattr(cfg, "SQLALCHEMY_DATABASE_URI", None) or getattr(cfg, "MYSQL_SQLALCHEMY_URI", None)
    if not uri:
        print("未找到数据库配置")
        sys.exit(1)

    engine = create_engine(uri)
    sql = """
    ALTER TABLE grade_teaching_contents
      ADD COLUMN remark_items JSON DEFAULT NULL COMMENT '备注列表，与 content_items 同序'
    """
    try:
        with engine.begin() as conn:
            conn.execute(text(sql))
        print("已添加 grade_teaching_contents.remark_items 列")
    except Exception as e:
        if "Duplicate column" in str(e) or "1060" in str(e):
            print("列 remark_items 已存在，无需重复添加")
        else:
            print("执行失败:", e)
            sys.exit(1)

    sql2 = """
    ALTER TABLE grade_teaching_contents
      ADD COLUMN teacher_id VARCHAR(50) DEFAULT NULL COMMENT '教师标识，谁上传谁使用；空为旧数据兼容'
    """
    try:
        with engine.begin() as conn:
            conn.execute(text(sql2))
        print("已添加 grade_teaching_contents.teacher_id 列")
    except Exception as e:
        if "Duplicate column" in str(e) or "1060" in str(e):
            print("列 teacher_id 已存在，无需重复添加")
        else:
            print("teacher_id 列执行失败:", e)
            sys.exit(1)

if __name__ == "__main__":
    main()
