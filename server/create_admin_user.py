#!/usr/bin/env python3
"""创建管理员用户（包括User表记录）"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models.database import SessionLocal
from models.teacher import Teacher
from models.user import User
import uuid

def create_admin_user():
    """创建 teacher_id=110 的管理员用户"""
    db = SessionLocal()
    try:
        # 检查Teacher表是否已存在
        existing_teacher = db.query(Teacher).filter(Teacher.teacher_id == '110').first()
        if not existing_teacher:
            # 创建教师记录
            teacher = Teacher(
                id=str(uuid.uuid4()),
                teacher_id='110',
                name='管理员',
                full_name='系统管理员',
                faculty_id='ADMIN',
                faculty_code='ADMIN',
                faculty_name='管理组',
                position='管理员',
                status='active',
                max_students_per_class=10
            )
            db.add(teacher)
            print("✅ Teacher记录创建成功")
        else:
            print("✅ Teacher记录已存在")
        
        # 检查User表是否已存在
        existing_user = db.query(User).filter(User.teacher_id == '110').first()
        if not existing_user:
            # 创建用户记录（管理员使用明文密码）
            user = User(
                id=str(uuid.uuid4()),
                teacher_id='110',
                email='admin@music.edu.cn',
                password='135',  # 管理员使用明文密码
                full_name='系统管理员',
                department='管理组',
                faculty_id='ADMIN',
                faculty_code='ADMIN',
                is_admin=True
            )
            db.add(user)
            print("✅ User记录创建成功")
        else:
            print("✅ User记录已存在")
        
        db.commit()
        
        print(f"\n✅ 管理员用户创建成功!")
        print(f"   工号: 110")
        print(f"   姓名: 管理员")
        print(f"   密码: 135")
        
    except Exception as e:
        db.rollback()
        print(f"❌ 创建失败: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == '__main__':
    create_admin_user()
