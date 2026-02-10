import { Scope } from 'quickjs-emscripten';
import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';

/**
 * QuickJS 内存管理工具
 * 
 * 提供便捷的 handle 管理方式，防止内存泄漏
 */

/**
 * 自动管理 QuickJS handle 的生命周期
 * 
 * 用法：
 * ```typescript
 * using scope = new QuickJSScope();
 * const handle = scope.manage(vm.newString('test'));
 * // 作用域结束时自动 dispose
 * ```
 */
export class QuickJSScope implements Disposable {
  private handles: QuickJSHandle[] = [];

  /**
   * 管理一个 handle，返回同一 handle 以便链式使用
   */
  manage<T extends QuickJSHandle>(handle: T): T {
    this.handles.push(handle);
    return handle;
  }

  /**
   * 释放所有管理的 handles
   */
  dispose(): void {
    for (const handle of this.handles) {
      try {
        handle.dispose();
      } catch (e) {
        // 忽略重复释放的错误
      }
    }
    this.handles = [];
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/**
 * 使用函数创建一个 scope，自动管理生命周期
 * 
 * 用法：
 * ```typescript
 * withScope(scope => {
 *   const handle = scope.manage(vm.newString('test'));
 *   // ... use handle
 * }); // 自动 dispose
 * ```
 */
export function withScope<T>(fn: (scope: QuickJSScope) => T): T {
  const scope = new QuickJSScope();
  try {
    return fn(scope);
  } finally {
    scope.dispose();
  }
}

/**
 * 将 JavaScript 值转换为 QuickJS handle
 * 
 * @param vm QuickJS 上下文
 * @param value JavaScript 值
 * @returns QuickJS handle（调用者负责 dispose）
 */
export function toQuickJSValue(vm: QuickJSContext, value: any): QuickJSHandle {
  if (value === null || value === undefined) {
    return vm.undefined;
  }
  
  if (typeof value === 'boolean') {
    return value ? vm.true : vm.false;
  }
  
  if (typeof value === 'number') {
    return vm.newNumber(value);
  }
  
  if (typeof value === 'string') {
    return vm.newString(value);
  }
  
  if (Array.isArray(value)) {
    const arr = vm.newArray();
    for (let i = 0; i < value.length; i++) {
      const itemHandle = toQuickJSValue(vm, value[i]);
      vm.setProp(arr, i, itemHandle);
      itemHandle.dispose();
    }
    return arr;
  }
  
  if (typeof value === 'object') {
    const obj = vm.newObject();
    for (const [key, val] of Object.entries(value)) {
      const valHandle = toQuickJSValue(vm, val);
      vm.setProp(obj, key, valHandle);
      valHandle.dispose();
    }
    return obj;
  }
  
  // 函数类型不支持直接转换
  return vm.undefined;
}

/**
 * 将 QuickJS handle 转换为 JavaScript 值
 * 
 * @param vm QuickJS 上下文
 * @param handle QuickJS handle
 * @returns JavaScript 值
 */
export function fromQuickJSValue(vm: QuickJSContext, handle: QuickJSHandle): any {
  return vm.dump(handle);
}

/**
 * 创建一个新的 object 并设置属性
 * 
 * @param vm QuickJS 上下文
 * @param props 属性字典
 * @returns Object handle（调用者负责 dispose）
 */
export function createObject(
  vm: QuickJSContext, 
  props: Record<string, any>
): QuickJSHandle {
  const obj = vm.newObject();
  
  for (const [key, value] of Object.entries(props)) {
    const valueHandle = toQuickJSValue(vm, value);
    vm.setProp(obj, key, valueHandle);
    valueHandle.dispose();
  }
  
  return obj;
}

/**
 * 创建一个新的 array
 * 
 * @param vm QuickJS 上下文
 * @param items 数组元素
 * @returns Array handle（调用者负责 dispose）
 */
export function createArray(vm: QuickJSContext, items: any[]): QuickJSHandle {
  const arr = vm.newArray();
  
  for (let i = 0; i < items.length; i++) {
    const itemHandle = toQuickJSValue(vm, items[i]);
    vm.setProp(arr, i, itemHandle);
    itemHandle.dispose();
  }
  
  return arr;
}

/**
 * 安全地执行代码并获取结果
 * 
 * @param vm QuickJS 上下文
 * @param code JavaScript 代码
 * @returns 执行结果（已转换为 JS 值）
 * @throws 执行错误
 */
export function evalCodeSafe(vm: QuickJSContext, code: string): any {
  const result = vm.evalCode(code);
  
  if (result.error) {
    const error = vm.dump(result.error);
    result.error.dispose();
    throw new Error(`QuickJS eval error: ${JSON.stringify(error)}`);
  }
  
  const value = vm.dump(result.value);
  result.value.dispose();
  return value;
}

/**
 * 创建 Promise 并管理其生命周期
 * 
 * 用于在 QuickJS 中暴露异步函数
 */
export class QuickJSPromise {
  public handle: QuickJSHandle;
  private resolveFn: ((value?: QuickJSHandle) => void) | null = null;
  private rejectFn: ((value?: QuickJSHandle) => void) | null = null;

  constructor(private vm: QuickJSContext) {
    // 创建 DeferredPromise
    const deferred = vm.newPromise();
    this.handle = deferred.handle;
    this.resolveFn = deferred.resolve;
    this.rejectFn = deferred.reject;
  }

  /**
   * 成功解决 Promise
   */
  resolve(value: any): void {
    if (!this.resolveFn) return;
    
    const valueHandle = toQuickJSValue(this.vm, value);
    this.resolveFn(valueHandle);
    valueHandle.dispose();
    
    // 关键：执行 pending jobs 让 await 继续
    this.vm.runtime.executePendingJobs();
  }

  /**
   * 拒绝 Promise
   */
  reject(error: any): void {
    if (!this.rejectFn) return;
    
    const errorHandle = typeof error === 'string' 
      ? this.vm.newString(error)
      : toQuickJSValue(this.vm, error);
    
    this.rejectFn(errorHandle);
    errorHandle.dispose();
    
    // 关键：执行 pending jobs 让 await 继续
    this.vm.runtime.executePendingJobs();
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.handle.dispose();
  }
}
