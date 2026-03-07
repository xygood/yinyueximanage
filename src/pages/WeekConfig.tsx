import { useState, useEffect } from 'react';
import { weekConfigService, blockedSlotService, classService, operationLogService } from '../services';
import { useAuth } from '../hooks/useAuth';
import { Calendar, Plus, Trash2, Clock, AlertCircle, Check, X, Lock, Users, Edit, Download } from 'lucide-react';
import { SemesterWeekConfig, BlockedSlot, BlockedSlotType, PERIOD_CONFIG } from '../types';
import { exportUtils } from '../utils/excel';

// 班级类型定义
interface Class {
  id: string;
  class_id: string;
  class_name: string;
  enrollment_year: number;
  class_number: number;
  student_count: number;
  student_type: 'general' | 'upgrade';
  status: 'active' | 'inactive';
  created_at: string;
}

const WEEK_DAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
];

export default function WeekConfig() {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 如果正在加载认证状态，显示加载中
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  // 非管理员显示无权限访问
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">无权限访问</h2>
        <p className="text-gray-500 text-center max-w-md">
          周次设置和禁排时段管理仅限管理员操作。如需访问，请使用管理员账号登录。
        </p>
      </div>
    );
  }

  // 获取当前学年的函数 (格式: 2025-2026)
  const getCurrentAcademicYear = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    // 8月及以后为新学年第一学期，1-7月为上一学年第二学期
    if (month >= 8) {
      return `${year}-${year + 1}`;
    } else {
      return `${year - 1}-${year}`;
    }
  };

  // 获取当前学期标签 (格式: 2025-2026-1 或 2025-2026-2)
  const getCurrentSemesterLabel = () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const academicYear = getCurrentAcademicYear();
    const semester = month >= 8 ? '1' : '2';
    return `${academicYear}-${semester}`;
  };

  // 学期配置
  const [semesterConfig, setSemesterConfig] = useState<SemesterWeekConfig>({
    id: '',
    academic_year: getCurrentAcademicYear(),
    semester_label: getCurrentSemesterLabel(),
    start_date: '',
    total_weeks: 16,
    created_at: new Date().toISOString(),
  });

  // 禁排时段列表
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);

  // 班级列表
  const [classes, setClasses] = useState<Class[]>([]);

  // 新增/编辑禁排时段表单
  const [showAddBlockedSlot, setShowAddBlockedSlot] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [newBlockedSlot, setNewBlockedSlot] = useState<Partial<BlockedSlot>>({
    type: 'recurring',
    day_of_week: 1,
    start_period: 5,
    end_period: 8,
    reason: '',
    // 特定周次的多选星期
    specific_week_days: [],
    // 班级关联（新增）
    class_associations: [],
  });

  // 生成特定周次的星期选择
  const generateWeeksWithDays = (totalWeeks: number) => {
    const weeks = [];
    for (let week = 1; week <= totalWeeks; week++) {
      const weekDays = [];
      for (let day = 1; day <= 7; day++) {
        weekDays.push({
          week,
          day,
          label: `第${week}周 周${['一','二','三','四','五','六','日'][day-1]}`
        });
      }
      weeks.push(weekDays);
    }
    return weeks;
  };

  // 学年列表 (格式: 2025-2026)
  const getAcademicYears = () => {
    const currentYear = new Date().getFullYear();
    const currentAcademicYear = getCurrentAcademicYear();
    const currentStartYear = parseInt(currentAcademicYear.split('-')[0]);
    return [
      `${currentStartYear - 1}-${currentStartYear}`,
      currentAcademicYear,
      `${currentStartYear + 1}-${currentStartYear + 2}`,
    ];
  };

  // 学期列表
  const semesters = ['1', '2'];

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setMessage(null);

      // 加载学期配置
      const currentSemester = semesterConfig.semester_label;
      const academicYear = semesterConfig.academic_year;

      const config = await weekConfigService.getBySemester(currentSemester);

      if (config) {
        setSemesterConfig(config);
      } else {
        // 默认配置
        setSemesterConfig(prev => ({
          ...prev,
          academic_year: academicYear,
          semester_label: currentSemester,
        }));
      }

      // 加载禁排时段
      const slots = await blockedSlotService.getBySemester(currentSemester);
      setBlockedSlots(slots);

      // 加载班级列表
      const classList = await classService.getAll();
      setClasses(classList.filter(c => c.status === 'active'));

    } catch (error) {
      console.error('加载配置失败:', error);
      setMessage({ type: 'error', text: '加载配置失败' });
    } finally {
      setLoading(false);
    }
  };

  const saveSemesterConfig = async () => {
    try {
      setSaving(true);
      setMessage(null);

      // 验证必填字段
      if (!semesterConfig.start_date) {
        setMessage({ type: 'error', text: '请填写学期开始日期' });
        setSaving(false);
        return;
      }

      // 保存配置
      const savedConfig = await weekConfigService.upsert({
        academic_year: semesterConfig.academic_year,
        semester_label: semesterConfig.semester_label,
        start_date: semesterConfig.start_date,
        total_weeks: semesterConfig.total_weeks,
      });

      // 更新本地状态
      setSemesterConfig(savedConfig);
      setMessage({ type: 'success', text: '学期配置保存成功' });

    } catch (error) {
      console.error('保存配置失败:', error);
      setMessage({ type: 'error', text: '保存配置失败：' + (error instanceof Error ? error.message : '未知错误') });
    } finally {
      setSaving(false);
    }
  };

  const addBlockedSlot = async () => {
    try {
      setSaving(true);
      setMessage(null);

      // 表单验证
      if (newBlockedSlot.type === 'specific') {
        // 特定周次/日期类型
        const hasWeekDays = newBlockedSlot.specific_week_days && newBlockedSlot.specific_week_days.length > 0;
        const hasDateRange = newBlockedSlot.start_date && newBlockedSlot.end_date;
        
        if (!hasWeekDays && !hasDateRange) {
          setMessage({ type: 'error', text: '请选择特定周次的星期或日期范围' });
          setSaving(false);
          return;
        }

        // 如果填写了日期范围，需要验证结束日期不早于开始日期
        if (hasDateRange && newBlockedSlot.start_date && newBlockedSlot.end_date) {
          if (new Date(newBlockedSlot.end_date) < new Date(newBlockedSlot.start_date)) {
            setMessage({ type: 'error', text: '结束日期不能早于开始日期' });
            setSaving(false);
            return;
          }
        }
      } else {
        // 每周循环类型：需要填写星期和节次
        if (!newBlockedSlot.day_of_week || !newBlockedSlot.start_period || !newBlockedSlot.end_period) {
          setMessage({ type: 'error', text: '请填写完整的循环时间' });
          setSaving(false);
          return;
        }

        if (newBlockedSlot.end_period < newBlockedSlot.start_period) {
          setMessage({ type: 'error', text: '结束节次不能早于开始节次' });
          setSaving(false);
          return;
        }
      }

      const currentSemester = semesterConfig.semester_label;
      const academicYear = semesterConfig.academic_year;

      // 计算周次范围字符串（如"13-14周"）
      let weeksString = '';
      
      if (newBlockedSlot.type === 'specific') {
        if (newBlockedSlot.specific_week_days && newBlockedSlot.specific_week_days.length > 0) {
          // 从 specific_week_days 计算周次
          const weeks = [...new Set(newBlockedSlot.specific_week_days.map((swd: any) => swd.week))].sort((a, b) => a - b);
          if (weeks.length === 1) {
            weeksString = `${weeks[0]}周`;
          } else if (weeks.length > 1) {
            weeksString = `${weeks[0]}-${weeks[weeks.length - 1]}周`;
          }
        } else if (newBlockedSlot.start_date && newBlockedSlot.end_date && semesterConfig.start_date) {
          // 从日期范围计算周次
          const semesterStart = new Date(semesterConfig.start_date);
          const slotStart = new Date(newBlockedSlot.start_date);
          const slotEnd = new Date(newBlockedSlot.end_date);
          
          const startWeek = Math.floor((slotStart.getTime() - semesterStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          const endWeek = Math.floor((slotEnd.getTime() - semesterStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          
          if (startWeek === endWeek) {
            weeksString = `${startWeek}周`;
          } else {
            weeksString = `${startWeek}-${endWeek}周`;
          }
        }
      } else if (newBlockedSlot.type === 'recurring') {
        // 每周循环类型，使用配置中的总周数
        const totalWeeks = semesterConfig.total_weeks || 18;
        weeksString = `1-${totalWeeks}周`;
      }

      if (isEditing && editingSlotId) {
        // 编辑模式：更新现有禁排时段
        const updatedSlot = await blockedSlotService.update(editingSlotId, {
          academic_year: academicYear,
          semester_label: currentSemester,
          type: newBlockedSlot.type as BlockedSlotType,
          day_of_week: newBlockedSlot.type === 'recurring' ? newBlockedSlot.day_of_week : undefined,
          start_period: newBlockedSlot.start_period,
          end_period: newBlockedSlot.end_period,
          reason: newBlockedSlot.reason || '',
          start_date: newBlockedSlot.type === 'specific' ? newBlockedSlot.start_date : undefined,
          end_date: newBlockedSlot.type === 'specific' ? newBlockedSlot.end_date : undefined,
          week_number: newBlockedSlot.type === 'specific' && newBlockedSlot.specific_week_days && newBlockedSlot.specific_week_days.length > 0 ? newBlockedSlot.specific_week_days[0].week : undefined,
          specific_week_days: newBlockedSlot.type === 'specific' ? newBlockedSlot.specific_week_days : undefined,
          class_associations: newBlockedSlot.class_associations || [],
          weeks: weeksString,
        });

        setBlockedSlots(prev => prev.map(slot => slot.id === editingSlotId ? updatedSlot : slot));
        setMessage({ type: 'success', text: '禁排时段更新成功' });
        
        // 记录操作日志
        await operationLogService.log(
          '更新禁排时间',
          'system',
          `更新禁排时间：${newBlockedSlot.reason || '禁排'}，时间：周${newBlockedSlot.day_of_week} 第${newBlockedSlot.start_period}-${newBlockedSlot.end_period}节`,
          undefined,
          undefined
        );
      } else {
        // 新增模式：创建新的禁排时段
        const slot = await blockedSlotService.create({
          academic_year: academicYear,
          semester_label: currentSemester,
          type: newBlockedSlot.type as BlockedSlotType,
          day_of_week: newBlockedSlot.type === 'recurring' ? newBlockedSlot.day_of_week : undefined,
          start_period: newBlockedSlot.start_period,
          end_period: newBlockedSlot.end_period,
          reason: newBlockedSlot.reason || '',
          start_date: newBlockedSlot.type === 'specific' ? newBlockedSlot.start_date : undefined,
          end_date: newBlockedSlot.type === 'specific' ? newBlockedSlot.end_date : undefined,
          week_number: newBlockedSlot.type === 'specific' && newBlockedSlot.specific_week_days && newBlockedSlot.specific_week_days.length > 0 ? newBlockedSlot.specific_week_days[0].week : undefined,
          specific_week_days: newBlockedSlot.type === 'specific' ? newBlockedSlot.specific_week_days : undefined,
          class_associations: newBlockedSlot.class_associations || [],
          weeks: weeksString,
        });

        setBlockedSlots(prev => [...prev, slot]);
        setMessage({ type: 'success', text: '禁排时段添加成功' });
        
        // 记录操作日志
        await operationLogService.log(
          '添加禁排时间',
          'system',
          `添加禁排时间：${newBlockedSlot.reason || '禁排'}，时间：周${newBlockedSlot.day_of_week} 第${newBlockedSlot.start_period}-${newBlockedSlot.end_period}节`,
          undefined,
          undefined
        );
      }

      setShowAddBlockedSlot(false);
      setIsEditing(false);
      setEditingSlotId(null);
      setNewBlockedSlot({
        type: 'recurring',
        day_of_week: 1,
        start_period: 5,
        end_period: 8,
        reason: '',
        specific_week_days: [],
        class_associations: [],
      });
    } catch (error) {
      console.error(isEditing ? '更新禁排时段失败:' : '添加禁排时段失败:', error);
      setMessage({ type: 'error', text: (isEditing ? '更新禁排时段失败：' : '添加禁排时段失败：') + (error instanceof Error ? error.message : '未知错误') });
    } finally {
      setSaving(false);
    }
  };

  const deleteBlockedSlot = async (id: string) => {
    try {
      setSaving(true);

      await blockedSlotService.delete(id);

      setBlockedSlots(prev => prev.filter(s => s.id !== id));
      setMessage({ type: 'success', text: '禁排时段删除成功' });
      
      // 记录操作日志
      await operationLogService.log(
        '删除禁排时间',
        'system',
        '删除禁排时间',
        undefined,
        undefined
      );
    } catch (error) {
      console.error('删除禁排时段失败:', error);
      setMessage({ type: 'error', text: '删除禁排时段失败：' + (error instanceof Error ? error.message : '未知错误') });
    } finally {
      setSaving(false);
    }
  };

  const handleExportBlockedSlots = () => {
    try {
      // 准备导出数据
      const exportData = blockedSlots.flatMap((slot, slotIndex) => {
        // 生成班级信息
        let className = '所有班级';
        if (slot.class_associations && slot.class_associations.length > 0) {
          className = slot.class_associations.map(c => c.name).join('、');
        }
        
        // 计算日期对应的周次（以周一为一周的第一天）
        const calculateWeekNumber = (dateString: string): number => {
          const startDateStr = semesterConfig.start_date || '2026-02-23';
          const startDate = new Date(startDateStr);
          const targetDate = new Date(dateString);
          
          if (isNaN(startDate.getTime()) || isNaN(targetDate.getTime())) {
            return 1;
          }
          
          // 获取某日期所在周的周一
          const getMonday = (date: Date): Date => {
            const d = new Date(date);
            const day = d.getDay();
            // getDay() 返回 0-6，其中 0 是星期日
            // 周一为一周的第一天：周日(0)属于上一周，周一(1)到周日(0)为一周
            const diff = day === 0 ? -6 : 1 - day;
            d.setDate(d.getDate() + diff);
            return d;
          };
          
          const startMonday = getMonday(startDate);
          const targetMonday = getMonday(targetDate);
          
          const timeDiff = targetMonday.getTime() - startMonday.getTime();
          const weekDiff = Math.floor(timeDiff / (1000 * 3600 * 24 * 7)) + 1;
          
          return Math.max(1, weekDiff);
        };

        // 生成星期
        let day = '未知';
        if (slot.type === 'recurring') {
          day = WEEK_DAYS.find(d => d.value === slot.day_of_week)?.label || '未知';
        } else if (slot.specific_week_days && slot.specific_week_days.length > 0) {
          const days = slot.specific_week_days.map((wd: any) => {
            return WEEK_DAYS.find(d => d.value === wd.day)?.label || '未知';
          });
          day = [...new Set(days)].join('、');
        } else if (slot.type === 'specific' && slot.start_date && slot.end_date) {
          const startDate = new Date(slot.start_date);
          const endDate = new Date(slot.end_date);
          const daySet = new Set<string>();
          
          const currentDate = new Date(startDate);
          while (currentDate <= endDate) {
            const dayIndex = currentDate.getDay();
            const adjustedDayIndex = dayIndex === 0 ? 7 : dayIndex;
            const dayLabel = WEEK_DAYS.find(d => d.value === adjustedDayIndex)?.label || '未知';
            daySet.add(dayLabel);
            
            currentDate.setDate(currentDate.getDate() + 1);
          }
          
          day = Array.from(daySet).join('、');
        } else if (slot.type === 'specific') {
          day = '全周';
        }
        
        // 生成节次
        const periods = slot.start_period && slot.end_period ? `${slot.start_period}-${slot.end_period}节` : '';
        
        // 生成周次
        let weekRange = '1-17周';
        if (slot.type === 'specific') {
          if (slot.weeks) {
            weekRange = slot.weeks;
          } else if (slot.week_number) {
            weekRange = `${slot.week_number}周`;
          } else if (slot.specific_week_days && slot.specific_week_days.length > 0) {
            const weeks = [...new Set(slot.specific_week_days.map((wd: any) => wd.week))];
            if (weeks.length === 1) {
              weekRange = `${weeks[0]}周`;
            } else if (weeks.length > 1) {
              weeks.sort((a, b) => a - b);
              weekRange = `${weeks[0]}-${weeks[weeks.length - 1]}周`;
            }
          } else if (slot.start_date && slot.end_date) {
            const startDate = new Date(slot.start_date);
            const endDate = new Date(slot.end_date);
            const weekDayMap = new Map<string, Set<string>>();
            
            // 遍历日期范围内的所有日期，计算每个日期对应的周次和星期几
            const currentDate = new Date(startDate);
            while (currentDate <= endDate) {
              const dateStr = currentDate.toISOString().split('T')[0];
              const week = calculateWeekNumber(dateStr);
              const weekKey = `${week}周`;
              
              const dayIndex = currentDate.getDay();
              // getDay() 返回 0-6，其中 0 是星期日，1-6 是周一到周六
              // 而 WEEK_DAYS 是 1-7，其中 1 是周一，7 是周日
              const adjustedDayIndex = dayIndex === 0 ? 7 : dayIndex;
              const dayLabel = WEEK_DAYS.find(d => d.value === adjustedDayIndex)?.label || '未知';
              
              // 将星期几添加到对应周次的集合中
              if (!weekDayMap.has(weekKey)) {
                weekDayMap.set(weekKey, new Set<string>());
              }
              weekDayMap.get(weekKey)?.add(dayLabel);
              
              // 移动到下一天
              currentDate.setDate(currentDate.getDate() + 1);
            }
            
            // 为每个不同的（周次，星期几）组合生成单独的行
            const rows = [];
            let index = 0;
            weekDayMap.forEach((daySet, weekRange) => {
              const days = Array.from(daySet);
              days.forEach(dayLabel => {
                rows.push({
                  '序号': slotIndex * 100 + index + 1,
                  '班级': className,
                  '周次': weekRange,
                  '星期': dayLabel,
                  '节次': periods,
                  '禁排原因': slot.reason || '无'
                });
                index++;
              });
            });
            return rows;
          }
        } else if (slot.type === 'recurring') {
          weekRange = `1-${semesterConfig.total_weeks || 17}周`;
        }
        
        // 禁排原因
        const blockedReason = slot.reason || '无';
        
        // 生成单行数据
        return [{
          '序号': slotIndex + 1,
          '班级': className,
          '周次': weekRange,
          '星期': day,
          '节次': periods,
          '禁排原因': blockedReason
        }];
      });
      
      // 导出到Excel
      exportUtils.exportToExcel(exportData, `禁排时段_${semesterConfig.semester_label}`, '禁排时段');
      
      // 显示成功消息
      setMessage({ type: 'success', text: '禁排时段导出成功' });
      
    } catch (error) {
      console.error('导出禁排时段失败:', error);
      setMessage({ type: 'error', text: '导出禁排时段失败：' + (error instanceof Error ? error.message : '未知错误') });
    }
  };

  const handleEditBlockedSlot = (slot: BlockedSlot) => {
    setIsEditing(true);
    setEditingSlotId(slot.id);
    setNewBlockedSlot({
      type: slot.type,
      day_of_week: slot.day_of_week,
      start_period: slot.start_period || 5,
      end_period: slot.end_period || 8,
      reason: slot.reason,
      start_date: slot.start_date,
      end_date: slot.end_date,
      week_number: slot.week_number,
      specific_week_days: slot.specific_week_days || [],
      class_associations: slot.class_associations || [],
    });
    setShowAddBlockedSlot(true);
  };

  const getBlockedSlotDescription = (slot: BlockedSlot): string => {
    let description = '';
    if (slot.type === 'recurring') {
      const dayLabel = WEEK_DAYS.find(d => d.value === slot.day_of_week)?.label || '未知';
      const periods = slot.start_period && slot.end_period ? `${slot.start_period}-${slot.end_period}节` : '';
      description = `${dayLabel} ${periods}`;
    } else {
      if (slot.start_date && slot.end_date) {
        description = `${slot.start_date} 至 ${slot.end_date}`;
      } else if (slot.specific_week_days && slot.specific_week_days.length > 0) {
        // 按周分组
        const weeksMap = slot.specific_week_days.reduce((map, item) => {
          if (!map[item.week]) {
            map[item.week] = [];
          }
          map[item.week].push(item.day);
          return map;
        }, {} as Record<number, number[]>);
        
        // 生成描述
        const weekDescriptions = Object.entries(weeksMap).map(([week, days]) => {
          const dayLabels = days.map(day => WEEK_DAYS.find(d => d.value === day)?.label || '未知').join('、');
          return `第${week}周 [${dayLabels}]`;
        });
        description = weekDescriptions.join('，');
      } else if (slot.week_number) {
        description = `第${slot.week_number}周`;
      } else {
        description = '特定日期';
      }
      
      // 添加节次信息
      if (slot.start_period && slot.end_period) {
        description += ` ${slot.start_period}-${slot.end_period}节`;
      }
    }
    
    // 添加关联班级信息
    if (slot.class_associations && slot.class_associations.length > 0) {
      const classNames = slot.class_associations.map(c => c.name).join('、');
      description += ` [${classNames}]`;
    } else {
      description += ' [全局]';
    }
    
    return description;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">学期周次配置</h1>
        <p className="text-gray-500 mt-1">配置学期开始日期、总周数和禁排时段</p>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.type === 'success' ? (
            <Check className="w-5 h-5" />
          ) : (
            <AlertCircle className="w-5 h-5" />
          )}
          {message.text}
          <button
            onClick={() => setMessage(null)}
            className="ml-auto hover:opacity-70"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 学期配置 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-purple-600" />
          学期基本配置
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* 学年选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">学年</label>
            <select
              value={semesterConfig.academic_year}
              onChange={(e) => setSemesterConfig(prev => ({
                ...prev,
                academic_year: e.target.value,
                semester_label: `${e.target.value}-${prev.semester_label.split('-')[2] || '1'}`,
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {getAcademicYears().map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          {/* 学期选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">学期</label>
            <select
              value={semesterConfig.semester_label.split('-')[2]}
              onChange={(e) => setSemesterConfig(prev => ({
                ...prev,
                semester_label: `${prev.academic_year}-${e.target.value}`,
              }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="1">{semesterConfig.academic_year}-1学期</option>
              <option value="2">{semesterConfig.academic_year}-2学期</option>
            </select>
          </div>

          {/* 学期开始日期 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              学期开始日期
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="date"
              value={semesterConfig.start_date}
              onChange={(e) => setSemesterConfig(prev => ({ ...prev, start_date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">也是第1周的开始日期</p>
          </div>

          {/* 总周数 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              总周数
              <span className="text-red-500 ml-1">*</span>
            </label>
            <select
              value={semesterConfig.total_weeks}
              onChange={(e) => setSemesterConfig(prev => ({ ...prev, total_weeks: parseInt(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              {[12, 13, 14, 15, 16, 17, 18, 19, 20].map(weeks => (
                <option key={weeks} value={weeks}>{weeks}周</option>
              ))}
            </select>
          </div>
        </div>

        {/* 预览 */}
        {semesterConfig.start_date && (
          <div className="mt-4 p-4 bg-purple-50 rounded-lg">
            <h3 className="text-sm font-medium text-purple-900 mb-2">学期预览</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-purple-600">学期：</span>
                <span className="font-medium">{semesterConfig.semester_label}</span>
              </div>
              <div>
                <span className="text-purple-600">开始日期：</span>
                <span className="font-medium">{semesterConfig.start_date}</span>
              </div>
              <div>
                <span className="text-purple-600">结束日期：</span>
                <span className="font-medium">
                  {(() => {
                    const end = new Date(semesterConfig.start_date);
                    end.setDate(end.getDate() + (semesterConfig.total_weeks - 1) * 7 + 6);
                    return end.toISOString().split('T')[0];
                  })()}
                </span>
              </div>
              <div>
                <span className="text-purple-600">共：</span>
                <span className="font-medium">{semesterConfig.total_weeks}周</span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={saveSemesterConfig}
            disabled={saving || !semesterConfig.start_date}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>

      {/* 禁排时段管理 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-600" />
            禁排时段管理
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportBlockedSlots()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              导出禁排时段
            </button>
            <button
              onClick={() => setShowAddBlockedSlot(true)}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              添加禁排时段
            </button>
          </div>
        </div>

        {/* 添加禁排时段表单 */}
        {showAddBlockedSlot && (
          <div className="mb-6 p-4 bg-orange-50 rounded-lg border border-orange-200">
            <h3 className="font-medium text-orange-900 mb-4">{isEditing ? '编辑禁排时段' : '添加新的禁排时段'}</h3>

            {/* 类型选择 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">禁排类型</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="blockedType"
                    checked={newBlockedSlot.type === 'recurring'}
                    onChange={() => setNewBlockedSlot(prev => ({ ...prev, type: 'recurring' }))}
                    className="text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm">每周循环</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="blockedType"
                    checked={newBlockedSlot.type === 'specific'}
                    onChange={() => setNewBlockedSlot(prev => ({ ...prev, type: 'specific' }))}
                    className="text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm">特定周次/日期</span>
                </label>
              </div>
            </div>

            {/* 班级选择 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Users className="w-4 h-4 inline mr-1" />
                关联班级（可选，不选为全局）
              </label>
              <div className="border border-gray-300 rounded-lg p-3 bg-white max-h-40 overflow-y-auto">
                {classes.length === 0 ? (
                  <div className="text-gray-500 text-sm text-center py-4">暂无班级数据</div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="select-all-classes"
                        checked={newBlockedSlot.class_associations?.length === classes.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewBlockedSlot(prev => ({
                              ...prev,
                              class_associations: classes.map(c => ({ id: c.id, name: c.class_name }))
                            }));
                          } else {
                            setNewBlockedSlot(prev => ({ ...prev, class_associations: [] }));
                          }
                        }}
                        className="text-purple-600 focus:ring-purple-500 rounded"
                      />
                      <label htmlFor="select-all-classes" className="ml-2 text-sm font-medium text-gray-700">
                        全选/取消全选
                      </label>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {classes.map((classItem) => {
                        const isSelected = newBlockedSlot.class_associations?.some(
                          assoc => assoc.id === classItem.id
                        ) || false;
                        return (
                          <label
                            key={classItem.id}
                            className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const current = newBlockedSlot.class_associations || [];
                                const updated = e.target.checked
                                  ? [...current, { id: classItem.id, name: classItem.class_name }]
                                  : current.filter(assoc => assoc.id !== classItem.id);
                                setNewBlockedSlot(prev => ({ ...prev, class_associations: updated }));
                              }}
                              className="text-purple-600 focus:ring-purple-500 rounded"
                            />
                            <span className="text-sm text-gray-700">{classItem.class_name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                选择关联的班级，不选择表示该禁排时段对所有班级生效
              </p>
            </div>

            {newBlockedSlot.type === 'recurring' ? (
              // 每周循环模式
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">星期</label>
                  <select
                    value={newBlockedSlot.day_of_week}
                    onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, day_of_week: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {WEEK_DAYS.map(day => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">开始节次</label>
                  <select
                    value={newBlockedSlot.start_period}
                    onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, start_period: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {PERIOD_CONFIG.map(p => (
                      <option key={p.period} value={p.period}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">结束节次</label>
                  <select
                    value={newBlockedSlot.end_period}
                    onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, end_period: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    {PERIOD_CONFIG.filter(p => p.period >= (newBlockedSlot.start_period || 1)).map(p => (
                      <option key={p.period} value={p.period}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">禁排原因</label>
                  <input
                    type="text"
                    placeholder="如：教师培训、会议等"
                    value={newBlockedSlot.reason || ''}
                    onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, reason: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            ) : (
              // 特定周次/日期模式
              <div className="space-y-4">
                {/* 特定周次选择 - 时间网格样式 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    选择周次和时间（可多选）
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <div className="border border-gray-300 rounded-lg p-4 bg-white max-h-80 overflow-y-auto">
                    {/* 星期表头 */}
                    <div className="grid grid-cols-8 gap-1 mb-2">
                      <div className="col-span-1 flex items-center justify-center py-2 bg-gray-100 rounded-md text-xs font-medium">
                        周次\星期
                      </div>
                      {WEEK_DAYS.map(day => (
                        <div key={day.value} className="flex items-center justify-center py-2 bg-gray-100 rounded-md text-xs font-medium">
                          {day.label}
                        </div>
                      ))}
                    </div>
                    
                    {/* 时间网格 */}
                    {Array.from({ length: semesterConfig.total_weeks }, (_, weekIndex) => weekIndex + 1).map(week => (
                      <div key={week} className="mb-2">
                        {/* 周次标签 */}
                        <div className="flex items-center justify-center py-2 bg-gray-50 rounded-md text-xs font-medium mb-1">
                          第{week}周
                        </div>
                        
                        {/* 每天的时间格子 */}
                        <div className="grid grid-cols-8 gap-1">
                          <div className="col-span-1 flex items-center justify-center py-1 text-xs text-gray-500">
                            {newBlockedSlot.start_period || 5}-{newBlockedSlot.end_period || 8}节
                          </div>
                          {WEEK_DAYS.map(day => {
                            // 检查是否已选择该周+天的组合
                            const isSelected = newBlockedSlot.specific_week_days?.some(
                              swd => swd.week === week && swd.day === day.value
                            );
                            return (
                              <div
                                key={day.value}
                                className={`flex items-center justify-center py-2 rounded-md transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-orange-100 text-orange-700 border border-orange-300'
                                    : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                                }`}
                                onClick={() => {
                                  const current = newBlockedSlot.specific_week_days || [];
                                  const updated = isSelected
                                    ? current.filter(swd => !(swd.week === week && swd.day === day.value))
                                    : [...current, { week, day: day.value }].sort((a, b) => {
                                        if (a.week !== b.week) return a.week - b.week;
                                        return a.day - b.day;
                                      });
                                  setNewBlockedSlot(prev => ({ ...prev, specific_week_days: updated }));
                                }}
                              >
                                {isSelected && (
                                  <Check className="w-4 h-4" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">点击选择特定周次的时间，如"第7周 周一、周三"</p>
                </div>

                {/* 节次选择 - 全局设置 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">开始节次</label>
                    <select
                      value={newBlockedSlot.start_period || 5}
                      onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, start_period: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    >
                      {PERIOD_CONFIG.map(p => (
                        <option key={p.period} value={p.period}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">结束节次</label>
                    <select
                      value={newBlockedSlot.end_period || 8}
                      onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, end_period: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    >
                      {PERIOD_CONFIG.filter(p => p.period >= (newBlockedSlot.start_period || 5)).map(p => (
                        <option key={p.period} value={p.period}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 或日期范围 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">或日期范围（整段禁排）</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={newBlockedSlot.start_date || ''}
                      onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, start_date: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      placeholder="开始日期"
                    />
                    <input
                      type="date"
                      value={newBlockedSlot.end_date || ''}
                      onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, end_date: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      placeholder="结束日期"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">如选择日期范围，则整段时间禁止排课</p>
                </div>

                {/* 禁排原因 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">禁排原因</label>
                  <input
                    type="text"
                    placeholder="如：期末考试、国庆放假、学校活动等"
                    value={newBlockedSlot.reason || ''}
                    onChange={(e) => setNewBlockedSlot(prev => ({ ...prev, reason: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddBlockedSlot(false);
                  setNewBlockedSlot({
                    type: 'recurring',
                    day_of_week: 1,
                    start_period: 5,
                    end_period: 8,
                    reason: '',
                    specific_week_days: [],
                    class_associations: [],
                  });
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={addBlockedSlot}
                disabled={saving}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {saving ? (isEditing ? '更新中...' : '添加中...') : (isEditing ? '更新' : '添加')}
              </button>
            </div>
          </div>
        )}

        {/* 禁排时段列表 */}
        {blockedSlots.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            暂无禁排时段配置
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200">
              <thead>
                <tr className="bg-gray-50">
                  <th className="py-2 px-4 border-b text-left text-sm font-medium text-gray-700">课程名称</th>
                  <th className="py-2 px-4 border-b text-left text-sm font-medium text-gray-700">班级</th>
                  <th className="py-2 px-4 border-b text-left text-sm font-medium text-gray-700">周次</th>
                  <th className="py-2 px-4 border-b text-left text-sm font-medium text-gray-700">星期</th>
                  <th className="py-2 px-4 border-b text-left text-sm font-medium text-gray-700">节次</th>
                  <th className="py-2 px-4 border-b text-left text-sm font-medium text-gray-700">禁排原因</th>
                  <th className="py-2 px-4 border-b text-left text-sm font-medium text-gray-700">优先级</th>
                  <th className="py-2 px-4 border-b text-left text-sm font-medium text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody>
                {blockedSlots.flatMap((slot) => {
                  // 根据用户要求设置固定值
                  const courseName = '无';
                  // 禁排原因使用设置中的具体数据
                  const blockedReason = slot.reason || '无';
                  
                  // 生成班级信息
                  let className = '所有班级';
                  if (slot.class_associations && slot.class_associations.length > 0) {
                    // 如果有关联班级，显示具体的班级号
                    className = slot.class_associations.map(c => c.name).join('、');
                  }
                  
                  // 计算日期对应的周次（以周一为一周的第一天）
                  const calculateWeekNumber = (dateString: string): number => {
                    const startDateStr = semesterConfig.start_date || '2026-02-23';
                    const startDate = new Date(startDateStr);
                    const targetDate = new Date(dateString);
                    
                    if (isNaN(startDate.getTime()) || isNaN(targetDate.getTime())) {
                      return 1;
                    }
                    
                    // 获取某日期所在周的周一
                    const getMonday = (date: Date): Date => {
                      const d = new Date(date);
                      const day = d.getDay();
                      // getDay() 返回 0-6，其中 0 是星期日
                      // 周一为一周的第一天：周日(0)属于上一周，周一(1)到周日(0)为一周
                      const diff = day === 0 ? -6 : 1 - day;
                      d.setDate(d.getDate() + diff);
                      return d;
                    };
                    
                    const startMonday = getMonday(startDate);
                    const targetMonday = getMonday(targetDate);
                    
                    const timeDiff = targetMonday.getTime() - startMonday.getTime();
                    const weekDiff = Math.floor(timeDiff / (1000 * 3600 * 24 * 7)) + 1;
                    
                    return Math.max(1, weekDiff);
                  };

                  // 生成星期
                  let day = '未知';
                  if (slot.type === 'recurring') {
                    day = WEEK_DAYS.find(d => d.value === slot.day_of_week)?.label || '未知';
                  } else if (slot.specific_week_days && slot.specific_week_days.length > 0) {
                    const days = slot.specific_week_days.map((wd: any) => {
                      return WEEK_DAYS.find(d => d.value === wd.day)?.label || '未知';
                    });
                    day = [...new Set(days)].join('、');
                  } else if (slot.type === 'specific' && slot.start_date && slot.end_date) {
                    const startDate = new Date(slot.start_date);
                    const endDate = new Date(slot.end_date);
                    const daySet = new Set<string>();
                    
                    const currentDate = new Date(startDate);
                    while (currentDate <= endDate) {
                      const dayIndex = currentDate.getDay();
                      const adjustedDayIndex = dayIndex === 0 ? 7 : dayIndex;
                      const dayLabel = WEEK_DAYS.find(d => d.value === adjustedDayIndex)?.label || '未知';
                      daySet.add(dayLabel);
                      
                      currentDate.setDate(currentDate.getDate() + 1);
                    }
                    
                    day = Array.from(daySet).join('、');
                  } else if (slot.type === 'specific') {
                    day = '全周';
                  }
                  
                  // 生成节次
                  const periods = slot.start_period && slot.end_period ? `${slot.start_period}-${slot.end_period}节` : '';
                  
                  // 优先级
                  const priority = '高优先级';
                  
                  // 处理日期范围跨周的情况
                  if (slot.type === 'specific' && slot.start_date && slot.end_date) {
                    const startDate = new Date(slot.start_date);
                    const endDate = new Date(slot.end_date);
                    const weekDayMap = new Map<string, Set<string>>();
                    
                    // 遍历日期范围内的所有日期，计算每个日期对应的周次和星期几
                    const currentDate = new Date(startDate);
                    while (currentDate <= endDate) {
                      const dateStr = currentDate.toISOString().split('T')[0];
                      const week = calculateWeekNumber(dateStr);
                      const weekKey = `${week}周`;
                      
                      const dayIndex = currentDate.getDay();
                      // getDay() 返回 0-6，其中 0 是星期日，1-6 是周一到周六
                      // 而 WEEK_DAYS 是 1-7，其中 1 是周一，7 是周日
                      const adjustedDayIndex = dayIndex === 0 ? 7 : dayIndex;
                      const dayLabel = WEEK_DAYS.find(d => d.value === adjustedDayIndex)?.label || '未知';
                      
                      // 将星期几添加到对应周次的集合中
                      if (!weekDayMap.has(weekKey)) {
                        weekDayMap.set(weekKey, new Set<string>());
                      }
                      weekDayMap.get(weekKey)?.add(dayLabel);
                      
                      // 移动到下一天
                      currentDate.setDate(currentDate.getDate() + 1);
                    }
                    
                    // 为每个不同的（周次，星期几）组合生成单独的行
                    const rows = [];
                    let index = 0;
                    weekDayMap.forEach((daySet, weekRange) => {
                      const days = Array.from(daySet);
                      days.forEach(dayLabel => {
                        rows.push(
                          <tr key={`${slot.id}-${weekRange}-${index++}`} className="hover:bg-gray-50">
                            <td className="py-2 px-4 border-b">
                              {courseName}
                            </td>
                            <td className="py-2 px-4 border-b">
                              {className}
                            </td>
                            <td className="py-2 px-4 border-b">
                              {weekRange}
                            </td>
                            <td className="py-2 px-4 border-b">
                              {dayLabel}
                            </td>
                            <td className="py-2 px-4 border-b">
                              {periods}
                            </td>
                            <td className="py-2 px-4 border-b">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {blockedReason}
                              </span>
                            </td>
                            <td className="py-2 px-4 border-b">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                {priority}
                              </span>
                            </td>
                            <td className="py-2 px-4 border-b">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleEditBlockedSlot(slot)}
                                  className="p-1 text-blue-500 hover:bg-blue-100 rounded transition-colors"
                                  title="编辑"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => deleteBlockedSlot(slot.id)}
                                  className="p-1 text-red-500 hover:bg-red-100 rounded transition-colors"
                                  title="删除"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    });
                    
                    return rows;
                  } else {
                    let weekRange = '1-17周';
                    if (slot.type === 'specific') {
                      if (slot.weeks) {
                        weekRange = slot.weeks;
                      } else if (slot.week_number) {
                        weekRange = `${slot.week_number}周`;
                      } else if (slot.specific_week_days && slot.specific_week_days.length > 0) {
                        const weeks = [...new Set(slot.specific_week_days.map((wd: any) => wd.week))];
                        if (weeks.length === 1) {
                          weekRange = `${weeks[0]}周`;
                        } else {
                          weekRange = `${Math.min(...weeks)}-${Math.max(...weeks)}周`;
                        }
                      }
                    }
                    
                    // 非日期范围或不跨周的情况
                    return (
                      <tr key={slot.id} className="hover:bg-gray-50">
                        <td className="py-2 px-4 border-b">
                          {courseName}
                        </td>
                        <td className="py-2 px-4 border-b">
                          {className}
                        </td>
                        <td className="py-2 px-4 border-b">
                          {weekRange}
                        </td>
                        <td className="py-2 px-4 border-b">
                          {day}
                        </td>
                        <td className="py-2 px-4 border-b">
                          {periods}
                        </td>
                        <td className="py-2 px-4 border-b">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {blockedReason}
                          </span>
                        </td>
                        <td className="py-2 px-4 border-b">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            {priority}
                          </span>
                        </td>
                        <td className="py-2 px-4 border-b">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleEditBlockedSlot(slot)}
                              className="p-1 text-blue-500 hover:bg-blue-100 rounded transition-colors"
                              title="编辑"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteBlockedSlot(slot.id)}
                              className="p-1 text-red-500 hover:bg-red-100 rounded transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                })}              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
