# 全市场存储方案对比

## ⚖️ 单文件 vs 多文件的权衡

### 单文件多产品的 **问题**

| 问题 | 影响 | 缓解方案 |
|------|------|----------|
| **并发写入困难** | 需要全局锁 | 使用 WAL + 批量写入 |
| **单点故障** | 文件损坏丢失所有数据 | 定期快照 + 备份 |
| **文件大小限制** | FAT32: 4GB, 某些系统: 16GB | 按年/月分片 |
| **扩容困难** | 新增产品需重写文件 | 预留空间 + 增量索引 |
| **冷备份慢** | 300GB 文件复制耗时 | 增量备份 (rsync) |
| **内存映射限制** | 32位系统 2-4GB | 64位系统无此问题 |

---

## 🎯 平衡方案 (推荐)

### 方案 A: 分层存储 (推荐 ⭐⭐⭐)

```
data/
├── index/                    # 索引层 (小文件)
│   └── symbols.json          # 3000个产品的元数据
│
├── daily/                    # 日级文件 (平衡)
│   ├── 2024-01-01.bin       # 当天所有产品 (3000个)
│   ├── 2024-01-02.bin
│   └── ... (365个文件/年)
│
└── archive/                  # 归档 (压缩)
    └── 2024-01.parquet      # 整月数据
```

**优势**:
- 日级文件：365个文件，同时打开无压力 ✅
- 单文件内：所有产品，顺序读取 ✅
- 易维护：按天删除/归档 ✅
- 易备份：增量备份 (只传新文件) ✅

**劣势**:
- 跨天查询需要打开多个文件
- 实现复杂度：中等

---

### 方案 B: 分组存储 (推荐 ⭐⭐)

```
data/
├── index/
│   └── symbols.json          # 分组信息
│
├── group-0/                  # 大盘蓝筹 (0-999)
│   ├── AAPL.bin
│   ├── MSFT.bin
│   └── ... (1000个文件)
│
├── group-1/                  # 中小盘 (1000-1999)
│   └── ... (1000个文件)
│
└── group-2/                  # 其他 (2000-2999)
    └── ... (1000个文件)
```

**优势**:
- 保持单产品单文件语义 ✅
- 分组并行处理 ✅
- 故障隔离 (损坏只影响1/3) ✅
- 简单：现有代码几乎不用改 ✅

**劣势**:
- 需要同时打开 3 个目录句柄
- 跨组套利需要额外处理

---

### 方案 C: 混合存储 (专业级)

```
data/
├── hot/                      # 热数据 (内存表)
│   └── today.mem
│
├── week/                     # 本周数据 (按组分)
│   ├── group-0/2024-W01.bin
│   ├── group-1/2024-W01.bin
│   └── group-2/2024-W01.bin
│
└── archive/                  # 历史 (单文件多产品)
    ├── 2024-01.bin
    ├── 2024-02.bin
    └── ...
```

**策略**:
- 今天数据：内存表 (最快)
- 本周数据：按组分 (平衡)
- 历史数据：按月合并 (省空间)

**优势**:
- 性能最优 ✅
- 存储最优 ✅
- 灵活性高 ✅

**劣势**:
- 实现复杂度高
- 需要智能调度

---

## 🏆 最终推荐

### 场景 1: 开发阶段 (你的现状)
**推荐：方案 B (分组存储)**

```typescript
// 把 3000 个产品分成 3 组
const GROUP_SIZE = 1000;

class GroupedStore {
  private groups: Map<number, Map<string, ColumnarTable>> = new Map();

  async loadGroup(groupId: number) {
    // 只加载 1000 个，不是 3000 个
    const symbols = this.getSymbolsInGroup(groupId);
    const tables = new Map();
    
    for (const symbol of symbols) {
      tables.set(symbol, await loadTable(`group-${groupId}/${symbol}.bin`));
    }
    
    this.groups.set(groupId, tables);
  }

  // 跨组查询
  queryCrossGroup(symbols: string[]) {
    // 按组分批次查询
    const byGroup = this.groupByGroup(symbols);
    
    return Promise.all(
      Array.from(byGroup.entries()).map(([groupId, syms]) =>
        this.queryGroup(groupId, syms)
      )
    );
  }
}
```

**实施成本**: 1 天
**风险**: 低
**收益**: 立即解决 3000 文件问题

---

### 场景 2: 生产环境
**推荐：方案 A (日级文件)**

```typescript
class DailyStore {
  private openFiles: Map<string, MmapManager> = new Map();
  private maxOpenFiles = 30;  // 最近30天

  query(symbols: string[], start: Date, end: Date) {
    // 确定需要打开哪些日文件
    const days = this.getDaysInRange(start, end);
    
    // LRU 缓存文件句柄
    for (const day of days) {
      if (!this.openFiles.has(day)) {
        this.openFiles.set(day, new MmapManager(`daily/${day}.bin`));
      }
    }
    
    // 清理旧文件
    this.evictOldFiles();
    
    // 查询
    return this.queryFromFiles(symbols, days);
  }
}
```

**实施成本**: 3-5 天
**风险**: 中
**收益**: 长期最优解

---

## 🤔 建议

**短期 (这周)**:
1. 使用方案 B (分组存储)
2. 把 3000 个产品分成 3 组
3. 每组 1000 个，同时打开无压力
4. 回测时按组加载

**中期 (下个月)**:
1. 实现方案 A (日级文件)
2. 迁移历史数据
3. 统一查询接口

**长期 (未来)**:
1. 评估是否需要方案 C (混合存储)
2. 根据实际性能数据决定

---

## 💡 临时方案 (今天可用)

如果你不想改存储架构，可以用这个技巧：

```typescript
// 虚拟文件系统 (内存索引)
class VirtualFileSystem {
  private index: Map<string, { file: string; offset: number; size: number }>;

  constructor() {
    // 加载索引 (小文件)
    this.index = loadJSON('data/index.json');
  }

  read(symbol: string): ArrayBuffer {
    const { file, offset, size } = this.index.get(symbol)!;
    
    // 打开大文件 (只打开一次)
    const fd = this.openFile(file);
    
    // 读取指定区块
    return fd.read(offset, size);
  }
}

// 使用
const vfs = new VirtualFileSystem();  // 打开 1 个索引文件
const aapl = vfs.read('AAPL');        // 从合并文件读取
const googl = vfs.read('GOOGL');      // 同一文件，不同偏移
```

**本质**: 单文件存储 + 内存索引
**好处**: 不改现有代码，只加一层封装

---

你倾向哪个方案？
- A: 日级文件 (重构存储层)
- B: 分组存储 (简单，立即可用)
- C: 虚拟文件系统 (过渡方案)
- D: 其他想法？
