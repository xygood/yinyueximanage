from datetime import timedelta
from typing import Dict, List, Optional
import io
import os
import re
import traceback

from flask import request, jsonify, send_file
from sqlalchemy import or_

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
except ImportError:  # pragma: no cover - 运行环境未安装 python-docx 时，仅导出接口会失败
    Document = None  # type: ignore


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


def _week_to_chinese(week_number: Optional[int]) -> str:
    if week_number is None or week_number < 1:
        return ""
    return WEEK_CN[week_number - 1] if week_number <= len(WEEK_CN) else str(week_number)


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
    """
    header = (
        db.query(TeachingCalendarHeader)
        .filter(
            TeachingCalendarHeader.semester_label == semester_label,
            TeachingCalendarHeader.teacher_id == teacher_id,
            TeachingCalendarHeader.course_id == course_id,
            TeachingCalendarHeader.class_id == class_id,
            TeachingCalendarHeader.group_id == group_id,
        )
        .first()
    )

    if header:
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

    # 小组课时，在班级后追加 -序号（例如 音乐学2301-1、2301-2）
    class_display_name = base_class_name

    if group_id:
        # 计算当前小组在该教师 + 课程范围内的序号
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

        if group_index:
            if class_display_name:
                class_display_name = f"{class_display_name}-{group_index}"
            else:
                class_display_name = f"{group_index}"

        # 为小组课追加学生姓名列表（第二行，小号字体，由导出模板负责）
        student_names: List[str] = []
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
        extra_info["faculty_name"] = teacher.faculty_name
        extra_info["faculty_code"] = teacher.faculty_code

    # 学年学期文本
    semester_text = None
    if academic_year and course and course.semester:
        semester_text = f"{academic_year} 学年第 {course.semester} 学期"
    extra_info["semester_text"] = semester_text

    # 系部默认值为音乐系
    if not extra_info.get("department_name"):
        extra_info["department_name"] = "音乐系"

    header = TeachingCalendarHeader(
        academic_year=academic_year,
        semester_label=semester_label,
        teacher_id=teacher_id,
        course_id=course_id,
        class_id=class_id,
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


def _ensure_extra_info_defaults(extra_info: Optional[dict]) -> dict:
    """确保 extra_info 中系部等字段有默认值"""
    out = dict(extra_info or {})
    if not out.get("department_name"):
        out["department_name"] = "音乐系"
    return out


def _filter_remark_no_admin_meeting(remark: str) -> str:
    """展示备注时过滤掉「行政例会」，保留其它禁排原因"""
    if not remark or not remark.strip():
        return remark or ""
    parts = re.split(r"[；;]", remark)
    filtered = [p.strip() for p in parts if p.strip() and p.strip() != "行政例会"]
    return "；".join(filtered) if filtered else ""


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


def _build_calendar_entries(db, header: TeachingCalendarHeader):
    """
    根据排课结果、学期周次配置和已保存的 TeachingCalendarEntry 生成完整的教学日历行数据。
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

    schedule_query = db.query(ScheduledClass).filter(
        or_(
            ScheduledClass.semester_label == semester_label,
            ScheduledClass.semester_label.is_(None),
        )
    )
    if course:
        # 兼容使用 courses.id 或 courses.course_id 作为 ScheduledClass.course_id 的情况
        ids_to_match = [course.id]
        if course.course_id:
            ids_to_match.append(course.course_id)
        schedule_query = schedule_query.filter(ScheduledClass.course_id.in_(ids_to_match))
    else:
        # 回退：直接使用 header.course_id 过滤
        schedule_query = schedule_query.filter(ScheduledClass.course_id == course_id)

    if group_id:
        schedule_query = schedule_query.filter(ScheduledClass.group_id == group_id)

    # 若选择了具体班级，则仅保留该班级的学生/排课：
    # - 小组课：Student.major_class 匹配
    # - 专业大课：ScheduledClass.class_id 匹配（支持「音乐学2401」与「2401」两种格式）
    if class_id:
        if class_id.startswith("音乐学"):
            class_id_alt = class_id.replace("音乐学", "", 1)
        elif class_id.startswith("专升本"):
            class_id_alt = class_id.replace("专升本", "", 1)
        else:
            class_id_alt = f"音乐学{class_id}"
        schedule_query = (
            schedule_query.outerjoin(
                Student, ScheduledClass.student_id == Student.student_id
            ).filter(
                or_(
                    ScheduledClass.class_id == class_id,
                    ScheduledClass.class_id == class_id_alt,
                    Student.major_class == class_id,
                    Student.major_class == class_id_alt,
                )
            )
        )

    schedules: List[ScheduledClass] = schedule_query.all()

    # 周次 -> 对应的排课记录列表
    schedules_by_week: Dict[int, List[ScheduledClass]] = {}
    for s in schedules:
        week = s.week_number or s.start_week or 1
        if week is None:
            continue
        schedules_by_week.setdefault(week, []).append(s)

    # 同年级教学内容：按实际上课周次映射（16 条平分到实际周次），专业本和普通班不共用
    grade_content_by_week: Dict[int, str] = {}
    grade = _extract_grade_from_class_id(class_id)
    class_type = _extract_class_type_from_class_id(db, class_id)
    if grade and course:
        ids_to_match = [str(course.id), course.course_id] if course.course_id else [str(course.id)]
        gtc = (
            db.query(GradeTeachingContent)
            .filter(
                GradeTeachingContent.semester_label == semester_label,
                GradeTeachingContent.grade == grade,
                GradeTeachingContent.class_type == class_type,
                GradeTeachingContent.course_id.in_(ids_to_match),
            )
            .first()
        )
        if gtc and gtc.content_items:
            scheduled_weeks = sorted(schedules_by_week.keys())
            num_weeks = len(scheduled_weeks)
            items = list(gtc.content_items) if isinstance(gtc.content_items, list) else []
            distributed = _distribute_content_to_weeks(items, num_weeks)
            for i, w in enumerate(scheduled_weeks):
                if i < len(distributed) and distributed[i]:
                    grade_content_by_week[w] = distributed[i]

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

    # 构建返回给前端的行数据
    rows: List[dict] = []

    start_date = config.start_date if config else None

    for week in range(1, total_weeks + 1):
        week_schedules = schedules_by_week.get(week, [])
        # 先按日期、星期、节次排序，保证导出与展示顺序稳定
        def _sort_key(s: ScheduledClass):
            d = s.date
            if not d and start_date and s.day_of_week:
                d = start_date + timedelta(weeks=week - 1, days=s.day_of_week - 1)
            return (
                d or (start_date or ()),
                s.day_of_week or 0,
                s.period or 0,
            )

        week_schedules.sort(key=_sort_key)

        if week_schedules:
            # 专业大课：2节连上，按 (day_of_week) 分组后合并连续节次为一行，显示第X-X节
            # 非专业大课：按 (day_of_week, period, duration) 去重，每时间段一行
            if is_major_class:
                # 按 day_of_week 分组
                by_day: Dict[int, List[ScheduledClass]] = {}
                for s in week_schedules:
                    dow = s.day_of_week or 0
                    if dow not in by_day:
                        by_day[dow] = []
                    by_day[dow].append(s)

                for dow, day_schedules in sorted(by_day.items()):
                    if not dow:
                        continue
                    # 收集所有节次（去重，同一 period 可能有多条 duration）
                    period_to_schedule: Dict[int, ScheduledClass] = {}
                    for s in day_schedules:
                        p = s.period or 0
                        if p and (p not in period_to_schedule or (s.duration or 1) > 1):
                            period_to_schedule[p] = s

                    periods = sorted(period_to_schedule.keys())
                    if not periods:
                        continue

                    # 合并连续节次：[(7,8), (10,)] -> 第7-8节、第10节
                    def _consecutive_ranges(ps: List[int]) -> List[tuple]:
                        if not ps:
                            return []
                        ranges: List[tuple] = []
                        start, end = ps[0], ps[0]
                        for p in ps[1:]:
                            if p == end + 1:
                                end = p
                            else:
                                ranges.append((start, end))
                                start, end = p, p
                        ranges.append((start, end))
                        return ranges

                    for start_p, end_p in _consecutive_ranges(periods):
                        s = period_to_schedule[start_p]
                        d = s.date
                        if not d and start_date and s.day_of_week:
                            d = start_date + timedelta(weeks=week - 1, days=s.day_of_week - 1)
                        date_text = f"{d.month}月{d.day}日" if d else ""
                        date_iso = d.isoformat() if d else None

                        if start_p == end_p:
                            period_text = f"第{start_p}节"
                            hours = 2
                        else:
                            period_text = f"第{start_p}-{end_p}节"
                            # 专业大课 2节连上=2学时，合并后仍为2学时
                            hours = 2

                        entry = entry_by_schedule.get(s.id)
                        teaching_content = (entry.teaching_content if entry else "") or ""
                        if not teaching_content and week in grade_content_by_week:
                            teaching_content = grade_content_by_week[week]
                        remark = _filter_remark_no_admin_meeting(entry.remark if entry else "")

                        rows.append({
                            "id": entry.id if entry else None,
                            "schedule_id": s.id,
                            "week_number": week,
                            "is_empty_week": False,
                            "date": date_iso,
                            "date_text": date_text,
                            "period_text": period_text,
                            "hours": hours,
                            "teaching_content": teaching_content or "",
                            "remark": remark or "",
                        })
            else:
                seen_slots = set()
                for s in week_schedules:
                    slot_key = (s.day_of_week or 0, s.period or 0, s.duration or 1)
                    if slot_key in seen_slots:
                        continue
                    seen_slots.add(slot_key)

                    d = s.date
                    if not d and start_date and s.day_of_week:
                        d = start_date + timedelta(weeks=week - 1, days=s.day_of_week - 1)
                    date_text = f"{d.month}月{d.day}日" if d else ""
                    date_iso = d.isoformat() if d else None

                    period_text = ""
                    if s.period:
                        if s.duration and s.duration > 1:
                            period_text = f"第{s.period}-{s.period + s.duration - 1}节"
                        else:
                            period_text = f"第{s.period}节"

                    hours = s.duration or 1
                    entry = entry_by_schedule.get(s.id)
                    teaching_content = (entry.teaching_content if entry else "") or ""
                    if not teaching_content and week in grade_content_by_week:
                        teaching_content = grade_content_by_week[week]
                    remark = _filter_remark_no_admin_meeting(entry.remark if entry else "")

                    rows.append({
                        "id": entry.id if entry else None,
                        "schedule_id": s.id,
                        "week_number": week,
                        "is_empty_week": False,
                        "date": date_iso,
                        "date_text": date_text,
                        "period_text": period_text,
                        "hours": hours,
                        "teaching_content": teaching_content or "",
                        "remark": remark or "",
                    })
        else:
            # 空周：生成一行，周次有值，其余为空
            entry = empty_entry_by_week.get(week)
            remark = _filter_remark_no_admin_meeting(
                entry.remark if entry else week_blocked_reason.get(week, "")
            )

            rows.append(
                {
                    "id": entry.id if entry else None,
                    "schedule_id": None,
                    "week_number": week,
                    "is_empty_week": True,
                    "date": None,
                    "date_text": "",
                    "period_text": "",
                    "hours": None,
                    "teaching_content": (entry.teaching_content if entry else "") or "",
                    "remark": remark or "",
                }
            )

    return rows


@api_bp.route("/teaching-calendar", methods=["GET"])
def get_teaching_calendar():
    """
    获取某一教师 + 课程 (+ 班级/小组) 在某学期的教学日历数据：
    - 若尚未有头信息记录，会根据课程/教师/排课自动创建一份默认配置；
    - 行数据始终由排课与周次配置实时推导，再叠加已保存的教学内容/备注。
    """
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

        rows = _build_calendar_entries(db, header)

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
                    "extra_info": _ensure_extra_info_defaults(header.extra_info),
                },
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

        extra_info = header.extra_info or {}
        extra_info_update = header_data.get("extra_info") or {}
        if isinstance(extra_info_update, dict):
            extra_info.update(extra_info_update)
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

        # 保存后重新生成完整行数据返回
        rows = _build_calendar_entries(db, header)

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
                    "extra_info": _ensure_extra_info_defaults(header.extra_info),
                },
                "entries": rows,
            }
        )
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()


def _fill_word_document_from_calendar(document, header: TeachingCalendarHeader, rows: List[dict]):
    """
    使用教学日历数据填充 Word 文档：
    - 第一页：替换课程名、班级、教师等文本（基于现有《多声部音乐分析与写作2》模板中的原始文字）
    - 第二页：根据 rows 重建教学日历表格内容
    - 第三页：根据学期设置月份（春季 2 月，秋季 8 月）
    """
    extra = header.extra_info or {}

    course_name = extra.get("course_name") or ""
    class_display = header.class_display_name or (extra.get("major_class") or "")
    teacher_name = extra.get("teacher_name") or extra.get("teacher_full_name") or ""
    faculty_name = extra.get("faculty_name") or ""
    department_name = extra.get("department_name") or "音乐系"
    textbook = extra.get("textbook") or ""
    teacher_position = extra.get("teacher_position") or ""
    required_hours = extra.get("required_hours")
    hours_str = str(required_hours) if required_hours is not None else ""

    # 第一页：替换原模板中的特定字符串（即使新值为空也替换，确保清掉占位符）
    original_course_name = "多声部音乐分析与写作2"
    original_class_name = "音乐学2401"
    original_teacher_name = "谷浚宝"
    original_faculty_name = "影视传媒学院"
    original_department_name = "音乐学系"
    original_textbook = "《和声学教程》"
    original_teacher_position = "讲师"
    original_hours = "32"
    # 审核页签字固定为谷浚宝
    original_signature = "程惠萌"

    replacements = {
        original_course_name: course_name or "",
        original_class_name: class_display or "",
        original_teacher_name: teacher_name or "",
        original_faculty_name: faculty_name or "",
        original_department_name: department_name or "音乐系",
        original_textbook: textbook or "",
        original_teacher_position: teacher_position or "",
        original_hours: hours_str,
        original_signature: "谷浚宝",
    }

    for para in document.paragraphs:
        for old, new in replacements.items():
            if not old:
                continue
            if old in para.text:
                para.text = para.text.replace(old, str(new))

    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    for old, new in replacements.items():
                        if not old:
                            continue
                        if old in para.text:
                            para.text = para.text.replace(old, str(new))

    # 第二页：找到包含“周次”表头的表格，重建内容
    calendar_table = None
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
            # 列顺序：周次 / 授课日期 / 节次 / 学时 / 教学内容 / 备注（周次用中文大写）
            if len(cells) >= 6:
                week_num = row_data.get("week_number")
                cells[0].text = _week_to_chinese(week_num) if week_num else str(week_num or "")
                cells[1].text = row_data.get("date_text") or ""
                cells[2].text = row_data.get("period_text") or ""
                hours = row_data.get("hours")
                cells[3].text = str(hours) if hours is not None else ""
                cells[4].text = row_data.get("teaching_content") or ""
                cells[5].text = row_data.get("remark") or ""

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
        rows = _build_calendar_entries(db, header)

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
        _fill_word_document_from_calendar(document, header, rows)

        # 组合导出文件名：教师姓名 + 课程名称 + 班级 / 小组
        extra = header.extra_info or {}
        teacher_name = (
            extra.get("teacher_name") or extra.get("teacher_full_name") or "教师"
        )
        course_name = extra.get("course_name") or "课程"

        class_display = header.class_display_name or (
            extra.get("major_class") or extra.get("class_name") or "班级"
        )

        # 移除文件名非法字符，确保导出文件名正确
        def _safe_filename(s: str) -> str:
            return "".join(c for c in (s or "") if c not in r'\/:*?"<>|')

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
        rows = _build_calendar_entries(db, header)

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

        # 读取表体行（跳过表头），按顺序提取“教学内容”和“备注”
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

        # 对齐长度：按最短长度进行顺序映射
        count = min(len(rows), len(imported_cells))

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

        # 顺序映射写回数据库
        for idx in range(count):
            row_data = rows[idx]
            cell_data = imported_cells[idx]

            schedule_id = row_data.get("schedule_id")
            week_number = int(row_data.get("week_number") or 0)
            is_empty_week = bool(row_data.get("is_empty_week"))

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
                    teaching_content=cell_data.get("teaching_content") or "",
                    remark=cell_data.get("remark") or "",
                )
                db.add(entry)
            else:
                entry.teaching_content = cell_data.get("teaching_content") or ""
                entry.remark = cell_data.get("remark") or ""

        db.commit()

        # 若选择了班级，将导入的教学内容同时保存为年级模板，供同年级同班级类型（普通班/专升本）的班级/小组使用
        grade = _extract_grade_from_class_id(class_id)
        class_type = _extract_class_type_from_class_id(db, class_id)
        if grade and course_id:
            content_pairs: List[tuple] = []
            for idx in range(count):
                row_data = rows[idx]
                if not row_data.get("schedule_id"):
                    continue
                w = int(row_data.get("week_number") or 0)
                if w <= 0:
                    continue
                tc = imported_cells[idx].get("teaching_content") or ""
                content_pairs.append((w, tc))
            content_pairs.sort(key=lambda x: x[0])
            content_items = [tc for _, tc in content_pairs]
            if content_items:
                ids_to_match = [course_id]
                if course:
                    for cid in (str(course.id), course.course_id):
                        if cid and cid not in ids_to_match:
                            ids_to_match.append(cid)
                gtc = (
                    db.query(GradeTeachingContent)
                    .filter(
                        GradeTeachingContent.semester_label == semester_label,
                        GradeTeachingContent.grade == grade,
                        GradeTeachingContent.class_type == class_type,
                        GradeTeachingContent.course_id.in_(ids_to_match),
                    )
                    .first()
                )
                if gtc:
                    gtc.content_items = content_items
                else:
                    gtc = GradeTeachingContent(
                        semester_label=semester_label,
                        course_id=course_id,
                        grade=grade,
                        class_type=class_type,
                        content_items=content_items,
                    )
                    db.add(gtc)
                db.commit()

        # 导入后返回最新数据
        rows = _build_calendar_entries(db, header)
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
                    "extra_info": _ensure_extra_info_defaults(header.extra_info),
                },
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
    """获取某学期某课程某年级某班级类型的教学内容模板。查询参数：semester_label, course_id, grade, class_type"""
    db = next(get_db())
    try:
        semester_label = request.args.get("semester_label")
        course_id = request.args.get("course_id")
        grade_str = request.args.get("grade")
        class_type = request.args.get("class_type") or "general"
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

        gtc = (
            db.query(GradeTeachingContent)
            .filter(
                GradeTeachingContent.semester_label == semester_label,
                GradeTeachingContent.grade == grade,
                GradeTeachingContent.class_type == class_type,
                GradeTeachingContent.course_id.in_(ids_to_match),
            )
            .first()
        )
        if not gtc:
            return jsonify({"content_items": []})
        return jsonify({"content_items": gtc.content_items or []})
    finally:
        db.close()


@api_bp.route("/teaching-calendar/grade-content", methods=["POST"])
def save_grade_teaching_content():
    """保存某学期某课程某年级某班级类型的教学内容模板。请求体：{ semester_label, course_id, grade, class_type?, content_items }"""
    db = next(get_db())
    try:
        data = request.get_json() or {}
        semester_label = data.get("semester_label")
        course_id = data.get("course_id")
        grade = data.get("grade")
        class_type = data.get("class_type") or "general"
        if class_type not in ("general", "upgrade"):
            class_type = "general"
        content_items = data.get("content_items")
        if not semester_label or not course_id or grade is None:
            return jsonify({"error": "semester_label, course_id, grade 为必填字段"}), 400
        try:
            grade = int(grade)
        except (ValueError, TypeError):
            return jsonify({"error": "grade 必须为数字"}), 400
        if not isinstance(content_items, list):
            content_items = []

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
                GradeTeachingContent.course_id.in_(ids_to_match),
            )
            .first()
        )
        if gtc:
            gtc.content_items = content_items
        else:
            gtc = GradeTeachingContent(
                semester_label=semester_label,
                course_id=course_id,
                grade=grade,
                class_type=class_type,
                content_items=content_items,
            )
            db.add(gtc)
        db.commit()
        return jsonify({"content_items": gtc.content_items or []})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400
    finally:
        db.close()

