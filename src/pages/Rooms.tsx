import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { teacherService, roomService } from '../services';
import { excelUtils, exportUtils } from '../utils/excel';
import { Upload, Download, Search, FileSpreadsheet, Building, User, Link2, Music2, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Teacher, Room } from '../types';
import { FACULTIES, getFacultyDisplayName, getFacultyColumnName } from '../types';

// 教研室配置
const FACULTY_CONFIG = [
  { faculty_name: '钢琴专业', faculty_code: 'PIANO', column_name: '钢琴琴房' },
  { faculty_name: '声乐专业', faculty_code: 'VOCAL', column_name: '声乐琴房' },
  { faculty_name: '器乐专业', faculty_code: 'INSTRUMENT', column_name: '器乐琴房' },
];

// 大教室配置
const LARGE_CLASSROOM_CONFIG = {
  faculty_code: 'LARGE_CLASSROOM',
  faculty_name: '大教室',
  column_name: '大教室',
};

interface TeacherRoomMapping {
  teacher: Teacher;
  rooms: Array<{ room: Room | null; faculty_code: string; faculty_name: string }>;
}

interface EditRoomState {
  teacherId: string;
  teacherName: string;
  facultyCode: string;
  facultyName: string;
  currentRoomId: string;
  currentRoomName: string;
}

export default function Rooms() {
  const { teacher: currentTeacher } = useAuth();
  const [mappings, setMappings] = useState<TeacherRoomMapping[]>([]);
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editState, setEditState] = useState<EditRoomState | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [importMode, setImportMode] = useState<'update' | 'overwrite'>('update');
  const [activeTab, setActiveTab] = useState<'teacher-rooms' | 'large-classrooms'>('teacher-rooms');
  const [largeClassrooms, setLargeClassrooms] = useState<Room[]>([]);
  const [selectedLargeClassroom, setSelectedLargeClassroom] = useState<Room | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [mappingsData, roomsData] = await Promise.all([
          teacherService.getTeacherRoomMappings(),
          roomService.getAll(),
        ]);
        setMappings(mappingsData);
        setAllRooms(roomsData);
        // 过滤大教室数据
        setLargeClassrooms(roomsData.filter(r => r.room_type === '大教室'));
      } catch (error) {
        console.error('获取数据失败:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadFile(file);
    setUploading(true);
    setUploadProgress('正在解析文件...');

    try {
      const data = await excelUtils.readFile(file);
      setUploadProgress(`正在导入...`);

      // 调试信息：显示导入的原始数据

      // 检查是否包含大教室数据
      const hasLargeClassroomData = data.some((row: any) => row['大教室'] && row['大教室'].trim() !== '');

      // 解析新格式的Excel（多列格式）
      const mappedData = data.map((row: any) => ({
        teacherIdentifier: row['教师'] || row['教师姓名'] || row['姓名'],
        pianoRoom: row['钢琴琴房'] || row['钢琴'],
        vocalRoom: row['声乐琴房'] || row['声乐'],
        instrumentRoom: row['器乐琴房'] || row['器乐'],
        largeClassroom: row['大教室'],
        largeClassroomCapacity: row['大教室容量'],
      }));
      
      // 调试信息：显示映射后的数据

      // 过滤掉无效条目
      const validMappedData = mappedData.filter((entry: any) => 
        entry.teacherIdentifier && entry.teacherIdentifier.trim() !== ''
      );
      
      // 调试信息：显示过滤后的有效数据

      const result = await teacherService.importTeacherRoomsByFaculty(validMappedData, importMode);

      const modeText = importMode === 'overwrite' ? '覆盖模式' : '更新模式';
      const skipped = (result as any).skipped || 0;
      const updatedIdentifiers = (result as any).updatedIdentifiers || [];
      if (result.errors.length > 0) {
        setUploadProgress(`导入完成：成功 ${result.success} 条，跳过 ${skipped} 条，失败 ${result.failed} 条`);
      } else {
        const updatedText = updatedIdentifiers.length > 0 ? `；更新名单：${updatedIdentifiers.join('、')}` : '';
        setUploadProgress(`${modeText}：更新 ${result.success} 位，跳过 ${skipped} 位教师${updatedText}`);
      }

      // 刷新数据
      const [mappingsData, roomsData] = await Promise.all([
        teacherService.getTeacherRoomMappings(),
        roomService.getAll(),
      ]);
      setMappings(mappingsData);
      setAllRooms(roomsData);
      // 更新大教室数据
      setLargeClassrooms(roomsData.filter(r => r.room_type === '大教室'));

      // 如果导入了大教室数据，自动切换到大教室管理标签页
      if (hasLargeClassroomData) {
        setActiveTab('large-classrooms');
      }

      setTimeout(() => {
        setUploadFile(null);
        setUploading(false);
      }, 2000);
    } catch (error) {
      console.error('导入失败:', error);
      setUploadProgress(`导入失败: ${error instanceof Error ? error.message : '请检查文件格式'}`);
      setUploading(false);
    }
  };

  const handleExport = () => {
    const exportData = mappings.map(m => {
      const row: Record<string, string> = {
        '教师姓名': m.teacher.name || m.teacher.full_name || '',
        '教师工号': m.teacher.teacher_id || '',
        '教研室': m.teacher.faculty_name || '',
      };

      // 每个专业一列
      for (const fc of FACULTY_CONFIG) {
        const roomInfo = m.rooms.find(r => r.faculty_code === fc.faculty_code);
        row[fc.column_name] = roomInfo?.room?.room_name || '';
      }



      return row;
    });
    exportUtils.exportToExcel(exportData, '教师教室关联表');
  };

  const handleOpenEditModal = (mapping: TeacherRoomMapping, facultyCode: string, facultyName: string) => {
    const roomInfo = mapping.rooms.find(r => r.faculty_code === facultyCode);
    setEditState({
      teacherId: mapping.teacher.id,
      teacherName: mapping.teacher.name || mapping.teacher.full_name || '',
      facultyCode,
      facultyName,
      currentRoomId: roomInfo?.room?.id || '',
      currentRoomName: roomInfo?.room?.room_name || '',
    });
    setSelectedRoomId(roomInfo?.room?.id || '');
    setNewRoomName('');
    setShowModal(true);
  };

  const handleSaveRoom = async () => {
    if (!editState) return;

    try {
      let roomId = selectedRoomId;

      // 如果选择了"创建新琴房"或"创建新大教室"
      if (selectedRoomId === 'NEW' && newRoomName.trim()) {
        const isLargeClassroom = editState.facultyCode === LARGE_CLASSROOM_CONFIG.faculty_code;
        const normalizedName = newRoomName.trim();
        const targetRoomType = isLargeClassroom ? '大教室' : '琴房';
        const existingRoom = allRooms.find(r =>
          r.room_name.trim() === normalizedName &&
          r.room_type === targetRoomType &&
          (isLargeClassroom ? true : r.faculty_code === editState.facultyCode)
        );

        if (existingRoom) {
          roomId = existingRoom.id;
        } else {
          const newRoom = await roomService.create({
            teacher_id: isLargeClassroom ? '' : editState.teacherId, // 大教室不绑定特定教师
            room_name: normalizedName,
            room_type: targetRoomType,
            capacity: isLargeClassroom ? 50 : 1, // 大教室容量更大
            faculty_code: editState.facultyCode,
          });
          roomId = newRoom.id;
        }
      }

      // 如果清空了选择
      if (selectedRoomId === '') {
        await teacherService.clearTeacherRoomByFaculty(editState.teacherId, editState.facultyCode);
      } else if (roomId) {
        await teacherService.updateTeacherRoomByFaculty(editState.teacherId, editState.facultyCode, roomId);
      }

      // 刷新数据
      const [mappingsData, roomsData] = await Promise.all([
        teacherService.getTeacherRoomMappings(),
        roomService.getAll(),
      ]);
      setMappings(mappingsData);
      setAllRooms(roomsData);
      // 更新大教室数据
      setLargeClassrooms(roomsData.filter(r => r.room_type === '大教室'));

      setShowModal(false);
      setEditState(null);
      setSelectedRoomId('');
      setNewRoomName('');
    } catch (error) {
      console.error('保存失败:', error);
    }
  };

  const handleRemoveRoom = async (mapping: TeacherRoomMapping, facultyCode: string) => {
    const teacherName = mapping.teacher.name || mapping.teacher.full_name || '';
    const facultyName = FACULTY_CONFIG.find(f => f.faculty_code === facultyCode)?.faculty_name || facultyCode;

    if (!confirm(`确定要解除 "${teacherName}" 的${facultyName}琴房关联吗？`)) return;

    try {
      await teacherService.clearTeacherRoomByFaculty(mapping.teacher.id, facultyCode);

      // 刷新数据
      const [mappingsData, roomsData] = await Promise.all([
        teacherService.getTeacherRoomMappings(),
        roomService.getAll(),
      ]);
      setMappings(mappingsData);
      setAllRooms(roomsData);
      // 更新大教室数据
      setLargeClassrooms(roomsData.filter(r => r.room_type === '大教室'));
    } catch (error) {
      console.error('解除关联失败:', error);
    }
  };

  // 根据专业代码获取可用琴房列表
  const getAvailableRooms = (facultyCode: string) => {
    const filteredRooms = facultyCode === LARGE_CLASSROOM_CONFIG.faculty_code
      ? allRooms.filter(r => r.room_type === '大教室')
      : allRooms.filter(r => {
      // 如果琴房没有专业代码，显示在钢琴琴房列表中
      if (!r.faculty_code) return facultyCode === 'PIANO';
      return r.faculty_code === facultyCode;
    });

    // 历史数据可能存在同名重复记录，下拉框按名称去重，避免重复选项
    const uniqueByName = new Map<string, Room>();
    for (const room of filteredRooms) {
      const key = room.room_name.trim();
      if (!uniqueByName.has(key)) {
        uniqueByName.set(key, room);
      }
    }
    return Array.from(uniqueByName.values());
  };

  // 筛选后的琴房列表
  const getFilteredRooms = () => {
    return allRooms.filter(r => r.room_type === '琴房');
  };

  const filteredMappings = mappings.filter(m => {
    const teacherName = m.teacher.name || m.teacher.full_name || '';
    const searchLower = searchTerm.toLowerCase();
    return teacherName.toLowerCase().includes(searchLower);
  });

  // 按工号排序
  const sortedMappings = [...filteredMappings].sort((a, b) => {
    const idA = a.teacher.teacher_id || '';
    const idB = b.teacher.teacher_id || '';
    return idA.localeCompare(idB, undefined, { numeric: true });
  });

  // 分页后的教师列表
  const paginatedMappings = sortedMappings.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // 计算总页数
  const totalPages = Math.ceil(filteredMappings.length / pageSize);

  // 当搜索条件变化时，重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

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
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Building className="w-6 h-6 text-purple-600" />
          教室管理
        </h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-sm">
            <Download className="w-4 h-4" />
            导出
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary flex items-center gap-1 px-3 py-1.5 text-sm"
            disabled={uploading}
          >
            <Upload className="w-4 h-4" />
            {uploading ? '导入中...' : '导入'}
          </button>
        </div>
      </div>

      {/* 搜索区域 - 紧凑布局 */}
      <div className="card mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索教师姓名..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 whitespace-nowrap">导入模式</span>
            <select
              value={importMode}
              onChange={(e) => setImportMode(e.target.value as 'update' | 'overwrite')}
              className="input h-10 py-2 min-w-[120px]"
              disabled={uploading}
            >
              <option value="update">更新</option>
              <option value="overwrite">覆盖</option>
            </select>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
        {uploadFile && (
          <div className="mt-3 p-2 bg-purple-50 rounded-lg">
            <span className="text-sm text-purple-600">{uploadProgress}</span>
          </div>
        )}
        <div className="mt-2 text-xs text-gray-500">
          更新：仅更新导入文件中有值的教师-教室关系；覆盖：先清空该教师现有关联，再按文件重建。
        </div>
      </div>

      {/* 标签页切换 */}
      <div className="card mb-4">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('teacher-rooms')}
            className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'teacher-rooms' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            教师-教室关联
          </button>
          <button
            onClick={() => setActiveTab('large-classrooms')}
            className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${activeTab === 'large-classrooms' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            大教室管理
          </button>
        </div>
      </div>

      {/* 教师-教室关联标签页 */}
      {activeTab === 'teacher-rooms' && (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th rowSpan={2} className="align-middle w-16">序号</th>
                  <th rowSpan={2} className="align-middle">教师</th>
                  <th rowSpan={2} className="align-middle">教研室</th>
                  <th colSpan={3} className="text-center bg-purple-50">琴房</th>
                  <th rowSpan={2} className="align-middle">操作</th>
                </tr>
                <tr>
                  <th className="bg-purple-50">钢琴琴房</th>
                  <th className="bg-purple-50">声乐琴房</th>
                  <th className="bg-purple-50">器乐琴房</th>
                </tr>
              </thead>
              <tbody>
                {paginatedMappings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-gray-500">
                      暂无教师-教室关联数据
                    </td>
                  </tr>
                ) : (
                  paginatedMappings.map((mapping, index) => (
                    <tr key={mapping.teacher.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-gray-100 transition-colors duration-200 border-b border-gray-200`}>
                      <td className="py-3 px-4">
                        <span className="text-gray-600 font-medium">
                          {((currentPage - 1) * pageSize) + index + 1}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <div>
                            <div className="font-medium">
                              {mapping.teacher.name || mapping.teacher.full_name || '未知教师'}
                            </div>
                            {mapping.teacher.teacher_id && (
                              <div className="text-xs text-gray-500">
                                工号: {mapping.teacher.teacher_id}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {(() => {
                          const facultyCode = mapping.teacher.faculty_id || mapping.teacher.faculty_code;
                          const facultyName = mapping.teacher.faculty_name || '';
                          // 根据 faculty_name 推断 faculty_code
                          let inferredCode = facultyCode;
                          if (!inferredCode && facultyName) {
                            if (facultyName.includes('钢琴')) inferredCode = 'PIANO';
                            else if (facultyName.includes('声乐')) inferredCode = 'VOCAL';
                            else if (facultyName.includes('理论')) inferredCode = 'THEORY';
                            else if (facultyName.includes('器乐')) inferredCode = 'INSTRUMENT';
                          }
                          return (
                            <span className={`badge ${inferredCode === 'PIANO' ? 'badge-info' : inferredCode === 'VOCAL' ? 'badge-success' : inferredCode === 'THEORY' ? 'badge-purple' : 'badge-warning'}`}>
                              {facultyName || '未设置'}
                            </span>
                          );
                        })()}
                      </td>
                      {/* 钢琴琴房 */}
                      <td className="py-3 px-4">
                        {renderRoomCell(mapping, 'PIANO', '钢琴琴房')}
                      </td>
                      {/* 声乐琴房 */}
                      <td className="py-3 px-4">
                        {renderRoomCell(mapping, 'VOCAL', '声乐琴房')}
                      </td>
                      {/* 器乐琴房 */}
                      <td className="py-3 px-4">
                        {renderRoomCell(mapping, 'INSTRUMENT', '器乐琴房')}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => handleOpenEditModal(mapping, 'PIANO', '钢琴')}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                          title="设置钢琴琴房"
                        >
                          <Music2 className="w-4 h-4" />
                        </button>
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
                  className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
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
              显示 {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredMappings.length)} / {filteredMappings.length} 条记录
            </span>
          </div>
        </div>
      )}

      {/* 大教室管理标签页 */}
      {activeTab === 'large-classrooms' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4 px-4">
            <h3 className="font-medium text-gray-900">大教室列表</h3>
            <button
              onClick={() => {
                setEditState({
                  teacherId: '',
                  teacherName: '',
                  facultyCode: LARGE_CLASSROOM_CONFIG.faculty_code,
                  facultyName: LARGE_CLASSROOM_CONFIG.faculty_name,
                  currentRoomId: '',
                  currentRoomName: '',
                });
                setSelectedRoomId('NEW');
                setNewRoomName('');
                setShowModal(true);
              }}
              className="btn-primary text-sm"
            >
              <Plus className="w-4 h-4 mr-1" />
              添加大教室
            </button>
          </div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">序号</th>
                  <th>大教室名称</th>
                  <th>容量</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {largeClassrooms.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-gray-500">
                      <Building className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                      <p className="text-sm">暂无大教室数据</p>
                      <p className="text-xs text-gray-400 mt-1">点击上方"添加大教室"按钮创建大教室</p>
                    </td>
                  </tr>
                ) : (
                  largeClassrooms.map((room, index) => (
                    <tr key={room.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-gray-100 transition-colors duration-200 border-b border-gray-200`}>
                      <td className="py-4 px-4">
                        <span className="text-gray-600 font-medium">
                          {index + 1}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <Building className="w-5 h-5 text-blue-500" />
                          <div>
                            <div className="font-medium text-gray-900">{room.room_name}</div>
                            <div className="text-xs text-gray-500">ID: {room.id.slice(0, 8)}...</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="badge badge-info px-3 py-1">{room.capacity}人</span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="badge badge-success px-3 py-1">空闲</span>
                      </td>
                      <td className="py-4 px-4">
                        <button
                          onClick={() => {
                            setEditState({
                              teacherId: '',
                              teacherName: '',
                              facultyCode: LARGE_CLASSROOM_CONFIG.faculty_code,
                              facultyName: LARGE_CLASSROOM_CONFIG.faculty_name,
                              currentRoomId: room.id,
                              currentRoomName: room.room_name,
                            });
                            setSelectedRoomId(room.id);
                            setNewRoomName('');
                            setShowModal(true);
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-200"
                          title="编辑大教室"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}



      {/* 编辑琴房弹窗 */}
      {showModal && editState && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 animate-slide-up">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <Building className="w-5 h-5 text-purple-600" />
              设置{editState.facultyName}琴房
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">教师</label>
                <div className="input bg-gray-50">
                  {editState.teacherName}
                </div>
              </div>

              <div>
                <label className="label">选择{editState.facultyName}琴房</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="input"
                >
                  <option value="">不分配琴房</option>
                  {getAvailableRooms(editState.facultyCode).map(room => (
                    <option key={room.id} value={room.id}>
                      {room.room_name}
                    </option>
                  ))}
                  <option value="NEW">+ 创建新琴房...</option>
                </select>
              </div>

              {selectedRoomId === 'NEW' && (
                <div>
                  <label className="label">新琴房名称</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="如：301琴房"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                  />
                </div>
              )}

              {editState.currentRoomName && selectedRoomId !== '' && (
                <div className="text-sm text-gray-500">
                  当前已分配：{editState.currentRoomName}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditState(null);
                    setSelectedRoomId('');
                    setNewRoomName('');
                  }}
                  className="flex-1 btn-secondary"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveRoom}
                  className="flex-1 btn-primary"
                  disabled={selectedRoomId === 'NEW' && !newRoomName.trim()}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // 渲染琴房单元格
  function renderRoomCell(mapping: TeacherRoomMapping, facultyCode: string, facultyName: string) {
    const roomInfo = mapping.rooms.find(r => r.faculty_code === facultyCode);
    const room = roomInfo?.room;

    if (room) {
      return (
        <div className="flex items-center gap-2">
          <Building className="w-4 h-4 text-purple-500" />
          <span className="font-medium">{room.room_name}</span>
          <button
            onClick={() => handleRemoveRoom(mapping, facultyCode)}
            className="p-1 text-red-500 hover:bg-red-50 rounded"
            title="解除关联"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      );
    }
    return <span className="text-gray-400">-</span>;
  }

  // 渲染大教室单元格
  function renderLargeClassroomCell(mapping: TeacherRoomMapping) {
    const roomInfo = mapping.rooms.find(r => r.faculty_code === LARGE_CLASSROOM_CONFIG.faculty_code);
    const room = roomInfo?.room;

    if (room) {
      return (
        <div className="flex items-center gap-2">
          <Building className="w-4 h-4 text-blue-500" />
          <span className="font-medium">{room.room_name}</span>
          <button
            onClick={() => handleRemoveRoom(mapping, LARGE_CLASSROOM_CONFIG.faculty_code)}
            className="p-1 text-red-500 hover:bg-red-50 rounded"
            title="解除关联"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      );
    }
    return <span className="text-gray-400">-</span>;
  }
}
