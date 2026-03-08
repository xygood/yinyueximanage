"""
同年级教学内容模板：按 (semester_label, course_id, grade, class_type, teacher_id) 存储。
谁上传谁使用：同一年级多位教师带小组课时，各用各的模板；teacher_id 为空表示旧数据（兼容）。
"""
from sqlalchemy import Column, String, DateTime, Integer, JSON
from sqlalchemy.sql import func
from .database import Base
import uuid


class GradeTeachingContent(Base):
    """
    年级教学内容模板（谁上传谁使用）：
    - (semester_label, course_id, grade, class_type, teacher_id) 唯一确定一份模板
    - teacher_id 必填：仅该教师加载日历时使用此模板；同年级其他教师各自上传各自用
    - teacher_id 为空且设了 required_hours/theory_hours/practice_hours：全年级共用的学时，所有班级/小组共用
    - class_type: 'general' 普通班 | 'upgrade' 专升本
    """

    __tablename__ = "grade_teaching_contents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    semester_label = Column(String(20), nullable=False, comment="学期标签，如 2025-2026-2")
    course_id = Column(String(36), nullable=False, comment="课程标识")
    grade = Column(Integer, nullable=False, comment="年级，如 2025、2024")
    class_type = Column(String(20), nullable=False, default="general", comment="班级类型：general 普通班 | upgrade 专升本")
    teacher_id = Column(String(50), nullable=True, comment="教师标识，谁上传谁使用；空为旧数据或全年级学时模板")

    # 教学内容列表，通常 16 条，索引 0 对应第 1 次课
    content_items = Column(JSON, default=list, comment="教学内容列表，如 [\"内容1\", \"内容2\", ...]")
    # 备注列表，与 content_items 一一对应，加载模板时仅在该行无禁排原因时填入
    remark_items = Column(JSON, default=list, comment="备注列表，与 content_items 同序")

    # 全年级一致：总学时/理论学时/实践学时，任一教师保存后整年级所有班级、小组共用
    required_hours = Column(Integer, nullable=True, comment="总学时，全年级共用")
    theory_hours = Column(Integer, nullable=True, comment="理论学时，全年级共用")
    practice_hours = Column(Integer, nullable=True, comment="实践学时，全年级共用")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
