#!/usr/bin/env python3
"""创建管理员用户"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models.database import SessionLocal, init_db
from models.teacher import Teacher
from models.user import User
import uuid

def create_admin_user():
    """创建 teacher_id=110 的管理员用户"""
    db = SessionLocal()
    try:
        # 检查是否已存在
        existing = db.query(Teacher).filter(Teacher.teacher_id == '110').first()
        if existing:
            print(f"管理员用户已存在: {existing.name} (ID: {existing.teacher_id})")
            return
        
        # 创建教师记录
        teacher = Teacher(
            id=str(uuid.uuid4()),
            teacher_id='110',
            name='管理员',
            full_name='系统管理员',
            email='admin@music.edu.cn',
            faculty_id='ADMIN',
            faculty_code='ADMIN',
            faculty_name='管理组',
            position='管理员',
            status='active',
            max_students_per_class=10
        )
        db.add(teacher)
        db.commit()
        
        print(f"✅ 管理员用户创建成功!")
        print(f"   工号: 110")
        print(f"   姓名: 管理员")
        print(f"   密码: 135")
        print(f"   邮箱: admin@music.edu.cn")
        
    except Exception as e:
        db.rollback()
        print(f"❌ 创建失败: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    create_admin_user()
