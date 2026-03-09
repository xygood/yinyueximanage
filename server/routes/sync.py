from flask import request, jsonify
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
from models.semester_week_config import SemesterWeekConfig
from models.large_class_schedule import LargeClassSchedule
from . import api_bp
import uuid
import re
from datetime import datetime
import hashlib

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def _normalize_semester(value):
    """将备份中的 semester 转为 INT 或 None。支持整数或字符串如 '2025级第2学期'、'第2学期'。"""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        m = re.search(r'第?\s*(\d+)\s*学期', s)
        if m:
            return int(m.group(1))
        try:
            return int(s)
        except ValueError:
            return None
    return None

@api_bp.route('/sync/all', methods=['GET'])
def get_all_data():
    db = next(get_db())
    try:
        data = {
            'teachers': [t.to_dict() for t in db.query(Teacher).all()],
            'students': [s.to_dict() for s in db.query(Student).all()],
            'courses': [c.to_dict() for c in db.query(Course).all()],
            'rooms': [r.to_dict() for r in db.query(Room).all()],
            'schedules': [s.to_dict() for s in db.query(ScheduledClass).all()],
            'blocked_slots': [b.to_dict() for b in db.query(BlockedSlot).all()],
            'classes': [c.to_dict() for c in db.query(Class).all()],
            'users': [u.to_dict() for u in db.query(User).all()],
            'assignments': [a.to_dict() for a in db.query(StudentTeacherAssignment).all()],
            'semester_configs': [c.to_dict() for c in db.query(SemesterWeekConfig).all()],
            'large_class_schedules': [s.to_dict() for s in db.query(LargeClassSchedule).all()]
        }
        return jsonify(data)
    finally:
        db.close()

@api_bp.route('/sync/import', methods=['POST'])
def import_data():
    db = next(get_db())
    try:
        data = request.get_json()
        results = {}
        
        # 建立旧UUID到学号的映射（用于排课数据转换）
        old_uuid_to_student_id = {}
        student_id_to_name = {}
        # 建立教师姓名到工号的映射
        teacher_name_to_id = {}
        
        if 'teachers' in data:
            for t in data['teachers']:
                teacher_id = t.get('teacher_id')
                teacher_name = t.get('name')
                
                # 建立教师姓名到工号的映射
                if teacher_name and teacher_id:
                    teacher_name_to_id[teacher_name] = teacher_id
                
                teacher = Teacher(
                    id=t.get('id', str(uuid.uuid4())),
                    teacher_id=teacher_id,
                    name=teacher_name,
                    full_name=t.get('full_name'),
                    email=t.get('email'),
                    phone=t.get('phone'),
                    department=t.get('department'),
                    faculty_id=t.get('faculty_id'),
                    faculty_code=t.get('faculty_code'),
                    faculty_name=t.get('faculty_name'),
                    position=t.get('position'),
                    status=t.get('status', 'active'),
                    primary_instrument=t.get('primary_instrument'),
                    can_teach_instruments=t.get('can_teach_instruments') or t.get('can_teach_courses', []),
                    max_students_per_class=t.get('max_students_per_class', 5),
                    fixed_room_id=t.get('fixed_room_id'),
                    fixed_rooms=t.get('fixed_rooms', []),
                    qualifications=t.get('qualifications', []),
                    remarks=t.get('remarks')
                )
                db.merge(teacher)
                
                # 同步创建用户记录（用于登录）
                if teacher_id:
                    existing_user = db.query(User).filter(User.teacher_id == teacher_id).first()
                    if not existing_user:
                        user = User(
                            id=str(uuid.uuid4()),
                            teacher_id=teacher_id,
                            email=t.get('email'),
                            password=hash_password(teacher_id),  # 默认密码为工号
                            full_name=t.get('full_name') or teacher_name,
                            department=t.get('department'),
                            faculty_id=t.get('faculty_id'),
                            faculty_code=t.get('faculty_code'),
                            is_admin=False
                        )
                        db.add(user)
                        db.flush()  # 立即写入，以便后续查询可以找到
            results['teachers'] = len(data['teachers'])
        
        if 'students' in data:
            for s in data['students']:
                student_id = str(s.get('student_id', ''))
                student_name = s.get('name')
                old_id = s.get('id')
                
                # 建立旧UUID到学号的映射
                if old_id and student_id and old_id != student_id:
                    old_uuid_to_student_id[old_id] = student_id
                
                # 建立学号到姓名的映射
                if student_id and student_name:
                    student_id_to_name[student_id] = student_name
                
                # 转换 assigned_teachers 中的教师ID为工号
                assigned_teachers = s.get('assigned_teachers')
                if assigned_teachers:
                    # 转换主项教师ID
                    if assigned_teachers.get('primary_teacher_name') and not assigned_teachers.get('primary_teacher_id', '').isdigit():
                        assigned_teachers['primary_teacher_id'] = teacher_name_to_id.get(
                            assigned_teachers['primary_teacher_name'], 
                            assigned_teachers.get('primary_teacher_id')
                        )
                    # 转换副项教师ID
                    if assigned_teachers.get('secondary1_teacher_name') and not assigned_teachers.get('secondary1_teacher_id', '').isdigit():
                        assigned_teachers['secondary1_teacher_id'] = teacher_name_to_id.get(
                            assigned_teachers['secondary1_teacher_name'],
                            assigned_teachers.get('secondary1_teacher_id')
                        )
                    if assigned_teachers.get('secondary2_teacher_name') and not assigned_teachers.get('secondary2_teacher_id', '').isdigit():
                        assigned_teachers['secondary2_teacher_id'] = teacher_name_to_id.get(
                            assigned_teachers['secondary2_teacher_name'],
                            assigned_teachers.get('secondary2_teacher_id')
                        )
                    if assigned_teachers.get('secondary3_teacher_name') and not assigned_teachers.get('secondary3_teacher_id', '').isdigit():
                        assigned_teachers['secondary3_teacher_id'] = teacher_name_to_id.get(
                            assigned_teachers['secondary3_teacher_name'],
                            assigned_teachers.get('secondary3_teacher_id')
                        )
                
                # 转换顶层的副项教师ID
                secondary1_teacher_id = s.get('secondary1_teacher_id')
                secondary1_teacher_name = s.get('secondary1_teacher_name')
                if secondary1_teacher_name and (not secondary1_teacher_id or not secondary1_teacher_id.isdigit()):
                    secondary1_teacher_id = teacher_name_to_id.get(secondary1_teacher_name, secondary1_teacher_id)
                
                secondary2_teacher_id = s.get('secondary2_teacher_id')
                secondary2_teacher_name = s.get('secondary2_teacher_name')
                if secondary2_teacher_name and (not secondary2_teacher_id or not secondary2_teacher_id.isdigit()):
                    secondary2_teacher_id = teacher_name_to_id.get(secondary2_teacher_name, secondary2_teacher_id)
                
                secondary3_teacher_id = s.get('secondary3_teacher_id')
                secondary3_teacher_name = s.get('secondary3_teacher_name')
                if secondary3_teacher_name and (not secondary3_teacher_id or not secondary3_teacher_id.isdigit()):
                    secondary3_teacher_id = teacher_name_to_id.get(secondary3_teacher_name, secondary3_teacher_id)
                
                student = Student(
                    id=student_id or str(uuid.uuid4()),
                    student_id=student_id,
                    name=student_name,
                    teacher_id=s.get('teacher_id'),
                    major_class=s.get('major_class') or s.get('class_name', ''),
                    grade=s.get('grade'),
                    student_type=s.get('student_type', 'general'),
                    primary_instrument=s.get('primary_instrument'),
                    secondary_instruments=s.get('secondary_instruments', []),
                    faculty_code=s.get('faculty_code'),
                    enrollment_year=s.get('enrollment_year'),
                    current_grade=s.get('current_grade'),
                    student_status=s.get('student_status', 'active'),
                    status=s.get('status', 'active'),
                    remarks=s.get('remarks'),
                    assigned_teachers=assigned_teachers or (
                        {'primary_teacher_id': s.get('assigned_teacher_id'), 'primary_teacher_name': s.get('assigned_teacher_name')}
                        if s.get('assigned_teacher_id') else None
                    ),
                    secondary1_teacher_id=secondary1_teacher_id,
                    secondary1_teacher_name=secondary1_teacher_name,
                    secondary2_teacher_id=secondary2_teacher_id,
                    secondary2_teacher_name=secondary2_teacher_name,
                    secondary3_teacher_id=secondary3_teacher_id,
                    secondary3_teacher_name=secondary3_teacher_name,
                    secondary_instrument1=s.get('secondary_instrument1'),
                    secondary_instrument2=s.get('secondary_instrument2'),
                    secondary_instrument3=s.get('secondary_instrument3'),
                    notes=s.get('notes')
                )
                db.merge(student)
            results['students'] = len(data['students'])
        
        if 'courses' in data:
            for c in data['courses']:
                course = Course(
                    id=c.get('id', str(uuid.uuid4())),
                    course_id=str(c.get('course_id', '')) if c.get('course_id') else None,
                    course_name=c.get('course_name'),
                    course_type=c.get('course_type'),
                    faculty_id=c.get('faculty_id'),
                    teacher_id=c.get('teacher_id'),
                    teacher_name=c.get('teacher_name'),
                    student_id=c.get('student_id'),
                    student_name=c.get('student_name'),
                    major_class=c.get('major_class'),
                    academic_year=c.get('academic_year'),
                    semester=_normalize_semester(c.get('semester')),
                    semester_label=c.get('semester_label'),
                    course_category=c.get('course_category', 'general'),
                    primary_instrument=c.get('primary_instrument'),
                    secondary_instrument=c.get('secondary_instrument'),
                    duration=c.get('duration', 30),
                    week_frequency=c.get('week_frequency', 1),
                    credit=c.get('credit') or c.get('credit_hours', 1),
                    required_hours=c.get('required_hours') or c.get('total_hours', 16),
                    group_size=c.get('group_size', 1),
                    student_count=c.get('student_count', 1),
                    teaching_type=c.get('teaching_type') or c.get('class_type')
                )
                db.merge(course)
            results['courses'] = len(data['courses'])
        
        if 'rooms' in data:
            for r in data['rooms']:
                room = Room(
                    id=r.get('id', str(uuid.uuid4())),
                    teacher_id=r.get('teacher_id'),
                    room_name=r.get('room_name'),
                    room_type=r.get('room_type', '琴房'),
                    faculty_code=r.get('faculty_code'),
                    capacity=r.get('capacity', 1),
                    location=r.get('location'),
                    equipment=r.get('equipment', []),
                    status=r.get('status', '空闲')
                )
                db.merge(room)
            results['rooms'] = len(data['rooms'])
        
        # 辅助函数：转换学生ID
        def convert_student_id(original_student_id):
            if not original_student_id:
                return None
            # 如果是纯数字，已经是学号
            if original_student_id.isdigit():
                return original_student_id
            # 否则从映射中查找学号
            return old_uuid_to_student_id.get(original_student_id, original_student_id)
        
        if 'schedules' in data:
            for s in data['schedules']:
                schedule = ScheduledClass(
                    id=s.get('id', str(uuid.uuid4())),
                    teacher_id=s.get('teacher_id'),
                    course_id=s.get('course_id'),
                    student_id=convert_student_id(s.get('student_id')),
                    room_id=s.get('room_id'),
                    day_of_week=s.get('day_of_week'),
                    period=s.get('period'),
                    duration=s.get('duration', 1),
                    start_week=s.get('start_week'),
                    end_week=s.get('end_week'),
                    week_number=s.get('week_number'),
                    specific_dates=s.get('specific_dates'),
                    faculty_id=s.get('faculty_id'),
                    semester_label=s.get('semester_label'),
                    academic_year=s.get('academic_year'),
                    semester=_normalize_semester(s.get('semester')),
                    status=s.get('status', 'scheduled'),
                    group_id=s.get('group_id'),
                    class_id=s.get('class_id'),
                    teacher_name=s.get('teacher_name'),
                    course_code=s.get('course_code')
                )
                db.merge(schedule)
            results['schedules'] = len(data['schedules'])
        
        # 导入专业大课排课数据
        if 'major_class_scheduled_classes' in data:
            for s in data['major_class_scheduled_classes']:
                schedule = ScheduledClass(
                    id=s.get('id', str(uuid.uuid4())),
                    teacher_id=s.get('teacher_id'),
                    course_id=s.get('course_id'),
                    student_id=convert_student_id(s.get('student_id')),
                    room_id=s.get('room_id'),
                    day_of_week=s.get('day_of_week'),
                    period=s.get('period'),
                    duration=s.get('duration', 1),
                    start_week=s.get('start_week'),
                    end_week=s.get('end_week'),
                    week_number=s.get('week_number'),
                    specific_dates=s.get('specific_dates'),
                    faculty_id=s.get('faculty_id'),
                    semester_label=s.get('semester_label'),
                    academic_year=s.get('academic_year'),
                    semester=_normalize_semester(s.get('semester')),
                    status=s.get('status', 'scheduled'),
                    group_id=s.get('group_id'),
                    class_id=s.get('class_id'),
                    teacher_name=s.get('teacher_name'),
                    course_code=s.get('course_code')
                )
                db.merge(schedule)
            results['major_class_scheduled_classes'] = len(data['major_class_scheduled_classes'])
        
        # 导入小组课排课数据
        if 'group_class_scheduled_classes' in data:
            for s in data['group_class_scheduled_classes']:
                schedule = ScheduledClass(
                    id=s.get('id', str(uuid.uuid4())),
                    teacher_id=s.get('teacher_id'),
                    course_id=s.get('course_id'),
                    student_id=convert_student_id(s.get('student_id')),
                    room_id=s.get('room_id'),
                    day_of_week=s.get('day_of_week'),
                    period=s.get('period'),
                    duration=s.get('duration', 1),
                    start_week=s.get('start_week'),
                    end_week=s.get('end_week'),
                    week_number=s.get('week_number'),
                    specific_dates=s.get('specific_dates'),
                    faculty_id=s.get('faculty_id'),
                    semester_label=s.get('semester_label'),
                    academic_year=s.get('academic_year'),
                    semester=_normalize_semester(s.get('semester')),
                    status=s.get('status', 'scheduled'),
                    group_id=s.get('group_id'),
                    class_id=s.get('class_id'),
                    teacher_name=s.get('teacher_name'),
                    course_code=s.get('course_code')
                )
                db.merge(schedule)
            results['group_class_scheduled_classes'] = len(data['group_class_scheduled_classes'])
        
        if 'blocked_slots' in data:
            for b in data['blocked_slots']:
                slot = BlockedSlot(
                    id=b.get('id', str(uuid.uuid4())),
                    academic_year=b.get('academic_year'),
                    semester_label=b.get('semester_label'),
                    type=b.get('type'),
                    class_associations=b.get('class_associations', []),
                    week_number=b.get('week_number'),
                    specific_week_days=b.get('specific_week_days', []),
                    day_of_week=b.get('day_of_week'),
                    start_period=b.get('start_period'),
                    end_period=b.get('end_period'),
                    start_date=datetime.strptime(b['start_date'], '%Y-%m-%d').date() if b.get('start_date') else None,
                    end_date=datetime.strptime(b['end_date'], '%Y-%m-%d').date() if b.get('end_date') else None,
                    weeks=b.get('weeks'),
                    reason=b.get('reason')
                )
                db.merge(slot)
            results['blocked_slots'] = len(data['blocked_slots'])
        
        if 'classes' in data:
            for c in data['classes']:
                cls = Class(
                    id=c.get('id', str(uuid.uuid4())),
                    class_id=c.get('class_id'),
                    class_name=c.get('class_name'),
                    enrollment_year=c.get('enrollment_year'),
                    class_number=c.get('class_number'),
                    student_count=c.get('student_count', 0),
                    student_type=c.get('student_type', 'general'),
                    status=c.get('status', 'active')
                )
                db.merge(cls)
            results['classes'] = len(data['classes'])
        
        if 'semester_week_configs' in data:
            for c in data['semester_week_configs']:
                config = SemesterWeekConfig(
                    id=c.get('id', str(uuid.uuid4())),
                    academic_year=c.get('academic_year'),
                    semester_label=c.get('semester_label'),
                    start_date=datetime.strptime(c['start_date'], '%Y-%m-%d').date() if c.get('start_date') else None,
                    total_weeks=c.get('total_weeks', 16)
                )
                db.merge(config)
            results['semester_week_configs'] = len(data['semester_week_configs'])
        
        if 'student_teacher_assignments' in data:
            for a in data['student_teacher_assignments']:
                assignment = StudentTeacherAssignment(
                    id=a.get('id', str(uuid.uuid4())),
                    student_id=a.get('student_id'),
                    teacher_id=a.get('teacher_id'),
                    faculty_code=a.get('faculty_code'),
                    instrument_name=a.get('instrument_name') or a.get('instrument'),
                    assignment_type=a.get('assignment_type', 'primary'),
                    is_active=a.get('is_active', True),
                    assignment_status=a.get('assignment_status') or a.get('status', 'active'),
                    assigned_at=datetime.fromisoformat(a['assigned_at']) if a.get('assigned_at') else None,
                    effective_date=datetime.strptime(a['effective_date'], '%Y-%m-%d').date() if a.get('effective_date') else None,
                    ended_at=datetime.fromisoformat(a['ended_at']) if a.get('ended_at') else None,
                    assigned_by=a.get('assigned_by'),
                    created_at=datetime.fromisoformat(a['created_at']) if a.get('created_at') else None,
                    updated_at=datetime.fromisoformat(a['updated_at']) if a.get('updated_at') else None
                )
                db.merge(assignment)
            results['student_teacher_assignments'] = len(data['student_teacher_assignments'])
        
        if 'users' in data:
            for u in data['users']:
                # 检查用户是否已存在（通过 teacher_id）
                existing_user = db.query(User).filter(User.teacher_id == u.get('teacher_id')).first()
                if existing_user:
                    # 更新现有用户
                    existing_user.email = u.get('email') or existing_user.email
                    existing_user.full_name = u.get('full_name') or existing_user.full_name
                    existing_user.department = u.get('department') or existing_user.department
                    existing_user.faculty_id = u.get('faculty_id') or existing_user.faculty_id
                    existing_user.faculty_code = u.get('faculty_code') or existing_user.faculty_code
                    existing_user.specialty = u.get('specialty', []) or existing_user.specialty
                    existing_user.is_admin = u.get('is_admin', existing_user.is_admin)
                else:
                    # 创建新用户
                    user = User(
                        id=u.get('id', str(uuid.uuid4())),
                        teacher_id=u.get('teacher_id'),
                        email=u.get('email'),
                        password=u.get('password', hash_password(u.get('teacher_id', '123456'))),
                        full_name=u.get('full_name'),
                        department=u.get('department'),
                        faculty_id=u.get('faculty_id'),
                        faculty_code=u.get('faculty_code'),
                        specialty=u.get('specialty', []),
                        is_admin=u.get('is_admin', False)
                    )
                    db.add(user)
            results['users'] = len(data['users'])
        
        if 'large_class_schedules' in data:
            for s in data['large_class_schedules']:
                schedule = LargeClassSchedule(
                    id=s.get('id', str(uuid.uuid4())),
                    file_name=s.get('file_name'),
                    academic_year=s.get('academic_year'),
                    semester_label=s.get('semester_label'),
                    entries=s.get('entries', []),
                    imported_at=datetime.fromisoformat(s['imported_at']) if s.get('imported_at') else None
                )
                db.merge(schedule)
            results['large_class_schedules'] = len(data['large_class_schedules'])
        
        # student_major_assignments 是学生数据的摘要，不需要单独导入
        # 数据已包含在学生表的 assigned_teachers 字段中
        
        db.commit()
        return jsonify({'message': 'Data imported successfully', 'results': results})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()

@api_bp.route('/sync/clear', methods=['POST'])
def clear_all_data():
    db = next(get_db())
    try:
        db.query(ScheduledClass).delete()
        db.query(BlockedSlot).delete()
        db.query(Course).delete()
        db.query(Student).delete()
        db.query(Teacher).delete()
        db.query(Room).delete()
        db.query(Class).delete()
        db.query(StudentTeacherAssignment).delete()
        db.query(SemesterWeekConfig).delete()
        db.commit()
        return jsonify({'message': 'All data cleared successfully'})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()


@api_bp.route('/sync/fix-teacher-ids', methods=['POST'])
def fix_teacher_ids():
    """修复学生数据中的teacher_id字段，将临时ID转换为工号"""
    db = next(get_db())
    try:
        # 建立教师姓名到工号的映射
        teachers = db.query(Teacher).all()
        teacher_name_to_id = {t.name: t.teacher_id for t in teachers if t.name and t.teacher_id}
        
        # 修复学生数据
        students = db.query(Student).all()
        fixed_count = 0
        
        for student in students:
            # 修复顶层的teacher_id
            if student.teacher_id and not student.teacher_id.isdigit():
                # 尝试从assigned_teachers中获取正确的teacher_id
                if student.assigned_teachers and student.assigned_teachers.get('primary_teacher_id'):
                    new_teacher_id = student.assigned_teachers['primary_teacher_id']
                    if new_teacher_id.isdigit():
                        student.teacher_id = new_teacher_id
                        fixed_count += 1
                        continue
                
                # 尝试从teacher_name字段获取
                if hasattr(student, 'teacher_name') and student.teacher_name:
                    new_teacher_id = teacher_name_to_id.get(student.teacher_name)
                    if new_teacher_id:
                        student.teacher_id = new_teacher_id
                        fixed_count += 1
        
        db.commit()
        return jsonify({
            'message': f'Fixed {fixed_count} student teacher_id fields',
            'fixed_count': fixed_count
        })
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()
