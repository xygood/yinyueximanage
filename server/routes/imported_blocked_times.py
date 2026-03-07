from flask import Blueprint, request, jsonify
from sqlalchemy import func
from models import ImportedBlockedTime, SemesterWeekConfig
from models.database import SessionLocal
from datetime import datetime, timedelta
import json

imported_blocked_times_bp = Blueprint('imported_blocked_times', __name__)

def get_db_session():
    """获取数据库会话"""
    return SessionLocal()

def get_semester_start_date(academic_year, semester_label):
    """从数据库获取学期开始日期"""
    db = get_db_session()
    try:
        config = db.query(SemesterWeekConfig).filter(
            SemesterWeekConfig.academic_year == academic_year,
            SemesterWeekConfig.semester_label == semester_label
        ).first()
        if config and config.start_date:
            return config.start_date
        return None
    except Exception as e:
        print(f"获取学期开始日期失败: {e}")
        return None
    finally:
        db.close()

# 解析周次字符串 "3-4周; 1-2,5-9周; 17周" -> [1,2,3,4,5,6,7,8,9,17]
def parse_week_range(week_range_str):
    weeks = []
    if not week_range_str:
        return weeks
    
    parts = week_range_str.split(';')
    for part in parts:
        part = part.strip().replace('周', '')
        
        # 处理范围格式 "3-4"
        if '-' in part and ',' not in part:
            try:
                start, end = map(int, part.split('-'))
                weeks.extend(range(start, end + 1))
            except:
                pass
        # 处理逗号分隔 "1,2,5-9"
        elif ',' in part:
            sub_parts = part.split(',')
            for sub in sub_parts:
                sub = sub.strip()
                if '-' in sub:
                    try:
                        start, end = map(int, sub.split('-'))
                        weeks.extend(range(start, end + 1))
                    except:
                        pass
                else:
                    try:
                        weeks.append(int(sub))
                    except:
                        pass
        # 单周
        else:
            try:
                weeks.append(int(part))
            except:
                pass
    
    return sorted(list(set(weeks)))

# 标准化班级名称
def normalize_class_name(class_name):
    if not class_name:
        return ''
    return class_name.strip()

# 处理班级名称，去掉"音乐学"前缀
def process_class_name(name):
    if name and isinstance(name, str) and name.startswith('音乐学'):
        return name.replace('音乐学', '')
    return name

# 转换 blocked_slots
def convert_blocked_slot(slot):
    day_of_week = slot.get('day_of_week')
    
    # 处理班级名称，去掉"音乐学"前缀
    class_associations = slot.get('class_associations', [])
    processed_class_associations = []
    for assoc in class_associations:
        processed_assoc = assoc.copy()
        if 'name' in processed_assoc:
            processed_assoc['name'] = process_class_name(processed_assoc['name'])
        processed_class_associations.append(processed_assoc)
    
    # 如果有明确的星期，直接返回
    if day_of_week is not None:
        return [{
            'academic_year': slot.get('academic_year', '2025-2026'),
            'semester_label': slot.get('semester_label', '2025-2026-2'),
            'class_associations': processed_class_associations,
            'weeks': parse_week_range(slot.get('weeks')),
            'day_of_week': day_of_week,
            'periods': list(range(
                slot.get('start_period', 1),
                slot.get('end_period', 10) + 1
            )) if slot.get('start_period') else [],
            'reason': slot.get('reason', '禁排时间'),
            'source_type': 'system_blocked',
            'course_name': None,
            'teacher_name': None,
            'location': None,
            'raw_data': slot
        }]
    
    # 检查是否有 specific_week_days 字段（指定特定周和星期）
    specific_week_days = slot.get('specific_week_days', [])
    if specific_week_days and len(specific_week_days) > 0:
        records = []
        for swd in specific_week_days:
            week = swd.get('week')
            day = swd.get('day')
            if week and day:
                records.append({
                    'academic_year': slot.get('academic_year', '2025-2026'),
                    'semester_label': slot.get('semester_label', '2025-2026-2'),
                    'class_associations': processed_class_associations,
                    'weeks': [week],
                    'day_of_week': day,
                    'periods': list(range(
                        slot.get('start_period', 1),
                        slot.get('end_period', 10) + 1
                    )) if slot.get('start_period') else [],
                    'reason': slot.get('reason', '禁排时间'),
                    'source_type': 'system_blocked',
                    'course_name': None,
                    'teacher_name': None,
                    'location': None,
                    'raw_data': slot
                })
        if records:
            return records
    
    # 如果没有指定星期，但有日期范围，根据日期计算星期和周次
    start_date_str = slot.get('start_date')
    end_date_str = slot.get('end_date')
    
    if start_date_str and end_date_str:
        try:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
            
            records = []
            current_date = start_date
            
            # 从数据库获取学期开始日期
            academic_year = slot.get('academic_year', '2025-2026')
            semester_label = slot.get('semester_label', '2025-2026-2')
            semester_start_date = get_semester_start_date(academic_year, semester_label)
            
            if not semester_start_date:
                print(f"警告: 未找到学期开始日期配置 {academic_year} {semester_label}，跳过日期范围处理")
                # 如果没有学期配置，使用原始周次数据
                return [{
                    'academic_year': academic_year,
                    'semester_label': semester_label,
                    'class_associations': processed_class_associations,
                    'weeks': parse_week_range(slot.get('weeks')),
                    'day_of_week': 1,  # 默认周一
                    'periods': list(range(
                        slot.get('start_period', 1),
                        slot.get('end_period', 10) + 1
                    )) if slot.get('start_period') else [],
                    'reason': slot.get('reason', '禁排时间'),
                    'source_type': 'system_blocked',
                    'course_name': None,
                    'teacher_name': None,
                    'location': None,
                    'raw_data': slot
                }]
            
            semester_start = datetime.combine(semester_start_date, datetime.min.time())
            
            # 遍历日期范围内的每一天
            while current_date <= end_date:
                # Python的weekday(): 周一=0, 周日=6
                # 我们需要: 周一=1, 周日=7
                weekday = current_date.weekday() + 1
                
                # 计算周次
                days_diff = (current_date - semester_start).days
                week_number = max(1, (days_diff // 7) + 1)
                
                records.append({
                    'academic_year': slot.get('academic_year', '2025-2026'),
                    'semester_label': slot.get('semester_label', '2025-2026-2'),
                    'class_associations': processed_class_associations,
                    'weeks': [week_number],
                    'day_of_week': weekday,
                    'periods': list(range(
                        slot.get('start_period', 1),
                        slot.get('end_period', 10) + 1
                    )) if slot.get('start_period') else [],
                    'reason': slot.get('reason', '禁排时间'),
                    'source_type': 'system_blocked',
                    'course_name': None,
                    'teacher_name': None,
                    'location': None,
                    'raw_data': slot
                })
                
                current_date += timedelta(days=1)
            
            return records
        except Exception as e:
            print(f"日期解析错误: {e}")
            # 如果日期解析失败，生成全周7条记录
            pass
    
    # 默认生成全周7条记录（周一到周日）
    records = []
    for day in range(1, 8):
        records.append({
            'academic_year': slot.get('academic_year', '2025-2026'),
            'semester_label': slot.get('semester_label', '2025-2026-2'),
            'class_associations': processed_class_associations,
            'weeks': parse_week_range(slot.get('weeks')),
            'day_of_week': day,
            'periods': list(range(
                slot.get('start_period', 1),
                slot.get('end_period', 10) + 1
            )) if slot.get('start_period') else [],
            'reason': slot.get('reason', '禁排时间'),
            'source_type': 'system_blocked',
            'course_name': None,
            'teacher_name': None,
            'location': None,
            'raw_data': slot
        })
    return records

# 转换 large_class_schedules（通适大课）
def convert_large_class_entry(entry, academic_year, semester_label):
    # 去掉"音乐学"前缀，只保留班级编号
    class_name = entry.get('class_name', '')
    if class_name.startswith('音乐学'):
        class_name = class_name.replace('音乐学', '')
    
    return {
        'academic_year': academic_year,
        'semester_label': semester_label,
        'class_associations': [{'name': class_name}],
        'weeks': parse_week_range(entry.get('week_range')),
        'day_of_week': entry.get('day_of_week'),
        'periods': list(range(entry.get('period_start', 1), entry.get('period_end', entry.get('period_start', 1)) + 1)) if entry.get('period_start') else [],
        'reason': '通适大课',
        'source_type': 'large_class',
        'course_name': entry.get('course_name'),
        'teacher_name': entry.get('teacher_name'),
        'location': entry.get('location'),
        'raw_data': entry
    }

@imported_blocked_times_bp.route('/import-blocked-times', methods=['POST'])
def import_blocked_times():
    try:
        data = request.json
        backup_data = data.get('backup_data', {})
        
        imported_count = 0
        records_to_insert = []
        
        # 提取课程信息，用于判断是专业大课还是通适大课
        major_class_courses = backup_data.get('data', {}).get('major_class_courses', [])
        course_category_map = {}
        for course in major_class_courses:
            course_id = course.get('id')
            course_category = course.get('course_category')
            if course_id and course_category:
                course_category_map[course_id] = course_category
        
        # 1. 处理 blocked_slots（系统禁排）
        blocked_slots = backup_data.get('data', {}).get('blocked_slots', [])
        for slot in blocked_slots:
            records = convert_blocked_slot(slot)
            records_to_insert.extend(records)
        
        # 2. 处理 large_class_schedules（通适大课）
        large_class_schedules = backup_data.get('data', {}).get('large_class_schedules', [])
        for schedule in large_class_schedules:
            academic_year = schedule.get('academic_year', '2025-2026')
            semester_label = schedule.get('semester_label', '2025-2026-2')
            
            for entry in schedule.get('entries', []):
                record = convert_large_class_entry(entry, academic_year, semester_label)
                records_to_insert.append(record)
        
        # 3. 处理 major_class_scheduled_classes（专业大课）
        major_class_schedules = backup_data.get('data', {}).get('major_class_scheduled_classes', [])
        for entry in major_class_schedules:
            # 从单条记录中提取信息
            class_id = entry.get('class_id', '')
            # 去掉"音乐学"前缀，只保留班级编号
            if isinstance(class_id, str) and class_id.startswith('音乐学'):
                class_id = class_id.replace('音乐学', '')
            
            record = {
                'academic_year': '2025-2026',
                'semester_label': '2025-2026-2',
                'class_associations': [{'name': class_id}],
                'weeks': [entry.get('week_number', 1)],
                'day_of_week': entry.get('day_of_week', 1),
                'periods': [entry.get('period', 1)],
                'reason': '专业大课',
                'source_type': 'large_class',
                'course_name': entry.get('course_id', ''),
                'teacher_name': entry.get('teacher_name', ''),
                'location': None,
                'raw_data': entry
            }
            records_to_insert.append(record)
        
        # 3. 批量插入数据库
        if records_to_insert:
            db = get_db_session()
            try:
                for record_data in records_to_insert:
                    record = ImportedBlockedTime(**record_data)
                    db.add(record)
                
                db.commit()
                imported_count = len(records_to_insert)
            except Exception as e:
                db.rollback()
                raise e
            finally:
                db.close()
        
        return jsonify({
            'success': True,
            'imported_count': imported_count,
            'message': f'成功导入 {imported_count} 条禁排数据'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@imported_blocked_times_bp.route('/imported-blocked-times', methods=['GET'])
def get_imported_blocked_times():
    try:
        db = get_db_session()
        try:
            # 获取查询参数
            class_name = request.args.get('class_name')
            teacher_name = request.args.get('teacher_name')
            
            query = db.query(ImportedBlockedTime)
            
            # 按班级筛选
            if class_name:
                # 使用 JSON_CONTAINS 或类似方法筛选
                query = query.filter(
                    ImportedBlockedTime.class_associations.contains([{'name': class_name}])
                )
            
            # 按教师筛选
            if teacher_name:
                query = query.filter(ImportedBlockedTime.teacher_name == teacher_name)
            
            results = query.order_by(ImportedBlockedTime.created_at.desc()).all()
            
            return jsonify({
                'success': True,
                'data': [r.to_dict() for r in results]
            })
        finally:
            db.close()
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@imported_blocked_times_bp.route('/imported-blocked-times/list', methods=['GET'])
def get_imported_blocked_times_list():
    try:
        db = get_db_session()
        try:
            # 获取查询参数
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 10000))  # 默认返回10000条，相当于所有数据
            class_name = request.args.get('class_name', '')
            week = request.args.get('week', '')
            day_of_week = request.args.get('day_of_week', '')
            reason = request.args.get('reason', '')
            
            query = db.query(ImportedBlockedTime)
            
            # 班级筛选 - 使用JSONB的@>操作符进行精确匹配
            if class_name:
                query = query.filter(
                    ImportedBlockedTime.class_associations.contains([{'name': class_name}])
                )
            
            # 周次筛选
            if week:
                query = query.filter(ImportedBlockedTime.weeks.contains([int(week)]))
            
            # 星期筛选
            if day_of_week:
                query = query.filter(ImportedBlockedTime.day_of_week == int(day_of_week))
            
            # 原因筛选（模糊查询）
            if reason:
                query = query.filter(ImportedBlockedTime.reason.ilike(f'%{reason}%'))
            
            # 获取总数
            total_count = query.count()
            
            # 分页
            results = query.order_by(ImportedBlockedTime.created_at.desc()) \
                          .offset((page - 1) * page_size) \
                          .limit(page_size) \
                          .all()
            
            total_pages = (total_count + page_size - 1) // page_size
            
            return jsonify({
                'success': True,
                'data': [r.to_dict() for r in results],
                'pagination': {
                    'page': page,
                    'page_size': page_size,
                    'total_count': total_count,
                    'total_pages': total_pages
                }
            })
        finally:
            db.close()
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@imported_blocked_times_bp.route('/imported-blocked-times/<id>', methods=['DELETE'])
def delete_imported_blocked_time(id):
    try:
        db = get_db_session()
        try:
            record = db.query(ImportedBlockedTime).filter(ImportedBlockedTime.id == id).first()
            if not record:
                return jsonify({
                    'success': False,
                    'error': '记录不存在'
                }), 404
            
            db.delete(record)
            db.commit()
            
            return jsonify({
                'success': True,
                'message': '删除成功'
            })
        finally:
            db.close()
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@imported_blocked_times_bp.route('/imported-blocked-times/clear', methods=['POST'])
def clear_imported_blocked_times():
    try:
        db = get_db_session()
        try:
            # 获取删除前的数量
            count = db.query(ImportedBlockedTime).count()
            
            # 清空所有数据
            db.query(ImportedBlockedTime).delete()
            db.commit()
            
            return jsonify({
                'success': True,
                'message': '已清空所有禁排数据',
                'deleted_count': count
            })
        finally:
            db.close()
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
