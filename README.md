# UMAGrab

在 Polymarket 事件页面上实时显示 UMA Oracle 结算状态的 Chrome 插件。

打开任意 Polymarket 事件页面，UMAGrab 自动获取该事件下所有市场，并在浮窗中展示它们在 UMA Oracle 上的结算进度。

## 功能

- **自动识别** — 访问任意 `polymarket.com/event/*` 页面时自动弹出浮窗
- **UMA 状态** — 显示每个市场的 Oracle 状态：`Requested`（等待提议）、`Proposed`（已提议）、`Disputed`（被质疑）、`Settled`（已结算）
- **市场编号** — 每个市场显示 `#market_id`
- **快捷链接** — 每个市场两个按钮：
  - **tero** — 跳转到 [tero.market/uma](https://tero.market/uma) 定位到该市场的展开详情
  - **uma** — 跳转到 [oracle.uma.xyz](https://oracle.uma.xyz) 对应的链上交易记录
- **双向悬浮高亮** — 鼠标移入 Polymarket 页面上的市场卡片，浮窗内对应条目高亮并自动滚动；反过来鼠标移入浮窗条目，页面上对应卡片也会高亮
- **SPA 兼容** — 监听 Polymarket 单页应用的路由变化，切换页面时自动更新

## 界面示例

每个市场行：

```
#1712295  WTI原油（WTI）在4月是否会达到（高）$140？
          REQUESTED                        [tero] [uma]
```

顶部汇总：

```
Requested: 8  |  Proposed: 3  |  Settled: 3  |  Total: 14
```

## 数据来源

1. **Gamma API** (`gamma-api.polymarket.com`) — 获取当前事件下的所有市场列表
2. **tero.market UMA API** (`tero.market/uma/api`) — 查询已索引的 UMA Oracle 数据（三级回退策略：event_slug → siblings → 逐个搜索）

无需 API Key，所有数据均为公开数据。

## 安装

1. Clone 本仓库或下载 ZIP
2. Chrome 打开 `chrome://extensions/`
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择项目文件夹
5. 访问任意 Polymarket 事件页面，浮窗自动出现

## 文件说明

| 文件 | 说明 |
|------|------|
| `manifest.json` | Chrome 扩展 Manifest V3 配置 |
| `content.js` | 核心逻辑：事件检测、API 调用、面板渲染、悬浮联动 |
| `style.css` | 浅色主题面板样式 |
| `icon48.png` | 扩展图标 (48px) |
| `icon128.png` | 扩展图标 (128px) |

## 悬浮联动原理

Polymarket 使用 Radix accordion 渲染市场卡片，并在卡片上覆盖了一层绝对定位的 overlay div 拦截鼠标事件。UMAGrab 的解决方案：

1. 通过选择器 `div[data-orientation="vertical"].group.cursor-pointer` 获取所有市场卡片
2. 按 **DOM 顺序** 与 Gamma API 返回的市场列表一一对应（经验证顺序完全一致）
3. 使用 `mousemove` + 边界矩形碰撞检测代替被 overlay 拦截的 `mouseenter`

## License

MIT
