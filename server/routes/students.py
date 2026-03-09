from flask import request, jsonify
from models.database import get_db
from models.student import Student
from models.course import Course
from models.teacher import Teacher
from . import api_bp
import uuid

@api_bp.route('/students', methods=['GET'])
def get_students():
    db = next(get_db())
    try:
        students = db.query(Student).all()
        return jsonify([s.to_dict() for s in students])
    finally:
        db.close()

@api_bp.route('/students/<student_id>', methods=['GET'])
def get_student(student_id):
    db = next(get_db())
    try:
        student = db.query(Student).filter(Student.student_id == student_id).first()
        if not student:
            return jsonify({'error': 'Student not found'}), 404
        return jsonify(student.to_dict())
    finally:
        db.close()

@api_bp.route('/students', methods=['POST'])
def create_student():
    db = next(get_db())
    try:
        data = request.get_json()
        student = Student(
            id=str(uuid.uuid4()),
            student_id=data.get('student_id'),
            name=data.get('name'),
            teacher_id=data.get('teacher_id'),
            major_class=data.get('major_class'),
            grade=data.get('grade'),
            student_type=data.get('student_type', 'general'),
            primary_instrument=data.get('primary_instrument'),
            secondary_instruments=data.get('secondary_instruments', []),
            faculty_code=data.get('faculty_code'),
            enrollment_year=data.get('enrollment_year'),
            current_grade=data.get('current_grade'),
            student_status=data.get('student_status', 'active'),
            status=data.get('status', 'active'),
            remarks=data.get('remarks')
        )
        db.add(student)
        db.commit()
        return jsonify(student.to_dict()), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()

@api_bp.route('/students/<student_id>', methods=['PUT'])
def update_student(student_id):
    db = next(get_db())
    try:
        student = db.query(Student).filter(Student.student_id == student_id).first()
        if not student:
            return jsonify({'error': 'Student not found'}), 404

        data = request.get_json()
        old_teacher_id = student.teacher_id
        old_primary_id = None
        if student.assigned_teachers and isinstance(student.assigned_teachers, dict):
            old_primary_id = student.assigned_teachers.get('primary_teacher_id')

        for key, value in data.items():
            if hasattr(student, key) and key not in ['id', 'created_at']:
                setattr(student, key, value)

        new_teacher_id = student.teacher_id
        new_primary_id = None
        if student.assigned_teachers and isinstance(student.assigned_teachers, dict):
            new_primary_id = student.assigned_teachers.get('primary_teacher_id')
        effective_old = old_teacher_id or old_primary_id
        effective_new = new_teacher_id or new_primary_id

        if effective_old and effective_new and effective_old != effective_new:
            new_teacher = db.query(Teacher).filter(
                (Teacher.teacher_id == effective_new) | (Teacher.id == effective_new)
            ).first()
            new_teacher_name = new_teacher.name if new_teacher else None
            db.query(Course).filter(
                Course.student_id == student.student_id,
                Course.teacher_id == effective_old
            ).update({
                'teacher_id': effective_new,
                'teacher_name': new_teacher_name
            }, synchronize_session=False)

        db.commit()
        return jsonify(student.to_dict())
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()

@api_bp.route('/students/<student_id>', methods=['DELETE'])
def delete_student(student_id):
    db = next(get_db())
    try:
        student = db.query(Student).filter(Student.student_id == student_id).first()
        if not student:
            return jsonify({'error': 'Student not found'}), 404
        
        db.delete(student)
        db.commit()
        return jsonify({'message': 'Student deleted successfully'})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()

@api_bp.route('/students/batch', methods=['POST'])
def batch_create_students():
    db = next(get_db())
    try:
        data = request.get_json()
        students_data = data.get('students', [])
        created = []
        
        for s_data in students_data:
            student = Student(
                id=str(uuid.uuid4()),
                student_id=s_data.get('student_id'),
                name=s_data.get('name'),
                teacher_id=s_data.get('teacher_id'),
                major_class=s_data.get('major_class'),
                grade=s_data.get('grade'),
                student_type=s_data.get('student_type', 'general'),
                primary_instrument=s_data.get('primary_instrument'),
                secondary_instruments=s_data.get('secondary_instruments', []),
                faculty_code=s_data.get('faculty_code'),
                enrollment_year=s_data.get('enrollment_year'),
                current_grade=s_data.get('current_grade'),
                student_status=s_data.get('student_status', 'active'),
                status=s_data.get('status', 'active'),
                remarks=s_data.get('remarks')
            )
            db.add(student)
            created.append(student)
        
        db.commit()
        return jsonify([s.to_dict() for s in created]), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()
