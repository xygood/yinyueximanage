from flask import request, jsonify
from models.database import get_db
from models.schedule import ScheduledClass
from . import api_bp
import uuid
from datetime import datetime
from websocket_handlers import broadcast_schedule_created, broadcast_schedule_updated, broadcast_schedule_deleted

@api_bp.route('/schedules', methods=['GET'])
def get_schedules():
    db = next(get_db())
    try:
        teacher_id = request.args.get('teacher_id')
        week_number = request.args.get('week_number')
        
        query = db.query(ScheduledClass)
        if teacher_id:
            query = query.filter(ScheduledClass.teacher_id == teacher_id)
        if week_number:
            query = query.filter(ScheduledClass.week_number == int(week_number))
        
        schedules = query.all()
        return jsonify([s.to_dict() for s in schedules])
    finally:
        db.close()

@api_bp.route('/schedules', methods=['POST'])
def create_schedule():
    db = next(get_db())
    try:
        data = request.get_json()
        schedule = ScheduledClass(
            id=str(uuid.uuid4()),
            teacher_id=data.get('teacher_id'),
            course_id=data.get('course_id'),
            student_id=data.get('student_id'),
            room_id=data.get('room_id'),
            class_id=data.get('class_id'),
            teacher_name=data.get('teacher_name'),
            course_code=data.get('course_code'),
            day_of_week=data.get('day_of_week'),
            date=datetime.strptime(data['date'], '%Y-%m-%d').date() if data.get('date') else None,
            period=data.get('period'),
            duration=data.get('duration', 1),
            start_week=data.get('start_week'),
            end_week=data.get('end_week'),
            week_number=data.get('week_number'),
            specific_dates=data.get('specific_dates'),
            faculty_id=data.get('faculty_id'),
            semester_label=data.get('semester_label'),
            academic_year=data.get('academic_year'),
            semester=data.get('semester'),
            status=data.get('status', 'scheduled'),
            group_id=data.get('group_id')
        )
        db.add(schedule)
        db.commit()
        
        # 广播给其他客户端
        broadcast_schedule_created(schedule.to_dict())
        
        return jsonify(schedule.to_dict()), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()

# 字面量路径必须在 /schedules/<schedule_id> 之前注册，否则 POST /schedules/batch-delete 会被匹配成 schedule_id="batch-delete" 导致 405
@api_bp.route('/schedules/batch-delete', methods=['POST'])
def batch_delete_schedules():
    """批量删除排课记录，一次请求完成，加快编辑时的删除速度"""
    db = next(get_db())
    try:
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid JSON body'}), 400
        ids = data.get('ids')
        if ids is None:
            ids = []
        if not isinstance(ids, list):
            ids = [ids] if ids else []
        ids = [str(i).strip() for i in ids if i is not None and str(i).strip()]
        if not ids:
            return jsonify({'deleted': 0, 'message': 'No ids provided'})
        deleted_ids = []
        schedules = db.query(ScheduledClass).filter(ScheduledClass.id.in_(ids)).all()
        for schedule in schedules:
            deleted_ids.append(schedule.id)
            db.delete(schedule)
        db.commit()
        for sid in deleted_ids:
            broadcast_schedule_deleted(sid)
        return jsonify({'deleted': len(deleted_ids), 'ids': deleted_ids})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()

def _parse_schedule_date(val):
    if not val:
        return None
    if hasattr(val, 'isoformat'):
        return val
    try:
        return datetime.strptime(str(val)[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


@api_bp.route('/schedules/batch', methods=['POST'])
def batch_create_schedules():
    db = next(get_db())
    try:
        data = request.get_json()
        schedules_data = data.get('schedules', [])
        if not schedules_data:
            return jsonify([]), 201

        rows = []
        for s_data in schedules_data:
            row = {
                'id': str(uuid.uuid4()),
                'teacher_id': s_data.get('teacher_id'),
                'course_id': s_data.get('course_id'),
                'student_id': s_data.get('student_id'),
                'room_id': s_data.get('room_id'),
                'class_id': s_data.get('class_id'),
                'teacher_name': s_data.get('teacher_name'),
                'course_code': s_data.get('course_code'),
                'day_of_week': s_data.get('day_of_week'),
                'date': _parse_schedule_date(s_data.get('date')),
                'period': s_data.get('period'),
                'duration': s_data.get('duration', 1),
                'start_week': s_data.get('start_week'),
                'end_week': s_data.get('end_week'),
                'week_number': s_data.get('week_number'),
                'specific_dates': s_data.get('specific_dates'),
                'faculty_id': s_data.get('faculty_id'),
                'semester_label': s_data.get('semester_label'),
                'academic_year': s_data.get('academic_year'),
                'semester': s_data.get('semester'),
                'status': s_data.get('status', 'scheduled'),
                'group_id': s_data.get('group_id'),
            }
            rows.append(row)

        db.bulk_insert_mappings(ScheduledClass, rows)
        db.commit()

        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'teacher_id': r['teacher_id'],
                'course_id': r['course_id'],
                'student_id': r['student_id'],
                'room_id': r['room_id'],
                'class_id': r['class_id'],
                'teacher_name': r['teacher_name'],
                'course_code': r['course_code'],
                'day_of_week': r['day_of_week'],
                'date': r['date'].isoformat() if r['date'] else None,
                'period': r['period'],
                'duration': r['duration'],
                'start_week': r['start_week'],
                'end_week': r['end_week'],
                'week_number': r['week_number'],
                'specific_dates': r['specific_dates'],
                'faculty_id': r['faculty_id'],
                'semester_label': r['semester_label'],
                'academic_year': r['academic_year'],
                'semester': r['semester'],
                'status': r['status'],
                'group_id': r['group_id'],
                'created_at': None,
                'updated_at': None,
            })
        return jsonify(result), 201
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()


def _normalize_teacher_id(tid):
    if tid is None:
        return ''
    return str(tid).strip()


def _week_range(sc):
    """返回 (start_week, end_week) 用于判断周次重叠。"""
    if getattr(sc, 'start_week', None) is not None and getattr(sc, 'end_week', None) is not None:
        return (sc.start_week, sc.end_week)
    if getattr(sc, 'week_number', None) is not None:
        w = sc.week_number
        return (w, w)
    return (1, 16)


def _weeks_overlap(a, b):
    """两段周次 (a1,a2), (b1,b2) 是否重叠。"""
    a1, a2 = a
    b1, b2 = b
    return not (a2 < b1 or b2 < a1)


@api_bp.route('/schedules/teacher-conflicts', methods=['GET'])
def get_teacher_schedule_conflicts():
    """检查所有教师在同一时间（同一星期几、同一节次、周次重叠）是否被排了 2 节及以上课。"""
    print("=== teacher-conflicts FROM /Users/gubao/Desktop/0225/music225/server/routes/schedule.py ===")
    db = next(get_db())
    try:
        # 不再按学期过滤，直接检查所有排课记录，避免因学期字段问题漏报冲突
        all_schedules = db.query(ScheduledClass).all()

        # 先按 (教师ID规范化, day_of_week, period, week_number) 聚合到「具体某一周的某一节课」
        # 然后在同一时间点内按「小组」再分组：
        # - 新数据：用 group_id 区分小组
        # - 旧数据：没有 group_id 时，用 (course_id) 近似视为一组小组课（同一门课同一时间的一组学生）
        # 只有当同一时间点存在 2 个及以上不同小组时，才算教师时间冲突。

        # weekly_key: (tid, day_of_week, period, week)
        weekly_buckets = {}
        for sc in all_schedules:
            tid = _normalize_teacher_id(sc.teacher_id)
            if not tid:
                continue
            day = sc.day_of_week
            period = sc.period
            if day is None or period is None:
                continue

            start_week, end_week = _week_range(sc)
            # 为安全起见限制一下周次范围，避免错误数据导致极大循环
            if start_week is None or end_week is None:
                continue
            start_week = max(1, int(start_week))
            end_week = min(30, int(end_week))
            if end_week < start_week:
                continue

            for w in range(start_week, end_week + 1):
                key = (tid, day, period, w)
                weekly_buckets.setdefault(key, []).append(sc)

        conflicts = []
        for (tid, day, period, week), bucket in weekly_buckets.items():
            if len(bucket) < 2:
                continue

            # 在同一教师+星期+节次+具体周次下，按「小组」聚合
            group_key_to_items = {}
            for sc in bucket:
                gid = getattr(sc, 'group_id', None)
                if gid is not None and str(gid).strip():
                    group_key = f"G:{str(gid).strip()}"
                else:
                    course_id = str(sc.course_id).strip() if getattr(sc, 'course_id', None) else ''
                    group_key = f"C:{course_id}"

                group_key_to_items.setdefault(group_key, []).append(sc)

            if len(group_key_to_items) < 2:
                # 只有一个小组：同一组学生在这一周这一节上课，不算冲突
                continue

            # 存在两个及以上不同小组：同一周同一时间被安排了多节课，算冲突
            group_keys = list(group_key_to_items.keys())
            first_key = group_keys[0]
            second_key = group_keys[1]
            gi_items = group_key_to_items[first_key]
            gj_items = group_key_to_items[second_key]

            ri = gi_items[0]
            rj = gj_items[0]

            # 再加一层保险：如果这两个小组本质上是同一门课（course_id 完全相同），
            # 则视为同一节小组课扩展出来的多条记录，不算冲突
            ci = str(ri.course_id).strip() if getattr(ri, 'course_id', None) else ''
            cj = str(rj.course_id).strip() if getattr(rj, 'course_id', None) else ''
            if ci and ci == cj:
                continue

            teacher_name = getattr(ri, 'teacher_name', None) or getattr(rj, 'teacher_name', None) or ''
            conflicts.append({
                'teacher_id': tid,
                'teacher_name': teacher_name,
                'day_of_week': day,
                'period': period,
                'week_range_i': (week, week),
                'week_range_j': (week, week),
                'records': [
                    {'id': ri.id, 'course_id': ri.course_id, 'student_id': ri.student_id, 'course_code': getattr(ri, 'course_code', '')},
                    {'id': rj.id, 'course_id': rj.course_id, 'student_id': rj.student_id, 'course_code': getattr(rj, 'course_code', '')},
                ],
            })

        return jsonify({'conflicts': conflicts, 'count': len(conflicts)})
    finally:
        db.close()


@api_bp.route('/schedules/<schedule_id>', methods=['GET'])
def get_schedule(schedule_id):
    db = next(get_db())
    try:
        schedule = db.query(ScheduledClass).filter(ScheduledClass.id == schedule_id).first()
        if not schedule:
            return jsonify({'error': 'Schedule not found'}), 404
        return jsonify(schedule.to_dict())
    finally:
        db.close()

@api_bp.route('/schedules/<schedule_id>', methods=['PUT'])
def update_schedule(schedule_id):
    db = next(get_db())
    try:
        schedule = db.query(ScheduledClass).filter(ScheduledClass.id == schedule_id).first()
        if not schedule:
            return jsonify({'error': 'Schedule not found'}), 404
        
        data = request.get_json()
        for key, value in data.items():
            if hasattr(schedule, key) and key not in ['id', 'created_at']:
                if key == 'date' and value:
                    value = datetime.strptime(value, '%Y-%m-%d').date()
                setattr(schedule, key, value)
        
        db.commit()
        
        # 广播给其他客户端
        broadcast_schedule_updated(schedule.to_dict())
        
        return jsonify(schedule.to_dict())
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()

@api_bp.route('/schedules/<schedule_id>', methods=['DELETE'])
def delete_schedule(schedule_id):
    db = next(get_db())
    try:
        schedule = db.query(ScheduledClass).filter(ScheduledClass.id == schedule_id).first()
        if not schedule:
            return jsonify({'error': 'Schedule not found'}), 404
        
        db.delete(schedule)
        db.commit()
        
        # 广播给其他客户端
        broadcast_schedule_deleted(schedule_id)
        
        return jsonify({'message': 'Schedule deleted successfully'})
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    finally:
        db.close()
