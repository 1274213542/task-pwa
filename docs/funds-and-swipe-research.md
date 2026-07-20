# 资金池与移动端左滑调研记录

调研日期：2026-07-20。以下项目均实际阅读了核心数据模型或手势实现；本项目只借鉴结构与约束，没有复制整库代码。

## 财务模型

| 项目 | 许可证 | 阅读位置 | 本项目借鉴 | 未采用 |
| --- | --- | --- | --- | --- |
| [Actual](https://github.com/actualbudget/actual) | MIT | `packages/desktop-client/src/budget/mutations.ts`、转账辅助逻辑与分类模板上下文 | 预算用途分配与真实账户转账分离；账户间转账净影响为零 | 不引入其完整预算模板、同步协议和桌面客户端结构 |
| [Firefly III](https://github.com/firefly-iii/firefly-iii) | AGPL-3.0 | `app/Models/PiggyBank.php`、`PiggyBankEvent.php`、`UpdatePiggyBank.php` | 资金池事件关联原交易；以稳定事件 ID 保证幂等；按交易方向决定增减 | 因许可证和架构差异不复制实现，也不引入其服务器端复式账本 |
| [Money Manager Ex](https://github.com/moneymanagerex/moneymanagerex) | GPL-2.0 | 账户、交易与周期交易表模型 | 初始余额独立保存；转账明确区分转出、转入和两端金额；周期规则与实际交易实例分离 | 不复制数据库表或桌面 UI，不改变现有 IndexedDB schema |

采用结论：`Account` 继续表示钱现实存放的位置，`FundPool` 表示用途归属；资金池分配只写 `FundPoolTransfer`，真实消费只写一笔 `Transaction`，通过 `TransactionFundAllocation` 影响资金池。停用是可逆展示状态，删除只允许在余额、锁定和业务引用都为零时软删除。

## 移动端手势

| 项目 | 许可证 | 阅读位置 | 本项目借鉴 | 未采用 |
| --- | --- | --- | --- | --- |
| [use-gesture](https://github.com/pmndrs/use-gesture) | MIT | drag gesture、pointer capture、axis threshold | 先判断方向再接管横向手势；记录距离、速度和持续时间 | 不新增依赖，不引入全套手势状态机 |
| [react-swipeable](https://github.com/FormidableLabs/react-swipeable) | MIT | delta 方向锁与触摸取消逻辑 | 使用 `absX/absY` 判定横向意图，只在确定横滑后阻止默认行为 | 不采用只按固定像素提交的默认策略 |
| [Motion](https://github.com/motiondivision/motion) | MIT | `PanSession` 主指针、`pointercancel`、事件捕获 | 只跟踪主指针；支持 pointer cancel；动画从实时 transform 位置被新手势中断 | 不让页面切换或列表状态依赖 View Transitions API |
| [Vaul](https://github.com/emilkowalski/vaul) | MIT | Drawer 内部滚动与拖拽所有权、关闭阈值 | 内容滚动优先；比例与速度共同决定提交；只动画 transform/opacity | 不把 Drawer 组件直接用于列表行，也不复制 Sheet 状态逻辑 |

采用结论：轻滑揭示操作采用方向锁和可中断吸附；完整左滑同时使用行宽比例与释放速度，不依赖固定像素。仅移动前景层，操作层保持在本行后方。删除沿用现有软删除和原 ID 恢复流程。

