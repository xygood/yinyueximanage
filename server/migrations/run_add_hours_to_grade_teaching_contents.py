#!/usr/bin/env python3
"""
为 grade_teaching_contents 表添加 required_hours, theory_hours, practice_hours 列（全年级学时模板）。
用法: 在项目根目录执行  python server/migrations/run_add_hours_to_grade_teaching_contents.py
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
    columns = [
        ("required_hours", "总学时，全年级共用"),
        ("theory_hours", "理论学时，全年级共用"),
        ("practice_hours", "实践学时，全年级共用"),
    ]
    for col, comment in columns:
        sql = f"""
        ALTER TABLE grade_teaching_contents
          ADD COLUMN {col} INT NULL COMMENT '{comment}'
        """
        try:
            with engine.begin() as conn:
                conn.execute(text(sql))
            print(f"已添加 grade_teaching_contents.{col} 列")
        except Exception as e:
            if "Duplicate column" in str(e) or "1060" in str(e):
                print(f"列 {col} 已存在，无需重复添加")
            else:
                print(f"执行失败 ({col}):", e)
                sys.exit(1)

if __name__ == "__main__":
    main()
