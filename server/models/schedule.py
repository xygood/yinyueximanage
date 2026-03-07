from sqlalchemy import Column, String, DateTime, Integer, Date, JSON
from sqlalchemy.sql import func
from .database import Base
import uuid

class ScheduledClass(Base):
    __tablename__ = 'scheduled_classes'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    teacher_id = Column(String(50), nullable=True, comment='教师工号')
    course_id = Column(String(36))
    student_id = Column(String(50))
    room_id = Column(String(36))
    class_id = Column(String(50), comment='班级ID')
    teacher_name = Column(String(100), comment='教师姓名')
    course_code = Column(String(50), comment='课程编号')
    day_of_week = Column(Integer, comment='星期几(1-7)')
    date = Column(Date, comment='具体日期')
    period = Column(Integer, comment='节次(1-10)')
    duration = Column(Integer, default=1, comment='持续节数')
    start_week = Column(Integer, comment='开始周次')
    end_week = Column(Integer, comment='结束周次')
    week_number = Column(Integer, comment='周次(兼容)')
    specific_dates = Column(JSON, comment='特定日期列表')
    faculty_id = Column(String(50))
    semester_label = Column(String(20))
    academic_year = Column(String(20))
    semester = Column(Integer)
    status = Column(String(20), default='scheduled', comment='状态')
    group_id = Column(String(36), comment='小组ID')
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    def to_dict(self):
        return {
            'id': self.id,
            'teacher_id': self.teacher_id,
            'course_id': self.course_id,
            'student_id': self.student_id,
            'room_id': self.room_id,
            'class_id': self.class_id,
            'teacher_name': self.teacher_name,
            'course_code': self.course_code,
            'day_of_week': self.day_of_week,
            'date': self.date.isoformat() if self.date else None,
            'period': self.period,
            'duration': self.duration,
            'start_week': self.start_week,
            'end_week': self.end_week,
            'week_number': self.week_number,
            'specific_dates': self.specific_dates,
            'faculty_id': self.faculty_id,
            'semester_label': self.semester_label,
            'academic_year': self.academic_year,
            'semester': self.semester,
            'status': self.status,
            'group_id': self.group_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
