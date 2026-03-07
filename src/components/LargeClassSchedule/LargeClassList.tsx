import React from 'react';
import { BookOpen, Download, Filter, X } from 'lucide-react';
import type { LargeClassEntry } from '../../types';
import * as XLSX from 'xlsx';
import { useAuth } from '../../hooks/useAuth';

interface LargeClassListProps {
  largeClassEntries: LargeClassEntry[];
  loading?: boolean;
}

export default function LargeClassList({ largeClassEntries, loading = false }: LargeClassListProps) {
  const { isAdmin } = useAuth();

  // 过滤无效记录
  const filteredEntries = largeClassEntries.filter(entry => {
    return entry.course_name && entry.class_name && entry.day_of_week && entry.period_start && entry.period_end;
  });

  // 按课程名称、班级、周次范围、星期分组
  const groupedEntries = filteredEntries.reduce((groups, entry) => {
    // 获取周次范围，默认为'全学期'
    const weekRange = entry.week_range || '全学期';
    
    // 生成分组键：课程名称-班级-周次范围-星期
    const key = `${entry.course_name}-${entry.class_name}-${weekRange}-${entry.day_of_week}`;
    
    if (!groups[key]) {
      groups[key] = {
        course_name: entry.course_name,
        class_name: entry.class_name,
        teacher_name: entry.teacher_name || '未知教师',
        location: entry.location || '未知教室',
        day_of_week: entry.day_of_week,
        week_range: weekRange,
        periods: [] as number[] // 收集所有节次
      };
    }
    
    // 收集节次（只添加开始节次，因为我们要合并连续的节次）
    groups[key].periods.push(entry.period_start);
    // 如果是范围节次，也添加结束节次
    if (entry.period_end > entry.period_start) {
      groups[key].periods.push(entry.period_end);
    }
    
    return groups;
  }, {} as Record<string, {
    course_name: string;
    class_name: string;
    teacher_name: string;
    location: string;
    day_of_week: number;
    week_range: string;
    periods: number[];
  }>);

  // 转换为数组并添加序号
  const groupedList = Object.values(groupedEntries).map((group, index) => ({
    ...group,
    index: index + 1
  }));

  // 合并周次范围
  const mergeWeekRanges = (ranges: string[]): string => {
    const allWeeks = new Set<number>();
    ranges.forEach(range => {
      const parts = range.split(/[,，;；]/).map(p => p.trim()).filter(p => p);
      parts.forEach(part => {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(n => parseInt(n)).filter(n => !isNaN(n));
          if (start && end) {
            for (let i = start; i <= end; i++) {
              allWeeks.add(i);
            }
          }
        } else {
          const week = parseInt(part);
          if (!isNaN(week)) {
            allWeeks.add(week);
          }
        }
      });
    });

    const sortedWeeks = Array.from(allWeeks).sort((a, b) => a - b);
    if (sortedWeeks.length === 0) return '全学期';
    
    // 合并连续的周次
    const mergedRanges: string[] = [];
    let start = sortedWeeks[0];
    let end = sortedWeeks[0];

    for (let i = 1; i < sortedWeeks.length; i++) {
      if (sortedWeeks[i] === end + 1) {
        end = sortedWeeks[i];
      } else {
        mergedRanges.push(start === end ? `${start}` : `${start}-${end}`);
        start = end = sortedWeeks[i];
      }
    }
    mergedRanges.push(start === end ? `${start}` : `${start}-${end}`);

    return mergedRanges.join('、');
  };

  // 合并节次为范围
  const mergePeriods = (periods: number[]): string => {
    // 去重并排序
    const uniquePeriods = Array.from(new Set(periods)).sort((a, b) => a - b);
    if (uniquePeriods.length === 0) return '未知';
    
    // 合并连续的节次
    const mergedRanges: string[] = [];
    let start = uniquePeriods[0];
    let end = uniquePeriods[0];

    for (let i = 1; i < uniquePeriods.length; i++) {
      if (uniquePeriods[i] === end + 1) {
        end = uniquePeriods[i];
      } else {
        mergedRanges.push(start === end ? `${start}` : `${start}-${end}`);
        start = end = uniquePeriods[i];
      }
    }
    mergedRanges.push(start === end ? `${start}` : `${start}-${end}`);

    return mergedRanges.join('、');
  };

  // 导出通适大课列表为Excel
  const handleExport = () => {
    const data = groupedList.map(group => {
      // 合并节次为范围
      const mergedPeriods = mergePeriods(group.periods);
      
      // 转换星期为中文
      const dayMap = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      const dayOfWeek = dayMap[group.day_of_week] || '未知';

      return {
        序号: group.index,
        课程名称: group.course_name,
        班级: group.class_name,
        周次: group.week_range,
        星期: dayOfWeek,
        节次: mergedPeriods,
        教室: group.location,
        教师: group.teacher_name
      };
    });
    
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, '通适大课列表', '通适大课列表');
    XLSX.writeFile(workbook, '通适大课列表.xlsx');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          <BookOpen className="inline-block w-5 h-5 text-purple-600 mr-2" />
          通适大课列表
        </h2>
        {/* 只有管理员显示导出按钮 */}
        {isAdmin && (
          <button
            onClick={handleExport}
            disabled={groupedList.length === 0}
            className="btn-secondary flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            导出Excel
          </button>
        )}
      </div>
      
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="px-4 py-2 text-left font-medium text-gray-500">序号</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">课程名称</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">班级</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">周次</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">星期</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">节次</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">教室</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">教师</th>
            </tr>
          </thead>
          <tbody>
            {groupedList.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  暂无通适大课数据，请先导入大课表
                </td>
              </tr>
            ) : (
              groupedList.map(group => {
                // 合并节次为范围
                const mergedPeriods = mergePeriods(group.periods);
                
                // 转换星期为中文
                const dayMap = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
                const dayOfWeek = dayMap[group.day_of_week] || '未知';
                
                return (
                  <tr key={`${group.course_name}-${group.class_name}-${group.week_range}-${group.day_of_week}`} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{group.index}</td>
                    <td className="px-4 py-3 text-gray-800 font-medium">{group.course_name}</td>
                    <td className="px-4 py-3 text-gray-600">{group.class_name}</td>
                    <td className="px-4 py-3 text-gray-600">{group.week_range}</td>
                    <td className="px-4 py-3 text-gray-600">{dayOfWeek}</td>
                    <td className="px-4 py-3 text-gray-600">{mergedPeriods}</td>
                    <td className="px-4 py-3 text-gray-600">{group.location}</td>
                    <td className="px-4 py-3 text-gray-600">{group.teacher_name}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
