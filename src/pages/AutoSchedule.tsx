import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { courseService, roomService, studentService, scheduleService } from '../services';
import { AutoScheduler } from '../utils/scheduler';
import { exportUtils } from '../utils/excel';
import { Settings, Play, Download, CheckCircle, AlertTriangle, Clock, Calendar, Users, MapPin, BookOpen, RefreshCw, BarChart3 } from 'lucide-react';
import type { Course, Room, Student, ScheduledClass } from '../types';
import { getCourseTypeByInstrument, FACULTIES } from '../types';
import { validateTeacherQualification, getFacultyCodeByInstrument } from '../utils/teacherValidation';
import FacultyConstraintValidator, { FacultyWorkload } from '../utils/facultyValidation';

interface SchedulingResult { success: boolean; scheduledClasses: ScheduledClass[]; conflicts: any[]; unassignedCourses: Course[]; }

export default function AutoSchedule() {
  const { teacher } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [existingSchedule, setExistingSchedule] = useState<ScheduledClass[]>([]);
  const [facultyWorkload, setFacultyWorkload] = useState<FacultyWorkload[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduling, setScheduling] = useState(false);
  const [result, setResult] = useState<SchedulingResult | null>(null);
  const [params, setParams] = useState({ preferredDays: [1, 2, 3, 4, 5], maxConsecutive: 3 });

  useEffect(() => {
    if (!teacher) {
      setLoading(false);
      return;
    }
    const fetchData = async () => {
      try {
        // 获取所有课程和学生
        const [allCourses, roomsData, allStudents, scheduleData] = await Promise.all([
          courseService.getByTeacher(teacher.id),
          roomService.getByTeacher(teacher.id),
          studentService.getByTeacher(teacher.id),
          scheduleService.getByTeacher(teacher.id),
        ]);

        // 根据教师可教授乐器过滤课程
        const teacherCourseTypes = teacher.can_teach_instruments.map(spec =>
          getCourseTypeByInstrument(spec)
        );

        const filteredCourses = allCourses.filter(c => teacherCourseTypes.includes(c.course_type));
        const filteredStudents = allStudents.filter(s => {
          const inst = s.primary_instrument || (s.secondary_instruments?.[0]) || '钢琴';
          return teacher.can_teach_instruments.includes(inst);
        }).sort((a, b) => String(a.student_id).localeCompare(String(b.student_id)));

        setCourses(filteredCourses);
        setRooms(roomsData);
        setStudents(filteredStudents);
        setExistingSchedule(scheduleData);

        // 计算教研室工作量统计
        if (teacher) {
          const validator = new FacultyConstraintValidator(scheduleData);
          // 获取今日工作量（简化：使用第一天）
          const todayWorkload = validator.getFacultyWorkload(teacher.id, scheduleData[0]?.date || new Date().toISOString().split('T')[0]);
          setFacultyWorkload(todayWorkload);
        }
      } catch (error) {
        console.error('获取数据失败:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [teacher]);

  const handleAutoSchedule = async () => {
    if (!teacher || courses.length === 0 || rooms.length === 0) {
      alert('请先添加课程和教室');
      return;
    }
    setScheduling(true);
    setResult(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const scheduler = new AutoScheduler(courses, rooms, students, existingSchedule, params);
      const schedulingResult = scheduler.autoSchedule();
      setResult(schedulingResult);
    } catch (error) {
      console.error('排课失败:', error);
    } finally {
      setScheduling(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (!teacher || !result) return;
    try {
      const scheduledClasses = result.scheduledClasses.map(cls => ({ ...cls, teacher_id: teacher.id }));
      await scheduleService.createMany(scheduledClasses);
      alert(`成功保存 ${scheduledClasses.length} 节课程到课表`);
    } catch (error) {
      console.error('保存课表失败:', error);
    }
  };

  const handleExport = () => { if (result) exportUtils.exportSchedule(result.scheduledClasses as any[]); };

  const toggleDay = (day: number) => {
    setParams(prev => ({ ...prev, preferredDays: prev.preferredDays.includes(day) ? prev.preferredDays.filter(d => d !== day) : [...prev.preferredDays, day].sort() }));
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div></div>;

  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">自动排课</h1>
        {result && <button onClick={handleExport} className="btn-secondary flex items-center gap-2"><Download className="w-4 h-4" />导出结果</button>}
      </div>

      {/* 显示教师可教授乐器信息 */}
      {teacher && teacher.can_teach_instruments && teacher.can_teach_instruments.length > 0 && (
        <div className="card mb-6 bg-purple-50 border-purple-200">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-5 h-5 text-purple-600" />
            <span className="font-medium text-purple-800">当前可教授乐器：</span>
            <div className="flex gap-2">
              {teacher.can_teach_instruments.map((spec, index) => (
                <span key={index} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                  {spec}
                </span>
              ))}
            </div>
            <span className="text-sm text-purple-600 ml-2">（系统将自动筛选对应乐器的课程和学生）</span>
          </div>
          {/* 验证信息 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-purple-600">所属教研室：</span>
            <span className="font-medium text-purple-800">
              {FACULTIES.find(f => f.faculty_code === teacher.faculty_code)?.faculty_name || teacher.faculty_code || '未设置'}
            </span>
            <span className="text-purple-400">|</span>
            <span className="text-purple-600">专业匹配状态：</span>
            {teacher.can_teach_instruments.every(inst =>
              getFacultyCodeByInstrument(inst) === teacher.faculty_code
            ) ? (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle className="w-4 h-4" /> 全部匹配
              </span>
            ) : (
              <span className="flex items-center gap-1 text-yellow-600">
                <AlertTriangle className="w-4 h-4" /> 部分不匹配
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="card"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><BookOpen className="w-5 h-5 text-blue-600" /></div><div><p className="text-sm text-gray-500">待排课程</p><p className="text-2xl font-bold text-gray-900">{courses.length}</p></div></div></div>
        <div className="card"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><Users className="w-5 h-5 text-green-600" /></div><div><p className="text-sm text-gray-500">学生人数</p><p className="text-2xl font-bold text-gray-900">{students.length}</p></div></div></div>
        <div className="card"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center"><MapPin className="w-5 h-5 text-purple-600" /></div><div><p className="text-sm text-gray-500">可用教室</p><p className="text-2xl font-bold text-gray-900">{rooms.length}</p></div></div></div>
        <div className="card"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center"><Calendar className="w-5 h-5 text-orange-600" /></div><div><p className="text-sm text-gray-500">已排课程</p><p className="text-2xl font-bold text-gray-900">{existingSchedule.length}</p></div></div></div>
      </div>

      {/* 教研室工作量统计 */}
      {existingSchedule.length > 0 && facultyWorkload.length > 0 && (
        <div className="card mb-6 bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            <h3 className="font-medium text-indigo-800">教研室工作量统计</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {facultyWorkload.map((workload, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-white rounded-lg">
                <span className="text-sm text-gray-600">{workload.facultyName}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-bold ${workload.classCount >= 8 ? 'text-red-600' : workload.classCount >= 5 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {workload.classCount}
                  </span>
                  <span className="text-xs text-gray-400">节</span>
                  {workload.classCount >= 8 && (
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            建议单个教研室每日不超过8节课，保持工作量平衡
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="card">
            <h2 className="section-title flex items-center gap-2"><Settings className="w-5 h-5 text-purple-600" />排课参数</h2>
            <div className="space-y-4">
              <div><label className="label">偏好排课日期</label><div className="flex gap-1 flex-wrap">{days.map((day, index) => (<button key={day} onClick={() => toggleDay(index + 1)} className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${params.preferredDays.includes(index + 1) ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{day}</button>))}</div></div>
              <div><label className="label">节次说明</label><div className="text-sm text-gray-600 space-y-1"><p>上午：第1-2节（08:10-09:50），第3-4节（10:05-11:40）</p><p>下午：第5-6节（13:45-15:25），第7-8节（15:40-17:20）</p><p>晚上：第9-10节（18:30-20:10）</p><p className="text-gray-500">两节课之间休息10分钟</p></div></div>
              <button onClick={handleAutoSchedule} disabled={scheduling || courses.length === 0 || rooms.length === 0} className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50">{scheduling ? <><RefreshCw className="w-5 h-5 animate-spin" />排课中...</> : <><Play className="w-5 h-5" />开始自动排课</>}</button>
            </div>
          </div>
          {courses.length === 0 && <div className="card mt-4 bg-yellow-50 border-yellow-200"><div className="flex items-center gap-2 text-yellow-800"><AlertTriangle className="w-5 h-5" /><span className="font-medium">请先添加课程</span></div></div>}
          {rooms.length === 0 && <div className="card mt-4 bg-yellow-50 border-yellow-200"><div className="flex items-center gap-2 text-yellow-800"><AlertTriangle className="w-5 h-5" /><span className="font-medium">请先添加教室</span></div></div>}
        </div>

        <div className="lg:col-span-2">
          {result ? (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="section-title">排课结果</h2>
                {result.success && <div className="flex items-center gap-2 text-green-600"><CheckCircle className="w-5 h-5" /><span className="font-medium">排课成功</span></div>}
              </div>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-green-50 rounded-lg"><p className="text-3xl font-bold text-green-600">{result.scheduledClasses.length}</p><p className="text-sm text-gray-600">成功排课</p></div>
                <div className="text-center p-4 bg-red-50 rounded-lg"><p className="text-3xl font-bold text-red-600">{result.conflicts.length}</p><p className="text-sm text-gray-600">冲突数量</p></div>
                <div className="text-center p-4 bg-yellow-50 rounded-lg"><p className="text-3xl font-bold text-yellow-600">{result.unassignedCourses.length}</p><p className="text-sm text-gray-600">未分配课程</p></div>
              </div>
              {result.conflicts.length > 0 && (
                <div className="mb-6"><h3 className="font-medium text-gray-800 mb-3">冲突详情</h3><div className="space-y-2">{result.conflicts.map((conflict, index) => (<div key={index} className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-sm"><AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" /><span className="text-red-700">{conflict.description}</span></div>))}</div></div>
              )}
              {result.scheduledClasses.length > 0 && (
                <div><h3 className="font-medium text-gray-800 mb-3">已排课程预览</h3><div className="table-container"><table className="table"><thead><tr><th>课程</th><th>学生</th><th>教室</th><th>时间</th></tr></thead><tbody>{result.scheduledClasses.slice(0, 10).map(cls => (<tr key={cls.id}><td className="font-medium">{cls.course_id}</td><td>{cls.student_id || '-'}</td><td>{cls.room_id}</td><td><span className="flex items-center gap-1"><Clock className="w-4 h-4 text-gray-400" />{days[cls.day_of_week - 1]} 第{cls.period}节</span></td></tr>))}</tbody></table></div></div>
              )}
              {result.scheduledClasses.length > 0 && (
                <div className="mt-6 flex gap-3"><button onClick={handleSaveSchedule} className="flex-1 btn-primary py-3">保存到课表</button><button onClick={handleAutoSchedule} className="flex-1 btn-secondary py-3">重新排课</button></div>
              )}
            </div>
          ) : (
            <div className="card">
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4"><Calendar className="w-8 h-8 text-purple-600" /></div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">准备开始排课</h3>
                <p className="text-gray-500 mb-4">配置排课参数后，点击"开始自动排课"按钮</p>
                <div className="text-sm text-gray-400 space-y-1"><p>• 系统会根据教室可用性和课程类型智能分配</p><p>• 自动检测并避免时间冲突</p><p>• 支持钢琴、声乐、器乐三类课程</p></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
