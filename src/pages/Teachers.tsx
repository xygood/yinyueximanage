/**
 * 教师管理页面
 * 管理员管理所有教师信息、教学资质和教研室分配
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { teacherService, studentService, courseService, roomService, scheduleService, STORAGE_KEYS, operationLogService } from '../services';
import * as XLSX from 'xlsx';
import {
  FACULTIES,
  INSTRUMENTS,
  getFacultyCodeForInstrument,
  type Teacher,
  type TeacherQualification
} from '../types';
import {
  Users,
  Search,
  Plus,
  Edit2,
  Trash2,
  Award,
  CheckCircle,
  XCircle,
  Calendar,
  BookOpen,
  Building,
  Download,
  Upload,
  FileSpreadsheet,
  X,
  Key,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

/** Excel/CSV 中的工号单元格可能是数字，统一为数字字符串 */
function normalizeWorkIdCell(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.round(raw));
  }
  let s = String(raw).trim().replace(/\s+/g, '');
  if (/^\d+\.\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  return s;
}

async function readTeacherImportWorkbook(file: File): Promise<XLSX.WorkBook> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const text = await file.text();
    return XLSX.read(text, { type: 'string', raw: false });
  }
  const buf = await file.arrayBuffer();
  try {
    return XLSX.read(buf, { type: 'array', cellDates: true });
  } catch (e1) {
    try {
      const u8 = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < u8.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)) as unknown as number[]);
      }
      return XLSX.read(binary, { type: 'binary', cellDates: true });
    } catch {
      const msg = e1 instanceof Error ? e1.message : String(e1);
      throw new Error(`无法解析 Excel：${msg}`);
    }
  }
}

function workbookToTeacherRows(workbook: XLSX.WorkBook): any[] {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as any[];
    if (!rows.length) continue;
    const keys = Object.keys(rows[0]).map(k => String(k).trim()).filter(Boolean);
    const hasId = keys.some(k => k === '工号' || k === 'teacher_id' || k.includes('工号'));
    const hasName = keys.some(k => k === '姓名' || k === 'name' || k === '教师姓名' || k.includes('姓名'));
    if (hasId && hasName) return rows;
  }
  throw new Error('未找到有效工作表：请确认表头含「工号」与「姓名」（可下载页面上的导入模板）');
}

const Teachers: React.FC = () => {
  const { teacher: currentUser } = useAuth();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFaculty, setFilterFaculty] = useState<string>('all');
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10); // 默认每页10条

  // 导入相关状态
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number; details: Array<{ name: string; teacher_id: string; password: string }> } | null>(null);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupProgress, setBackupProgress] = useState('');
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  // 表单状态
  const [formData, setFormData] = useState<Partial<Teacher>>({
    teacher_id: '',
    name: '',
    faculty_id: 'PIANO',
    position: '讲师',
    can_teach_instruments: []
  });

  // 加载教师数据
  useEffect(() => {
    const loadTeachers = async () => {
      setLoading(true);
      try {
        const data = await teacherService.getAll();
        setTeachers(data);
      } catch (error) {
        console.error('加载教师数据失败:', error);
      }
      setLoading(false);
    };
    loadTeachers();
  }, []);

  // 过滤教师
  const filteredTeachers = (teachers || []).filter(teacher => {
    if (!teacher) return false;
    
    // 搜索过滤
    const matchesSearch = teacher.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          teacher.teacher_id?.includes(searchTerm.toLowerCase()) ||
                          teacher.faculty_name?.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;

    // 教研室过滤
    if (filterFaculty !== 'all' && teacher.faculty_id !== filterFaculty) return false;

    return true;
  });

  // 按工号排序
  const sortedTeachers = [...filteredTeachers].sort((a, b) => {
    const idA = a.teacher_id || '';
    const idB = b.teacher_id || '';
    return idA.localeCompare(idB, undefined, { numeric: true });
  });

  // 分页后的教师列表
  const paginatedTeachers = (sortedTeachers || []).slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // 计算总页数
  const totalPages = Math.ceil((filteredTeachers || []).length / pageSize);

  // 当搜索或筛选条件变化时，重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterFaculty]);

  // 获取教研室的乐器列表
  const getFacultyInstruments = (facultyId: string): string[] => {
    return INSTRUMENTS.filter(inst => getFacultyCodeForInstrument(inst) === facultyId);
  };

  // 打开新增教师弹窗
  const handleOpenAddModal = () => {
    setIsEditing(false);
    setFormData({
      teacher_id: '',
      name: '',
      faculty_id: 'PIANO',
      position: '讲师',
      can_teach_instruments: [],
      max_students_per_class: 5,
      remarks: ''
    });
    setShowModal(true);
  };

  // 打开编辑教师弹窗
  const handleOpenEditModal = (teacher: Teacher) => {
    setIsEditing(true);
    setSelectedTeacher(teacher);
    setFormData({
      ...teacher,
      can_teach_instruments: [...(teacher.can_teach_instruments || [])],
      remarks: teacher.remarks || ''
    });
    setShowModal(true);
  };

  // 保存教师
  const handleSave = async () => {
    try {
      // 准备教师数据（与导入功能保持一致）
      const teacherData = {
        teacher_id: formData.teacher_id,
        name: formData.name,
        faculty_id: formData.faculty_id,
        faculty_name: FACULTIES.find(f => f.faculty_code === formData.faculty_id)?.faculty_name || '',
        position: formData.position,
        hire_date: new Date().toISOString().split('T')[0],
        qualifications: [],
        can_teach_instruments: formData.can_teach_instruments || [],
        max_students_per_class: 5,
        remarks: formData.remarks || ''
      };

      if (isEditing && selectedTeacher) {
        // 更新现有教师
        await teacherService.update(selectedTeacher.id, teacherData);
      } else {
        // 新增教师
        await teacherService.create(teacherData);
      }

      // 重新加载数据
      const data = await teacherService.getAll();
      setTeachers(data);
      setShowModal(false);
    } catch (error) {
      console.error('保存教师失败:', error);
      window.alert(
        error instanceof Error ? error.message : '保存失败，请重试或查看控制台错误信息'
      );
    }
  };

  // 删除教师
  const handleDelete = async (teacherId: string) => {
    if (!confirm('确定要删除该教师吗？相关排课数据也会被删除。')) return;
    try {
      await teacherService.delete(teacherId);
      setTeachers(prev => prev.filter(t => t.id !== teacherId));
    } catch (error) {
      console.error('删除教师失败:', error);
    }
  };

  // 生成默认初始密码
  const generateDefaultPassword = (teacherId: string): string => {
    // 特殊处理管理员账号
    if (teacherId === '110') {
      return '135';
    }
    // 普通教师账号使用工号+123的格式
    return `${teacherId}123`;
  };

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadFile(file);
    setUploading(true);
    setUploadProgress('正在解析文件...');
    setImportResult(null);

    try {
      const workbook = await readTeacherImportWorkbook(file);
      const jsonData = workbookToTeacherRows(workbook);

      setUploadProgress(`正在导入 ${jsonData.length} 位教师...`);

      const details: Array<{ name: string; teacher_id: string; password: string }> = [];
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const failedRecords: Array<{ row: number; reason: string }> = [];

      let teachersSnapshot = await teacherService.getAll();

      // 教研室代码映射
      const facultyCodeMap: Record<string, string> = {
        '钢琴教研室': 'PIANO',
        '声乐教研室': 'VOCAL',
        '器乐教研室': 'INSTRUMENT',
        '理论教研室': 'THEORY',
        'PIANO': 'PIANO',
        'VOCAL': 'VOCAL',
        'INSTRUMENT': 'INSTRUMENT',
        'THEORY': 'THEORY'
      };

      // 职称映射
      const positionMap: Record<string, string> = {
        '教授': '教授',
        '副教授': '副教授',
        '讲师': '讲师',
        '助教': '助教'
      };

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        setUploadProgress(`正在导入 ${i + 1}/${jsonData.length} 条记录...`);

        const rawId =
          row['工号'] ?? row['teacher_id'] ?? row['Teacher ID'] ?? row['职工号'];
        const rawName =
          row['姓名'] ?? row['name'] ?? row['教师姓名'] ?? row['Name'];

        // 验证必填字段
        if (rawId === undefined || rawId === '' || rawName === undefined || rawName === '') {
          skipped++;
          failedRecords.push({ row: i + 2, reason: '工号或姓名为空' });
          continue;
        }

        const teacherId = normalizeWorkIdCell(rawId);
        const name = String(rawName).trim();

        // 验证工号格式（常见学校工号 6～12 位数字）
        if (!/^\d{6,12}$/.test(teacherId)) {
          skipped++;
          failedRecords.push({ row: i + 2, reason: '工号格式错误（需为 6～12 位数字）' });
          continue;
        }

        // 获取教研室
        const facultyName = row['教研室'] || '钢琴教研室';
        const facultyId = facultyCodeMap[facultyName] || 'PIANO';

        // 获取职称
        const position = positionMap[row['职称']] || '讲师';

        // 处理可教课程
        let canTeachCourses: string[] = [];
        if (row['可教课程']) {
          const coursesStr = String(row['可教课程']);
          // 支持逗号、分号或顿号分隔
          canTeachCourses = coursesStr.split(/[，,、;；]/).map(s => s.trim()).filter(s => s);

          // 验证课程是否为有效专业
          let validCourses = canTeachCourses.filter(inst => INSTRUMENTS.includes(inst as any));
          
          // 特殊处理音乐理论课程
          const musicTheoryCourses = canTeachCourses.filter(inst => inst.includes('音乐理论') || inst.includes('理论'));
          if (musicTheoryCourses.length > 0) {
            validCourses = [...validCourses, '音乐理论'];
            // 去重
            validCourses = [...new Set(validCourses)];
          }
          
          // 如果验证后的有效课程为空，使用默认值
          if (validCourses.length === 0) {
            if (facultyId === 'PIANO') {
              canTeachCourses = ['钢琴'];
            } else if (facultyId === 'VOCAL') {
              canTeachCourses = ['声乐'];
            } else if (facultyId === 'INSTRUMENT') {
              canTeachCourses = ['古筝', '竹笛', '葫芦丝', '古琴', '小提琴', '萨克斯', '双排键'].filter(inst => 
                // 基于真实数据，如果有真实教师数据中使用过的课程，就使用那个
                (inst === '古筝' || inst === '竹笛' || inst === '葫芦丝' || inst === '古琴' || inst === '小提琴' || inst === '萨克斯' || inst === '双排键')
              );
            } else if (facultyId === 'THEORY') {
              canTeachCourses = ['音乐理论'];
            }
          } else {
            canTeachCourses = validCourses;
          }
        }

        // 准备教师数据
        const teacherData = {
          teacher_id: teacherId,
          name: name,
          faculty_id: facultyId,
          faculty_name: FACULTIES.find(f => f.faculty_code === facultyId)?.faculty_name || facultyName,
          position: position,
          hire_date: new Date().toISOString().split('T')[0],
          qualifications: [],
          can_teach_instruments: canTeachCourses,
          max_students_per_class: 5,
          remarks: row['备注'] || ''
        };

        // 先检查是否已存在（仅精确匹配工号/主键，避免姓名模糊匹配误更新）
        const existing = teachersSnapshot.find(
          t =>
            String(t.teacher_id).trim() === teacherId ||
            String(t.id).trim() === teacherId
        );
        if (existing) {
          const updatedTeacher = await teacherService.update(existing.id, teacherData);
          updated++;
          const idx = teachersSnapshot.findIndex(
            t => t.id === existing.id || t.teacher_id === existing.teacher_id
          );
          if (idx >= 0) teachersSnapshot[idx] = updatedTeacher;
        } else {
          const createdTeacher = await teacherService.create(teacherData);
          created++;
          teachersSnapshot.push(createdTeacher);
        }

        // 生成默认密码（仅对新创建的教师）
        const defaultPassword = generateDefaultPassword(teacherId);
        details.push({ name: name, teacher_id: teacherId, password: defaultPassword });

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      setUploadProgress(`导入完成！新增 ${created} 位，更新 ${updated} 位，跳过 ${skipped} 位`);
      setImportResult({
        success: created + updated,
        failed: skipped,
        details
      });

      // 记录操作日志（失败不影响导入结果）
      try {
        await operationLogService.log(
          '导入教师数据',
          'system',
          `导入教师数据：新增 ${created} 位，更新 ${updated} 位，跳过 ${skipped} 位`,
          undefined,
          undefined
        );
      } catch (logErr) {
        console.warn('记录操作日志失败:', logErr);
      }

      // 重新加载教师数据
      const teachersData = await teacherService.getAll();
      setTeachers(teachersData);

      setTimeout(() => {
        setUploading(false);
      }, 1500);
    } catch (error) {
      console.error('导入失败:', error);
      const hint =
        error instanceof Error
          ? error.message
          : '请确认文件为 .xlsx / .xls / .csv，或下载模板后勿修改表头行';
      setUploadProgress(`导入失败：${hint}`);
      setUploading(false);
    }
  };

  // 下载导入模板
  const handleDownloadTemplate = () => {
    const template = [
      {
        '工号': '120150375',
        '姓名': '示例教师',
        '教研室': '钢琴教研室',
        '职称': '讲师',
        '可教课程': '钢琴',
        '备注': '教师备注信息'
      }
    ];

    // 导出为 Excel
    const worksheet = XLSX.utils.json_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '教师信息');
    XLSX.writeFile(workbook, '教师导入模板.xlsx');
  };

  // 关闭导入弹窗
  const handleCloseImportModal = () => {
    setShowImportModal(false);
    setUploadFile(null);
    setUploadProgress('');
    setImportResult(null);
    setUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 导出所有数据备份
  const handleExportBackup = async () => {
    try {
      setBackupProgress('正在导出教师数据...');
      const teachers = await teacherService.getAll();

      setBackupProgress('正在导出学生数据...');
      const students = await studentService.getAll();

      setBackupProgress('正在导出课程数据...');
      const courses = await courseService.getAll();

      setBackupProgress('正在导出教室数据...');
      const rooms = await roomService.getAll();

      // 获取原始排课数据
      const scheduledClasses = JSON.parse(localStorage.getItem(STORAGE_KEYS.SCHEDULED_CLASSES) || '[]');
      const conflicts = JSON.parse(localStorage.getItem(STORAGE_KEYS.CONFLICTS) || '[]');
      const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');

      const backupData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        data: {
          teachers,
          students,
          courses,
          rooms,
          scheduled_classes: scheduledClasses,
          conflicts,
          users
        }
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `音乐排课系统备份_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupProgress('导出完成！');
      setTimeout(() => setBackupProgress(''), 2000);
    } catch (error) {
      console.error('导出失败:', error);
      setBackupProgress('导出失败，请重试');
    }
  };

  // 处理恢复备份文件
  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBackupProgress('正在读取备份文件...');
    setRestoreResult(null);

    try {
      const text = await file.text();
      const backupData = JSON.parse(text);

      // 验证备份格式
      if (!backupData.version || !backupData.data) {
        setRestoreResult({ success: false, message: '无效的备份文件格式' });
        return;
      }

      setBackupProgress('正在恢复教师数据...');
      if (backupData.data.teachers) {
        localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(backupData.data.teachers));
      }

      setBackupProgress('正在恢复学生数据...');
      if (backupData.data.students) {
        localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(backupData.data.students));
      }

      setBackupProgress('正在恢复课程数据...');
      if (backupData.data.courses) {
        localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(backupData.data.courses));
      }

      setBackupProgress('正在恢复教室数据...');
      if (backupData.data.rooms) {
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(backupData.data.rooms));
      }

      if (backupData.data.scheduled_classes) {
        localStorage.setItem(STORAGE_KEYS.SCHEDULED_CLASSES, JSON.stringify(backupData.data.scheduled_classes));
      }

      if (backupData.data.conflicts) {
        localStorage.setItem(STORAGE_KEYS.CONFLICTS, JSON.stringify(backupData.data.conflicts));
      }

      if (backupData.data.users) {
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(backupData.data.users));
      }

      // 重新加载教师数据
      const teachersData = await teacherService.getAll();
      setTeachers(teachersData);

      setRestoreResult({ success: true, message: '数据恢复成功！请刷新页面查看数据。' });
      setBackupProgress('');
    } catch (error) {
      console.error('恢复失败:', error);
      setRestoreResult({ success: false, message: '恢复失败，请检查备份文件是否正确' });
      setBackupProgress('');
    }

    if (backupFileInputRef.current) {
      backupFileInputRef.current.value = '';
    }
  };

  // 关闭备份弹窗
  const handleCloseBackupModal = () => {
    setShowBackupModal(false);
    setBackupProgress('');
    setRestoreResult(null);
  };

  // 切换课程选择
  const handleInstrumentToggle = (instrument: string) => {
    const current = formData.can_teach_instruments || [];
    if (Array.isArray(current) && current.includes(instrument)) {
      setFormData({ ...formData, can_teach_instruments: current.filter(i => i !== instrument) });
    } else {
      setFormData({ ...formData, can_teach_instruments: [...(current || []), instrument] });
    }
  };

  // 获取教师统计（基于真实数据）
  const getTeacherStats = () => {
    const teachersList = teachers || [];
    const stats = {
      total: teachersList.length,
      piano: teachersList.filter(t => t && t.faculty_id === 'PIANO').length,
      vocal: teachersList.filter(t => t && t.faculty_id === 'VOCAL').length,
      instrument: teachersList.filter(t => t && t.faculty_id === 'INSTRUMENT').length,
      theory: teachersList.filter(t => t && t.faculty_id === 'THEORY').length,
      pianoTeachers: teachersList.filter(t => t && t.faculty_id === 'PIANO' && t.can_teach_instruments).map(t => t.can_teach_instruments).filter(Boolean).flat(),
      vocalTeachers: teachersList.filter(t => t && t.faculty_id === 'VOCAL' && t.can_teach_instruments).map(t => t.can_teach_instruments).filter(Boolean).flat(),
      instrumentTeachers: teachersList.filter(t => t && t.faculty_id === 'INSTRUMENT' && t.can_teach_instruments).map(t => t.can_teach_instruments).filter(Boolean).flat(),
      theoryTeachers: teachersList.filter(t => t && t.faculty_id === 'THEORY' && t.can_teach_instruments).map(t => t.can_teach_instruments).filter(Boolean).flat(),
    };
    
    // 按专业统计
    const instrumentCounts: Record<string, number> = {};
    teachersList.forEach(teacher => {
      if (teacher && teacher.can_teach_instruments && Array.isArray(teacher.can_teach_instruments)) {
        teacher.can_teach_instruments.forEach(instrument => {
          if (instrument) {
            instrumentCounts[instrument] = (instrumentCounts[instrument] || 0) + 1;
          }
        });
      }
    });
    
    return { ...stats, instrumentCounts };
  };

  const stats = getTeacherStats();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* 顶部操作栏 - 紧凑布局 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-purple-600" />
            教师管理
          </h1>
          {/* 紧凑统计信息 */}
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>总数: <strong className="text-blue-600">{stats.total}</strong></span>
            <span>钢琴: <strong className="text-blue-600">{stats.piano}</strong></span>
            <span>声乐: <strong className="text-green-600">{stats.vocal}</strong></span>
            <span>器乐: <strong className="text-orange-600">{stats.instrument}</strong></span>
            <span>理论: <strong className="text-purple-600">{stats.theory}</strong></span>
            {stats.instrumentCounts && Object.entries(stats.instrumentCounts).filter(([instrument]) => instrument !== '音乐理论').map(([instrument, count]) => (
              <span key={instrument} className="text-gray-500">
                {instrument}: <strong className="text-gray-700">{count}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleDownloadTemplate} className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-sm">
            <Download className="w-4 h-4" />
            模板
          </button>
          <button onClick={() => setShowImportModal(true)} className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-sm">
            <Upload className="w-4 h-4" />
            导入
          </button>
          <button onClick={() => setShowBackupModal(true)} className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-sm">
            <Download className="w-4 h-4" />
            备份
          </button>
          <button onClick={handleOpenAddModal} className="btn-primary flex items-center gap-1 px-3 py-1.5 text-sm">
            <Plus className="w-4 h-4" />
            添加
          </button>
        </div>
      </div>

      {/* 筛选和搜索 - 紧凑布局 */}
      <div className="card mb-4">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索教师姓名、工号、教研室..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-10"
            />
          </div>
          <select
            value={filterFaculty}
            onChange={(e) => setFilterFaculty(e.target.value)}
            className="input w-48"
          >
            <option value="all">全部教研室</option>
            <option value="PIANO">钢琴教研室</option>
            <option value="VOCAL">声乐教研室</option>
            <option value="INSTRUMENT">器乐教研室</option>
            <option value="THEORY">理论教研室</option>
          </select>
        </div>
      </div>

      {/* 教师列表 */}
      <div className="card">
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th className="w-16">序号</th>
                <th>工号</th>
                <th>教师姓名</th>
                <th>教研室</th>
                <th>职称</th>
                <th>可教课程</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTeachers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    暂无教师数据
                  </td>
                </tr>
              ) : (
                paginatedTeachers.map((teacher, index) => (
                  <tr key={teacher.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-gray-100 transition-colors duration-200 border-b border-gray-200`}>
                    <td className="py-4 px-4">
                      <span className="text-gray-600">
                        {((currentPage - 1) * pageSize) + index + 1}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="font-mono text-sm text-gray-600">{teacher.teacher_id}</span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white">
                          {teacher.name.charAt(0)}
                        </div>
                        <div>
                          <div className="text-gray-900">{teacher.name}</div>
                          <div className="text-sm text-gray-500">{teacher.teacher_id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`badge ${teacher.faculty_id === 'PIANO' ? 'badge-info' : teacher.faculty_id === 'VOCAL' ? 'badge-success' : teacher.faculty_id === 'THEORY' ? 'badge-purple' : 'badge-warning'}`}>
                        {teacher.faculty_name}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-sm text-gray-600">
                        {teacher.position}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-wrap gap-1">
                        {(teacher.can_teach_instruments || []).map(inst => (
                          <span key={inst} className={`px-2 py-0.5 text-xs rounded-full ${inst === '钢琴' ? 'bg-blue-100 text-blue-700' : inst === '声乐' ? 'bg-green-100 text-green-700' : inst === '音乐理论' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'}`}>
                            {inst}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-sm text-gray-600">
                        {teacher.remarks || '-'}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleOpenEditModal(teacher)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="编辑"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(teacher.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页控件 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-4 py-3 bg-gray-50 border-t border-gray-200 rounded-b-lg">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                第 {currentPage} 页，共 {totalPages} 页
              </span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value={10}>10条/页</option>
                <option value={20}>20条/页</option>
                <option value={50}>50条/页</option>
                <option value={100}>100条/页</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                title="首页"
              >
                首页
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-1 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                title="上一页"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded">
                {currentPage}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-1 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                title="下一页"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-xs border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                title="末页"
              >
                末页
              </button>
            </div>
          </div>
        )}

        {/* 显示信息 */}
        <div className="mt-3 px-4 pb-3">
          <span className="text-sm text-gray-600">
            显示 {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, (filteredTeachers || []).length)} / {(filteredTeachers || []).length} 条记录
          </span>
        </div>
      </div>

      {/* 添加/编辑教师弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl mx-4 animate-slide-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl  text-gray-900">
                {isEditing ? '编辑教师' : '添加教师'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <XCircle className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form className="space-y-6">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">工号 *</label>
                  <input
                    type="text"
                    value={formData.teacher_id || ''}
                    onChange={(e) => setFormData({ ...formData, teacher_id: e.target.value })}
                    className="input font-mono"
                    placeholder="如：120150375"
                    required
                  />
                </div>
                <div>
                  <label className="label">教师姓名 *</label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input"
                    required
                  />
                </div>
                <div>
                  <label className="label">职称</label>
                  <select
                    value={formData.position || '讲师'}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    className="input"
                  >
                    <option value="教授">教授</option>
                    <option value="副教授">副教授</option>
                    <option value="讲师">讲师</option>
                    <option value="助教">助教</option>
                  </select>
                </div>
                <div>
                  <label className="label">教研室</label>
                  <select
                    value={formData.faculty_id || 'PIANO'}
                    onChange={(e) => setFormData({ ...formData, faculty_id: e.target.value })}
                    className="input"
                  >
                    {FACULTIES.map(f => (
                      <option key={f.faculty_code} value={f.faculty_code}>{f.faculty_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 备注信息 */}
              <div>
                <label className="label">备注</label>
                <textarea
                  value={formData.remarks || ''}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  className="input min-h-[100px] resize-y"
                  placeholder="请输入教师的备注信息..."
                ></textarea>
              </div>

              {/* 可教课程 */}
              <div>
                <label className="label mb-2">可教课程 *</label>
                <div className="bg-gray-50 rounded-lg p-4 max-h-48 overflow-y-auto">
                  <div className="grid grid-cols-3 gap-2">
                    {INSTRUMENTS.map(instrument => (
                      <button
                        key={instrument}
                        type="button"
                        onClick={() => handleInstrumentToggle(instrument)}
                        className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                          formData.can_teach_instruments?.includes(instrument)
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        {formData.can_teach_instruments?.includes(instrument) ? (
                          <CheckCircle className="w-4 h-4 text-blue-500" />
                        ) : (
                          <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
                        )}
                        <span className="text-sm">{instrument}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  已选择: {formData.can_teach_instruments?.length || 0} 种课程
                </p>
              </div>



              {/* 操作按钮 */}
              <div className="flex gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 btn-secondary"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex-1 btn-primary"
                  disabled={!formData.teacher_id || !formData.name || (formData.can_teach_instruments?.length || 0) === 0}
                >
                  {isEditing ? '保存修改' : '添加教师'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 导入教师弹窗 */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4 animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl  text-gray-900">批量导入教师</h2>
              <button
                onClick={handleCloseImportModal}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <XCircle className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* 上传区域 */}
            {!importResult ? (
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-500 transition-colors">
                  <FileSpreadsheet className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                  <p className="text-gray-600 mb-2">点击或拖拽上传教师Excel文件</p>
                  <p className="text-sm text-gray-500 mb-4">支持 .xlsx、.xls、.csv 格式</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="btn-primary"
                  >
                    {uploading ? '导入中...' : '选择文件'}
                  </button>
                </div>

                {uploadFile && (
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-5 h-5 text-green-600" />
                        <span className="text-sm text-gray-700">{uploadFile.name}</span>
                      </div>
                      <span className="text-sm text-blue-600">{uploadProgress}</span>
                    </div>
                    {uploading && (
                      <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: '50%' }} />
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800 font-medium mb-2 flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    导入说明
                  </p>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    <li>• 请在Excel中填写教师工号（如：120150375）</li>
                    <li>• 初始密码规则：工号 + 123456</li>
                    <li>• 示例：工号 120150375，初始密码 120150375123456</li>
                    <li>• 教师首次登录后请自行修改密码</li>
                  </ul>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleDownloadTemplate}
                    className="flex-1 btn-secondary"
                  >
                    下载模板
                  </button>
                  <button
                    onClick={handleCloseImportModal}
                    className="flex-1 btn-secondary"
                  >
                    关闭
                  </button>
                </div>
              </div>
            ) : (
              // 导入结果
              <div className="space-y-4">
                <div className="text-center py-4">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <p className="text-lg font-medium text-gray-900">导入完成</p>
                  <p className="text-sm text-gray-500 mt-1">
                    成功导入 {importResult.success} 位教师
                  </p>
                </div>

                {/* 教师凭证列表 */}
                <div className="border rounded-lg max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">姓名</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">教师编号</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">初始密码</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(importResult.details || []).map((detail, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-2">{detail?.name || '-'}</td>
                          <td className="px-4 py-2 font-mono text-blue-600">{detail?.teacher_id || '-'}</td>
                          <td className="px-4 py-2 font-mono text-purple-600">{detail?.password || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-700">
                    请及时将初始密码告知对应教师，初始密码仅显示一次
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleCloseImportModal}
                    className="flex-1 btn-primary"
                  >
                    完成
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 数据备份/恢复弹窗 */}
      {showBackupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4 animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl  text-gray-900">数据备份与恢复</h2>
              <button
                onClick={handleCloseBackupModal}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <XCircle className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-6">
              {/* 导出备份 */}
              <div className="border rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Download className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">导出备份</h3>
                    <p className="text-sm text-gray-500">将所有数据导出为JSON文件</p>
                  </div>
                </div>
                <button
                  onClick={handleExportBackup}
                  disabled={!!backupProgress}
                  className="w-full btn-primary"
                >
                  {backupProgress && backupProgress.includes('导出') ? backupProgress : '导出数据'}
                </button>
              </div>

              {/* 恢复备份 */}
              <div className="border rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <Upload className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">恢复备份</h3>
                    <p className="text-sm text-gray-500">从JSON备份文件恢复数据</p>
                  </div>
                </div>
                <input
                  ref={backupFileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleRestoreBackup}
                  className="hidden"
                />
                <button
                  onClick={() => backupFileInputRef.current?.click()}
                  disabled={!!backupProgress && backupProgress.includes('正在恢复')}
                  className="w-full btn-secondary"
                >
                  {backupProgress && backupProgress.includes('正在恢复') ? backupProgress : '选择备份文件'}
                </button>
                {backupProgress && !restoreResult && (
                  <p className="text-sm text-blue-600 mt-2 text-center">{backupProgress}</p>
                )}
              </div>

              {/* 恢复结果 */}
              {restoreResult && (
                <div className={`border rounded-lg p-4 ${restoreResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <p className={`text-sm ${restoreResult.success ? 'text-green-700' : 'text-red-700'}`}>
                    {restoreResult.message}
                  </p>
                </div>
              )}

              {/* 说明 */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800 font-medium mb-1">注意事项</p>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>• 建议定期导出备份，以防数据丢失</li>
                  <li>• 恢复备份会覆盖当前数据，请谨慎操作</li>
                  <li>• 恢复完成后请刷新页面查看数据</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleCloseBackupModal}
                  className="flex-1 btn-secondary"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Teachers;
