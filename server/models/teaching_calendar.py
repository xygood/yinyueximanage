from sqlalchemy import Column, String, DateTime, Integer, Boolean, JSON, ForeignKey
from sqlalchemy.sql import func
from .database import Base
import uuid


class TeachingCalendarHeader(Base):
    """
    教学日历头信息：
    - 对应唯一的 (semester_label, teacher_id, course_id, class_id/group_id) 组合
    - 存放第一页信息页所需的字段（课程名、学院、班级展示名称等）
    """

    __tablename__ = "teaching_calendar_headers"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # 关键维度
    academic_year = Column(String(20), nullable=True, comment="学年，例如 2025-2026")
    semester_label = Column(String(20), nullable=False, comment="学期标签，例如 2025-2026-2")

    teacher_id = Column(String(50), nullable=False, comment="教师标识（与排课表保持一致）")
    course_id = Column(String(36), nullable=False, comment="课程标识（与排课表保持一致）")

    # 班级 / 小组维度
    class_id = Column(String(50), nullable=True, comment="教学班或行政班标识，可选")
    group_id = Column(String(36), nullable=True, comment="小组课的小组ID，可选")

    # 展示用班级名称（包含小组学生姓名时使用换行）
    class_display_name = Column(String(512), nullable=True, comment="授课专业班级展示文本（可多行）")

    # 其它头信息使用 JSON 存储，便于后续扩展
    extra_info = Column(
        JSON,
        default=dict,
        comment="附加信息（课程名、学院、系、教师姓名/职称、教材、总学时等）",
    )

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TeachingCalendarEntry(Base):
    """
    教学日历行信息（第二页表格）：
    - 一条排课记录或一条“空周”记录对应一行
    - 仅持久化与教师编辑相关的字段（教学内容、备注等），
      时间、周次、节次等基础信息始终以排课与学期配置为准
    """

    __tablename__ = "teaching_calendar_entries"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    calendar_header_id = Column(
        String(36),
        ForeignKey("teaching_calendar_headers.id", ondelete="CASCADE"),
        nullable=False,
        comment="关联的教学日历头ID",
    )

    # 有课行：关联具体的排课记录；空周行：schedule_id 为空，仅依赖 week_number + is_empty_week
    schedule_id = Column(String(36), nullable=True, comment="排课记录ID（scheduled_classes.id）")

    week_number = Column(Integer, nullable=False, comment="周次")
    is_empty_week = Column(Boolean, default=False, comment="是否为空周（本周无排课）")

    # 仅存储教师可编辑字段
    teaching_content = Column(String(1024), nullable=True, comment="教学内容 / 教学主题")
    remark = Column(String(1024), nullable=True, comment="备注（节假日禁排原因等）")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

