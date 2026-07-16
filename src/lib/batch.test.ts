import { describe, expect, it } from 'vitest'
import { parseBatchLines } from './batch'

describe('多行批量输入', () => {
  it('按原顺序清理首尾空格并忽略空行', () => {
    expect(parseBatchLines('  牛奶  \n\n 面包\r\n  \n纸 ')).toEqual([
      '牛奶',
      '面包',
      '纸',
    ])
  })

  it('保留内容相同的重复项目', () => {
    expect(parseBatchLines('牛奶\n牛奶')).toEqual(['牛奶', '牛奶'])
  })

  it('单行保持原有新增语义', () => {
    expect(parseBatchLines('  写周报  ')).toEqual(['写周报'])
  })
})
