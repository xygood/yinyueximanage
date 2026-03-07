import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, scoped_session
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import config

env = os.environ.get('FLASK_ENV', 'development')
current_config = config.get(env, config['default'])

engine = create_engine(
    current_config.SQLALCHEMY_DATABASE_URI,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=current_config.SQLALCHEMY_ECHO
)

SessionLocal = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    from models import (
        Faculty, Teacher, Student, Course, Room, 
        ScheduledClass, BlockedSlot, Class,
        User, StudentTeacherAssignment, LargeClassSchedule, SemesterWeekConfig,
        ImportedBlockedTime, TeachingCalendarHeader, TeachingCalendarEntry,
        GradeTeachingContent
    )
    Base.metadata.create_all(bind=engine)

def drop_all():
    Base.metadata.drop_all(bind=engine)
