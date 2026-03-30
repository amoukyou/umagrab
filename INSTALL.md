# UMAGrab 安装指南

## 方式一：从源码安装（推荐）

### 1. 下载代码

```bash
git clone https://github.com/amoukyou/umagrab.git
```

或者直接在 GitHub 页面点击 **Code → Download ZIP**，解压到任意目录。

### 2. 加载到 Chrome

1. 打开 Chrome，地址栏输入 `chrome://extensions/` 回车
2. 右上角打开 **开发者模式** 开关
3. 点击左上角 **加载已解压的扩展程序**
4. 选择刚才 clone/解压的 `umagrab` 文件夹
5. 看到 UMAGrab 出现在扩展列表中，安装完成

### 3. 使用

打开任意 Polymarket 事件页面，例如：

```
https://polymarket.com/event/what-price-will-wti-hit-in-april-2026
```

右上角会自动弹出 UMAGrab 浮窗，显示该事件下所有市场的 UMA Oracle 状态。

## 方式二：其他 Chromium 浏览器

UMAGrab 兼容所有基于 Chromium 的浏览器：

| 浏览器 | 扩展管理页面 |
|--------|-------------|
| Chrome | `chrome://extensions/` |
| Edge | `edge://extensions/` |
| Brave | `brave://extensions/` |
| Arc | `arc://extensions/` |

操作步骤相同：开启开发者模式 → 加载已解压的扩展程序。

## 更新

```bash
cd umagrab
git pull
```

然后回到 `chrome://extensions/`，点击 UMAGrab 卡片上的 **刷新** 按钮（圆形箭头图标）。

## 卸载

在 `chrome://extensions/` 页面找到 UMAGrab，点击 **移除** 即可。

## 常见问题

**Q: 浮窗没有出现？**

- 确认你在 `polymarket.com/event/xxx` 页面上（不是首页或其他页面）
- 检查插件是否已启用（`chrome://extensions/` 中开关为蓝色）
- 按 F12 打开开发者工具，Console 中搜索 `UMA Extension` 查看日志

**Q: 显示 "Not in UMA"？**

说明该市场尚未进入 UMA Oracle 结算流程。通常是事件还未到期，Polymarket 还没有发起结算请求。

**Q: 悬浮高亮不工作？**

- 等待面板标题旁显示 `X/Y linked`（X > 0 表示成功关联）
- 如果显示 `0/Y linked`，可能是 Polymarket 页面还在加载，稍等几秒后点击面板刷新按钮重试

**Q: 数据不准确？**

点击浮窗左上角的刷新按钮重新获取最新数据。tero.market 的数据每 3 分钟同步一次。
