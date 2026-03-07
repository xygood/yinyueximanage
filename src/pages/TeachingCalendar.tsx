import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import {
  teachingCalendarService,
  teacherService,
  courseService,
  studentService,
  scheduleService,
} from '../services';
import type {
  TeachingCalendarDto,
  TeachingCalendarEntryDto,
} from '../services/teachingCalendarService';

interface SemesterConfig {
  id: string;
  academic_year: string;
  semester_label: string;
  start_date?: string | null;
  total_weeks?: number;
}

interface TeacherOption {
  id: string;
  name: string;
}

interface CourseOption {
  id: string; // 这里的 id 使用课程编号 course_id 或数据库 id
  course_id?: string;
  course_name: string;
  semester_label?: string;
  primary_instrument?: string;
  course_type?: string;
}

interface GroupOption {
  id: string; // group_id
  label: string; // 学生姓名列表
}

const USE_DATABASE = import.meta.env.VITE_USE_DATABASE === 'true';

/** 班级显示格式：统一为「音乐学XXXX」或保留「专升本」前缀 */
function formatClassDisplay(cls: string): string {
  if (!cls || typeof cls !== 'string') return cls || '';
  const t = cls.trim();
  if (t.startsWith('音乐学') || t.startsWith('专升本')) return t;
  if (/^\d{4}$/.test(t)) return `音乐学${t}`;
  return t;
}

const TeachingCalendarPage: React.FC = () => {
  const { user, teacher } = useAuth();

  const [semesterConfigs, setSemesterConfigs] = useState<SemesterConfig[]>([]);
  const [teacherOptions, setTeacherOptions] = useState<TeacherOption[]>([]);
  const [allTeachers, setAllTeachers] = useState<any[]>([]);
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [allCourses, setAllCourses] = useState<any[]>([]);
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [teacherSchedules, setTeacherSchedules] = useState<any[] | null>(null);
  const [classOptions, setClassOptions] = useState<string[]>([]);
  const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);

  const [selectedSemesterLabel, setSelectedSemesterLabel] = useState<string>('');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [classId, setClassId] = useState<string>('');
  const [groupId, setGroupId] = useState<string>('');

  const [calendar, setCalendar] = useState<TeachingCalendarDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'info' | 'calendar' | 'audit'>('info');

  const isAdmin =
    user?.faculty_id === 'ADMIN' ||
    user?.is_admin === true ||
    user?.role === 'admin' ||
    user?.teacher_id === '110' ||
    user?.email === 'admin@music.edu.cn';

  const effectiveTeacherId = useMemo(() => {
    // Teacher 模型的 to_dict 中，将 id 映射为 teacher_id
    if (selectedTeacherId) return selectedTeacherId;
    if (teacher?.id) return teacher.id;
    if (user?.teacher_id) return user.teacher_id;
    return '';
  }, [selectedTeacherId, teacher, user]);

  useEffect(() => {
    if (!USE_DATABASE) return;

    const init = async () => {
      try {
        const [semesters, teachers, courses, students] = await Promise.all([
          teachingCalendarService.getSemesterConfigs(),
          teacherService.getAll(),
          courseService.getAll(),
          studentService.getAll(),
        ]);

        setSemesterConfigs(semesters || []);

        setAllTeachers(teachers || []);
        const tOptions =
          (teachers || []).map((t: any) => ({
            id: t.id,
            name: t.name || t.full_name || t.id,
          })) ?? [];
        setTeacherOptions(tOptions);

        setAllCourses(courses || []);
        setAllStudents(students || []);

        // 默认选择最近的学期
        if (semesters && semesters.length > 0 && !selectedSemesterLabel) {
          const sorted = [...semesters].sort((a, b) =>
            (a.semester_label || '').localeCompare(b.semester_label || ''),
          );
          setSelectedSemesterLabel(sorted[sorted.length - 1]?.semester_label || '');
        }

        // 默认教师
        if (!selectedTeacherId && effectiveTeacherId) {
          setSelectedTeacherId(effectiveTeacherId);
        }
      } catch (error) {
        console.error('初始化教学日历页面失败:', error);
      }
    };

    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 根据教师与学期过滤课程列表
  useEffect(() => {
    if (!USE_DATABASE) return;
    if (!allCourses.length) {
      setCourseOptions([]);
      return;
    }

    const teacherKey = effectiveTeacherId || selectedTeacherId;

    // 查找当前选择的教师对象（兼容 id/teacher_id）
    const selectedTeacher =
      allTeachers.find(
        (t: any) => t.id === teacherKey || t.teacher_id === teacherKey,
      ) || null;

    const teacherWorkId: string | undefined =
      selectedTeacher?.teacher_id || teacherKey || teacher?.teacher_id || user?.teacher_id;
    const teacherName: string | undefined =
      selectedTeacher?.name ||
      selectedTeacher?.full_name ||
      teacher?.name ||
      (user as any)?.full_name;

    const map = new Map<string, CourseOption>();

    // 1. 小组课：来自专业小课页面的排课结果（scheduled_classes 中该教师、本学期的记录）
    if (teacherSchedules && teacherSchedules.length > 0) {
      teacherSchedules.forEach((s: any) => {
        if (selectedSemesterLabel && s.semester_label !== selectedSemesterLabel) return;
        // 二次校验：仅保留排课记录中教师与当前选中教师一致的
        const scheduleTeacherMatch =
          (teacherWorkId && s.teacher_id === teacherWorkId) ||
          (teacherName && s.teacher_name === teacherName) ||
          (teacherKey && (s.teacher_id === teacherKey || s.teacher_id === effectiveTeacherId));
        if (!scheduleTeacherMatch && (teacherWorkId || teacherName)) return;

        const course =
          allCourses.find((c: any) => c.id === s.course_id) ||
          allCourses.find((c: any) => c.course_id === s.course_id);

        if (!course) return;

        const key: string = course.course_id || course.id;
        if (!key || map.has(key)) return;

        map.set(key, {
          id: key,
          course_id: course.course_id,
          course_name: course.course_name,
          semester_label: course.semester_label,
          primary_instrument: course.primary_instrument,
          course_type: course.course_type,
        });
      });
    }

    // 2. 专业大课：仅补充课程表中「该教师」且授课类型为专业大课的课程（与专业大课页面排课结果一致）
    const hasTeacher = !!(teacherWorkId || teacherName);
    if (hasTeacher) {
      const teacherMajorCourses = allCourses.filter((c: any) => {
        const teachingType = (c as any).teaching_type;
        if (teachingType !== '专业大课') return false;
        const courseTeacherId = c.teacher_id;
        const courseTeacherName = c.teacher_name;
        const matchById = teacherWorkId && courseTeacherId === teacherWorkId;
        const matchByName =
          teacherName &&
          courseTeacherName &&
          (courseTeacherName === teacherName ||
            (typeof courseTeacherName === 'string' &&
              courseTeacherName.split(/[,，、]/).some((t: string) => t.trim() === teacherName)));
        return matchById || matchByName || false;
      });

      const filteredBySemester = selectedSemesterLabel
        ? teacherMajorCourses.filter(
            (c: any) => !c.semester_label || c.semester_label === selectedSemesterLabel,
          )
        : teacherMajorCourses;

      filteredBySemester.forEach((c: any) => {
        const key: string = c.course_id || c.id;
        if (!key || map.has(key)) return;
        map.set(key, {
          id: key,
          course_id: c.course_id,
          course_name: c.course_name,
          semester_label: c.semester_label,
          primary_instrument: c.primary_instrument,
          course_type: c.course_type,
        });
      });
    }

    const options = Array.from(map.values());
    setCourseOptions(options);

    // 当前选中的课程不在新的列表中时，清空选中课程、班级和小组
    if (selectedCourseId && !options.find((o) => o.id === selectedCourseId)) {
      setSelectedCourseId('');
      setClassId('');
      setGroupId('');
      setClassOptions([]);
      setGroupOptions([]);
    }
  }, [
    allCourses,
    allTeachers,
    teacherSchedules,
    effectiveTeacherId,
    selectedTeacherId,
    selectedSemesterLabel,
    selectedCourseId,
    teacher,
    user,
  ]);

  // 根据选中的课程计算班级列表（小组课来自排课+学生major_class，专业大课来自排课class_id或课程major_class）
  useEffect(() => {
    if (!USE_DATABASE) return;
    if (!selectedCourseId) {
      setClassOptions([]);
      setClassId('');
      return;
    }

    const teacherKey = effectiveTeacherId || selectedTeacherId;
    const selectedTeacher =
      allTeachers.find(
        (t: any) => t.id === teacherKey || t.teacher_id === teacherKey,
      ) || null;
    const teacherWorkId =
      selectedTeacher?.teacher_id || teacherKey || teacher?.teacher_id || user?.teacher_id;
    const teacherName =
      selectedTeacher?.name ||
      selectedTeacher?.full_name ||
      teacher?.name ||
      (user as any)?.full_name;

    const studentMap = new Map<string, any>();
    allStudents.forEach((s: any) => {
      if (s.student_id) studentMap.set(s.student_id, s);
    });

    const classSet = new Set<string>();

    const courseObj = allCourses.find((c: any) => (c.course_id || c.id) === selectedCourseId);
    const validCourseKeys = new Set<string>();
    if (courseObj) {
      if (courseObj.id) validCourseKeys.add(courseObj.id);
      if (courseObj.course_id) validCourseKeys.add(courseObj.course_id);
    } else {
      validCourseKeys.add(selectedCourseId);
    }

    const isMajorClass = courseObj && (courseObj as any).teaching_type === '专业大课';

    // 1. 从排课推导：小组课用学生major_class，专业大课用schedule.class_id
    if (teacherSchedules && teacherSchedules.length > 0) {
      teacherSchedules.forEach((s: any) => {
        if (!validCourseKeys.has(s.course_id)) return;
        if (selectedSemesterLabel && s.semester_label !== selectedSemesterLabel) return;
        const scheduleTeacherMatch =
          (teacherWorkId && s.teacher_id === teacherWorkId) ||
          (teacherName && s.teacher_name === teacherName) ||
          (teacherKey && s.teacher_id === teacherKey);
        if (!scheduleTeacherMatch && (teacherWorkId || teacherName)) return;

        if (isMajorClass && s.class_id) {
          classSet.add(s.class_id);
        } else {
          const stu = studentMap.get(s.student_id);
          if (stu && stu.major_class) classSet.add(stu.major_class);
        }
      });
    }

    // 2. 若仍无班级，从课程表 major_class 补充（专业大课课程通常有 major_class）
    if (classSet.size === 0) {
      const relatedCourses = allCourses.filter((c: any) => {
        const key: string = c.course_id || c.id;
        if (key !== selectedCourseId) return false;
        if (selectedSemesterLabel && c.semester_label && c.semester_label !== selectedSemesterLabel)
          return false;
        const courseTeacherMatch =
          (teacherWorkId && c.teacher_id === teacherWorkId) ||
          (teacherName &&
            c.teacher_name &&
            (c.teacher_name === teacherName ||
              (typeof c.teacher_name === 'string' &&
                c.teacher_name.split(/[,，、]/).some((t: string) => t.trim() === teacherName))));
        return !(teacherWorkId || teacherName) || courseTeacherMatch;
      });

      relatedCourses.forEach((c: any) => {
        if (c.major_class) classSet.add(c.major_class);
      });
    }

    const classes = Array.from(classSet);
    setClassOptions(classes);

    if (classes.length > 0 && !classId) {
      setClassId(classes[0]);
    } else if (classId && !classes.includes(classId)) {
      setClassId('');
    }
  }, [
    allCourses,
    allStudents,
    allTeachers,
    teacherSchedules,
    selectedCourseId,
    effectiveTeacherId,
    selectedTeacherId,
    selectedSemesterLabel,
    classId,
    teacher,
    user,
  ]);

  // 加载当前教师在指定学期的排课（用于小组学生名单）
  useEffect(() => {
    if (!USE_DATABASE) return;
    const teacherKey = effectiveTeacherId || selectedTeacherId;
    if (!teacherKey || !selectedSemesterLabel) {
      setTeacherSchedules(null);
      return;
    }

    const selectedTeacher =
      allTeachers.find(
        (t: any) => t.id === teacherKey || t.teacher_id === teacherKey,
      ) || null;
    const scheduleTeacherId =
      selectedTeacher?.teacher_id || selectedTeacher?.id || teacherKey;

    const loadSchedules = async () => {
      try {
        const all = await scheduleService.getAll({ teacher_id: scheduleTeacherId });
        const filtered = (all || []).filter(
          (s: any) => s.semester_label === selectedSemesterLabel,
        );
        setTeacherSchedules(filtered);
      } catch (error) {
        console.error('加载教师排课失败（教学日历小组信息）:', error);
        setTeacherSchedules(null);
      }
    };

    void loadSchedules();
  }, [effectiveTeacherId, selectedTeacherId, selectedSemesterLabel, allTeachers]);

  // 根据课程 + 班级，生成小组选项（每个小组显示学生姓名列表）
  useEffect(() => {
    if (!USE_DATABASE) return;
    if (!teacherSchedules || !selectedCourseId || !classId) {
      setGroupOptions([]);
      setGroupId('');
      return;
    }

    // 当前课程可能使用课程编号或内部 id 作为 ScheduledClass.course_id
    const courseObj = allCourses.find((c: any) => (c.course_id || c.id) === selectedCourseId);
    const validCourseKeys = new Set<string>();
    if (courseObj) {
      if (courseObj.id) validCourseKeys.add(courseObj.id);
      if (courseObj.course_id) validCourseKeys.add(courseObj.course_id);
    } else {
      validCourseKeys.add(selectedCourseId);
    }

    // 学生字典，用于获取班级与姓名
    const studentMap = new Map<string, any>();
    allStudents.forEach((s: any) => {
      if (s.student_id) {
        studentMap.set(s.student_id, s);
      }
    });

    // 为安全起见，这里再次按教师过滤一次，防止 teacherSchedules 中混入了其它教师的数据
    const teacherKey = effectiveTeacherId || selectedTeacherId;
    const selectedTeacher =
      allTeachers.find(
        (t: any) => t.id === teacherKey || t.teacher_id === teacherKey,
      ) || null;
    const teacherWorkId: string | undefined =
      selectedTeacher?.teacher_id || teacherKey || teacher?.teacher_id || user?.teacher_id;
    const teacherName: string | undefined =
      selectedTeacher?.name ||
      selectedTeacher?.full_name ||
      teacher?.name ||
      (user as any)?.full_name;

    const relatedSchedules = teacherSchedules.filter((s: any) => {
      if (!s.group_id) return false; // 只有小组课才需要
      if (!validCourseKeys.has(s.course_id)) return false;

      // 只保留当前教师的记录
      if (teacherWorkId || teacherName) {
        const isTeacherMatch =
          (teacherWorkId && s.teacher_id === teacherWorkId) ||
          (teacherName && s.teacher_name === teacherName);
        if (!isTeacherMatch) return false;
      }

      const student = studentMap.get(s.student_id);
      if (!student || !student.major_class) return false;
      return student.major_class === classId;
    });

    if (relatedSchedules.length === 0) {
      setGroupOptions([]);
      setGroupId('');
      return;
    }

    const groupsMap = new Map<string, Set<string>>();
    relatedSchedules.forEach((s: any) => {
      const gid: string = s.group_id;
      if (!gid) return;
      const stu = studentMap.get(s.student_id);
      if (!stu || !stu.name) return;
      if (!groupsMap.has(gid)) {
        groupsMap.set(gid, new Set<string>());
      }
      groupsMap.get(gid)!.add(stu.name);
    });

    const options: GroupOption[] = Array.from(groupsMap.entries()).map(([gid, names]) => ({
      id: gid,
      label: Array.from(names).join('、'),
    }));

    setGroupOptions(options);

    if (options.length > 0 && !groupId) {
      setGroupId(options[0].id);
    } else if (groupId && !options.some((g) => g.id === groupId)) {
      setGroupId('');
    }
  }, [
    USE_DATABASE,
    teacherSchedules,
    selectedCourseId,
    classId,
    allCourses,
    allStudents,
    groupId,
    effectiveTeacherId,
    selectedTeacherId,
    allTeachers,
    teacher,
    user,
  ]);

  // 选中班级、小组后自动加载教学日历（无需手动点击加载按钮）
  useEffect(() => {
    if (!USE_DATABASE) return;
    if (!selectedSemesterLabel || !effectiveTeacherId || !selectedCourseId) return;

    // 有班级选项时，必须选中班级
    if (classOptions.length > 0 && !classId) return;
    // 有小组选项时，必须选中小组
    if (groupOptions.length > 0 && !groupId) return;

    const load = async () => {
      setLoading(true);
      try {
        const course = courseOptions.find((c) => c.id === selectedCourseId);
        const courseKey = course?.course_id || course?.id || selectedCourseId;
        const data = await teachingCalendarService.getCalendar({
          semester_label: selectedSemesterLabel,
          teacher_id: effectiveTeacherId,
          course_id: courseKey,
          class_id: classId || undefined,
          group_id: groupId || undefined,
        });
        setCalendar(data);
        setActiveTab('info');
      } catch (error) {
        console.error('自动加载教学日历失败:', error);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [
    selectedSemesterLabel,
    effectiveTeacherId,
    selectedCourseId,
    classId,
    groupId,
    classOptions.length,
    groupOptions.length,
    courseOptions,
  ]);

  // 根据当前班级和选中的小组，实时更新信息页中的“授课专业班级 / 小组学生”展示文本
  useEffect(() => {
    if (!calendar) return;
    if (!classId) {
      if (calendar.header.class_display_name !== '') {
        setCalendar({
          ...calendar,
          header: {
            ...calendar.header,
            class_display_name: '',
          },
        });
      }
      return;
    }

    const currentGroup = groupOptions.find((g) => g.id === groupId);
    const expectedDisplay = currentGroup
      ? `${formatClassDisplay(classId)}\n${currentGroup.label}`
      : formatClassDisplay(classId);

    if (calendar.header.class_display_name !== expectedDisplay) {
      setCalendar({
        ...calendar,
        header: {
          ...calendar.header,
          class_display_name: expectedDisplay,
        },
      });
    }
  }, [calendar, classId, groupId, groupOptions]);

  const filteredCourses = useMemo(() => courseOptions, [courseOptions]);

  const handleLoadCalendar = async () => {
    if (!USE_DATABASE) return;
    if (!selectedSemesterLabel || !effectiveTeacherId || !selectedCourseId) {
      alert('请先选择学期、教师和课程');
      return;
    }

    setLoading(true);
    try {
      const course = courseOptions.find((c) => c.id === selectedCourseId);
      const courseKey = course?.course_id || course?.id || selectedCourseId;

      const data = await teachingCalendarService.getCalendar({
        semester_label: selectedSemesterLabel,
        teacher_id: effectiveTeacherId,
        course_id: courseKey,
        class_id: classId || undefined,
        group_id: groupId || undefined,
      });
      setCalendar(data);
      setActiveTab('info');
    } catch (error) {
      console.error('加载教学日历失败:', error);
      alert('加载教学日历失败，请检查控制台或稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCalendar = async () => {
    if (!USE_DATABASE || !calendar) return;
    if (!selectedSemesterLabel || !effectiveTeacherId || !selectedCourseId) {
      alert('请先选择学期、教师和课程');
      return;
    }

    setSaving(true);
    try {
      const course = courseOptions.find((c) => c.id === selectedCourseId);
      const courseKey = course?.course_id || course?.id || selectedCourseId;

      const payload = await teachingCalendarService.saveCalendar({
        semester_label: selectedSemesterLabel,
        teacher_id: effectiveTeacherId,
        course_id: courseKey,
        class_id: classId || undefined,
        group_id: groupId || undefined,
        header: {
          academic_year: calendar.header.academic_year,
          class_display_name: calendar.header.class_display_name,
          extra_info: {
            ...calendar.header.extra_info,
            department_name: (calendar.header.extra_info?.department_name as string) || '音乐系',
          },
        },
        entries: calendar.entries,
      });
      setCalendar(payload);
      alert('教学日历已保存');
    } catch (error) {
      console.error('保存教学日历失败:', error);
      alert('保存教学日历失败，请检查控制台或稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!USE_DATABASE || !calendar) return;
    if (!selectedSemesterLabel || !effectiveTeacherId || !selectedCourseId) {
      alert('请先选择学期、教师和课程');
      return;
    }

    try {
      const course = courseOptions.find((c) => c.id === selectedCourseId);
      const courseKey = course?.course_id || course?.id || selectedCourseId;

      const { blob, filename } = await teachingCalendarService.exportCalendar({
        semester_label: selectedSemesterLabel,
        teacher_id: effectiveTeacherId,
        course_id: courseKey,
        class_id: classId || undefined,
        group_id: groupId || undefined,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || '教学日历.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('导出教学日历失败:', error);
      alert('导出教学日历失败，请检查控制台或稍后重试');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!USE_DATABASE) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedSemesterLabel || !effectiveTeacherId || !selectedCourseId) {
      alert('请先选择学期、教师和课程');
      return;
    }

    setImporting(true);
    try {
      const course = courseOptions.find((c) => c.id === selectedCourseId);
      const courseKey = course?.course_id || course?.id || selectedCourseId;

      const data = await teachingCalendarService.importCalendar(
        {
          semester_label: selectedSemesterLabel,
          teacher_id: effectiveTeacherId,
          course_id: courseKey,
          class_id: classId || undefined,
          group_id: groupId || undefined,
        },
        file,
      );
      setCalendar(data);
      alert(
        classId
          ? '从 Word 模板导入成功。教学内容已同步为年级模板，同年级其他班级/小组加载时将自动使用。'
          : '从 Word 模板导入成功',
      );
    } catch (error) {
      console.error('导入教学日历失败:', error);
      alert('导入教学日历失败，请检查控制台或稍后重试');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const handleEntryChange = (index: number, field: keyof TeachingCalendarEntryDto, value: string) => {
    if (!calendar) return;
    const entries = [...calendar.entries];
    const entry = { ...entries[index], [field]: value };
    entries[index] = entry;
    setCalendar({ ...calendar, entries });
  };

  if (!USE_DATABASE) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-semibold mb-4">教学日历</h2>
        <p className="text-gray-600">
          当前运行在本地存储模式，教学日历功能依赖数据库，请在启用数据库模式后使用。
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-800">教学日历</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleLoadCalendar}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
            disabled={loading}
            title="选中班级、小组后会自动加载，此处可手动刷新"
          >
            {loading ? '正在加载...' : '刷新'}
          </button>
          <button
            type="button"
            onClick={handleSaveCalendar}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700 disabled:opacity-50"
            disabled={saving || !calendar}
          >
            {saving ? '正在保存...' : '保存教学日历'}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium shadow-sm hover:bg-green-700 disabled:opacity-50"
            disabled={!calendar}
          >
            导出 Word 教学日历
          </button>
          <label className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-100 text-gray-800 text-sm font-medium shadow-sm hover:bg-gray-200 cursor-pointer">
            {importing ? '正在导入...' : '从 Word 模板导入'}
            <input
              type="file"
              accept=".docx"
              className="hidden"
              onChange={handleImport}
              disabled={importing}
            />
          </label>
        </div>
      </div>

      {/* 筛选区 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">学期</label>
            <select
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm"
              value={selectedSemesterLabel}
              onChange={(e) => setSelectedSemesterLabel(e.target.value)}
            >
              <option value="">请选择学期</option>
              {semesterConfigs.map((c) => {
                const label = c.semester_label || '';
                const parts = label.split('-');
                const semesterNumber = parts.length > 0 ? parts[parts.length - 1] : '';
                return (
                  <option key={c.id} value={c.semester_label}>
                    {c.academic_year} 学年第 {semesterNumber} 学期
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">教师</label>
            <select
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm"
              value={selectedTeacherId}
              onChange={(e) => setSelectedTeacherId(e.target.value)}
              disabled={!isAdmin && !!effectiveTeacherId}
            >
              <option value="">请选择教师</option>
              {teacherOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.id}）
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">课程</label>
            <select
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
            >
              <option value="">请选择课程</option>
              {filteredCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.course_name}
                  {c.primary_instrument ? `（${c.primary_instrument}）` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">班级（可选）</label>
            <select
              className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">请选择班级</option>
              {classOptions.map((cls) => (
                <option key={cls} value={cls}>
                  {formatClassDisplay(cls)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">小组（可选）</label>
            {groupOptions.length > 0 ? (
              <select
                className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="非小组课可留空；小组课自动列出学生姓名"
                className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm"
              />
            )}
          </div>
        </div>

      </div>

      {/* 内容区：三页仿 Word 视图 */}
      {calendar && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="border-b border-gray-200 flex bg-gray-50 px-4">
            <button
              type="button"
              className={`px-4 py-3 text-sm font-semibold ${
                activeTab === 'info'
                  ? 'border-b-2 border-purple-600 text-purple-700 bg-white'
                  : 'text-gray-600 hover:text-purple-700'
              }`}
              onClick={() => setActiveTab('info')}
            >
              第一页：信息页
            </button>
            <button
              type="button"
              className={`px-4 py-3 text-sm font-semibold ${
                activeTab === 'calendar'
                  ? 'border-b-2 border-purple-600 text-purple-700 bg-white'
                  : 'text-gray-600 hover:text-purple-700'
              }`}
              onClick={() => setActiveTab('calendar')}
            >
              第二页：教学日历
            </button>
            <button
              type="button"
              className={`px-4 py-3 text-sm font-semibold ${
                activeTab === 'audit'
                  ? 'border-b-2 border-purple-600 text-purple-700 bg-white'
                  : 'text-gray-600 hover:text-purple-700'
              }`}
              onClick={() => setActiveTab('audit')}
            >
              第三页：审核页
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'info' && (
              <div className="space-y-4">
                <div className="text-center space-y-2 mb-6">
                  <div className="text-lg font-semibold">武昌理工学院</div>
                  <div className="text-2xl font-bold tracking-widest">教学日历</div>
                  <div className="text-sm text-gray-600">
                    {(calendar.header.extra_info?.semester_text as string) ||
                      (calendar.header.academic_year &&
                      (calendar.header.extra_info?.semester as number | undefined)
                        ? `${calendar.header.academic_year} 学年第 ${
                            calendar.header.extra_info?.semester as number
                          } 学期`
                        : calendar.header.academic_year || '')}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="block text-gray-700 mb-1">课程名称</label>
                    <input
                      type="text"
                      value={(calendar.header.extra_info?.course_name as string) || ''}
                      onChange={(e) =>
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              course_name: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">学院</label>
                    <input
                      type="text"
                      value={(calendar.header.extra_info?.faculty_name as string) || ''}
                      onChange={(e) =>
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              faculty_name: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">系（部）</label>
                    <input
                      type="text"
                      value={(calendar.header.extra_info?.department_name as string) || '音乐系'}
                      onChange={(e) =>
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              department_name: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">授课专业班级 / 小组学生</label>
                    <textarea
                      value={calendar.header.class_display_name || ''}
                      onChange={(e) =>
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            class_display_name: e.target.value,
                          },
                        })
                      }
                      rows={3}
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      小组课可在第二行写入“学⽣姓名列表”，字号在 Word 模板中可略微缩小以容纳更多姓名。
                    </p>
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">主讲教师</label>
                    <input
                      type="text"
                      value={(calendar.header.extra_info?.teacher_name as string) || ''}
                      onChange={(e) =>
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              teacher_name: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">职称</label>
                    <input
                      type="text"
                      value={(calendar.header.extra_info?.teacher_position as string) || ''}
                      onChange={(e) =>
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              teacher_position: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">选用教材</label>
                    <input
                      type="text"
                      value={(calendar.header.extra_info?.textbook as string) || ''}
                      onChange={(e) =>
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              textbook: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'calendar' && (
              <div className="overflow-x-auto">
                <table className="min-w-full border border-gray-300 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border border-gray-300 px-2 py-1 text-center w-16">周次</th>
                      <th className="border border-gray-300 px-2 py-1 text-center w-32">授课日期</th>
                      <th className="border border-gray-300 px-2 py-1 text-center w-32">节次</th>
                      <th className="border border-gray-300 px-2 py-1 text-center w-20">学时</th>
                      <th className="border border-gray-300 px-2 py-1 text-center w-80">教学内容</th>
                      <th className="border border-gray-300 px-2 py-1 text-center w-80">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendar.entries.map((entry, idx) => (
                      <tr key={`${entry.week_number}-${entry.schedule_id || 'empty'}-${idx}`}>
                        <td className="border border-gray-300 px-2 py-1 text-center align-top">
                          {entry.week_number}
                        </td>
                        <td className="border border-gray-300 px-2 py-1 text-center align-top">
                          {entry.date_text || ''}
                        </td>
                        <td className="border border-gray-300 px-2 py-1 text-center align-top">
                          {entry.period_text || ''}
                        </td>
                        <td className="border border-gray-300 px-2 py-1 text-center align-top">
                          {entry.hours ?? ''}
                        </td>
                        <td className="border border-gray-300 px-2 py-1 align-top">
                          <textarea
                            value={entry.teaching_content || ''}
                            onChange={(e) => handleEntryChange(idx, 'teaching_content', e.target.value)}
                            rows={2}
                            className="w-full border-none focus:ring-0 focus:outline-none resize-none"
                          />
                        </td>
                        <td className="border border-gray-300 px-2 py-1 align-top">
                          <textarea
                            value={entry.remark || ''}
                            onChange={(e) => handleEntryChange(idx, 'remark', e.target.value)}
                            rows={2}
                            className="w-full border-none focus:ring-0 focus:outline-none resize-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="space-y-4 text-sm text-gray-700">
                <p>第三页为审核签字页，导出 Word 后可按照学校提供的模板进行打印和签字。</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>教师签字</li>
                  <li>教研室主任签字</li>
                  <li>系主任签字</li>
                  <li>教务处审核</li>
                  <li>
                    日期：春季学期默认使用 2 月，秋季学期默认使用 8 月，实际签字时可在 Word
                    中手工调整。
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TeachingCalendarPage;

