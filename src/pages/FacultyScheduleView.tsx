/**
 * 教研室排课视图页面
 * 按教研室查看排课情况，支持按乐器筛选
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { FACULTIES, PERIOD_CONFIG, getFacultyCodeForInstrument } from '../types';
import FacultyFilter from '../components/FacultyFilter';
import { Calendar, Clock, MapPin, Users, ChevronLeft, ChevronRight, Filter, X, Loader2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import { scheduleViewService, ScheduleClassView, ViewFilters, weekConfigService, teacherService, roomService } from '../services';

interface Room {
  id: string;
  room_id?: string;
  room_name: string;
  room_type?: string;
  capacity?: number;
  teacher_id?: string;
}

interface Teacher {
  id: string;
  teacher_id?: string;
  name: string;
  fixed_room_id?: string;
  fixed_rooms?: Array<{ room_id: string; faculty_code: string }>;
}

interface FacultyScheduleViewProps {
  schedules?: ScheduleClassView[];
  onClassClick?: (classId: string) => void;
}

const FacultyScheduleView: React.FC<FacultyScheduleViewProps> = ({
  schedules: initialSchedules,
  onClassClick
}) => {
  const [currentWeek, setCurrentWeek] = useState(1);
  const [selectedFaculty, setSelectedFaculty] = useState<string | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [selectedWeekRange, setSelectedWeekRange] = useState<{ startWeek: number; endWeek: number }>({ startWeek: 1, endWeek: 16 });
  const [totalWeeks, setTotalWeeks] = useState(16);
  
  // 数据状态
  const [schedules, setSchedules] = useState<ScheduleClassView[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 获取当前学期标签
  const getCurrentSemesterLabel = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const academicYear = month >= 8 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
    const semester = month >= 8 ? '1' : '2';
    return `${academicYear}-${semester}`;
  };

  // 加载周次配置
  useEffect(() => {
    const fetchWeekConfig = async () => {
      try {
        const currentSemester = getCurrentSemesterLabel();
        const weekConfigData = await weekConfigService.getBySemester(currentSemester);
        
        if (weekConfigData) {
          setTotalWeeks(weekConfigData.total_weeks || 16);
          setSelectedWeekRange({ 
            startWeek: 1, 
            endWeek: weekConfigData.total_weeks || 16 
          });
        }
      } catch (error) {
        console.log('周次配置加载失败，使用默认值');
      }
    };

    fetchWeekConfig();
  }, []);

  // 加载琴房和教师数据（用于获取琴房名称的后备逻辑）
  useEffect(() => {
    const loadAuxiliaryData = async () => {
      try {
        const roomsData = await roomService.getAll();
        setRooms(roomsData);
        
        const teachersData = await teacherService.getAll();
        setTeachers(teachersData);
      } catch (err) {
        console.error('加载辅助数据失败:', err);
      }
    };
    
    loadAuxiliaryData();
  }, []);

  // 加载排课数据
  const loadSchedules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const filters: ViewFilters = {
        facultyCode: selectedFaculty || undefined,
        weekRange: {
          startWeek: selectedWeekRange.startWeek,
          endWeek: selectedWeekRange.endWeek
        },
        totalWeeks: totalWeeks
      };
      
      const data = await scheduleViewService.getViewSchedules(filters);
      setSchedules(data);
    } catch (err) {
      console.error('加载排课数据失败:', err);
      setError('加载排课数据失败，请刷新页面重试');
    } finally {
      setLoading(false);
    }
  }, [selectedFaculty, selectedWeekRange.startWeek, selectedWeekRange.endWeek, totalWeeks]);

  // 初始加载和筛选变化时重新加载
  useEffect(() => {
    if (!initialSchedules) {
      loadSchedules();
    }
  }, [loadSchedules, initialSchedules]);

  // 教研室视图以稳定浏览为主，这里不启用实时订阅，避免频繁闪烁加载状态

  // 星期标签
  const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  // 教研室颜色
  const facultyColors: Record<string, { bg: string; text: string; border: string }> = {
    PIANO: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
    VOCAL: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300' },
    INSTRUMENT: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
    THEORY: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-300' }
  };

  // 使用传入的数据或加载的数据
  const displaySchedules = initialSchedules || schedules;

  // 过滤课程（教研室/乐器/教师筛选）
  const filteredSchedules = useMemo(() => {
    return displaySchedules.filter(schedule => {
      // 教师筛选：当选中具体教师时，只显示该教师的排课
      if (selectedTeacherId) {
        const teacher = teachers.find(t => t.id === selectedTeacherId);
        if (!teacher || schedule.teacherName !== teacher.name) return false;
      }

      if (selectedInstrument) {
        const specific = (schedule as any).specificInstrument as string | undefined;
        const courseName = (schedule as any).courseName as string | undefined;
        const studentClass = (schedule as any).studentClass as string | undefined;

        // 1. 如果已经识别出具体乐器，优先严格匹配
        if (specific) {
          if (specific !== selectedInstrument) {
            return false;
          }
        } else {
          // 2. 没有具体乐器时，尝试从课程名 / 班级名称中模糊匹配乐器关键字
          const text = `${courseName || ''}${studentClass || ''}`;
          if (text && !text.includes(selectedInstrument)) {
            // 3. 最后兜底：按课程类型字段（钢琴 / 声乐 / 器乐 等）匹配
            if (schedule.instrument && schedule.instrument !== selectedInstrument) {
              return false;
            }
          }
        }
      }
      return true;
    });
  }, [displaySchedules, selectedInstrument, selectedTeacherId, teachers]);

  // 获取琴房名称（与 ArrangeClass 相同的后备逻辑）
  const getRoomName = useCallback((schedule: ScheduleClassView): string => {
    // 1. 直接使用 schedule 中的 roomName
    if (schedule.roomName) {
      return schedule.roomName;
    }
    
    // 2. 如果有 room_id，从 rooms 数组中查找
    if (schedule.room_id || (schedule as any).roomId) {
      const roomId = schedule.room_id || (schedule as any).roomId;
      const room = rooms.find(r => r.id === roomId || r.room_id === roomId);
      if (room?.room_name) {
        return room.room_name;
      }
    }
    
    // 3. 根据教师固定琴房查找
    const teacher = teachers.find(t => t.name === schedule.teacherName);
    if (teacher) {
      if (teacher.fixed_rooms && teacher.fixed_rooms.length > 0) {
        return teacher.fixed_rooms.map(fr => {
          const room = rooms.find(r => r.id === fr.room_id || r.room_id === fr.room_id);
          return room?.room_name || fr.room_id;
        }).join('、');
      } else if (teacher.fixed_room_id) {
        const room = rooms.find(r => r.id === teacher.fixed_room_id || r.room_id === teacher.fixed_room_id);
        if (room?.room_name) {
          return room.room_name;
        }
      }
    }
    
    return '';
  }, [rooms, teachers]);

  // 获取某时段某天的所有课程（支持多个课程显示）
  const getSchedulesAt = (day: number, period: number): ScheduleClassView[] => {
    return filteredSchedules.filter(s => s.dayOfWeek === day && s.period === period);
  };

  // 渲染课程组
  const renderScheduleGroups = (scheduleGroups: ScheduleClassView[][]) => {
    if (scheduleGroups.length === 0) {
      return (
        <div className="h-full min-h-[60px] flex items-center justify-center text-gray-300 text-sm">
          -
        </div>
      );
    }

    return (
      <div className="space-y-1">
        {scheduleGroups.map((group, groupIndex) => {
          const firstSchedule = group[0];
          const facultyCode = getFacultyCodeForInstrument(firstSchedule.instrument);
          const roomName = getRoomName(firstSchedule);
          
          const allStudentNames = group.map(s => s.studentName).filter(Boolean);
          const uniqueStudentNames = [...new Set(allStudentNames)];
          
          const allClasses = group.map(s => s.studentClass).filter(Boolean);
          const uniqueClasses = [...new Set(allClasses)];
          
          const schedules = firstSchedule.schedules || [];
          const dayMap: Record<number, string> = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
          
          const timeSlotMap = new Map<string, number[]>();
          schedules.forEach((s: any) => {
            const key = `${s.day}_${s.period}`;
            if (!timeSlotMap.has(key)) {
              timeSlotMap.set(key, []);
            }
            if (s.week) {
              timeSlotMap.get(key)!.push(s.week);
            }
          });
          
          const timeStrings = Array.from(timeSlotMap.entries()).map(([key, weeks]) => {
            const [day, period] = key.split('_').map(Number);
            const sortedWeeks = [...new Set(weeks)].sort((a, b) => a - b);
            
            const weekRanges: string[] = [];
            let start = sortedWeeks[0];
            let end = start;
            for (let i = 1; i <= sortedWeeks.length; i++) {
              if (i < sortedWeeks.length && sortedWeeks[i] === end + 1) {
                end = sortedWeeks[i];
              } else {
                weekRanges.push(start === end ? `${start}` : `${start}-${end}`);
                if (i < sortedWeeks.length) {
                  start = sortedWeeks[i];
                  end = start;
                }
              }
            }
            
            return `第${weekRanges.join('、')}周 ${dayMap[day]} 第${period}节`;
          });
          
          return (
            <div
              key={groupIndex}
              onClick={() => onClassClick?.(firstSchedule.id)}
              className={`group relative p-1.5 rounded border cursor-pointer hover:shadow-md transition-shadow ${
                facultyColors[facultyCode]?.border || 'border-gray-200'
              } ${facultyColors[facultyCode]?.bg || 'bg-white'}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-xs font-medium truncate ${
                  facultyColors[facultyCode]?.text || 'text-gray-700'
                }`}>
                  {firstSchedule.courseName}
                </span>
                {firstSchedule.groupSize > 1 && (
                  <span className="text-xs text-purple-600 whitespace-nowrap">
                    {firstSchedule.groupSize}人
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 mt-0.5">
                <span className="text-xs text-gray-600 truncate">
                  {firstSchedule.teacherName}
                </span>
                <span className="text-xs text-gray-400 truncate flex-shrink-0">
                  {roomName || '-'}
                </span>
              </div>
              {(uniqueClasses.length > 0 || uniqueStudentNames.length > 0 || timeStrings.length > 0) && (
                <div className="hidden group-hover:block absolute left-0 right-0 bottom-full z-[100] mb-1 p-1.5 bg-gray-800 text-white text-xs rounded shadow-lg max-h-48 overflow-y-auto min-w-max">
                  {uniqueClasses.length > 0 && (
                    <div>
                      <span className="text-gray-400">班级：</span>
                      {uniqueClasses.join('、')}
                    </div>
                  )}
                  {uniqueStudentNames.length > 0 && (
                    <div className="mt-1">
                      <span className="text-gray-400">学生：</span>
                      {uniqueStudentNames.join('、')}
                    </div>
                  )}
                  {timeStrings.length > 0 && (
                    <div className="mt-1 border-t border-gray-600 pt-1">
                      {timeStrings.map((t, i) => (
                        <div key={i} className="truncate">{t}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 获取某教研室的统计
  const getFacultyStats = useCallback(async (facultyCode: string) => {
    return scheduleViewService.getFacultyStats(facultyCode);
  }, []);

  // 获取选中的教研室的统计
  const [selectedStats, setSelectedStats] = useState<{
    classCount: number;
    teacherCount: number;
    studentCount: number;
    courseCount: number;
  } | null>(null);

  useEffect(() => {
    if (selectedFaculty) {
      getFacultyStats(selectedFaculty).then(setSelectedStats);
    } else {
      setSelectedStats(null);
    }
  }, [selectedFaculty, getFacultyStats, schedules]);

  // 按小组分组的显示（优化单元格显示）
  const getGroupedSchedulesAt = (day: number, period: number) => {
    const schedulesAtSlot = getSchedulesAt(day, period);
    
    // 按课程+教师+琴房分组
    const groups = new Map<string, ScheduleClassView[]>();
    
    for (const schedule of schedulesAtSlot) {
      const roomName = getRoomName(schedule);
      const key = `${schedule.courseName}_${schedule.teacherName}_${roomName}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(schedule);
    }
    
    return Array.from(groups.values());
  };

  // 每天的小组数量（用于星期导航显示，按小组数而非人数）
  const groupCountByDay = useMemo(() => {
    const count: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    for (const day of [1, 2, 3, 4, 5, 6, 7] as const) {
      let total = 0;
      for (const p of PERIOD_CONFIG) {
        total += getGroupedSchedulesAt(day, p.period).length;
      }
      count[day] = total;
    }
    return count;
  }, [filteredSchedules, getRoomName]);

  if (loading && !initialSchedules) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
        <span className="ml-2 text-gray-600">加载排课数据...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="text-red-500 mb-4">{error}</div>
        <button
          onClick={loadSchedules}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
        >
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title flex items-center gap-2">
          <Calendar className="w-6 h-6 text-purple-600" />
          教研室排课视图
        </h1>

        {/* 视图切换 */}
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('week')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'week'
                ? 'bg-white text-purple-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            周视图
          </button>
          <button
            onClick={() => setViewMode('day')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'day'
                ? 'bg-white text-purple-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            日视图
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧筛选面板 */}
        <div className="lg:col-span-1 space-y-4">
          <FacultyFilter
            selectedFaculty={selectedFaculty}
            selectedInstrument={selectedInstrument}
            selectedTeacherId={selectedTeacherId}
            onFacultySelect={setSelectedFaculty}
            onInstrumentSelect={setSelectedInstrument}
            onTeacherSelect={setSelectedTeacherId}
            teachers={teachers as any}
          />

          {/* 周数筛选器 */}
          <div className="card">
            <div className="flex items-center justify-between p-4">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-purple-600" />
                周数筛选
              </h3>
            </div>
            <div className="px-4 pb-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">选择周次范围</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">开始周</label>
                    <select
                      value={selectedWeekRange.startWeek}
                      onChange={(e) => setSelectedWeekRange(prev => ({ ...prev, startWeek: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    >
                      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => (
                        <option key={week} value={week}>第{week}周</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">结束周</label>
                    <select
                      value={selectedWeekRange.endWeek}
                      onChange={(e) => setSelectedWeekRange(prev => ({ ...prev, endWeek: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    >
                      {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => (
                        <option key={week} value={week}>第{week}周</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 当前筛选状态 */}
              {!(selectedWeekRange.startWeek === 1 && selectedWeekRange.endWeek === totalWeeks) && (
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <span className="text-sm text-gray-500">当前筛选：</span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs">
                    第{selectedWeekRange.startWeek}-{selectedWeekRange.endWeek}周
                    <button
                      onClick={() => setSelectedWeekRange({ startWeek: 1, endWeek: totalWeeks })}
                      className="hover:text-purple-900"
                    >
                      ×
                    </button>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 选中教研室的统计 */}
          {selectedStats && selectedFaculty && (
            <div className="card bg-gradient-to-br from-purple-50 to-white border-purple-200">
              <h3 className="font-medium text-purple-900 mb-3">
                {FACULTIES.find(f => f.faculty_code === selectedFaculty)?.faculty_name}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-purple-700">课程组数</span>
                  <span className="font-medium text-purple-900">{selectedStats.classCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-purple-700">教师数</span>
                  <span className="font-medium text-purple-900">{selectedStats.teacherCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-purple-700">学生数</span>
                  <span className="font-medium text-purple-900">{selectedStats.studentCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-purple-700">课程种类</span>
                  <span className="font-medium text-purple-900">{selectedStats.courseCount}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右侧排课表格 */}
        <div className="lg:col-span-3">
          {/* 星期导航 */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => {
                if (viewMode === 'week') {
                  setCurrentWeek(Math.max(1, currentWeek - 1));
                } else {
                  setCurrentWeek(Math.max(1, currentWeek - 1));
                }
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex gap-2">
              {viewMode === 'week' ? (
                // 周视图：显示周一到周日（节次数量按小组数显示）
                Array.from({ length: 7 }).map((_, index) => {
                  const day = index + 1;
                  const groupCount = groupCountByDay[day] ?? 0;
                  const hasClasses = groupCount > 0;

                  return (
                    <button
                      key={day}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        hasClasses
                          ? 'bg-purple-100 text-purple-700'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <div>{dayLabels[index]}</div>
                      <div className="text-xs opacity-75">
                        {groupCount}组
                      </div>
                    </button>
                  );
                })
              ) : (
                // 日视图：只显示当前选中的天（节次数量按小组数显示）
                (() => {
                  const day = currentWeek;
                  const groupCount = groupCountByDay[day] ?? 0;
                  return (
                    <button
                      className="px-6 py-2 rounded-lg text-sm font-medium bg-purple-100 text-purple-700"
                    >
                      <div>{dayLabels[day - 1] || `第${day}天`}</div>
                      <div className="text-xs opacity-75">
                        {groupCount}组
                      </div>
                    </button>
                  );
                })()
              )}
            </div>

            <button
              onClick={() => {
                if (viewMode === 'week') {
                  setCurrentWeek(Math.min(totalWeeks, currentWeek + 1));
                } else {
                  setCurrentWeek(Math.min(7, currentWeek + 1));
                }
              }}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* 排课网格 */}
          <div className="card overflow-visible pb-32">
            {viewMode === 'week' ? (
              // 周视图：纵向节次，横向天数
              <div className="overflow-x-auto pb-32">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="p-3 text-left text-sm font-medium text-gray-600 w-24">
                        节次
                      </th>
                      {dayLabels.map((label, index) => (
                        <th key={index} className="p-3 text-center text-sm font-medium text-gray-600">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERIOD_CONFIG.map((period) => (
                      <tr
                        key={period.period}
                        className={`border-b border-gray-100 hover:opacity-90 ${
                          period.period % 2 === 1 ? 'bg-gray-50' : 'bg-white'
                        }`}
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-1 text-sm text-gray-600">
                            <Clock className="w-4 h-4" />
                            第{period.period}节
                          </div>
                          <div className="text-xs text-gray-400">
                            {period.startTime}-{period.endTime}
                          </div>
                        </td>
                        {Array.from({ length: 7 }).map((_, i) => i + 1).map((day) => {
                          const scheduleGroups = getGroupedSchedulesAt(day, period.period);
                          return (
                            <td key={day} className="p-2 align-top">
                              {renderScheduleGroups(scheduleGroups)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              // 日视图：横向节次，分两行显示（1-4节、5-10节）
              <div className="space-y-4">
                {/* 第一行：1-4节 */}
                <div className="overflow-x-auto pb-48">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="p-2 text-center text-sm font-medium text-gray-600 w-16">
                          时间
                        </th>
                        {PERIOD_CONFIG.filter(p => p.period <= 4).map((period) => (
                          <th
                            key={period.period}
                            className={`p-2 text-center text-sm font-medium text-gray-600 ${
                              period.period % 2 === 1 ? 'bg-gray-100' : 'bg-white'
                            }`}
                          >
                            <div>第{period.period}节</div>
                            <div className="text-xs text-gray-400 font-normal">
                              {period.startTime}-{period.endTime}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100">
                        <td className="p-2 align-top bg-gray-50">
                          <div className="text-sm text-gray-600 font-medium">
                            {dayLabels[currentWeek - 1] || `第${currentWeek}天`}
                          </div>
                        </td>
                        {PERIOD_CONFIG.filter(p => p.period <= 4).map((period) => {
                          const scheduleGroups = getGroupedSchedulesAt(currentWeek, period.period);
                          return (
                            <td
                              key={period.period}
                              className={`p-2 align-top ${
                                period.period % 2 === 1 ? 'bg-gray-50' : 'bg-white'
                              }`}
                            >
                              {renderScheduleGroups(scheduleGroups)}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
                
                {/* 第二行：5-10节 */}
                <div className="overflow-x-auto pb-48">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="p-2 text-center text-sm font-medium text-gray-600 w-16">
                          时间
                        </th>
                        {PERIOD_CONFIG.filter(p => p.period >= 5).map((period) => (
                          <th
                            key={period.period}
                            className={`p-2 text-center text-sm font-medium text-gray-600 ${
                              period.period % 2 === 1 ? 'bg-gray-100' : 'bg-white'
                            }`}
                          >
                            <div>第{period.period}节</div>
                            <div className="text-xs text-gray-400 font-normal">
                              {period.startTime}-{period.endTime}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100">
                        <td className="p-2 align-top bg-gray-50">
                          <div className="text-sm text-gray-600 font-medium">
                            {dayLabels[currentWeek - 1] || `第${currentWeek}天`}
                          </div>
                        </td>
                        {PERIOD_CONFIG.filter(p => p.period >= 5).map((period) => {
                          const scheduleGroups = getGroupedSchedulesAt(currentWeek, period.period);
                          return (
                            <td
                              key={period.period}
                              className={`p-2 align-top ${
                                period.period % 2 === 1 ? 'bg-gray-50' : 'bg-white'
                              }`}
                            >
                              {renderScheduleGroups(scheduleGroups)}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
  
            {/* 图例 */}
            <div className="p-4 bg-gray-50 border-t border-gray-100">
              <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-blue-500"></span>
                  钢琴专业
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-green-500"></span>
                  声乐专业
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-orange-500"></span>
                  器乐专业
                </span>
                <span className="text-xs text-gray-400 ml-auto">
                  共 {filteredSchedules.length} 条排课记录
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FacultyScheduleView;
