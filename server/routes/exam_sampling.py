from flask import request, jsonify, Response
from models.database import get_db
from models.student import Student
from models.teacher import Teacher
from models.student_teacher_assignment import StudentTeacherAssignment
from . import api_bp
import csv
import io
import random
from collections import OrderedDict

SEED = 42

def get_teacher_student_data(db):
    assignments = db.query(StudentTeacherAssignment).filter(
        StudentTeacherAssignment.is_active == True,
        StudentTeacherAssignment.assignment_status == 'active'
    ).all()

    teacher_ids = set()
    for a in assignments:
        teacher_ids.add(a.teacher_id)

    teachers = db.query(Teacher).filter(
        (Teacher.teacher_id.in_(teacher_ids)) | (Teacher.id.in_(teacher_ids))
    ).all()

    teacher_id_to_name = {}
    for t in teachers:
        teacher_id_to_name[t.teacher_id] = t.name
        teacher_id_to_name[t.id] = t.name

    students = db.query(Student).all()
    student_map = {}
    for s in students:
        student_map[s.student_id] = s

    data = []
    for a in assignments:
        s = student_map.get(a.student_id)
        if not s:
            continue
        teacher_name = teacher_id_to_name.get(a.teacher_id, '未知教师')
        student_type = '主项' if a.assignment_type == 'primary' else '副项'
        data.append({
            '教师姓名': teacher_name,
            '学生姓名': s.name,
            '学生类型': student_type,
            '班级': s.major_class or '',
            '学生唯一标识': f"{s.name}_{s.major_class or ''}",
        })
    return data


def run_extraction(data, total_slots=97, seed=SEED, base_per_teacher=1,
                   class_balance_teachers=None):
    if class_balance_teachers is None:
        class_balance_teachers = ['徐颖', '王武', '林琳', '吴玉敏', '杨柳']

    random.seed(seed)

    keep_rows = []
    seen = set()
    for row in data:
        key = (row['教师姓名'], row['学生唯一标识'])
        if key in seen:
            continue
        seen.add(key)
        keep_rows.append(row)

    deduped = keep_rows

    teacher_mapping = OrderedDict()
    for teacher in sorted(set(r['教师姓名'] for r in deduped)):
        students = [r for r in deduped if r['教师姓名'] == teacher]
        teacher_mapping[teacher] = {
            'count': len(students),
            'students': students
        }

    total_mapped = sum(info['count'] for info in teacher_mapping.values())

    remaining = total_slots - len(teacher_mapping) * base_per_teacher

    quota_floor = {}
    quotients = []
    for teacher, info in teacher_mapping.items():
        exact = remaining * info['count'] / total_mapped if total_mapped > 0 else 0
        floor_val = int(exact)
        remainder = exact - floor_val
        quota_floor[teacher] = floor_val
        quotients.append((teacher, remainder, exact, floor_val))

    allocated = sum(quota_floor.values())
    remaining_slots = remaining - allocated
    quotients.sort(key=lambda x: -x[1])
    for i in range(remaining_slots):
        quota_floor[quotients[i][0]] += 1

    allocations = {}
    for teacher in teacher_mapping:
        allocations[teacher] = base_per_teacher + quota_floor[teacher]

    draw_order = sorted(teacher_mapping.keys(), key=lambda t: teacher_mapping[t]['count'])
    selected_global = set()
    results = []

    for teacher in draw_order:
        need = allocations[teacher]
        available = [s for s in teacher_mapping[teacher]['students']
                     if s['学生唯一标识'] not in selected_global]
        random.shuffle(available)
        drawn = available[:need]
        for s in drawn:
            selected_global.add(s['学生唯一标识'])
            results.append({
                '教师': teacher,
                '学生姓名': s['学生姓名'],
                '学生类型': s['学生类型'],
                '班级': s['班级'],
            })

    def get_teacher_type_counts(results_for_teacher):
        majors = sum(1 for r in results_for_teacher if r['学生类型'] == '主项')
        minors = sum(1 for r in results_for_teacher if r['学生类型'] == '副项')
        return majors, minors

    redraw_teachers = set()
    for teacher in draw_order:
        info = teacher_mapping[teacher]
        has_both = any(s['学生类型'] == '主项' for s in info['students']) and any(
            s['学生类型'] == '副项' for s in info['students'])
        if not has_both:
            continue
        t_results = [r for r in results if r['教师'] == teacher]
        major_cnt, minor_cnt = get_teacher_type_counts(t_results)
        if major_cnt > 0 and minor_cnt > 0:
            continue
        redraw_teachers.add(teacher)

    redraw_ids = set()
    for r in results[:]:
        if r['教师'] in redraw_teachers:
            redraw_ids.add(r['学生姓名'] + '_' + r['班级'])
    results = [r for r in results if r['教师'] not in redraw_teachers]
    selected_global = set(r['学生姓名'] + '_' + r['班级'] for r in results)

    redraw_order = sorted(redraw_teachers, key=lambda t: teacher_mapping[t]['count'])
    for teacher in redraw_order:
        need = allocations[teacher]
        info = teacher_mapping[teacher]
        avail_all = [s for s in info['students'] if s['学生唯一标识'] not in selected_global]
        avail_major = [s for s in avail_all if s['学生类型'] == '主项']
        avail_minor = [s for s in avail_all if s['学生类型'] == '副项']
        pool_has_both = any(s['学生类型'] == '主项' for s in info['students']) and any(
            s['学生类型'] == '副项' for s in info['students'])

        drawn = []
        if need == 1 or not pool_has_both:
            random.shuffle(avail_all)
            drawn = avail_all[:need]
        elif len(avail_major) > 0 and len(avail_minor) > 0:
            random.shuffle(avail_major)
            random.shuffle(avail_minor)
            drawn.append(avail_major[0])
            drawn.append(avail_minor[0])
            if need > 2:
                taken = {d['学生唯一标识'] for d in drawn}
                rest = [s for s in avail_all if s['学生唯一标识'] not in taken]
                random.shuffle(rest)
                drawn.extend(rest[:need - 2])
        elif len(avail_major) > 0:
            random.shuffle(avail_major)
            drawn = avail_major[:need]
        elif len(avail_minor) > 0:
            random.shuffle(avail_minor)
            drawn = avail_minor[:need]
        else:
            random.shuffle(avail_all)
            drawn = avail_all[:need]

        for s in drawn:
            selected_global.add(s['学生唯一标识'])
            results.append({
                '教师': teacher,
                '学生姓名': s['学生姓名'],
                '学生类型': s['学生类型'],
                '班级': s['班级'],
            })

    class_totals = {}
    for row in deduped:
        cls = row['班级']
        class_totals[cls] = class_totals.get(cls, 0) + 1

    class_counts = {}
    for r in results:
        cls = r['班级']
        class_counts[cls] = class_counts.get(cls, 0) + 1

    ideal_counts = {}
    for cls in sorted(class_counts.keys()):
        total = class_totals.get(cls, 1)
        ideal_counts[cls] = round(total / 3)

    over_classes = [cls for cls in sorted(class_counts.keys())
                    if class_counts[cls] - ideal_counts[cls] >= 2]
    under_classes = [cls for cls in sorted(class_counts.keys())
                     if class_counts[cls] - ideal_counts[cls] <= -2]

    if over_classes and under_classes:
        under_needs = {cls: ideal_counts[cls] - class_counts[cls] for cls in under_classes}
        under_priority = sorted(under_needs.keys(), key=lambda c: -under_needs[c])

        for over_cls in over_classes:
            surplus = class_counts[over_cls] - ideal_counts[over_cls]
            for _ in range(surplus):
                swap_made = False
                for under_cls in sorted(under_priority, key=lambda c: -under_needs[c]):
                    if under_needs[under_cls] <= 0:
                        continue
                    for teacher in class_balance_teachers:
                        t_info = teacher_mapping.get(teacher)
                        if not t_info:
                            continue
                        over_students = [r for r in results
                                         if r['教师'] == teacher and r['班级'] == over_cls]
                        for over_s in over_students:
                            over_type = over_s['学生类型']
                            t_results = [r for r in results if r['教师'] == teacher]
                            maj_cnt, min_cnt = get_teacher_type_counts(t_results)
                            if over_type == '主项' and maj_cnt <= 1:
                                continue
                            if over_type == '副项' and min_cnt <= 1:
                                continue
                            avail = [s for s in t_info['students']
                                     if s['班级'] == under_cls and s['学生类型'] == over_type
                                     and s['学生唯一标识'] not in selected_global]
                            if avail:
                                random.shuffle(avail)
                                new_s = avail[0]
                                idx = next(i for i, r in enumerate(results)
                                           if r['教师'] == teacher
                                           and r['学生姓名'] == over_s['学生姓名'])
                                old_id = results[idx]['学生姓名'] + '_' + results[idx]['班级']
                                selected_global.discard(old_id)
                                results[idx] = {
                                    '教师': teacher,
                                    '学生姓名': new_s['学生姓名'],
                                    '学生类型': new_s['学生类型'],
                                    '班级': new_s['班级'],
                                }
                                selected_global.add(new_s['学生唯一标识'])
                                under_needs[under_cls] -= 1
                                class_counts[over_cls] -= 1
                                swap_made = True
                                break
                        if swap_made:
                            break
                    if swap_made:
                        break

    return results


@api_bp.route('/exam-sampling/extract', methods=['POST'])
def extract_students():
    db = next(get_db())
    try:
        data = request.get_json() or {}
        total_slots = int(data.get('total_slots', 97))
        seed = int(data.get('seed', SEED))
        base_per_teacher = int(data.get('base_per_teacher', 1))
        class_balance_teachers = data.get('class_balance_teachers',
                                          ['徐颖', '王武', '林琳', '吴玉敏', '杨柳'])

        teacher_student_data = get_teacher_student_data(db)
        if not teacher_student_data:
            return jsonify({'error': '未找到教师-学生分配数据，请先导入学生和教师数据'}), 400

        results = run_extraction(
            teacher_student_data,
            total_slots=total_slots,
            seed=seed,
            base_per_teacher=base_per_teacher,
            class_balance_teachers=class_balance_teachers,
        )

        teacher_coverage = set(r['教师'] for r in results)
        all_teachers = set(r['教师姓名'] for r in teacher_student_data)
        missing_teachers = all_teachers - teacher_coverage

        class_counts = {}
        for r in results:
            cls = r['班级']
            class_counts[cls] = class_counts.get(cls, 0) + 1

        return jsonify({
            'results': results,
            'total': len(results),
            'teacher_coverage': len(teacher_coverage),
            'total_teachers': len(all_teachers),
            'missing_teachers': sorted(list(missing_teachers)),
            'class_distribution': {k: v for k, v in sorted(class_counts.items())},
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()


@api_bp.route('/exam-sampling/export-csv', methods=['POST'])
def export_csv():
    db = next(get_db())
    try:
        data = request.get_json() or {}
        total_slots = int(data.get('total_slots', 97))
        seed = int(data.get('seed', SEED))
        base_per_teacher = int(data.get('base_per_teacher', 1))
        class_balance_teachers = data.get('class_balance_teachers',
                                          ['徐颖', '王武', '林琳', '吴玉敏', '杨柳'])

        teacher_student_data = get_teacher_student_data(db)
        if not teacher_student_data:
            return jsonify({'error': '未找到教师-学生分配数据'}), 400

        results = run_extraction(
            teacher_student_data,
            total_slots=total_slots,
            seed=seed,
            base_per_teacher=base_per_teacher,
            class_balance_teachers=class_balance_teachers,
        )

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['教师', '学生姓名', '学生类型', '班级'])
        for r in results:
            writer.writerow([r['教师'], r['学生姓名'], r['学生类型'], r['班级']])

        csv_content = output.getvalue()
        output.close()

        return Response(
            csv_content,
            mimetype='text/csv; charset=utf-8-sig',
            headers={
                'Content-Disposition': 'attachment; filename=考试抽查名单.csv',
                'Content-Type': 'text/csv; charset=utf-8-sig'
            }
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        db.close()