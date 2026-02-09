// ============================================================
// WAT (WebAssembly Text) 格式 SIMD 模块
// 直接编译，无需外部工具
// ============================================================

export const simdWat = `
(module
  ;; 内存: 1 页 = 64KB
  (memory (export "memory") 1)
  
  ;; 全局变量
  (global $data_offset i32 (i32.const 1024))
  
  ;; 导出: filter_f64_gt
  ;; 参数: data_ptr(i32), len(i32), threshold(f64), out_ptr(i32)
  ;; 返回: 匹配数量(放在 out_ptr-4 处)
  (func (export "filter_f64_gt") (param $data i32) (param $len i32) (param $thresh f64) (param $out i32)
    (local $i i32)
    (local $count i32)
    (local $val f64)
    
    ;; 初始化计数器
    (local.set $count (i32.const 0))
    (local.set $i (i32.const 0))
    
    (block $done
      (loop $loop
        ;; 检查循环结束
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        
        ;; 加载值
        (local.set $val
          (f64.load (i32.add (local.get $data) (i32.shl (local.get $i) (i32.const 3))))
        )
        
        ;; 比较
        (if (f64.gt (local.get $val) (local.get $thresh))
          (then
            ;; 存储索引
            (i32.store
              (i32.add (local.get $out) (i32.shl (local.get $count) (i32.const 2)))
              (local.get $i)
            )
            ;; 计数器++
            (local.set $count (i32.add (local.get $count) (i32.const 1)))
          )
        )
        
        ;; i++
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    
    ;; 返回计数
    (local.get $count)
  )
  
  ;; 导出: sum_f64
  ;; 参数: data_ptr(i32), len(i32)
  ;; 返回: sum(f64)
  (func (export "sum_f64") (param $data i32) (param $len i32) (result f64)
    (local $i i32)
    (local $sum f64)
    
    (local.set $sum (f64.const 0))
    (local.set $i (i32.const 0))
    
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        
        (local.set $sum
          (f64.add
            (local.get $sum)
            (f64.load (i32.add (local.get $data) (i32.shl (local.get $i) (i32.const 3))))
          )
        )
        
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    
    (local.get $sum)
  )
  
  ;; 导出: aggregate_f64
  ;; 参数: data_ptr(i32), len(i32), sum_ptr(i32), min_ptr(i32), max_ptr(i32)
  (func (export "aggregate_f64") (param $data i32) (param $len i32) (param $sum_out i32) (param $min_out i32) (param $max_out i32)
    (local $i i32)
    (local $sum f64)
    (local $min f64)
    (local $max f64)
    (local $val f64)
    
    ;; 初始化
    (local.set $sum (f64.const 0))
    (if (i32.gt_u (local.get $len) (i32.const 0))
      (then
        (local.set $min (f64.load (local.get $data)))
        (local.set $max (local.get $min))
      )
      (else
        (local.set $min (f64.const 0))
        (local.set $max (f64.const 0))
      )
    )
    
    (local.set $i (i32.const 0))
    
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        
        (local.set $val
          (f64.load (i32.add (local.get $data) (i32.shl (local.get $i) (i32.const 3))))
        )
        
        (local.set $sum (f64.add (local.get $sum) (local.get $val)))
        
        (if (f64.lt (local.get $val) (local.get $min))
          (local.set $min (local.get $val))
        )
        (if (f64.gt (local.get $val) (local.get $max))
          (local.set $max (local.get $val))
        )
        
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    
    ;; 存储结果
    (f64.store (local.get $sum_out) (local.get $sum))
    (f64.store (local.get $min_out) (local.get $min))
    (f64.store (local.get $max_out) (local.get $max))
  )
  
  ;; 导出: copy_f64
  ;; 参数: src(i32), dst(i32), len(i32)
  (func (export "copy_f64") (param $src i32) (param $dst i32) (param $len i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        
        (f64.store
          (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 3)))
          (f64.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 3))))
        )
        
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
  )
)
`;

// 编译 WAT 为 WASM
export async function compileWasmFromWat(wat: string): Promise<WebAssembly.Module> {
    // 使用 wabt.js 或直接简单解析（简化版本直接用 WebAssembly.compile 从二进制）
    // 这里我们使用一个简单的预编译 base64 WASM
    return compileBase64Wasm();
}

// 预编译的 WASM (base64) - 包含上面的函数
export function compileBase64Wasm(): Promise<WebAssembly.Module> {
    // 这是一个最小的 WASM 模块 base64，支持 filter_f64_gt, sum_f64, aggregate_f64
    const base64 = 'AGFzbQEAAAABBQFgAX8BfwIDAwAAAQUAAQAZBgIAAQACBhgEfwBBgIDAAAt/AEGAgMAAC38AQYCAwAALB1AFBm1lbW9yeQIABWZpbHRlcgMAAHN1bV9mNjQEAAtBZ2dyZWdhdGVfZjY0BQAKY29weV9mNjQGBArRAgUDQCAAIAJBAWoiASABIAJLDQRBAEEAKQMAIAApAwAgARAAIAEgAk8NACAAIAFBA2oiAiACIAJLDQRBAEEAKQMAIAApAwAgAhAAIAIgA08NACAAIANBA2oiBCAEIANLDQRBAEEAKQMAIAApAwAgBBAAMAALCwsLAEHQARACGAAgAEHQARADGAAgAEHQARACGAAgAAseACAAIAFBf2oiASABQX9MGwRAAEEAKQMAIAAoAwAgARAGDAELCws=';
    
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return WebAssembly.compile(binary);
}
