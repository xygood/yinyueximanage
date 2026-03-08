import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  studentIds?: string[]; // 该小组学号列表，用于按学号查排课
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
  const groupIdRef = useRef<string>(groupId);
  groupIdRef.current = groupId;

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
    } else if (options.length > 0 && !selectedCourseId) {
      // 选择教师后，课程列表自动显示一门课程（默认选第一门）
      setSelectedCourseId(options[0].id);
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
    // 班级下拉按顺序排列：优先按班号数字排序（如 2401、2402、2403），再按字符串
    classes.sort((a, b) => {
      const numA = (a.match(/\d{4}/) || [])[0];
      const numB = (b.match(/\d{4}/) || [])[0];
      if (numA && numB) {
        const n = parseInt(numA, 10) - parseInt(numB, 10);
        if (n !== 0) return n;
      }
      return String(a).localeCompare(String(b), 'zh-CN');
    });
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

    // 多班混合小组：先按教师+课程+学期取所有带 group_id 的排课，不按班级过滤
    const allGroupSchedules = teacherSchedules.filter((s: any) => {
      if (!s.group_id) return false;
      if (!validCourseKeys.has(s.course_id)) return false;
      if (teacherWorkId || teacherName) {
        const isTeacherMatch =
          (teacherWorkId && s.teacher_id === teacherWorkId) ||
          (teacherName && s.teacher_name === teacherName);
        if (!isTeacherMatch) return false;
      }
      return true;
    });

    // 每个小组按 group_id 聚合成员（同一 group_id 可能有多条排课行）
    const groupsMap = new Map<string, { names: Set<string>; studentIds: Set<string> }>();
    allGroupSchedules.forEach((s: any) => {
      const gid: string = s.group_id;
      if (!gid) return;
      const stu = studentMap.get(s.student_id);
      if (!groupsMap.has(gid)) {
        groupsMap.set(gid, { names: new Set(), studentIds: new Set() });
      }
      const entry = groupsMap.get(gid)!;
      if (stu?.name) entry.names.add(stu.name);
      if (s.student_id) entry.studentIds.add(s.student_id);
    });

    // 仅当选中班级属于某小组时，该小组才出现在下拉中（但小组内显示全部成员）
    const groupIdsWithSelectedClass = new Set<string>();
    allGroupSchedules.forEach((s: any) => {
      const stu = studentMap.get(s.student_id);
      if (stu && stu.major_class === classId) {
        groupIdsWithSelectedClass.add(s.group_id);
      }
    });

    // 按「学号集合」去重：同一批学生可能对应多个 group_id（历史数据或导入导致），只保留一项，姓名按拼音排序以便展示一致
    const seenStudentSet = new Set<string>();
    const options: GroupOption[] = [];
    for (const [gid, { names, studentIds }] of Array.from(groupsMap.entries())) {
      if (!groupIdsWithSelectedClass.has(gid)) continue;
      const idsArray = Array.from(studentIds);
      const canonicalKey = idsArray.slice().sort().join(',');
      if (seenStudentSet.has(canonicalKey)) continue;
      seenStudentSet.add(canonicalKey);
      const namesSorted = Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      options.push({
        id: gid,
        label: namesSorted.join('、'),
        studentIds: idsArray,
      });
    }

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

  // 有小组选项时，未选小组则清空日历，避免显示其他班级/整班合并数据；选小组后再加载
  useEffect(() => {
    if (groupOptions.length > 0 && !groupId) {
      setCalendar(null);
    }
  }, [groupOptions.length, groupId]);

  // 选中班级、小组后自动加载教学日历（小组课必须在选择小组后才加载，默认第一个小组）
  useEffect(() => {
    if (!USE_DATABASE) return;
    if (!selectedSemesterLabel || !effectiveTeacherId || !selectedCourseId) return;

    // 有班级选项时，必须选中班级
    if (classOptions.length > 0 && !classId) return;
    // 有小组选项时，必须选中小组
    if (groupOptions.length > 0 && !groupId) return;

    // 小组课：若排课里已有 group_id（即当前是小组课），必须等 groupId 选中后再请求，避免先请求整班数据再被覆盖导致默认小组显示整年级排课
    const courseKeys = (() => {
      const c = courseOptions.find((co: any) => (co.course_id || co.id) === selectedCourseId);
      const set = new Set<string>();
      if (c) {
        if (c.id) set.add(c.id);
        if (c.course_id) set.add(c.course_id);
      } else set.add(selectedCourseId);
      return set;
    })();
    const hasGroupSchedules =
      classId &&
      teacherSchedules &&
      teacherSchedules.some((s: any) => s.group_id && courseKeys.has(s.course_id));
    if (hasGroupSchedules && !groupId) return;

    const requestedGroupId = groupId;
    const load = async () => {
      setLoading(true);
      try {
        const course = courseOptions.find((c) => c.id === selectedCourseId);
        const courseKey = course?.course_id || course?.id || selectedCourseId;
        const selectedGroup = groupOptions.find((g) => g.id === requestedGroupId);
        const data = await teachingCalendarService.getCalendar({
          semester_label: selectedSemesterLabel,
          teacher_id: effectiveTeacherId,
          course_id: courseKey,
          class_id: classId || undefined,
          group_id: requestedGroupId || undefined,
          group_student_ids: selectedGroup?.studentIds?.length
            ? selectedGroup.studentIds.join(',')
            : undefined,
        });
        // 若请求时未带小组、返回时用户已选了小组，不覆盖为整班数据，避免默认小组显示整年级排课
        setCalendar((prev) => {
          if (requestedGroupId === '' && groupIdRef.current !== '') return prev;
          return data;
        });
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
    groupOptions,
    courseOptions,
    teacherSchedules,
  ]);

  // 根据当前班级和选中的小组，实时更新信息页中的“授课专业班级 / 小组学生”展示文本
  // 小组课时：以后端返回的 class_display_name 为准（已含该组全部班级+学生名单），不随「班级」下拉覆盖
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
    // 小组课：不按上方班级下拉覆盖，后端已按排课结果返回完整班级列表
    if (groupId) return;

    const expectedDisplay = formatClassDisplay(classId);

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

      // 每行一个 schedule_id（每周一行），直接提交；若后端返回 schedule_ids 数组则展开为多条
      const entriesToSave = (calendar.entries || []).flatMap((entry: any) => {
        const scheduleIds = entry.schedule_ids as string[] | undefined;
        if (scheduleIds && scheduleIds.length > 1) {
          return scheduleIds.map((sid: string) => ({
            schedule_id: sid,
            week_number: entry.week_number,
            is_empty_week: false,
            teaching_content: entry.teaching_content ?? '',
            remark: entry.remark ?? '',
          }));
        }
        return [entry];
      });

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
            required_hours: calendar.header.extra_info?.required_hours,
            theory_hours: calendar.header.extra_info?.theory_hours,
            practice_hours: calendar.header.extra_info?.practice_hours,
          },
        },
        entries: entriesToSave,
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

  const handleClearEntries = async () => {
    if (!USE_DATABASE || !calendar) return;
    if (!selectedSemesterLabel || !effectiveTeacherId || !selectedCourseId) {
      alert('请先选择学期、教师和课程');
      return;
    }
    if (!window.confirm('确定要清除当前教学日历的导入数据吗？将同时清除本教师本课程年级模板，该教师下所有班级/小组都会清空，清除后可重新导入 Word。空周的禁排原因会保留。')) return;

    setLoading(true);
    try {
      const course = courseOptions.find((c) => c.id === selectedCourseId);
      const courseKey = course?.course_id || course?.id || selectedCourseId;
      const data = await teachingCalendarService.clearEntries({
        semester_label: selectedSemesterLabel,
        teacher_id: effectiveTeacherId,
        course_id: courseKey,
        class_id: classId || undefined,
        group_id: groupId || undefined,
      });
      setCalendar(data);
      alert('已清除导入数据及年级模板，该教师本课程下所有班级/小组已清空，可重新从 Word 模板导入。');
    } catch (error) {
      console.error('清除教学日历数据失败:', error);
      alert('清除失败，请检查控制台或稍后重试');
    } finally {
      setLoading(false);
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
          <button
            type="button"
            onClick={handleClearEntries}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 disabled:opacity-50"
            disabled={loading || !calendar}
            title="清除当前日历的导入内容、备注及本教师本课程年级模板，该教师下所有班级/小组一并清空；空周禁排原因会保留"
          >
            {loading ? '正在加载...' : '清除导入数据'}
          </button>
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

          <div className="md:col-span-2 min-w-0">
            <label className="block text-sm font-medium text-gray-700 mb-1">小组（可选）</label>
            {groupOptions.length > 0 ? (
              <div className="inline-block w-full max-w-xl">
                <select
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm pr-8"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  title={groupOptions.find((g) => g.id === groupId)?.label}
                >
                  {groupOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <input
                type="text"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="非小组课可留空；小组课自动列出学生姓名"
                className="w-full max-w-xl border-gray-300 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm"
              />
            )}
          </div>

          <div className="md:col-span-2 min-w-0">
            <label className="block text-sm font-medium text-gray-700 mb-1">排课时间</label>
            <div
              className="w-full min-h-[2.5rem] px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 whitespace-pre-line"
              title={calendar?.schedule_time_summary ?? ''}
            >
              {groupOptions.length > 0 && !groupId
                ? '请先选择小组以显示排课时间'
                : calendar?.schedule_time_summary
                  ? calendar.schedule_time_summary.split('；').join('\n')
                  : calendar
                    ? '未查到排课记录，请确认是否已在排课结果中为该班级/小组排课'
                    : '—'}
            </div>
            {calendar?.schedule_time_by_class && calendar.schedule_time_by_class.length > 0 && (
              <div className="mt-2">
                <span className="text-sm font-medium text-gray-600">本课程各班级排课时间：</span>
                <ul className="mt-1 space-y-1 text-sm text-gray-700 list-none pl-0">
                  {calendar.schedule_time_by_class.map((item, idx) => (
                    <li key={idx} className="flex flex-wrap gap-x-2">
                      <span className="font-medium text-gray-800">{item.class_names}</span>
                      <span className="whitespace-pre-line">{item.schedule_time.split('；').join('\n')}</span>
                    </li>
                  ))}
                </ul>
              </div>
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
                    {(() => {
                      const raw =
                        (calendar.header.extra_info?.semester_text as string) ||
                        (calendar.header.academic_year &&
                        (calendar.header.extra_info?.semester as number | undefined) != null
                          ? `${calendar.header.academic_year} 学年第 ${
                              calendar.header.extra_info?.semester as number
                            } 学期`
                          : calendar.header.academic_year || '');
                      // 避免重复「学期」、多余「级」：只保留规范格式「XXXX-XXXX学年第X学期」
                      const t = String(raw || '').trim();
                      if (t.endsWith('学期 学期')) return t.replace(/ 学期\s*$/, '');
                      if (t.match(/第\d+级/)) return t.replace(/第\d+级\s*/g, '');
                      return t || '—';
                    })()}
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
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">学院</label>
                    <input
                      type="text"
                      value={(calendar.header.extra_info?.faculty_name as string) || '影视传媒学院'}
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
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
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
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
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
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-sm text-center"
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
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
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
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
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
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">总学时</label>
                    <input
                      type="number"
                      min={0}
                      value={
                        calendar.header.extra_info?.required_hours != null
                          ? Number(calendar.header.extra_info.required_hours)
                          : ''
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        const num = v === '' ? undefined : parseInt(v, 10);
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              required_hours: num === undefined || isNaN(num) ? undefined : num,
                            },
                          },
                        });
                      }}
                      placeholder="如 32"
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">理论学时</label>
                    <input
                      type="number"
                      min={0}
                      value={
                        calendar.header.extra_info?.theory_hours != null
                          ? Number(calendar.header.extra_info.theory_hours)
                          : ''
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        const num = v === '' ? undefined : parseInt(v, 10);
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              theory_hours: num === undefined || isNaN(num) ? undefined : num,
                            },
                          },
                        });
                      }}
                      placeholder="如 16"
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 mb-1">实践学时</label>
                    <input
                      type="number"
                      min={0}
                      value={
                        calendar.header.extra_info?.practice_hours != null
                          ? Number(calendar.header.extra_info.practice_hours)
                          : ''
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        const num = v === '' ? undefined : parseInt(v, 10);
                        setCalendar({
                          ...calendar,
                          header: {
                            ...calendar.header,
                            extra_info: {
                              ...calendar.header.extra_info,
                              practice_hours: num === undefined || isNaN(num) ? undefined : num,
                            },
                          },
                        });
                      }}
                      placeholder="如 16"
                      className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 text-center"
                    />
                  </div>
                  <p className="text-xs text-gray-500 md:col-span-2">
                    导出 Word 时第一页按原模板格式填入「总学时X(其中:理论学时Y实践学时Z)」
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'calendar' && (
              <div className="overflow-x-auto">
                <table className="min-w-full border border-gray-300 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border border-gray-300 px-2 py-1 text-center align-middle w-16">周次</th>
                      <th className="border border-gray-300 px-2 py-1 text-center align-middle w-32">授课日期</th>
                      <th className="border border-gray-300 px-2 py-1 text-center align-middle w-32">节次</th>
                      <th className="border border-gray-300 px-2 py-1 text-center align-middle w-20">学时</th>
                      <th className="border border-gray-300 px-2 py-1 text-center align-middle w-80">教学内容</th>
                      <th className="border border-gray-300 px-2 py-1 text-center align-middle w-80">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendar.entries.map((entry, idx) => (
                      <tr key={entry.week_range_text ? `range-${entry.week_range_text}-${idx}` : `${entry.week_number}-${entry.schedule_id || 'empty'}-${idx}`}>
                        <td className="border border-gray-300 px-2 py-1 text-center align-middle">
                          {entry.week_range_text || entry.week_number}
                        </td>
                        <td className="border border-gray-300 px-2 py-1 text-center align-middle">
                          {entry.date_text || ''}
                        </td>
                        <td className="border border-gray-300 px-2 py-1 text-center align-middle">
                          {entry.period_text || ''}
                        </td>
                        <td className="border border-gray-300 px-2 py-1 text-center align-middle">
                          {entry.hours ?? ''}
                        </td>
                        <td className="border border-gray-300 px-2 py-1 align-middle bg-sky-50/80">
                          <textarea
                            value={entry.teaching_content || ''}
                            onChange={(e) => handleEntryChange(idx, 'teaching_content', e.target.value)}
                            rows={Math.max(2, Math.min(12, ((entry.teaching_content || '').split(/\r?\n/).length) || 1))}
                            className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded px-2 py-1 focus:ring-purple-500 focus:border-purple-500 resize-y min-h-[3rem]"
                          />
                        </td>
                        <td className="border border-gray-300 px-2 py-1 align-middle bg-sky-50/80">
                          <textarea
                            value={entry.remark || ''}
                            onChange={(e) => handleEntryChange(idx, 'remark', e.target.value)}
                            rows={Math.max(2, Math.min(12, ((entry.remark || '').split(/\r?\n/).length) || 1))}
                            className="input-cell w-full border border-sky-200 bg-sky-50/80 rounded px-2 py-1 focus:ring-purple-500 focus:border-purple-500 resize-y min-h-[3rem]"
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

