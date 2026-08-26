from flask import Blueprint, request, jsonify
from models.database import get_db
from models.teacher import Teacher
from models.student import Student
from models.course import Course
from models.room import Room
from models.schedule import ScheduledClass
from models.blocked_slot import BlockedSlot
from models.class_model import Class
from models.user import User
from models.student_teacher_assignment import StudentTeacherAssignment
import json
from datetime import datetime

api_bp = Blueprint('api', __name__, url_prefix='/api')

@api_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

from . import teachers
from . import students
from . import courses
from . import rooms
from . import schedule
from . import blocked_slots
from . import classes
from . import auth
from . import sync
from . import semester_configs
from . import large_class_schedules
from . import teaching_calendar
from . import exam_sampling
from .imported_blocked_times import imported_blocked_times_bp

api_bp.register_blueprint(imported_blocked_times_bp)
