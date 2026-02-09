// ============================================================
// SIMD 加速版 ColumnarTable
// 自动检测 WASM 支持，无缝降级到 JS
// ============================================================

import { ColumnarTable as BaseColumnarTable, ColumnarType } from './columnar.js';
import { 
    loadWasm, 
    isWasmReady, 
    simdFilterF64GT, 
    simdSumF64, 
    simdAggregateF64,
    simdFilterPriceVolume,
    simdTimeBucket
} from './simd.js';

export class SIMDColumnarTable extends BaseColumnarTable {
    private wasmLoaded = false;

    constructor(columnDefs: { name: string; type: ColumnarType }[], initialCapacity = 1000) {
        super(columnDefs, initialCapacity);
        this.initWasm();
    }

    private async initWasm(): Promise<void> {
        this.wasmLoaded = await loadWasm();
    }

    /**
     * SIMD 加速的过滤查询
     */
    filterSimd(column: string, operator: '>' | '<' | '>=', value: number): Uint32Array {
        const col = this.getColumn(column) as Float64Array;
        if (!col) throw new Error(`Column ${column} not found`);

        if (!this.wasmLoaded || !isWasmReady()) {
            // Fallback to JS
            return this.filterFallback(col, operator, value);
        }

        // 使用 SIMD
        if (operator === '>') {
            return simdFilterF64GT(col, value);
        }

        // 其他操作符用 JS
        return this.filterFallback(col, operator, value);
    }

    /**
     * SIMD 加速聚合
     */
    aggregateSimd(column: string): { sum: number; min: number; max: number; avg: number; count: number } {
        const col = this.getColumn(column) as Float64Array;
        if (!col) throw new Error(`Column ${column} not found`);

        if (!this.wasmLoaded || !isWasmReady()) {
            return this.aggregateFallback(col);
        }

        const result = simdAggregateF64(col);
        return {
            ...result,
            avg: result.sum / col.length,
            count: col.length
        };
    }

    /**
     * SIMD 加速 SAMPLE BY
     */
    sampleBySimd(timeColumn: string, intervalMs: number, aggregations: { column: string; op: 'first' | 'last' | 'min' | 'max' | 'sum' | 'avg' }[]): Array<Record<string, number | bigint>> {
        const timestamps = this.getColumn(timeColumn) as BigInt64Array;
        if (!timestamps) throw new Error(`Time column ${timeColumn} not found`);

        if (!this.wasmLoaded || !isWasmReady()) {
            return this.sampleBy(timeColumn, intervalMs, aggregations);
        }

        // 使用 SIMD 时间桶
        const buckets = simdTimeBucket(timestamps, intervalMs);

        // 对每个桶聚合
        const results: Array<Record<string, number | bigint>> = [];

        for (const bucket of buckets) {
            const result: Record<string, number | bigint> = { [timeColumn]: bucket.bucket };

            for (const agg of aggregations) {
                const col = this.getColumn(agg.column) as Float64Array;
                if (!col) continue;

                // 截取桶内的数据
                const slice = col.subarray(bucket.start, bucket.end);

                switch (agg.op) {
                    case 'first':
                        result[`${agg.column}_${agg.op}`] = slice[0];
                        break;
                    case 'last':
                        result[`${agg.column}_${agg.op}`] = slice[slice.length - 1];
                        break;
                    case 'min':
                        result[`${agg.column}_${agg.op}`] = Math.min(...slice);
                        break;
                    case 'max':
                        result[`${agg.column}_${agg.op}`] = Math.max(...slice);
                        break;
                    case 'sum':
                        result[`${agg.column}_${agg.op}`] = simdSumF64(slice);
                        break;
                    case 'avg':
                        result[`${agg.column}_${agg.op}`] = simdSumF64(slice) / slice.length;
                        break;
                }
            }

            results.push(result);
        }

        return results;
    }

    private filterFallback(col: Float64Array, operator: string, value: number): Uint32Array {
        const result: number[] = [];
        
        for (let i = 0; i < col.length; i++) {
            const v = col[i];
            let match = false;
            
            switch (operator) {
                case '>': match = v > value; break;
                case '<': match = v < value; break;
                case '>=': match = v >= value; break;
                case '<=': match = v <= value; break;
                case '=': match = v === value; break;
            }
            
            if (match) result.push(i);
        }
        
        return new Uint32Array(result);
    }

    private aggregateFallback(col: Float64Array): { sum: number; min: number; max: number; avg: number; count: number } {
        if (col.length === 0) {
            return { sum: 0, min: 0, max: 0, avg: 0, count: 0 };
        }

        let sum = 0;
        let min = col[0];
        let max = col[0];

        for (let i = 0; i < col.length; i++) {
            const v = col[i];
            sum += v;
            if (v < min) min = v;
            if (v > max) max = v;
        }

        return {
            sum,
            min,
            max,
            avg: sum / col.length,
            count: col.length
        };
    }
}

export { loadWasm, isWasmReady };
