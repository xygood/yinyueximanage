"""
同年级教学内容模板：按 (semester_label, course_id, grade, class_type) 存储 16 次课的教学内容。
导入一次后，该年级同班级类型（普通班/专升本）的班级、小组共用，按实际上课周次填充。
专业本和普通班年级不能共用一套内容。
"""
from sqlalchemy import Column, String, DateTime, Integer, JSON
from sqlalchemy.sql import func
from .database import Base
import uuid


class GradeTeachingContent(Base):
    """
    年级级教学内容模板：
    - (semester_label, course_id, grade, class_type) 唯一确定一份模板
    - class_type: 'general' 普通班 | 'upgrade' 专升本，二者内容互不共用
    - content_items: JSON 数组，通常 16 条（小组课/专业大课标准 16 次）
    - 当某班级/小组实际排课少于 16 次时，后端将 16 条内容平分到实际周次
    """

    __tablename__ = "grade_teaching_contents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    semester_label = Column(String(20), nullable=False, comment="学期标签，如 2025-2026-2")
    course_id = Column(String(36), nullable=False, comment="课程标识")
    grade = Column(Integer, nullable=False, comment="年级，如 2025、2024")
    class_type = Column(String(20), nullable=False, default="general", comment="班级类型：general 普通班 | upgrade 专升本")

    # 教学内容列表，通常 16 条，索引 0 对应第 1 次课
    content_items = Column(JSON, default=list, comment="教学内容列表，如 [\"内容1\", \"内容2\", ...]")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
