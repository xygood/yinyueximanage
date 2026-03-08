from datetime import timedelta
from typing import Dict, List, Optional
import io
import os
import re
import traceback

from flask import request, jsonify, send_file
from sqlalchemy import or_, func
from sqlalchemy.exc import OperationalError

from models import (
    TeachingCalendarHeader,
    TeachingCalendarEntry,
    GradeTeachingContent,
    ScheduledClass,
    SemesterWeekConfig,
    ImportedBlockedTime,
    Course,
    Teacher,
    Class,
    Student,
)
from models.database import get_db
from . import api_bp

try:
    from docx import Document  # type: ignore
    from docx.shared import Pt  # type: ignore
    from docx.enum.table import WD_ALIGN_VERTICAL  # type: ignore
except ImportError:  # pragma: no cover - 运行环境未安装 python-docx 时，仅导出接口会失败
    Document = None  # type: ignore
    Pt = None  # type: ignore
    WD_ALIGN_VERTICAL = None  # type: ignore


# 计算教学日历模板的绝对路径（优先项目根目录，其次 server 目录）
SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(SERVER_DIR)
_TEMPLATE_CANDIDATES = [
    os.path.join(PROJECT_ROOT, "教学日历模板.docx"),
    os.path.join(SERVER_DIR, "教学日历模板.docx"),
]
TEMPLATE_PATH = next((p for p in _TEMPLATE_CANDIDATES if os.path.exists(p)), _TEMPLATE_CANDIDATES[0])

# 周次数字转中文大写（一、二、三……十六）
WEEK_CN = ("一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八")

# 星期数字转中文
DAY_CN = ("", "一", "二", "三", "四", "五", "六", "日")


def _schedule_belongs_to_class(s, class_id: str, db) -> bool:
    """判断一条排课是否属于指定班级（避免多班合并显示）。"""
    if not class_id:
        return True
    cid = (class_id or "").strip()
    if not cid:
        return True
    sc_cls = (getattr(s, "class_id", None) or "").strip() or None
    cid_alt = cid.replace("音乐学", "", 1).strip() if cid.startswith("音乐学") else f"音乐学{cid}"
    if sc_cls:
        if sc_cls == cid or sc_cls == cid_alt:
            return True
        if sc_cls.replace("音乐学", "", 1).strip() == cid_alt.replace("音乐学", "", 1).strip():
            return True
    if getattr(s, "student_id", None):
        st = db.query(Student).filter(Student.student_id == s.student_id).first()
        if st and getattr(st, "major_class", None):
            mc = (st.major_class or "").strip()
            if mc == cid or mc == cid_alt:
                return True
    return False


def _format_schedule_time_summary(schedules: List, for_group: bool = False) -> str:
    """
    从排课结果直接拼出排课时间文案。
    - for_group=True（小组课）：整组合并为一行，与排课结果一致（图2正确显示）。
    - for_group=False（专业大课）：按周次段分组，不同周次对应不同时段时分段显示。
    """
    if not schedules:
        return ""
    from collections import defaultdict

    if for_group:
        week_ranges, time_slots = [], set()
        for s in schedules:
            start_w = getattr(s, "start_week", None)
            end_w = getattr(s, "end_week", None)
            if start_w is not None and end_w is not None:
                week_ranges.append((start_w, end_w))
            elif getattr(s, "week_number", None) is not None:
                week_ranges.append((s.week_number, s.week_number))
            elif start_w is not None:
                week_ranges.append((start_w, start_w))
            dow = getattr(s, "day_of_week", None) or 0
            period = getattr(s, "period", None) or 0
            duration = getattr(s, "duration", None) or 1
            if dow and period:
                time_slots.add((dow, period, period + duration - 1))
        if not week_ranges and not time_slots:
            return ""
        week_ranges.sort(key=lambda x: (x[0], x[1]))
        merged_w = []
        for a, b in week_ranges:
            if merged_w and a <= merged_w[-1][1] + 1:
                merged_w[-1] = (merged_w[-1][0], max(merged_w[-1][1], b))
            else:
                merged_w.append((a, b))
        week_str = "、".join(f"第{s}-{e}周" if s != e else f"第{s}周" for s, e in merged_w)
        sorted_slots = sorted(time_slots, key=lambda x: (x[0], x[1]))
        merged_slots = []
        for (dow, p1, p2) in sorted_slots:
            if merged_slots and merged_slots[-1][0] == dow and merged_slots[-1][2] + 1 == p1:
                merged_slots[-1] = (dow, merged_slots[-1][1], p2)
            else:
                merged_slots.append((dow, p1, p2))
        slot_strs = [f"周{(DAY_CN[dow] if 1 <= dow <= 7 else str(dow))}第{p1}-{p2}节" if p2 > p1 else f"周{(DAY_CN[dow] if 1 <= dow <= 7 else str(dow))}第{p1}节" for (dow, p1, p2) in merged_slots]
        return f"{week_str} {'；'.join(slot_strs)}"

    # 专业大课：按 (start_week, end_week) 分组
    segment_slots: Dict[tuple, set] = defaultdict(set)
    segment_weeks: Dict[tuple, List[tuple]] = defaultdict(list)
    for s in schedules:
        start_w = getattr(s, "start_week", None)
        end_w = getattr(s, "end_week", None)
        if start_w is not None and end_w is not None:
            key = (start_w, end_w)
        elif getattr(s, "week_number", None) is not None:
            w = s.week_number
            key = (w, w)
        elif start_w is not None:
            key = (start_w, start_w)
        else:
            continue
        segment_weeks[key].append((start_w, end_w))
        dow = getattr(s, "day_of_week", None) or 0
        period = getattr(s, "period", None) or 0
        duration = getattr(s, "duration", None) or 1
        if dow and period:
            end_p = period + duration - 1
            segment_slots[key].add((dow, period, end_p))
    if not segment_slots:
        return ""
    # 合并周次段：若两个 key 的 time_slots 相同，合并其周次范围
    slots_to_weeks: Dict[frozenset, List[tuple]] = defaultdict(list)
    for key, slots in segment_slots.items():
        k = frozenset(slots)
        for (a, b) in segment_weeks[key]:
            slots_to_weeks[k].append((a, b))
    parts = []
    for slots, week_ranges in slots_to_weeks.items():
        week_ranges.sort(key=lambda x: (x[0], x[1]))
        merged_w: List[tuple] = []
        for a, b in week_ranges:
            if merged_w and a <= merged_w[-1][1] + 1:
                merged_w[-1] = (merged_w[-1][0], max(merged_w[-1][1], b))
            else:
                merged_w.append((a, b))
        week_str = "、".join(f"第{s}-{e}周" if s != e else f"第{s}周" for s, e in merged_w)
        sorted_slots = sorted(slots, key=lambda x: (x[0], x[1]))
        merged_slots: List[tuple] = []
        for (dow, p1, p2) in sorted_slots:
            if merged_slots and merged_slots[-1][0] == dow and merged_slots[-1][2] + 1 == p1:
                merged_slots[-1] = (dow, merged_slots[-1][1], p2)
            else:
                merged_slots.append((dow, p1, p2))
        slot_strs = []
        for (dow, p1, p2) in merged_slots:
            day_cn = DAY_CN[dow] if 1 <= dow <= 7 else str(dow)
            if p2 > p1:
                slot_strs.append(f"周{day_cn}第{p1}-{p2}节")
            else:
                slot_strs.append(f"周{day_cn}第{p1}节")
        parts.append(f"{week_str} {('；'.join(slot_strs))}")
    return "；".join(parts)


def _week_to_chinese(week_number: Optional[int]) -> str:
    if week_number is None or week_number < 1:
        return ""
    return WEEK_CN[week_number - 1] if week_number <= len(WEEK_CN) else str(week_number)


def _normalize_class_display_name(name: str) -> str:
    """展示时只保留班级主名，去掉末尾 -数字 细分组后缀（如 音乐学2402-8 -> 音乐学2402）。"""
    if not name or not isinstance(name, str):
        return name or ""
    s = name.strip()
    # 去掉末尾的 -数字 或 -数字 形式
    while s and "-" in s:
        tail = s.rsplit("-", 1)[-1]
        if tail.isdigit():
            s = s[: -(len(tail) + 1)].strip()
        else:
            break
    return s or name


def _get_group_class_names_from_schedules(db, all_schedules: List) -> List[str]:
    """
    从该组学生的排课结果中提取「学生班级」列的数据，去重后解析为班级展示名称。
    每条排课优先用排课记录的 class_id，若无则用该学生的 major_class。
    展示时只显示班级主名，会去掉 -X 细分组后缀（如 2402-8 -> 音乐学2402）。
    """
    if not all_schedules:
        return []
    student_ids = list({s.student_id for s in all_schedules if s.student_id})
    students_by_id = {}
    if student_ids:
        for s in db.query(Student).filter(Student.student_id.in_(student_ids)).all():
            students_by_id[s.student_id] = s
    seen = set()
    class_ids_or_names = []
    for row in all_schedules:
        val = (getattr(row, "class_id", None) and str(row.class_id).strip()) or (
            getattr(students_by_id.get(row.student_id), "major_class", None)
            if row.student_id and students_by_id.get(row.student_id)
            else None
        )
        if val and val not in seen:
            seen.add(val)
            class_ids_or_names.append(val)
    if not class_ids_or_names:
        return []
    class_objs = (
        db.query(Class)
        .filter(
            or_(
                Class.class_id.in_(class_ids_or_names),
                Class.id.in_(class_ids_or_names),
                Class.class_name.in_(class_ids_or_names),
            )
        )
        .all()
    )
    id_to_name = {}
    for c in class_objs:
        if c.class_id:
            id_to_name[c.class_id] = c.class_name
        if c.id:
            id_to_name[c.id] = c.class_name
        if c.class_name:
            id_to_name[c.class_name] = c.class_name
    # 解析为展示名，并去掉 -X 细分组后缀，再去重排序
    raw_names = [id_to_name.get(cid, cid) for cid in class_ids_or_names]
    normalized = sorted({_normalize_class_display_name(n) for n in raw_names if n})
    return normalized


def _set_cell_vertical_center(cell):
    """设置单元格内文字上下居中"""
    if WD_ALIGN_VERTICAL is not None and hasattr(cell, "vertical_alignment"):
        try:
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        except Exception:
            pass


def _set_run_font_size(run, pt: int):
    """设置 run 字号（pt，四号约 14pt）"""
    if Pt is not None and run is not None:
        try:
            run.font.size = Pt(pt)
        except Exception:
            pass


def _get_or_create_calendar_header(
    db,
    academic_year: Optional[str],
    semester_label: str,
    teacher_id: str,
    course_id: str,
    class_id: Optional[str],
    group_id: Optional[str],
) -> TeachingCalendarHeader:
    """
    按照 (semester_label, teacher_id, course_id, class_id, group_id) 获取或创建 TeachingCalendarHeader。
    小组课时：仅按 (semester_label, teacher_id, course_id, group_id) 定位同一 header，不随上方「班级」下拉变化，
    以保证「授课专业班级/小组学生」始终显示该组实际涉及的完整班级列表。
    """
    if group_id:
        # 小组课：同一小组只对应一个 header，忽略 class_id，避免换班级下拉出现不同 header
        header = (
            db.query(TeachingCalendarHeader)
            .filter(
                TeachingCalendarHeader.semester_label == semester_label,
                TeachingCalendarHeader.teacher_id == teacher_id,
                TeachingCalendarHeader.course_id == course_id,
                TeachingCalendarHeader.group_id == group_id,
            )
            .first()
        )
    else:
        # 专业大课等：按 class_id 查 header，兼容「音乐学2402」与「2402」两种格式，保证任选班级都能显示
        header = (
            db.query(TeachingCalendarHeader)
            .filter(
                TeachingCalendarHeader.semester_label == semester_label,
                TeachingCalendarHeader.teacher_id == teacher_id,
                TeachingCalendarHeader.course_id == course_id,
                TeachingCalendarHeader.class_id == class_id,
                TeachingCalendarHeader.group_id.is_(None),
            )
            .first()
        )
        if not header and class_id:
            class_id_alt = None
            if class_id.startswith("音乐学"):
                class_id_alt = class_id.replace("音乐学", "", 1)
            elif class_id.startswith("专升本"):
                class_id_alt = class_id.replace("专升本", "", 1)
            else:
                class_id_alt = f"音乐学{class_id}"
            header = (
                db.query(TeachingCalendarHeader)
                .filter(
                    TeachingCalendarHeader.semester_label == semester_label,
                    TeachingCalendarHeader.teacher_id == teacher_id,
                    TeachingCalendarHeader.course_id == course_id,
                    TeachingCalendarHeader.class_id == class_id_alt,
                    TeachingCalendarHeader.group_id.is_(None),
                )
                .first()
            )

    if header:
        # 小组课：每次获取时按小组成员重新计算班级列表，保证混合小组显示全部班级
        if group_id:
            course = db.query(Course).filter(Course.id == course_id).first()
            if not course:
                course = db.query(Course).filter(Course.course_id == course_id).first()
            schedule_q = db.query(ScheduledClass).filter(
                ScheduledClass.teacher_id == teacher_id,
                ScheduledClass.semester_label == semester_label,
                ScheduledClass.group_id == group_id,
            )
            if course:
                schedule_q = schedule_q.filter(
                    ScheduledClass.course_id.in_(
                        [course.id, course.course_id] if course.course_id else [course.id]
                    )
                )
            all_schedules = schedule_q.all()
            student_ids = {s.student_id for s in all_schedules if s.student_id}
            student_names = []
            if student_ids:
                students = (
                    db.query(Student)
                    .filter(Student.student_id.in_(list(student_ids)))
                    .all()
                )
                student_names = [s.name for s in students if s.name]
            # 从该组学生排课结果中的学生班级列提取、去重，得到班级展示名称列表
            class_names_used = _get_group_class_names_from_schedules(db, all_schedules)
            if student_ids or all_schedules:
                group_query = (
                    db.query(ScheduledClass.group_id)
                    .filter(
                        ScheduledClass.teacher_id == teacher_id,
                        ScheduledClass.semester_label == semester_label,
                    )
                    .filter(ScheduledClass.group_id.isnot(None))
                )
                if course:
                    group_query = group_query.filter(
                        ScheduledClass.course_id.in_(
                            [course.id, course.course_id]
                            if course.course_id
                            else [course.id]
                        )
                    )
                # 组序号：该教师+课程+学期下「所有小组」的全局顺序（1,2,…,8…），不是某班内的组数。
                # 仅用于无班级名时的兜底展示（如「第X组」），不再拼到班级名后（不再显示 -X）。
                distinct_group_ids = sorted(
                    {gid for (gid,) in group_query.all() if gid is not None}
                )
                try:
                    group_index = distinct_group_ids.index(group_id) + 1
                except ValueError:
                    group_index = None
                base_class_name = (course.major_class if course and course.major_class else "") or ""
                if class_names_used:
                    classes_line = "、".join(class_names_used)
                    class_display_name = classes_line  # 只写班级，不追加 -X 细分组
                elif group_index:
                    class_display_name = base_class_name or f"第{group_index}组"
                else:
                    class_display_name = base_class_name or ""
                if student_names:
                    names_line = "小组学生：" + "、".join(student_names)
                    class_display_name = (
                        f"{class_display_name}\n{names_line}"
                        if class_display_name
                        else names_line
                    )
                if class_display_name != (header.class_display_name or ""):
                    header.class_display_name = class_display_name
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()
        return header

    # 尝试获取基础信息用于填充 extra_info 与展示字段
    teacher = db.query(Teacher).filter(Teacher.teacher_id == teacher_id).first()
    if not teacher:
        teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()

    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        # 回退：有些排课记录使用 course_id(课程编号) 作为 ScheduledClass.course_id
        course = db.query(Course).filter(Course.course_id == course_id).first()

    # 班级展示名称：优先使用课程上的专业班级，其次使用 Class 表
    base_class_name = None
    if course and course.major_class:
        base_class_name = course.major_class
    if not base_class_name and class_id:
        class_obj = (
            db.query(Class)
            .filter((Class.class_id == class_id) | (Class.id == class_id))
            .first()
        )
        if class_obj:
            base_class_name = class_obj.class_name

    if base_class_name is None:
        base_class_name = ""

    class_display_name = base_class_name

    if group_id:
        # 组序号：该教师+课程+学期下「所有小组」的全局顺序（1,2,…,8…），仅用于无班级名时的「第X组」兜底，不拼到班级名后。
        group_query = (
            db.query(ScheduledClass.group_id)
            .filter(
                ScheduledClass.teacher_id == teacher_id,
                ScheduledClass.semester_label == semester_label,
            )
            .filter(ScheduledClass.group_id.isnot(None))
        )
        if course:
            group_query = group_query.filter(
                ScheduledClass.course_id.in_(
                    [course.id, course.course_id] if course.course_id else [course.id]
                )
            )

        distinct_group_ids = sorted(
            {gid for (gid,) in group_query.all() if gid is not None}
        )
        try:
            group_index = distinct_group_ids.index(group_id) + 1
        except ValueError:
            group_index = None

        # 为小组课追加学生姓名列表，混合小组的班级按实际所在班级列表显示（不只用当前选中班级）
        student_names: List[str] = []
        class_names_used: List[str] = []
        schedule_q = db.query(ScheduledClass).filter(
            ScheduledClass.teacher_id == teacher_id,
            ScheduledClass.semester_label == semester_label,
            ScheduledClass.group_id == group_id,
        )
        if course:
            schedule_q = schedule_q.filter(
                ScheduledClass.course_id.in_(
                    [course.id, course.course_id] if course.course_id else [course.id]
                )
            )
        all_schedules = schedule_q.all()
        student_ids = {s.student_id for s in all_schedules if s.student_id}
        if student_ids:
            students = (
                db.query(Student)
                .filter(Student.student_id.in_(list(student_ids)))
                .all()
            )
            student_names = [s.name for s in students if s.name]
        # 从该组学生排课结果中的学生班级列提取、去重，得到班级展示名称列表
        class_names_used = _get_group_class_names_from_schedules(db, all_schedules)

        if class_names_used:
            classes_line = "、".join(class_names_used)
            class_display_name = classes_line  # 只写班级，不追加 -X 细分组
        elif group_index:
            class_display_name = base_class_name or f"第{group_index}组"

        if student_names:
            names_line = "小组学生：" + "、".join(student_names)
            if class_display_name:
                class_display_name = f"{class_display_name}\n{names_line}"
            else:
                class_display_name = names_line

    extra_info: Dict[str, object] = {}

    if course:
        extra_info["course_name"] = course.course_name
        extra_info["course_type"] = course.course_type
        extra_info["course_id"] = course.course_id
        extra_info["major_class"] = course.major_class
        extra_info["academic_year"] = course.academic_year
        extra_info["semester"] = course.semester
        extra_info["semester_label"] = course.semester_label
        extra_info["credit"] = course.credit
        extra_info["required_hours"] = course.required_hours

        if academic_year is None and course.academic_year:
            academic_year = course.academic_year

    if teacher:
        extra_info["teacher_name"] = teacher.name
        extra_info["teacher_full_name"] = teacher.full_name or teacher.name
        extra_info["teacher_position"] = teacher.position
        extra_info["faculty_code"] = teacher.faculty_code
        # 教学日历第一页「学院」固定为影视传媒学院，不用教师所属教研室
        extra_info["faculty_name"] = "影视传媒学院"

    # 学年学期文本：格式为「XXXX-XXXX学年第X学期」，不包含「级」、不重复「学期」
    semester_text = None
    if semester_label:
        parts = [p.strip() for p in semester_label.split("-") if p.strip()]
        if len(parts) >= 2:
            # 取前两段为学年（如 2025-2026）、最后一段为学期号（1 或 2）
            year_part = "-".join(parts[:2]) if len(parts) >= 2 else parts[0]
            sem_num = parts[-1] if parts else ""
            if sem_num in ("1", "2"):
                semester_text = f"{year_part} 学年第 {sem_num} 学期"
    if not semester_text and academic_year and course and course.semester:
        semester_text = f"{academic_year} 学年第 {course.semester} 学期"
    extra_info["semester_text"] = semester_text

    # 系部默认值为音乐系；学院默认值为影视传媒学院
    if not extra_info.get("department_name"):
        extra_info["department_name"] = "音乐系"
    if not extra_info.get("faculty_name"):
        extra_info["faculty_name"] = "影视传媒学院"

    header = TeachingCalendarHeader(
        academic_year=academic_year,
        semester_label=semester_label,
        teacher_id=teacher_id,
        course_id=course_id,
        class_id=None if group_id else class_id,
        group_id=group_id,
        class_display_name=class_display_name,
        extra_info=extra_info,
    )
    db.add(header)
    db.commit()
    db.refresh(header)
    return header


def _extract_grade_from_class_id(class_id: Optional[str]) -> Optional[int]:
    """
    从班级ID提取年级。如 音乐学2501 -> 2025, 2501 -> 2025, 音乐学2304 -> 2023。
    """
    if not class_id or not isinstance(class_id, str):
        return None
    # 匹配 4 位年份或 2 位年级
    m = re.search(r"(202[0-9])|(?<!\d)([2-9][0-9])(?=[0-9]{2}|$)", class_id)
    if m:
        g = m.group(1) or m.group(2)
        if g:
            n = int(g)
            return n if n >= 2000 else 2000 + n
    return None


def _extract_class_type_from_class_id(db, class_id: Optional[str]) -> str:
    """
    从班级ID提取班级类型：普通班(general) 或 专升本(upgrade)。
    专业本和普通班不能共用教学内容。
    """
    if not class_id or not isinstance(class_id, str):
        return "general"
    # 1. 含「专升本」直接判定
    if "专升本" in class_id:
        return "upgrade"
    # 2. 查 Class 表获取 student_type
    class_obj = (
        db.query(Class)
        .filter(
            (Class.class_id == class_id)
            | (Class.class_name == class_id)
            | (Class.class_name == f"音乐学{class_id}")
            | (Class.class_name == f"专升本{class_id}")
        )
        .first()
    )
    if class_obj and class_obj.student_type == "upgrade":
        return "upgrade"
    # 3.  heuristic：班号 04 结尾（如 2304、2404、2504）为专升本
    num_part = re.search(r"(\d{4})", class_id)
    if num_part:
        suffix = num_part.group(1)[-2:]
        if suffix == "04":
            return "upgrade"
    return "general"


def _distribute_content_to_weeks(
    content_items: List[str], num_weeks: int
) -> List[str]:
    """
    将 N 条教学内容平分到 M 个周次。如 16 条 -> 8 周，则每周 2 条合并。
    """
    n = len(content_items)
    if n == 0 or num_weeks <= 0:
        return []
    if num_weeks >= n:
        return content_items[:num_weeks] + [""] * max(0, num_weeks - n)
    # 平分：将 n 条分成 num_weeks 组
    result: List[str] = []
    per_week = n / num_weeks
    for i in range(num_weeks):
        start_idx = int(i * per_week)
        end_idx = int((i + 1) * per_week) if i < num_weeks - 1 else n
        parts = [content_items[j] for j in range(start_idx, end_idx) if j < n and content_items[j]]
        result.append("；".join(parts) if parts else "")
    return result


def _ensure_extra_info_defaults(
    extra_info: Optional[dict], semester_label: Optional[str] = None
) -> dict:
    """确保 extra_info 中系部等字段有默认值；学期显示为「XXXX-XXXX学年第X学期」；学院默认为影视传媒学院"""
    out = dict(extra_info or {})
    if not out.get("department_name"):
        out["department_name"] = "音乐系"
    fn = (out.get("faculty_name") or "").strip()
    if not fn or fn.endswith("教研室"):
        out["faculty_name"] = "影视传媒学院"
    if semester_label:
        parts = [p.strip() for p in semester_label.split("-") if p.strip()]
        if len(parts) >= 2 and parts[-1] in ("1", "2"):
            year_part = "-".join(parts[:2])
            out["semester_text"] = f"{year_part} 学年第 {parts[-1]} 学期"
    return out


def _merge_grade_hours_into_extra_info(db, header: TeachingCalendarHeader, extra_info: dict) -> dict:
    """
    将年级学时模板（总/理论/实践学时）合并到 extra_info，供同年级所有班级/小组共用。
    模板为 teacher_id=null 的 GradeTeachingContent 记录。
    """
    out = dict(extra_info or {})
    grade = _extract_grade_from_class_id(header.class_id)
    if grade is None:
        return out
    class_type = _extract_class_type_from_class_id(db, header.class_id)
    course_id = header.course_id
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        course = db.query(Course).filter(Course.course_id == course_id).first()
    ids_to_match = [course_id]
    if course:
        for cid in (str(course.id), getattr(course, "course_id", None)):
            if cid and cid not in ids_to_match:
                ids_to_match.append(cid)
    try:
        gtc = (
            db.query(GradeTeachingContent)
            .filter(
                GradeTeachingContent.semester_label == header.semester_label,
                GradeTeachingContent.grade == grade,
                GradeTeachingContent.class_type == class_type,
                GradeTeachingContent.teacher_id.is_(None),
                GradeTeachingContent.course_id.in_(ids_to_match),
            )
            .first()
        )
    except OperationalError:
        gtc = None
    if not gtc:
        return out
    for key in ("required_hours", "theory_hours", "practice_hours"):
        if key not in out or out.get(key) is None:
            val = getattr(gtc, key, None)
            if val is not None:
                try:
                    out[key] = int(val)
                except (TypeError, ValueError):
                    pass
    return out


def _filter_remark_no_admin_meeting(remark: str) -> str:
    """展示备注时过滤掉「行政例会」，保留其它禁排原因"""
    if not remark or not remark.strip():
        return remark or ""
    parts = re.split(r"[；;]", remark)
    filtered = [p.strip() for p in parts if p.strip() and p.strip() != "行政例会"]
    return "；".join(filtered) if filtered else ""


def _format_week_ranges(weeks: List[int]) -> str:
    """将周次列表格式化为「第1-2、4-17周」形式（与排课时间显示一致）"""
    if not weeks:
        return ""
    weeks = sorted(set(weeks))
    ranges: List[str] = []
    start, end = weeks[0], weeks[0]
    for w in weeks[1:]:
        if w == end + 1:
            end = w
        else:
            ranges.append(f"{start}-{end}" if start != end else str(start))
            start, end = w, w
    ranges.append(f"{start}-{end}" if start != end else str(start))
    return "第" + "、".join(ranges) + "周"


def _day_of_week_cn(day_of_week: Optional[int]) -> str:
    """星期几转中文：1=周一 … 7=周日"""
    if day_of_week is None or day_of_week < 1 or day_of_week > 7:
        return ""
    return ("周一", "周二", "周三", "周四", "周五", "周六", "周日")[day_of_week - 1]


def _build_week_blocked_reason_map(
    blocked_times: List[ImportedBlockedTime],
) -> Dict[int, str]:
    """
    将导入的禁排时间按周次聚合成 {week_number: '原因1；原因2'}。
    这里不做班级过滤，而是只要学年学期匹配就提示，主要覆盖节假日停课等场景。
    专业大课 / 通适大课类禁排（source_type='large_class' 或 原因中包含“大课”）不计入教学日历备注。
    备注中不显示「行政例会」，其它放假等禁排原因可显示。
    """
    week_reasons: Dict[int, List[str]] = {}

    def _filter_reason(reason: str) -> List[str]:
        """过滤掉行政例会，保留其它原因"""
        if not reason or not reason.strip():
            return []
        parts = re.split(r"[；;]", reason)
        return [p.strip() for p in parts if p.strip() and p.strip() != "行政例会"]

    for bt in blocked_times:
        # 跳过通适大课 / 专业大课等大课禁排
        if bt.source_type == "large_class":
            continue
        if bt.reason and ("大课" in bt.reason):
            continue
        if not bt.weeks:
            continue
        filtered = _filter_reason(bt.reason or "")
        if not filtered:
            continue
        for w in bt.weeks:
            if w is None:
                continue
            week_reasons.setdefault(w, [])
            for r in filtered:
                if r not in week_reasons[w]:
                    week_reasons[w].append(r)

    return {w: "；".join(reasons) for w, reasons in week_reasons.items()}


def _build_calendar_entries(
    db, header: TeachingCalendarHeader, group_student_ids: Optional[List[str]] = None
):
    """
    根据排课结果、学期周次配置和已保存的 TeachingCalendarEntry 生成完整的教学日历行数据。
    group_student_ids: 小组课时可传该小组学号列表，与 group_id 一起使用，按学号精确匹配排课。
    """
    semester_label = header.semester_label
    teacher_id = header.teacher_id
    course_id = header.course_id
    group_id = header.group_id
    class_id = header.class_id

    # 查找课程与学期配置
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        course = db.query(Course).filter(Course.course_id == course_id).first()

    # 同一门课在 courses 表里可能按班级存多行（如 2301/2302/2303 各一行），排课表可能用任意一行的 id 或课程编号。
    # 用「课程名或课程编号」拉齐所有同课记录，保证「本课程各班级」能查到全部 3 个班的排课。
    course_ids_for_schedule: List[str] = []
    if course:
        course_ids_for_schedule.append(str(course.id))
        same_name = db.query(Course.id).filter(Course.course_name == course.course_name).all()
        for (cid,) in same_name:
            course_ids_for_schedule.append(str(cid))
        if getattr(course, "course_id", None):
            same_code = db.query(Course.id).filter(Course.course_id == course.course_id).all()
            for (cid,) in same_code:
                course_ids_for_schedule.append(str(cid))
        course_ids_for_schedule = list(dict.fromkeys(course_ids_for_schedule))  # 去重保序

    academic_year = header.academic_year or (course.academic_year if course else None)

    config = (
        db.query(SemesterWeekConfig)
        .filter(SemesterWeekConfig.semester_label == semester_label)
        .first()
    )

    total_weeks = 16
    if config and config.total_weeks:
        total_weeks = config.total_weeks
    elif course and course.required_hours:
        # 简单兜底：根据课程需要课时估算周数
        total_weeks = max(16, int(course.required_hours / 2))

    # 仅按课程+班级+学期提取排课，不按教师过滤。
    # 课程列表已在前端按教师筛选，course_id+class_id+semester 即可定位排课。
    # 旧排课可能未填 teacher_id、semester_label（导入数据常缺），兼容空值。
    course_teaching_type = (course.teaching_type or "").strip() if course else ""
    course_type_str = (course.course_type or "").strip() if course else ""
    # 专业大课、理论课均为 2 节连上，需合并显示
    is_major_class = (
        "大课" in course_teaching_type
        or "理论课" in course_teaching_type
        or "理论课" in course_type_str
    )

    # 排课查询
    # 小组课且传了学号：教学日历仅用于导出文档，只做「学号+课程」一次查询，直接读取排课结果，不做 group_id/班级 等复杂分支
    schedules: List[ScheduledClass] = []
    if group_id and group_student_ids and course:
        ids_direct = list(course_ids_for_schedule)
        if getattr(course, "course_id", None):
            ids_direct.append(course.course_id)
        course_conds = [ScheduledClass.course_id.in_(ids_direct)]
        if getattr(course, "course_id", None):
            course_conds.append(ScheduledClass.course_code == course.course_id)
        schedules = (
            db.query(ScheduledClass)
            .filter(ScheduledClass.student_id.in_(group_student_ids))
            .filter(or_(*course_conds))
            .all()
        )
    else:
        # 专业大课或无学号的小组课：按「课程 + 班级」（及 group_id）查询，并保留 course_code 回退
        schedule_query = db.query(ScheduledClass)
        if course:
            ids_to_match = list(course_ids_for_schedule)
            if getattr(course, "course_id", None):
                ids_to_match.append(course.course_id)
            conds = [ScheduledClass.course_id.in_(ids_to_match)]
            if getattr(course, "course_id", None):
                conds.append(ScheduledClass.course_code == course.course_id)
            schedule_query = schedule_query.filter(or_(*conds))
        else:
            schedule_query = schedule_query.filter(ScheduledClass.course_id == course_id)

        if group_id:
            schedule_query = schedule_query.filter(ScheduledClass.group_id == group_id)

        if class_id:
            if class_id.startswith("音乐学"):
                class_id_alt = class_id.replace("音乐学", "", 1).strip()
            elif class_id.startswith("专升本"):
                class_id_alt = class_id.replace("专升本", "", 1).strip()
            else:
                class_id_alt = f"音乐学{class_id.strip()}"
            class_id_clean = class_id.strip()
            schedule_query = (
                schedule_query.outerjoin(
                    Student, ScheduledClass.student_id == Student.student_id
                ).filter(
                    or_(
                        ScheduledClass.class_id == class_id_clean,
                        ScheduledClass.class_id == class_id_alt,
                        func.trim(ScheduledClass.class_id) == class_id_clean,
                        func.trim(ScheduledClass.class_id) == class_id_alt,
                        Student.major_class == class_id_clean,
                        Student.major_class == class_id_alt,
                    )
                )
            )

        schedules = schedule_query.all()

        if not schedules and course and getattr(course, "course_id", None):
            fallback_query = db.query(ScheduledClass).filter(
                ScheduledClass.course_code == course.course_id
            )
            if group_id:
                fallback_query = fallback_query.filter(ScheduledClass.group_id == group_id)
            if class_id:
                if class_id.startswith("音乐学"):
                    class_id_alt = class_id.replace("音乐学", "", 1).strip()
                elif class_id.startswith("专升本"):
                    class_id_alt = class_id.replace("专升本", "", 1).strip()
                else:
                    class_id_alt = f"音乐学{class_id.strip()}"
                class_id_clean = class_id.strip()
                fallback_query = fallback_query.outerjoin(
                    Student, ScheduledClass.student_id == Student.student_id
                ).filter(
                    or_(
                        ScheduledClass.class_id == class_id_clean,
                        ScheduledClass.class_id == class_id_alt,
                        func.trim(ScheduledClass.class_id) == class_id_clean,
                        func.trim(ScheduledClass.class_id) == class_id_alt,
                        Student.major_class == class_id_clean,
                        Student.major_class == class_id_alt,
                    )
                )
            schedules = fallback_query.all()

    # 严格按当前班级过滤，避免「排课时间」混入其他班级（专业大课）；小组课已按学号锁定则不再按班级过滤
    if class_id and schedules and db and not (group_id and group_student_ids):
        schedules = [s for s in schedules if _schedule_belongs_to_class(s, class_id, db)]

    # 排课时间摘要：直接从排课结果数据拼出，供红框展示用（不参与计算）
    schedule_time_summary = _format_schedule_time_summary(schedules, for_group=bool(group_id))

    # 专业大课（非小组）：按「本课程所有班级」汇总排课时间，用于「本课程各班级排课时间」展示；合班（同一时间）合并为一行
    schedule_time_by_class: List[Dict[str, str]] = []
    if is_major_class and not group_id and course:
        all_schedules_query = db.query(ScheduledClass)
        ids_to_match = list(course_ids_for_schedule)
        if getattr(course, "course_id", None):
            ids_to_match.append(course.course_id)
        conds = [ScheduledClass.course_id.in_(ids_to_match)]
        if getattr(course, "course_id", None):
            conds.append(ScheduledClass.course_code == course.course_id)
        all_schedules_query = all_schedules_query.filter(or_(*conds))
        all_schedules: List[ScheduledClass] = all_schedules_query.all()
        # 兼容旧数据：按 course_id 查不到时，仅按课程编号再查一次
        if not all_schedules and getattr(course, "course_id", None):
            all_schedules = (
                db.query(ScheduledClass)
                .filter(ScheduledClass.course_code == course.course_id)
                .all()
            )
        # 按班级分组（ScheduledClass.class_id 或 Student.major_class）
        by_class: Dict[str, List[ScheduledClass]] = {}
        for s in all_schedules:
            cls = (s.class_id or "").strip()
            if not cls and getattr(s, "student_id", None):
                st = db.query(Student).filter(Student.student_id == s.student_id).first()
                if st and getattr(st, "major_class", None):
                    cls = (st.major_class or "").strip()
            cls = _normalize_class_display_name(cls)
            if not cls:
                cls = "未分班"
            if cls and not (cls.startswith("音乐学") or cls.startswith("专升本")):
                if cls.isdigit() and len(cls) == 4:
                    cls = f"音乐学{cls}"
            by_class.setdefault(cls, []).append(s)
        class_to_summary: Dict[str, str] = {}
        for cls, s_list in by_class.items():
            class_to_summary[cls] = _format_schedule_time_summary(s_list)
        # 合班：相同排课时间的班级合并为一行
        summary_to_classes: Dict[str, List[str]] = {}
        for cls, summary in class_to_summary.items():
            if not summary:
                continue
            summary_to_classes.setdefault(summary, []).append(cls)
        for summary, classes in summary_to_classes.items():
            schedule_time_by_class.append({
                "class_names": "、".join(sorted(classes)),
                "schedule_time": summary,
            })
        # 当前选中班级未查到排课时，从「按班级汇总」中补全（兼容 class_id 格式/空格不一致）
        if not schedule_time_summary and class_id:
            cid = class_id.strip()
            keys_to_try = [
                cid,
                cid if (cid.startswith("音乐学") or cid.startswith("专升本")) else f"音乐学{cid}",
                cid.replace("音乐学", "", 1).strip() if cid.startswith("音乐学") else None,
                f"音乐学{cid}" if cid.isdigit() and len(cid) == 4 else None,
            ]
            for k in keys_to_try:
                if k and k in class_to_summary and class_to_summary[k]:
                    schedule_time_summary = class_to_summary[k]
                    break

    # 周次 -> 对应的排课记录列表（有 start_week/end_week 的按周范围展开，否则按 week_number 或 start_week 单周）
    schedules_by_week: Dict[int, List[ScheduledClass]] = {}
    for s in schedules:
        if s.week_number is not None:
            schedules_by_week.setdefault(s.week_number, []).append(s)
        elif s.start_week is not None and s.end_week is not None:
            for w in range(s.start_week, s.end_week + 1):
                schedules_by_week.setdefault(w, []).append(s)
        else:
            week = s.start_week if s.start_week is not None else 1
            if week is not None:
                schedules_by_week.setdefault(week, []).append(s)

    # 同年级教学内容与备注：谁上传谁使用，仅当前教师的模板生效；无则兼容 teacher_id 为空的旧模板
    grade_content_by_week: Dict[int, str] = {}
    grade_remark_by_week: Dict[int, str] = {}
    grade = _extract_grade_from_class_id(class_id)
    class_type = _extract_class_type_from_class_id(db, class_id)
    if grade and course:
        ids_to_match = [str(course.id), course.course_id] if course.course_id else [str(course.id)]
        teacher_id = header.teacher_id
        gtc = None
        try:
            q = (
                db.query(GradeTeachingContent)
                .filter(
                    GradeTeachingContent.semester_label == semester_label,
                    GradeTeachingContent.grade == grade,
                    GradeTeachingContent.class_type == class_type,
                    GradeTeachingContent.course_id.in_(ids_to_match),
                )
            )
            gtc = q.filter(GradeTeachingContent.teacher_id == teacher_id).first()
            if not gtc and teacher_id:
                gtc = q.filter(GradeTeachingContent.teacher_id.is_(None)).first()
        except OperationalError:
            # 表尚未有 teacher_id 或 remark_items 列时跳过年级模板，避免 500
            gtc = None
        if gtc:
            scheduled_weeks = sorted(schedules_by_week.keys())
            num_weeks = len(scheduled_weeks)
            if gtc.content_items:
                items = list(gtc.content_items) if isinstance(gtc.content_items, list) else []
                # 模板按上课周顺序存储：第 i 个有排课的周 ← content_items[i]
                distributed = _distribute_content_to_weeks(items, num_weeks)
                for i, w in enumerate(scheduled_weeks):
                    if i < len(distributed) and distributed[i]:
                        grade_content_by_week[w] = distributed[i]
            if getattr(gtc, "remark_items", None):
                remark_items_list = list(gtc.remark_items) if isinstance(gtc.remark_items, list) else []
                if remark_items_list:
                    distributed_rm = _distribute_content_to_weeks(remark_items_list, num_weeks)
                    for i, w in enumerate(scheduled_weeks):
                        if i < len(distributed_rm) and distributed_rm[i]:
                            grade_remark_by_week[w] = distributed_rm[i]

    # 已保存的教学日历行（仅用于还原教学内容与备注）
    existing_entries: List[TeachingCalendarEntry] = (
        db.query(TeachingCalendarEntry)
        .filter(TeachingCalendarEntry.calendar_header_id == header.id)
        .all()
    )
    entry_by_schedule: Dict[str, TeachingCalendarEntry] = {}
    empty_entry_by_week: Dict[int, TeachingCalendarEntry] = {}
    for e in existing_entries:
        if e.schedule_id:
            entry_by_schedule[e.schedule_id] = e
        elif e.is_empty_week:
            empty_entry_by_week[e.week_number] = e

    # 节假日 / 禁排信息
    blocked_times: List[ImportedBlockedTime] = []
    if academic_year and semester_label:
        blocked_times = (
            db.query(ImportedBlockedTime)
            .filter(
                ImportedBlockedTime.academic_year == academic_year,
                ImportedBlockedTime.semester_label == semester_label,
            )
            .all()
        )
    week_blocked_reason = _build_week_blocked_reason_map(blocked_times)

    # 每周一行：按周遍历，有排课的每周每时间段一行；学时 = 总课时 / 上课次数（专业大课多为2，小组课多为1）
    start_date = config.start_date if config else None
    total_required_hours = (header.extra_info or {}).get("required_hours")
    if total_required_hours is None and course:
        total_required_hours = getattr(course, "required_hours", None)
    try:
        total_required_hours = int(total_required_hours) if total_required_hours is not None else 0
    except (TypeError, ValueError):
        total_required_hours = 0

    session_rows: List[dict] = []
    for week in range(1, total_weeks + 1):
        week_schedules = schedules_by_week.get(week, [])
        if not week_schedules:
            continue
        # 按 日期/星期/节次 排序
        def _sort_key(s: ScheduledClass):
            d = s.date
            if not d and start_date and s.day_of_week:
                d = start_date + timedelta(weeks=week - 1, days=(s.day_of_week or 1) - 1)
            return (d or (), s.day_of_week or 0, s.period or 0)
        week_schedules.sort(key=_sort_key)

        if is_major_class:
            # 专业大课 2 学时连排：同一天连续 2 节合并为一行，连续 4 节分 2 行展示
            by_day: Dict[int, List[ScheduledClass]] = {}
            for s in week_schedules:
                dow = s.day_of_week or 0
                if dow not in by_day:
                    by_day[dow] = []
                by_day[dow].append(s)
            for dow in sorted(by_day.keys()):
                if not dow:
                    continue
                day_schedules = by_day[dow]
                periods_covered: set = set()
                period_to_schedules: Dict[int, List[ScheduledClass]] = {}
                for s in day_schedules:
                    p = s.period or 0
                    dur = s.duration or 1
                    if not p:
                        continue
                    for q in range(p, p + dur):
                        periods_covered.add(q)
                        if q not in period_to_schedules:
                            period_to_schedules[q] = []
                        period_to_schedules[q].append(s)
                periods_sorted = sorted(periods_covered)
                # 连续节次两两合并：(1,2)->一行，(3,4)->一行；连续4节则两行
                period_groups: List[tuple] = []
                i = 0
                while i < len(periods_sorted):
                    if i + 1 < len(periods_sorted) and periods_sorted[i + 1] == periods_sorted[i] + 1:
                        period_groups.append((periods_sorted[i], periods_sorted[i + 1]))
                        i += 2
                    else:
                        period_groups.append((periods_sorted[i],))
                        i += 1
                for grp in period_groups:
                    p1 = grp[0]
                    p2 = grp[1] if len(grp) == 2 else p1
                    sids: List[str] = []
                    for q in range(p1, p2 + 1):
                        for s in period_to_schedules.get(q, []):
                            if s.id and s.id not in sids:
                                sids.append(s.id)
                    primary_s = period_to_schedules.get(p1, [None])[0] if period_to_schedules.get(p1) else None
                    if not primary_s:
                        continue
                    d = primary_s.date
                    if not d and start_date and primary_s.day_of_week:
                        d = start_date + timedelta(weeks=week - 1, days=primary_s.day_of_week - 1)
                    date_text = f"{d.month}月{d.day}日" if d else ""
                    period_text = f"第{p1}-{p2}节" if p2 > p1 else f"第{p1}节"
                    entry = entry_by_schedule.get(primary_s.id)
                    tc = (entry.teaching_content if entry else "") or ""
                    if not tc and week in grade_content_by_week:
                        tc = grade_content_by_week[week]
                    remark_raw = (entry.remark if entry else "") or ""
                    if not remark_raw and week in grade_remark_by_week:
                        remark_raw = grade_remark_by_week[week]
                    session_rows.append({
                        "id": entry.id if entry else None,
                        "schedule_id": primary_s.id,
                        "schedule_ids": sids if sids else [primary_s.id],
                        "week_number": week,
                        "week_range_text": f"第{week}周",
                        "is_empty_week": False,
                        "date": d.isoformat() if d else None,
                        "date_text": date_text,
                        "period_text": period_text,
                        "hours": None,
                        "teaching_content": tc or "",
                        "remark": _filter_remark_no_admin_meeting(remark_raw),
                    })
        else:
            seen = set()
            for s in week_schedules:
                key = (s.day_of_week or 0, s.period or 0, s.duration or 1)
                if key in seen:
                    continue
                seen.add(key)
                d = s.date
                if not d and start_date and s.day_of_week:
                    d = start_date + timedelta(weeks=week - 1, days=s.day_of_week - 1)
                date_text = f"{d.month}月{d.day}日" if d else ""
                period_text = f"第{s.period}-{s.period + (s.duration or 1) - 1}节" if (s.duration or 1) > 1 else f"第{s.period}节"
                entry = entry_by_schedule.get(s.id)
                tc = (entry.teaching_content if entry else "") or ""
                if not tc and week in grade_content_by_week:
                    tc = grade_content_by_week[week]
                remark_raw = (entry.remark if entry else "") or ""
                if not remark_raw and week in grade_remark_by_week:
                    remark_raw = grade_remark_by_week[week]
                session_rows.append({
                    "id": entry.id if entry else None,
                    "schedule_id": s.id,
                    "schedule_ids": [s.id],
                    "week_number": week,
                    "week_range_text": f"第{week}周",
                    "is_empty_week": False,
                    "date": d.isoformat() if d else None,
                    "date_text": date_text,
                    "period_text": period_text,
                    "hours": None,
                    "teaching_content": tc or "",
                    "remark": _filter_remark_no_admin_meeting(remark_raw),
                })

    # 学时 = 总课时 / 上课次数（专业大课如16课时上8周则每周2学时，小组课通常每次1学时）
    num_sessions = len(session_rows)
    if num_sessions > 0 and total_required_hours > 0:
        base_hours = total_required_hours // num_sessions
        remainder = total_required_hours % num_sessions
        for i, row in enumerate(session_rows):
            row["hours"] = base_hours + (1 if i < remainder else 0)
    else:
        for row in session_rows:
            row["hours"] = 1 if not row.get("hours") else row["hours"]

    rows = list(session_rows)

    # 空周：仅在有排课范围内插入无排课的周次（学期中间需跳过的周次如禁排要显示，最后一周之后不再显示）
    scheduled_weeks_set = {r["week_number"] for r in session_rows}
    max_scheduled_week = max(scheduled_weeks_set) if scheduled_weeks_set else 0
    for week in range(1, total_weeks + 1):
        if week > max_scheduled_week:
            continue
        if week in scheduled_weeks_set:
            continue
        entry = empty_entry_by_week.get(week)
        remark = _filter_remark_no_admin_meeting(
            entry.remark if entry else week_blocked_reason.get(week, "")
        )
        rows.append({
            "id": entry.id if entry else None,
            "schedule_id": None,
            "schedule_ids": [],
            "week_number": week,
            "week_range_text": f"第{week}周",
            "is_empty_week": True,
            "date": None,
            "date_text": "",
            "period_text": "",
            "hours": None,
            "teaching_content": (entry.teaching_content if entry else "") or "",
            "remark": remark or "",
        })
    rows.sort(key=lambda r: r["week_number"])

    return rows, schedule_time_summary, schedule_time_by_class


@api_bp.route("/teaching-calendar", methods=["GET"])
def get_teaching_calendar():
    """
    获取某一教师 + 课程 (+ 班级/小组) 在某学期的教学日历数据：
    - 若尚未有头信息记录，会根据课程/教师/排课自动创建一份默认配置；
    - 行数据始终由排课与周次配置实时推导，再叠加已保存的教学内容/备注。
    - 小组课可传 group_student_ids（逗号分隔学号），与 group_id 一起使用，按学号精确匹配排课。
    """
    db = next(get_db())
    try:
        semester_label = request.args.get("semester_label")
        teacher_id = request.args.get("teacher_id")
        course_id = request.args.get("course_id")
        class_id = request.args.get("class_id") or None
        group_id = request.args.get("group_id") or None
        group_student_ids_raw = request.args.get("group_student_ids") or ""
        group_student_ids = [x.strip() for x in group_student_ids_raw.split(",") if x.strip()] or None

        if not semester_label or not teacher_id or not course_id:
            return (
                jsonify(
                    {
                        "error": "semester_label, teacher_id, course_id 为必填参数",
                    }
                ),
                400,
            )

        # 尝试推断学年
        academic_year = None
        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            course = db.query(Course).filter(Course.course_id == course_id).first()
        if course and course.academic_year:
            academic_year = course.academic_year

        header = _get_or_create_calendar_header(
            db=db,
            academic_year=academic_year,
            semester_label=semester_label,
            teacher_id=teacher_id,
            course_id=course_id,
            class_id=class_id,
            group_id=group_id,
        )

        rows, schedule_time_summary, schedule_time_by_class = _build_calendar_entries(
            db, header, group_student_ids=group_student_ids
        )
        extra_info_out = _merge_grade_hours_into_extra_info(db, header, header.extra_info or {})
        extra_info_out = _ensure_extra_info_defaults(extra_info_out, header.semester_label)

        return jsonify(
            {
                "header": {
                    "id": header.id,
                    "academic_year": header.academic_year,
                    "semester_label": header.semester_label,
                    "teacher_id": header.teacher_id,
                    "course_id": header.course_id,
                    "class_id": header.class_id,
                    "group_id": header.group_id,
                    "class_display_name": header.class_display_name,
                    "extra_info": extra_info_out,
                },
                "schedule_time_summary": schedule_time_summary,
                "schedule_time_by_class": schedule_time_by_class,
                "entries": rows,
            }
        )
    finally:
        db.close()


@api_bp.route("/teaching-calendar", methods=["POST"])
def save_teaching_calendar():
    """
    保存教学日历的头信息与行信息（教学内容 / 备注）。

    请求体格式示例：
    {
      "semester_label": "...",
      "teacher_id": "...",
      "course_id": "...",
      "class_id": "...",
      "group_id": "...",
      "header": {
        "class_display_name": "...",
        "extra_info": { ... }
      },
      "entries": [
        {
          "schedule_id": "...",     // 有课行必填
          "week_number": 1,
          "is_empty_week": false,
          "teaching_content": "...",
          "remark": "..."
        },
        {
          "schedule_id": null,      // 空周行
          "week_number": 2,
          "is_empty_week": true,
          "teaching_content": "",
          "remark": "清明节放假"
        }
      ]
    }
    """
    db = next(get_db())
    try:
        data = request.get_json() or {}

        semester_label = data.get("semester_label")
        teacher_id = data.get("teacher_id")
        course_id = data.get("course_id")
        class_id = data.get("class_id")
        group_id = data.get("group_id")

        if not semester_label or not teacher_id or not course_id:
            return (
                jsonify(
                    {
                        "error": "semester_label, teacher_id, course_id 为必填字段",
                    }
                ),
                400,
            )

        header_data = data.get("header") or {}
        entries_data = data.get("entries") or []

        # 获取或创建头信息
        academic_year = header_data.get("academic_year")
        header = _get_or_create_calendar_header(
            db=db,
            academic_year=academic_year,
            semester_label=semester_label,
            teacher_id=teacher_id,
            course_id=course_id,
            class_id=class_id,
            group_id=group_id,
        )

        # 更新头信息的可编辑字段
        class_display_name = header_data.get("class_display_name")
        if class_display_name is not None:
            header.class_display_name = class_display_name

        extra_info = dict(header.extra_info or {})
        extra_info_update = header_data.get("extra_info") or {}
        if isinstance(extra_info_update, dict):
            extra_info.update(extra_info_update)
        # 显式持久化总/理论/实践学时（前端第一页），避免 JSON 合并或序列化时丢失
        for key in ("required_hours", "theory_hours", "practice_hours"):
            v = extra_info_update.get(key) if isinstance(extra_info_update, dict) else None
            if v is not None:
                try:
                    extra_info[key] = int(v)
                except (TypeError, ValueError):
                    pass
        header.extra_info = extra_info

        db.add(header)

        # 读取现有行，用于 upsert
        existing_entries: List[TeachingCalendarEntry] = (
            db.query(TeachingCalendarEntry)
            .filter(TeachingCalendarEntry.calendar_header_id == header.id)
            .all()
        )
        by_schedule: Dict[str, TeachingCalendarEntry] = {}
        by_empty_week: Dict[int, TeachingCalendarEntry] = {}
        for e in existing_entries:
            if e.schedule_id:
                by_schedule[e.schedule_id] = e
            elif e.is_empty_week:
                by_empty_week[e.week_number] = e

        # Upsert 行信息
        for item in entries_data:
            schedule_id = item.get("schedule_id")
            week_number = int(item.get("week_number") or 0)
            is_empty_week = bool(item.get("is_empty_week"))
            teaching_content = item.get("teaching_content") or ""
            remark = item.get("remark") or ""

            if week_number <= 0:
                continue

            entry: Optional[TeachingCalendarEntry] = None
            if schedule_id:
                entry = by_schedule.get(schedule_id)
            elif is_empty_week:
                entry = by_empty_week.get(week_number)

            if entry is None:
                entry = TeachingCalendarEntry(
                    calendar_header_id=header.id,
                    schedule_id=schedule_id,
                    week_number=week_number,
                    is_empty_week=is_empty_week,
                    teaching_content=teaching_content,
                    remark=remark,
                )
                db.add(entry)
            else:
                entry.teaching_content = teaching_content
                entry.remark = remark

        db.commit()

        # 总/理论/实践学时为全年级一致：写入年级模板（teacher_id=null），同年级所有班级/小组共用
        grade = _extract_grade_from_class_id(class_id or header.class_id)
        class_type_val = _extract_class_type_from_class_id(db, class_id or header.class_id)
        course_id_val = header.course_id
        if grade is not None and course_id_val:
            course = db.query(Course).filter(Course.id == course_id_val).first()
            if not course:
                course = db.query(Course).filter(Course.course_id == course_id_val).first()
            ids_to_match = [course_id_val]
            if course:
                for cid in (str(course.id), getattr(course, "course_id", None)):
                    if cid and cid not in ids_to_match:
                        ids_to_match.append(cid)
            try:
                gtc = (
                    db.query(GradeTeachingContent)
                    .filter(
                        GradeTeachingContent.semester_label == header.semester_label,
                        GradeTeachingContent.grade == grade,
                        GradeTeachingContent.class_type == class_type_val,
                        GradeTeachingContent.teacher_id.is_(None),
                        GradeTeachingContent.course_id.in_(ids_to_match),
                    )
                    .first()
                )
                ei = header.extra_info or {}
                rh, th, ph = ei.get("required_hours"), ei.get("theory_hours"), ei.get("practice_hours")
                if gtc:
                    if rh is not None:
                        gtc.required_hours = int(rh) if not isinstance(rh, int) else rh
                    if th is not None:
                        gtc.theory_hours = int(th) if not isinstance(th, int) else th
                    if ph is not None:
                        gtc.practice_hours = int(ph) if not isinstance(ph, int) else ph
                else:
                    gtc = GradeTeachingContent(
                        semester_label=header.semester_label,
                        course_id=course_id_val,
                        grade=grade,
                        class_type=class_type_val,
                        teacher_id=None,
                        content_items=[],
                        remark_items=[],
                        required_hours=int(rh) if rh is not None else None,
                        theory_hours=int(th) if th is not None else None,
                        practice_hours=int(ph) if ph is not None else None,
                    )
                    db.add(gtc)
                db.commit()
            except OperationalError:
                pass

        # 保存后重新生成完整行数据返回
        rows, schedule_time_summary, schedule_time_by_class = _build_calendar_entries(db, header)
        extra_info_out = _merge_grade_hours_into_extra_info(db, header, header.extra_info or {})
        extra_info_out = _ensure_extra_info_defaults(extra_info_out, header.semester_label)

        return jsonify(
            {
                "header": {
                    "id": header.id,
                    "academic_year": header.academic_year,
                    "semester_label": header.semester_label,
                    "teacher_id": header.teacher_id,
                    "course_id": header.course_id,
                    "class_id": header.class_id,
                    "group_id": header.group_id,
                    "class_display_name": header.class_display_name,
                    "extra_info": extra_info_out,
                },
                "schedule_time_summary": schedule_time_summary,
                "schedule_time_by_class": schedule_time_by_class,
                "entries": rows,
            }
        )
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


def _fill_word_document_from_calendar(
    document, header: TeachingCalendarHeader, rows: List[dict], extra_info_override: Optional[dict] = None
):
    """
    使用教学日历数据填充 Word 文档：
    - 第一页：按标签（课程名称、学院、系部等）定位并填入对应值；若无标签则尝试替换原模板中的旧字符串
    - 第二页：根据 rows 重建教学日历表格内容
    - 第三页：根据学期设置月份（春季 2 月，秋季 8 月）
    - extra_info_override: 若提供则用其替代 header.extra_info（用于导出时合并年级学时）
    """
    extra = extra_info_override if extra_info_override is not None else (header.extra_info or {})

    course_name = extra.get("course_name") or ""
    class_display = header.class_display_name or (extra.get("major_class") or "")
    teacher_name = extra.get("teacher_name") or extra.get("teacher_full_name") or ""
    faculty_name = extra.get("faculty_name") or ""
    # 导出第一页时「学院」行固定填「影视传媒学院」
    faculty_name_for_doc = "影视传媒学院"
    department_name = extra.get("department_name") or "音乐系"
    textbook = extra.get("textbook") or ""
    teacher_position = extra.get("teacher_position") or ""
    required_hours = extra.get("required_hours")
    theory_hours = extra.get("theory_hours")
    practice_hours = extra.get("practice_hours")
    total_h = required_hours if required_hours is not None else 0
    theory_h = theory_hours if theory_hours is not None else 0
    practice_h = practice_hours if practice_hours is not None else 0

    # 第一页：按标签匹配并填入（适用于模板中只有“课程名称”等标签、右侧为空的情况）
    # 每个条目：(标签关键字列表, 要填入的值)；仅在第一列（标签列）匹配，避免误填
    # 系(部) 不匹配“学院系(部)主任审核意见”等审核行；学院不匹配校名“武昌理工学院”
    def _is_department_label_cell(cell_text: str, keywords: List[str]) -> bool:
        if not _cell_contains_any(cell_text, keywords):
            return False
        # 排除审核意见行：含“审核”“主任”的单元格不当作“系(部)”填写
        if any(k in (cell_text or "") for k in ["系(部)", "系（部）", "系 (部)"]):
            if "审核" in (cell_text or "") or "主任" in (cell_text or ""):
                return False
        return True

    # 导出时授课专业班级：不显示「小组学生：」前缀，只显示班级/学生姓名，且该格用 5 号字
    class_display_for_doc = (class_display or "").replace("小组学生：", "").strip()
    label_value_pairs = [
        (["课程名称"], course_name),
        (["学 院", "学院"], faculty_name_for_doc),
        (["系（部）", "系(部)", "系 (部)"], department_name),
        (["授课专业班级"], class_display_for_doc),
        (["主讲教师"], teacher_name),
        (["职 称", "职称"], teacher_position),
        (["选用教材"], textbook),
    ]

    def _cell_contains_any(cell_text: str, keywords: List[str]) -> bool:
        t = (cell_text or "").strip().replace(" ", "")
        for kw in keywords:
            if kw.replace(" ", "") in t or kw in (cell_text or ""):
                return True
        return False

    # 先找“周次”表所在表格，其它表格视为可能的信息页
    calendar_table = None
    for table in document.tables:
        if not table.rows:
            continue
        header_cells_text = [c.text.strip() for c in table.rows[0].cells]
        if header_cells_text and "周次" in (header_cells_text[0] or ""):
            calendar_table = table
            break

    for table in document.tables:
        if table is calendar_table:
            continue
        for row in table.rows:
            cells = row.cells
            for keywords, value in label_value_pairs:
                for i, cell in enumerate(cells):
                    # 只在第一列（标签列）匹配，避免“总学时”等出现在值列时误填
                    if i != 0:
                        continue
                    # 系(部) 不匹配“学院系(部)主任审核意见”单元格
                    if value is department_name:
                        if not _is_department_label_cell(cell.text, keywords):
                            continue
                    elif value is faculty_name_for_doc:
                        # “学院”不匹配校名行（武昌理工学院），只匹配表单中的“学院”标签
                        if "武昌理工学院" in (cell.text or ""):
                            continue
                        if not _cell_contains_any(cell.text, keywords):
                            continue
                    else:
                        if not _cell_contains_any(cell.text, keywords):
                            continue
                    if len(cells) >= 2 and i + 1 < len(cells):
                        # 两列：右侧单元格填入值；授课专业班级用 5 号字（10.5pt），其余四号（14pt）
                        target_cell = cells[i + 1]
                        for para in target_cell.paragraphs:
                            para.clear()
                        if target_cell.paragraphs:
                            r = target_cell.paragraphs[0].add_run(str(value))
                            pt = 10.5 if keywords == ["授课专业班级"] else 14
                            _set_run_font_size(r, pt)
                        _set_cell_vertical_center(cell)
                        _set_cell_vertical_center(target_cell)
                    else:
                        # 单列或同一格：在标签后追加值
                        ct = (cell.text or "").strip().rstrip("_ \t")
                        if str(value) not in ct:
                            for para in cell.paragraphs:
                                para.clear()
                            if cell.paragraphs:
                                r = cell.paragraphs[0].add_run(ct + " " + str(value))
                                pt = 10.5 if keywords == ["授课专业班级"] else 14
                                _set_run_font_size(r, pt)
                        _set_cell_vertical_center(cell)
                    break
            else:
                continue
            break

    # 第一页：总学时行 — 只替换模板中的数字，不改变模板的格式与样式（括号、空格等保持原样）
    for table in document.tables:
        if table is calendar_table:
            continue
        for row in table.rows:
            cells = row.cells
            if not cells or "总学时" not in (cells[0].text or ""):
                continue
            # 只替换数字或占位下划线：总学时X、理论学时Y、实践学时Z（模板可能是 总学时___、总学时 或 总学时32）
            def replace_hours_in_text(text: str) -> str:
                if not text or "总学时" not in text:
                    return text
                s = re.sub(r"(总学时)\s*[\d_]*", rf"\g<1>{total_h}", text, count=1)
                s = re.sub(r"(理论学时)\s*[\d_]*", rf"\g<1>{theory_h}", s, count=1)
                s = re.sub(r"(实践学时)\s*[\d_]*", rf"\g<1>{practice_h}", s, count=1)
                return s

            if "(其中:" in (cells[0].text or "") or "理论学时" in (cells[0].text or ""):
                new_text = replace_hours_in_text(cells[0].text or "")
                if new_text != (cells[0].text or ""):
                    for para in cells[0].paragraphs:
                        para.clear()
                    if cells[0].paragraphs:
                        r = cells[0].paragraphs[0].add_run(new_text)
                        _set_run_font_size(r, 14)
                    _set_cell_vertical_center(cells[0])
            elif len(cells) >= 2 and ("(其中:" in (cells[1].text or "") or "理论学时" in (cells[1].text or "")):
                t0 = replace_hours_in_text(cells[0].text or "")
                t1 = replace_hours_in_text(cells[1].text or "")
                if t0 != (cells[0].text or ""):
                    for para in cells[0].paragraphs:
                        para.clear()
                    if cells[0].paragraphs:
                        r = cells[0].paragraphs[0].add_run(t0)
                        _set_run_font_size(r, 14)
                if t1 != (cells[1].text or ""):
                    for para in cells[1].paragraphs:
                        para.clear()
                    if cells[1].paragraphs:
                        r = cells[1].paragraphs[0].add_run(t1)
                        _set_run_font_size(r, 14)
                _set_cell_vertical_center(cells[0])
                _set_cell_vertical_center(cells[1])
            break

    # 第三页：学院系(部)主任审核意见 — 填入“符合要求, 审核通过。签字: 谷浚宝”及审核日期（保留原模板5号字，不设四号）
    semester = extra.get("semester")
    audit_year = (extra.get("academic_year") or "").strip()
    if "-" in audit_year:
        audit_year = audit_year.split("-")[-1].strip()  # 2025-2026 -> 2026
    if not audit_year and header.academic_year:
        audit_year = str(header.academic_year).split("-")[-1].strip()
    try:
        sem_int = int(semester) if semester is not None else 2
        audit_month = "2 月" if sem_int == 2 else "8 月"
    except Exception:
        audit_month = "2 月"
        sem_int = 2
    audit_date_str = f"{audit_year or '2026'}年{audit_month}"
    review_text = f"符合要求, 审核通过。\n签字: 谷浚宝\n{audit_date_str}"
    for table in document.tables:
        if table is calendar_table:
            continue
        for row in table.rows:
            cells = row.cells
            for i, cell in enumerate(cells):
                if "学院系" in (cell.text or "") and "审核意见" in (cell.text or ""):
                    if i + 1 < len(cells):
                        target = cells[i + 1]
                        for para in target.paragraphs:
                            para.clear()
                        if target.paragraphs:
                            target.paragraphs[0].add_run(review_text)
                        _set_cell_vertical_center(target)
                    break
            else:
                continue
            break

    # 段落中按标签填入：若某段落含“课程名称”等标签，则在该段落后追加值（同一段内）
    # 校名行只保留「武昌理工学院」：含「武昌理工学院」的段落不参与任何标签追加，避免把「学院」当成标签误追加影视传媒学院
    for para in document.paragraphs:
        text = (para.text or "").strip()
        if "武昌理工学院" in text:
            continue
        for keywords, value in label_value_pairs:
            if not value:
                continue
            for kw in keywords:
                if kw not in text and kw.replace(" ", "") not in text.replace(" ", ""):
                    continue
                # 避免重复追加
                if str(value) in text:
                    break
                # 标签后追加值（去掉段尾多余下划线/空格）
                base = text.rstrip("_ \t")
                if not base.endswith(str(value)):
                    para.text = base + " " + str(value)
                break
            else:
                continue
            break

    # 第一页：仍做旧模板字符串替换（模板里若有“多声部音乐分析与写作2”等旧文字也可被替换）
    # 校名区域保持模板原样：不替换“武昌理工学院”“影视传媒学院”等，不在含校名的单元格/段落做任何替换
    replacements = {
        "多声部音乐分析与写作2": course_name or "",
        "音乐学2401": class_display or "",
        "谷浚宝": teacher_name or "",
        "音乐学系": department_name or "音乐系",
        "《和声学教程》": textbook or "",
        "讲师": teacher_position or "",
        "程惠萌": "谷浚宝",
    }
    def _is_school_name_cell(text: str) -> bool:
        return text and ("武昌理工学院" in text or "校名" in text)

    for para in document.paragraphs:
        if _is_school_name_cell(para.text):
            continue
        for old, new in replacements.items():
            if old in para.text:
                para.text = para.text.replace(old, str(new))
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                if _is_school_name_cell(cell.text):
                    continue
                for para in cell.paragraphs:
                    if _is_school_name_cell(para.text):
                        continue
                    for old, new in replacements.items():
                        if old in para.text:
                            para.text = para.text.replace(old, str(new))

    # 第一页信息表：所有单元格内文字统一为四号（14pt）；第三页审核表保留原模板字号（5号），不改为四号
    def _table_is_audit_table(tbl):
        for row in tbl.rows:
            for cell in row.cells:
                if "学院系" in (cell.text or "") and "审核意见" in (cell.text or ""):
                    return True
        return False

    for table in document.tables:
        if table is calendar_table:
            continue
        if _table_is_audit_table(table):
            continue
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    for run in para.runs:
                        _set_run_font_size(run, 14)

    # 第二页：找到包含“周次”表头的表格，重建内容
    if calendar_table is None:
        for table in document.tables:
            if not table.rows:
                continue
            header_cells_text = [cell.text.strip() for cell in table.rows[0].cells]
            if header_cells_text and "周次" in header_cells_text[0]:
                calendar_table = table
                break

    if calendar_table is not None:
        # 保留表头行，清空其余行
        while len(calendar_table.rows) > 1:
            calendar_table._tbl.remove(calendar_table.rows[1]._tr)

        for row_data in rows:
            row = calendar_table.add_row()
            cells = row.cells
            # 列顺序：周次 / 授课日期 / 节次 / 学时 / 教学内容 / 备注（有 week_range_text 则用「第1-2、4-17周」，否则用中文周次）
            if len(cells) >= 6:
                week_range = row_data.get("week_range_text")
                if week_range:
                    cells[0].text = week_range
                else:
                    week_num = row_data.get("week_number")
                    cells[0].text = _week_to_chinese(week_num) if week_num else str(week_num or "")
                cells[1].text = row_data.get("date_text") or ""
                cells[2].text = row_data.get("period_text") or ""
                hours = row_data.get("hours")
                cells[3].text = str(hours) if hours is not None else ""
                cells[4].text = row_data.get("teaching_content") or ""
                cells[5].text = row_data.get("remark") or ""
                for c in cells:
                    _set_cell_vertical_center(c)
        # 表头行也居中
        if calendar_table.rows:
            for c in calendar_table.rows[0].cells:
                _set_cell_vertical_center(c)

    # 所有表格单元格统一设为上下居中
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                _set_cell_vertical_center(cell)

    # 第三页：根据学期设置月份（春季 2 月，秋季 8 月）
    semester_month = None
    semester = extra.get("semester")
    if semester is not None:
        try:
            sem_int = int(semester)
            if sem_int == 2:
                semester_month = "2 月"
            elif sem_int == 1:
                semester_month = "8 月"
        except Exception:
            pass

    if semester_month:
        for para in document.paragraphs:
            if "月" in para.text and "年" in para.text:
                # 简单替换“X 月”为约定月份
                parts = para.text.split("年")
                if len(parts) >= 2:
                    prefix = parts[0] + "年 "
                    para.text = prefix + semester_month


@api_bp.route("/teaching-calendar/export", methods=["GET"])
def export_teaching_calendar():
    """
    导出教学日历 Word 文档。

    查询参数与 GET /teaching-calendar 相同：
    - semester_label
    - teacher_id
    - course_id
    - class_id (可选)
    - group_id (可选)
    """
    if Document is None:
        return jsonify({"error": "python-docx 未安装，无法导出 Word 文档"}), 500

    db = next(get_db())
    try:
        semester_label = request.args.get("semester_label")
        teacher_id = request.args.get("teacher_id")
        course_id = request.args.get("course_id")
        class_id = request.args.get("class_id") or None
        group_id = request.args.get("group_id") or None

        if not semester_label or not teacher_id or not course_id:
            return (
                jsonify(
                    {
                        "error": "semester_label, teacher_id, course_id 为必填参数",
                    }
                ),
                400,
            )

        academic_year = None
        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            course = db.query(Course).filter(Course.course_id == course_id).first()
        if course and course.academic_year:
            academic_year = course.academic_year

        header = _get_or_create_calendar_header(
            db=db,
            academic_year=academic_year,
            semester_label=semester_label,
            teacher_id=teacher_id,
            course_id=course_id,
            class_id=class_id,
            group_id=group_id,
        )
        rows, _, _ = _build_calendar_entries(db, header)

        # 基于现有模板生成文档
        if not os.path.exists(TEMPLATE_PATH):
            return (
                jsonify(
                    {
                        "error": f"教学日历模板不存在，请确认文件路径: {TEMPLATE_PATH}",
                    }
                ),
                500,
            )

        document = Document(TEMPLATE_PATH)
        export_extra = _merge_grade_hours_into_extra_info(db, header, header.extra_info or {})
        _fill_word_document_from_calendar(document, header, rows, extra_info_override=export_extra)

        # 组合导出文件名：教师姓名 + 课程名称 + 班级 / 小组
        extra = export_extra
        teacher_name = (
            extra.get("teacher_name") or extra.get("teacher_full_name") or "教师"
        )
        course_name = extra.get("course_name") or "课程"

        class_display = header.class_display_name or (
            extra.get("major_class") or extra.get("class_name") or "班级"
        )

        # 移除文件名非法字符及换行，避免 Content-Disposition 报错（Header values must not contain newline）
        def _safe_filename(s: str) -> str:
            t = (s or "").replace("\r", "").replace("\n", " ").strip()
            return "".join(c for c in t if c not in r'\/:*?"<>|') or "未命名"

        file_name = f"{_safe_filename(teacher_name)}_{_safe_filename(course_name)}_{_safe_filename(class_display)}.docx"

        buffer = io.BytesIO()
        document.save(buffer)
        buffer.seek(0)

        return send_file(
            buffer,
            as_attachment=True,
            download_name=file_name,
            mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@api_bp.route("/teaching-calendar/clear-entries", methods=["POST", "GET"])
def clear_teaching_calendar_entries():
    """
    清除当前教学日历的已导入数据（教学内容与备注）及该教师本课程年级模板，便于重新导入 Word。
    谁上传谁使用：清除时一并删除年级模板，避免部分班级改、部分不改。
    返回清除后的日历数据（与 GET 一致）。
    """
    db = next(get_db())
    try:
        if request.method == "POST":
            data = request.get_json(silent=True) or {}
        else:
            data = request.args
        semester_label = data.get("semester_label")
        teacher_id = data.get("teacher_id")
        course_id = data.get("course_id")
        class_id = data.get("class_id") or None
        group_id = data.get("group_id") or None

        if not semester_label or not teacher_id or not course_id:
            return jsonify({"error": "semester_label, teacher_id, course_id 为必填"}), 400

        academic_year = None
        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            course = db.query(Course).filter(Course.course_id == course_id).first()
        if course and course.academic_year:
            academic_year = course.academic_year

        header = _get_or_create_calendar_header(
            db=db,
            academic_year=academic_year,
            semester_label=semester_label,
            teacher_id=teacher_id,
            course_id=course_id,
            class_id=class_id,
            group_id=group_id,
        )

        deleted = (
            db.query(TeachingCalendarEntry)
            .filter(TeachingCalendarEntry.calendar_header_id == header.id)
            .delete()
        )
        # 同时删除该教师本课程本年级的年级模板，谁上传谁使用、要改一起改
        # 含 teacher_id 为空的旧模板，避免刷新时回退加载到旧数据
        grade = _extract_grade_from_class_id(class_id)
        class_type = _extract_class_type_from_class_id(db, class_id)
        if grade and teacher_id:
            ids_to_match = [course_id]
            if course:
                for cid in (str(course.id), getattr(course, "course_id", None)):
                    if cid and cid not in ids_to_match:
                        ids_to_match.append(cid)
            try:
                db.query(GradeTeachingContent).filter(
                    GradeTeachingContent.semester_label == semester_label,
                    GradeTeachingContent.grade == grade,
                    GradeTeachingContent.class_type == class_type,
                    GradeTeachingContent.course_id.in_(ids_to_match),
                    GradeTeachingContent.teacher_id == teacher_id,
                ).delete(synchronize_session=False)
                db.query(GradeTeachingContent).filter(
                    GradeTeachingContent.semester_label == semester_label,
                    GradeTeachingContent.grade == grade,
                    GradeTeachingContent.class_type == class_type,
                    GradeTeachingContent.course_id.in_(ids_to_match),
                    GradeTeachingContent.teacher_id.is_(None),
                ).delete(synchronize_session=False)
            except OperationalError:
                pass
        db.commit()

        rows, schedule_time_summary, schedule_time_by_class = _build_calendar_entries(db, header)
        # 清除后返回的日历中，有排课行的教学内容和备注一律置空，便于用户重新导入；空周保留禁排原因
        for r in rows:
            if r.get("schedule_id") and not r.get("is_empty_week"):
                r["teaching_content"] = ""
                r["remark"] = ""

        return jsonify(
            {
                "header": {
                    "id": header.id,
                    "academic_year": header.academic_year,
                    "semester_label": header.semester_label,
                    "teacher_id": header.teacher_id,
                    "course_id": header.course_id,
                    "class_id": header.class_id,
                    "group_id": header.group_id,
                    "class_display_name": header.class_display_name,
                    "extra_info": _ensure_extra_info_defaults(
                        header.extra_info, header.semester_label
                    ),
                },
                "schedule_time_summary": schedule_time_summary,
                "schedule_time_by_class": schedule_time_by_class,
                "entries": rows,
                "cleared_count": deleted,
            }
        )
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@api_bp.route("/teaching-calendar/import", methods=["POST"])
def import_teaching_calendar():
    """
    从教师上传的 Word 模板中导入教学内容与备注。

    表单字段：
    - file: 上传的 .docx 文件
    - semester_label
    - teacher_id
    - course_id
    - class_id (可选)
    - group_id (可选)
    """
    if Document is None:
        return jsonify({"error": "python-docx 未安装，无法导入 Word 文档"}), 500

    db = next(get_db())
    try:
        semester_label = request.form.get("semester_label")
        teacher_id = request.form.get("teacher_id")
        course_id = request.form.get("course_id")
        class_id = request.form.get("class_id") or None
        group_id = request.form.get("group_id") or None

        if not semester_label or not teacher_id or not course_id:
            return (
                jsonify(
                    {
                        "error": "semester_label, teacher_id, course_id 为必填字段",
                    }
                ),
                400,
            )

        file = request.files.get("file")
        if not file:
            return jsonify({"error": "缺少文件"}), 400

        academic_year = None
        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            course = db.query(Course).filter(Course.course_id == course_id).first()
        if course and course.academic_year:
            academic_year = course.academic_year

        header = _get_or_create_calendar_header(
            db=db,
            academic_year=academic_year,
            semester_label=semester_label,
            teacher_id=teacher_id,
            course_id=course_id,
            class_id=class_id,
            group_id=group_id,
        )

        # 基于当前规则生成行顺序（作为“权威顺序”）
        rows, _, _ = _build_calendar_entries(db, header)

        # 解析上传的 Word 文档中的教学日历表格
        document = Document(file)
        calendar_table = None
        for table in document.tables:
            if not table.rows:
                continue
            header_cells_text = [cell.text.strip() for cell in table.rows[0].cells]
            if header_cells_text and "周次" in header_cells_text[0]:
                calendar_table = table
                break

        if calendar_table is None:
            return jsonify({"error": "未在上传的文档中找到教学日历表格"}), 400

        # 读取表体行（跳过表头），按顺序提取“教学内容”和“备注”，最多 16 行
        imported_cells: List[dict] = []
        for row in list(calendar_table.rows)[1:]:
            cells = row.cells
            if len(cells) < 6:
                continue
            teaching_content = cells[4].text.strip()
            remark = cells[5].text.strip()
            imported_cells.append(
                {
                    "teaching_content": teaching_content,
                    "remark": remark,
                }
            )
        # 约定：教师上传 16 行教学内容（中间不空），第 i 行 = 第 i 个上课周，与具体日历周无关
        content_list = [c["teaching_content"] for c in imported_cells[:16]]
        remark_list = [c["remark"] for c in imported_cells[:16]]

        # 只对有排课的行分配：按「上课周顺序」映射（第 i 个有排课的周 → content_list[i]）
        teaching_rows = [
            r for r in rows
            if r.get("schedule_id") and not r.get("is_empty_week")
        ]
        teaching_rows.sort(key=lambda r: (r.get("week_number") or 0, r.get("schedule_id") or ""))
        weeks_ordered = sorted(set(r.get("week_number") or 0 for r in teaching_rows if (r.get("week_number") or 0) > 0))

        # 读取现有 entry 以便 upsert
        existing_entries: List[TeachingCalendarEntry] = (
            db.query(TeachingCalendarEntry)
            .filter(TeachingCalendarEntry.calendar_header_id == header.id)
            .all()
        )
        by_schedule: Dict[str, TeachingCalendarEntry] = {}
        by_empty_week: Dict[int, TeachingCalendarEntry] = {}
        for e in existing_entries:
            if e.schedule_id:
                by_schedule[e.schedule_id] = e
            elif e.is_empty_week:
                by_empty_week[e.week_number] = e

        # 按上课周顺序分配：第 i 个有排课的周（weeks_ordered[i]）的所有行 ← content_list[i]
        for i, week_number in enumerate(weeks_ordered[:16]):
            tc = content_list[i] if i < len(content_list) else ""
            rm_imported = remark_list[i] if i < len(remark_list) else ""
            for row_data in teaching_rows:
                if int(row_data.get("week_number") or 0) != week_number:
                    continue
                schedule_id = row_data.get("schedule_id")
                if not schedule_id:
                    continue
                entry = by_schedule.get(schedule_id)
                if entry is None:
                    entry = TeachingCalendarEntry(
                        calendar_header_id=header.id,
                        schedule_id=schedule_id,
                        week_number=week_number,
                        is_empty_week=False,
                        teaching_content=tc,
                        remark=rm_imported,
                    )
                    db.add(entry)
                else:
                    entry.teaching_content = tc
                    if not (entry.remark or "").strip():
                        entry.remark = rm_imported

        # 空周行不写入导入内容与备注，保持原有 remark（禁排原因）不变，无需遍历

        db.commit()

        # 若选择了班级，将导入的教学内容与备注同时保存为年级模板，供同年级同班级类型使用
        grade = _extract_grade_from_class_id(class_id)
        class_type = _extract_class_type_from_class_id(db, class_id)
        if grade and course_id and teaching_rows:
            # 年级模板按「上课周顺序」存 16 条：content_items[i]=第 i 个上课周，适用于任意排课周组合
            content_items = [content_list[i] if i < len(content_list) else "" for i in range(16)]
            remark_items = [remark_list[i] if i < len(remark_list) else "" for i in range(16)]
            ids_to_match = [course_id]
            if course:
                for cid in (str(course.id), course.course_id):
                    if cid and cid not in ids_to_match:
                        ids_to_match.append(cid)
            teacher_id = header.teacher_id
            gtc = (
                db.query(GradeTeachingContent)
                .filter(
                    GradeTeachingContent.semester_label == semester_label,
                    GradeTeachingContent.grade == grade,
                    GradeTeachingContent.class_type == class_type,
                    GradeTeachingContent.teacher_id == teacher_id,
                    GradeTeachingContent.course_id.in_(ids_to_match),
                )
                .first()
            )
            if gtc:
                gtc.content_items = content_items
                gtc.remark_items = remark_items
            else:
                gtc = GradeTeachingContent(
                    semester_label=semester_label,
                    course_id=course_id,
                    grade=grade,
                    class_type=class_type,
                    teacher_id=teacher_id,
                    content_items=content_items,
                    remark_items=remark_items,
                )
                db.add(gtc)
            db.commit()

        # 导入后返回最新数据
        rows, schedule_time_summary, schedule_time_by_class = _build_calendar_entries(db, header)
        return jsonify(
            {
                "header": {
                    "id": header.id,
                    "academic_year": header.academic_year,
                    "semester_label": header.semester_label,
                    "teacher_id": header.teacher_id,
                    "course_id": header.course_id,
                    "class_id": header.class_id,
                    "group_id": header.group_id,
                    "class_display_name": header.class_display_name,
                    "extra_info": _ensure_extra_info_defaults(
                        header.extra_info, header.semester_label
                    ),
                },
                "schedule_time_summary": schedule_time_summary,
                "schedule_time_by_class": schedule_time_by_class,
                "entries": rows,
            }
        )
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


@api_bp.route("/teaching-calendar/grade-content", methods=["GET"])
def get_grade_teaching_content():
    """获取某学期某课程某年级某班级类型的教学内容模板（谁上传谁使用）。查询参数：semester_label, course_id, grade, class_type, teacher_id"""
    db = next(get_db())
    try:
        semester_label = request.args.get("semester_label")
        course_id = request.args.get("course_id")
        grade_str = request.args.get("grade")
        class_type = request.args.get("class_type") or "general"
        teacher_id = request.args.get("teacher_id")
        if class_type not in ("general", "upgrade"):
            class_type = "general"
        if not semester_label or not course_id or not grade_str:
            return jsonify({"error": "semester_label, course_id, grade 为必填参数"}), 400
        try:
            grade = int(grade_str)
        except ValueError:
            return jsonify({"error": "grade 必须为数字"}), 400

        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            course = db.query(Course).filter(Course.course_id == course_id).first()
        ids_to_match = [str(course.id), course.course_id] if course and course.course_id else [course_id]

        q = (
            db.query(GradeTeachingContent)
            .filter(
                GradeTeachingContent.semester_label == semester_label,
                GradeTeachingContent.grade == grade,
                GradeTeachingContent.class_type == class_type,
                GradeTeachingContent.course_id.in_(ids_to_match),
            )
        )
        gtc = q.filter(GradeTeachingContent.teacher_id == teacher_id).first() if teacher_id else None
        if not gtc and teacher_id:
            gtc = q.filter(GradeTeachingContent.teacher_id.is_(None)).first()
        if not gtc:
            return jsonify({"content_items": [], "remark_items": []})
        return jsonify({
            "content_items": gtc.content_items or [],
            "remark_items": getattr(gtc, "remark_items", None) or [],
        })
    finally:
        db.close()


@api_bp.route("/teaching-calendar/grade-content", methods=["POST"])
def save_grade_teaching_content():
    """保存某学期某课程某年级某班级类型的教学内容与备注模板（谁上传谁使用）。请求体：{ semester_label, course_id, grade, class_type?, teacher_id, content_items, remark_items? }"""
    db = next(get_db())
    try:
        data = request.get_json() or {}
        semester_label = data.get("semester_label")
        course_id = data.get("course_id")
        grade = data.get("grade")
        class_type = data.get("class_type") or "general"
        teacher_id = data.get("teacher_id")
        content_items = data.get("content_items")
        remark_items = data.get("remark_items")
        if not semester_label or not course_id or grade is None:
            return jsonify({"error": "semester_label, course_id, grade 为必填字段"}), 400
        try:
            grade = int(grade)
        except (ValueError, TypeError):
            return jsonify({"error": "grade 必须为数字"}), 400
        if not isinstance(content_items, list):
            content_items = []
        if not isinstance(remark_items, list):
            remark_items = []

        course = db.query(Course).filter(Course.id == course_id).first()
        if not course:
            course = db.query(Course).filter(Course.course_id == course_id).first()
        ids_to_match = [str(course.id), course.course_id] if course and course.course_id else [course_id]

        gtc = (
            db.query(GradeTeachingContent)
            .filter(
                GradeTeachingContent.semester_label == semester_label,
                GradeTeachingContent.grade == grade,
                GradeTeachingContent.class_type == class_type,
                GradeTeachingContent.teacher_id == teacher_id,
                GradeTeachingContent.course_id.in_(ids_to_match),
            )
            .first()
        )
        if gtc:
            gtc.content_items = content_items
            gtc.remark_items = remark_items
        else:
            gtc = GradeTeachingContent(
                semester_label=semester_label,
                course_id=course_id,
                grade=grade,
                class_type=class_type,
                teacher_id=teacher_id,
                content_items=content_items,
                remark_items=remark_items,
            )
            db.add(gtc)
        db.commit()
        return jsonify({
            "content_items": gtc.content_items or [],
            "remark_items": getattr(gtc, "remark_items", None) or [],
        })
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()

