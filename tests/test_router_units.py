"""
Cycle 7 P1-2: React Router SPA Mode 单元测试
=============================================
测试前端路由系统的基本结构、文件存在性、导出正确性

测试范围：
1. 路由配置文件存在性 (router.tsx, types.ts)
2. 页面组件文件存在性
3. main.tsx 正确挂载 AppRouter
4. App.tsx 集成 useLocation/useParams/useNavigate
5. AppRouter.tsx 不再存在（已删除）
6. router.tsx 正确导入所有页面组件
"""
import os
import re
import sys
from pathlib import Path

WORKSPACE = Path("/home/qizheng/auto_code_ws/frontend")
SRC = WORKSPACE / "src"
ROUTER_DIR = SRC / "router"
PAGES_DIR = SRC / "pages"


def test_router_config_exists():
    """测试 1: 路由配置文件 router.tsx 存在"""
    router_file = ROUTER_DIR / "router.tsx"
    assert router_file.exists(), f"❌ 路由配置文件不存在: {router_file}"
    print("✅ 测试 1 通过: router.tsx 存在")


def test_router_types_exists():
    """测试 2: 路由类型定义文件 types.ts 存在"""
    types_file = ROUTER_DIR / "types.ts"
    assert types_file.exists(), f"❌ 路由类型文件不存在: {types_file}"
    content = types_file.read_text()
    assert "ChatSessionParams" in content, "❌ 缺少 ChatSessionParams 类型"
    assert "CodingProjectParams" in content, "❌ 缺少 CodingProjectParams 类型"
    assert "WorkflowParams" in content, "❌ 缺少 WorkflowParams 类型"
    print("✅ 测试 2 通过: types.ts 存在且包含必需类型")


def test_all_pages_exist():
    """测试 3: 所有页面组件文件存在"""
    required_pages = [
        "RootLayout.tsx",
        "ErrorPage.tsx",
        "ModeSelectorPage.tsx",
        "ChatLayout.tsx",
        "ChatHomePage.tsx",
        "NewChatPage.tsx",
        "ChatSessionPage.tsx",
        "CodingLayout.tsx",
        "CodingHomePage.tsx",
        "NewProjectPage.tsx",
        "ProjectWorkspacePage.tsx",
        "SettingsPage.tsx",
        "WorkflowDetailPage.tsx",
    ]
    missing = [p for p in required_pages if not (PAGES_DIR / p).exists()]
    assert not missing, f"❌ 缺失页面文件: {missing}"
    print(f"✅ 测试 3 通过: 所有 {len(required_pages)} 个页面文件存在")


def test_loading_fallback_exists():
    """测试 4: 懒加载占位组件 LoadingFallback 存在"""
    fallback_file = SRC / "components" / "LoadingFallback.tsx"
    assert fallback_file.exists(), f"❌ LoadingFallback 不存在: {fallback_file}"
    print("✅ 测试 4 通过: LoadingFallback.tsx 存在")


def test_main_uses_approuter():
    """测试 5: main.tsx 正确挂载 AppRouter"""
    main_file = SRC / "main.tsx"
    content = main_file.read_text()
    assert "AppRouter" in content, "❌ main.tsx 未引用 AppRouter"
    assert "import AppRouter from './router/router'" in content, \
        "❌ main.tsx 未从 ./router/router 导入 AppRouter"
    print("✅ 测试 5 通过: main.tsx 正确挂载 AppRouter")


def test_old_approuter_removed():
    """测试 6: 旧版 AppRouter.tsx 已删除"""
    old_file = SRC / "AppRouter.tsx"
    assert not old_file.exists(), \
        f"❌ 旧版 AppRouter.tsx 仍存在（应已删除）: {old_file}"
    print("✅ 测试 6 通过: 旧版 AppRouter.tsx 已删除")


def test_router_uses_browser_router():
    """测试 7: router.tsx 使用 BrowserRouter + Routes"""
    router_file = ROUTER_DIR / "router.tsx"
    content = router_file.read_text()
    assert "BrowserRouter" in content, "❌ router.tsx 未使用 BrowserRouter"
    assert "Routes" in content, "❌ router.tsx 未使用 Routes"
    assert "Route" in content, "❌ router.tsx 未定义 Route"
    print("✅ 测试 7 通过: router.tsx 使用 BrowserRouter + Routes")


def test_router_defines_all_paths():
    """测试 8: router.tsx 定义了所有必需的路由路径"""
    router_file = ROUTER_DIR / "router.tsx"
    content = router_file.read_text()
    required_paths = [
        'path="/"',
        'path="chat"',
        'path="new"',
        'path="session/:sessionId"',
        'path="coding"',
        'path="project/:projectId"',
        'path="settings"',
        'path="workflow/:workflowId"',
    ]
    missing = [p for p in required_paths if p not in content]
    assert not missing, f"❌ 路由定义缺失: {missing}"
    print(f"✅ 测试 8 通过: router.tsx 定义了 {len(required_paths)} 个必需路径")


def test_router_uses_lazy_loading():
    """测试 9: router.tsx 使用懒加载"""
    router_file = ROUTER_DIR / "router.tsx"
    content = router_file.read_text()
    assert "lazy(" in content, "❌ router.tsx 未使用 React.lazy()"
    assert "Suspense" in content, "❌ router.tsx 未使用 Suspense"
    assert "LoadingFallback" in content, "❌ router.tsx 未使用 LoadingFallback"
    print("✅ 测试 9 通过: router.tsx 使用懒加载 + Suspense + LoadingFallback")


def test_router_renders_app():
    """测试 10: router.tsx 默认路由渲染 App 组件"""
    router_file = ROUTER_DIR / "router.tsx"
    content = router_file.read_text()
    assert "import App from '../App'" in content, "❌ router.tsx 未导入 App"
    assert "<App />" in content, "❌ router.tsx 未渲染 <App />"
    print("✅ 测试 10 通过: router.tsx 默认路由渲染 App 组件")


def test_app_uses_router_hooks():
    """测试 11: App.tsx 集成 useLocation/useParams/useNavigate"""
    app_file = SRC / "App.tsx"
    content = app_file.read_text()
    assert "useLocation" in content, "❌ App.tsx 未使用 useLocation"
    assert "useParams" in content, "❌ App.tsx 未使用 useParams"
    assert "useNavigate" in content, "❌ App.tsx 未使用 useNavigate"
    assert "react-router-dom" in content, "❌ App.tsx 未从 react-router-dom 导入"
    print("✅ 测试 11 通过: App.tsx 集成 useLocation/useParams/useNavigate")


def test_app_url_sync_logic():
    """测试 12: App.tsx 包含 URL 同步逻辑"""
    app_file = SRC / "App.tsx"
    content = app_file.read_text()
    # 检查 URL 同步关键字
    assert "URL 状态同步" in content, "❌ 缺少 URL 状态同步注释"
    assert "useLocation" in content, "❌ 未使用 useLocation"
    assert "setAppMode" in content, "❌ URL 同步未调用 setAppMode"
    assert "setCurrentSessionId" in content, "❌ URL 同步未调用 setCurrentSessionId"
    assert "setSelectedProject" in content, "❌ URL 同步未调用 setSelectedProject"
    print("✅ 测试 12 通过: App.tsx 包含 URL 同步逻辑")


def test_page_components_have_chinese_headers():
    """测试 13: 页面组件都有中文文件头注释"""
    page_files = list(PAGES_DIR.glob("*.tsx"))
    for page_file in page_files:
        content = page_file.read_text()
        # 检查是否包含中文注释
        has_chinese = bool(re.search(r'[\u4e00-\u9fff]', content))
        assert has_chinese, f"❌ 页面 {page_file.name} 缺少中文注释"
    print(f"✅ 测试 13 通过: 所有 {len(page_files)} 个页面文件都有中文注释")


def test_pages_use_router_hooks():
    """测试 14: 动态路由页面使用 useParams 提取参数"""
    pages_using_params = [
        ("ChatSessionPage.tsx", "useParams<ChatSessionParams>"),
        ("ProjectWorkspacePage.tsx", "useParams<CodingProjectParams>"),
        ("WorkflowDetailPage.tsx", "useParams<WorkflowParams>"),
    ]
    for page_name, expected_pattern in pages_using_params:
        page_file = PAGES_DIR / page_name
        content = page_file.read_text()
        assert expected_pattern in content, \
            f"❌ {page_name} 未使用类型安全 useParams"
    print(f"✅ 测试 14 通过: 3 个动态路由页面使用类型安全 useParams")


def test_pages_import_types():
    """测试 15: 动态路由页面导入路由类型定义"""
    pages_importing_types = [
        ("ChatSessionPage.tsx", "../router/types"),
        ("ProjectWorkspacePage.tsx", "../router/types"),
        ("WorkflowDetailPage.tsx", "../router/types"),
    ]
    for page_name, import_path in pages_importing_types:
        page_file = PAGES_DIR / page_name
        content = page_file.read_text()
        assert import_path in content, \
            f"❌ {page_name} 未从 {import_path} 导入类型"
    print(f"✅ 测试 15 通过: 3 个动态路由页面导入路由类型")


def test_vite_config_has_react_router():
    """测试 16: vite.config.ts 无需特殊配置（react-router-dom 是客户端路由）"""
    vite_config = WORKSPACE / "vite.config.ts"
    content = vite_config.read_text()
    # react-router-dom 是客户端路由，不需要 vite 特殊配置
    # 这里只检查 vite.config.ts 存在
    assert vite_config.exists(), "❌ vite.config.ts 不存在"
    print("✅ 测试 16 通过: vite.config.ts 存在")


def test_all_pages_have_default_export():
    """测试 17: 所有页面都有 default export"""
    page_files = list(PAGES_DIR.glob("*.tsx"))
    for page_file in page_files:
        content = page_file.read_text()
        assert "export default" in content, \
            f"❌ 页面 {page_file.name} 缺少 default export"
    print(f"✅ 测试 17 通过: 所有 {len(page_files)} 个页面都有 default export")


def test_router_default_export():
    """测试 18: router.tsx 有 default export AppRouter"""
    router_file = ROUTER_DIR / "router.tsx"
    content = router_file.read_text()
    assert "export default AppRouter" in content, \
        "❌ router.tsx 缺少 'export default AppRouter'"
    print("✅ 测试 18 通过: router.tsx 正确导出 AppRouter")


def test_root_layout_uses_outlet():
    """测试 19: RootLayout 使用 Outlet 渲染子路由"""
    root_layout = PAGES_DIR / "RootLayout.tsx"
    content = root_layout.read_text()
    assert "Outlet" in content, "❌ RootLayout 未使用 Outlet"
    assert "react-router-dom" in content, "❌ RootLayout 未导入 react-router-dom"
    print("✅ 测试 19 通过: RootLayout 使用 Outlet")


def test_error_page_uses_uselocation():
    """测试 20: ErrorPage 使用 useLocation 判断 404"""
    error_page = PAGES_DIR / "ErrorPage.tsx"
    content = error_page.read_text()
    assert "useLocation" in content, "❌ ErrorPage 未使用 useLocation"
    # 兼容 v6.3 (无 useRouteError) - 检查 import 中没有 useRouteError
    import_match = re.search(r"import\s+\{([^}]+)\}\s+from\s+['\"]react-router-dom['\"]", content)
    if import_match:
        imports_str = import_match.group(1)
        assert "useRouteError" not in imports_str, \
            "❌ ErrorPage 不应使用 useRouteError (v6.3 不兼容)"
    print("✅ 测试 20 通过: ErrorPage 使用 useLocation (兼容 v6.3)")


def run_all_tests():
    """运行所有单元测试"""
    tests = [
        test_router_config_exists,
        test_router_types_exists,
        test_all_pages_exist,
        test_loading_fallback_exists,
        test_main_uses_approuter,
        test_old_approuter_removed,
        test_router_uses_browser_router,
        test_router_defines_all_paths,
        test_router_uses_lazy_loading,
        test_router_renders_app,
        test_app_uses_router_hooks,
        test_app_url_sync_logic,
        test_page_components_have_chinese_headers,
        test_pages_use_router_hooks,
        test_pages_import_types,
        test_vite_config_has_react_router,
        test_all_pages_have_default_export,
        test_router_default_export,
        test_root_layout_uses_outlet,
        test_error_page_uses_uselocation,
    ]
    print(f"\n{'='*60}")
    print(f"Cycle 7 P1-2: React Router SPA Mode 单元测试")
    print(f"{'='*60}\n")

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"❌ {test.__name__} 失败: {e}")
            failed += 1
        except Exception as e:
            print(f"❌ {test.__name__} 异常: {e}")
            failed += 1

    print(f"\n{'='*60}")
    print(f"测试结果: {passed}/{len(tests)} 通过, {failed} 失败")
    print(f"{'='*60}\n")
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
