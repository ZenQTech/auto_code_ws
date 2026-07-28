// ============================================================
// DoctorPage - Doctor 独立访问页面
// ============================================================
// 修改记录：
//   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
// ============================================================

import React from 'react';
import { useNavigate } from 'react-router-dom';
import DoctorPanel from '../components/DoctorPanel';

const DoctorPage: React.FC = () => {
    const navigate = useNavigate();
    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center px-4 py-2 border-b border-gray-200 bg-gray-50">
                <button
                    onClick={() => navigate('/')}
                    className="px-3 py-1 text-sm text-blue-600 hover:underline"
                >
                    ← 返回主页
                </button>
                <span className="ml-3 text-sm text-gray-500">/doctor</span>
            </div>
            <div className="flex-1 overflow-hidden">
                <DoctorPanel />
            </div>
        </div>
    );
};

export default DoctorPage;
